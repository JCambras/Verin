import { createHash } from "node:crypto";
import {
  CANONICAL_SERIALIZER_VERSION,
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { IANA_TIME_ZONE_DATA_VERSION } from "@contracts/time-zone";
import type {
  ApprovalStageVM,
  DispositionVM,
  PrecedenceRowVM,
} from "./model";
import {
  BANK_INSTRUCTION,
  CANONICAL_REQUEST,
  DEMO_EVIDENCE_REF,
  DEMO_REQUEST_REF,
  DEMO_TIME_ZONE,
  DEMO_TIMELINE,
  DESTINATION_RESTRICTION,
  GC15_PENDING_DISTRIBUTION,
  OBSERVED_GC09_BALANCE,
  OBSERVED_RECENT,
  OBSERVED_STALE,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  THIRD_PARTY_DESTINATION,
  type DecisionConfiguration,
  type DecisionIdentity,
  type FirmData,
  type ScenarioData,
} from "./data";

export const DEMO_DECISION_SCHEMA_VERSION =
  "money-movement-demo-decision/3.0.0";
export const DEMO_DECISION_ENGINE_VERSION =
  "money-movement-demo-engine/2.0.0";

export interface DecisionIdentityClaims {
  readonly disposition: DispositionVM;
  readonly precedence: readonly PrecedenceRowVM[];
  readonly authority: {
    readonly reached: boolean;
    readonly summary: string;
    readonly detail: string;
    readonly stages: readonly ApprovalStageVM[];
  };
  readonly reachability: {
    readonly authority: boolean;
    readonly safety: boolean;
    readonly execution: boolean;
  };
  readonly stopNote: string | null;
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
  readonly recommendationRetrievedAt?: string;
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
): JsonValue {
  const stalePlannedWithdrawals =
    scenario.spec.stalePlannedWithdrawals === true;
  const bankChanged = scenario.spec.bankChanged === true;
  const invalidation = scenario.spec.invalidation === true;
  return toJsonValue({
    hashKind: "money-movement-demo-input",
    preimageVersion: "money-movement-demo-input/3.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion:
        overrides.canonicalSerializerVersion ??
        CANONICAL_SERIALIZER_VERSION,
      engineVersion:
        overrides.engineVersion ?? DEMO_DECISION_ENGINE_VERSION,
      evaluation: {
        asOf:
          overrides.evaluationAsOf ?? DEMO_TIMELINE.decisionCreatedAt,
        timeZone: overrides.timeZone ?? DEMO_TIME_ZONE,
        timeZoneDataVersion:
          overrides.timeZoneDataVersion ??
          IANA_TIME_ZONE_DATA_VERSION,
      },
      scenario: {
        id: scenario.id,
        title: scenario.title,
        outcomeClass: scenario.outcomeClass,
        spec: scenario.spec,
      },
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
        ref: overrides.evidenceRef ?? DEMO_EVIDENCE_REF,
        retrievedAt:
          overrides.evidenceRetrievedAt ??
          DEMO_TIMELINE.evidenceRetrievedAt,
        recommendationRetrievedAt:
          overrides.recommendationRetrievedAt ??
          DEMO_TIMELINE.recommendationRetrievedAt,
        availableCashMinor: SMITHS_LIQUIDITY.availableMinor,
        availableCashObservedAt: stalePlannedWithdrawals
          ? OBSERVED_GC09_BALANCE
          : OBSERVED_RECENT,
        pendingApprovedMinor: invalidation
          ? GC15_PENDING_DISTRIBUTION.afterMinor
          : SMITHS_LIQUIDITY.pendingMinor,
        plannedWithdrawalMonthlyMinor:
          PLANNED_WITHDRAWAL_MONTHLY_MINOR,
        plannedWithdrawalObservedAt: stalePlannedWithdrawals
          ? OBSERVED_STALE
          : OBSERVED_RECENT,
        bankInstruction: bankChanged
          ? BANK_INSTRUCTION.changed
          : BANK_INSTRUCTION.stable,
        bankInstructionObservedAt:
          overrides.bankInstructionObservedAt ??
          (bankChanged
            ? BANK_INSTRUCTION.changedOn
            : "2026-05-20"),
        destinationRestrictionRef: DESTINATION_RESTRICTION.ref,
        destinationRestriction: DESTINATION_RESTRICTION.text,
        conflictingFundingInstructions:
          scenario.spec.conflictingInstruction === true
            ? [
                "Renovation costs are paid from the Joint Taxable account",
                "Large one-time needs are funded from the Smith Family Taxable account",
              ]
            : [],
        materialChange: invalidation
          ? {
              kind: "pending-distribution-posted",
              beforeMinor: GC15_PENDING_DISTRIBUTION.beforeMinor,
              deltaMinor: GC15_PENDING_DISTRIBUTION.deltaMinor,
              afterMinor: GC15_PENDING_DISTRIBUTION.afterMinor,
              observedAt: GC15_PENDING_DISTRIBUTION.observedAt,
              retrievedAt: GC15_PENDING_DISTRIBUTION.retrievedAt,
            }
          : null,
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

export function decisionInputHashFor(scenario: ScenarioData): string {
  return hashCanonicalPreimage(decisionInputPreimageFor(scenario));
}

export function decisionBundlePreimageFor(
  scenario: ScenarioData,
  firm: FirmData,
  configuration: DecisionConfiguration,
): JsonValue {
  const inputPreimage = decisionInputPreimageFor(scenario);
  return toJsonValue({
    hashKind: "money-movement-demo-bundle",
    preimageVersion: "money-movement-demo-bundle/2.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
      engineVersion: DEMO_DECISION_ENGINE_VERSION,
      firm: { id: firm.id, label: firm.name },
      inputHash: hashCanonicalPreimage(inputPreimage),
      input: inputPreimage,
      configuration,
    },
  });
}

export function decisionRecordPreimageFor(
  scenario: ScenarioData,
  firm: FirmData,
  configuration: DecisionConfiguration,
  claims: DecisionIdentityClaims,
): JsonValue {
  const bundlePreimage = decisionBundlePreimageFor(
    scenario,
    firm,
    configuration,
  );
  return toJsonValue({
    hashKind: "money-movement-demo-record",
    preimageVersion: "money-movement-demo-record/2.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
      engineVersion: DEMO_DECISION_ENGINE_VERSION,
      scenario: { id: scenario.id, title: scenario.title },
      firm: { id: firm.id, label: firm.name },
      bundleHash: hashCanonicalPreimage(bundlePreimage),
      bundle: bundlePreimage,
      disposition: claims.disposition,
      blockers: claims.disposition.blockers ?? [],
      precedence: claims.precedence,
      authority: claims.authority,
      reachability: claims.reachability,
      stopNote: claims.stopNote,
      createdAt: DEMO_TIMELINE.decisionCreatedAt,
    },
  });
}

export function decisionIdentityFor(
  scenario: ScenarioData,
  firm: FirmData,
  configuration: DecisionConfiguration,
  claims: DecisionIdentityClaims,
): DecisionIdentity {
  const inputHash = decisionInputHashFor(scenario);
  const bundleHash = hashCanonicalPreimage(
    decisionBundlePreimageFor(scenario, firm, configuration),
  );
  const decisionHash = hashCanonicalPreimage(
    decisionRecordPreimageFor(scenario, firm, configuration, claims),
  );
  return {
    decisionId: `dec-${firm.id}-${decisionHash.slice(0, 24)}`,
    inputHash,
    decisionHash,
    bundleHash,
  };
}
