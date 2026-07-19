/**
 * PII detection (ADR-0006, charter #3/#13). Field-name and value patterns plus
 * assertNoPII, a machine-readable spec used at scrub boundaries. The house-CRM
 * store holds identity PII (it is the system of record); the AUDIT and log
 * boundaries must never see raw PII — scrub() (infrastructure/pii) enforces that.
 */
export const PII_FIELD_RE =
  /(ssn|social.?security|tax.?id|dob|date.?of.?birth|passport|driver.?licen[cs]e|account.?number|routing.?number|password|secret|credential|first.?name|last.?name|full.?name|display.?name|given.?name|family.?name|household.?name|\bname\b|email|phone)/i;

// Value patterns kept conservative to avoid over-redacting IDs / ISO timestamps.
// The audit backstop THROWS on a match (rolling back the business write), so a
// false positive here kills legitimate writes: the phone pattern requires
// separators/parens (a bare 10-digit number is an ID or an epoch, not "a phone"),
// and the unseparated 9-digit SSN form requires an SSN-ish label nearby.
export const PII_VALUE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN with separators
  /\b(?:ssn|social\s?security(?:\s?(?:number|no\.?|#))?|tax\s?id|tin)\b\D{0,10}\d{3}[ .]?\d{2}[ .]?\d{4}(?!\d)/i, // labeled SSN, incl. unseparated 9 digits
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // email
  /(?<![\w-])(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s])\d{3}[-.\s]?\d{4}(?![\w-])/, // NANP phone (separators/parens required)
];

export function isPIIField(name: string): boolean {
  return PII_FIELD_RE.test(name);
}

export function looksLikePIIValue(value: string): boolean {
  return PII_VALUE_PATTERNS.some((re) => re.test(value));
}

export function maskValue(value: string): string {
  // Never reveal a majority of a short value (a 5-char value would be 80% exposed).
  if (value.length <= 8) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

/**
 * Throw if any PII field name or PII-shaped value appears in payload. Used at the
 * LLM/audit/API boundaries as a fail-closed backstop after scrubbing.
 */
export function assertNoPII(payload: unknown, boundary: string, seen = new WeakSet<object>()): void {
  if (payload == null) return;
  if (typeof payload === "string") {
    if (looksLikePIIValue(payload)) throw pii(boundary, "value pattern");
    return;
  }
  if (typeof payload !== "object") return;
  if (seen.has(payload)) return;
  seen.add(payload);
  for (const [key, value] of Object.entries(payload)) {
    if (isPIIField(key)) throw pii(boundary, `field '${key}'`);
    assertNoPII(value, boundary, seen);
  }
}

/**
 * Fail-closed backstop for the AUDIT boundary: after scrubbing, assert no PII-shaped
 * VALUES survive (field NAMES may remain — e.g. a redacted `firstName` key). If a raw
 * SSN/email/phone slipped past the scrubber, throw rather than persist it.
 */
export function assertNoPIIValues(payload: unknown, boundary: string, seen = new WeakSet<object>()): void {
  if (payload == null) return;
  if (typeof payload === "string") {
    if (looksLikePIIValue(payload)) throw pii(boundary, "value pattern");
    return;
  }
  if (typeof payload !== "object") return;
  if (seen.has(payload)) return;
  seen.add(payload);
  for (const value of Object.values(payload)) assertNoPIIValues(value, boundary, seen);
}

function pii(boundary: string, what: string): Error {
  const e = new Error(`PII_VIOLATION: ${what} at ${boundary} boundary`);
  e.name = "PIIViolation";
  return e;
}
