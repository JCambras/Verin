import type { SqlDb, SqlTx } from "@infra/store/db";
import { appError } from "@contracts/errors";
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
  verifyDecisionLedgerTransaction,
  type DecisionLedgerRow,
  type LedgerVerification,
} from "./ledger-verification";
import { parseRecordedLedgerEvent } from "./ledger-schema-registry";
import {
  listReplayDecisionEvidenceCoverage,
  loadVerifiedReplayDecision,
  verifyReplayEvidence,
} from "./ledger-sources";

export interface VerifiedRegisterDecision {
  readonly projection: DecisionProjection;
  readonly provenance: DerivedProvenance;
}

export interface VerifiedRegisterSnapshot {
  readonly verification: LedgerVerification;
  readonly rows: readonly DecisionLedgerRow[];
  readonly decisions: readonly VerifiedRegisterDecision[];
  readonly decisionsTotal: number;
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
  rows: readonly DecisionLedgerRow[],
  decisionLimit: number,
): Promise<{
  readonly decisions: readonly VerifiedRegisterDecision[];
  readonly decisionsTotal: number;
}> {
  const verifiedEvidence = new Set<string>();
  const decisions = new Map<string, VerifiedRegisterDecision>();
  for (const row of rows) {
    const event = parseEvent(row);
    if (event.type === "EvidenceSnapshotRecorded") {
      verifiedEvidence.add(await verifyReplayEvidence(tx, event));
      continue;
    }
    let decisionRecord;
    if (event.type === "DecisionRecorded") {
      const coverage = await listReplayDecisionEvidenceCoverage(tx, event);
      if (coverage.some((item) => item.recordedSequence === null)) {
        throw appError(
          "STORE_CONSTRAINT",
          "decision evidence has no recording ledger fact",
        );
      }
      if (
        coverage.some((item) =>
          item.recordedSequence! < (rows[0]?.sequence ?? 0))
      ) {
        continue;
      }
      if (coverage.some((item) => !verifiedEvidence.has(item.id))) {
        throw appError(
          "STORE_CONSTRAINT",
          "decision evidence is missing from the verified window",
        );
      }
      decisionRecord = await loadVerifiedReplayDecision(
        tx,
        event,
        verifiedEvidence,
      );
    }
    const id = eventDecisionId(event);
    if (!id) continue;
    const current = decisions.get(id);
    const projection = foldDecisionProjection({
      ...(current ? { current: current.projection } : {}),
      event,
      sequence: row.sequence,
      ...(decisionRecord ? { decisionRecord } : {}),
    });
    if (!projection) continue;
    const provenance = parseRecordProvenance({
      source: row.provSource,
      asOf: row.provAsOf,
      confidence: row.provConfidence,
    });
    if (!provenance) {
      throw appError("STORE_CONSTRAINT", "verified ledger provenance is invalid");
    }
    const asOf = current && current.provenance.asOf > provenance.asOf
      ? current.provenance.asOf
      : provenance.asOf;
    decisions.set(id, {
      projection,
      provenance: deriveArtifactProvenance(
        current ? [current.provenance, provenance] : [provenance],
        asOf,
      ),
    });
  }
  const ordered = [...decisions.values()].sort((left, right) =>
    right.projection.lastSequence - left.projection.lastSequence ||
    left.projection.decisionId.localeCompare(right.projection.decisionId));
  return {
    decisions: ordered.slice(0, decisionLimit),
    decisionsTotal: ordered.length,
  };
}

export async function readVerifiedDecisionRegister(
  db: SqlDb,
  orgId: string,
  eventWindow: number,
  decisionLimit: number,
): Promise<VerifiedRegisterSnapshot> {
  return db.transaction(async (tx) => {
    const checked = await verifyDecisionLedgerTransaction(
      tx,
      orgId,
      eventWindow,
    );
    const replayed = checked.verification.ok
      ? await replayRegisterWindow(tx, checked.rows, decisionLimit)
      : { decisions: [], decisionsTotal: 0 };
    return {
      ...checked,
      ...replayed,
    };
  });
}
