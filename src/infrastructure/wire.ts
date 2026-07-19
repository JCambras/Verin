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

function principalForActor(orgId: string, actor: string): Principal {
  return { userId: "esign-webhook", orgId, role: "ops", actor, sessionId: "esign-webhook" };
}

function makeDeps(db: SqlDb, starter: Principal): AccountOpeningDeps {
  return {
    createHousehold: (name) =>
      withSpan("crm.household.create", { orgId: starter.orgId }, async () => must(await createHousehold(db, starter, { name }))),
    createContact: (input) =>
      withSpan("crm.contact.create", { orgId: starter.orgId }, async () => must(await createContact(db, starter, input))),
    createApplication: (input) =>
      withSpan("crm.application.create", { orgId: starter.orgId }, async () => must(await createApplication(db, starter, input))),
    requestEsign: (applicationId) =>
      withSpan("esign.request", { orgId: starter.orgId }, async () => {
        const token = newEsignToken();
        return must(await setEsignRequested(db, starter, applicationId, token));
      }),
    finalize: (input) =>
      withSpan("account-opening.finalize", { orgId: starter.orgId, applicationId: input.applicationId }, async () => {
        const actorP = principalForActor(starter.orgId, input.actor);
        // Idempotent, audited: a doubly-fired webhook yields exactly-once effect.
        must(await createFinancialAccount(db, actorP, { householdId: input.householdId, accountType: input.accountType }, `account:${input.applicationId}`));
        must(await createTask(db, actorP, { householdId: input.householdId, subject: `Fund the new ${input.accountType} account` }, `task:${input.applicationId}`));
        must(await completeApplication(db, starter.orgId, input.actor, input.applicationId));
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
  const deps = makeDeps(db, principal);
  return withSpan("flow.account-opening.start", { orgId: principal.orgId, actor: principal.actor }, async () => {
    const result = await startFlow(accountOpeningFlow, store, deps, {
      executionId: randomUUID(),
      orgId: principal.orgId,
      data: { ...input, initiatedBy: principal.actor },
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
  // initiating advisor threaded through the flow context (ctx.initiatedBy).
  const deps = makeDeps(db, principalForActor(app.org_id, "esign-webhook"));
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
