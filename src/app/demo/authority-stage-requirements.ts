import {
  DEMO_TIMELINE,
  approvalExpiryAt,
  type ApprovalClock,
  type FirmData,
} from "./data";
import type {
  AuthorityStageRequirementVM,
  RequesterApprovalEligibility,
} from "./model";

function requesterMayApprove(
  firm: FirmData,
): RequesterApprovalEligibility {
  return firm.requesterParticipation.mode === "unbound"
    ? "unbound"
    : false;
}

export function specialistStageRequirementFor(
  firm: FirmData,
  order: number,
): AuthorityStageRequirementVM {
  return {
    stageId: "bank-change-specialist-review",
    order,
    executionMode: "sequential",
    eligibleRoleIds: ["bank-change-specialist"],
    approvalsRequired: 1,
    distinctActorsRequired: false,
    requesterMayApprove: requesterMayApprove(firm),
    expiresAt: approvalExpiryAt(
      DEMO_TIMELINE.decisionCreatedAt,
      "P2D",
    ),
    escalationPath: [
      {
        after: "P1D",
        eligibleRoleIds: ["operations-manager"],
        reasonCode: "specialist-review-idle",
      },
    ],
  };
}

export function operationsStageRequirementFor(
  firm: FirmData,
  approvalClock: ApprovalClock,
  order: number,
): AuthorityStageRequirementVM {
  if (firm.standardApprovalRole !== "operations") {
    throw new Error(
      "Operations authority requires the Operations eligible role",
    );
  }
  return {
    stageId: "ops-dual-approval",
    order,
    executionMode: "parallel",
    eligibleRoleIds: [firm.standardApprovalRole],
    approvalsRequired: firm.approvalsRequired,
    distinctActorsRequired: firm.distinctActorsRequired,
    requesterMayApprove: requesterMayApprove(firm),
    expiresAt: approvalExpiryAt(
      DEMO_TIMELINE.decisionCreatedAt,
      approvalClock.expiresAfter,
    ),
    escalationPath: [
      {
        after: approvalClock.escalationAfter,
        eligibleRoleIds: ["operations-manager"],
        reasonCode: "approval-stage-idle",
      },
    ],
  };
}
