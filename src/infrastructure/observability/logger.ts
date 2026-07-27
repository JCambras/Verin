/**
 * Structured logging (ADR-0013, charter #14). pino with PII redaction — the ONLY
 * sanctioned log path (raw console.* is banned by the no-console fence because only
 * this scrubs PII). Level and service name come from config (ADR-0003).
 * safeReason below is the sanctioned way to log exception text (v3 §15.4):
 * callers log flat identifier objects; anything dynamic goes through it first.
 */
import pino from "pino";
import { getConfig } from "@infra/config";
import { isAppError } from "@contracts/errors";
import {
  isPIIField,
  REDACTED,
} from "@contracts/pii";
import {
  isSafeObservabilityPrimitive,
  safeLogMessage,
} from "@domain/observability/safe-values";

const cfg = getConfig();

const PII_LOG_FIELDS = [
  "ssn", "password", "email", "phone", "dob", "firstName", "lastName", "name", "displayName",
  "accountNumber", "account_number", "routingNumber", "routing_number", "taxId", "tax_id",
];

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
  formatters: {
    log(object) {
      return scrubStructuredLog(object) as Record<string, unknown>;
    },
  },
  hooks: {
    logMethod(args, method) {
      const safeArgs = args.map((arg) =>
        typeof arg === "string" ? safeLogMessage(arg) : arg
      ) as Parameters<pino.LogFn>;
      method.apply(this, safeArgs);
    },
  },
};

export const log = pino(loggerOptions);

const SAFE_DRIVER_ERROR_CODES = new Set([
  "08006",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "53300",
  "57014",
  "57P01",
]);

function scrubStructuredLog(
  value: unknown,
  field?: string,
  forceRedact = false,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return forceRedact || !isSafeObservabilityPrimitive(field, value) ? REDACTED : value;
  }
  if (typeof value !== "object") return REDACTED;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubStructuredLog(item, field, forceRedact, seen));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      scrubStructuredLog(item, key, forceRedact || isPIIField(key), seen),
    ]),
  );
}

/**
 * PII-safe reason string for error logging: driver/exception text can quote row
 * values (a unique-violation detail may embed an email); field-NAME redaction
 * cannot see into free text, so a PII-shaped reason is replaced wholesale before
 * it reaches a log line or span.
 */
export function safeReason(e: unknown): string {
  if (isAppError(e)) return `app-error:${e.code}`;
  if (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string" &&
    SAFE_DRIVER_ERROR_CODES.has((e as { code: string }).code)
  ) {
    return `driver-error:${(e as { code: string }).code}`;
  }
  return "unexpected-error";
}
