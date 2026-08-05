import type {
  ApprovalStageVM,
  AuthorityStageRequirementVM,
  AuthorityPlanVM,
  RequesterParticipation,
} from "./model";
import { DEMO_TIMELINE } from "./data";

export type DecisionAuthorityClaim =
  | {
      readonly mode: "not-reached";
      readonly reason: string;
    }
  | {
      readonly mode: "automatic";
      readonly rule: string;
      readonly thresholdMinor: number;
      readonly policySource: string;
      readonly executionMode: string;
      readonly state: string;
    }
  | {
      readonly mode: "staged";
      readonly standardApprovalRole: "operations";
      readonly requesterParticipation: RequesterParticipation;
      readonly requirements: readonly AuthorityStageRequirementVM[];
    };

export function decisionAuthorityRequirementsFor(
  stages: readonly ApprovalStageVM[],
): readonly AuthorityStageRequirementVM[] {
  return stages.map((stage) => stage.decisionRequirement);
}

function assertStageRequirement(
  stage: AuthorityStageRequirementVM,
  index: number,
): void {
  const expectedKeys = [
    "approvalsRequired",
    "distinctActorsRequired",
    "eligibleRoleIds",
    "escalationPath",
    "executionMode",
    "expiresAt",
    "order",
    "requesterMayApprove",
    "stageId",
  ];
  const actualKeys = Object.keys(stage).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, keyIndex) => key !== expectedKeys[keyIndex])
  ) {
    throw new Error(
      `Authority stage ${index + 1} has an unsupported field mixture`,
    );
  }
  if (
    stage.order !== index + 1 ||
    stage.stageId.trim().length === 0 ||
    !["sequential", "parallel"].includes(stage.executionMode) ||
    stage.eligibleRoleIds.length === 0 ||
    stage.approvalsRequired < 1 ||
    !Number.isInteger(stage.approvalsRequired) ||
    typeof stage.distinctActorsRequired !== "boolean" ||
    !(
      typeof stage.requesterMayApprove === "boolean" ||
      stage.requesterMayApprove === "unbound"
    ) ||
    !Number.isFinite(Date.parse(stage.expiresAt)) ||
    Date.parse(stage.expiresAt) <=
      Date.parse(DEMO_TIMELINE.decisionCreatedAt) ||
    stage.escalationPath.length === 0
  ) {
    throw new Error(
      `Authority stage ${index + 1} has an invalid immutable requirement`,
    );
  }
  if (
    new Set(stage.eligibleRoleIds).size !==
    stage.eligibleRoleIds.length
  ) {
    throw new Error(
      `Authority stage ${index + 1} has duplicate eligible roles`,
    );
  }
  for (const escalation of stage.escalationPath) {
    if (
      escalation.after.trim().length === 0 ||
      escalation.reasonCode.trim().length === 0 ||
      escalation.eligibleRoleIds.length === 0 ||
      new Set(escalation.eligibleRoleIds).size !==
        escalation.eligibleRoleIds.length
    ) {
      throw new Error(
        `Authority stage ${index + 1} has an invalid escalation requirement`,
      );
    }
  }
}

function assertRearmedStage(
  stage: ApprovalStageVM,
  index: number,
): void {
  const rearmed = stage.rearmedStage;
  if (!rearmed) return;
  const matchingEscalation =
    stage.decisionRequirement.escalationPath.find(
      (step) =>
        step.reasonCode === rearmed.reasonCode &&
        JSON.stringify(step.eligibleRoleIds) ===
          JSON.stringify(rearmed.eligibleRoleIds),
    );
  const originalWindow =
    Date.parse(stage.decisionRequirement.expiresAt) -
    Date.parse(DEMO_TIMELINE.decisionCreatedAt);
  const rearmedActivatedAt = Date.parse(rearmed.activatedAt);
  const expectedExpiry = Number.isFinite(rearmedActivatedAt)
    ? new Date(rearmedActivatedAt + originalWindow).toISOString()
    : null;
  if (
    stage.stepState !== "active" ||
    rearmed.instanceId.trim().length === 0 ||
    rearmed.sourceStageId !== stage.decisionRequirement.stageId ||
    rearmed.eligibleRoleIds.length === 0 ||
    new Set(rearmed.eligibleRoleIds).size !==
      rearmed.eligibleRoleIds.length ||
    !matchingEscalation ||
    !Number.isFinite(rearmedActivatedAt) ||
    rearmed.expiresAt !== expectedExpiry ||
    rearmedActivatedAt <
      Date.parse(stage.decisionRequirement.expiresAt) ||
    Date.parse(rearmed.expiresAt) <= rearmedActivatedAt
  ) {
    throw new Error(
      `Authority stage ${index + 1} has an invalid re-armed instance`,
    );
  }
}

export function assertAuthorityPlan(plan: AuthorityPlanVM): void {
  const mode: unknown = plan.mode;
  if (
    mode !== "not-reached" &&
    mode !== "automatic" &&
    mode !== "staged"
  ) {
    throw new Error(`Unsupported authority mode: ${String(mode)}`);
  }
  const expectedKeys =
    plan.mode === "not-reached"
      ? ["detail", "mode", "summary"]
      : plan.mode === "automatic"
        ? [
            "detail",
            "executionMode",
            "mode",
            "policySource",
            "rule",
            "state",
            "summary",
            "threshold",
          ]
        : [
            "detail",
            "mode",
            "requesterParticipation",
            "stages",
            "standardApprovalRole",
            "summary",
          ];
  const actualKeys = Object.keys(plan).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(
      `Unsupported authority field mixture for mode ${plan.mode}`,
    );
  }
  if (
    plan.mode === "automatic" &&
    (typeof plan.threshold.value !== "number" ||
      !Number.isFinite(plan.threshold.value))
  ) {
    throw new Error("Automatic authority requires one finite threshold");
  }
  if (plan.mode === "staged" && plan.stages.length === 0) {
    throw new Error("Staged authority requires at least one stage");
  }
  if (plan.mode !== "staged") return;
  plan.stages.forEach((stage, index) => {
    assertStageRequirement(stage.decisionRequirement, index);
    assertRearmedStage(stage, index);
  });
  if (plan.standardApprovalRole !== "operations") {
    throw new Error(
      "Staged authority requires the Operations standard approval role",
    );
  }
  const requesterActors = plan.stages
    .flatMap((stage) => stage.actors)
    .filter((actor) => actor.requesterExcluded === true);
  if (
    plan.requesterParticipation.mode === "unbound" &&
    requesterActors.length > 0
  ) {
    throw new Error(
      "Unbound requester participation cannot carry requester exclusions",
    );
  }
  if (
    plan.requesterParticipation.mode === "unbound" &&
    plan.stages.some(
      (stage) =>
        stage.decisionRequirement.requesterMayApprove !==
        "unbound",
    )
  ) {
    throw new Error(
      "Unbound requester participation requires unbound stage eligibility",
    );
  }
  if (
    plan.requesterParticipation.mode === "excluded" &&
    requesterActors.length === 0
  ) {
    throw new Error(
      "Excluded requester participation requires an attributed requester exclusion",
    );
  }
  if (
    plan.requesterParticipation.mode === "excluded" &&
    plan.stages.some(
      (stage) =>
        stage.decisionRequirement.requesterMayApprove !==
        false,
    )
  ) {
    throw new Error(
      "Excluded requester participation requires ineligible requester stages",
    );
  }
}

export function decisionAuthorityClaimFor(
  plan: AuthorityPlanVM,
): DecisionAuthorityClaim {
  assertAuthorityPlan(plan);
  switch (plan.mode) {
    case "not-reached":
      return { mode: plan.mode, reason: plan.detail };
    case "automatic":
      return {
        mode: plan.mode,
        rule: plan.rule,
        thresholdMinor: Number(plan.threshold.value),
        policySource: plan.policySource,
        executionMode: plan.executionMode,
        state: plan.state,
      };
    case "staged":
      return {
        mode: plan.mode,
        standardApprovalRole: plan.standardApprovalRole,
        requesterParticipation: plan.requesterParticipation,
        requirements: decisionAuthorityRequirementsFor(plan.stages),
      };
  }
}
