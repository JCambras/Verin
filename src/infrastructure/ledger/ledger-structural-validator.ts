import { appError } from "@contracts/errors";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { promotedDecisionRef } from "@contracts/decision-core/ledger-references";

export interface StructuralDecision {
  readonly record: DecisionRecord;
  readonly bundleHash: string;
}

export interface StructuralLedgerEntry {
  readonly sequence: number;
  readonly event: LedgerEntry;
}

export const DECISION_RECORDING_REQUIRED =
  "decision-scoped ledger event must follow DecisionRecorded";

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
}

const EXCEPTION_TRIGGER_TYPES_V1 = new Set<LedgerEntry["type"]>([
  "ApprovalInvalidated",
  "ExecutionPartiallySucceeded",
  "ExecutionFailed",
  "StatusObserved",
  "VerificationStuck",
]);

const sameStrings = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function authorizedActions(record: DecisionRecord) {
  return record.result.kind === "proceed"
    ? record.result.executionPlan.steps.flatMap((step) => [
        step,
        ...(step.compensatingAction ? [step.compensatingAction] : []),
      ])
    : [];
}

function approvalStage(record: DecisionRecord, stageId: string) {
  return record.result.kind === "proceed" &&
    record.result.authority.mode !== "automatic"
    ? record.result.authority.stages.find((stage) => stage.stageId === stageId)
    : undefined;
}

function executionStep(record: DecisionRecord, stepId: string) {
  return record.result.kind === "proceed"
    ? record.result.executionPlan.steps.find((step) => step.id === stepId)
    : undefined;
}

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

function assertDecisionClaimsV1(
  event: LedgerEntry,
  binding: StructuralDecision,
): void {
  const claimedDecisionHash =
    event.type === "DecisionRecorded" || event.type === "ApprovalRecorded"
      ? event.decisionHash
      : "priorDecisionHash" in event
        ? event.priorDecisionHash
        : undefined;
  if (
    claimedDecisionHash !== undefined &&
    claimedDecisionHash !== binding.record.decisionHash
  ) {
    throw appError(
      "STORE_CONSTRAINT",
      "ledger event decision hash does not match immutable record",
    );
  }
  if (
    (event.type === "ApprovalRecorded" &&
      event.inputBundleHash !== binding.bundleHash) ||
    (event.type === "DecisionRecorded" &&
      event.bundleHash !== undefined &&
      event.bundleHash !== binding.bundleHash)
  ) {
    throw appError(
      "STORE_CONSTRAINT",
      "ledger input bundle hash does not match immutable bundle",
    );
  }
}

function assertPlanReferencesV1(
  event: LedgerEntry,
  record: DecisionRecord,
): void {
  if (
    event.type === "ApprovalRecorded" ||
    event.type === "ApprovalStageExpired" ||
    event.type === "ApprovalStageEscalated"
  ) {
    const stage = approvalStage(record, event.stageId);
    if (!stage) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger event references an unauthorized approval stage",
      );
    }
    if (event.type === "ApprovalRecorded") {
      const eligibleRoles = new Set(
        stage.requirements.flatMap((requirement) =>
          requirement.eligibleRoleIds.map((role) => role.id)),
      );
      if (
        !event.approver.roleIds.some((role) => eligibleRoles.has(role.id))
      ) {
        throw appError(
          "STORE_CONSTRAINT",
          "ledger approver role is not authorized by the approval stage",
        );
      }
    }
    if (
      event.type === "ApprovalStageExpired" &&
      event.effectiveAt !== stage.expiresAt
    ) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger approval expiry does not match the recorded stage",
      );
    }
    if (event.type === "ApprovalStageEscalated") {
      const escalation = stage.escalationPath[event.escalationStepIndex];
      if (
        !escalation ||
        escalation.reasonCode !== event.reasonCode ||
        !sameStrings(
          escalation.roleIds.map((role) => role.id),
          event.roleIds.map((role) => role.id),
        )
      ) {
        throw appError(
          "STORE_CONSTRAINT",
          "ledger escalation is not authorized by the approval stage",
        );
      }
    }
  }
  if (
    event.type === "ExecutionStarted" ||
    event.type === "ExecutionSucceeded" ||
    event.type === "ExecutionPartiallySucceeded" ||
    event.type === "ExecutionFailed"
  ) {
    const step = executionStep(record, event.stepId);
    if (!step) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger event references an unauthorized execution step",
      );
    }
    if (
      event.type === "ExecutionStarted" &&
      event.idempotencyKey !== step.idempotencyKey
    ) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger execution idempotency key is not authorized by the decision",
      );
    }
  }
  if (event.type === "ReservationCreated") {
    const matches = authorizedActions(record).filter((action) =>
      action.reservationRefs.some(
        (reference) => reference.id === event.reservationRef.id,
      ) && sameStrings(action.conflictKeys, event.conflictKeys));
    if (matches.length !== 1) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger reservation is not uniquely authorized by the decision",
      );
    }
  }
  if (event.type === "ReservationReleased") {
    const authorized = authorizedActions(record).some((action) =>
      action.reservationRefs.some(
        (reference) => reference.id === event.reservationRef.id,
      ));
    if (!authorized) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger reservation is not authorized by the decision",
      );
    }
  }
  if (event.type === "VerificationClosed") {
    const matches = authorizedActions(record).filter(
      (action) =>
        action.verificationRuleRef.id === event.verificationRuleRef.id,
    );
    if (matches.length !== 1) {
      throw appError(
        "STORE_CONSTRAINT",
        "ledger verification rule is not uniquely authorized by the decision",
      );
    }
  }
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
    rules.assertPlanReferences(event, binding.record);
  }
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
  const activeReservations = new Map<
    string,
    StructuralLedgerEntry | null
  >();
  const releasedReservations = new Set<string>();
  const overlay: LedgerStructureLookup = {
    decision: base.decision,
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
