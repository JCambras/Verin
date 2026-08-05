import { metric } from "@contracts/metric";
import type { RecordProvenance } from "@contracts/provenance";
import {
  CANONICAL_REQUEST,
  CAST,
  DEMO_TIMELINE,
  demoTimestampLabel,
  type ApprovalClock,
  type FirmData,
} from "./data";
import type {
  ApprovalStageVM,
  AuthorityPlanVM,
  AutomaticAuthorityVM,
  UnreachedAuthorityVM,
} from "./model";
import type { SetupPolicyEvaluation } from "./setup-policy";
import {
  armedStageInstanceFor,
  operationsStageRequirementFor,
  specialistStageRequirementFor,
} from "./authority-stage-requirements";

export function unreachedAuthorityPlan(
  detail: string,
): UnreachedAuthorityVM {
  return {
    mode: "not-reached",
    summary: "Authority not reached",
    detail,
  };
}

export function automaticAuthorityPlan(
  firm: FirmData,
  thresholdProvenance: RecordProvenance,
): AutomaticAuthorityVM {
  if (firm.standardApprovalRole !== null) {
    throw new Error(
      "Automatic authority cannot carry a standard approval role",
    );
  }
  const amount = `$${(
    CANONICAL_REQUEST.amountMinor / 100
  ).toLocaleString("en-US")}`;
  const threshold = `$${(
    firm.dualApprovalThresholdMinor / 100
  ).toLocaleString("en-US")}`;
  const relation =
    CANONICAL_REQUEST.amountMinor < firm.dualApprovalThresholdMinor
      ? "below"
      : "at";
  return {
    mode: "automatic",
    summary: "Automatic authority",
    detail:
      "No specialist-review or dual-approval stage applies to this request.",
    rule: `${amount} is ${relation} ${firm.name}'s ${threshold} dual-approval threshold, so no approval stage applies.`,
    threshold: metric(
      firm.dualApprovalThresholdMinor,
      "currency-minor",
      thresholdProvenance,
    ),
    policySource: `${firm.policyVersion} §4`,
    executionMode: "Automatic - no human approval action",
    state: "Authority resolved automatically",
  };
}

export function evaluateAuthorityPlan(
  firm: FirmData,
  evaluation: SetupPolicyEvaluation,
  approvalClock: ApprovalClock,
  thresholdProvenance: RecordProvenance,
): AuthorityPlanVM {
  if (
    firm.standardApprovalRole !==
      evaluation.authority.standardApprovalRole ||
    JSON.stringify(firm.requesterParticipation) !==
      JSON.stringify(evaluation.requesterParticipation)
  ) {
    throw new Error(
      "Runtime firm authority fields do not match the evaluator result",
    );
  }
  if (evaluation.authority.mode === "not-reached") {
    return unreachedAuthorityPlan(
      "Independent bank verification is required before authority exists. No approval can substitute for the missing evidence.",
    );
  }
  if (evaluation.authority.mode === "automatic") {
    return automaticAuthorityPlan(firm, thresholdProvenance);
  }
  if (firm.standardApprovalRole !== "operations") {
    throw new Error(
      "Staged authority requires the Operations standard approval role",
    );
  }
  const requiresSpecialist = evaluation.requiresSpecialist;
  const dualApproval = evaluation.dualApproval;
  const specialistRequirement = specialistStageRequirementFor(
    firm,
    1,
  );
  const specialistStage = {
    decisionRequirement: specialistRequirement,
    stageInstance: armedStageInstanceFor(
      specialistRequirement,
      DEMO_TIMELINE.decisionCreatedAt,
    ),
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
      mode: "staged",
      summary: "Specialist review; no dual approval at this amount",
      detail: "The evaluator creates no standard approval below the configured threshold.",
      standardApprovalRole: firm.standardApprovalRole,
      requesterParticipation: firm.requesterParticipation,
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
    ...(firm.requesterParticipation.mode === "unbound"
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
  const operationsRequirement = operationsStageRequirementFor(
    firm,
    approvalClock,
    requiresSpecialist ? 2 : 1,
  );
  const operationsInstance = armedStageInstanceFor(
    operationsRequirement,
    requiresSpecialist
      ? DEMO_TIMELINE.specialistReviewedAt
      : DEMO_TIMELINE.decisionCreatedAt,
  );
  const operationsStage: ApprovalStageVM = {
    decisionRequirement: operationsRequirement,
    stageInstance: operationsInstance,
    title: `Stage ${requiresSpecialist ? 2 : 1} - Dual operations approval`,
    requirement:
      firm.requesterParticipation.mode === "unbound"
        ? "Two approvals required from distinct operations approvers. Requester participation remains unbound in this demonstration."
        : "Two approvals required from distinct operations approvers. The requester cannot approve.",
    stepState: "done",
    actors: operationsActors,
    expiry: approvalClock.expiry,
    escalation: approvalClock.escalation,
  };
  const stages: [ApprovalStageVM, ...ApprovalStageVM[]] =
    requiresSpecialist
      ? [specialistStage, operationsStage]
      : [operationsStage];
  return {
    mode: "staged",
    summary: requiresSpecialist
      ? "Specialist review, then two distinct operations approvers"
      : "Two distinct operations approvers",
    detail: `${approvalClock.escalation}. ${approvalClock.expiry}.`,
    standardApprovalRole: firm.standardApprovalRole,
    requesterParticipation: firm.requesterParticipation,
    stages,
  };
}
