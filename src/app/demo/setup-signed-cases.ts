import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BANK_INSTRUCTION,
  DESTINATION_RESTRICTION,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  type SignedLiquidityCase,
} from "./data";
import type {
  DecisionEvidenceSnapshot,
  DemoEvidenceValue,
} from "./decision-evidence";
import type { SetupFirmId } from "./setup-model";

interface GoldenEvidence {
  readonly evidenceKind: string;
  readonly subjectRef: string;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly source: string;
  readonly provenance: string;
  readonly summary: string;
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
  readonly householdEvidence: readonly GoldenEvidence[];
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
  fallback?: SignedSetupCase,
): GoldenEvidence {
  const found =
    caseFile.householdEvidence.find(
      (candidate) => candidate.evidenceKind === evidenceKind,
    ) ??
    fallback?.householdEvidence.find(
      (candidate) => candidate.evidenceKind === evidenceKind,
    );
  if (!found) {
    throw new Error(
      `${caseFile.caseId} has no ${evidenceKind} evidence`,
    );
  }
  return found;
}

function evidenceValue<T>(
  datum: GoldenEvidence,
  value: T,
): DemoEvidenceValue<T> {
  return {
    sourceRef: `${datum.source}:${datum.evidenceKind}`,
    subjectRef: datum.subjectRef,
    value,
    provenance: {
      source: "fixture",
      asOf: datum.observedAt,
      confidence: "high",
    },
  };
}

export function signedCaseEvidenceSnapshot(
  caseFile: SignedSetupCase,
  fallback: SignedSetupCase,
  liquidity: SignedLiquidityCase,
): DecisionEvidenceSnapshot {
  const available = evidence(
    caseFile,
    "account-balance",
    fallback,
  );
  const planned = evidence(
    caseFile,
    "planned-withdrawals",
    fallback,
  );
  const bank = evidence(
    caseFile,
    "bank-instruction",
    fallback,
  );
  const pending = caseFile.householdEvidence.find(
    (candidate) => candidate.evidenceKind === "pending-actions",
  );
  const retrievedAt = [available, planned, bank, pending]
    .filter(
      (datum): datum is GoldenEvidence => datum !== undefined,
    )
    .map((datum) => datum.retrievedAt)
    .sort()
    .at(-1)!;
  const bankChanged =
    bank.summary.includes("changed") &&
    !bank.summary.includes("unchanged");
  const pendingAmount = pending
    ? Number(
        pending.summary.match(
          /Pending approved distribution of (\d+) USD/i,
        )?.[1] ?? "0",
      ) * 100
    : 0;
  const pendingDatum =
    pending ??
    ({
      ...available,
      evidenceKind: "pending-actions",
      subjectRef: "subject:smiths-household",
      summary: "No pending approved activity",
    } satisfies GoldenEvidence);
  const destinationDatum = {
    ...available,
    evidenceKind: "household-instruction",
    subjectRef: "subject:smiths-household",
    summary: DESTINATION_RESTRICTION.text,
  } satisfies GoldenEvidence;
  return {
    phase: "initial",
    ref: `golden-evidence:${caseFile.caseId}`,
    retrievedAt,
    availableCash: evidenceValue(
      available,
      liquidity.availableMinor,
    ),
    pendingApprovedActivity: evidenceValue(
      pendingDatum,
      pendingAmount,
    ),
    plannedMonthlyWithdrawal: evidenceValue(
      planned,
      PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    ),
    bankInstruction: evidenceValue(bank, {
      destination: bankChanged
        ? BANK_INSTRUCTION.changed
        : BANK_INSTRUCTION.stable,
      independentlyVerified: !bankChanged,
    }),
    destinationRestriction: evidenceValue(
      destinationDatum,
      DESTINATION_RESTRICTION,
    ),
    conflictingFundingInstructions: [],
  };
}

export function signedCaseMaterialEvidence(
  caseFile: SignedSetupCase,
  snapshot: DecisionEvidenceSnapshot,
  liquidity: SignedLiquidityCase,
) {
  return {
    caseId: caseFile.caseId,
    canonicalCase: caseFile,
    boundEvidence: snapshot,
    evaluatorInputs: {
      evaluatedAt: caseFile.trigger.asOf,
      availableMinor: liquidity.availableMinor,
      pendingMinor: liquidity.pendingMinor,
      requestMinor: liquidity.requestMinor,
      plannedMonthlyMinor:
        snapshot.plannedMonthlyWithdrawal.value,
      plannedObservedAt:
        snapshot.plannedMonthlyWithdrawal.provenance.asOf,
      bankInstructionObservedAt:
        snapshot.bankInstruction.provenance.asOf,
      bankInstructionIndependentlyVerified:
        snapshot.bankInstruction.value.independentlyVerified,
    },
  };
}
