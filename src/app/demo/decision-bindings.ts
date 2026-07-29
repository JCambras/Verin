import { createHash } from "node:crypto";
import {
  decisionIdentityFor,
  dispositionFor,
  evidenceForPass,
  hasSignedInvalidationAuthority,
  requestFor,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";
import { timelineFor } from "./timeline";

export interface DemoDecisionBinding {
  readonly decisionHash: string;
  readonly bundleHash: string;
}

function digest(kind: string, value: unknown): string {
  return createHash("sha256")
    .update(kind)
    .update("\u0000")
    .update(JSON.stringify(value))
    .digest("hex");
}

function selectedEvidence(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
) {
  return evidenceForPass(sourceCaseFor(scenario, firm.id), pass)
    .map((entry) => ({
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
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}

export function activeDecisionAt(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): string {
  const timeline = timelineFor(scenario, firm);
  return pass === "revalidated" &&
    hasSignedInvalidationAuthority(scenario, firm.id)
    ? timeline.derivedDecisionAt
    : timeline.decisionAt;
}

export function decisionBindingFor(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): DemoDecisionBinding {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const identity = {
    scenarioId: scenario.id,
    firmId: firm.id,
    sourceCaseId: sourceCase?.caseId ?? null,
    pass,
  };
  const bundleHash = digest("verin-demo-input-bundle-v1", {
    identity,
    request: requestFor(scenario, firm.id),
    signedTrigger: sourceCase?.trigger ?? null,
    evidence: selectedEvidence(scenario, firm, pass),
    policyVersions: sourceCase?.policyVersions ?? {
      domainConfigVersionId: null,
      firmPolicyVersionId: firm.policyVersion,
      householdInstructionVersionIds: [],
      regulatoryVersionId: null,
    },
    householdInstructions: [...(sourceCase?.householdInstructions ?? [])].sort(
      (left, right) => left.versionId.localeCompare(right.versionId),
    ),
    firmConfiguration: {
      reserveMonths: firm.reserveMonths,
      dualApprovalThresholdMinor: firm.dualApprovalThresholdMinor,
      approvalsRequired: firm.approvalsRequired,
      distinctActorsRequired: firm.distinctActorsRequired,
      eligibleRole: firm.eligibleRole,
      requesterConstraint: firm.requesterConstraint,
      bankChangeHandling: firm.bankChangeHandling,
    },
  });
  return {
    bundleHash,
    decisionHash: digest("verin-demo-decision-v1", {
      identity,
      decisionId: decisionIdentityFor(scenario, firm.id, pass),
      createdAt: activeDecisionAt(scenario, firm, pass),
      bundleHash,
      disposition: dispositionFor(scenario, firm.id),
      prohibition: sourceCase?.prohibition ?? null,
      authority: sourceCase?.authority ?? null,
      executionEligibility: sourceCase?.executionEligibility ?? null,
      explanations: sourceCase?.explanations ?? [],
    }),
  };
}

export function recordDecisionBindings(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): readonly {
  readonly kind: "original" | "derived";
  readonly decisionHash: string;
  readonly bundleHash: string;
}[] {
  const original = decisionBindingFor(scenario, firm, "initial");
  return pass === "revalidated" &&
    hasSignedInvalidationAuthority(scenario, firm.id)
    ? [
        { kind: "original", ...original },
        {
          kind: "derived",
          ...decisionBindingFor(scenario, firm, "revalidated"),
        },
      ]
    : [{ kind: "original", ...original }];
}
