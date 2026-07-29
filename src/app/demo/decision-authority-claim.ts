import type {
  ApprovalStageVM,
  AuthorityPlanVM,
  RequesterParticipation,
} from "./model";

interface DecisionAuthorityRequirementClaim {
  readonly order: number;
  readonly title: string;
  readonly requirement: string;
  readonly expiry: string | null;
  readonly escalation: string | null;
}

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
      readonly eligibleRole: "operations";
      readonly requesterParticipation: RequesterParticipation;
      readonly requirements: readonly DecisionAuthorityRequirementClaim[];
    };

export function decisionAuthorityRequirementsFor(
  stages: readonly ApprovalStageVM[],
): readonly DecisionAuthorityRequirementClaim[] {
  return stages.map((stage, index) => ({
    order: index + 1,
    title: stage.title,
    requirement: stage.requirement,
    expiry: stage.expiry ?? null,
    escalation: stage.escalation ?? null,
  }));
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
            "eligibleRole",
            "mode",
            "requesterParticipation",
            "stages",
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
  if (plan.eligibleRole !== "operations") {
    throw new Error(
      "Staged authority requires the Operations eligible role",
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
    plan.requesterParticipation.mode === "excluded" &&
    requesterActors.length === 0
  ) {
    throw new Error(
      "Excluded requester participation requires an attributed requester exclusion",
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
        eligibleRole: plan.eligibleRole,
        requesterParticipation: plan.requesterParticipation,
        requirements: decisionAuthorityRequirementsFor(plan.stages),
      };
  }
}
