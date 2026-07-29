import { normalizeScopedReferences } from "../v1-7/ids";
import type { DecisionRecordV1_7_0 } from "../v1-7/decision";
import type { DecisionInputBundleV1_8_0 } from "./evidence";
import { canonicalizeTimeZoneForRecordedRelease } from "../v1-7/time-zone";
import {
  BUNDLE_HASH_PAYLOAD_KEYS_V1_7_0,
  BUNDLE_HASH_PREIMAGE_V1_7_0,
  CANONICAL_SERIALIZER_V1_0_0,
  DECISION_CORE_SCHEMA_V1_7_0,
  DECISION_HASH_PAYLOAD_KEYS_V1_7_0,
  DECISION_HASH_PREIMAGE_V1_7_0,
  HASH_PROJECTION_SCHEMA_FINGERPRINTS as V1_7_FINGERPRINTS,
  bundleHashPreimageV1_7_0,
  canonicalJsonV1_0_0,
  decisionHashPreimageV1_7_0,
  normalizeDecisionInputBundleV1_7_0,
  type DecisionHashPreimage,
  type JsonValue,
} from "../v1-7/serialization";

export {
  BUNDLE_HASH_PAYLOAD_KEYS_V1_7_0,
  BUNDLE_HASH_PREIMAGE_V1_7_0,
  CANONICAL_SERIALIZER_V1_0_0,
  DECISION_CORE_SCHEMA_V1_7_0,
  DECISION_HASH_PAYLOAD_KEYS_V1_7_0,
  DECISION_HASH_PREIMAGE_V1_7_0,
  bundleHashPreimageV1_7_0,
  canonicalJsonV1_0_0,
  decisionHashPreimageV1_7_0,
  normalizeDecisionInputBundleV1_7_0,
  type DecisionHashPreimage,
  type JsonValue,
};

export const DECISION_CORE_SCHEMA_V1_8_0 = "1.8.0";
export const CANONICAL_SERIALIZER_VERSION = CANONICAL_SERIALIZER_V1_0_0;
export const DECISION_CORE_SCHEMA_VERSION = "1.8.0";
export const BUNDLE_HASH_PREIMAGE_V1_8_0 = "decision-input-bundle/1.8.0";
export const BUNDLE_HASH_PREIMAGE_VERSION = "decision-input-bundle/1.8.0";
export const DECISION_HASH_PREIMAGE_VERSION = DECISION_HASH_PREIMAGE_V1_7_0;

type BundleHashPayloadV1_8_0 = Omit<
  DecisionInputBundleV1_8_0,
  "id" | "bundleHash"
>;

const exactProjectionKeys =
  <T extends object>() =>
  <const K extends readonly (keyof T)[]>(
    keys: K & Record<Exclude<keyof T, K[number]>, never>,
  ): K =>
    keys;

export const BUNDLE_HASH_PAYLOAD_KEYS_V1_8_0 =
  exactProjectionKeys<BundleHashPayloadV1_8_0>()([
    "firmId",
    "schemaVersion",
    "canonicalSerializerVersion",
    "engineVersion",
    "primitiveSetVersion",
    "domainConfigVersionRef",
    "policyVersionRef",
    "householdInstructionVersionRefs",
    "regulatoryVersionRefs",
    "evidenceSnapshotRefs",
    "asOf",
    "timeZone",
    "timeZoneDataVersion",
  ] as const);
export const BUNDLE_HASH_PAYLOAD_KEYS = [
  ...BUNDLE_HASH_PAYLOAD_KEYS_V1_8_0,
] as const;
export const DECISION_HASH_PAYLOAD_KEYS = [
  ...DECISION_HASH_PAYLOAD_KEYS_V1_7_0,
] as const;

export type BundleHashPreimage = Readonly<{
  readonly hashKind: "decision-input-bundle";
  readonly preimageVersion: typeof BUNDLE_HASH_PREIMAGE_V1_8_0;
  readonly payload: BundleHashPayloadV1_8_0;
}>;

type NormalizableDecisionInputBundle = {
  readonly householdInstructionVersionRefs: readonly {
    readonly firmId: string;
    readonly id: string;
  }[];
  readonly regulatoryVersionRefs: readonly {
    readonly firmId: string;
    readonly id: string;
  }[];
  readonly evidenceSnapshotRefs: readonly {
    readonly firmId: string;
    readonly id: string;
  }[];
  readonly timeZone: string;
  readonly timeZoneDataVersion: string;
};

export const normalizeDecisionInputBundleV1_8_0 = <
  T extends NormalizableDecisionInputBundle,
>(
  bundle: T,
): T =>
  ({
    ...bundle,
    householdInstructionVersionRefs: normalizeScopedReferences(
      bundle.householdInstructionVersionRefs,
    ),
    regulatoryVersionRefs: normalizeScopedReferences(
      bundle.regulatoryVersionRefs,
    ),
    evidenceSnapshotRefs: normalizeScopedReferences(
      bundle.evidenceSnapshotRefs,
    ),
    timeZone: canonicalizeTimeZoneForRecordedRelease(
      bundle.timeZoneDataVersion,
      bundle.timeZone,
    ),
  }) as T;

export const normalizeDecisionInputBundle = <
  T extends NormalizableDecisionInputBundle,
>(
  bundle: T,
): T => normalizeDecisionInputBundleV1_8_0(bundle);

export function bundleHashPreimageV1_8_0(
  bundle: DecisionInputBundleV1_8_0,
): BundleHashPreimage {
  return {
    hashKind: "decision-input-bundle",
    preimageVersion: BUNDLE_HASH_PREIMAGE_V1_8_0,
    payload: normalizeDecisionInputBundleV1_8_0({
      firmId: bundle.firmId,
      schemaVersion: bundle.schemaVersion,
      canonicalSerializerVersion: bundle.canonicalSerializerVersion,
      engineVersion: bundle.engineVersion,
      primitiveSetVersion: bundle.primitiveSetVersion,
      domainConfigVersionRef: bundle.domainConfigVersionRef,
      policyVersionRef: bundle.policyVersionRef,
      householdInstructionVersionRefs:
        bundle.householdInstructionVersionRefs,
      regulatoryVersionRefs: bundle.regulatoryVersionRefs,
      evidenceSnapshotRefs: bundle.evidenceSnapshotRefs,
      asOf: bundle.asOf,
      timeZone: bundle.timeZone,
      timeZoneDataVersion: bundle.timeZoneDataVersion,
    }),
  };
}

export function bundleHashPreimage(
  bundle: DecisionInputBundleV1_8_0,
): BundleHashPreimage {
  return bundleHashPreimageV1_8_0(bundle);
}

export function decisionHashPreimage(
  record: DecisionRecordV1_7_0,
): DecisionHashPreimage {
  return decisionHashPreimageV1_7_0(record);
}

export function canonicalJson(
  value: JsonValue | BundleHashPreimage | DecisionHashPreimage,
) {
  return canonicalJsonV1_0_0(value as JsonValue);
}

export const HASH_PROJECTION_SCHEMA_FINGERPRINTS: Readonly<
  Record<
    typeof BUNDLE_HASH_PREIMAGE_V1_8_0 | typeof DECISION_HASH_PREIMAGE_V1_7_0,
    string
  >
> = {
  [BUNDLE_HASH_PREIMAGE_V1_8_0]:
    "0305f82305d8e549cf7c3d40f565808767fc17e1c0d3dd99192972e559913394",
  [DECISION_HASH_PREIMAGE_V1_7_0]:
    V1_7_FINGERPRINTS[DECISION_HASH_PREIMAGE_V1_7_0],
};
