import {
  DEMO_TIMELINE,
  type FirmData,
} from "./data";
import {
  approvalExpiryAt,
  type ApprovalClock,
} from "./closed-choices";
import type {
  AuthorityStageRequirementVM,
  RearmedAuthorityStageVM,
  RequesterApprovalEligibility,
} from "./model";

/** The stage ids the demo mints and the golden cases sign, named once so the
 * signed-case reader and the builder cannot drift apart on a string. */
export const SPECIALIST_STAGE_ID = "bank-change-specialist-review";
export const OPERATIONS_STAGE_ID = "ops-dual-approval";

const SPECIALIST_REVIEW_ESCALATES_AFTER = "P1D";
const SPECIALIST_REVIEW_EXPIRES_AFTER = "P2D";

export const SPECIALIST_REARMED_EXPIRES_AT = approvalExpiryAt(
  DEMO_TIMELINE.specialistRearmedAt,
  SPECIALIST_REVIEW_EXPIRES_AFTER,
);

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
    stageId: SPECIALIST_STAGE_ID,
    order,
    executionMode: "sequential",
    eligibleRoleIds: ["bank-change-specialist"],
    approvalsRequired: 1,
    distinctActorsRequired: false,
    requesterMayApprove: requesterMayApprove(firm),
    expiresAt: approvalExpiryAt(
      DEMO_TIMELINE.decisionCreatedAt,
      SPECIALIST_REVIEW_EXPIRES_AFTER,
    ),
    escalationPath: [
      {
        after: SPECIALIST_REVIEW_ESCALATES_AFTER,
        eligibleRoleIds: ["operations-manager"],
        reasonCode: "specialist-review-idle",
      },
    ],
  };
}

export function rearmedSpecialistStageFor(
  decisionRequirement: AuthorityStageRequirementVM,
): RearmedAuthorityStageVM {
  const escalation = decisionRequirement.escalationPath[0];
  if (!escalation) {
    throw new Error(
      "Specialist authority requires an escalation path",
    );
  }
  return {
    instanceId: `${decisionRequirement.stageId}:rearm-1`,
    sourceStageId: decisionRequirement.stageId,
    activatedAt: DEMO_TIMELINE.specialistRearmedAt,
    eligibleRoleIds: escalation.eligibleRoleIds,
    expiresAt: SPECIALIST_REARMED_EXPIRES_AT,
    reasonCode: escalation.reasonCode,
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
    stageId: OPERATIONS_STAGE_ID,
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
