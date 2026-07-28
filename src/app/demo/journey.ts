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
import type { DecisionJourneyVM } from "./model";
import { buildEvidence, buildIntent, buildWorkspace } from "./build-context";
import { buildApprovals, buildPolicyTrace, buildRecommendation } from "./build-decision";
import { buildExecution, buildSafety, buildVerification } from "./build-outcome";
import { buildComparison, buildPolicyAuthoring, buildRecord } from "./build-summary";
import { dispositionFor, firmById, outcomeClassFor, scenarioById } from "./data";

/** How far this branch's journey reaches, from recorded contract data only. */
function reachOf(scenarioId: string, firmId: string) {
  const scenario = scenarioById(scenarioId);
  const disposition = dispositionFor(scenario, firmId);
  const decisionOnly = disposition !== "proceed";
  const authority = !decisionOnly;
  const safety = authority && !scenario.spec.specialistExpired;
  const execution = safety && !scenario.spec.invalidation;
  return { authority, safety, execution };
}

function stopNoteOf(scenarioId: string, firmId: string): string | null {
  const scenario = scenarioById(scenarioId);
  const disposition = dispositionFor(scenario, firmId);
  if (disposition === "prohibited") return "This journey stopped at Decision: the prohibition is not resolvable by evidence or authority.";
  if (disposition === "blocked") return "This journey stopped at Decision: the named conditions must be resolved before authority can be requested.";
  if (scenario.spec.specialistExpired) return "This journey stopped at Authority: the specialist review escalated to the operations manager, then expired unresolved.";
  if (scenario.spec.invalidation) return "This journey returned to Decision: the approval was voided when material evidence changed.";
  return null;
}

export function getJourney(scenarioId: string, firmId: string): DecisionJourneyVM {
  const scenario = scenarioById(scenarioId);
  const firm = firmById(firmId);
  const reached = reachOf(scenario.id, firm.id);
  const stopNote = stopNoteOf(scenario.id, firm.id);
  return {
    scenarioId: scenario.id,
    firmId: firm.id,
    scenarioTitle: scenario.title,
    firmName: firm.name,
    outcomeClass: outcomeClassFor(scenario, firm.id),
    workspace: buildWorkspace(scenario, firm),
    intent: buildIntent(scenario, firm),
    evidence: buildEvidence(scenario, firm),
    recommendation: buildRecommendation(scenario, firm),
    policyTrace: buildPolicyTrace(scenario, firm),
    approvals: reached.authority ? buildApprovals(scenario, firm) : null,
    safety: reached.safety ? buildSafety(scenario, firm) : null,
    execution: reached.execution ? buildExecution(scenario, firm) : null,
    verification: reached.execution ? buildVerification(scenario, firm) : null,
    stopNote,
    comparison: buildComparison(scenario),
    policyAuthoring: buildPolicyAuthoring(scenario, firm),
    record: buildRecord(scenario, firm, reached, stopNote),
  };
}
