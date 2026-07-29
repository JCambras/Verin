import type { DispositionVM } from "./model";
import { prov } from "./provenance";
import {
  sourceCaseFor,
  type FirmData,
  type ScenarioData,
} from "./data";

export function buildProhibitedDisposition(
  scenario: ScenarioData,
  firm: FirmData,
): DispositionVM {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const prohibition = sourceCase?.prohibition;
  if (!prohibition) {
    return {
      kind: "prohibited",
      headline:
        "This movement is recorded as prohibited, but exact signed prohibition authority is unavailable.",
      prohibitedScope: "Unavailable for this branch and firm",
      doctrine:
        "Verin will not substitute another case's prohibition authority or route the movement for approval.",
      why: {
        reason: `No exact signed prohibition source covers ${scenario.id}/${firm.id}.`,
      },
      fakeClass: "deterministic-engine-output",
    };
  }
  const sourceEvidence = sourceCase.evidence.find((entry) =>
    prohibition.source.sourceType === "household_instruction"
      ? entry.evidenceKind === "household-instruction"
      : prohibition.source.sourceType === "regulatory"
        ? entry.evidenceKind === "account-restriction"
        : false,
  );
  const sourceKind = {
    household_instruction: "household-instruction",
    regulatory: "regulatory",
    firm_policy: "firm-policy",
  } as const;
  return {
    kind: "prohibited",
    headline: "This movement is prohibited for this household.",
    prohibitedScope: prohibition.scope,
    source: {
      kind: sourceKind[prohibition.source.sourceType],
      id: prohibition.source.sourceId,
      ref: prohibition.source.versionId,
      scope: prohibition.scope,
      reasonCode: prohibition.reasonCode,
      provenance: prov(
        "synthetic-fixture",
        sourceEvidence?.observedAt ?? sourceCase.trigger.requestAt,
      ),
    },
    doctrine:
      "Verin will not route this for approval: the restriction is not resolvable by evidence or authority.",
    why: { reason: prohibition.explanation },
    fakeClass: "deterministic-engine-output",
  };
}
