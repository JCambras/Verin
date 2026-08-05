/**
 * CORPUS SEED - path-keyed deterministic derivation (v3 prompt 11, ADR-0034).
 *
 * Every generated value is a pure function of its own ADDRESS (`path` + `field`)
 * under one root seed. This is deliberately NOT a stateful stream PRNG: a stream
 * makes the corpus order-fragile, so inserting one household at position 3
 * reshuffles every subsequent value and churns every downstream fixture and
 * digest. Path-keyed derivation makes adding a household change exactly that
 * household's bytes - the property `corpus-determinism` fences directly.
 *
 * No clock, no locale, no `Math.random`: the only entropy source is SHA-256 over
 * the seed string. The AST ban in the determinism fence keeps it that way.
 */
import { createHash } from "node:crypto";

/** Root seed. A STRING, never a number, so it is readable in the manifest.
 * It is NOT a second corpus version: signoff and `corpusDigest` bind to
 * `spec.world.corpusVersion`, the only source of truth for that value. */
export const CORPUS_SEED = "verin-corpus/2026.07.0";

/** ASCII unit separator - cannot appear in a path or field name, so
 * derive("aU+001Fb", "c") and derive("a", "bU+001Fc") cannot collide. */
const SEPARATOR = "\u001f";

const assertNoSeparator = (label: string, value: string): void => {
  if (value.includes(SEPARATOR)) {
    throw new Error(`corpus seed: ${label} "${value}" contains the reserved unit separator`);
  }
};

/** The single derivation primitive: a uint64 keyed by (seed, path, field). */
export function derive(seed: string, path: string, field: string): bigint {
  assertNoSeparator("path", path);
  assertNoSeparator("field", field);
  return createHash("sha256")
    .update(`${seed}${SEPARATOR}${path}${SEPARATOR}${field}`, "utf8")
    .digest()
    .readBigUInt64BE(0);
}

/** A uniform-enough index into `cardinality` slots. */
export function deriveIndex(seed: string, path: string, field: string, cardinality: number): number {
  if (!Number.isSafeInteger(cardinality) || cardinality <= 0) {
    throw new Error(`corpus seed: cardinality must be a positive integer, got ${cardinality}`);
  }
  return Number(derive(seed, path, field) % BigInt(cardinality));
}

/** An integer in [min, max] inclusive. */
export function deriveIntInRange(
  seed: string,
  path: string,
  field: string,
  min: number,
  max: number,
): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
    throw new Error(`corpus seed: bad range [${min}, ${max}]`);
  }
  return min + deriveIndex(seed, path, field, max - min + 1);
}

/** A lowercase-hex opaque token of `bytes` bytes - the only identifier form the
 * real-derived partition may carry for a scrubbed value (docs/corpus-scrub-procedure.md). */
export function deriveToken(seed: string, path: string, field: string, bytes = 8): string {
  return createHash("sha256")
    .update(`${seed}${SEPARATOR}${path}${SEPARATOR}${field}${SEPARATOR}token`, "utf8")
    .digest()
    .subarray(0, bytes)
    .toString("hex");
}
