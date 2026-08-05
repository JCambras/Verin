import {
  hasSensitiveAccountReference,
  isPIIField,
  looksLikePIIValue,
  PERSON_WORD_SOURCE,
  REDACTED,
} from "@contracts/pii";
import { appError, isErrorCode } from "@contracts/errors";
import { isMachineRecordId } from "@contracts/record-id";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";

/** Derived-and-checked against real identifier-mint call sites by the observability-vocabulary fence. */
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
export type RecordObservabilityIdField = Extract<
  ObservabilityIdField,
  "applicationId" | "entityId" | "executionId" | "outboxRowId"
>;
/**
 * Exported as TYPES, not just runtime sets: an `action: string` audit field lets a
 * caller hand the log formatter a value outside the closed set, which degrades to
 * "[REDACTED]" in the one line an operator needs. Typing the audit boundary against
 * these unions closes the HONEST-CALLER case at compile time. It is NOT a seal —
 * plain string unions, no factory, no brand, so `raw as ObservabilityAction` still
 * launders and the runtime check stays string-keyed; the persisted chain is wider
 * still (audit-store suffixes a failed write's action with ".failed"). The
 * observability-vocabulary fence is what keeps both directions honest, deriving the
 * live inventory from the real call sites.
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
  "decision ledger append failed",
  "decision ledger savepoint release failed",
  "decision ledger savepoint rollback failed",
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
    throw appError("VALIDATION", "A test span name must live in the reserved 'test.' namespace.");
  }
  TEST_SPAN_NAMES.add(name);
}

// Opaque machine identifiers: hex/uuid/slug segments, CASE-INSENSITIVE (a
// case-sensitive predicate would refuse a mixed-case id AFTER its writes commit).
const OPAQUE_ID_RE = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/i;
const RECORD_ID_FIELDS = new Set<ObservabilityIdField>([
  "applicationId",
  "entityId",
  "executionId",
  "outboxRowId",
]);
// The person-name SHAPE: a capital immediately followed by a lowercase letter
// ("Alice", "Okonkwo-Blackwood"). Machine tokens never carry it — hex runs are
// digits/uppercase and slugs are lowercase — so "seed" and "org" stay allowed.
const NAME_SHAPED_RE = /\p{Lu}\p{Ll}/u;
// ...and the half `\p{Lu}\p{Ll}` structurally CANNOT see: an ALL-CAPS name ("SMITH",
// "SMITH-JOHN"), an ordinary CRM rendering that reaches here as a client-supplied
// entityId. Composed from the SAME PERSON_WORD_SOURCE the scrub boundary keys on, so
// the two cannot drift, and gated on the value carrying NO digit - that is what keeps
// uppercase hex ids working ("3F2504E0-4F89-…", which the account-opening route
// accepts and a bare `\p{Lu}{2,}` would refuse). Names carry no digits; ids do.
const ALL_CAPS_NAME_RE = new RegExp(PERSON_WORD_SOURCE, "u");
/**
 * A well-formed SQLSTATE: a two-character CLASS followed by three subclass
 * characters, all uppercase-alphanumeric. The class is where the shape gets its
 * teeth - every standard and PostgreSQL class begins with a digit except the four
 * alpha classes F0, HV, P0, and XX - so a bare `[0-9A-Z]{5}` would be too loose:
 * a driver `code` of "ALICE" is exactly that shape, and echoing it would put a name
 * in a log line. Fixed width plus a closed alphabet plus a real class is what makes
 * this incapable of carrying row data.
 *
 * Exported as a source fragment for the same reason as the PII shapes in
 * contracts/pii.ts: safeReason() PRODUCES this shape and REASON_RE below ACCEPTS it,
 * so a widening on one side that missed the other would degrade the code an operator
 * needs to "[REDACTED]" at the log formatter.
 */
export const SQLSTATE_SOURCE = String.raw`(?:\d[0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}`;
const REASON_RE = new RegExp(
  `^(?:unexpected-error|unknown-email|driver-error:${SQLSTATE_SOURCE})$`,
);

function isOpaqueId(field: ObservabilityIdField, value: string): boolean {
  if (!ID_FIELDS.has(field)) return false;
  if (isMachineRecordId(value)) return true;
  if (RECORD_ID_FIELDS.has(field)) return false;
  return value.length > 0 && value.length <= 128 && OPAQUE_ID_RE.test(value) &&
    !NAME_SHAPED_RE.test(value) &&
    !(!/\d/.test(value) && ALL_CAPS_NAME_RE.test(value)) &&
    !hasSensitiveAccountReference(value) && !looksLikePIIValue(value);
}

function sealId(field: ObservabilityIdField, value: string): ObservabilityId {
  const id = { field, value };
  OBSERVABILITY_IDS.add(id);
  return Object.freeze(id) as ObservabilityId;
}

function recordObservabilityId(
  field: RecordObservabilityIdField,
  value: string,
  provenance: "generated" | "keyed-digest",
): ObservabilityId {
  if (
    (provenance === "generated" && !isMachineRecordId(value)) ||
    (provenance === "keyed-digest" && !/^h1:[0-9a-f]{64}$/.test(value))
  ) {
    throw appError("PII_VIOLATION", "Observability record identifiers require trusted provenance.");
  }
  return sealId(field, value);
}
/** Record ID minted directly from a cryptographically generated canonical UUID. */
export function generatedObservabilityId(
  field: RecordObservabilityIdField,
  value: string,
): ObservabilityId {
  return recordObservabilityId(field, value, "generated");
}
/** Record ID already transformed by the reviewed secret-keyed digest boundary. */
export function keyedDigestObservabilityId(
  field: RecordObservabilityIdField,
  value: string,
): ObservabilityId {
  return recordObservabilityId(field, value, "keyed-digest");
}
/** Tenant or actor ID derived only from a runtime-sealed tenant authority. */
export function authorityObservabilityId(
  field: Exclude<ObservabilityIdField, RecordObservabilityIdField>,
  tenant: TenantContext,
): ObservabilityId {
  assertTenantContext(tenant);
  const value = field === "orgId" ? tenant.orgId : tenant.actor.actorId;
  return sealId(field, isOpaqueId(field, value) ? value : REDACTED);
}

/**
 * Failure-path fallback for an untrusted raw identifier. Throwing inside a catch
 * block would let a logging helper decide whether the operation reports its own
 * failure, losing the "[attempt failed]" chain entry (charter #13).
 */
export function observabilityIdOrRedacted(
  field: ObservabilityIdField,
  value: unknown,
): ObservabilityId {
  void value;
  return sealId(field, REDACTED);
}

export function readObservabilityId(value: unknown, field: string | undefined): string | null {
  if (typeof value !== "object" || value === null || !OBSERVABILITY_IDS.has(value)) return null;
  const id = value as ObservabilityId;
  return id.field === field ? id.value : null;
}

export function isSafeObservabilityPrimitive(
  field: string | undefined,
  value: string | number | bigint | boolean,
): boolean {
  if (typeof value === "boolean") return true;
  if (!field || isPIIField(field)) return false;
  if (typeof value === "number" || typeof value === "bigint") return NUMERIC_FIELDS.has(field);
  if (value === REDACTED) return true;
  if (field === "action") return ACTIONS.has(value);
  if (field === "reason") {
    return REASON_RE.test(value) ||
      (value.startsWith("app-error:") && isErrorCode(value.slice("app-error:".length)));
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
 * observability-vocabulary fence can derive each one from the real call sites and
 * check it BOTH ways. Spans/messages degrade to "operation"/"log event"; an unlisted
 * action, enum member, or numeric field degrades to "[REDACTED]" — silently, in the
 * exact log line an operator needs.
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
