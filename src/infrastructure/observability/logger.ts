/**
 * Structured logging (ADR-0013, charter #14). pino with PII redaction — the ONLY
 * sanctioned log path (raw console.* is banned by the no-console fence because only
 * this scrubs PII). Level and service name come from config (ADR-0003).
 * The PII-safe helpers below are the sanctioned way to log free-form structures
 * and exception text (v3 §15.4): callers log flat identifier objects; anything
 * dynamic goes through piiSafe/safeReason first.
 */
import pino from "pino";
import { getConfig } from "@infra/config";
import { isAppError } from "@contracts/errors";
import { looksLikePIIValue, REDACTED } from "@contracts/pii";
import { scrub } from "@infra/pii/scrub";

const cfg = getConfig();

const PII_LOG_FIELDS = ["ssn", "password", "email", "phone", "dob", "firstName", "lastName", "name", "displayName"];

/** Exported so the logs-and-traces PII tests exercise the REAL redaction options, never a copy. */
export const loggerOptions: pino.LoggerOptions = {
  level: cfg.log.level,
  base: { service: cfg.otel.serviceName },
  redact: {
    // Defence-in-depth only — the real guarantee is that callers log identifiers,
    // not PII (audit actor is an opaque userId per ADR-0006/0007).
    // DEPTH LIMIT (documented, D-028): pino redact paths cannot express
    // arbitrary-depth wildcards, so this covers PII field names to nesting depth 4.
    // Callers log FLAT identifier objects ({ orgId, action, code, reason }); a
    // deeper structure is a caller bug the audit-boundary scrubber still catches.
    paths: PII_LOG_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`, `*.*.*.${f}`]),
    censor: "[REDACTED]",
  },
};

export const log = pino(loggerOptions);

/**
 * Deep-scrub a free-form structure before logging it. Field-name redaction above
 * only reaches depth 4 and only known names; this walks the whole value with the
 * same scrubber the audit boundary uses.
 */
export function piiSafe(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return scrub(fields) as Record<string, unknown>;
}

/**
 * PII-safe reason string for error logging: driver/exception text can quote row
 * values (a unique-violation detail may embed an email); field-NAME redaction
 * cannot see into free text, so a PII-shaped reason is replaced wholesale before
 * it reaches a log line or span.
 */
export function safeReason(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : isAppError(e) ? e.message : String(e);
  return looksLikePIIValue(raw) ? REDACTED : raw;
}
