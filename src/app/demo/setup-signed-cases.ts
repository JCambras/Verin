import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SetupFirmId } from "./setup-model";
import type { SetupPolicyEvidence } from "./setup-policy";

export interface GoldenEvidence {
  readonly evidenceKind: string;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly source: string;
  readonly provenance: string;
  readonly summary: string;
}

interface GoldenFirmConfiguration {
  readonly firmId: SetupFirmId;
  readonly cashReserveMonths: number;
  readonly dualApprovalThresholdUsd: number;
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly eligibleRole: "operations" | null;
  readonly requesterConstraint:
    | "may-not-satisfy-both-approvals"
    | null;
  readonly bankInstructionChangeHandling:
    | "specialist-review"
    | "block-until-independently-verified";
}

interface GoldenAuthorityStage {
  readonly stageId: string;
  readonly order: number;
  readonly executionMode: string;
  readonly eligibleRoleIds: readonly string[];
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly requesterMayApprove: boolean;
  readonly expiresAfter: string;
  readonly escalationPath: readonly {
    readonly after: string;
    readonly roleIds: readonly string[];
    readonly reasonCode: string;
  }[];
}

interface GoldenExpectedAuthority {
  readonly mode:
    | "automatic"
    | "approval"
    | "specialist_review"
    | "none";
  readonly stages: readonly GoldenAuthorityStage[];
  readonly note: string;
}

export interface SignedSetupCase {
  readonly caseId: string;
  readonly scenarioRef: string | null;
  readonly firm: SetupFirmId;
  readonly trigger: {
    readonly kind: string;
    readonly description: string;
    readonly requesterRole: string;
    readonly requestRef: string;
    readonly maskedRequestSummary: string;
    readonly asOf: string;
  };
  readonly firmConfiguration: GoldenFirmConfiguration;
  readonly householdEvidence: readonly GoldenEvidence[];
  readonly policyVersions: {
    readonly domainConfigVersionId: string;
    readonly firmPolicyVersionId: string;
    readonly householdInstructionVersionIds:
      readonly string[];
    readonly regulatoryVersionId: string | null;
  };
  readonly expectedDisposition:
    | "proceed"
    | "blocked"
    | "prohibited";
  readonly expectedAuthority: GoldenExpectedAuthority;
  readonly signoff: {
    readonly status: string;
    readonly authority: string;
  };
}

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), "fixtures/golden", name),
      "utf8",
    ),
  );
}

function signedCase(
  value: unknown,
  expectedCaseId: string,
  expectedFirm: SetupFirmId,
): SignedSetupCase {
  const candidate = value as SignedSetupCase;
  if (
    candidate.caseId !== expectedCaseId ||
    candidate.firm !== expectedFirm ||
    candidate.signoff.status !== "signed" ||
    candidate.signoff.authority !== "captain" ||
    !Array.isArray(candidate.householdEvidence)
  ) {
    throw new Error(
      `${expectedCaseId} is not a valid captain-signed setup case`,
    );
  }
  return candidate;
}

export const SIGNED_SETUP_CASES = {
  happyA: signedCase(
    loadFixture("GC-01-firm-a-happy-path.json"),
    "GC-01-firm-a-happy-path",
    "firm-a",
  ),
  happyB: signedCase(
    loadFixture("GC-02-firm-b-happy-path.json"),
    "GC-02-firm-b-happy-path",
    "firm-b",
  ),
  recentA: signedCase(
    loadFixture("GC-03-recent-bank-change-firm-a.json"),
    "GC-03-recent-bank-change-firm-a",
    "firm-a",
  ),
  recentB: signedCase(
    loadFixture("GC-04-recent-bank-change-firm-b.json"),
    "GC-04-recent-bank-change-firm-b",
    "firm-b",
  ),
  lowHeadroomB: signedCase(
    loadFixture("GC-05-insufficient-liquidity.json"),
    "GC-05-insufficient-liquidity",
    "firm-b",
  ),
  staleA: signedCase(
    loadFixture("GC-09-stale-evidence.json"),
    "GC-09-stale-evidence",
    "firm-a",
  ),
} as const;

function evidence(
  caseFile: SignedSetupCase,
  evidenceKind: string,
): GoldenEvidence | null {
  return (
    caseFile.householdEvidence.find(
      (candidate) => candidate.evidenceKind === evidenceKind,
    ) ?? null
  );
}

function amountFrom(
  text: string,
  pattern: RegExp,
): number | null {
  const match = text.match(pattern);
  return match ? Number(match[1]) * 100 : null;
}

function bankVerification(
  datum: GoldenEvidence,
): boolean | null {
  const summary = datum.summary.toLowerCase();
  if (
    summary.includes("not yet independently verified") ||
    summary.includes("not independently verified")
  ) {
    return false;
  }
  return summary.includes("independently verified")
    ? true
    : null;
}

export interface SignedCaseEvaluationEvidence
  extends SetupPolicyEvidence {
  readonly plannedMonthlyWithdrawal: {
    readonly value: number;
    readonly provenance: { readonly asOf: string };
    readonly canonical: GoldenEvidence;
  };
  readonly bankInstruction: {
    readonly value: {
      readonly independentlyVerified: boolean;
    };
    readonly provenance: { readonly asOf: string };
    readonly canonical: GoldenEvidence;
  };
}

export function signedCaseEvaluationEvidence(
  caseFile: SignedSetupCase,
): SignedCaseEvaluationEvidence | null {
  const planned = evidence(caseFile, "planned-withdrawals");
  const bank = evidence(caseFile, "bank-instruction");
  if (!planned || !bank) return null;
  const plannedMonthlyMinor = amountFrom(
    planned.summary,
    /(\d+)\s+USD\/month/i,
  );
  const independentlyVerified = bankVerification(bank);
  if (
    plannedMonthlyMinor === null ||
    independentlyVerified === null
  ) {
    return null;
  }
  return {
    plannedMonthlyWithdrawal: {
      value: plannedMonthlyMinor,
      provenance: { asOf: planned.observedAt },
      canonical: planned,
    },
    bankInstruction: {
      value: { independentlyVerified },
      provenance: { asOf: bank.observedAt },
      canonical: bank,
    },
  };
}

export function signedCaseMaterialEvidence(
  caseFile: SignedSetupCase,
) {
  const available = evidence(caseFile, "account-balance");
  const pending = evidence(caseFile, "pending-actions");
  const evaluationEvidence =
    signedCaseEvaluationEvidence(caseFile);
  const availableMinor = available
    ? amountFrom(
        available.summary,
        /(?:balance|liquidity)[^\d]*(\d+)\s+USD/i,
      )
    : null;
  const pendingMinor = pending
    ? amountFrom(
        pending.summary,
        /Pending approved distribution of (\d+)\s+USD/i,
      )
    : null;
  const requestMinor = amountFrom(
    caseFile.trigger.maskedRequestSummary,
    /distribute (\d+)\s+USD/i,
  );
  return {
    caseId: caseFile.caseId,
    canonicalEvidence: caseFile.householdEvidence,
    evaluatorInputs: {
      evaluatedAt: caseFile.trigger.asOf,
      availableMinor,
      pendingMinor,
      requestMinor,
      plannedMonthlyMinor:
        evaluationEvidence?.plannedMonthlyWithdrawal.value ??
        null,
      plannedObservedAt:
        evaluationEvidence?.plannedMonthlyWithdrawal
          .canonical.observedAt ?? null,
      plannedRetrievedAt:
        evaluationEvidence?.plannedMonthlyWithdrawal
          .canonical.retrievedAt ?? null,
      bankInstructionObservedAt:
        evaluationEvidence?.bankInstruction.canonical
          .observedAt ?? null,
      bankInstructionRetrievedAt:
        evaluationEvidence?.bankInstruction.canonical
          .retrievedAt ?? null,
      bankInstructionIndependentlyVerified:
        evaluationEvidence?.bankInstruction.value
          .independentlyVerified ?? null,
    },
  };
}

export function signedCaseResolvedConfiguration(
  caseFile: SignedSetupCase,
) {
  const configuration = caseFile.firmConfiguration;
  return {
    policyVersions: caseFile.policyVersions,
    reserveMonths: configuration.cashReserveMonths,
    freshnessDays: null,
    bankChangeHandling:
      configuration.bankInstructionChangeHandling,
    dualApprovalThresholdMinor:
      configuration.dualApprovalThresholdUsd * 100,
    approvalsRequired: configuration.approvalsRequired,
    distinctActorsRequired:
      configuration.distinctActorsRequired,
    authorityMode:
      caseFile.expectedAuthority.mode === "none"
        ? "not-reached"
        : caseFile.expectedAuthority.mode === "automatic"
          ? "automatic"
          : "staged",
    standardApprovalRole: configuration.eligibleRole,
    requesterParticipation:
      configuration.requesterConstraint === null
        ? { mode: "unbound" as const }
        : {
            mode: "excluded" as const,
            constraint: configuration.requesterConstraint,
          },
    approvalClock: null,
  };
}

export function signedCaseRequestMaterial(
  caseFile: SignedSetupCase,
) {
  return {
    trigger: caseFile.trigger,
    evaluatorRequest: {
      text: null,
      amountMinor: amountFrom(
        caseFile.trigger.maskedRequestSummary,
        /distribute (\d+)\s+USD/i,
      ),
      purpose: null,
      deadline: null,
    },
  };
}
