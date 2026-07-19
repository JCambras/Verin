/**
 * Composition root (ADR-0001: app-layer wiring; keeps ports and adapters apart).
 * Builds the account-opening deps from the store + principal, wraps every external
 * call in a span (charter #14), and drives the engine's suspend/resume.
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import type { Principal } from "@contracts/principal";
import { type Result } from "@contracts/result";
import type { AppError } from "@contracts/errors";
import { startFlow, resumeFlow, type FlowRunResult } from "@domain/workflow/engine";
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

function principalForActor(orgId: string, actorUserId: string): Principal {
  return { userId: actorUserId, orgId, role: "ops", actor: actorUserId, sessionId: "esign-webhook" };
}

/**
 * `executionId` scopes the pre-suspend idempotency keys: a retry of the SAME
 * execution (after a transient failure mid-flow) replays the already-committed
 * writes instead of duplicating households/contacts/applications. Cross-submit
 * dedup and retry-by-execution-id recovery are a recorded ADR-0011 deferral.
 */
function makeDeps(db: SqlDb, starter: Principal, executionId: string): AccountOpeningDeps {
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
        const actorP = principalForActor(starter.orgId, input.actor);
        // Idempotent, audited: a doubly-fired webhook yields exactly-once effect.
        // Per-write keys derive from the application's minted idempotency key
        // (threaded through the flow context), so the key the application row
        // records is the one that actually guards finalize.
        must(await createFinancialAccount(db, actorP, { householdId: input.householdId, accountType: input.accountType }, `account:${input.idempotencyKey}`));
        must(await createTask(db, actorP, { householdId: input.householdId, subject: `Fund the new ${input.accountType} account` }, `task:${input.idempotencyKey}`));
        must(await completeApplication(db, starter.orgId, input.actor, input.applicationId, `complete:${input.idempotencyKey}`));
      }),
  };
}

export interface StartAccountOpeningInput {
  householdName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  accountType: string;
}

export async function startAccountOpening(db: SqlDb, principal: Principal, input: StartAccountOpeningInput): Promise<FlowRunResult> {
  const store = makeExecutionStore(db);
  const executionId = randomUUID();
  const deps = makeDeps(db, principal, executionId);
  // Span attribution is the opaque userId, never the email — OTel attributes are
  // exported to the OTLP endpoint and must not carry PII (ADR-0006/0013).
  return withSpan("flow.account-opening.start", { orgId: principal.orgId, actor: principal.userId }, async () => {
    const result = await startFlow(accountOpeningFlow, store, deps, {
      executionId,
      orgId: principal.orgId,
      data: { ...input, initiatedBy: principal.userId },
    });
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
  // The starter principal is a placeholder here; finalize attributes audit to the
  // initiating advisor's userId threaded through the flow context (ctx.initiatedBy).
  // Resume only runs post-suspend steps, so the pre-suspend key scope is inert.
  const deps = makeDeps(db, principalForActor(app.org_id, "esign-webhook"), `resume:${token}`);
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
