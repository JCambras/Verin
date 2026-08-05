import { projectReserve } from "@domain/money-movement/reserve-projection";
import {
  APPROVAL_CLOCKS,
  DEMO_TIMELINE,
  FIRMS,
  SMITHS_LIQUIDITY,
  type ApprovalClock,
  type FirmData,
  type SignedLiquidityCase,
} from "./data";
import type { RequesterParticipation } from "./model";
import type {
  SetupFirmId,
  SetupSelections,
} from "./setup-model";

export const RESERVE_MONTHS: Readonly<Record<string, number>> = {
  "6-months": 6,
  "9-months": 9,
  "12-months": 12,
};

export const FRESHNESS_DAYS: Readonly<Record<string, number>> = {
  "7-days": 7,
  "14-days": 14,
  "30-days": 30,
};

export const BANK_CHANGE_RECENCY_DAYS = 7;

export const SETUP_REQUESTER_PARTICIPATION = Object.freeze({
  mode: "unbound",
} as const);

export const BANK_HANDLING: Readonly<
  Record<string, FirmData["bankChangeHandling"]>
> = {
  specialist: "specialist-review",
  block: "block-until-independently-verified",
};

export const THRESHOLD_MINOR: Readonly<Record<string, number>> = {
  "25000": 2_500_000,
  "50000": 5_000_000,
  "100000": 10_000_000,
};

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

function setting(
  table: Readonly<Record<string, number>>,
  id: string,
  label: string,
): number {
  const value = table[id];
  if (value === undefined) {
    throw new Error(`Unsupported ${label} selection: ${id}`);
  }
  return value;
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
  const reserveMonths = setting(
    RESERVE_MONTHS,
    firmSelections.reserve,
    "reserve",
  );
  const freshnessDays = setting(
    FRESHNESS_DAYS,
    firmSelections.freshness,
    "freshness",
  );
  const bankChangeHandling =
    BANK_HANDLING[firmSelections["bank-change"]];
  if (!bankChangeHandling) {
    throw new Error(
      `Unsupported bank-change selection: ${firmSelections["bank-change"]}`,
    );
  }
  const dualApprovalThresholdMinor = setting(
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
