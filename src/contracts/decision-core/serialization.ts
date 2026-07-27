/**
 * Canonical serialization for replay (v3 §5 replay metadata; ADR-0029, D-040).
 * Versioned, domain-separated projections define the bundle and decision hash
 * preimages; fixtures lock their canonical byte form and SHA-256 digest.
 */
import type { Result } from "../result";
import { err, ok } from "../result";
import { validationError, type AppError } from "../errors";
import { compareScopedReferences } from "./ids";
import type { DecisionInputBundle } from "./evidence";
import type { DecisionRecord } from "./decision";
export const CANONICAL_SERIALIZER_VERSION = "1.0.0";
export const DECISION_CORE_SCHEMA_VERSION = "1.7.0";
export const BUNDLE_HASH_PREIMAGE_VERSION = "decision-input-bundle/1.7.0";
export const DECISION_HASH_PREIMAGE_VERSION = "decision-record/1.7.0";
/**
 * SHA-256 over each projection's emitted JSON Schema, so optional nested growth
 * cannot slip into a preimage without a version bump.
 *
 * MAINTENANCE: the digest is taken over Zod's JSON Schema EMITTER output, which is a
 * representation detail, not a property of these contracts. A Zod upgrade that only
 * changes how an unchanged schema is emitted ($defs naming, `additionalProperties`,
 * `required` ordering) legitimately RE-PINS these two digests - WITHOUT a preimage
 * version bump and WITHOUT regenerating any recorded bundleHash/decisionHash, which
 * are hashes of canonical payload bytes and are untouched by an emitter change. The
 * re-pin is allowed only after evidence that the schemas' own semantics AND the
 * canonical projection bytes are unchanged (the fixture digest tests below must pass
 * unmodified). Anything else is a real projection change: bump the version and carry
 * a migration story. The fingerprint stays blocking precisely so a dependency bump
 * cannot alter the contract silently.
 */
export const HASH_PROJECTION_SCHEMA_FINGERPRINTS: Readonly<
  Record<typeof BUNDLE_HASH_PREIMAGE_VERSION | typeof DECISION_HASH_PREIMAGE_VERSION, string>
> = {
  [BUNDLE_HASH_PREIMAGE_VERSION]: "2087306d7834c731420550d14b14128b2ce1a3bafe0e2df75622098994f73efc",
  [DECISION_HASH_PREIMAGE_VERSION]: "9c45859468cd259e16037894a24117bbb431a1c5a839a519a7d0b624d549816c",
};
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type BundleHashPayload = Omit<DecisionInputBundle, "id" | "bundleHash">;
type DecisionHashPayload = Omit<DecisionRecord, "decisionHash">;
const exactProjectionKeys =
  <T extends object>() =>
  <const K extends readonly (keyof T)[]>(
    keys: K & Record<Exclude<keyof T, K[number]>, never>,
  ): K =>
    keys;
export const BUNDLE_HASH_PAYLOAD_KEYS = exactProjectionKeys<BundleHashPayload>()([
  "firmId",
  "schemaVersion",
  "canonicalSerializerVersion",
  "engineVersion",
  "primitiveSetVersion",
  "domainConfigVersionRef",
  "policyVersionRef",
  "householdInstructionVersionRefs",
  "evidenceSnapshotRefs",
  "asOf",
  "timeZone",
  "timeZoneDataVersion",
] as const);
export const DECISION_HASH_PAYLOAD_KEYS = exactProjectionKeys<DecisionHashPayload>()([
  "firmId",
  "id",
  "intentRef",
  "inputBundleRef",
  "result",
  "precedenceTrace",
  "explanationTrace",
  "riskClass",
  "reversibility",
  "reevaluateWhen",
  "derivedFromDecisionRef",
  "createdBy",
  "createdAt",
] as const);
export type BundleHashPreimage = Readonly<{
  readonly hashKind: "decision-input-bundle";
  readonly preimageVersion: typeof BUNDLE_HASH_PREIMAGE_VERSION;
  readonly payload: BundleHashPayload;
}>;
export type DecisionHashPreimage = Readonly<{
  readonly hashKind: "decision-record";
  readonly preimageVersion: typeof DECISION_HASH_PREIMAGE_VERSION;
  readonly payload: DecisionHashPayload;
}>;
export function bundleHashPreimage(bundle: DecisionInputBundle): BundleHashPreimage {
  return {
    hashKind: "decision-input-bundle",
    preimageVersion: BUNDLE_HASH_PREIMAGE_VERSION,
    payload: {
      ...projectDefined(bundle, BUNDLE_HASH_PAYLOAD_KEYS),
      householdInstructionVersionRefs: [...bundle.householdInstructionVersionRefs].sort(compareScopedReferences),
      evidenceSnapshotRefs: [...bundle.evidenceSnapshotRefs].sort(compareScopedReferences),
    },
  };
}
export function decisionHashPreimage(record: DecisionRecord): DecisionHashPreimage {
  return {
    hashKind: "decision-record",
    preimageVersion: DECISION_HASH_PREIMAGE_VERSION,
    payload: projectDefined(record, DECISION_HASH_PAYLOAD_KEYS),
  };
}
function projectDefined<T extends object, const K extends readonly (keyof T)[]>(value: T, keys: K): Pick<T, K[number]> {
  return Object.fromEntries(
    keys.flatMap((key) => (value[key] === undefined ? [] : [[key, normalizeOptionalProperties(value[key])]])),
  ) as Pick<T, K[number]>;
}
function normalizeOptionalProperties<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeOptionalProperties) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nested]) =>
        nested === undefined ? [] : [[key, normalizeOptionalProperties(nested)]],
      ),
    ) as T;
  }
  return value;
}
/**
 * Fails on values JSON cannot round-trip instead of silently coercing them.
 */
export function canonicalJson(value: JsonValue | BundleHashPreimage | DecisionHashPreimage): Result<string, AppError> {
  try {
    return ok(serialize(value as JsonValue, null, new Set()));
  } catch (e) {
    return err(validationError(e instanceof CanonicalizationRefusal ? e.reason : "value is not canonically serializable"));
  }
}
class CanonicalizationRefusal {
  constructor(readonly reason: string) {}
}
/**
 * The path to the node being serialized, as a parent link rather than an array, so
 * descending costs O(1) per node instead of copying the whole path at every step -
 * this serializer will run over data-driven explanation trees whose depth is not
 * bounded by the schema. The readable form is built ONLY when a refusal is raised.
 */
type Trail = { readonly parent: Trail; readonly key: string } | null;
function describeTrail(trail: Trail): string {
  const segments: string[] = [];
  for (let node = trail; node !== null; node = node.parent) segments.push(node.key);
  return segments.length === 0 ? "value" : `value.${segments.reverse().join(".")}`;
}
/**
 * `ancestors` holds the objects on the path from the root to `value`, so a cycle is
 * REFUSED BY NAME rather than by exhausting the call stack - a RangeError would
 * surface as the generic "not canonically serializable" and would depend on the
 * host's stack depth for whether it was caught at all.
 */
function serialize(value: JsonValue, trail: Trail, ancestors: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizationRefusal(`${describeTrail(trail)}: non-finite number cannot be canonicalized`);
      }
      return JSON.stringify(value);
    case "object": {
      if (ancestors.has(value)) {
        throw new CanonicalizationRefusal(`${describeTrail(trail)}: circular reference cannot be canonicalized`);
      }
      ancestors.add(value);
      try {
        return serializeObject(value, trail, ancestors);
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw new CanonicalizationRefusal(`${describeTrail(trail)}: ${typeof value} cannot be canonicalized`);
  }
}
function serializeObject(value: object, trail: Trail, ancestors: Set<object>): string {
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.hasOwn(value, i)) {
        throw new CanonicalizationRefusal(`${describeTrail(trail)}.${i}: sparse array holes cannot be canonicalized`);
      }
      items.push(serialize(value[i] as JsonValue, { parent: trail, key: String(i) }, ancestors));
    }
    return `[${items.join(",")}]`;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new CanonicalizationRefusal(`${describeTrail(trail)}: only plain objects can be canonicalized`);
  }
  const entries = Object.keys(value)
    .sort()
    .map((k) => {
      const v = (value as Record<string, JsonValue | undefined>)[k];
      if (v === undefined) {
        throw new CanonicalizationRefusal(`${describeTrail(trail)}.${k}: undefined cannot be canonicalized`);
      }
      return `${JSON.stringify(k)}:${serialize(v, { parent: trail, key: k }, ancestors)}`;
    });
  return `{${entries.join(",")}}`;
}
