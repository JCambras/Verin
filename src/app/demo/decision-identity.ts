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
  DEMO_REVALIDATION_EVIDENCE_REF,
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
  "money-movement-demo-decision/4.0.0";
export const DEMO_DECISION_ENGINE_VERSION =
  "money-movement-demo-engine/3.0.0";

export interface DecisionAuthorityRequirementClaim {
  readonly order: number;
  readonly title: string;
  readonly requirement: string;
  readonly expiry: string | null;
  readonly escalation: string | null;
}

export interface DecisionIdentityClaims {
  readonly disposition: DispositionVM;
  readonly precedence: readonly PrecedenceRowVM[];
  readonly authority: {
    readonly reached: boolean;
    readonly requirements: readonly DecisionAuthorityRequirementClaim[];
  };
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
): JsonValue {
  return decisionInputPreimageForPhase(scenario, "initial", overrides);
}

export function refreshedDecisionInputPreimageFor(
  scenario: ScenarioData,
  overrides: DecisionInputOverrides = {},
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
  );
}

function decisionInputPreimageForPhase(
  scenario: ScenarioData,
  phase: "initial" | "revalidation",
  overrides: DecisionInputOverrides,
): JsonValue {
  const stalePlannedWithdrawals =
    scenario.spec.stalePlannedWithdrawals === true;
  const bankChanged = scenario.spec.bankChanged === true;
  const pendingActivity =
    phase === "initial"
      ? GC15_PENDING_DISTRIBUTION.before
      : GC15_PENDING_DISTRIBUTION.after;
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
        ref:
          overrides.evidenceRef ??
          (phase === "initial"
            ? DEMO_EVIDENCE_REF
            : DEMO_REVALIDATION_EVIDENCE_REF),
        retrievedAt:
          overrides.evidenceRetrievedAt ??
          pendingActivity.retrievedAt,
        availableCashMinor: SMITHS_LIQUIDITY.availableMinor,
        availableCashObservedAt: stalePlannedWithdrawals
          ? OBSERVED_GC09_BALANCE
          : OBSERVED_RECENT,
        pendingApprovedMinor: pendingActivity.amountMinor,
        pendingApprovedObservedAt: pendingActivity.observedAt,
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

export function decisionInputIdentitiesFor(
  scenario: ScenarioData,
): {
  readonly original: string;
  readonly refreshed: string | null;
} {
  return {
    original: decisionInputHashFor(scenario),
    refreshed:
      scenario.spec.invalidation === true
        ? hashCanonicalPreimage(
            refreshedDecisionInputPreimageFor(scenario),
          )
        : null,
  };
}

export function decisionAuthorityRequirementsFor(
  stages: readonly ApprovalStageVM[],
): readonly DecisionAuthorityRequirementClaim[] {
  return stages.map((stage, index) => ({
    order: index + 1,
    title: stage.title,
    requirement: stage.requirement,
    expiry: stage.expiry ?? null,
    escalation: stage.escalation ?? null,
  }));
}

export function approvalReceiptHashFor(
  decisionHash: string,
  stages: readonly ApprovalStageVM[] | null,
): string | null {
  if (stages === null) return null;
  return hashCanonicalPreimage(toJsonValue({
    hashKind: "money-movement-demo-approval-receipt",
    preimageVersion:
      "money-movement-demo-approval-receipt/1.0.0",
    payload: {
      decisionHash,
      stages,
    },
  }));
}

export function decisionBundlePreimageFor(
  scenario: ScenarioData,
  firm: FirmData,
  configuration: DecisionConfiguration,
): JsonValue {
  const inputPreimage = decisionInputPreimageFor(scenario);
  return toJsonValue({
    hashKind: "money-movement-demo-bundle",
    preimageVersion: "money-movement-demo-bundle/3.0.0",
    payload: {
      schemaVersion: DEMO_DECISION_SCHEMA_VERSION,
      canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
      engineVersion: DEMO_DECISION_ENGINE_VERSION,
      firmId: firm.id,
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
    preimageVersion: "money-movement-demo-record/3.0.0",
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
