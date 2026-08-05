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

function pairOrdinals(left: number, right: number): number {
  if (
    !Number.isSafeInteger(left) ||
    !Number.isSafeInteger(right) ||
    left < 0 ||
    right < 0
  ) {
    throw new TypeError("Audit-position ordinals must be non-negative safe integers");
  }
  const sum = left + right;
  const paired = (sum * (sum + 1)) / 2 + right;
  if (!Number.isSafeInteger(paired)) {
    throw new TypeError("Audit-position allocation exceeds the safe integer range");
  }
  return paired;
}

export function auditPositionFor(
  scenario: ScenarioData,
  firmId: FirmData["id"],
  pass: JourneyPass,
): DemoAuditPosition {
  const scenarioIndex = SCENARIOS.findIndex(
    (candidate) => candidate.id === scenario.id,
  );
  const firmIds = Object.keys(FIRMS);
  const firmIndex = firmIds.indexOf(firmId);
  const caseId = sourceCaseFor(scenario, firmId)?.caseId;
  const caseIndex = caseId
    ? SIGNED_CASE_IDS.indexOf(caseId)
    : -1;
  if (
    scenarioIndex < 0 ||
    firmIndex < 0 ||
    (caseId !== undefined && caseIndex < 0)
  ) {
    throw new TypeError(
      `Cannot assign an audit position to ${scenario.id}/${firmId}/${caseId ?? "unsigned"}/${pass}`,
    );
  }
  const caseOrdinal = caseIndex + 1;
  const identityOrdinal = pairOrdinals(
    pairOrdinals(scenarioIndex, firmIndex),
    caseOrdinal,
  );
  return {
    orgId: "demo-org",
    sequence:
      214 +
      identityOrdinal * 2 +
      (pass === "revalidated" ? 1 : 0),
  };
}
