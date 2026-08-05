import type { SqlDb, SqlTx } from "@infra/store/db";
import { appError, normalizeAppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import {
  assertActionGrant,
  type ActionGrant,
} from "@contracts/authz";
import {
  assertSameTenant,
  type TenantContext,
} from "@contracts/tenant";
import {
  deriveArtifactProvenance,
  parseRecordProvenance,
  type DerivedProvenance,
} from "@contracts/provenance";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import {
  foldDecisionProjection,
  type DecisionProjection,
} from "@domain/ledger/projections";
import {
  verifyAndListDecisionLedgerTransaction,
  type DecisionLedgerRow,
  type LedgerVerification,
} from "./ledger-verification";
import { parseRecordedLedgerEvent } from "./ledger-schema-registry";
import {
  loadVerifiedReplayWindow,
  type RecordedReplayEvent,
} from "./ledger-replay-loader";

export interface VerifiedRegisterDecision {
  readonly projection: DecisionProjection;
  readonly provenance: DerivedProvenance;
}

export interface VerifiedRegisterSnapshot extends PIIBearing {
  readonly verification: LedgerVerification;
  readonly rows: readonly DecisionLedgerRow[];
  readonly decisions: readonly VerifiedRegisterDecision[];
  readonly decisionsTotal: number;
  readonly decisionsWithheld: number;
  readonly decisionsWithheldProvenance: DerivedProvenance | null;
}

function parseEvent(row: DecisionLedgerRow): LedgerEntry {
  let value: unknown;
  try {
    value = JSON.parse(row.payloadJson);
  } catch {
    throw appError("STORE_CONSTRAINT", "verified ledger payload is not JSON");
  }
  const parsed = parseRecordedLedgerEvent(
    row.eventType,
    row.schemaVersion,
    row.serializerVersion,
    value,
  );
  if (!parsed.ok) throw appError("STORE_CONSTRAINT", parsed.reason);
  return parsed.event;
}

function eventDecisionId(event: LedgerEntry): string | undefined {
  if ("decisionRef" in event) return event.decisionRef.id;
  if ("priorDecisionRef" in event) return event.priorDecisionRef.id;
  return undefined;
}

async function replayRegisterWindow(
  tx: SqlTx,
  tenant: TenantContext,
  rows: readonly DecisionLedgerRow[],
  decisionLimit: number,
): Promise<{
  readonly decisions: readonly VerifiedRegisterDecision[];
  readonly decisionsTotal: number;
  readonly decisionsWithheld: number;
  readonly decisionsWithheldProvenance: DerivedProvenance | null;
}> {
  const entries: RecordedReplayEvent[] = rows.map((row) => {
    const provenance = parseRecordProvenance({
      source: row.provSource,
      asOf: row.provAsOf,
      confidence: row.provConfidence,
    });
    if (!provenance) {
      throw appError("STORE_CONSTRAINT", "verified ledger provenance is invalid");
    }
    return { event: parseEvent(row), sequence: row.sequence, provenance };
  });
  const sources = await loadVerifiedReplayWindow(tx, tenant, entries);
  const decisions = new Map<string, VerifiedRegisterDecision>();
  for (const entry of entries) {
    const { event, sequence } = entry;
    let eventProvenance = entry.provenance;
    let decisionRecord;
    if (event.type === "DecisionRecorded") {
      const source = sources.decisions.get(event.decisionRef.id);
      if (!source) continue;
      decisionRecord = source.record;
      eventProvenance = source.provenance;
    }
    const id = eventDecisionId(event);
    if (!id) continue;
    const current = decisions.get(id);
    const projection = foldDecisionProjection({
      ...(current ? { current: current.projection } : {}),
      event,
      sequence,
      ...(decisionRecord ? { decisionRecord } : {}),
    });
    if (!projection) continue;
    const asOf = current && current.provenance.asOf > eventProvenance.asOf
      ? current.provenance.asOf
      : eventProvenance.asOf;
    decisions.set(id, {
      projection,
      provenance: deriveArtifactProvenance(
        current ? [current.provenance, eventProvenance] : [eventProvenance],
        asOf,
      ),
    });
  }
  const ordered = [...decisions.values()].sort((left, right) =>
    right.projection.lastSequence - left.projection.lastSequence ||
    left.projection.decisionId.localeCompare(right.projection.decisionId));
  const withheldInputs = entries.filter(({ event }) =>
    event.type === "DecisionRecorded" &&
    sources.withheldDecisionIds.has(event.decisionRef.id));
  const withheldAsOf = withheldInputs.reduce(
    (latest, entry) => entry.provenance.asOf > latest
      ? entry.provenance.asOf
      : latest,
    "",
  );
  return {
    decisions: ordered.slice(0, decisionLimit),
    decisionsTotal: ordered.length,
    decisionsWithheld: sources.withheldDecisionIds.size,
    decisionsWithheldProvenance: withheldInputs.length > 0
      ? deriveArtifactProvenance(
          withheldInputs.map((entry) => entry.provenance),
          withheldAsOf,
        )
      : null,
  };
}

function replaySourceFailure(
  verification: LedgerVerification,
): LedgerVerification {
  const failed = {
    level: "L2" as const,
    ok: false,
    entriesChecked: 0,
    brokenAtSequence: null,
    reason: "immutable replay source verification failed",
  };
  return {
    ok: false,
    entriesChecked: 0,
    entriesStored: verification.entriesStored,
    levels: [verification.levels[0]!, failed],
  };
}

export async function readVerifiedDecisionRegister(
  db: SqlDb,
  exportGrant: ActionGrant<"audit.export">,
  piiGrant: ActionGrant<"pii.view">,
  eventWindow: number,
  decisionLimit: number,
): Promise<VerifiedRegisterSnapshot> {
  assertActionGrant(exportGrant, "audit.export");
  assertActionGrant(piiGrant, "pii.view");
  assertSameTenant(exportGrant.tenant, piiGrant.tenant);
  const tenant = exportGrant.tenant;
  return db.transaction(async (tx) => {
    const checked = await verifyAndListDecisionLedgerTransaction(
      tx,
      exportGrant,
      piiGrant,
      eventWindow,
    );
    const rows = checked.verification.ok ? checked.rows : [];
    if (!checked.verification.ok) {
      return {
        verification: checked.verification,
        rows,
        decisions: [],
        decisionsTotal: 0,
        decisionsWithheld: 0,
        decisionsWithheldProvenance: null,
      };
    }
    let replayed;
    try {
      replayed = await replayRegisterWindow(tx, tenant, rows, decisionLimit);
    } catch (error: unknown) {
      const normalized = normalizeAppError(error, "trusted-only");
      if (normalized?.code !== "STORE_CONSTRAINT") throw error;
      return {
        verification: replaySourceFailure(checked.verification),
        rows: [],
        decisions: [],
        decisionsTotal: 0,
        decisionsWithheld: 0,
        decisionsWithheldProvenance: null,
      };
    }
    return {
      verification: checked.verification,
      rows,
      ...replayed,
    };
  });
}
