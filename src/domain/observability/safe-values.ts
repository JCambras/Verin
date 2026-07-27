import {
  isPIIField,
  looksLikePIIValue,
  REDACTED,
} from "@contracts/pii";
import { appError } from "@contracts/errors";

export const OBSERVABILITY_ID_FIELDS = [
  "actor",
  "applicationId",
  "entityId",
  "executionId",
  "orgId",
  "outboxRowId",
  "refs",
  "sessionId",
  "userId",
] as const;
export type ObservabilityIdField = (typeof OBSERVABILITY_ID_FIELDS)[number];
const ID_FIELDS = new Set<string>(OBSERVABILITY_ID_FIELDS);
declare const ObservabilityIdBrand: unique symbol;
export interface ObservabilityId {
  readonly field: ObservabilityIdField;
  readonly value: string;
  readonly [ObservabilityIdBrand]: "ObservabilityId";
}
const OBSERVABILITY_IDS = new WeakSet<object>();
const ACTIONS = new Set([
  "application.complete",
  "application.create",
  "application.request-esign",
  "contact.create",
  "financial_account.create",
  "household.create",
  "household.update",
  "org.seed",
  "session.create",
  "session.login_failed",
  "session.revoke",
  "task.create",
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

export function observabilityId(
  field: ObservabilityIdField,
  value: string,
): ObservabilityId {
  if (
    !ID_FIELDS.has(field) ||
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/.test(value) ||
    (value.length > 1 && /^\p{L}+$/u.test(value)) ||
    /^\d{9,18}$/.test(value) ||
    looksLikePIIValue(value)
  ) {
    throw appError(
      "PII_VIOLATION",
      `Observability ${field} identifiers must be opaque.`,
    );
  }
  const id = { field, value };
  OBSERVABILITY_IDS.add(id);
  return Object.freeze(id) as ObservabilityId;
}

export function readObservabilityId(
  value: unknown,
  field: string | undefined,
): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !OBSERVABILITY_IDS.has(value)
  ) {
    return null;
  }
  const id = value as ObservabilityId;
  return id.field === field ? id.value : null;
}

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
  if (field === "action") return ACTIONS.has(value);
  if (field === "reason") {
    return /^(?:unexpected-error|unknown-email|app-error:[A-Z_]+|driver-error:(?:\d{5}|\d{2}P\d{2}))$/.test(value);
  }
  return ENUMS.get(field)?.has(value) ?? false;
}

export function safeLogMessage(value: string): string {
  return LOG_MESSAGES.has(value) ? value : "log event";
}

export function safeSpanName(value: string): string {
  return SPAN_NAMES.has(value) ? value : "operation";
}
