/**
 * WORLD DERIVATION PRIMITIVES (ADR-0057).
 *
 * The populated world reuses the replay corpus's derivation discipline rather
 * than inventing a second one: `derive*` from `scripts/corpus/seed.ts` (SHA-256
 * keyed by seed + path + field, never a stream PRNG) and the instant arithmetic
 * from `scripts/corpus/clock.ts`. Path-keying is what makes household #37's
 * bytes independent of whether household #12 exists, so adding a household
 * changes exactly that household's file.
 *
 * There is no wall clock, no `Math.random`, no locale API and no float here -
 * the `world-determinism` fence bans all four across `scripts/world/**`.
 */
import { deriveIndex, deriveIntInRange, deriveToken } from "../corpus/seed";
import { addDays, addSeconds, epochMs } from "../corpus/clock";
import { nfc } from "../corpus/_util";

export { addDays, addSeconds, epochMs };

/** One deterministic choice out of a non-empty list, keyed by its own address. */
export function pick<T>(seed: string, path: string, field: string, options: readonly T[]): T {
  if (options.length === 0) throw new Error(`world derive: no options at ${path}.${field}`);
  return options[deriveIndex(seed, path, field, options.length)]!;
}

/**
 * `count` DISTINCT choices, in the list's own order. Walks the list from a
 * derived start and takes every `stride`-th entry, so the result is stable,
 * distinct by construction, and never a rejection loop whose iteration count
 * depends on earlier draws.
 */
export function pickDistinct<T>(
  seed: string,
  path: string,
  field: string,
  options: readonly T[],
  count: number,
): T[] {
  const total = options.length;
  if (count > total) throw new Error(`world derive: cannot take ${count} distinct of ${total} at ${path}.${field}`);
  const start = deriveIndex(seed, path, `${field}/start`, total);
  // A stride coprime with the list length visits every slot before repeating;
  // forcing it odd against an even length is not enough, so it is searched
  // deterministically from a derived candidate.
  let stride = 1 + deriveIndex(seed, path, `${field}/stride`, total - 1);
  while (gcd(stride, total) !== 1) stride = (stride % (total - 1)) + 1;
  const taken: T[] = [];
  for (let step = 0; step < count; step += 1) {
    taken.push(options[(start + step * stride) % total]!);
  }
  return taken;
}

function gcd(left: number, right: number): number {
  return right === 0 ? left : gcd(right, left % right);
}

/** An integer in [min, max], keyed by its address. */
export const intBetween = (seed: string, path: string, field: string, min: number, max: number): number =>
  deriveIntInRange(seed, path, field, min, max);

/** A money amount in whole dollars, rendered as integer minor units - never a
 * float, and never a value with meaningless cents on a synthetic balance. */
export const dollars = (seed: string, path: string, field: string, minDollars: number, maxDollars: number): number =>
  deriveIntInRange(seed, path, field, minDollars, maxDollars) * 100;

/** A masked account number: the last four digits are all a surface ever shows. */
export const maskedAccountNumber = (seed: string, path: string, field: string): string =>
  `····${String(deriveIntInRange(seed, path, field, 1000, 9999))}`;

export const lastFour = (seed: string, path: string, field: string): string =>
  String(deriveIntInRange(seed, path, field, 1000, 9999));

/**
 * A deterministic UUID for a world record. The house CRM parses household ids
 * with `parseMachineRecordId`, which accepts only the canonical UUID shape, so
 * every world id is minted in that shape from the path digest - version 4 bits
 * and RFC 4122 variant included, because a record id that merely looks
 * hex-shaped is the kind of thing a later validator rejects at the worst moment.
 */
export function uuidFor(seed: string, path: string, field: string): string {
  const hex = deriveToken(seed, path, field, 16);
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/** The ISO calendar day of an instant - the `YYYY-MM-DD` prefix, nothing more. */
export const dayOf = (instant: string): string => instant.slice(0, 10);

/** An instant `minDays`..`maxDays` BEFORE the world's asOf. */
export const daysBefore = (
  seed: string,
  path: string,
  field: string,
  asOf: string,
  minDays: number,
  maxDays: number,
): string => addSeconds(addDays(asOf, -intBetween(seed, path, field, minDays, maxDays)), -intBetween(seed, path, `${field}/seconds`, 0, 43_200));

/** The `YYYY-MM` of an instant. */
export const monthOf = (instant: string): string => instant.slice(0, 7);

/** NFC everywhere, so two spellings of one name are never two people. */
export const text = (value: string): string => nfc(value);

/** Whole-number percentage split of `totalMinor` across `weights`, with the
 * remainder given to the largest weight so the parts always sum to the whole.
 * Integer arithmetic: a float split is how a fixture ends up $0.01 short. */
export function splitMinor(totalMinor: number, weights: readonly number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) throw new Error("world derive: split weights must sum above zero");
  const parts = weights.map((weight) => Math.trunc((totalMinor * weight) / weightTotal));
  const largest = weights.reduce((best, weight, index) => (weight > weights[best]! ? index : best), 0);
  parts[largest] = parts[largest]! + (totalMinor - parts.reduce((sum, part) => sum + part, 0));
  return parts;
}
