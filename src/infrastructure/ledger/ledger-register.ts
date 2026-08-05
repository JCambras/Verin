import type { SqlDb, SqlTx } from "@infra/store/db";
import { appError, normalizeAppError } from "@contracts/errors";
import {
  deriveArtifactProvenance,
  type DerivedProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import { promotedDecisionId } from "@contracts/decision-core/ledger-references";
import {
  foldDecisionProjection,
  type DecisionProjection,
} from "@domain/ledger/projections";
import {
  verifyDecisionLedgerTransaction,
  type DecisionLedgerRow,
  type LedgerVerification,
} from "./ledger-verification";
import {
  parseRecordedLedgerEvent,
} from "./ledger-schema-registry";
import {
  loadVerifiedReplayDecisionBinding,
  verifyReplayEvidence,
} from "./ledger-sources";
import {
  deriveLedgerEventProvenance,
  UNVERIFIED_REPLAY_SOURCE_PROVENANCE,
} from "./ledger-source-provenance";
import { listReplayDecisionEvidenceCoverage } from "./ledger-source-coverage";
import {
  executionHandleOwnerEntries,
} from "./ledger-structural-history";
import {
  assertRecordedLedgerStructure,
  DECISION_RECORDING_REQUIRED,
  structuralExecutionHandleId,
  type LedgerStructureLookup,
  type StructuralDecision,
  type StructuralLedgerEntry,
} from "./ledger-structural-validator";
import {
  UNVERIFIED_COMPUTED_PROVENANCE_INPUT,
  verifyRecordedLedgerProvenance,
} from "./ledger-producer-provenance";
import { storedLedgerStructureLookup } from "./ledger-structural-store";

export interface VerifiedRegisterDecision {
  readonly projection: DecisionProjection;
  readonly provenance: DerivedProvenance;
}

export interface VerifiedRegisterSnapshot {
  readonly verification: LedgerVerification;
  readonly rows: readonly DecisionLedgerRow[];
  readonly rowProvenance: ReadonlyMap<string, RecordProvenance>;
  readonly decisions: readonly VerifiedRegisterDecision[];
  readonly decisionsTotal: number;
  readonly replaySourceReason: string | null;
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

async function hasPreWindowEntry(
  tx: SqlTx,
  orgId: string,
  entryId: string,
  beforeSequence: number,
): Promise<boolean> {
  const result = await tx.query<{ sequence: number | string }>(
    `SELECT sequence
       FROM decision_ledger
      WHERE org_id = $1 AND id = $2 AND sequence < $3
      ORDER BY sequence DESC
      LIMIT 1`,
    [orgId, entryId, beforeSequence],
  );
  return result.rows.length > 0;
}

async function hasPreWindowDecisionRecording(
  tx: SqlTx,
  orgId: string,
  decisionId: string,
  beforeSequence: number,
): Promise<boolean> {
  const result = await tx.query<{ sequence: number | string }>(
    `SELECT sequence
       FROM decision_ledger
      WHERE org_id = $1
        AND decision_id = $2
        AND event_type = 'DecisionRecorded'
        AND sequence < $3
      ORDER BY sequence DESC
      LIMIT 1`,
    [orgId, decisionId, beforeSequence],
  );
  return result.rows.length > 0;
}

function directEntryReferences(event: LedgerEntry): readonly string[] {
  return [
    ...(event.causationRef ? [event.causationRef.id] : []),
    ...(event.type === "ReservationReleased"
      ? [event.reservationCreationRef.id]
      : []),
    ...(event.type === "ExceptionDecisionRequested"
      ? [event.triggeringEntryRef.id]
      : []),
  ];
}

async function hasPreWindowStructuralOwner(
  lookup: LedgerStructureLookup,
  event: LedgerEntry,
  sequence: number,
  windowStart: number,
): Promise<boolean> {
  if (event.type === "ReservationCreated") {
    const active = await lookup.activeReservation(
      event.reservationRef.id,
      sequence,
    );
    if (active && active.sequence < windowStart) return true;
  }
  const handleId = structuralExecutionHandleId(event);
  if (!handleId) return false;
  const owners = await lookup.executionHandleEvents(handleId, sequence);
  return owners.some((owner) => owner.sequence < windowStart);
}

async function replayRegisterWindow(
  tx: SqlTx,
  tenant: TenantContext,
  rows: readonly DecisionLedgerRow[],
  decisionLimit: number,
): Promise<{
  readonly decisions: readonly VerifiedRegisterDecision[];
  readonly decisionsTotal: number;
  readonly rowProvenance: ReadonlyMap<string, RecordProvenance>;
}> {
  const verifiedEvidence = new Set<string>();
  const incompleteDecisions = new Set<string>();
  const decisions = new Map<string, VerifiedRegisterDecision>();
  const windowStart = rows[0]?.sequence ?? 0;
  const verifiedRecordingEntryIds = new Set(rows.map((row) => row.id));
  const rowProvenance = new Map<string, RecordProvenance>();
  const incompleteProvenance = new Set<string>();
  const provenanceCache = new Map<
    string,
    Promise<RecordProvenance>
  >();
  for (const row of rows) {
    try {
      rowProvenance.set(
        row.id,
        await verifyRecordedLedgerProvenance(
          tx,
          tenant,
          row,
          verifiedRecordingEntryIds,
          provenanceCache,
        ),
      );
    } catch (error) {
      if (normalizeAppError(error, "trusted-only")?.message === UNVERIFIED_COMPUTED_PROVENANCE_INPUT) {
        incompleteProvenance.add(row.id);
        continue;
      }
      throw error;
    }
  }
  const entries = rows.map((row): StructuralLedgerEntry => ({
    event: parseEvent(row),
    sequence: row.sequence,
  }));
  const entryById = new Map<string, StructuralLedgerEntry>(
    entries.map((item) => [item.event.id, item]),
  );
  const recordingSequenceByDecision = new Map(
    entries.flatMap((item) =>
      item.event.type === "DecisionRecorded"
        ? [[item.event.decisionRef.id, item.sequence] as const]
        : []),
  );
  const structuralDecisions = new Map<string, StructuralDecision>();
  const storedStructure = storedLedgerStructureLookup(tx, tenant);
  const structure: LedgerStructureLookup = {
    decision: async (id) => structuralDecisions.get(id) ?? null,
    entry: async (id) => entryById.get(id) ?? null,
    decisionRecording: async (id, before) =>
      entries.find((item) =>
        item.sequence < before &&
        item.event.type === "DecisionRecorded" &&
        item.event.decisionRef.id === id) ?? null,
    evidenceRecording: async (id, before) =>
      entries.find((item) =>
        item.sequence < before &&
        item.event.type === "EvidenceSnapshotRecorded" &&
        item.event.evidenceSnapshotRef.id === id) ?? null,
    activeReservation: async (id, before) => {
      const prior = entries.filter((item) => item.sequence < before);
      const released = new Set(
        prior.flatMap((item) =>
          item.event.type === "ReservationReleased"
            ? [item.event.reservationCreationRef.id]
            : []),
      );
      return prior
        .filter(
          (item) =>
            item.event.type === "ReservationCreated" &&
            item.event.reservationRef.id === id &&
            !released.has(item.event.id),
        )
        .sort((left, right) => right.sequence - left.sequence)[0] ?? null;
    },
    approvalEscalations: async (decisionId, stageId, before, limit) =>
      entries.filter((item) =>
        item.sequence < before &&
        item.event.type === "ApprovalStageEscalated" &&
        item.event.decisionRef.id === decisionId &&
        item.event.stageId === stageId).slice(0, limit),
    executionHandleEvents: async (handleId, before) =>
      executionHandleOwnerEntries(entries.filter((item) =>
        structuralExecutionHandleId(item.event) === handleId), before),
  };
  for (const [index, row] of rows.entries()) {
    const item = entries[index]!;
    const event = item.event;
    const id = promotedDecisionId(event);
    if (incompleteProvenance.has(row.id)) {
      if (id) {
        decisions.delete(id);
        incompleteDecisions.add(id);
      }
      continue;
    }
    let hasUnverifiedDependency = false;
    for (const referenceId of directEntryReferences(event)) {
      if (
        !entryById.has(referenceId) &&
        await hasPreWindowEntry(
          tx,
          event.firmId,
          referenceId,
          item.sequence,
        )
      ) {
        hasUnverifiedDependency = true;
        break;
      }
    }
    if (hasUnverifiedDependency) {
      if (id) {
        decisions.delete(id);
        incompleteDecisions.add(id);
        structuralDecisions.delete(id);
      }
      continue;
    }
    if (event.type === "EvidenceSnapshotRecorded") {
      verifiedEvidence.add(await verifyReplayEvidence(tx, tenant, event));
      await assertRecordedLedgerStructure([item], structure);
      continue;
    }
    if (
      id &&
      event.type !== "DecisionRecorded" &&
      !structuralDecisions.has(id)
    ) {
      const recordingSequence = recordingSequenceByDecision.get(id);
      if (
        recordingSequence !== undefined &&
        recordingSequence > item.sequence
      ) {
        throw appError("STORE_CONSTRAINT", DECISION_RECORDING_REQUIRED);
      }
      if (await hasPreWindowDecisionRecording(
        tx,
        event.firmId,
        id,
        item.sequence,
      )) {
        incompleteDecisions.add(id);
        continue;
      }
      throw appError("STORE_CONSTRAINT", DECISION_RECORDING_REQUIRED);
    }
    if (
      id &&
      await hasPreWindowStructuralOwner(
        storedStructure,
        event,
        item.sequence,
        windowStart,
      )
    ) {
      decisions.delete(id);
      incompleteDecisions.add(id);
      continue;
    }
    if (
      event.type === "StatusObserved" &&
      event.evidenceSnapshotRef !== undefined &&
      !verifiedEvidence.has(event.evidenceSnapshotRef.id)
    ) {
      if (id) {
        decisions.delete(id);
        incompleteDecisions.add(id);
      }
      continue;
    }
    let decisionRecord;
    if (event.type === "DecisionRecorded") {
      const coverage = await listReplayDecisionEvidenceCoverage(
        tx,
        tenant,
        event,
        windowStart,
        row.sequence,
      );
      if (!coverage.complete) {
        incompleteDecisions.add(event.decisionRef.id);
        continue;
      }
      if (coverage.items.some((item) => !item.hasPrecedingRecording)) {
        throw appError(
          "STORE_CONSTRAINT",
          "decision evidence has no recording ledger fact",
        );
      }
      if (coverage.items.some((item) => item.recordedSequence === null)) {
        continue;
      }
      if (coverage.items.some((item) => !verifiedEvidence.has(item.id))) {
        throw appError(
          "STORE_CONSTRAINT",
          "decision evidence is missing from the verified window",
        );
      }
      const binding = await loadVerifiedReplayDecisionBinding(
        tx,
        tenant,
        event,
        verifiedEvidence,
      );
      decisionRecord = binding.record;
      const parentId = binding.record.derivedFromDecisionRef?.id;
      if (
        parentId &&
        (
          incompleteDecisions.has(parentId) ||
          (
            !structuralDecisions.has(parentId) &&
            await hasPreWindowDecisionRecording(
              tx,
              event.firmId,
              parentId,
              item.sequence,
            )
          )
        )
      ) {
        incompleteDecisions.add(event.decisionRef.id);
        continue;
      }
      structuralDecisions.set(event.decisionRef.id, binding);
    }
    if (!id) continue;
    if (incompleteDecisions.has(id)) continue;
    if (structuralDecisions.has(id)) {
      await assertRecordedLedgerStructure([item], structure);
    }
    const current = decisions.get(id);
    const projection = foldDecisionProjection({
      ...(current ? { current: current.projection } : {}),
      event,
      sequence: row.sequence,
      ...(decisionRecord ? { decisionRecord } : {}),
    });
    if (!projection) continue;
    let eventProvenance;
    try {
      eventProvenance = await deriveLedgerEventProvenance(
        tx,
        tenant,
        event,
        rowProvenance.get(row.id)!,
        false,
        verifiedRecordingEntryIds,
      );
    } catch (error) {
      const known = normalizeAppError(error, "trusted-only");
      if (
        known &&
        (known.message === UNVERIFIED_REPLAY_SOURCE_PROVENANCE ||
          known.message === UNVERIFIED_COMPUTED_PROVENANCE_INPUT)
      ) {
        decisions.delete(id);
        incompleteDecisions.add(id);
        continue;
      }
      throw error;
    }
    const asOf = current && current.provenance.asOf > eventProvenance.asOf
      ? current.provenance.asOf
      : eventProvenance.asOf;
    decisions.set(id, {
      projection,
      provenance: deriveArtifactProvenance(
        current
          ? [current.provenance, eventProvenance]
          : [eventProvenance],
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
    rowProvenance,
  };
}

export async function readVerifiedDecisionRegister(
  db: SqlDb,
  tenant: TenantContext,
  eventWindow: number,
  decisionLimit: number,
): Promise<VerifiedRegisterSnapshot> {
  assertTenantContext(tenant);
  return db.transaction(async (tx) => {
    const checked = await verifyDecisionLedgerTransaction(
      tx,
      tenant,
      eventWindow,
    );
    if (!checked.verification.ok) {
      return {
        ...checked,
        decisions: [],
        decisionsTotal: 0,
        rowProvenance: new Map(),
        replaySourceReason: null,
      };
    }
    try {
      const replayed = await replayRegisterWindow(
        tx,
        tenant,
        checked.rows,
        decisionLimit,
      );
      return { ...checked, ...replayed, replaySourceReason: null };
    } catch (error) {
      return {
        ...checked,
        verification: { ...checked.verification, ok: false },
        decisions: [],
        decisionsTotal: 0,
        rowProvenance: new Map(),
        replaySourceReason: normalizeAppError(error, "trusted-only")?.message
          ?? "immutable replay source verification failed",
      };
    }
  });
}
