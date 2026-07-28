/**
 * PII detection (ADR-0006, charter #3/#13). Field-name and value patterns plus
 * assertNoPIIValues, the machine-readable spec used at scrub boundaries. The
 * house-CRM store holds identity PII (it is the system of record); the AUDIT and
 * log boundaries must never see raw PII — scrub() (infrastructure/pii) enforces that.
 */
/** The one redaction sentinel — scrub() writes it; assertNoPIIValues accepts it. */
export const REDACTED = "[REDACTED]";

declare const PIIBearingBrand: unique symbol;

/**
 * Type-level marker for a type carrying RAW PII fields (v3 §15.1, invariant 1).
 * The llm-pii-boundary fence derives the marked set and proves (a) every
 * declared interface with a raw PII-named string field carries this marker or a
 * reviewed non-PII escape, and (b) no module declaring a marked type is
 * import-reachable from llm/. The brand property is optional so existing object
 * literals stay assignable — the marker exists for the fence and the reader,
 * never as a runtime value.
 */
export interface PIIBearing {
  readonly [PIIBearingBrand]?: "pii-bearing";
}

export const PII_FIELD_RE =
  /(ssn|social.?security|tax.?id|dob|date.?of.?birth|passport|driver.?licen[cs]e|account.?number|routing.?number|password|secret|credential|api.?key|private.?key|database.?url|connection.?string|access.?token|refresh.?token|auth.?token|bearer.?token|first.?name|last.?name|full.?name|display.?name|given.?name|family.?name|household.?name|request.?text|raw.?text|evidence|\bname\b|email|phone)/i;

// Value patterns kept conservative to avoid over-redacting IDs / ISO timestamps.
// The audit backstop THROWS on a match (rolling back the business write), so a
// false positive here kills legitimate writes: the phone pattern requires a
// phone-ish context (an E.164 "+1" prefix, separators, or parens; a bare
// 10-digit number is an ID or an epoch, not "a phone"), and the unseparated
// 9-digit SSN form requires an SSN-ish label nearby.
export const PII_VALUE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN with separators
  /\b(?:ssn|social\s?security(?:\s?(?:number|no\.?|#))?|tax\s?id|tin)\b\D{0,10}\d{3}[ .]?\d{2}[ .]?\d{4}(?!\d)/i, // labeled SSN, incl. unseparated 9 digits
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // email
  /(?<![\w-])(?:\+1\d{10}|(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]?\d{4})(?![\w-])/, // NANP phone (E.164 +1 or separators/parens required)
];

export function isPIIField(name: string): boolean {
  return PII_FIELD_RE.test(name);
}

export function looksLikePIIValue(value: string): boolean {
  return PII_VALUE_PATTERNS.some((re) => re.test(value));
}

export interface SensitiveAccountReference {
  readonly start: number;
  readonly end: number;
  readonly valid: boolean;
}

const ACCOUNT_CLUSTER_RE = /\d[\d -]*/g;
const ACCOUNT_BOUNDARY_RE = /[\p{L}\p{N}_]/u;
const FORMATTED_ACCOUNT_RE = /^\d+(?:[ -]\d+)*$/;

export function sensitiveAccountReferences(value: string): readonly SensitiveAccountReference[] {
  return [...value.matchAll(ACCOUNT_CLUSTER_RE)].flatMap((match) => {
    const start = match.index ?? 0;
    const rawText = match[0].replace(/ +$/u, "");
    const end = start + rawText.length;
    const digits = rawText.replace(/[ -]/g, "");
    if (digits.length < 9) return [];
    const separators = rawText.match(/[ -]+/g) ?? [];
    const valid = digits.length <= 18 &&
      FORMATTED_ACCOUNT_RE.test(rawText) &&
      new Set(separators).size <= 1 &&
      !ACCOUNT_BOUNDARY_RE.test(value[start - 1] ?? "") &&
      !ACCOUNT_BOUNDARY_RE.test(value[end] ?? "");
    return [{ start, end, valid }];
  });
}

export function accountReferenceDigits(value: string): string | null {
  const references = sensitiveAccountReferences(value);
  const reference = references.length === 1 ? references[0] : undefined;
  return reference?.valid && reference.start === 0 && reference.end === value.length
    ? value.slice(reference.start, reference.end).replace(/[ -]/g, "")
    : null;
}

export function hasSensitiveAccountReference(value: string | number | bigint): boolean {
  return sensitiveAccountReferences(String(value).replace(/^-/, "")).length > 0;
}

/**
 * What redaction removes from free text — THE authority, so the audit scrubber
 * and the projection layer agree on which spans need no slot binding. Each
 * pattern keeps its own flags and gains /g: `new RegExp(re, "g")` silently DROPS
 * source flags, so redaction would miss what the backstop then throws on.
 */
export function redactPIIValues(text: string): string {
  return PII_VALUE_PATTERNS.reduce(
    (out, re) => out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), REDACTED),
    text,
  );
}

/**
 * The ONE person-name word shape ambiguous-text detection keys on, exported as a
 * source fragment so every boundary that must agree with this detector composes it
 * rather than re-typing it.
 *
 * TWO cases, not one. Title case ("Alice", "Okonkwo-Blackwood") is what a
 * capital-then-lowercase test finds; ALL CAPS ("ALICE", "SMITH", "O'BRIEN") is what
 * it structurally CANNOT find, because `\p{Lu}\p{Ll}` requires the lowercase letter
 * to be there. All-caps is an ordinary CRM rendering ("SMITH, JOHN"), so detecting
 * only the first left every all-caps name invisible to the candidate walk, the
 * masker, and the residual check at once - a raw name could be sealed into a
 * Tokenized value carrying piiFree: true, which is exactly what v3 invariant 1
 * forbids. Both halves resolve through the SAME span-specific trusted-identity or
 * safe-template contract; neither gets a weaker escape, and there is no acronym
 * allowlist - an unclassified all-caps run fails closed like any other.
 */
const TITLE_CASE_WORD = String.raw`\p{Lu}\p{Ll}{1,}(?:[-'][\p{Lu}]?\p{Ll}+)?`;
const ALL_CAPS_WORD = String.raw`\p{Lu}{2,}(?:[-']\p{Lu}+)?`;
/** Unanchored, for composition into larger shapes. */
const PERSON_WORD = `(?:${TITLE_CASE_WORD}|${ALL_CAPS_WORD})`;
export const PERSON_WORD_SOURCE = String.raw`\b${PERSON_WORD}`;

// Composed from PERSON_WORD, never re-typed: a shape written twice is a shape that
// drifts, and the all-caps half was missing here precisely because this pair had its
// own inline copy of the title-case source.
const PERSON_PAIR_RE = new RegExp(
  `(?:^|[^\\p{L}])${PERSON_WORD}\\s+${PERSON_WORD}(?:$|[^\\p{L}])`,
  "u",
);
const CREDENTIAL_VALUE_RE =
  /(?:\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*|\b(?:sk_(?:live|test)|ghp_)[A-Za-z0-9_-]+\b|\bAKIA[0-9A-Z]{16}\b|\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@)/i;

const PERSON_WORD_G = new RegExp(`${PERSON_WORD_SOURCE}\\b`, "gu");

/**
 * A stand-in for the neutralized sentinel: not a letter (so it can never BE a person
 * word) and not whitespace (so it still counts as content). Blanking the sentinel to
 * whitespace instead erases the "something precedes this" signal embeddedPersonWord
 * reads, and "[REDACTED] Alice" then seals as piiFree with the raw name intact -
 * caller-supplied text containing the literal sentinel is the whole evasion.
 */
const SENTINEL_STANDIN = ".";

export function looksLikeAmbiguousSensitiveText(value: string): boolean {
  // The redaction sentinel is the scrubber's OWN output and is itself all-caps, so
  // every occurrence is neutralized before shape-testing. Comparing the whole value
  // against it (the previous guard) was enough only while all-caps was invisible;
  // now "[REDACTED] requested a transfer" would otherwise be refused as an embedded
  // person word - the detector rejecting exactly the text the scrubber just made safe.
  const residual = value.split(REDACTED).join(SENTINEL_STANDIN);
  const personWords = [...residual.matchAll(PERSON_WORD_G)];
  const embeddedPersonWord = personWords.some((match) =>
    match.index !== undefined &&
    residual.slice(0, match.index).trim().length > 0
  );
  return looksLikePIIValue(residual) ||
    hasSensitiveAccountReference(residual) ||
    PERSON_PAIR_RE.test(residual) ||
    embeddedPersonWord ||
    CREDENTIAL_VALUE_RE.test(residual);
}

export function assertNoAmbiguousSensitiveText(
  payload: unknown,
  boundary: string,
  seen = new WeakSet<object>(),
): void {
  if (payload == null) return;
  if (typeof payload === "string") {
    if (looksLikeAmbiguousSensitiveText(payload)) throw pii(boundary, "ambiguous sensitive text");
    return;
  }
  if (typeof payload !== "object") return;
  if (seen.has(payload)) return;
  seen.add(payload);
  for (const [key, value] of Object.entries(payload)) {
    if (looksLikeAmbiguousSensitiveText(key)) throw pii(boundary, "ambiguous sensitive key");
    assertNoAmbiguousSensitiveText(value, boundary, seen);
  }
}

/**
 * Fail-closed backstop for the AUDIT boundary: after scrubbing, assert no PII-shaped
 * VALUES survive (field NAMES may remain — e.g. a redacted `firstName` key). If a raw
 * SSN/email/phone slipped past the scrubber, throw rather than persist it. Post-scrub,
 * a PII-named key may only map to the REDACTED sentinel, null, or a container whose
 * leaves are themselves redacted — any other primitive (a raw string, number, bigint,
 * or boolean) means the scrubber was bypassed, so throw rather than persist.
 */
export function assertNoPIIValues(payload: unknown, boundary: string): void {
  const seen = new WeakMap<object, boolean>();
  const pending: Array<{
    readonly value: unknown;
    readonly piiField?: string;
  }> = [{ value: payload }];
  while (pending.length > 0) {
    const { value, piiField } = pending.pop()!;
    if (value == null) continue;
    if (typeof value === "string") {
      if (piiField && value !== REDACTED) {
        throw pii(boundary, `unredacted value under PII field '${piiField}'`);
      }
      if (looksLikePIIValue(value)) throw pii(boundary, "value pattern");
      continue;
    }
    if (typeof value === "number" || typeof value === "bigint") {
      if (piiField) {
        throw pii(boundary, `unredacted value under PII field '${piiField}'`);
      }
      if (looksLikePIIValue(String(value))) throw pii(boundary, "value pattern");
      continue;
    }
    if (typeof value !== "object") {
      if (piiField) {
        throw pii(boundary, `unredacted value under PII field '${piiField}'`);
      }
      continue;
    }
    const seenWithPiiContext = seen.get(value);
    if (
      seenWithPiiContext === true ||
      (seenWithPiiContext === false && piiField === undefined)
    ) {
      continue;
    }
    seen.set(value, piiField !== undefined);
    for (const [key, nested] of Object.entries(value)) {
      pending.push({
        value: nested,
        ...(piiField || isPIIField(key)
          ? { piiField: piiField ?? key }
          : {}),
      });
    }
  }
}

function pii(boundary: string, what: string): Error {
  const e = new Error(`PII_VIOLATION: ${what} at ${boundary} boundary`);
  e.name = "PIIViolation";
  return e;
}
