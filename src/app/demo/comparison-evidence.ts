import {
  evidenceForPass,
  type JourneyPass,
} from "./data";
import type { SignedCaseVariant } from "./signed-cases";

export interface ComparisonEvidenceResult {
  readonly equivalent: boolean;
  readonly availableA: boolean;
  readonly availableB: boolean;
  readonly onlyInA: readonly string[];
  readonly onlyInB: readonly string[];
  readonly changed: readonly string[];
}

function normalizedEvidence(
  sourceCase: SignedCaseVariant | null,
  pass: JourneyPass,
) {
  return evidenceForPass(sourceCase, pass)
    .map((entry) => {
      const key = [
        entry.evidenceKind,
        entry.subjectRef,
        entry.liquidityPhase ?? "",
      ].join("\u0000");
      return {
        key,
        label: `${entry.evidenceKind} · ${entry.subjectRef}`,
        signature: JSON.stringify({
          evidenceKind: entry.evidenceKind,
          subjectRef: entry.subjectRef,
          observedAt: entry.observedAt,
          retrievedAt: entry.retrievedAt,
          freshness: entry.freshness,
          source: entry.source,
          provenance: entry.provenance,
          summary: entry.summary,
          liquidityPhase: entry.liquidityPhase,
          observedAbsent: entry.observedAbsent,
          displayValue: entry.displayValue,
          freshnessWindowDays: entry.freshnessWindowDays,
        }),
      };
    })
    .sort((left, right) =>
      left.key.localeCompare(right.key) ||
      left.signature.localeCompare(right.signature),
    );
}

export function compareComparisonEvidence(
  sourceA: SignedCaseVariant | null,
  sourceB: SignedCaseVariant | null,
  pass: JourneyPass,
): ComparisonEvidenceResult {
  const rowsA = normalizedEvidence(sourceA, pass);
  const rowsB = normalizedEvidence(sourceB, pass);
  const keys = new Set([
    ...rowsA.map(({ key }) => key),
    ...rowsB.map(({ key }) => key),
  ]);
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  const changed: string[] = [];
  for (const key of [...keys].sort()) {
    const a = rowsA.filter((row) => row.key === key);
    const b = rowsB.filter((row) => row.key === key);
    if (a.length === 0) {
      onlyInB.push(...b.map(({ label }) => label));
    } else if (b.length === 0) {
      onlyInA.push(...a.map(({ label }) => label));
    } else if (
      JSON.stringify(a.map(({ signature }) => signature)) !==
      JSON.stringify(b.map(({ signature }) => signature))
    ) {
      changed.push(a[0]!.label);
    }
  }
  const triggerEquivalent =
    sourceA !== null &&
    sourceB !== null &&
    sourceA.trigger.requestAmountMinor !== null &&
    sourceB.trigger.requestAmountMinor !== null &&
    sourceA.trigger.requestAmountMinor ===
      sourceB.trigger.requestAmountMinor &&
    sourceA.trigger.requestAt === sourceB.trigger.requestAt;
  return {
    equivalent:
      triggerEquivalent &&
      onlyInA.length === 0 &&
      onlyInB.length === 0 &&
      changed.length === 0,
    availableA: sourceA !== null,
    availableB: sourceB !== null,
    onlyInA,
    onlyInB,
    changed,
  };
}
