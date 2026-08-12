/**
 * THE COMMAND ADAPTERS (v3 prompt 10; ADR-0057) - what a configured command
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
 *
 * EVERYTHING AN ADAPTER CAN REFUSE IS A FACT ABOUT THE PUBLISHED DOCUMENT
 * (D-245). A payload field the compiled command did not carry, a registration
 * outside the vocabulary the store accepts, a command type this build has no
 * runner for: each says the deployment cannot run the configuration it publishes,
 * which an operator rollback clears and no submitter can. So none of them is
 * stated here. They go through the injected `ConfiguredRefusal` port, the same
 * mint every load, compile and intake refusal comes through, which is what gets
 * them the operator-recoverable classification, the correlation reference on the
 * wire and the registered diagnosis on the operator's line. They had none of the
 * three: the interpolated command type and payload field id went to the EXTERNAL
 * e-sign provider verbatim, the provider was told to redeliver forever with no
 * pacing, and the operator was told nothing at all.
 */
import type { SqlDb } from "@infra/store/db";
import type { AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import type { Result } from "@contracts/result";
import { assertWriteActor, delegatedWriteActor, type WriteActor } from "@contracts/principal";
import { assertSameTenant, assertTenantContext, type TenantContext } from "@contracts/tenant";
import { isAccountType, type AccountType } from "@domain/schema/entities";
import { configError, type ConfiguredRefusal } from "@domain/config/errors";
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
 * WHERE IN THE DOCUMENT A COMMAND'S PAYLOAD FIELD IS DECLARED - the same path the
 * plan compiler emits for the same node, so the two agree about one location.
 */
const payloadPath = (command: CommandInvocation, field: string): string =>
  `execution.capabilities.${command.capabilityId}.payload.${field}`;

/**
 * A payload field the configuration declared as required; absence is a typed
 * refusal. Read as an OWN property: a configured field named `toString` or
 * `constructor` would otherwise resolve to the inherited member of the plain
 * object the compiler builds, and this refusal would never fire.
 *
 * THROWN rather than returned because a runner is driven by the shipped engine,
 * which catches a typed `AppError` and lands it as the step's failure; the VALUE
 * thrown is the shared mint's, so the classification and the channel are the
 * mint's too.
 */
function required({ command, refuse }: CommandContext, field: string): string {
  const value = Object.hasOwn(command.payload, field) ? command.payload[field] : undefined;
  if (value === undefined) {
    throw refuse.unrunnableStep(
      configError(
        "incoherent",
        payloadPath(command, field),
        "the compiled command carried no value for a payload field this adapter requires",
      ),
    );
  }
  return value;
}

/**
 * A registration this deployment's store can hold. The document's own enum and
 * `ACCOUNT_TYPES` are two copies of one vocabulary (the domain-configuration
 * fence proves them EQUAL), so a value arriving here outside it means those two
 * have drifted - a configuration defect, not a submitter's typo. Filing it as a
 * submitter VALIDATION told the e-sign provider not to redeliver a callback the
 * signature had already been collected for.
 */
function accountTypeOf(context: CommandContext): AccountType {
  const value = required(context, "accountType");
  if (!isAccountType(value)) {
    throw context.refuse.unrunnableStep(
      configError(
        "type-mismatch",
        payloadPath(context.command, "accountType"),
        "the configured registration vocabulary and the vocabulary this deployment's store accepts have drifted apart",
      ),
    );
  }
  return value;
}

type CommandContext = PIIBearing & {
  readonly db: SqlDb;
  readonly actor: WriteActor;
  readonly command: CommandInvocation;
  readonly tenant: TenantContext;
  /** The ONE mint every refusal about the published document comes through (D-244). */
  readonly refuse: ConfiguredRefusal;
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
async function finalize(context: CommandContext): Promise<Readonly<Record<string, string>>> {
  const { db, actor: starter, command, tenant } = context;
  // Delegation happens HERE, in the one reviewed boundary the sealed-factory
  // fence allows: the webhook resumes under the reserved system actor, but the
  // audited write must attribute to the advisor who initiated the request, whose
  // identity the configuration routes in as a declared payload field.
  const actorUserId = required(context, "actorUserId");
  const actor = starter.actorUserId === actorUserId ? starter : delegatedWriteActor(starter, actorUserId);
  const applicationId = required(context, "applicationId");
  const householdId = required(context, "householdId");
  const accountType = accountTypeOf(context);
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
      must(await createTask(db, actor, { householdId, subject: required(context, "taskSubject") }, `task:${key}`));
      must(await completeApplication(db, actor, applicationId, `complete:${key}`));
      return { applicationId };
    },
  );
}

const RUNNERS: ReadonlyMap<string, CommandRunner> = new Map<string, CommandRunner>([
  [
    "household.create",
    async (context) => {
      const { db, actor, command, tenant } = context;
      return withSpan("crm.household.create", { orgId: authorityObservabilityId("orgId", tenant) }, async () => {
        const { id } = must(
          await createHousehold(db, actor, { name: required(context, "name") }, command.idempotencyKey),
        );
        return { id };
      });
    },
  ],
  [
    "contact.create",
    async (context) => {
      const { db, actor, command, tenant } = context;
      return withSpan("crm.contact.create", { orgId: authorityObservabilityId("orgId", tenant) }, async () => {
        const { id } = must(
          await createContact(
            db,
            actor,
            {
              householdId: required(context, "householdId"),
              firstName: required(context, "firstName"),
              lastName: required(context, "lastName"),
              email: command.payload["email"] ?? null,
            },
            command.idempotencyKey,
          ),
        );
        return { id };
      });
    },
  ],
  [
    "application.create",
    async (context) => {
      const { db, actor, command, tenant } = context;
      return withSpan("crm.application.create", { orgId: authorityObservabilityId("orgId", tenant) }, async () => {
        const { id, idempotencyKey } = must(
          await createApplication(
            db,
            actor,
            {
              householdId: required(context, "householdId"),
              contactId: required(context, "contactId"),
              accountType: accountTypeOf(context),
            },
            command.idempotencyKey,
          ),
        );
        return { id, idempotencyKey };
      });
    },
  ],
  [
    "esign.request",
    async (context) => {
      const { db, actor, command, tenant } = context;
      return withSpan("esign.request", { orgId: authorityObservabilityId("orgId", tenant) }, async () => {
        const token = newEsignToken();
        return must(
          await setEsignRequested(db, actor, required(context, "applicationId"), token, command.idempotencyKey),
        );
      });
    },
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
 *
 * `refuse` is the published document's own mint, injected rather than reached
 * for: what an adapter refuses is a fact about that document, and this module
 * stays domain-neutral (it is keyed by command TYPE, never by domain) precisely
 * because it never names the document it is answering for.
 */
export function makeExecutionAdapters(
  db: SqlDb,
  starter: WriteActor,
  refuse: ConfiguredRefusal,
): ExecutionAdapters {
  assertWriteActor(starter);
  return {
    async invoke(command, tenant) {
      assertTenantContext(tenant);
      assertSameTenant(tenant, starter.tenant);
      const runner = RUNNERS.get(command.commandType);
      if (runner === undefined) {
        // The compile-time check in `configuredFlow` refuses this before a plan
        // ever runs; reaching it means a plan compiled under a document this
        // build no longer has a runner for, which is the same cause and takes the
        // same arm rather than a second opinion two layers down.
        throw refuse.uncompilable(
          configError(
            "unknown-reference",
            `execution.capabilities.${command.capabilityId}.commandType`,
            "this build ships no execution adapter for the command type this capability names",
          ),
        );
      }
      return runner({ db, actor: starter, command, tenant, refuse });
    },
  };
}

