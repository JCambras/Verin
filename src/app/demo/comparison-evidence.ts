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

function normalizedNonPolicyInputs(
  sourceCase: SignedCaseVariant | null,
  pass: JourneyPass,
) {
  if (!sourceCase) return [];
  const prohibition =
    sourceCase.prohibition?.source.sourceType === "firm_policy"
      ? null
      : sourceCase.prohibition;
  const householdInstructions = [...sourceCase.householdInstructions].sort(
    (left, right) =>
      left.versionId.localeCompare(right.versionId) ||
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  return [
    {
      label: "signed request meaning",
      signature: JSON.stringify({
        kind: sourceCase.trigger.kind,
        description: sourceCase.trigger.description,
        maskedRequestSummary: sourceCase.trigger.maskedRequestSummary,
      }),
    },
    {
      label: "signed requester",
      signature: JSON.stringify(sourceCase.trigger.requesterRole),
    },
    {
      label: "signed request identity",
      signature: JSON.stringify(sourceCase.trigger.requestRef),
    },
    {
      label: "signed request timing and amount",
      signature: JSON.stringify({
        requestAt: sourceCase.trigger.requestAt,
        requestAmountMinor: sourceCase.trigger.requestAmountMinor,
      }),
    },
    {
      label: "signed money inputs",
      signature: JSON.stringify({
        currency: sourceCase.money.currency,
        cadence: sourceCase.money.cadence,
        plannedWithdrawalMonthlyMinor:
          sourceCase.money.plannedWithdrawalMonthlyMinor,
        availableLiquidityMinor: sourceCase.money.availableLiquidityMinor,
        pendingLiquidityMinor: sourceCase.money.pendingLiquidityMinor,
        preExecutionRevalidation:
          pass === "revalidated"
            ? sourceCase.money.preExecutionRevalidation
            : null,
      }),
    },
    {
      label: "domain configuration authority",
      signature: JSON.stringify(
        sourceCase.policyVersions.domainConfigVersionId,
      ),
    },
    {
      label: "household instruction authority",
      signature: JSON.stringify({
        versionIds: [
          ...sourceCase.policyVersions.householdInstructionVersionIds,
        ].sort(),
        instructions: householdInstructions,
      }),
    },
    {
      label: "regulatory authority",
      signature: JSON.stringify(
        sourceCase.policyVersions.regulatoryVersionId,
      ),
    },
    {
      label: "non-firm prohibition authority",
      signature: JSON.stringify(prohibition),
    },
    {
      label: "signed authority completeness",
      signature: JSON.stringify(
        sourceCase.authorityGap
          ? {
              ...sourceCase.authorityGap,
              missingAuthorities: [
                ...sourceCase.authorityGap.missingAuthorities,
              ].sort(),
            }
          : null,
      ),
    },
  ];
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
  if (sourceA && sourceB) {
    const inputsA = normalizedNonPolicyInputs(sourceA, pass);
    const inputsB = normalizedNonPolicyInputs(sourceB, pass);
    for (let index = 0; index < inputsA.length; index += 1) {
      const a = inputsA[index]!;
      const b = inputsB[index]!;
      if (a.signature !== b.signature) changed.push(a.label);
    }
  }
  return {
    equivalent:
      sourceA !== null &&
      sourceB !== null &&
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
