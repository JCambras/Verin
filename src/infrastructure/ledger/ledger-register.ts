import type { SqlDb, SqlQueryable } from "@infra/store/db";
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
  foldStoredProvenance,
  parseRecordProvenance,
  type DerivedProvenance,
} from "@contracts/provenance";
import {
  referencedDecisionId,
  type LedgerEntry,
} from "@contracts/decision-core/ledger";
import {
  foldDecisionProjection,
  type DecisionProjection,
} from "@domain/ledger/projections";
import {
  verifyAndListDecisionLedger,
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
  readonly storedProvenance: DerivedProvenance | null;
  readonly decisions: readonly VerifiedRegisterDecision[];
  readonly decisionsTotal: number;
  readonly decisionsTotalProvenance: DerivedProvenance | null;
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

async function replayRegisterWindow(
  tx: SqlQueryable,
  tenant: TenantContext,
  rows: readonly DecisionLedgerRow[],
  decisionLimit: number,
): Promise<{
  readonly decisions: readonly VerifiedRegisterDecision[];
  readonly decisionsTotal: number;
  readonly decisionsTotalProvenance: DerivedProvenance | null;
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
    const id = referencedDecisionId(event);
    if (!id) continue;
    const current = decisions.get(id);
    const projection = foldDecisionProjection({
      ...(current ? { current: current.projection } : {}),
      event,
      sequence,
      ...(decisionRecord ? { decisionRecord } : {}),
    });
    if (!projection) continue;
    decisions.set(id, {
      projection,
      provenance: foldStoredProvenance(
        current ? [current.provenance, eventProvenance] : [eventProvenance],
      )!,
    });
  }
  const ordered = [...decisions.values()].sort((left, right) =>
    right.projection.lastSequence - left.projection.lastSequence ||
    left.projection.decisionId.localeCompare(right.projection.decisionId));
  const decisionIds = new Set(entries.flatMap(({ event }) => {
    const id = referencedDecisionId(event);
    return id ? [id] : [];
  }));
  const withheldIds = new Set([
    ...sources.withheldDecisionIds,
    ...[...decisionIds].filter((id) => !decisions.has(id)),
  ]);
  const withheldInputs = entries.filter(({ event }) => {
    const id = referencedDecisionId(event);
    return id !== undefined && withheldIds.has(id);
  });
  return {
    decisions: ordered.slice(0, decisionLimit),
    decisionsTotal: ordered.length,
    decisionsTotalProvenance: foldStoredProvenance(
      ordered.map((entry) => entry.provenance),
    ),
    decisionsWithheld: withheldIds.size,
    decisionsWithheldProvenance: foldStoredProvenance(
      withheldInputs.map((entry) => entry.provenance),
    ),
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
  const checked = await verifyAndListDecisionLedger(
    db,
    exportGrant,
    piiGrant,
    eventWindow,
  );
  const rows = checked.verification.ok ? checked.rows : [];
  if (!checked.verification.ok) {
    return {
      verification: checked.verification,
      rows,
      storedProvenance: checked.storedProvenance,
      decisions: [],
      decisionsTotal: 0,
      decisionsTotalProvenance: null,
      decisionsWithheld: 0,
      decisionsWithheldProvenance: null,
    };
  }
  let replayed;
  try {
    replayed = await replayRegisterWindow(db, tenant, rows, decisionLimit);
  } catch (error: unknown) {
    const normalized = normalizeAppError(error, "trusted-only");
    if (normalized?.code !== "STORE_CONSTRAINT") throw error;
    return {
      verification: replaySourceFailure(checked.verification),
      rows: [],
      storedProvenance: checked.storedProvenance,
      decisions: [],
      decisionsTotal: 0,
      decisionsTotalProvenance: null,
      decisionsWithheld: 0,
      decisionsWithheldProvenance: null,
    };
  }
  return {
    verification: checked.verification,
    rows,
    storedProvenance: checked.storedProvenance,
    ...replayed,
  };
}
