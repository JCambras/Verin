import { projectReserve } from "@domain/money-movement/reserve-projection";
import {
  APPROVAL_CLOCKS,
  CANONICAL_REQUEST,
  DEMO_TIMELINE,
  FIRMS,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  type ApprovalClock,
  type FirmData,
  type SignedLiquidityCase,
} from "./data";
import type { RequesterParticipation } from "./model";
import type { DecisionEvidenceSnapshot } from "./decision-evidence";
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
      readonly eligibleRole: null;
    }
  | {
      readonly mode: "automatic";
      readonly eligibleRole: null;
    }
  | {
      readonly mode: "staged";
      readonly eligibleRole: "operations";
    };

export interface SetupPolicyEvaluation {
  readonly reserveMonths: number;
  readonly freshnessDays: number;
  readonly bankChangeHandling: FirmData["bankChangeHandling"];
  readonly dualApprovalThresholdMinor: number;
  readonly reserveSatisfied: boolean;
  readonly freshnessSatisfied: boolean;
  readonly bankSatisfied: boolean;
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
  readonly authorityMode: SetupAuthorityResolution["mode"];
  readonly eligibleRole: SetupAuthorityResolution["eligibleRole"];
  readonly requesterParticipation: RequesterParticipation;
  readonly approvalClock: ApprovalClock;
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
    eligibleRole: evaluation.authority.eligibleRole,
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
    authorityMode: evaluation.authority.mode,
    eligibleRole: evaluation.authority.eligibleRole,
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

export function evaluateSetupPolicy(
  selections: SetupSelections,
  firmId: SetupFirmId,
  evidence: DecisionEvidenceSnapshot,
  liquidity: SignedLiquidityCase = SMITHS_LIQUIDITY,
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
    plannedMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    reserveMonths,
  });
  const evidenceAgeDays =
    (Date.parse(DEMO_TIMELINE.decisionCreatedAt) -
      Date.parse(evidence.plannedMonthlyWithdrawal.provenance.asOf)) /
    86_400_000;
  const freshnessSatisfied =
    Number.isFinite(evidenceAgeDays) && evidenceAgeDays <= freshnessDays;
  const bankChangeRequiresAction =
    evidence.bankInstruction.value.independentlyVerified === false;
  const bankSatisfied =
    !bankChangeRequiresAction ||
    bankChangeHandling === "specialist-review";
  const dispositionKind =
    projection.reserveSatisfied && freshnessSatisfied && bankSatisfied
      ? "proceed"
      : "blocked";
  const dualApproval =
    CANONICAL_REQUEST.amountMinor > dualApprovalThresholdMinor;
  const requiresSpecialist =
    bankChangeRequiresAction &&
    bankChangeHandling === "specialist-review";
  const authority: SetupAuthorityResolution =
    dispositionKind !== "proceed"
      ? { mode: "not-reached", eligibleRole: null }
      : !requiresSpecialist && !dualApproval
        ? { mode: "automatic", eligibleRole: null }
        : { mode: "staged", eligibleRole: "operations" };
  return {
    reserveMonths,
    freshnessDays,
    bankChangeHandling,
    dualApprovalThresholdMinor,
    reserveSatisfied: projection.reserveSatisfied,
    freshnessSatisfied,
    bankSatisfied,
    dispositionKind,
    dualApproval,
    requiresSpecialist,
    authority,
    requesterParticipation: { mode: "unbound" },
    projection,
  };
}
