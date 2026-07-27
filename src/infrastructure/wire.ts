/**
 * Composition root (ADR-0001: app-layer wiring; keeps ports and adapters apart).
 * Builds the account-opening deps from the store + principal, wraps every external
 * call in a span (charter #14), and drives the engine's suspend/resume.
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import {
  delegatedWriteActor,
  assertWriteActor,
  systemWriteActor,
  type WriteActor,
} from "@contracts/principal";
import {
  assertActionGrant,
  type ActionGrant,
  type GovernedOutput,
} from "@contracts/authz";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import type { PIIBearing } from "@contracts/pii";
import { type Result } from "@contracts/result";
import { appError, isAppError, type AppError } from "@contracts/errors";
import { startFlow, resumeFlow, retryFlow, type ExecutionState, type ExecutionStore, type FlowRunResult } from "@domain/workflow/engine";
import { accountOpeningFlow, type AccountOpeningDeps } from "@domain/workflow/flows/account-opening";
import { makeExecutionStore } from "@infra/store/execution-store";
import { auditedWrite } from "@infra/audit/audited-write";
import { createHousehold, createContact, createFinancialAccount, createTask } from "@infra/crm/house-crm";
import { createApplication, setEsignRequested, completeApplication, getApplicationByToken } from "@infra/crm/application-store";
import { newEsignToken, signCallback, verifyCallback } from "@infra/esign/esign";
import { withSpan } from "@infra/observability/tracer";
import { log } from "@infra/observability/logger";

/** Unwrap a Result inside a step; on error, throw the typed AppError (the engine catches it). */
function must<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw r.error as AppError;
}

/** SQLSTATE 23505 unique_violation — the flow_executions PK conflict of a double-submit race. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "23505";
}

/**
 * `executionId` scopes the pre-suspend idempotency keys: a retry of the SAME
 * execution (after a transient failure mid-flow, or a double-submit replaying the
 * client-minted request id — D-027) replays the already-committed writes instead
 * of duplicating households/contacts/applications. A replayed id whose execution
 * FAILED is re-driven from its saved cursor (retryFlow, Vale V7 semantics); the
 * running-with-NULL-token crash window remains a recorded ADR-0011 deferral.
 */
function makeDeps(db: SqlDb, starter: WriteActor, executionId: string): AccountOpeningDeps {
  const actorFor = (tenant: TenantContext): WriteActor => {
    assertTenantContext(tenant);
    if (tenant.orgId !== starter.tenant.orgId) {
      throw appError("INTERNAL", "Flow dependency tenant does not match its bound adapter scope.");
    }
    return starter;
  };
  return {
    createHousehold: (name, tenant) =>
      withSpan("crm.household.create", { orgId: tenant.orgId }, async () => must(await createHousehold(db, actorFor(tenant), { name }, `household:${executionId}`))),
    createContact: (input, tenant) =>
      withSpan("crm.contact.create", { orgId: tenant.orgId }, async () => must(await createContact(db, actorFor(tenant), input, `contact:${executionId}`))),
    createApplication: (input, tenant) =>
      withSpan("crm.application.create", { orgId: tenant.orgId }, async () => must(await createApplication(db, actorFor(tenant), input, `application:${executionId}`))),
    requestEsign: (applicationId, tenant) =>
      withSpan("esign.request", { orgId: tenant.orgId }, async () => {
        const token = newEsignToken();
        return must(await setEsignRequested(db, actorFor(tenant), applicationId, token, `esign:${executionId}`));
      }),
    finalize: (input, tenant) =>
      withSpan("account-opening.finalize", { orgId: tenant.orgId, applicationId: input.applicationId }, async () => {
        const starterActor = actorFor(tenant);
        const actor = starterActor.actorUserId === input.actor
          ? starterActor
          : delegatedWriteActor(starterActor, input.actor);
        // Idempotent, audited: a doubly-fired webhook yields exactly-once effect.
        // Per-write keys derive from the application's minted idempotency key
        // (threaded through the flow context), so the key the application row
        // records is the one that actually guards finalize.
        // The e-signature is the event that OPENS the account: openDate = signedAt
        // and status = 'open' (finding #2 — the store must agree with the product).
        must(await createFinancialAccount(db, actor, { householdId: input.householdId, accountType: input.accountType, openDate: input.signedAt }, `account:${input.idempotencyKey}`));
        must(await createTask(db, actor, { householdId: input.householdId, subject: `Fund the new ${input.accountType} account` }, `task:${input.idempotencyKey}`));
        must(await completeApplication(db, actor, input.applicationId, `complete:${input.idempotencyKey}`));
      }),
  };
}

/** PIIBearing: household/contact names and email are client PII. */
export interface StartAccountOpeningInput extends PIIBearing {
  householdName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  accountType: string;
  /**
   * Client-minted per-form-session UUID (D-027): used as the executionId, so a
   * double-submit (network retry, second tab) replays the SAME execution instead
   * of creating duplicate households. Omitted → a server-minted id (no dedup).
   */
  clientRequestId?: string;
}

type AccountOpeningStartResult =
  & FlowRunResult
  & GovernedOutput<"execution.initiate">;

/** Report an already-started execution's current state (double-submit replay). */
function replayedRunResult(state: ExecutionState): FlowRunResult {
  return {
    executionId: state.id,
    status: state.status,
    token: state.resumeToken ?? undefined,
    awaiting: state.status === "suspended" ? "esign-signature" : undefined,
    data: state.data,
  };
}

/**
 * The client-editable fields persisted at start (D-027): a replayed request id is
 * honored only when these match the original submission, so an edited resubmit
 * under the same id can never silently write the stale values.
 */
const START_INPUT_FIELDS = ["householdName", "firstName", "lastName", "email", "accountType"] as const;

function inputMatchesExecution(input: StartAccountOpeningInput, existing: ExecutionState): boolean {
  return START_INPUT_FIELDS.every((field) => existing.data[field] === input[field]);
}

/** Typed refusal of an edited replay: the client must mint a new request id (D-027). */
function editedReplayConflict(executionId: string): FlowRunResult {
  return {
    executionId,
    status: "failed",
    error: appError("CONFLICT", "This request id was already used with different input; mint a new request id and resubmit."),
    data: {},
  };
}

/** Re-drive a failed start; a storage throw surfaces as a typed failure, never an unenveloped 500. */
async function retryFailedStart(store: ExecutionStore, deps: AccountOpeningDeps, existing: ExecutionState, tenant: TenantContext): Promise<FlowRunResult> {
  try {
    return await retryFlow(accountOpeningFlow, store, deps, existing, tenant);
  } catch (e) {
    const error = isAppError(e) ? e : appError("INTERNAL", "The account-opening flow could not be retried.");
    return { executionId: existing.id, status: "failed", error, data: {} };
  }
}

export async function startAccountOpening(
  db: SqlDb,
  grant: ActionGrant<"execution.initiate">,
  input: StartAccountOpeningInput,
): Promise<AccountOpeningStartResult> {
  assertActionGrant(grant, "execution.initiate");
  const store = makeExecutionStore(db);
  const executionId = input.clientRequestId ?? randomUUID();
  const tenant = grant.tenant;
  const deps = makeDeps(db, grant.writeActor, executionId);
  // A client-minted id that already started is a double-submit: report the
  // existing execution's state instead of starting a duplicate. The tenant-scoped
  // loadById filters org_id in SQL, so a (guessed) foreign execution id can never
  // leak another tenant's state.
  const loadOwnExecution = async (): Promise<ExecutionState | null> => {
    const existing = await store.loadById(executionId, tenant);
    return existing && existing.flowId === accountOpeningFlow.id ? existing : null;
  };
  if (input.clientRequestId) {
    const existing = await loadOwnExecution();
    if (existing && !inputMatchesExecution(input, existing)) return editedReplayConflict(executionId);
    if (existing && existing.status !== "failed") return replayedRunResult(existing);
    if (existing) {
      // A replayed id whose execution FAILED is re-driven from its saved cursor
      // (resumeFlow's Vale V7 retry, applied to the start path): the per-write
      // idempotency keys replay the committed writes, so the user's resubmit
      // recovers instead of dead-ending on the persisted failure.
      return withSpan("flow.account-opening.retry", { orgId: tenant.orgId, actor: grant.actorId }, async () => {
        const result = await retryFailedStart(store, deps, existing, tenant);
        log.info({ orgId: tenant.orgId, flow: "account-opening", status: result.status, executionId: result.executionId }, "flow retried");
        return result;
      });
    }
  }
  // Span attribution is the opaque userId, never the email — OTel attributes are
  // exported to the OTLP endpoint and must not carry PII (ADR-0006/0013).
  return withSpan("flow.account-opening.start", { orgId: tenant.orgId, actor: grant.actorId }, async () => {
    let result: FlowRunResult;
    try {
      result = await startFlow(accountOpeningFlow, store, deps, {
        executionId,
        tenant,
        data: { ...input, initiatedBy: grant.actorId },
      });
    } catch (e) {
      // Two concurrent submits can both miss the pre-check; ONLY the loser's
      // INSERT hitting the flow_executions PK (SQLSTATE 23505) resolves as the
      // same replay. Any other throw is a real storage failure and surfaces as a
      // typed failure — never masked as a started flow, never an unenveloped 500.
      const raced = input.clientRequestId && isUniqueViolation(e) ? await loadOwnExecution() : null;
      if (raced && !inputMatchesExecution(input, raced)) {
        result = editedReplayConflict(executionId);
      } else if (raced) {
        result = raced.status === "failed" ? await retryFailedStart(store, deps, raced, tenant) : replayedRunResult(raced);
      } else {
        const error = isAppError(e) ? e : appError("INTERNAL", "The account-opening flow could not be started.");
        result = { executionId, status: "failed", error, data: {} };
      }
    }
    // Structured log — no PII (orgId + status only), scrubbed by the pino redactor.
    log.info({ orgId: tenant.orgId, flow: "account-opening", status: result.status, executionId: result.executionId }, "flow started");
    return result;
  });
}

export async function resumeAccountOpeningByToken(
  db: SqlDb,
  token: string,
  payload: Record<string, unknown>,
): Promise<FlowRunResult | { status: "not-found" }> {
  const app = await getApplicationByToken(db, token);
  if (!app) return { status: "not-found" };
  const store = makeExecutionStore(db);
  // The starter here is the reserved SYSTEM actor id (typed truth, finding #13:
  // no fabricated Principal/role) with a system-minted tenant scoped to the
  // application row's org; finalize attributes its audit to the initiating
  // advisor's userId threaded through the flow context (ctx.initiatedBy).
  // Resume only runs post-suspend steps, so the pre-suspend key scope is inert.
  const starter = systemWriteActor("esign-webhook", app.org_id);
  const deps = makeDeps(db, starter, `resume:${token}`);
  return withSpan("flow.account-opening.resume", { orgId: app.org_id }, () =>
    resumeFlow(accountOpeningFlow, store, deps, token, payload, starter.tenant),
  );
}

/**
 * The e-sign webhook callback (STRIDE T-S3): a forged callback without a valid
 * HMAC signature is rejected BEFORE any resume. Used by the raw webhook route and
 * the authenticated simulate-sign affordance.
 */
export async function esignCallback(
  db: SqlDb,
  token: string,
  signature: string,
  payload: Record<string, unknown>,
): Promise<FlowRunResult | { status: "not-found" } | { status: "invalid-signature" }> {
  if (!verifyCallback(token, signature)) return { status: "invalid-signature" };
  return resumeAccountOpeningByToken(db, token, payload);
}

/** The server-side "e-sign provider" that computes a valid signature (simulation). */
export function computeEsignSignature(token: string): string {
  return signCallback(token);
}

/**
 * Record a non-CRM security event (login/logout/session lifecycle) in the
 * tamper-evident hash chain (Vale V5 / Sable F6 — repudiation coverage). Routes
 * through auditedWrite (no-op perform) so the anti-fork invariant holds: audits are
 * only ever enqueued inside the helper.
 */
export async function auditEvent(
  db: SqlDb,
  opts: { actor: WriteActor; action: string; entityType: string; entityId: string; detail: string },
): Promise<void> {
  assertWriteActor(opts.actor);
  const recorded = await auditedWrite({
    db, actor: opts.actor, action: opts.action, entityType: opts.entityType,
    entityId: opts.entityId, detail: opts.detail, perform: async () => ({}),
  });
  if (!recorded.ok) {
    // The auth operation proceeds (availability over completeness — an explicit
    // ADR-0007 deferral with a fail-closed trigger), but the loss is never silent.
    log.error(
      { orgId: opts.actor.tenant.orgId, action: opts.action, entityType: opts.entityType, entityId: opts.entityId, code: recorded.error.code },
      "security-event audit could not be recorded",
    );
  }
}
