/**
 * Canonical serialization for replay (v3 §5 replay metadata; ADR-0029, D-036).
 * Versioned, domain-separated projections define the bundle and decision hash
 * preimages; fixtures lock their canonical byte form and SHA-256 digest.
 */
import type { Result } from "../result";
import { err, ok } from "../result";
import { validationError, type AppError } from "../errors";
import type { DecisionInputBundle } from "./evidence";
import type { DecisionRecord } from "./decision";
export const CANONICAL_SERIALIZER_VERSION = "1.0.0";
export const DECISION_CORE_SCHEMA_VERSION = "1.0.0";
export const BUNDLE_HASH_PREIMAGE_VERSION = "decision-input-bundle/1.0.0";
export const DECISION_HASH_PREIMAGE_VERSION = "decision-record/1.0.0";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type BundleHashPayload = Omit<DecisionInputBundle, "id" | "bundleHash">;
type DecisionHashPayload = Omit<DecisionRecord, "decisionHash">;
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
      firmId: bundle.firmId,
      schemaVersion: bundle.schemaVersion,
      canonicalSerializerVersion: bundle.canonicalSerializerVersion,
      engineVersion: bundle.engineVersion,
      primitiveSetVersion: bundle.primitiveSetVersion,
      domainConfigVersionId: bundle.domainConfigVersionId,
      policyVersionId: bundle.policyVersionId,
      householdInstructionVersionIds: [...bundle.householdInstructionVersionIds].sort(),
      evidenceSnapshotIds: [...bundle.evidenceSnapshotIds].sort(),
      asOf: bundle.asOf,
      timeZone: bundle.timeZone,
    },
  };
}
export function decisionHashPreimage(record: DecisionRecord): DecisionHashPreimage {
  return {
    hashKind: "decision-record",
    preimageVersion: DECISION_HASH_PREIMAGE_VERSION,
    payload: {
      firmId: record.firmId,
      id: record.id,
      intentId: record.intentId,
      inputBundleId: record.inputBundleId,
      result: record.result,
      precedenceTrace: record.precedenceTrace,
      explanationTrace: record.explanationTrace,
      riskClass: record.riskClass,
      reversibility: record.reversibility,
      reevaluateWhen: record.reevaluateWhen,
      ...(record.derivedFromDecisionId === undefined ? {} : { derivedFromDecisionId: record.derivedFromDecisionId }),
      createdBy: record.createdBy,
      createdAt: record.createdAt,
    },
  };
}
/**
 * Fails on values JSON cannot round-trip instead of silently coercing them.
 */
export function canonicalJson(value: JsonValue | BundleHashPreimage | DecisionHashPreimage): Result<string, AppError> {
  try {
    return ok(serialize(value as JsonValue, []));
  } catch (e) {
    return err(validationError(e instanceof CanonicalizationRefusal ? e.reason : "value is not canonically serializable"));
  }
}
class CanonicalizationRefusal {
  constructor(readonly reason: string) {}
}
function serialize(value: JsonValue, path: readonly string[]): string {
  const at = path.length === 0 ? "value" : `value.${path.join(".")}`;
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationRefusal(`${at}: non-finite number cannot be canonicalized`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => serialize(v, [...path, String(i)])).join(",")}]`;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new CanonicalizationRefusal(`${at}: only plain objects can be canonicalized`);
      }
      const keys = Object.keys(value).sort();
      const entries = keys.map((k) => {
        const v = (value as Record<string, JsonValue | undefined>)[k];
        if (v === undefined) throw new CanonicalizationRefusal(`${at}.${k}: undefined cannot be canonicalized`);
        return `${JSON.stringify(k)}:${serialize(v, [...path, k])}`;
      });
      return `{${entries.join(",")}}`;
    }
    default:
      throw new CanonicalizationRefusal(`${at}: ${typeof value} cannot be canonicalized`);
  }
}
