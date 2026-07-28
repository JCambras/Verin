/**
 * Structured logging (ADR-0013, charter #14). pino with PII redaction — the ONLY
 * sanctioned log path (raw console.* is banned by the no-console fence because only
 * this scrubs PII). Level and service name come from config (ADR-0003).
 * Exception reasons are sanitized before logging (v3 §15.4).
 */
import pino from "pino";
import { getConfig } from "@infra/config";
import {
  isPIIField,
  REDACTED,
} from "@contracts/pii";
import {
  isSafeObservabilityPrimitive,
  readObservabilityId,
  safeLogMessage,
} from "@domain/observability/safe-values";
export { safeReason } from "./safe-reason";

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

function scrubStructuredLog(
  value: unknown,
  field?: string,
  forceRedact = false,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null) return value;
  const opaqueId = readObservabilityId(value, field);
  if (opaqueId !== null) return forceRedact ? REDACTED : opaqueId;
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
