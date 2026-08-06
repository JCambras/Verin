/**
 * What a captain-signed case BINDS, projected into the demonstration's own
 * vocabulary, plus the ONE normalized shape both sides of a signed-impact
 * comparison speak.
 *
 * Everything here is READ from the fixture and nothing is assumed: a closed choice
 * the case does not state yields null, and a whole selection with any null yields
 * null, so a partially attributed configuration can never be mistaken for the
 * signed one. Filling a gap with a house default would be inventing attribution.
 */
import {
  APPROVAL_CLOCKS,
  BANK_HANDLING,
  FRESHNESS_DAYS,
  RESERVE_MONTHS,
  THRESHOLD_MINOR,
  approvalDurationMs,
} from "./closed-choices";
import { DEMO_TIMELINE } from "./data";
import type { AuthorityPlanVM, RequesterParticipation } from "./model";
import { OPERATIONS_STAGE_ID } from "./authority-stage-requirements";
import type {
  SetupFirmId,
  SetupPolicyGroupId,
  SetupSelections,
} from "./setup-model";
import {
  signedCaseMaterialEvidence,
  signedCaseRequestMinor,
  type SignedSetupCase,
} from "./setup-signed-cases";

// ── What the signed case BINDS about the closed configuration ───────────────────────
/** The freshness window a signed case states in its own prose, or null when it
 * states none. Parsed, never assumed: a window nobody signed is not attribution. */
export function signedCaseFreshnessDays(
  caseFile: SignedSetupCase,
): number | null {
  for (const datum of caseFile.householdEvidence) {
    const match = datum.summary.match(
      /(\d+)-day freshness window/i,
    );
    if (match) return Number(match[1]);
  }
  return null;
}

/** The normal-approval clock a signed case binds through its operations stage, or
 * null when it defines no such stage (automatic and blocked cases bind no clock). */
export function signedCaseApprovalClockId(
  caseFile: SignedSetupCase,
): string | null {
  const stage = caseFile.expectedAuthority.stages.find(
    (candidate) => candidate.stageId === OPERATIONS_STAGE_ID,
  );
  const escalation = stage?.escalationPath[0];
  if (!stage || !escalation) return null;
  return (
    Object.values(APPROVAL_CLOCKS).find(
      (clock) =>
        clock.expiresAfter === stage.expiresAfter &&
        clock.escalationAfter === escalation.after,
    )?.id ?? null
  );
}

function optionIdOf<T>(
  table: Readonly<Record<string, T>>,
  value: T | null,
): string | null {
  if (value === null) return null;
  return (
    Object.entries(table).find(
      ([, candidate]) => candidate === value,
    )?.[0] ?? null
  );
}

/**
 * The closed configuration the signed case itself states, expressed as the demo's
 * option ids. A group the case does not bind yields null and the WHOLE selection
 * yields null: a partially attributed configuration is not the signed one, and
 * filling the gap with a house default would invent attribution.
 */
export function signedCaseSelections(
  caseFile: SignedSetupCase,
): SetupSelections[SetupFirmId] | null {
  const configuration = caseFile.firmConfiguration;
  const resolved: Record<SetupPolicyGroupId, string | null> = {
    reserve: optionIdOf(
      RESERVE_MONTHS,
      configuration.cashReserveMonths,
    ),
    freshness: optionIdOf(
      FRESHNESS_DAYS,
      signedCaseFreshnessDays(caseFile),
    ),
    "bank-change": optionIdOf(
      BANK_HANDLING,
      configuration.bankInstructionChangeHandling,
    ),
    threshold: optionIdOf(
      THRESHOLD_MINOR,
      configuration.dualApprovalThresholdUsd * 100,
    ),
    expiry: signedCaseApprovalClockId(caseFile),
  };
  const entries = Object.entries(resolved);
  if (entries.some(([, optionId]) => optionId === null)) return null;
  return Object.fromEntries(entries) as SetupSelections[SetupFirmId];
}

/** The material inputs NEITHER side binds, computed once from the signed case and
 * carried by both, so the two hashes agree on what is unbound instead of one side
 * silently binding a value the captain never saw. */
export function signedCaseMaterialGaps(
  caseFile: SignedSetupCase,
): readonly string[] {
  const inputs = signedCaseMaterialEvidence(caseFile).evaluatorInputs;
  return [
    // The demonstration runs no versioned domain configuration.
    "resolvedConfiguration.policyVersions.domainConfigVersionId",
    // A signed case carries a masked summary, never the advisor's free text.
    "request.text",
    "request.purpose",
    "request.deadline",
    ...(signedCaseFreshnessDays(caseFile) === null
      ? ["resolvedConfiguration.freshnessDays"]
      : []),
    ...(signedCaseApprovalClockId(caseFile) === null
      ? ["resolvedConfiguration.approvalClockId"]
      : []),
    ...Object.entries(inputs)
      .filter(([, value]) => value === null)
      .map(([key]) => `evidence.${key}`),
  ].sort();
}

export function signedCaseRequesterParticipation(
  caseFile: SignedSetupCase,
): RequesterParticipation {
  return caseFile.firmConfiguration.requesterConstraint === null
    ? { mode: "unbound" }
    : {
        mode: "excluded",
        constraint: caseFile.firmConfiguration.requesterConstraint,
      };
}

// ── The ONE normalized shape both sides of the attribution comparison speak ─────────
export interface NormalizedAuthorityStage {
  readonly stageId: string;
  readonly order: number;
  readonly executionMode: string;
  readonly eligibleRoleIds: readonly string[];
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly requesterMayApprove: boolean | "unbound";
  readonly expiresAfterMs: number | null;
  readonly escalationPath: readonly {
    readonly afterMs: number | null;
    readonly eligibleRoleIds: readonly string[];
    readonly reasonCode: string;
  }[];
}

export interface NormalizedAuthorityMaterial {
  readonly mode: "not-reached" | "automatic" | "staged";
  readonly standardApprovalRole: "operations" | null;
  readonly requesterParticipation: RequesterParticipation;
  readonly stages: readonly NormalizedAuthorityStage[];
}

export interface NormalizedResolvedConfiguration {
  readonly policyVersions: {
    readonly firmPolicyVersionId: string;
    readonly householdInstructionVersionIds: readonly string[];
    readonly regulatoryVersionId: string | null;
  };
  readonly reserveMonths: number;
  readonly freshnessDays: number | null;
  readonly bankChangeHandling: string;
  readonly dualApprovalThresholdMinor: number;
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly requesterParticipation: RequesterParticipation;
  readonly approvalClockId: string | null;
}

/** Durations reach the comparison as milliseconds so a signed case's "P3D" and the
 * demo's absolute expiry are the same fact, not two vocabularies. */
function durationMs(value: string): number | null {
  try {
    return approvalDurationMs(value);
  } catch {
    return null;
  }
}

export function signedCaseAuthorityMaterial(
  caseFile: SignedSetupCase,
): NormalizedAuthorityMaterial {
  const expected = caseFile.expectedAuthority;
  const mode =
    expected.mode === "none"
      ? "not-reached"
      : expected.mode === "automatic"
        ? "automatic"
        : "staged";
  return {
    mode,
    standardApprovalRole:
      mode === "staged"
        ? caseFile.firmConfiguration.eligibleRole
        : null,
    requesterParticipation:
      signedCaseRequesterParticipation(caseFile),
    stages: expected.stages.map((stage) => ({
      stageId: stage.stageId,
      order: stage.order,
      executionMode: stage.executionMode,
      eligibleRoleIds: [...stage.eligibleRoleIds],
      approvalsRequired: stage.approvalsRequired,
      distinctActorsRequired: stage.distinctActorsRequired,
      requesterMayApprove: stage.requesterMayApprove,
      expiresAfterMs: durationMs(stage.expiresAfter),
      escalationPath: stage.escalationPath.map((step) => ({
        afterMs: durationMs(step.after),
        eligibleRoleIds: [...step.roleIds],
        reasonCode: step.reasonCode,
      })),
    })),
  };
}

/** The same normalization applied to what the demo actually evaluated. */
export function authorityPlanMaterial(
  plan: AuthorityPlanVM,
  requesterParticipation: RequesterParticipation,
): NormalizedAuthorityMaterial {
  if (plan.mode !== "staged") {
    return {
      mode: plan.mode,
      standardApprovalRole: null,
      requesterParticipation,
      stages: [],
    };
  }
  const createdAt = Date.parse(DEMO_TIMELINE.decisionCreatedAt);
  return {
    mode: "staged",
    standardApprovalRole: plan.standardApprovalRole,
    requesterParticipation: plan.requesterParticipation,
    stages: plan.stages.map(({ decisionRequirement: stage }) => ({
      stageId: stage.stageId,
      order: stage.order,
      executionMode: stage.executionMode,
      eligibleRoleIds: [...stage.eligibleRoleIds],
      approvalsRequired: stage.approvalsRequired,
      distinctActorsRequired: stage.distinctActorsRequired,
      requesterMayApprove: stage.requesterMayApprove,
      expiresAfterMs: Date.parse(stage.expiresAt) - createdAt,
      escalationPath: stage.escalationPath.map((step) => ({
        afterMs: durationMs(step.after),
        eligibleRoleIds: [...step.eligibleRoleIds],
        reasonCode: step.reasonCode,
      })),
    })),
  };
}

export function signedCaseResolvedConfiguration(
  caseFile: SignedSetupCase,
): NormalizedResolvedConfiguration {
  const configuration = caseFile.firmConfiguration;
  return {
    policyVersions: {
      firmPolicyVersionId:
        caseFile.policyVersions.firmPolicyVersionId,
      householdInstructionVersionIds: [
        ...caseFile.policyVersions.householdInstructionVersionIds,
      ],
      regulatoryVersionId:
        caseFile.policyVersions.regulatoryVersionId,
    },
    reserveMonths: configuration.cashReserveMonths,
    freshnessDays: signedCaseFreshnessDays(caseFile),
    bankChangeHandling:
      configuration.bankInstructionChangeHandling,
    dualApprovalThresholdMinor:
      configuration.dualApprovalThresholdUsd * 100,
    approvalsRequired: configuration.approvalsRequired,
    distinctActorsRequired:
      configuration.distinctActorsRequired,
    requesterParticipation:
      signedCaseRequesterParticipation(caseFile),
    approvalClockId: signedCaseApprovalClockId(caseFile),
  };
}

export function signedCaseRequestMaterial(
  caseFile: SignedSetupCase,
) {
  return {
    trigger: caseFile.trigger,
    amountMinor: signedCaseRequestMinor(caseFile),
  };
}
