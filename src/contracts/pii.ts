/**
 * PII detection (ADR-0006, charter #3/#13). Field-name and value patterns plus
 * assertNoPII, a machine-readable spec used at scrub boundaries. The house-CRM
 * store holds identity PII (it is the system of record); the AUDIT and log
 * boundaries must never see raw PII — scrub() (infrastructure/pii) enforces that.
 */
export const PII_FIELD_RE =
  /(ssn|social.?security|tax.?id|dob|date.?of.?birth|passport|driver.?licen[cs]e|account.?number|routing.?number|password|secret|credential)/i;

// Value patterns kept conservative to avoid over-redacting IDs / ISO timestamps.
export const PII_VALUE_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN with separators
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // email
  /\b\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, // NANP phone
];

export function isPIIField(name: string): boolean {
  return PII_FIELD_RE.test(name);
}

export function looksLikePIIValue(value: string): boolean {
  return PII_VALUE_PATTERNS.some((re) => re.test(value));
}

export function maskValue(value: string): string {
  if (value.length <= 4) return "****";
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

function pii(boundary: string, what: string): Error {
  const e = new Error(`PII_VIOLATION: ${what} at ${boundary} boundary`);
  e.name = "PIIViolation";
  return e;
}
