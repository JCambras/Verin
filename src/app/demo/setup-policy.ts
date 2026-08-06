import { projectReserve } from "@domain/money-movement/reserve-projection";
import {
  DEMO_TIMELINE,
  FIRMS,
  SMITHS_LIQUIDITY,
  type FirmData,
  type SignedLiquidityCase,
} from "./data";
import {
  APPROVAL_CLOCKS,
  BANK_CHANGE_RECENCY_DAYS,
  BANK_HANDLING,
  FRESHNESS_DAYS,
  RESERVE_MONTHS,
  THRESHOLD_MINOR,
  closedChoiceValue,
  type ApprovalClock,
} from "./closed-choices";
import type { RequesterParticipation } from "./model";
import type {
  SetupFirmId,
  SetupSelections,
} from "./setup-model";

export const SETUP_REQUESTER_PARTICIPATION = Object.freeze({
  mode: "unbound",
} as const);

export type SetupAuthorityResolution =
  | {
      readonly mode: "not-reached";
      readonly standardApprovalRole: null;
    }
  | {
      readonly mode: "automatic";
      readonly standardApprovalRole: null;
    }
  | {
      readonly mode: "staged";
      readonly standardApprovalRole: "operations";
    };

export interface SetupPolicyEvaluation {
  /** The request this evaluation was actually run against. Every sentence a caller
   * prints about the amount reads THIS, never a module constant: a rule printed from
   * a different request than the one evaluated is a rule the evaluator never applied. */
  readonly requestMinor: number;
  readonly reserveMonths: number;
  readonly freshnessDays: number;
  readonly bankChangeHandling: FirmData["bankChangeHandling"];
  readonly dualApprovalThresholdMinor: number;
  readonly reserveSatisfied: boolean;
  readonly freshnessSatisfied: boolean;
  readonly bankSatisfied: boolean;
  readonly bankInstructionWithinRecencyWindow: boolean;
  readonly dispositionKind: "proceed" | "blocked";
  readonly dualApproval: boolean;
  readonly requiresSpecialist: boolean;
  readonly authority: SetupAuthorityResolution;
  readonly requesterParticipation: RequesterParticipation;
  readonly projection: ReturnType<typeof projectReserve>;
}

export interface SetupResolvedConfiguration {
  readonly reserveMonths: number;
  readonly freshnessDays: number;
  readonly bankChangeHandling: FirmData["bankChangeHandling"];
  readonly dualApprovalThresholdMinor: number;
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly authorityMode: SetupAuthorityResolution["mode"];
  readonly standardApprovalRole: SetupAuthorityResolution["standardApprovalRole"];
  readonly requesterParticipation: RequesterParticipation;
  readonly approvalClock: ApprovalClock;
}

interface SetupPolicyEvidenceValue<T> {
  readonly value: T;
  readonly provenance: {
    readonly asOf: string;
  };
}

export interface SetupPolicyEvidence {
  readonly plannedMonthlyWithdrawal:
    SetupPolicyEvidenceValue<number>;
  readonly bankInstruction: SetupPolicyEvidenceValue<{
    readonly independentlyVerified: boolean;
  }>;
}

export function setupDefinitionFirmFor(
  firmId: SetupFirmId,
): FirmData {
  return {
    ...FIRMS[firmId]!,
    requesterParticipation: SETUP_REQUESTER_PARTICIPATION,
  };
}

export function setupRuntimeFirm(
  firmId: SetupFirmId,
  evaluation: SetupPolicyEvaluation,
  policyVersion: string,
): FirmData {
  const base = FIRMS[firmId]!;
  return {
    ...base,
    reserveMonths: evaluation.reserveMonths,
    dualApprovalThresholdMinor:
      evaluation.dualApprovalThresholdMinor,
    bankChangeHandling: evaluation.bankChangeHandling,
    standardApprovalRole: evaluation.authority.standardApprovalRole,
    requesterParticipation: evaluation.requesterParticipation,
    policyVersion,
  };
}

export function setupResolvedConfiguration(
  selections: SetupSelections,
  firmId: SetupFirmId,
  evaluation: SetupPolicyEvaluation,
): SetupResolvedConfiguration {
  return {
    reserveMonths: evaluation.reserveMonths,
    freshnessDays: evaluation.freshnessDays,
    bankChangeHandling: evaluation.bankChangeHandling,
    dualApprovalThresholdMinor:
      evaluation.dualApprovalThresholdMinor,
    approvalsRequired: FIRMS[firmId]!.approvalsRequired,
    distinctActorsRequired:
      FIRMS[firmId]!.distinctActorsRequired,
    authorityMode: evaluation.authority.mode,
    standardApprovalRole: evaluation.authority.standardApprovalRole,
    requesterParticipation: evaluation.requesterParticipation,
    approvalClock: APPROVAL_CLOCKS[selections[firmId].expiry]!,
  };
}

function evidenceAgeDays(
  evaluatedAt: string,
  observedAt: string,
): number | null {
  const evaluated = Date.parse(evaluatedAt);
  const observed = Date.parse(observedAt);
  const ageDays = (evaluated - observed) / 86_400_000;
  return Number.isFinite(ageDays) && ageDays >= 0
    ? ageDays
    : null;
}

export function evaluateSetupPolicy(
  selections: SetupSelections,
  firmId: SetupFirmId,
  evidence: SetupPolicyEvidence,
  liquidity: SignedLiquidityCase = SMITHS_LIQUIDITY,
  evaluatedAt: string = DEMO_TIMELINE.decisionCreatedAt,
): SetupPolicyEvaluation {
  const firmSelections = selections[firmId];
  const reserveMonths = closedChoiceValue(
    RESERVE_MONTHS,
    firmSelections.reserve,
    "reserve",
  );
  const freshnessDays = closedChoiceValue(
    FRESHNESS_DAYS,
    firmSelections.freshness,
    "freshness",
  );
  const bankChangeHandling = closedChoiceValue(
    BANK_HANDLING,
    firmSelections["bank-change"],
    "bank-change",
  );
  const dualApprovalThresholdMinor = closedChoiceValue(
    THRESHOLD_MINOR,
    firmSelections.threshold,
    "threshold",
  );
  const projection = projectReserve({
    availableMinor: liquidity.availableMinor,
    pendingMinor: liquidity.pendingMinor,
    requestMinor: liquidity.requestMinor,
    plannedMonthlyMinor:
      evidence.plannedMonthlyWithdrawal.value,
    reserveMonths,
  });
  const plannedWithdrawalAgeDays = evidenceAgeDays(
    evaluatedAt,
    evidence.plannedMonthlyWithdrawal.provenance.asOf,
  );
  const freshnessSatisfied =
    plannedWithdrawalAgeDays !== null &&
    plannedWithdrawalAgeDays <= freshnessDays;
  const bankInstructionAgeDays = evidenceAgeDays(
    evaluatedAt,
    evidence.bankInstruction.provenance.asOf,
  );
  const bankInstructionWithinRecencyWindow =
    bankInstructionAgeDays !== null &&
    bankInstructionAgeDays <= BANK_CHANGE_RECENCY_DAYS;
  const bankChangeRequiresAction =
    evidence.bankInstruction.value.independentlyVerified === false &&
    bankInstructionWithinRecencyWindow;
  const bankSatisfied =
    bankInstructionAgeDays !== null &&
    (!bankChangeRequiresAction ||
      bankChangeHandling === "specialist-review");
  const dispositionKind =
    projection.reserveSatisfied && freshnessSatisfied && bankSatisfied
      ? "proceed"
      : "blocked";
  const dualApproval =
    liquidity.requestMinor > dualApprovalThresholdMinor;
  const requiresSpecialist =
    bankChangeRequiresAction &&
    bankChangeHandling === "specialist-review";
  const authority: SetupAuthorityResolution =
    dispositionKind !== "proceed"
      ? { mode: "not-reached", standardApprovalRole: null }
      : !requiresSpecialist && !dualApproval
        ? { mode: "automatic", standardApprovalRole: null }
        : { mode: "staged", standardApprovalRole: "operations" };
  return {
    requestMinor: liquidity.requestMinor,
    reserveMonths,
    freshnessDays,
    bankChangeHandling,
    dualApprovalThresholdMinor,
    reserveSatisfied: projection.reserveSatisfied,
    freshnessSatisfied,
    bankSatisfied,
    bankInstructionWithinRecencyWindow,
    dispositionKind,
    dualApproval,
    requiresSpecialist,
    authority,
    requesterParticipation: SETUP_REQUESTER_PARTICIPATION,
    projection,
  };
}
