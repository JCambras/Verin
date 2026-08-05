import type { ApprovalStageVM } from "./model";
import type {
  SignedAuthorityStageData,
  SignedCaseVariant,
  SignedLedgerEventData,
} from "./signed-case-types";
import { formatDemoInstant, timelineFor } from "./timeline";
import {
  CANONICAL_REQUEST,
  hasSignedInvalidationAuthority,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

export const SIGNED_APPROVAL_BINDINGS_WITHHELD =
  "Missing signed approval actor identity, role, and requester bindings. Execution is withheld pending captain-signed approval evidence.";

function eventBindingComplete(
  stage: SignedAuthorityStageData,
  event: SignedLedgerEventData,
): boolean {
  return event.actorId !== null &&
    event.roleId !== null &&
    event.requesterId !== null &&
    stage.eligibleRoleIds.includes(event.roleId) &&
    (stage.requesterMayApprove || event.actorId !== event.requesterId);
}

export function signedApprovalStageSatisfied(
  stage: SignedAuthorityStageData,
  events: readonly SignedLedgerEventData[],
  pass: JourneyPass,
): boolean {
  const approvals = events.filter(
    (event) =>
      event.type === "ApprovalRecorded" &&
      event.stageId === stage.stageId &&
      event.lifecyclePass === pass,
  );
  if (
    !Number.isSafeInteger(stage.approvalsRequired) ||
    stage.approvalsRequired <= 0 ||
    approvals.length !== stage.approvalsRequired ||
    !approvals.every((event) => eventBindingComplete(stage, event))
  ) {
    return false;
  }
  return !stage.distinctActorsRequired ||
    new Set(approvals.map(({ actorId }) => actorId)).size ===
      stage.approvalsRequired;
}

export function signedApprovalPlanSatisfied(
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): boolean {
  if (sourceCase.authority.stages.length === 0) {
    return sourceCase.authority.mode === "automatic";
  }
  let previousOrder = 0;
  for (const stage of sourceCase.authority.stages) {
    if (
      stage.order <= previousOrder ||
      !signedApprovalStageSatisfied(stage, sourceCase.ledgerEvents, pass)
    ) {
      return false;
    }
    previousOrder = stage.order;
  }
  return true;
}

export function approvalPlanSatisfied(
  stages: readonly ApprovalStageVM[],
): boolean {
  if (stages.length === 0) return false;
  let previousOrder = 0;
  for (const stage of stages) {
    if (
      stage.order <= previousOrder ||
      !stage.satisfied ||
      !Number.isSafeInteger(stage.approvalsRequired) ||
      stage.approvalsRequired <= 0
    ) {
      return false;
    }
    previousOrder = stage.order;
    const eligible = stage.actors.filter(
      (actor) =>
        actor.bindingComplete &&
        actor.actorId !== null &&
        actor.roleId !== null &&
        actor.status === "done" &&
        stage.eligibleRoleIds.includes(actor.roleId) &&
        (stage.requesterMayApprove || actor.requesterExcluded === false),
    );
    const actorCount = stage.distinctActorsRequired
      ? new Set(eligible.map((actor) => actor.actorId)).size
      : eligible.length;
    if (actorCount < stage.approvalsRequired) return false;
  }
  return true;
}

export function buildStages(
  scenario: ScenarioData,
  firm: FirmData,
  _phase: "gate" | "final",
  pass: JourneyPass = "initial",
): ApprovalStageVM[] {
  const timeline = timelineFor(scenario, firm);
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const specialistExpired =
    sourceCase?.ledgerEvents.some(
      (event) => event.type === "ApprovalStageExpired",
    ) ?? false;
  const invalidation = hasSignedInvalidationAuthority(
    scenario,
    firm.id,
  );
  const sourceStages =
    sourceCase?.authority.stages ??
    (CANONICAL_REQUEST.amountMinor > firm.dualApprovalThresholdMinor
      ? [{
          stageId: "ops-dual-approval",
          order: 1,
          executionMode: "parallel" as const,
          eligibleRoleIds: ["operations"],
          approvalsRequired: 2,
          distinctActorsRequired: true,
          requesterMayApprove: false,
          expiresAfter: "P3D",
          escalationPath: [{
            after: "P1D",
            roleIds: ["operations-manager"],
            reasonCode: "approval-stage-idle",
          }],
        }]
      : []);
  return sourceStages.map((stage): ApprovalStageVM => {
    const specialistReview =
      stage.stageId === "bank-change-specialist-review";
    const approvalEvents = sourceCase?.ledgerEvents.filter(
      (event) =>
        event.type === "ApprovalRecorded" &&
        event.stageId === stage.stageId &&
        event.lifecyclePass === pass,
    ) ?? [];
    const stageReached =
      !specialistExpired &&
      sourceCase !== null &&
      sourceCase !== undefined &&
      signedApprovalStageSatisfied(
        stage,
        sourceCase.ledgerEvents,
        pass,
      );
    const approvalOneAt =
      pass === "revalidated"
        ? timeline.freshApprovalOneAt
        : timeline.approvalOneAt;
    const approvalTwoAt =
      pass === "revalidated"
        ? timeline.freshApprovalTwoAt
        : timeline.approvalTwoAt;
    const statusPrefix =
      pass === "revalidated" && invalidation
        ? "Fresh approval on derived decision"
        : "Approved";
    const actors = approvalEvents.map((event, index) => {
      const complete = eventBindingComplete(stage, event);
      const timestampIso = specialistReview
        ? timeline.specialistReviewedAt
        : index === 0
          ? approvalOneAt
          : approvalTwoAt;
      return complete
        ? {
            actorId: event.actorId,
            name: event.actorId!,
            roleId: event.roleId,
            role: event.roleId!,
            status: "done",
            statusLabel: `${specialistReview ? "Reviewed" : statusPrefix} · ${formatDemoInstant(timestampIso)}`,
            timestampIso,
            note: `Requester binding ${event.requesterId}.`,
            requesterExcluded:
              !stage.requesterMayApprove &&
              event.actorId === event.requesterId,
            bindingComplete: true,
          }
        : {
            actorId: null,
            name: `Approval event ${index + 1}: actor identity unavailable`,
            roleId: null,
            role: "Signed role unavailable",
            status: "pending",
            statusLabel: "Signed binding incomplete",
            note: "Signed requester identity binding unavailable.",
            bindingComplete: false,
          };
    });
    return {
      ...stage,
      title: specialistReview
        ? `Stage ${stage.order} - Bank-instruction specialist review`
        : `Stage ${stage.order} - Dual operations approval`,
      requirement: specialistReview
        ? "The changed bank instruction requires review by a banking specialist before execution."
        : "Two approvals required from distinct operations approvers. The requester cannot satisfy both approvals.",
      satisfied: stageReached,
      stepState: stageReached ? "done" : "pending",
      actors,
      ...(specialistExpired && specialistReview
        ? {
            authorityEvents: [
              {
                type: "ApprovalStageEscalated" as const,
                timestamp: timeline.escalatedAt,
                display: `Escalated to operations manager · ${formatDemoInstant(timeline.escalatedAt)}`,
              },
              {
                type: "ApprovalStageExpired" as const,
                timestamp: timeline.expiredAt,
                display: `Expired unresolved · ${formatDemoInstant(timeline.expiredAt)}`,
              },
            ],
            expired: true,
          }
        : {}),
    };
  });
}
