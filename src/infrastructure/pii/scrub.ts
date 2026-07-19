/**
 * PII scrubbing at the audit/log boundary (ADR-0006). Redacts PII field values
 * and PII-shaped strings so before/after snapshots and logs never store raw SSN,
 * DOB, email, phone, etc. Escape-at-render, not at storage — we redact PII here
 * but never HTML-escape (avoids Iris's double-escape bug, retro-r7 don't-again #40).
 */
import { isPIIField, PII_VALUE_PATTERNS } from "@contracts/pii";

const REDACTED = "[REDACTED]";

export function scrub(value: unknown, keyIsPII = false): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (keyIsPII) return REDACTED;
    let out = value;
    // Preserve each pattern's own flags (e.g. /i) and add /g — `new RegExp(re, "g")`
    // silently DROPS the source flags, so scrub would miss what the fail-closed
    // backstop then throws on.
    for (const re of PII_VALUE_PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), REDACTED);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v, isPIIField(k));
    }
    return out;
  }
  return value;
}
