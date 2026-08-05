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
import type { DemoPolicyRerunResultVM } from "./model";
import { timelineFor } from "./timeline";

export interface DemoDecisionBinding {
  readonly decisionHash: string;
  readonly bundleHash: string;
}

export interface DemoPolicyRerunBinding {
  readonly eventId: string;
  readonly policyVersion: string;
  readonly reserveMonths: number;
  readonly recordedAtIso: string;
  readonly rerun: DemoPolicyRerunResultVM;
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

function bindingFor(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
  policyRerun?: DemoPolicyRerunBinding,
): DemoDecisionBinding {
  const sourceCase = sourceCaseFor(scenario, firm.id);
  const identity = {
    scenarioId: scenario.id,
    firmId: firm.id,
    sourceCaseId: sourceCase?.caseId ?? null,
    pass,
    ...(policyRerun ? { policyApprovalEventId: policyRerun.eventId } : {}),
  };
  const policyVersions = sourceCase?.policyVersions ?? {
    domainConfigVersionId: null,
    firmPolicyVersionId: firm.policyVersion,
    householdInstructionVersionIds: [],
    regulatoryVersionId: null,
  };
  const bundleHash = digest("verin-demo-input-bundle-v1", {
    identity,
    request: requestFor(scenario, firm.id),
    signedTrigger: sourceCase?.trigger ?? null,
    evidence: selectedEvidence(scenario, firm, pass),
    policyVersions: policyRerun
      ? { ...policyVersions, firmPolicyVersionId: policyRerun.policyVersion }
      : policyVersions,
    householdInstructions: [...(sourceCase?.householdInstructions ?? [])].sort(
      (left, right) => left.versionId.localeCompare(right.versionId),
    ),
    firmConfiguration: {
      reserveMonths: policyRerun?.reserveMonths ?? firm.reserveMonths,
      dualApprovalThresholdMinor: firm.dualApprovalThresholdMinor,
      approvalsRequired: firm.approvalsRequired,
      distinctActorsRequired: firm.distinctActorsRequired,
      eligibleRole: firm.eligibleRole,
      requesterConstraint: firm.requesterConstraint,
      bankChangeHandling: firm.bankChangeHandling,
    },
  });
  const decisionResult = policyRerun
    ? {
        disposition: policyRerun.rerun.disposition,
        prohibition:
          policyRerun.rerun.disposition === "prohibited"
            ? (sourceCase?.prohibition ?? null)
            : null,
        authority:
          policyRerun.rerun.disposition === "proceed"
            ? (sourceCase?.authority ?? null)
            : null,
        executionEligibility: {
          eligible: policyRerun.rerun.executionEligible,
          reason: policyRerun.rerun.executionReason,
        },
        executionPlan: policyRerun.rerun.executionPlan,
      }
    : {
        disposition: dispositionFor(scenario, firm.id),
        prohibition: sourceCase?.prohibition ?? null,
        authority: sourceCase?.authority ?? null,
        executionEligibility: sourceCase?.executionEligibility ?? null,
      };
  return {
    bundleHash,
    decisionHash: digest("verin-demo-decision-v1", {
      identity,
      decisionId: policyRerun
        ? policyRerunDecisionId(scenario, firm, pass, policyRerun)
        : decisionIdentityFor(scenario, firm.id, pass),
      createdAt: policyRerun?.recordedAtIso ?? activeDecisionAt(scenario, firm, pass),
      bundleHash,
      ...decisionResult,
      explanations: policyRerun
        ? policyRerun.rerun.explanations
        : (sourceCase?.explanations ?? []),
    }),
  };
}

export function decisionBindingFor(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
): DemoDecisionBinding {
  return bindingFor(scenario, firm, pass);
}

export function policyRerunDecisionId(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
  policyRerun: DemoPolicyRerunBinding,
): string {
  return `${decisionIdentityFor(scenario, firm.id, pass)}:policy-rerun:${policyRerun.eventId}`;
}

export function policyRerunDecisionBindingFor(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
  policyRerun: DemoPolicyRerunBinding,
): DemoDecisionBinding {
  return bindingFor(scenario, firm, pass, policyRerun);
}

export function recordDecisionBindings(
  scenario: ScenarioData,
  firm: FirmData,
  pass: JourneyPass,
  policyRerun?: DemoPolicyRerunBinding,
): readonly {
  readonly kind: "original" | "derived";
  readonly decisionHash: string;
  readonly bundleHash: string;
}[] {
  const original = decisionBindingFor(scenario, firm, "initial");
  const signed: Array<{
    readonly kind: "original" | "derived";
    readonly decisionHash: string;
    readonly bundleHash: string;
  }> = pass === "revalidated" &&
    hasSignedInvalidationAuthority(scenario, firm.id)
    ? [
        { kind: "original" as const, ...original },
        {
          kind: "derived" as const,
          ...decisionBindingFor(scenario, firm, "revalidated"),
        },
      ]
    : [{ kind: "original" as const, ...original }];
  return policyRerun
    ? [
        ...signed,
        {
          kind: "derived" as const,
          ...policyRerunDecisionBindingFor(
            scenario,
            firm,
            pass,
            policyRerun,
          ),
        },
      ]
    : signed;
}
