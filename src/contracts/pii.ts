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

const LONG_UNMASKED_NUMBER_RE = /\b\d{9,18}\b/;
const TITLE_CASE_PERSON_RE =
  /(?:^|[^\p{L}])\p{Lu}\p{Ll}{1,}(?:[-'][\p{Lu}]?\p{Ll}+)?\s+\p{Lu}\p{Ll}{1,}(?:[-'][\p{Lu}]?\p{Ll}+)?(?:$|[^\p{L}])/u;
const CREDENTIAL_VALUE_RE =
  /(?:\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b\s*[:=]\s*\S+|\bbearer\s+[A-Za-z0-9._~+/-]+=*|\b(?:sk_(?:live|test)|ghp_)[A-Za-z0-9_-]+\b|\bAKIA[0-9A-Z]{16}\b|\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@)/i;

export function looksLikeAmbiguousSensitiveText(value: string): boolean {
  const titleCaseWords = [...value.matchAll(/\b\p{Lu}\p{Ll}{1,}(?:[-'][\p{Lu}]?\p{Ll}+)?\b/gu)];
  const embeddedTitleCaseWord = titleCaseWords.some((match) =>
    match.index !== undefined &&
    value.slice(0, match.index).trim().length > 0
  );
  return value !== REDACTED && (
    looksLikePIIValue(value) ||
    LONG_UNMASKED_NUMBER_RE.test(value) ||
    TITLE_CASE_PERSON_RE.test(value) ||
    embeddedTitleCaseWord ||
    CREDENTIAL_VALUE_RE.test(value)
  );
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
export function assertNoPIIValues(payload: unknown, boundary: string, seen = new WeakSet<object>()): void {
  if (payload == null) return;
  if (typeof payload === "string") {
    if (looksLikePIIValue(payload)) throw pii(boundary, "value pattern");
    return;
  }
  if (typeof payload === "number" || typeof payload === "bigint") {
    if (looksLikePIIValue(String(payload))) throw pii(boundary, "value pattern");
    return;
  }
  if (typeof payload !== "object") return;
  if (seen.has(payload)) return;
  seen.add(payload);
  for (const [key, value] of Object.entries(payload)) {
    if (isPIIField(key) && value != null && typeof value !== "object" && value !== REDACTED) {
      throw pii(boundary, `unredacted value under PII field '${key}'`);
    }
    assertNoPIIValues(value, boundary, seen);
  }
}

function pii(boundary: string, what: string): Error {
  const e = new Error(`PII_VIOLATION: ${what} at ${boundary} boundary`);
  e.name = "PIIViolation";
  return e;
}
