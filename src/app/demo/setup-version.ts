import {
  CANONICAL_SERIALIZER_VERSION,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { IANA_TIME_ZONE_DATA_VERSION } from "@contracts/time-zone";
import {
  DEMO_REQUEST_REF,
  DEMO_TIME_ZONE,
  DEMO_TIMELINE,
  SETUP_SCENARIO_ID,
} from "./data";
import {
  APPROVAL_CLOCKS,
  BANK_CHANGE_RECENCY_DAYS,
  BANK_HANDLING,
  FRESHNESS_DAYS,
  RESERVE_MONTHS,
  THRESHOLD_MINOR,
} from "./closed-choices";
import type { DecisionEvidenceSnapshot } from "./decision-evidence";
import {
  DEMO_DECISION_ENGINE_VERSION,
  DEMO_DECISION_SCHEMA_VERSION,
  hashCanonicalPreimage,
  toJsonValue,
} from "./decision-identity";
import {
  SETUP_FIRM_IDS,
  type MoneyMovementSetupDefinitionVM,
} from "./setup-model";
import { setupDefinitionFirmFor } from "./setup-policy";

export function setupVersionPreimageFor(
  definition: MoneyMovementSetupDefinitionVM,
  evidence: DecisionEvidenceSnapshot,
): JsonValue {
  const firms = SETUP_FIRM_IDS.map(setupDefinitionFirmFor);
  if (
    firms.some(
      (firm) => firm.requesterParticipation.mode !== "unbound",
    )
  ) {
    throw new Error(
      "Setup definition must preserve unbound requester participation",
    );
  }
  const presentation: MoneyMovementSetupDefinitionVM = {
    steps: definition.steps,
    profiles: definition.profiles,
    controls: definition.controls,
    roles: definition.roles,
    baseline: definition.baseline,
    policyGroups: definition.policyGroups,
    impacts: definition.impacts,
    activation: definition.activation,
    request: definition.request,
    comparison: definition.comparison,
    proof: definition.proof,
    fakeClass: definition.fakeClass,
  };

  return toJsonValue({
    hashKind: "money-movement-demo-setup-version",
    preimageVersion: "money-movement-demo-setup-version/3.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
      evaluatorVersion: DEMO_DECISION_ENGINE_VERSION,
      evaluation: {
        effectiveAt: DEMO_TIMELINE.activationAt,
        asOf: DEMO_TIMELINE.decisionCreatedAt,
        timeZone: DEMO_TIME_ZONE,
        timeZoneDataVersion: IANA_TIME_ZONE_DATA_VERSION,
      },
      scenarioId: SETUP_SCENARIO_ID,
      requestRef: DEMO_REQUEST_REF,
      evidence,
      firms,
      evaluatorTables: {
        reserveMonths: RESERVE_MONTHS,
        freshnessDays: FRESHNESS_DAYS,
        bankChangeRecencyDays: BANK_CHANGE_RECENCY_DAYS,
        bankHandling: BANK_HANDLING,
        thresholdMinor: THRESHOLD_MINOR,
        approvalClocks: APPROVAL_CLOCKS,
      },
      presentation,
    },
  });
}

export function setupVersionDigestFor(
  definition: MoneyMovementSetupDefinitionVM,
  evidence: DecisionEvidenceSnapshot,
): string {
  return hashCanonicalPreimage(
    setupVersionPreimageFor(definition, evidence),
  );
}
