/**
 * Composition root (ADR-0001: app-layer wiring; keeps ports and adapters apart).
 * Builds the account-opening deps from the store + principal, wraps every external
 * call in a span (charter #14), and drives the engine's suspend/resume.
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import { writeActorOf, type Principal, type WriteActor } from "@contracts/principal";
import { type Result } from "@contracts/result";
import type { AppError } from "@contracts/errors";
import { startFlow, resumeFlow, type ExecutionState, type FlowRunResult } from "@domain/workflow/engine";
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

/**
 * `executionId` scopes the pre-suspend idempotency keys: a retry of the SAME
 * execution (after a transient failure mid-flow, or a double-submit replaying the
 * client-minted request id — D-027) replays the already-committed writes instead
 * of duplicating households/contacts/applications. Retry-by-execution-id recovery
 * remains a recorded ADR-0011 deferral.
 */
function makeDeps(db: SqlDb, starter: WriteActor, executionId: string): AccountOpeningDeps {
  return {
    createHousehold: (name) =>
      withSpan("crm.household.create", { orgId: starter.orgId }, async () => must(await createHousehold(db, starter, { name }, `household:${executionId}`))),
    createContact: (input) =>
      withSpan("crm.contact.create", { orgId: starter.orgId }, async () => must(await createContact(db, starter, input, `contact:${executionId}`))),
    createApplication: (input) =>
      withSpan("crm.application.create", { orgId: starter.orgId }, async () => must(await createApplication(db, starter, input, `application:${executionId}`))),
    requestEsign: (applicationId) =>
      withSpan("esign.request", { orgId: starter.orgId }, async () => {
        const token = newEsignToken();
        return must(await setEsignRequested(db, starter, applicationId, token, `esign:${executionId}`));
      }),
    finalize: (input) =>
      withSpan("account-opening.finalize", { orgId: starter.orgId, applicationId: input.applicationId }, async () => {
        // Typed truth (finding #13): this write was driven by an external event
        // on behalf of the initiating advisor — a narrow WriteActor, never a
        // fabricated Principal with an invented role/session.
        const actor: WriteActor = { orgId: starter.orgId, actorUserId: input.actor };
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

export interface StartAccountOpeningInput {
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

export async function startAccountOpening(db: SqlDb, principal: Principal, input: StartAccountOpeningInput): Promise<FlowRunResult> {
  const store = makeExecutionStore(db);
  const executionId = input.clientRequestId ?? randomUUID();
  const deps = makeDeps(db, writeActorOf(principal), executionId);
  // A client-minted id that already started is a double-submit: report the
  // existing execution's state instead of starting a duplicate. Org-checked so a
  // (guessed) foreign execution id can never leak another tenant's state.
  const loadOwnExecution = async (): Promise<ExecutionState | null> => {
    const existing = await store.loadById(executionId);
    return existing && existing.orgId === principal.orgId && existing.flowId === accountOpeningFlow.id ? existing : null;
  };
  if (input.clientRequestId) {
    const existing = await loadOwnExecution();
    if (existing) return replayedRunResult(existing);
  }
  // Span attribution is the opaque userId, never the email — OTel attributes are
  // exported to the OTLP endpoint and must not carry PII (ADR-0006/0013).
  return withSpan("flow.account-opening.start", { orgId: principal.orgId, actor: principal.userId }, async () => {
    let result: FlowRunResult;
    try {
      result = await startFlow(accountOpeningFlow, store, deps, {
        executionId,
        orgId: principal.orgId,
        data: { ...input, initiatedBy: principal.userId },
      });
    } catch (e) {
      // Two concurrent submits can both miss the pre-check; the loser's INSERT
      // hits the flow_executions PK — resolve it as the same replay, not a 500.
      const existing = input.clientRequestId ? await loadOwnExecution() : null;
      if (!existing) throw e;
      result = replayedRunResult(existing);
    }
    // Structured log — no PII (orgId + status only), scrubbed by the pino redactor.
    log.info({ orgId: principal.orgId, flow: "account-opening", status: result.status, executionId: result.executionId }, "flow started");
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
  // no fabricated Principal/role); finalize attributes its audit to the initiating
  // advisor's userId threaded through the flow context (ctx.initiatedBy).
  // Resume only runs post-suspend steps, so the pre-suspend key scope is inert.
  const deps = makeDeps(db, { orgId: app.org_id, actorUserId: "esign-webhook" }, `resume:${token}`);
  return withSpan("flow.account-opening.resume", { orgId: app.org_id }, () => resumeFlow(accountOpeningFlow, store, deps, token, payload));
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
  opts: { orgId: string; actor: string; action: string; entityType: string; entityId: string; detail: string },
): Promise<void> {
  const recorded = await auditedWrite({
    db, orgId: opts.orgId, actor: opts.actor, action: opts.action, entityType: opts.entityType,
    entityId: opts.entityId, detail: opts.detail, perform: async () => ({}),
  });
  if (!recorded.ok) {
    // The auth operation proceeds (availability over completeness — an explicit
    // ADR-0007 deferral with a fail-closed trigger), but the loss is never silent.
    log.error(
      { orgId: opts.orgId, action: opts.action, entityType: opts.entityType, entityId: opts.entityId, code: recorded.error.code },
      "security-event audit could not be recorded",
    );
  }
}
