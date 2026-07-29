import {
  evidenceForPass,
  type JourneyPass,
} from "./data";
import type { SignedCaseVariant } from "./signed-cases";

const COMPARABLE_EVIDENCE_KINDS = [
  "account-balance",
  "planned-withdrawals",
  "bank-instruction",
  "household-instruction",
  "pending-actions",
] as const;

function comparisonEvidence(
  sourceCase: SignedCaseVariant | null,
  pass: JourneyPass,
) {
  const evidence = evidenceForPass(sourceCase, pass);
  return COMPARABLE_EVIDENCE_KINDS.map((evidenceKind) => {
    const entry = evidence.find(
      (candidate) =>
        candidate.evidenceKind === evidenceKind &&
        (evidenceKind !== "account-balance" ||
          candidate.subjectRef === "subject:smiths-joint-taxable"),
    );
    return entry
      ? {
          evidenceKind: entry.evidenceKind,
          subjectRef: entry.subjectRef,
          observedAt: entry.observedAt,
          retrievedAt: entry.retrievedAt,
          freshness: entry.freshness,
          displayValue: entry.displayValue,
          observedAbsent: entry.observedAbsent,
          liquidityPhase: entry.liquidityPhase,
        }
      : null;
  });
}

export function hasEquivalentComparisonEvidence(
  sourceA: SignedCaseVariant | null,
  sourceB: SignedCaseVariant | null,
  pass: JourneyPass,
): boolean {
  return Boolean(
    sourceA &&
      sourceB &&
      sourceA.trigger.requestAmountMinor ===
        sourceB.trigger.requestAmountMinor &&
      sourceA.trigger.requestAt === sourceB.trigger.requestAt &&
      comparisonEvidence(sourceA, pass).every((entry) => entry !== null) &&
      JSON.stringify(comparisonEvidence(sourceA, pass)) ===
        JSON.stringify(comparisonEvidence(sourceB, pass)),
  );
}
