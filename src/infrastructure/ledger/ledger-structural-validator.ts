import { appError } from "@contracts/errors";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { promotedDecisionRef } from "@contracts/decision-core/ledger-references";
import {
  approvalStageKey,
  assertExecutionHandleOwnership,
  effectiveApprovalAuthority,
  executionHandleOwnerEntries,
  mergePriorEntries,
  structuralExecutionHandleId,
} from "./ledger-structural-history";
import {
  assertDecisionClaimsV1,
  assertPlanReferencesV1,
  EXCEPTION_TRIGGER_TYPES_V1,
} from "./ledger-structural-rules-v1";

export { structuralExecutionHandleId } from "./ledger-structural-history";

export interface StructuralDecision {
  readonly record: DecisionRecord;
  readonly bundleHash: string;
}

export interface StructuralLedgerEntry {
  readonly sequence: number;
  readonly event: LedgerEntry;
}

export interface LedgerStructureLookup {
  readonly decision: (id: string) => Promise<StructuralDecision | null>;
  readonly entry: (id: string) => Promise<StructuralLedgerEntry | null>;
  readonly decisionRecording: (
    decisionId: string,
    beforeSequence: number,
  ) => Promise<StructuralLedgerEntry | null>;
  readonly evidenceRecording: (
    evidenceId: string,
    beforeSequence: number,
  ) => Promise<StructuralLedgerEntry | null>;
  readonly activeReservation: (
    reservationId: string,
    beforeSequence: number,
  ) => Promise<StructuralLedgerEntry | null>;
  readonly approvalEscalations: (
    decisionId: string,
    stageId: string,
    beforeSequence: number,
    limit: number,
  ) => Promise<readonly StructuralLedgerEntry[]>;
  readonly executionHandleEvents: (
    handleId: string,
    beforeSequence: number,
  ) => Promise<readonly StructuralLedgerEntry[]>;
}

export const DECISION_RECORDING_REQUIRED =
  "decision-scoped ledger event must follow DecisionRecorded";

function decisionId(event: LedgerEntry): string | null {
  return promotedDecisionRef(event)?.id ?? null;
}

async function requireEarlierEntry(
  lookup: LedgerStructureLookup,
  referenceId: string,
  sequence: number,
  reason: string,
): Promise<StructuralLedgerEntry> {
  const preceding = await lookup.entry(referenceId);
  if (!preceding || preceding.sequence >= sequence) {
    throw appError("STORE_CONSTRAINT", reason);
  }
  return preceding;
}

function assertSameDecisionLineage(
  current: LedgerEntry,
  preceding: LedgerEntry,
  record: DecisionRecord | undefined,
): void {
  const currentId = decisionId(current);
  const precedingId = decisionId(preceding);
  if (currentId !== null && currentId === precedingId) return;
  if (
    current.type === "DecisionRecorded" &&
    record?.derivedFromDecisionRef &&
    preceding.type === "ExceptionDecisionRequested" &&
    preceding.priorDecisionRef.id === record.derivedFromDecisionRef.id
  ) {
    return;
  }
  throw appError(
    "STORE_CONSTRAINT",
    "ledger causal reference belongs to another decision lineage",
  );
}

interface StructuralRules {
  readonly assertDecisionClaims: typeof assertDecisionClaimsV1;
  readonly assertPlanReferences: typeof assertPlanReferencesV1;
  readonly exceptionTriggerTypes: ReadonlySet<LedgerEntry["type"]>;
}

const STRUCTURAL_RULES_V1: StructuralRules = Object.freeze({
  assertDecisionClaims: assertDecisionClaimsV1,
  assertPlanReferences: assertPlanReferencesV1,
  exceptionTriggerTypes: EXCEPTION_TRIGGER_TYPES_V1,
});

const STRUCTURAL_RULES = new Map<string, StructuralRules>([
  ["1.0.0|1.0.0", STRUCTURAL_RULES_V1],
  ["1.1.0|1.0.0", STRUCTURAL_RULES_V1],
]);

export function registeredLedgerStructuralEncodings(): readonly string[] {
  return [...STRUCTURAL_RULES.keys()];
}

async function assertEventStructure(
  item: StructuralLedgerEntry,
  lookup: LedgerStructureLookup,
): Promise<void> {
  const { event, sequence } = item;
  const rules = STRUCTURAL_RULES.get(
    `${event.schemaVersion}|${event.serializerVersion}`,
  );
  if (!rules) {
    throw appError(
      "STORE_CONSTRAINT",
      "ledger structural encoding is unsupported",
    );
  }
  const ref = promotedDecisionRef(event);
  let binding: StructuralDecision | null = null;
  if (ref) {
    if (
      event.type !== "DecisionRecorded" &&
      !(await lookup.decisionRecording(ref.id, sequence))
    ) {
      throw appError("STORE_CONSTRAINT", DECISION_RECORDING_REQUIRED);
    }
    binding = await lookup.decision(ref.id);
    if (!binding || binding.record.firmId !== event.firmId) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger decision reference has no immutable record",
      );
    }
    rules.assertDecisionClaims(event, binding);
    rules.assertPlanReferences(
      event,
      binding.record,
      await effectiveApprovalAuthority(event, binding.record, sequence, lookup),
    );
  }
  await assertExecutionHandleOwnership(event, sequence, lookup);
  if (event.type === "DecisionRecorded") {
    const prior = await lookup.decisionRecording(
      event.decisionRef.id,
      sequence,
    );
    if (prior) {
      throw appError(
        "STORE_CONSTRAINT",
        "decision may be recorded only once",
      );
    }
    const parentRef = binding?.record.derivedFromDecisionRef;
    if (parentRef) {
      const parent = await lookup.decision(parentRef.id);
      const parentRecording = await lookup.decisionRecording(
        parentRef.id,
        sequence,
      );
      const cause = event.causationRef
        ? await requireEarlierEntry(
            lookup,
            event.causationRef.id,
            sequence,
            "derived decision must cite its preceding exception request",
          )
        : null;
      if (
        !parent ||
        !parentRecording ||
        parent.record.intentRef.id !== binding?.record.intentRef.id ||
        cause?.event.type !== "ExceptionDecisionRequested" ||
        cause.event.priorDecisionRef.id !== parentRef.id
      ) {
        throw appError(
          "STORE_CONSTRAINT",
          "derived decision does not match its recorded decision lineage",
        );
      }
    }
  }
  if (event.type === "StatusObserved" && event.evidenceSnapshotRef) {
    const recording = await lookup.evidenceRecording(
      event.evidenceSnapshotRef.id,
      sequence,
    );
    if (!recording) {
      throw appError(
        "STORE_CONSTRAINT",
        "status evidence must be recorded before it is cited",
      );
    }
  }
  if (event.type === "ReservationCreated") {
    const active = await lookup.activeReservation(
      event.reservationRef.id,
      sequence,
    );
    if (active) {
      throw appError(
        "STORE_CONSTRAINT",
        "reservation already has an active generation",
      );
    }
  }
  if (event.type === "ReservationReleased") {
    const creation = await requireEarlierEntry(
      lookup,
      event.reservationCreationRef.id,
      sequence,
      "reservation release must cite its preceding creation entry",
    );
    if (
      creation.event.type !== "ReservationCreated" ||
      creation.event.decisionRef.id !== event.decisionRef.id ||
      creation.event.reservationRef.id !== event.reservationRef.id
    ) {
      throw appError(
        "STORE_CONSTRAINT",
        "reservation release does not match its creation entry",
      );
    }
  }
  if (event.causationRef) {
    const cause = await requireEarlierEntry(
      lookup,
      event.causationRef.id,
      sequence,
      "ledger causal reference must name a preceding entry",
    );
    assertSameDecisionLineage(event, cause.event, binding?.record);
  }
  if (event.type === "ExceptionDecisionRequested") {
    const trigger = await requireEarlierEntry(
      lookup,
      event.triggeringEntryRef.id,
      sequence,
      "ledger exception trigger must name a preceding entry",
    );
    if (
      !rules.exceptionTriggerTypes.has(trigger.event.type) ||
      decisionId(trigger.event) !== event.priorDecisionRef.id
    ) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger exception trigger is not eligible for the decision lineage",
      );
    }
  }
}

export async function assertRecordedLedgerStructure(
  entries: readonly StructuralLedgerEntry[],
  base: LedgerStructureLookup,
): Promise<void> {
  const seenEntries = new Map<string, StructuralLedgerEntry>();
  const seenDecisions = new Map<string, StructuralLedgerEntry>();
  const seenEvidence = new Map<string, StructuralLedgerEntry>();
  const seenApprovalEscalations = new Map<
    string,
    StructuralLedgerEntry[]
  >();
  const seenExecutionHandles = new Map<string, StructuralLedgerEntry[]>();
  const activeReservations = new Map<
    string,
    StructuralLedgerEntry | null
  >();
  const releasedReservations = new Set<string>();
  const decisionCache = new Map<
    string,
    Promise<StructuralDecision | null>
  >();
  const overlay: LedgerStructureLookup = {
    decision: (id) => {
      const cached = decisionCache.get(id);
      if (cached) return cached;
      const loaded = base.decision(id);
      decisionCache.set(id, loaded);
      return loaded;
    },
    entry: async (id) => seenEntries.get(id) ?? base.entry(id),
    decisionRecording: async (id, before) => {
      const seen = seenDecisions.get(id);
      return seen && seen.sequence < before
        ? seen
        : base.decisionRecording(id, before);
    },
    evidenceRecording: async (id, before) => {
      const seen = seenEvidence.get(id);
      return seen && seen.sequence < before
        ? seen
        : base.evidenceRecording(id, before);
    },
    activeReservation: async (id, before) => {
      if (activeReservations.has(id)) {
        return activeReservations.get(id) ?? null;
      }
      const stored = await base.activeReservation(id, before);
      const active = stored && !releasedReservations.has(stored.event.id)
        ? stored
        : null;
      activeReservations.set(id, active);
      return active;
    },
    approvalEscalations: async (decisionId, stageId, before, limit) => {
      const stored = await base.approvalEscalations(
        decisionId,
        stageId,
        before,
        limit,
      );
      return mergePriorEntries(
        stored,
        seenApprovalEscalations.get(approvalStageKey(decisionId, stageId)) ?? [],
        before,
      ).slice(0, limit);
    },
    executionHandleEvents: async (handleId, before) => {
      const stored = await base.executionHandleEvents(handleId, before);
      return executionHandleOwnerEntries(
        [...stored, ...(seenExecutionHandles.get(handleId) ?? [])],
        before,
      );
    },
  };
  for (const item of [...entries].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    await assertEventStructure(item, overlay);
    seenEntries.set(item.event.id, item);
    if (item.event.type === "DecisionRecorded") {
      seenDecisions.set(item.event.decisionRef.id, item);
    }
    if (item.event.type === "EvidenceSnapshotRecorded") {
      seenEvidence.set(item.event.evidenceSnapshotRef.id, item);
    }
    if (item.event.type === "ApprovalStageEscalated") {
      const key = approvalStageKey(
        item.event.decisionRef.id,
        item.event.stageId,
      );
      seenApprovalEscalations.set(key, [
        ...(seenApprovalEscalations.get(key) ?? []),
        item,
      ]);
    }
    const handleId = structuralExecutionHandleId(item.event);
    if (handleId) {
      seenExecutionHandles.set(handleId, [
        ...(seenExecutionHandles.get(handleId) ?? []),
        item,
      ]);
    }
    if (item.event.type === "ReservationCreated") {
      activeReservations.set(item.event.reservationRef.id, item);
    }
    if (item.event.type === "ReservationReleased") {
      const creationId = item.event.reservationCreationRef.id;
      releasedReservations.add(creationId);
      const current = activeReservations.get(item.event.reservationRef.id);
      if (current?.event.id === creationId) {
        activeReservations.set(item.event.reservationRef.id, null);
      }
    }
  }
}
