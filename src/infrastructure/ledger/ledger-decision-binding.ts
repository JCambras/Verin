/**
 * What the IMMUTABLE decision authorizes. A ledger event may describe any allowed
 * outcome, but it cannot name an approval stage, an escalation, an execution step, or
 * a plan-owned payload field the recorded decision never declared. Append and L2 share
 * this one derivation, so stored history is judged by the rule that admitted it.
 */
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import type { DecisionRecord } from "@contracts/decision-core/decision";

function referencedStageId(event: LedgerEntry): string | undefined {
  switch (event.type) {
    case "ApprovalRecorded":
    case "ApprovalStageExpired":
    case "ApprovalStageEscalated":
      return event.stageId;
    default:
      return undefined;
  }
}

function referencedStepId(event: LedgerEntry): string | undefined {
  switch (event.type) {
    case "ExecutionStarted":
    case "ExecutionSucceeded":
    case "ExecutionPartiallySucceeded":
    case "ExecutionFailed":
      return event.stepId;
    default:
      return undefined;
  }
}

/**
 * Every action the immutable plan authorizes: each step, and the compensating action
 * it carries, which owns its own idempotency key, reservations, conflict keys, and
 * verification rule.
 */
function planActions(record: DecisionRecord, stepId?: string) {
  const steps = record.result.kind === "proceed"
    ? record.result.executionPlan.steps
    : [];
  return steps
    .filter((step) => stepId === undefined || step.id === stepId)
    .flatMap((step) =>
      step.compensatingAction ? [step, step.compensatingAction] : [step]);
}

const sameRef = (
  left: { readonly firmId: string; readonly id: string },
  right: { readonly firmId: string; readonly id: string },
): boolean => left.firmId === right.firmId && left.id === right.id;

/**
 * Payload fields the plan OWNS are bound to it, not merely to a step that exists.
 * Both sets are canonically ordered by their schemas, so equality is positional.
 */
function planFieldReason(
  event: LedgerEntry,
  record: DecisionRecord,
): string | null {
  if (event.type === "ExecutionStarted") {
    return planActions(record, event.stepId).some((action) =>
      action.idempotencyKey === event.idempotencyKey)
      ? null
      : "ledger idempotency key is absent from the immutable execution step";
  }
  if (event.type === "ReservationCreated") {
    const owning = planActions(record).filter((action) =>
      action.reservationRefs.some((ref) => sameRef(ref, event.reservationRef)));
    if (owning.length === 0) {
      return "ledger reservation is absent from the immutable execution plan";
    }
    return owning.some((action) =>
      action.conflictKeys.length === event.conflictKeys.length &&
      event.conflictKeys.every((key, index) => key === action.conflictKeys[index]))
      ? null
      : "ledger conflict keys differ from the immutable execution plan";
  }
  if (event.type === "VerificationClosed") {
    return planActions(record).some((action) =>
      sameRef(action.verificationRuleRef, event.verificationRuleRef))
      ? null
      : "ledger verification rule is absent from the immutable execution plan";
  }
  return null;
}

export function decisionStructureReason(
  event: LedgerEntry,
  record: DecisionRecord,
): string | null {
  const stageId = referencedStageId(event);
  if (stageId !== undefined) {
    const authority = record.result.kind === "proceed"
      ? record.result.authority
      : undefined;
    const stage = authority && authority.mode !== "automatic"
      ? authority.stages.find((candidate) => candidate.stageId === stageId)
      : undefined;
    if (!stage) return "ledger approval stage is absent from the immutable decision";
    if (event.type === "ApprovalStageEscalated") {
      const escalation = stage.escalationPath[event.escalationStepIndex];
      if (!escalation) {
        return "ledger approval escalation is absent from the immutable stage";
      }
      const recordedRoles = escalation.roleIds.map((role) => role.id);
      if (
        event.reasonCode !== escalation.reasonCode ||
        event.roleIds.length !== recordedRoles.length ||
        event.roleIds.some((role, index) => role.id !== recordedRoles[index])
      ) return "ledger approval escalation differs from the immutable stage";
    }
  }
  const stepId = referencedStepId(event);
  if (stepId !== undefined && planActions(record, stepId).length === 0) {
    return "ledger execution step is absent from the immutable decision";
  }
  return planFieldReason(event, record);
}
