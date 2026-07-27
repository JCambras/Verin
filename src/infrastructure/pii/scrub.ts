/**
 * PII scrubbing at the audit/log boundary (ADR-0006). Redacts PII field values
 * and PII-shaped strings so before/after snapshots and logs never store raw SSN,
 * DOB, email, phone, etc. Escape-at-render, not at storage — we redact PII here
 * but never HTML-escape (avoids Iris's double-escape bug, retro-r7 don't-again #40).
 */
import { isPIIField, redactPIIValues, REDACTED } from "@contracts/pii";

export function scrub(value: unknown, keyIsPII = false): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return keyIsPII ? REDACTED : redactPIIValues(value);
  }
  // keyIsPII propagates through arrays and nested objects: everything UNDER a
  // PII-named key ({ name: { first: "John" } }, { phones: [5551234567] }) is PII.
  if (Array.isArray(value)) return value.map((v) => scrub(v, keyIsPII));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v, keyIsPII || isPIIField(k));
    }
    return out;
  }
  // Non-string primitives (number/bigint/boolean) under a PII key are PII too —
  // { phone: 5551234567 } must not survive as a raw number.
  return keyIsPII ? REDACTED : value;
}
