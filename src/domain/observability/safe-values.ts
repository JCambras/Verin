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
  ["status", new Set(["completed", "failed", "pending", "running", "suspended"])],
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
 * The production span vocabulary. Derived-and-checked by the
 * observability-vocabulary fence: every `withSpan(...)` literal in shipped code
 * must appear here and every entry here must have a live call site, so a new
 * span cannot silently degrade to "operation". Test-only names are injected via
 * registerTestSpanName, never enumerated in production vocabulary.
 */
const SPAN_NAMES = new Set([
  "account-opening.finalize", "crm.application.create", "crm.contact.create",
  "crm.household.create", "esign.request", "flow.account-opening.resume",
  "flow.account-opening.retry", "flow.account-opening.start",
]);

/**
 * Test-only injection point for span names. The `test.` namespace is enforced
 * here and the observability-vocabulary fence proves the only callers live
 * under src/__tests__/, so this can never widen the production vocabulary.
 */
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

// Opaque machine identifiers: hex/uuid/slug segments, CASE-INSENSITIVE. The
// account-opening route validates its client request id with a case-insensitive
// UUID regex and that value becomes the executionId, so a case-sensitive
// predicate here would throw out of a log line AFTER the flow's writes commit —
// a logging helper must never abort a committed business operation.
const OPAQUE_ID_RE = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/i;
// The person-name shape: a capital immediately followed by a lowercase letter
// ("Alice", "Okonkwo-Blackwood"). Machine tokens never carry it — hex ids run
// digit/uppercase runs ("3F2504E0-4F89") and slugs are lowercase ("org",
// "esign-webhook"). Keying on the SHAPE rather than on "contains only letters"
// is what keeps registered machine tokens (SYSTEM_ACTOR_IDS such as "seed", and
// short org ids such as "org") from being refused; whitespace is already
// impossible under OPAQUE_ID_RE, so a multi-word name cannot reach here at all.
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

/** The vocabularies the observability-vocabulary fence checks call sites against. */
export const OBSERVABILITY_VOCABULARY = Object.freeze({
  spanNames: Object.freeze([...SPAN_NAMES].sort()) as readonly string[],
  logMessages: Object.freeze([...LOG_MESSAGES].sort()) as readonly string[],
});
