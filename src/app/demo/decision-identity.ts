import { createHash } from "node:crypto";
import {
  CANONICAL_SERIALIZER_VERSION,
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { IANA_TIME_ZONE_DATA_VERSION } from "@contracts/time-zone";
import type {
  AuthorityPlanVM,
  DispositionVM,
  PrecedenceRowVM,
} from "./model";
import {
  BANK_INSTRUCTION,
  CANONICAL_REQUEST,
  DEMO_REQUEST_REF,
  DEMO_TIME_ZONE,
  DEMO_TIMELINE,
  THIRD_PARTY_DESTINATION,
  type DecisionConfiguration,
  type DecisionIdentity,
  type FirmData,
  type ScenarioData,
} from "./data";
import {
  decisionEvidenceSnapshotFor,
  type DecisionEvidenceSnapshot,
} from "./decision-evidence";
import {
  assertAuthorityPlan,
  type DecisionAuthorityClaim,
} from "./decision-authority-claim";
export {
  decisionAuthorityClaimFor,
  decisionAuthorityRequirementsFor,
  type DecisionAuthorityClaim,
} from "./decision-authority-claim";

export const DEMO_DECISION_SCHEMA_VERSION =
  "money-movement-demo-decision/6.0.0";
export const DEMO_DECISION_ENGINE_VERSION =
  "money-movement-demo-engine/4.0.0";

export interface DecisionIdentityClaims {
  readonly disposition: DispositionVM;
  readonly precedence: readonly PrecedenceRowVM[];
  readonly authority: DecisionAuthorityClaim;
}

export interface DecisionInputOverrides {
  readonly canonicalSerializerVersion?: string;
  readonly engineVersion?: string;
  readonly evaluationAsOf?: string;
  readonly timeZone?: string;
  readonly timeZoneDataVersion?: string;
  readonly requestRef?: string;
  readonly evidenceRef?: string;
  readonly evidenceRetrievedAt?: string;
  readonly bankInstructionObservedAt?: string;
}

export function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical decision preimages require finite numbers");
    }
    return value;
  }
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new Error(
        "Canonical decision preimages require plain objects",
      );
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        toJsonValue(nested),
      ]),
    );
  }
  throw new Error(`Unsupported canonical preimage value: ${typeof value}`);
}

function destinationForIdentity(scenario: ScenarioData): string {
  if (scenario.spec.thirdPartyDestination) return THIRD_PARTY_DESTINATION;
  return scenario.spec.bankChanged
    ? BANK_INSTRUCTION.changed
    : BANK_INSTRUCTION.stable;
}

export function decisionInputPreimageFor(
  scenario: ScenarioData,
  overrides: DecisionInputOverrides = {},
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(scenario),
): JsonValue {
  return decisionInputPreimageForPhase(
    scenario,
    "initial",
    overrides,
    evidence,
  );
}

export function refreshedDecisionInputPreimageFor(
  scenario: ScenarioData,
  overrides: DecisionInputOverrides = {},
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(
    scenario,
    "revalidation",
  ),
): JsonValue {
  if (scenario.spec.invalidation !== true) {
    throw new Error(
      "A refreshed demo input identity requires a material-change scenario",
    );
  }
  return decisionInputPreimageForPhase(
    scenario,
    "revalidation",
    overrides,
    evidence,
  );
}

function decisionInputPreimageForPhase(
  scenario: ScenarioData,
  phase: "initial" | "revalidation",
  overrides: DecisionInputOverrides,
  evidence: DecisionEvidenceSnapshot,
): JsonValue {
  if (evidence.phase !== phase) {
    throw new Error(
      `Decision input phase ${phase} received ${evidence.phase} evidence`,
    );
  }
  const bankInstructionObservedAt =
    overrides.bankInstructionObservedAt ??
    evidence.bankInstruction.provenance.asOf;
  const evidencePayload = {
    ...evidence,
    ref: overrides.evidenceRef ?? evidence.ref,
    retrievedAt:
      overrides.evidenceRetrievedAt ?? evidence.retrievedAt,
    bankInstruction: {
      ...evidence.bankInstruction,
      provenance: {
        ...evidence.bankInstruction.provenance,
        asOf: bankInstructionObservedAt,
      },
    },
  };
  return toJsonValue({
    hashKind: "money-movement-demo-input",
    preimageVersion: "money-movement-demo-input/4.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion:
        overrides.canonicalSerializerVersion ??
        CANONICAL_SERIALIZER_VERSION,
      engineVersion:
        overrides.engineVersion ?? DEMO_DECISION_ENGINE_VERSION,
      evaluation: {
        asOf:
          overrides.evaluationAsOf ??
          (phase === "initial"
            ? DEMO_TIMELINE.decisionCreatedAt
            : DEMO_TIMELINE.revalidatedAt),
        timeZone: overrides.timeZone ?? DEMO_TIME_ZONE,
        timeZoneDataVersion:
          overrides.timeZoneDataVersion ??
          IANA_TIME_ZONE_DATA_VERSION,
      },
      phase,
      request: {
        ref: overrides.requestRef ?? DEMO_REQUEST_REF,
        text: CANONICAL_REQUEST.text,
        amountMinor: CANONICAL_REQUEST.amountMinor,
        purpose: CANONICAL_REQUEST.purpose,
        deadline: CANONICAL_REQUEST.deadline,
        destination: destinationForIdentity(scenario),
        provenanceClass: "user-entered-demo-input",
      },
      evidence: {
        ...evidencePayload,
      },
    },
  });
}

export function hashCanonicalPreimage(preimage: JsonValue): string {
  const serialized = canonicalJson(preimage);
  if (!serialized.ok) {
    throw new Error(serialized.error.message);
  }
  return createHash("sha256").update(serialized.value).digest("hex");
}

export function decisionInputHashFor(
  scenario: ScenarioData,
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(scenario),
): string {
  return hashCanonicalPreimage(
    decisionInputPreimageFor(scenario, {}, evidence),
  );
}

export function decisionInputIdentitiesFor(
  scenario: ScenarioData,
  originalEvidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(
    scenario,
  ),
  refreshedEvidence: DecisionEvidenceSnapshot | null =
    scenario.spec.invalidation === true
      ? decisionEvidenceSnapshotFor(scenario, "revalidation")
      : null,
): {
  readonly original: string;
  readonly refreshed: string | null;
} {
  return {
    original: decisionInputHashFor(scenario, originalEvidence),
    refreshed:
      refreshedEvidence
        ? hashCanonicalPreimage(
            refreshedDecisionInputPreimageFor(
              scenario,
              {},
              refreshedEvidence,
            ),
          )
        : null,
  };
}

export function approvalReceiptHashFor(
  decisionHash: string,
  authority: AuthorityPlanVM,
): string | null {
  assertAuthorityPlan(authority);
  if (authority.mode !== "staged") return null;
  return hashCanonicalPreimage(toJsonValue({
    hashKind: "money-movement-demo-approval-receipt",
    preimageVersion:
      "money-movement-demo-approval-receipt/3.0.0",
    payload: {
      decisionHash,
      stages: authority.stages.map((stage) => ({
        stageId: stage.decisionRequirement.stageId,
        order: stage.decisionRequirement.order,
        stepState: stage.stepState,
        actors: stage.actors,
        ...(stage.rearmedStage
          ? { rearmedStage: stage.rearmedStage }
          : {}),
      })),
    },
  }));
}

export function decisionBundlePreimageFor(
  scenario: ScenarioData,
  firm: FirmData,
  configuration: DecisionConfiguration,
  authority: DecisionAuthorityClaim,
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(scenario),
): JsonValue {
  if (
    (authority.mode === "automatic" &&
      configuration.standardApprovalRole !== null) ||
    (authority.mode === "staged" &&
      configuration.standardApprovalRole !==
        authority.standardApprovalRole)
  ) {
    throw new Error(
      `Authority mode ${authority.mode} conflicts with standard approval role ${String(configuration.standardApprovalRole)}`,
    );
  }
  if (
    authority.mode === "staged" &&
    JSON.stringify(configuration.requesterParticipation) !==
      JSON.stringify(authority.requesterParticipation)
  ) {
    throw new Error(
      "Authority requester participation conflicts with the resolved configuration",
    );
  }
  const inputPreimage = decisionInputPreimageFor(
    scenario,
    {},
    evidence,
  );
  return toJsonValue({
    hashKind: "money-movement-demo-bundle",
    preimageVersion: "money-movement-demo-bundle/6.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
      engineVersion: DEMO_DECISION_ENGINE_VERSION,
      firmId: firm.id,
      inputHash: hashCanonicalPreimage(inputPreimage),
      input: inputPreimage,
      configuration,
      authority,
    },
  });
}

export function decisionRecordPreimageFor(
  scenario: ScenarioData,
  firm: FirmData,
  configuration: DecisionConfiguration,
  claims: DecisionIdentityClaims,
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(scenario),
): JsonValue {
  const bundlePreimage = decisionBundlePreimageFor(
    scenario,
    firm,
    configuration,
    claims.authority,
    evidence,
  );
  return toJsonValue({
    hashKind: "money-movement-demo-record",
    preimageVersion: "money-movement-demo-record/6.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
      engineVersion: DEMO_DECISION_ENGINE_VERSION,
      firmId: firm.id,
      bundleHash: hashCanonicalPreimage(bundlePreimage),
      bundle: bundlePreimage,
      disposition: claims.disposition,
      blockers: claims.disposition.blockers ?? [],
      precedence: claims.precedence,
      authority: claims.authority,
      createdAt: DEMO_TIMELINE.decisionCreatedAt,
    },
  });
}

export function decisionIdentityFor(
  scenario: ScenarioData,
  firm: FirmData,
  configuration: DecisionConfiguration,
  claims: DecisionIdentityClaims,
  evidence: DecisionEvidenceSnapshot = decisionEvidenceSnapshotFor(scenario),
): DecisionIdentity {
  const inputHash = decisionInputHashFor(scenario, evidence);
  const bundleHash = hashCanonicalPreimage(
    decisionBundlePreimageFor(
      scenario,
      firm,
      configuration,
      claims.authority,
      evidence,
    ),
  );
  const decisionHash = hashCanonicalPreimage(
    decisionRecordPreimageFor(
      scenario,
      firm,
      configuration,
      claims,
      evidence,
    ),
  );
  return {
    decisionId: `dec-${firm.id}-${decisionHash.slice(0, 24)}`,
    inputHash,
    decisionHash,
    bundleHash,
  };
}
