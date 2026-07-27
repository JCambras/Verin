/**
 * THE Tokenized<T> factory (v3 §15.1, invariant 1) — the scrubber module owns
 * the ONLY sanctioned construction sites for Tokenized values; the
 * tokenized-factory-only fence (with its ESLint mirror) fails any object
 * literal or cast producing Tokenized anywhere else. Input passes through
 * scrub() and the fail-closed assertNoPIIValues backstop, so a Tokenized value
 * is PII-free BY CONSTRUCTION, and each carries a module-private runtime seal
 * (isSealedTokenized) so a hand-built `{ value, piiFree: true }` impostor is
 * refused at the LLM boundary even if it evaded the compiler.
 *
 * Phase 1 tokenization = the redaction sentinel (the same scrubber the audit
 * boundary trusts); the typed slot-placeholder vocabulary of masked intent
 * shaping (prompt 13) lands INSIDE this factory, never beside it.
 */
import { assertNoAmbiguousSensitiveText, assertNoPIIValues } from "@contracts/pii";
import type { Tokenized } from "@contracts/tokenized";
import { scrub } from "./scrub";

const SEAL = Symbol("verin.tokenized.seal");

function seal<T>(value: T): Tokenized<T> {
  const t = Object.defineProperty({ value, piiFree: true as const }, SEAL, { value: true, enumerable: false });
  // The ONE sanctioned Tokenized cast (tokenized-factory-only fence allowlists this module).
  return Object.freeze(t) as Tokenized<T>;
}

/** Scrub free text (a masked request, a label) into a Tokenized string. */
export function tokenizeText(raw: string): Tokenized<string> {
  const scrubbed = scrub(raw) as string;
  assertNoPIIValues(scrubbed, "llm");
  assertNoAmbiguousSensitiveText(scrubbed, "llm");
  return seal(scrubbed);
}

/** Deep-scrub a structured payload (evidence projection) into a Tokenized record. */
export function tokenizeRecord(raw: Readonly<Record<string, unknown>>): Tokenized<Readonly<Record<string, unknown>>> {
  const scrubbed = scrub(raw) as Readonly<Record<string, unknown>>;
  assertNoPIIValues(scrubbed, "llm");
  assertNoAmbiguousSensitiveText(scrubbed, "llm");
  return seal(scrubbed);
}

/** True only for values built by THIS factory — a structural impostor fails. */
export function isSealedTokenized(value: unknown): value is Tokenized<unknown> {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[SEAL] === true;
}
