import type {
  ApprovalStageVM,
  AuthorityPlanVM,
} from "./model";
import { prov } from "./provenance";
import {
  CANONICAL_REQUEST,
  CAST,
  DEFAULT_APPROVAL_CLOCK,
  DEMO_TIMELINE,
  OBSERVED_RECENT,
  demoTimestampLabel,
  dispositionFor,
  type FirmData,
  type ScenarioData,
} from "./data";
import {
  automaticAuthorityPlan,
  unreachedAuthorityPlan,
} from "./setup-authority";
import {
  operationsStageRequirementFor,
  specialistStageRequirementFor,
} from "./authority-stage-requirements";

function buildStages(
  scenario: ScenarioData,
  firm: FirmData,
  phase: "gate" | "final",
): ApprovalStageVM[] {
  const approvalClock = DEFAULT_APPROVAL_CLOCK;
  const spec = scenario.spec;
  const stages: ApprovalStageVM[] = [];
  const dualApproval =
    CANONICAL_REQUEST.amountMinor >
    firm.dualApprovalThresholdMinor;
  const hasSpecialist =
    spec.bankChanged &&
    firm.bankChangeHandling === "specialist-review";
  const specialistComplete =
    !hasSpecialist ||
    (phase === "final" && !spec.specialistExpired);
  if (hasSpecialist) {
    const authorityRequirement =
      specialistStageRequirementFor(firm, 1);
    stages.push(
      spec.specialistExpired
        ? {
            authorityRequirement,
            title:
              "Stage 1 - Bank-instruction specialist review",
            requirement:
              "The changed bank instruction requires review by a banking specialist before execution.",
            stepState: "active",
            actors: [
              {
                name: CAST.specialist,
                role: "Banking specialist",
                status: "expired",
                statusLabel: `Expired · ${demoTimestampLabel(DEMO_TIMELINE.specialistExpiredAt)}`,
              },
              {
                name: CAST.operationsManager,
                role: "Operations manager (escalation)",
                status: "pending",
                statusLabel: "Awaiting review",
              },
            ],
            expiry: `Expired ${demoTimestampLabel(DEMO_TIMELINE.specialistExpiredAt)}`,
            escalation:
              "Escalates to: operations manager",
          }
        : {
            authorityRequirement,
            title:
              "Stage 1 - Bank-instruction specialist review",
            requirement:
              "The changed bank instruction requires review by a banking specialist before execution.",
            stepState:
              phase === "final" ? "done" : "active",
            actors: [
              phase === "final"
                ? {
                    name: CAST.specialist,
                    role: "Banking specialist",
                    status: "done",
                    statusLabel: `Reviewed · ${demoTimestampLabel(DEMO_TIMELINE.specialistReviewedAt)}`,
                  }
                : {
                    name: CAST.specialist,
                    role: "Banking specialist",
                    status: "pending",
                    statusLabel: "Awaiting review",
                  },
            ],
            expiry: "Expires after 2 days",
            escalation:
              "Escalates after 1 day to operations manager",
          },
    );
  }
  const operationsStage = stages.length + 1;
  if (dualApproval) {
    const second =
      phase === "final" &&
      specialistComplete &&
      !spec.invalidation
        ? {
            name: CAST.opsApprover2,
            role: "Operations",
            status: "done",
            statusLabel: `Approved · ${demoTimestampLabel(DEMO_TIMELINE.operationsApproval2At)}`,
          }
        : {
            name: CAST.opsApprover2,
            role: "Operations",
            status: "pending",
            statusLabel: "Awaiting approval",
          };
    stages.push({
      authorityRequirement: operationsStageRequirementFor(
        firm,
        approvalClock,
        operationsStage,
      ),
      title: `Stage ${operationsStage} - Dual operations approval`,
      requirement:
        firm.requesterParticipation.mode === "unbound"
          ? "Two approvals required from distinct operations approvers. Requester participation remains unbound in this demonstration."
          : "Two approvals required from distinct operations approvers. The requester cannot approve.",
      stepState:
        phase === "final" &&
        specialistComplete &&
        !spec.invalidation
          ? "done"
          : !specialistComplete
            ? "pending"
            : "active",
      actors: [
        {
          name: CAST.opsApprover1,
          role: "Operations",
          status:
            spec.invalidation && phase === "final"
              ? "voided"
              : specialistComplete &&
                  (phase === "final" || !hasSpecialist)
                ? "done"
                : "pending",
          statusLabel:
            spec.invalidation && phase === "final"
              ? "Approval voided - evidence changed"
              : specialistComplete &&
                  (phase === "final" || !hasSpecialist)
                ? `Approved · ${demoTimestampLabel(DEMO_TIMELINE.operationsApproval1At)}`
                : "Awaiting approval",
        },
        second,
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
      ],
      expiry: approvalClock.expiry,
      escalation: approvalClock.escalation,
    });
  }
  return stages;
}

export function buildAuthorityPlan(
  scenario: ScenarioData,
  firm: FirmData,
  phase: "gate" | "final",
): AuthorityPlanVM {
  const disposition = dispositionFor(scenario, firm.id);
  if (disposition !== "proceed") {
    return unreachedAuthorityPlan(
      disposition === "prohibited"
        ? "The binding prohibition ended the journey before authority."
        : "The named conditions must be resolved before authority can be requested.",
    );
  }
  const stages = buildStages(scenario, firm, phase);
  if (stages.length === 0) {
    return automaticAuthorityPlan(
      firm,
      prov("synthetic-fixture", OBSERVED_RECENT),
    );
  }
  if (firm.standardApprovalRole !== "operations") {
    throw new Error(
      "Staged authority requires the Operations eligible role",
    );
  }
  const hasSpecialist =
    scenario.spec.bankChanged &&
    firm.bankChangeHandling === "specialist-review";
  return {
    mode: "staged",
    summary: hasSpecialist
      ? CANONICAL_REQUEST.amountMinor >
        firm.dualApprovalThresholdMinor
        ? "Specialist review, then two distinct operations approvers"
        : "Specialist review; no dual approval at this amount"
      : "Two distinct operations approvers",
    detail: `${DEFAULT_APPROVAL_CLOCK.escalation}. ${DEFAULT_APPROVAL_CLOCK.expiry}.`,
    standardApprovalRole: firm.standardApprovalRole,
    requesterParticipation: firm.requesterParticipation,
    stages: [stages[0]!, ...stages.slice(1)],
  };
}
