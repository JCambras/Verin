import type { ApprovalClock } from "./build-decision";
import { CAST, type FirmData } from "./data";
import type { SetupProofFirmVM } from "./setup-model";

export function evaluateAuthorityPlan(
  firm: FirmData,
  disposition: SetupProofFirmVM["disposition"],
  dualApproval: boolean,
  approvalClock: ApprovalClock,
): SetupProofFirmVM["authorityPlan"] {
  if (disposition.kind !== "proceed") {
    return {
      mode: "none",
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
        statusLabel: "Reviewed · Jul 26, 11:15",
      },
    ],
    expiry: "Expires after 2 days",
    escalation: "Escalates after 1 day to operations manager",
  } as const;
  if (!dualApproval) {
    return {
      mode: "specialist-review",
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
      statusLabel: "Approved · Jul 26, 10:02",
    },
    {
      name: CAST.opsApprover2,
      role: "Operations",
      status: "done",
      statusLabel: "Approved · Jul 26, 10:31",
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
    mode: "specialist-review",
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
