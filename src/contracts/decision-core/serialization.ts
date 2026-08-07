/**
 * Canonical serialization for replay (v3 §5 replay metadata; ADR-0029, D-040).
 * Versioned, domain-separated projections define the bundle and decision hash
 * preimages; fixtures lock their canonical byte form and SHA-256 digest.
 */
import type { Result } from "../result";
import { err, ok } from "../result";
import { validationError, type AppError } from "../errors";
import { normalizeScopedReferences } from "./ids";
import type { DecisionInputBundle } from "./evidence";
import { normalizeDecisionRecordV1_7, type DecisionRecord } from "./decision";
import { isPlainRecord } from "./normalization";
import { canonicalizeTimeZoneForRecordedRelease } from "../time-zone";
export const CANONICAL_SERIALIZER_VERSION = "1.0.0";
export const DECISION_CORE_SCHEMA_VERSION = "1.7.0";
const BUNDLE_HASH_PREIMAGE_VERSION_1_7 = "decision-input-bundle/1.7.0";
const DECISION_HASH_PREIMAGE_VERSION_1_7 = "decision-record/1.7.0";
export const BUNDLE_HASH_PREIMAGE_VERSION = BUNDLE_HASH_PREIMAGE_VERSION_1_7;
export const DECISION_HASH_PREIMAGE_VERSION = DECISION_HASH_PREIMAGE_VERSION_1_7;
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
const BUNDLE_HASH_PAYLOAD_KEYS_1_7 = [
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
] as const;
const DECISION_HASH_PAYLOAD_KEYS_1_7 = [
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
] as const;
export const BUNDLE_HASH_PAYLOAD_KEYS = exactProjectionKeys<BundleHashPayload>()(
  BUNDLE_HASH_PAYLOAD_KEYS_1_7,
);
export const DECISION_HASH_PAYLOAD_KEYS = exactProjectionKeys<DecisionHashPayload>()(
  DECISION_HASH_PAYLOAD_KEYS_1_7,
);
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
type NormalizableDecisionInputBundle = {
  readonly householdInstructionVersionRefs: readonly {
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
const normalizeDecisionInputBundleV1_7 = <
  T extends NormalizableDecisionInputBundle,
>(
  bundle: T,
): T =>
  ({
    ...bundle,
    householdInstructionVersionRefs: normalizeScopedReferences(
      bundle.householdInstructionVersionRefs,
    ),
    evidenceSnapshotRefs: normalizeScopedReferences(
      bundle.evidenceSnapshotRefs,
    ),
    timeZone: canonicalizeTimeZoneForRecordedRelease(
      bundle.timeZoneDataVersion,
      bundle.timeZone,
    ),
  }) as T;
export function bundleHashPreimageV1_7(bundle: DecisionInputBundle): BundleHashPreimage {
  const payload = normalizeOptionalProperties(
    projectDefined(bundle, BUNDLE_HASH_PAYLOAD_KEYS_1_7),
  );
  return {
    hashKind: "decision-input-bundle",
    preimageVersion: BUNDLE_HASH_PREIMAGE_VERSION_1_7,
    payload: normalizeDecisionInputBundleV1_7(payload),
  };
}
export function decisionHashPreimageV1_7(record: DecisionRecord): DecisionHashPreimage {
  const payload = normalizeOptionalProperties(
    projectDefined(record, DECISION_HASH_PAYLOAD_KEYS_1_7),
  );
  return {
    hashKind: "decision-record",
    preimageVersion: DECISION_HASH_PREIMAGE_VERSION_1_7,
    payload: normalizeDecisionRecordV1_7(payload),
  };
}
export function bundleHashPreimage(bundle: DecisionInputBundle): BundleHashPreimage {
  return bundleHashPreimageV1_7(bundle);
}
export function decisionHashPreimage(record: DecisionRecord): DecisionHashPreimage {
  return decisionHashPreimageV1_7(record);
}
function projectDefined<T extends object, const K extends readonly (keyof T)[]>(value: T, keys: K): Pick<T, K[number]> {
  return Object.fromEntries(
    keys.flatMap((key) => (value[key] === undefined ? [] : [[key, value[key]]])),
  ) as Pick<T, K[number]>;
}
class CanonicalizationRefusal {
  constructor(readonly reason: string) {}
}
type Trail = { readonly parent: Trail; readonly key: string } | null;
function describeTrail(trail: Trail): string {
  const segments: string[] = [];
  for (let node = trail; node !== null; node = node.parent) segments.push(node.key);
  return segments.length === 0 ? "value" : `value.${segments.reverse().join(".")}`;
}
/**
 * Drops explicitly-undefined optional keys so an absent field spelled `undefined`
 * hashes identically to one omitted. A NON-plain object passes through untouched:
 * rebuilding one from its own entries would flatten a Date/Map/class instance to `{}`
 * and hash it as `{}` - different decision inputs collapsing onto one bundleHash - and
 * would make canonicalJson's refusal unreachable on the only path that reaches it.
 */
function normalizeOptionalProperties<T>(value: T): T {
  type Task =
    | {
        readonly kind: "visit";
        readonly input: unknown;
        readonly assign: (normalized: unknown) => void;
      }
    | { readonly kind: "leave"; readonly input: object };
  const ancestors = new Set<object>();
  let normalized: unknown = value;
  const tasks: Task[] = [{
    kind: "visit",
    input: value,
    assign: (result) => {
      normalized = result;
    },
  }];
  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === "leave") {
      ancestors.delete(task.input);
      continue;
    }
    const input = task.input;
    if (
      input === null ||
      typeof input !== "object" ||
      (!Array.isArray(input) && !isPlainRecord(input))
    ) {
      task.assign(input);
      continue;
    }
    if (ancestors.has(input)) {
      task.assign(input);
      continue;
    }
    ancestors.add(input);
    tasks.push({ kind: "leave", input });
    if (Array.isArray(input)) {
      const output = new Array<unknown>(input.length);
      task.assign(output);
      for (let index = input.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(input, index)) continue;
        tasks.push({
          kind: "visit",
          input: input[index],
          assign: (result) => {
            output[index] = result;
          },
        });
      }
      continue;
    }
    const output: Record<string, unknown> = {};
    task.assign(output);
    for (const [key, nested] of Object.entries(input).reverse()) {
      if (nested === undefined) continue;
      tasks.push({
        kind: "visit",
        input: nested,
        assign: (result) => {
          output[key] = result;
        },
      });
    }
  }
  return normalized as T;
}
/**
 * Fails on values JSON cannot round-trip instead of silently coercing them.
 */
export function canonicalJsonV1(value: JsonValue | BundleHashPreimage | DecisionHashPreimage): Result<string, AppError> {
  try {
    return ok(serializeV1(value as JsonValue));
  } catch (e) {
    return err(validationError(e instanceof CanonicalizationRefusal ? e.reason : "value is not canonically serializable"));
  }
}
export function canonicalJson(
  value: JsonValue | BundleHashPreimage | DecisionHashPreimage,
): Result<string, AppError> {
  return canonicalJsonV1(value);
}
/**
 * The path to the node being serialized, as a parent link rather than an array, so
 * descending costs O(1) per node instead of copying the whole path at every step -
 * this serializer will run over data-driven explanation trees whose depth is not
 * bounded by the schema. The readable form is built ONLY when a refusal is raised.
 */
/**
 * `ancestors` holds the objects on the path from the root to `value`, so a cycle is
 * REFUSED BY NAME rather than by exhausting the call stack - a RangeError would
 * surface as the generic "not canonically serializable" and would depend on the
 * host's stack depth for whether it was caught at all.
 */
function serializeV1(value: JsonValue): string {
  type Task =
    | {
        readonly kind: "visit";
        readonly value: unknown;
        readonly trail: Trail;
      }
    | { readonly kind: "text"; readonly value: string }
    | { readonly kind: "leave"; readonly value: object };
  const ancestors = new Set<object>();
  const output: string[] = [];
  const tasks: Task[] = [{ kind: "visit", value, trail: null }];
  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === "text") {
      output.push(task.value);
      continue;
    }
    if (task.kind === "leave") {
      ancestors.delete(task.value);
      continue;
    }
    const current = task.value;
    if (current === null) {
      output.push("null");
      continue;
    }
    switch (typeof current) {
      case "string":
        output.push(JSON.stringify(current));
        break;
      case "boolean":
        output.push(current ? "true" : "false");
        break;
      case "number":
        if (!Number.isFinite(current)) {
          throw new CanonicalizationRefusal(
            `${describeTrail(task.trail)}: non-finite number cannot be canonicalized`,
          );
        }
        output.push(JSON.stringify(current));
        break;
      case "object": {
        if (ancestors.has(current)) {
          throw new CanonicalizationRefusal(
            `${describeTrail(task.trail)}: circular reference cannot be canonicalized`,
          );
        }
        if (!Array.isArray(current) && !isPlainRecord(current)) {
          throw new CanonicalizationRefusal(
            `${describeTrail(task.trail)}: only plain objects can be canonicalized`,
          );
        }
        ancestors.add(current);
        tasks.push({ kind: "leave", value: current });
        if (Array.isArray(current)) {
          tasks.push({ kind: "text", value: "]" });
          for (let index = current.length - 1; index >= 0; index -= 1) {
            if (!Object.hasOwn(current, index)) {
              throw new CanonicalizationRefusal(
                `${describeTrail(task.trail)}.${index}: sparse array holes cannot be canonicalized`,
              );
            }
            tasks.push({
              kind: "visit",
              value: current[index],
              trail: { parent: task.trail, key: String(index) },
            });
            if (index > 0) tasks.push({ kind: "text", value: "," });
          }
          tasks.push({ kind: "text", value: "[" });
          break;
        }
        const keys = Object.keys(current).sort();
        tasks.push({ kind: "text", value: "}" });
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const key = keys[index]!;
          const nested = current[key];
          if (nested === undefined) {
            throw new CanonicalizationRefusal(
              `${describeTrail(task.trail)}.${key}: undefined cannot be canonicalized`,
            );
          }
          tasks.push({
            kind: "visit",
            value: nested,
            trail: { parent: task.trail, key },
          });
          tasks.push({ kind: "text", value: ":" });
          tasks.push({ kind: "text", value: JSON.stringify(key) });
          if (index > 0) tasks.push({ kind: "text", value: "," });
        }
        tasks.push({ kind: "text", value: "{" });
        break;
      }
      default:
        throw new CanonicalizationRefusal(
          `${describeTrail(task.trail)}: ${typeof current} cannot be canonicalized`,
        );
    }
  }
  return output.join("");
}
