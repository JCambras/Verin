/**
 * THE COMMAND ADAPTERS (v3 prompt 10; ADR-0056) - what a configured command
 * TYPE actually does.
 *
 * A domain configuration names a command (`household.create`) and the closed
 * projection of its payload. It never names a span, a table, an audit action,
 * or an SQL statement: those live here, as static literals, so the
 * observability-vocabulary fence still derives the shipped span and action
 * vocabularies from real call sites and a configuration file can never mint an
 * unregistered one.
 *
 * That split is the whole migration. Adding a domain means adding a
 * configuration file and, if it touches a new external system, a command
 * adapter - never a flow definition, and never a branch in the engine.
 */
import type { SqlDb } from "@infra/store/db";
import { appError, type AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import type { Result } from "@contracts/result";
import { assertWriteActor, delegatedWriteActor, type WriteActor } from "@contracts/principal";
import { assertSameTenant, assertTenantContext, type TenantContext } from "@contracts/tenant";
import { ACCOUNT_TYPES, isAccountType, type AccountType } from "@domain/schema/entities";
import type { CommandInvocation, ExecutionAdapters } from "@domain/config/plan-compiler";
import { createHousehold, createContact, createFinancialAccount, createTask } from "@infra/crm/house-crm";
import {
  createApplication,
  setEsignRequested,
  completeApplication,
} from "@infra/crm/application-store";
import { newEsignToken } from "@infra/esign/esign";
import { withSpan } from "@infra/observability/tracer";
import { keyedObservabilityId } from "@infra/observability/record-id";
import { authorityObservabilityId } from "@domain/observability/safe-values";

/** Unwrap a Result inside a step; on error, raise the typed AppError the engine catches. */
function must<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw r.error as AppError;
}

/**
 * A payload field the configuration declared as required; absence is a typed
 * refusal. Read as an OWN property: a configured field named `toString` or
 * `constructor` would otherwise resolve to the inherited member of the plain
 * object the compiler builds, and this refusal would never fire.
 */
function required(command: CommandInvocation, field: string): string {
  const value = Object.hasOwn(command.payload, field) ? command.payload[field] : undefined;
  if (value === undefined) {
    throw appError("INTERNAL", `The configured command "${command.commandType}" resolved no ${field}.`) as AppError;
  }
  return value;
}

function accountTypeOf(command: CommandInvocation): AccountType {
  const value = required(command, "accountType");
  if (!isAccountType(value)) {
    throw appError("VALIDATION", `Account type must be one of: ${ACCOUNT_TYPES.join(", ")}.`) as AppError;
  }
  return value;
}

type CommandContext = PIIBearing & {
  readonly db: SqlDb;
  readonly actor: WriteActor;
  readonly command: CommandInvocation;
  readonly tenant: TenantContext;
};

type CommandRunner = (context: CommandContext) => Promise<Readonly<Record<string, string>>>;

/**
 * The finalize fan-out stays ONE command (captain ruling
 * `account-opening-migration-depth`: behavior-preserving). Its three writes keep
 * the exact sub-keys the hand-coded flow derived from the application's own
 * minted key, so a doubly-fired signature webhook still has exactly-once effect
 * and the shipped `account-opening.finalize` span is unchanged. Splitting the
 * fan-out into three capabilities is prompt 25's call, recorded as a deferral
 * in docs/domain-config-gaps.md rather than taken here.
 */
async function finalize({
  db,
  actor: starter,
  command,
  tenant,
}: CommandContext): Promise<Readonly<Record<string, string>>> {
  // Delegation happens HERE, in the one reviewed boundary the sealed-factory
  // fence allows: the webhook resumes under the reserved system actor, but the
  // audited write must attribute to the advisor who initiated the request, whose
  // identity the configuration routes in as a declared payload field.
  const actorUserId = required(command, "actorUserId");
  const actor = starter.actorUserId === actorUserId ? starter : delegatedWriteActor(starter, actorUserId);
  const applicationId = required(command, "applicationId");
  const householdId = required(command, "householdId");
  const accountType = accountTypeOf(command);
  const key = command.idempotencyKey;
  return withSpan(
    "account-opening.finalize",
    {
      orgId: authorityObservabilityId("orgId", tenant),
      applicationId: keyedObservabilityId("applicationId", tenant, applicationId),
    },
    async () => {
      // The e-signature is the event that OPENS the account: openDate = the
      // observed signing instant, falling back to now if a caller resumed
      // without one - the account's openDate must never be missing.
      const openDate = command.payload["signedAt"] ?? new Date().toISOString();
      must(await createFinancialAccount(db, actor, { householdId, accountType, openDate }, `account:${key}`));
      must(await createTask(db, actor, { householdId, subject: required(command, "taskSubject") }, `task:${key}`));
      must(await completeApplication(db, actor, applicationId, `complete:${key}`));
      return { applicationId };
    },
  );
}

const RUNNERS: ReadonlyMap<string, CommandRunner> = new Map<string, CommandRunner>([
  [
    "household.create",
    async ({ db, actor, command, tenant }) =>
      withSpan("crm.household.create", { orgId: authorityObservabilityId("orgId", tenant) }, async () => {
        const { id } = must(
          await createHousehold(db, actor, { name: required(command, "name") }, command.idempotencyKey),
        );
        return { id };
      }),
  ],
  [
    "contact.create",
    async ({ db, actor, command, tenant }) =>
      withSpan("crm.contact.create", { orgId: authorityObservabilityId("orgId", tenant) }, async () => {
        const { id } = must(
          await createContact(
            db,
            actor,
            {
              householdId: required(command, "householdId"),
              firstName: required(command, "firstName"),
              lastName: required(command, "lastName"),
              email: command.payload["email"] ?? null,
            },
            command.idempotencyKey,
          ),
        );
        return { id };
      }),
  ],
  [
    "application.create",
    async ({ db, actor, command, tenant }) =>
      withSpan("crm.application.create", { orgId: authorityObservabilityId("orgId", tenant) }, async () => {
        const { id, idempotencyKey } = must(
          await createApplication(
            db,
            actor,
            {
              householdId: required(command, "householdId"),
              contactId: required(command, "contactId"),
              accountType: accountTypeOf(command),
            },
            command.idempotencyKey,
          ),
        );
        return { id, idempotencyKey };
      }),
  ],
  [
    "esign.request",
    async ({ db, actor, command, tenant }) =>
      withSpan("esign.request", { orgId: authorityObservabilityId("orgId", tenant) }, async () => {
        const token = newEsignToken();
        return must(
          await setEsignRequested(db, actor, required(command, "applicationId"), token, command.idempotencyKey),
        );
      }),
  ],
  ["application.finalize", finalize],
]);

/** The command types this deployment can run; a configuration naming another is refused. */
export const SUPPORTED_COMMAND_TYPES: readonly string[] = [...RUNNERS.keys()].sort();

/**
 * Build the adapter port for one execution. `starter` is the authority every
 * write runs under; each command re-asserts that the tenant it is handed is the
 * starter's, so a mismatched authority is refused AT the dependency call rather
 * than discovered after a write.
 */
export function makeExecutionAdapters(db: SqlDb, starter: WriteActor): ExecutionAdapters {
  assertWriteActor(starter);
  return {
    async invoke(command, tenant) {
      assertTenantContext(tenant);
      assertSameTenant(tenant, starter.tenant);
      const runner = RUNNERS.get(command.commandType);
      if (runner === undefined) {
        throw appError(
          "INTERNAL",
          `No execution adapter is registered for the configured command "${command.commandType}".`,
        ) as AppError;
      }
      return runner({ db, actor: starter, command, tenant });
    },
  };
}

