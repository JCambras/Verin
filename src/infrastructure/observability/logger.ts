/**
 * Structured logging (ADR-0013, charter #14). pino with PII redaction — the ONLY
 * sanctioned log path (raw console.* is banned by the no-console fence because only
 * this scrubs PII). Level and service name come from config (ADR-0003).
 */
import pino from "pino";
import { getConfig } from "@infra/config";

const cfg = getConfig();

export const log = pino({
  level: cfg.log.level,
  base: { service: cfg.otel.serviceName },
  redact: {
    paths: ["ssn", "*.ssn", "password", "*.password", "email", "*.email", "phone", "*.phone", "dob", "*.dob"],
    censor: "[REDACTED]",
  },
});
