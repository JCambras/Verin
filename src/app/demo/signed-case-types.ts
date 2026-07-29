import type { DispositionKind } from "./model";

export const SIGNED_CASE_IDS = [
  "GC-01-firm-a-happy-path",
  "GC-02-firm-b-happy-path",
  "GC-03-recent-bank-change-firm-a",
  "GC-04-recent-bank-change-firm-b",
  "GC-05-insufficient-liquidity",
  "GC-06-household-restriction",
  "GC-07-regulatory-prohibition",
  "GC-08-ambiguous-household",
  "GC-09-stale-evidence",
  "GC-10-simultaneous-distributions-first",
  "GC-11-simultaneous-distributions-second",
  "GC-12-duplicate-retry",
  "GC-13-partial-salesforce-success",
  "GC-14-delayed-nigo",
  "GC-15-approval-invalidation",
  "GC-16-specialist-review-expiration",
] as const;

export type SignedCaseId = (typeof SIGNED_CASE_IDS)[number];
export type SignedAuthorityMode =
  | "none"
  | "automatic"
  | "approval"
  | "specialist_review";

export interface SignedMoneyData {
  readonly currency: string;
  readonly cadence: string;
  readonly requestAmountMinor: number;
  readonly plannedWithdrawalMonthlyMinor: number | null;
  readonly reserveFloorMinor: number | null;
  readonly availableLiquidityMinor: number | null;
  readonly pendingLiquidityMinor: number | null;
  readonly preExecutionRevalidation: {
    readonly availableLiquidityMinor: number;
    readonly pendingLiquidityMinor: number;
  } | null;
}

export interface SignedEvidenceData {
  readonly evidenceKind: string;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly freshness: string;
  readonly source: string;
  readonly provenance: string;
  readonly summary: string;
  readonly liquidityPhase: string | null;
  readonly observedAbsent: boolean;
}

export interface SignedEscalationData {
  readonly after: string;
  readonly roleIds: readonly string[];
  readonly reasonCode: string;
}

export interface SignedAuthorityStageData {
  readonly stageId: string;
  readonly order: number;
  readonly executionMode: "sequential" | "parallel";
  readonly eligibleRoleIds: readonly string[];
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly requesterMayApprove: boolean;
  readonly expiresAfter: string;
  readonly escalationPath: readonly SignedEscalationData[];
}

export interface SignedAuthorityData {
  readonly mode: SignedAuthorityMode;
  readonly stages: readonly SignedAuthorityStageData[];
  readonly note: string;
}

export interface SignedReservationData {
  readonly reservationId: string;
  readonly conflictKeys: readonly string[];
  readonly expiresAfter: string;
}

export interface SignedPreconditionData {
  readonly code: string;
  readonly requiredEvidence: readonly string[];
  readonly mustStillHoldAtExecution: boolean;
}

export interface SignedExecutionEligibilityData {
  readonly eligible: boolean;
  readonly reason: string;
  readonly idempotencyKey: string | null;
  readonly reservations: readonly SignedReservationData[];
  readonly preconditions: readonly SignedPreconditionData[];
}

export interface SignedVerificationData {
  readonly reached: boolean;
  readonly observedStatus: string | null;
  readonly settledClaim: string | null;
  readonly note: string;
}

export interface SignedLedgerEventData {
  readonly type: string;
  readonly note: string;
}

export interface SignedExplanationData {
  readonly code: string;
  readonly summary: string;
}

export interface SignedTriggerData {
  readonly description: string;
  readonly requesterRole: string;
  readonly requestRef: string;
  readonly maskedRequestSummary: string;
  readonly requestAt: string;
  readonly requestAmountMinor: number;
}

export interface SignedProhibitionData {
  readonly source: {
    readonly sourceType:
      | "household_instruction"
      | "regulatory"
      | "firm_policy";
    readonly sourceId: string;
    readonly versionId: string;
  };
  readonly scope: string;
  readonly reasonCode: string;
  readonly explanation: string;
}

export interface SignedCaseVariant {
  readonly caseId: SignedCaseId;
  readonly scenarioId: string | null;
  readonly firmId: string;
  readonly disposition: DispositionKind;
  readonly trigger: SignedTriggerData;
  readonly money: SignedMoneyData;
  readonly evidence: readonly SignedEvidenceData[];
  readonly prohibition: SignedProhibitionData | null;
  readonly authority: SignedAuthorityData;
  readonly executionEligibility: SignedExecutionEligibilityData;
  readonly verification: SignedVerificationData;
  readonly ledgerEvents: readonly SignedLedgerEventData[];
  readonly explanations: readonly SignedExplanationData[];
}
