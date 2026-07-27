import {
  isPIIField,
  looksLikePIIValue,
  REDACTED,
} from "@contracts/pii";
import { appError } from "@contracts/errors";

/** Derived-and-checked against the real `observabilityId(...)` call sites by the observability-vocabulary fence. */
export const OBSERVABILITY_ID_FIELDS = [
  "actor",
  "applicationId",
  "entityId",
  "executionId",
  "orgId",
  "outboxRowId",
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
/**
 * Exported as TYPES, not just runtime sets: an `action: string` audit field lets a
 * caller hand the log formatter a value outside the closed set, which degrades to
 * "[REDACTED]" in the one line an operator needs. Typing the audit boundary against
 * these unions makes that unrepresentable rather than merely detectable.
 */
const ACTION_NAMES = [
  "application.complete", "application.create", "application.request-esign",
  "contact.create", "financial_account.create", "household.create",
  "household.update", "org.seed", "session.create", "session.login_failed",
  "session.revoke", "task.create",
] as const;
export type ObservabilityAction = (typeof ACTION_NAMES)[number];
const ENTITY_TYPE_NAMES = [
  "AccountOpeningApplication", "Contact", "FinancialAccount", "Household",
  "Org", "Session", "Task", "User",
] as const;
export type ObservabilityEntityType = (typeof ENTITY_TYPE_NAMES)[number];
const ACTIONS = new Set<string>(ACTION_NAMES);
const ENUMS = new Map<string, ReadonlySet<string>>([
  ["code", new Set([
    "AUTH_EXPIRED", "AUTH_FAILED", "CONFLICT", "FLOW_SUSPENDED", "FORBIDDEN",
    "IDEMPOTENCY_REPLAY", "INTEGRATION_ERROR", "INTEGRATION_TIMEOUT", "INTERNAL",
    "NOT_FOUND", "PII_VIOLATION", "PROVENANCE_MISSING", "STORE_CONSTRAINT",
    "STORE_UNAVAILABLE", "VALIDATION",
  ])],
  ["entityType", new Set<string>(ENTITY_TYPE_NAMES)],
  ["flow", new Set(["account-opening"])],
  ["status", new Set(["completed", "failed", "running", "suspended"])],
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
/**
 * The production span vocabulary, derived-and-checked BOTH ways by the
 * observability-vocabulary fence, so a new span cannot silently degrade to
 * "operation". Test-only names arrive via registerTestSpanName, never here.
 */
const SPAN_NAMES = new Set([
  "account-opening.finalize", "crm.application.create", "crm.contact.create",
  "crm.household.create", "esign.request", "flow.account-opening.resume",
  "flow.account-opening.retry", "flow.account-opening.start",
]);

/** Test-only span names: `test.`-namespaced, and fenced to have no shipped caller. */
const TEST_SPAN_NAMES = new Set<string>();
export function registerTestSpanName(name: string): void {
  if (!/^test\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(name)) {
    throw appError(
      "VALIDATION",
      "A test span name must live in the reserved 'test.' namespace.",
    );
  }
  TEST_SPAN_NAMES.add(name);
}

// Opaque machine identifiers: hex/uuid/slug segments, CASE-INSENSITIVE — a
// case-sensitive predicate would throw out of a log line AFTER the flow's writes
// commit, and a logging helper must never abort a committed business operation.
const OPAQUE_ID_RE = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/i;
// The person-name SHAPE: a capital immediately followed by a lowercase letter
// ("Alice", "Okonkwo-Blackwood"). Machine tokens never carry it — hex ids run
// digit/uppercase runs and slugs are lowercase — so keying on the shape (rather
// than "contains only letters") keeps "seed" and "org" from being refused.
const NAME_SHAPED_RE = /\p{Lu}\p{Ll}/u;

export function observabilityId(
  field: ObservabilityIdField,
  value: string,
): ObservabilityId {
  if (
    !ID_FIELDS.has(field) ||
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !OPAQUE_ID_RE.test(value) ||
    NAME_SHAPED_RE.test(value) ||
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
  return SPAN_NAMES.has(value) || TEST_SPAN_NAMES.has(value) ? value : "operation";
}

/**
 * Every closed vocabulary the runtime degrades against, exposed so the
 * observability-vocabulary fence can derive each one from the real call sites
 * and check it BOTH ways. Span names and log messages degrade to
 * "operation"/"log event"; an unlisted action, enum member, or numeric field
 * degrades to "[REDACTED]" — silently, in the exact log line an operator needs.
 */
export const OBSERVABILITY_VOCABULARY = Object.freeze({
  spanNames: Object.freeze([...SPAN_NAMES].sort()) as readonly string[],
  logMessages: Object.freeze([...LOG_MESSAGES].sort()) as readonly string[],
  idFields: OBSERVABILITY_ID_FIELDS as readonly string[],
  actions: Object.freeze([...ACTIONS].sort()) as readonly string[],
  enums: Object.freeze(
    Object.fromEntries([...ENUMS].map(([field, values]) => [field, Object.freeze([...values].sort())])),
  ) as Readonly<Record<string, readonly string[]>>,
  numericFields: Object.freeze([...NUMERIC_FIELDS].sort()) as readonly string[],
});
