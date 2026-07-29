import {
  FIRMS,
  SCENARIOS,
  sourceCaseFor,
  type FirmData,
  type JourneyPass,
  type ScenarioData,
} from "./data";
import { SIGNED_CASE_IDS } from "./signed-cases";

export interface DemoAuditPosition {
  readonly orgId: "demo-org";
  readonly sequence: number;
}

export function auditPositionFor(
  scenario: ScenarioData,
  firmId: FirmData["id"],
  pass: JourneyPass,
): DemoAuditPosition {
  const scenarioIndex = SCENARIOS.findIndex(
    (candidate) => candidate.id === scenario.id,
  );
  const firmIds = Object.keys(FIRMS).sort();
  const firmIndex = firmIds.indexOf(firmId);
  const caseId = sourceCaseFor(scenario, firmId)?.caseId;
  const caseIndex = caseId
    ? SIGNED_CASE_IDS.indexOf(caseId)
    : SIGNED_CASE_IDS.length;
  if (scenarioIndex < 0 || firmIndex < 0 || caseIndex < 0) {
    throw new TypeError(
      `Cannot assign an audit position to ${scenario.id}/${firmId}/${caseId ?? "unsigned"}/${pass}`,
    );
  }
  return {
    orgId: "demo-org",
    sequence:
      214 +
      (((scenarioIndex * firmIds.length + firmIndex) *
        (SIGNED_CASE_IDS.length + 1) +
        caseIndex) *
        2 +
        (pass === "revalidated" ? 1 : 0)),
  };
}
