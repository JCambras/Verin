import type { ApprovalStageVM } from "./model";
import { formatDemoInstant, timelineFor } from "./timeline";
import {
  CANONICAL_REQUEST,
  CAST,
  hasSignedInvalidationAuthority,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";

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
        actor.status === "done" &&
        stage.eligibleRoleIds.includes(actor.roleId) &&
        (stage.requesterMayApprove || !actor.requesterExcluded),
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
    const approvalCount = sourceCase
      ? sourceCase.ledgerEvents.filter(
          (event) =>
            event.type === "ApprovalRecorded" &&
            event.stageId === stage.stageId &&
            event.lifecyclePass === pass,
        ).length
      : stage.approvalsRequired;
    const stageReached =
      !specialistExpired &&
      approvalCount >= stage.approvalsRequired;
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
    const actors = specialistReview
      ? specialistExpired
        ? [
            {
              actorId: "actor-alex-kim",
              name: CAST.specialist,
              roleId: "bank-change-specialist",
              role: "Banking specialist",
              status: "expired",
              statusLabel: "Escalated, then expired",
            },
            {
              actorId: "actor-jordan-bell",
              name: CAST.principal,
              roleId: "operations-manager",
              role: "Operations manager (escalation)",
              status: "expired",
              statusLabel: "Expired unresolved",
            },
          ]
        : approvalCount >= stage.approvalsRequired
          ? [
              {
                actorId: "actor-alex-kim",
                name: CAST.specialist,
                roleId: "bank-change-specialist",
                role: "Banking specialist",
                status: "done",
                statusLabel: `Reviewed · ${formatDemoInstant(timeline.specialistReviewedAt)}`,
                timestampIso: timeline.specialistReviewedAt,
              },
            ]
          : [
              {
                actorId: "actor-alex-kim",
                name: CAST.specialist,
                roleId: "bank-change-specialist",
                role: "Banking specialist",
                status: "pending",
                statusLabel: "Awaiting review",
              },
            ]
      : [
          {
            actorId: "actor-miguel-torres",
            name: CAST.opsApprover1,
            roleId: "operations",
            role: "Operations",
            status:
              !specialistExpired && approvalCount >= 1
                ? "done"
                : "pending",
            statusLabel:
              !specialistExpired && approvalCount >= 1
                ? `${statusPrefix} · ${formatDemoInstant(approvalOneAt)}`
                : "Awaiting prior stage",
            ...(!specialistExpired && approvalCount >= 1
              ? { timestampIso: approvalOneAt }
              : {}),
          },
          {
            actorId: "actor-priya-nair",
            name: CAST.opsApprover2,
            roleId: "operations",
            role: "Operations",
            status:
              !specialistExpired && approvalCount >= 2
                ? "done"
                : "pending",
            statusLabel:
              !specialistExpired && approvalCount >= 2
                ? `${statusPrefix} · ${formatDemoInstant(approvalTwoAt)}`
                : "Awaiting prior stage",
            ...(!specialistExpired && approvalCount >= 2
              ? { timestampIso: approvalTwoAt }
              : {}),
          },
          {
            actorId: "actor-dana-ellison",
            name: CAST.requester,
            roleId: "advisor",
            role: "Advisor (requester)",
            status: "pending",
            statusLabel: "Cannot approve",
            note: "Requested this movement - the requester cannot approve.",
            requesterExcluded: true,
          },
        ];
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
