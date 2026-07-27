import { isPIIField, REDACTED } from "@contracts/pii";

const ID_FIELDS = new Set([
  "actor",
  "applicationId",
  "entityId",
  "executionId",
  "orgId",
  "outboxRowId",
  "refs",
  "sessionId",
  "userId",
]);
const ENUMS = new Map<string, ReadonlySet<string>>([
  ["code", new Set([
    "AUTH_EXPIRED", "AUTH_FAILED", "CONFLICT", "FLOW_SUSPENDED", "FORBIDDEN",
    "IDEMPOTENCY_REPLAY", "INTEGRATION_ERROR", "INTEGRATION_TIMEOUT", "INTERNAL",
    "NOT_FOUND", "PII_VIOLATION", "PROVENANCE_MISSING", "STORE_CONSTRAINT",
    "STORE_UNAVAILABLE", "VALIDATION",
  ])],
  ["entityType", new Set([
    "AccountOpeningApplication", "Contact", "FinancialAccount", "Household",
    "Session", "Task", "User",
  ])],
  ["flow", new Set(["account-opening"])],
  ["status", new Set(["completed", "failed", "pending", "suspended"])],
]);
const NUMERIC_FIELDS = new Set(["attempts", "outboxPending"]);
const LOG_MESSAGES = new Set([
  "audit outbox row parked after repeated delivery failures (dead-letter; requires operator intervention)",
  "audited write failed",
  "constant-work audit mirror failed",
  "failed sign-in attempt for an unknown email",
  "failure-audit entry could not be recorded",
  "flow retried",
  "flow started",
  "opportunistic session cleanup failed",
  "readiness degraded: audit outbox backlog over threshold",
  "security-event audit could not be recorded",
]);
const SPAN_NAMES = new Set([
  "account-opening.finalize", "crm.application.create", "crm.contact.create",
  "crm.household.create", "esign.request", "flow.account-opening.resume",
  "flow.account-opening.retry", "flow.account-opening.start", "test.ambiguous",
  "test.backstop", "test.keyrule", "test.op.fail", "test.op.ok",
  "test.single-name",
]);

export function isSafeObservabilityPrimitive(
  field: string | undefined,
  value: string | number | bigint | boolean,
): boolean {
  if (typeof value === "boolean") return true;
  if (!field || isPIIField(field)) return false;
  if (typeof value === "number" || typeof value === "bigint") {
    return NUMERIC_FIELDS.has(field);
  }
  if (value === REDACTED) return true;
  if (field === "action") return /^[a-z][a-z0-9._-]*$/.test(value);
  if (field === "reason") {
    return /^(?:unexpected-error|unknown-email|app-error:[A-Z_]+|driver-error:(?:\d{5}|\d{2}P\d{2}))$/.test(value);
  }
  if (ID_FIELDS.has(field)) {
    return /^(?=.*(?:[0-9]|[._:-]))[a-z0-9][a-z0-9._:-]{1,127}$/.test(value);
  }
  return ENUMS.get(field)?.has(value) ?? false;
}

export function safeLogMessage(value: string): string {
  return LOG_MESSAGES.has(value) ? value : "log event";
}

export function safeSpanName(value: string): string {
  return SPAN_NAMES.has(value) ? value : "operation";
}
