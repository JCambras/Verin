import {
  CAST,
  DEMO_TIMELINE,
  demoTimestampLabel,
  type ApprovalClock,
  type FirmData,
} from "./data";
import type { SetupProofFirmVM } from "./setup-model";

export function evaluateAuthorityPlan(
  firm: FirmData,
  disposition: SetupProofFirmVM["disposition"],
  dualApproval: boolean,
  approvalClock: ApprovalClock,
): SetupProofFirmVM["authorityPlan"] {
  if (disposition.kind !== "proceed") {
    return {
      reached: false,
      summary: "Independent bank verification is required before authority exists",
      detail: "No approval can substitute for the missing evidence.",
      stages: [],
    };
  }
  const specialistStage = {
    title: "Stage 1 - Bank-instruction specialist review",
    requirement:
      "The changed bank instruction requires review by a banking specialist before execution.",
    stepState: "done",
    actors: [
      {
        name: CAST.specialist,
        role: "Banking specialist",
        status: "done",
        statusLabel: `Reviewed · ${demoTimestampLabel(DEMO_TIMELINE.specialistReviewedAt)}`,
      },
    ],
    expiry: "Expires after 2 days",
    escalation: "Escalates after 1 day to operations manager",
  } as const;
  if (!dualApproval) {
    return {
      reached: true,
      summary: "Specialist review; no dual approval at this amount",
      detail: "The evaluator creates no standard approval below the configured threshold.",
      stages: [specialistStage],
    };
  }
  const operationsActors = [
    {
      name: CAST.opsApprover1,
      role: "Operations",
      status: "done",
      statusLabel: `Approved · ${demoTimestampLabel(DEMO_TIMELINE.operationsApproval1At)}`,
    },
    {
      name: CAST.opsApprover2,
      role: "Operations",
      status: "done",
      statusLabel: `Approved · ${demoTimestampLabel(DEMO_TIMELINE.operationsApproval2At)}`,
    },
    ...(firm.requesterConstraint === null
      ? []
      : [
          {
            name: CAST.requester,
            role: "Advisor (requester)",
            status: "pending",
            statusLabel: "Cannot approve",
            note: "Requested this movement - the requester cannot approve.",
            requesterExcluded: true,
          },
        ]),
  ];
  return {
    reached: true,
    summary: "Specialist review, then two distinct operations approvers",
    detail: `${approvalClock.escalation}. ${approvalClock.expiry}.`,
    stages: [
      specialistStage,
      {
        title: "Stage 2 - Dual operations approval",
        requirement:
          firm.requesterConstraint === null
            ? "Two approvals required from distinct operations approvers. Requester participation remains unbound in this demonstration."
            : "Two approvals required from distinct operations approvers. The requester cannot approve.",
        stepState: "done",
        actors: operationsActors,
        expiry: approvalClock.expiry,
        escalation: approvalClock.escalation,
      },
    ],
  };
}
