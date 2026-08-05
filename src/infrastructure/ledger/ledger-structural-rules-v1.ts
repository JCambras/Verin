import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { appError } from "@contracts/errors";
import type { EffectiveApprovalStageAuthority } from "@domain/ledger/approval-authority";
import type { StructuralDecision } from "./ledger-structural-validator";

export const EXCEPTION_TRIGGER_TYPES_V1 = new Set<LedgerEntry["type"]>([
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

export function assertDecisionClaimsV1(
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

export function assertPlanReferencesV1(
  event: LedgerEntry,
  record: DecisionRecord,
  approvalAuthority?: EffectiveApprovalStageAuthority,
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
      const eligibleRoles = new Set(approvalAuthority?.eligibleRoleIds ?? []);
      if (!event.approver.roleIds.some((role) => eligibleRoles.has(role.id))) {
        throw appError(
          "STORE_CONSTRAINT",
          "ledger approver role is not authorized by the approval stage",
        );
      }
    }
    if (
      event.type === "ApprovalStageExpired" &&
      event.effectiveAt !== approvalAuthority?.expiresAt
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
