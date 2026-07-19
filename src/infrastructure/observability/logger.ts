/**
 * Structured logging (ADR-0013, charter #14). pino with PII redaction — the ONLY
 * sanctioned log path (raw console.* is banned by the no-console fence because only
 * this scrubs PII). Level and service name come from config (ADR-0003).
 */
import pino from "pino";
import { getConfig } from "@infra/config";

const cfg = getConfig();

const PII_LOG_FIELDS = ["ssn", "password", "email", "phone", "dob", "firstName", "lastName", "name", "displayName"];

export const log = pino({
  level: cfg.log.level,
  base: { service: cfg.otel.serviceName },
  redact: {
    // Defence-in-depth only — the real guarantee is that callers log identifiers,
    // not PII (audit actor is an opaque userId per ADR-0006/0007).
    paths: PII_LOG_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`]),
    censor: "[REDACTED]",
  },
});
