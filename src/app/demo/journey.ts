/**
 * The demo's FAKE SERVICE INTERFACE (v3 prompt 3; charter #5 / ADR-0027): the one
 * entry point the demo routes call to obtain the typed view models for a scenario
 * branch under a firm. It composes the per-surface builders and records, from the
 * scenario's contract data alone, how far the journey reaches - blocked and
 * prohibited journeys never produce authority/safety/execution view models, so no
 * surface can render a station the record has not reached (design §4).
 *
 * When the real pipeline lands (v3 prompts 12-26), this module is replaced surface
 * by surface; the view-model contract (./model.ts) is what stays.
 */
import type {
  DecisionJourneyVM,
  DemoPolicyApprovalEventVM,
} from "./model";
import { buildEvidence, buildIntent, buildWorkspace } from "./build-context";
import { buildApprovals, buildPolicyTrace, buildRecommendation } from "./build-decision";
import {
  buildExecution,
  buildSafety,
  buildVerification,
} from "./build-outcome";
import { executionReachFor } from "./execution-reach";
import { buildPolicyAuthoring } from "./build-policy-authoring";
import { buildComparison, buildRecord } from "./build-summary";
import {
  bindExactSourceCase,
  dispositionFor,
  firmById,
  hasSignedInvalidationAuthority,
  liquidityAuthorityFor,
  outcomeClassFor,
  scenarioById,
  sourceCaseFor,
  sourceCaseIdsFor,
  type JourneyPass,
  type ScenarioData,
} from "./data";
import type { SignedCaseId } from "./signed-cases";

/** How far this branch's journey reaches, from recorded contract data only. */
function reachOf(
  scenario: ScenarioData,
  firmId: string,
  pass: JourneyPass,
) {
  const firm = firmById(firmId);
  const disposition = dispositionFor(scenario, firmId);
  const decisionOnly = disposition !== "proceed";
  const authority = !decisionOnly;
  const approvals = authority ? buildApprovals(scenario, firm, pass) : null;
  const authorityGap =
    sourceCaseFor(scenario, firmId)?.authorityGap?.execution === "withheld";
  const safety = authority && (approvals?.satisfied === true || authorityGap);
  const execution =
    safety &&
    executionReachFor(scenario, firm, pass).reached;
  return { authority, safety, execution, approvals };
}

function stopNoteOf(
  scenario: ScenarioData,
  firmId: string,
  pass: JourneyPass,
): string | null {
  const disposition = dispositionFor(scenario, firmId);
  if (disposition === "prohibited") return "This journey stopped at Decision: the prohibition is not resolvable by evidence or authority.";
  if (disposition === "blocked") return "This journey stopped at Decision: the named conditions must be resolved before authority can be requested.";
  if (scenario.spec.specialistExpired) return "This journey stopped at Authority: the specialist review escalated to the operations manager, then expired unresolved.";
  const sourceCase = sourceCaseFor(scenario, firmId);
  if (sourceCase?.authorityGap?.execution === "withheld") {
    return `This journey stopped at Safety: ${sourceCase.authorityGap.reason}`;
  }
  if (liquidityAuthorityFor(scenario, firmId).kind === "missing") {
    return "This journey stopped at Safety: exact signed liquidity authority is unavailable for this scenario and firm.";
  }
  const executionReach = executionReachFor(
    scenario,
    firmById(firmId),
    pass,
  );
  if (!executionReach.reached) {
    if (
      scenario.spec.invalidation &&
      pass === "initial" &&
      executionReach.reason ===
        "Material evidence changed, so the original authority is void."
    ) {
      return "This journey returned to Decision: both approvals were voided when material evidence changed.";
    }
    return `This journey stopped at Safety: ${executionReach.reason}`;
  }
  return null;
}

export function getJourney(
  scenarioId: string,
  firmId: string,
  pass: JourneyPass = "initial",
  sourceCaseId?: SignedCaseId,
  policyApproval: DemoPolicyApprovalEventVM | null = null,
): DecisionJourneyVM {
  const baseScenario = scenarioById(scenarioId);
  const firm = firmById(firmId);
  const exactCaseId =
    sourceCaseId ?? sourceCaseIdsFor(baseScenario, firm.id)[0];
  const scenario = exactCaseId
    ? bindExactSourceCase(baseScenario, firm.id, exactCaseId)
    : baseScenario;
  if (
    pass === "revalidated" &&
    !hasSignedInvalidationAuthority(scenario, firm.id)
  ) {
    throw new Error(
      `Revalidated pass has no exact signed authority for ${scenario.id}/${firm.id}`,
    );
  }
  const reached = reachOf(scenario, firm.id, pass);
  const stopNote = stopNoteOf(scenario, firm.id, pass);
  const safety = reached.safety ? buildSafety(scenario, firm, pass) : null;
  const execution = reached.execution ? buildExecution(scenario, firm, pass) : null;
  const verification = reached.execution ? buildVerification(scenario, firm, pass) : null;
  return {
    scenarioId: scenario.id,
    firmId: firm.id,
    sourceCaseId: exactCaseId ?? null,
    scenarioTitle: scenario.title,
    firmName: firm.name,
    outcomeClass: outcomeClassFor(scenario, firm.id),
    workspace: buildWorkspace(scenario, firm, pass),
    intent: buildIntent(scenario, firm),
    evidence: buildEvidence(scenario, firm, pass),
    recommendation: buildRecommendation(scenario, firm, pass),
    policyTrace: buildPolicyTrace(scenario, firm, pass),
    approvals: reached.approvals,
    safety,
    execution,
    verification,
    stopNote,
    comparison: buildComparison(scenario, pass),
    policyAuthoring: buildPolicyAuthoring(scenario, firm, pass),
    record: buildRecord(scenario, firm, pass, policyApproval),
  };
}
