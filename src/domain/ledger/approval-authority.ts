import type { ApprovalStage } from "@contracts/decision-core/authority";
import type { LedgerEntry } from "@contracts/decision-core/ledger";

export type ApprovalEscalationEvent = Extract<
  LedgerEntry,
  { type: "ApprovalStageEscalated" }
>;

export interface EffectiveApprovalStageAuthority {
  readonly eligibleRoleIds: readonly string[];
  readonly expiresAt: string;
}

export function initialApprovalStageAuthority(
  stage: ApprovalStage,
): EffectiveApprovalStageAuthority {
  return {
    eligibleRoleIds: [...new Set(
      stage.requirements.flatMap((requirement) =>
        requirement.eligibleRoleIds.map((role) => role.id)),
    )].sort(),
    expiresAt: stage.expiresAt,
  };
}

export function applyApprovalStageEscalation(
  current: EffectiveApprovalStageAuthority,
  event: ApprovalEscalationEvent,
): EffectiveApprovalStageAuthority {
  const escalatedRoles = event.roleIds.map((role) => role.id);
  return {
    eligibleRoleIds: event.mode === "replace"
      ? [...escalatedRoles].sort()
      : [...new Set([...current.eligibleRoleIds, ...escalatedRoles])].sort(),
    expiresAt: event.newExpiresAt,
  };
}

export function effectiveApprovalStageAuthority(
  stage: ApprovalStage,
  events: readonly ApprovalEscalationEvent[],
): EffectiveApprovalStageAuthority {
  return events.reduce(
    (current, event) => applyApprovalStageEscalation(current, event),
    initialApprovalStageAuthority(stage),
  );
}
