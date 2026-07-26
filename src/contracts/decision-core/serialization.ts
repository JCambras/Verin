/**
 * Canonical serialization for replay (v3 §5 replay metadata; ADR-0029, D-036).
 * ONE byte form per value: object keys sorted lexicographically at every depth,
 * arrays in order, no insignificant whitespace. bundleHash/decisionHash are hashes
 * OF this form - byte-identical replay (prompt 19) depends on it, which is why
 * the serializer is versioned and the version is pinned inside every
 * DecisionInputBundle. Committed fixtures under fixtures/decision-core/ lock the
 * byte form; changing it is a serializer version bump, never a silent drift.
 */
import type { Result } from "../result";
import { err, ok } from "../result";
import { validationError, type AppError } from "../errors";

/** Bump ONLY with a migration story: recorded hashes bind to the old form. */
export const CANONICAL_SERIALIZER_VERSION = "1.0.0";

/** The decision-core contract-shape version pinned into DecisionInputBundle.schemaVersion. */
export const DECISION_CORE_SCHEMA_VERSION = "1.0.0";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Serialize to the canonical byte form. Fails (never silently coerces) on values
 * JSON cannot round-trip: non-finite numbers, undefined, functions, or class
 * instances hiding behind the JsonValue type.
 */
export function canonicalJson(value: JsonValue): Result<string, AppError> {
  try {
    return ok(serialize(value, []));
  } catch (e) {
    return err(validationError(e instanceof CanonicalizationRefusal ? e.reason : "value is not canonically serializable"));
  }
}

/** Internal control-flow signal - never escapes canonicalJson. */
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
