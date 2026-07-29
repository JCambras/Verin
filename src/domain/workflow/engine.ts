/**
 * Generic workflow engine with suspend / await-external-input / resume (ADR-0011,
 * charter #6) — Iris's admitted largest gap, in the core contract before any flow
 * is authored. A step may `suspend` (returning a resume token) instead of running
 * to completion; the engine persists the continuation and returns. An external
 * event (a webhook) calls resumeFlow(token, payload) to run the remaining steps.
 * Resume is idempotent at the write layer, so replay has exactly-once effect.
 */
import { normalizeAppError, type AppError } from "@contracts/errors";
import type { ActionGrant } from "@contracts/authz";
import type { PIIBearing } from "@contracts/pii";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";

export type FlowData = Record<string, unknown> & PIIBearing;

export type ExecutionStatus = "running" | "suspended" | "completed" | "failed";

export interface ExecutionState extends PIIBearing {
  id: string;
  orgId: string;
  flowId: string;
  status: ExecutionStatus;
  resumeToken: string | null;
  cursor: number;
  data: FlowData;
}

/**
 * Port: persist/load flow continuations (implemented in infrastructure).
 * Every call carries the sealed TenantContext (v3 §15.2) except loadByToken —
 * the webhook resume path is capability-keyed by the unguessable token and the
 * tenant comes FROM the row (the same reviewed escape as the org-id fence);
 * resumeFlow re-checks the loaded row against the caller's tenant.
 */
export interface ExecutionStore extends PIIBearing {
  create(state: ExecutionState, tenant: TenantContext): Promise<void>;
  save(state: ExecutionState, tenant: TenantContext): Promise<void>;
  loadById(id: string, grant: ActionGrant<"pii.view">): Promise<ExecutionState | null>;
  loadByToken(token: string): Promise<ExecutionState | null>;
}

export type StepResult =
  | { kind: "continue"; patch?: FlowData }
  | { kind: "suspend"; token: string; awaiting: string; patch?: FlowData }
  | { kind: "fail"; error: AppError };

export interface FlowStep<D> extends PIIBearing {
  id: string;
  name: string;
  execute(ctx: FlowData, deps: D, tenant: TenantContext): Promise<StepResult>;
}

export interface FlowDefinition<D> {
  id: string;
  name: string;
  steps: FlowStep<D>[];
}

export interface FlowRunResult extends PIIBearing {
  executionId: string;
  status: ExecutionStatus;
  token?: string;
  awaiting?: string;
  error?: AppError;
  data: FlowData;
}

async function drive<D>(
  def: FlowDefinition<D>,
  store: ExecutionStore,
  deps: D,
  state: ExecutionState,
  tenant: TenantContext,
): Promise<FlowRunResult> {
  let { cursor, data } = state;
  while (cursor < def.steps.length) {
    const step = def.steps[cursor]!;
    let result: StepResult;
    try {
      result = await step.execute(data, deps, tenant);
    } catch (e) {
      // Only a real AppError (in-taxonomy code) passes through; anything else —
      // driver errors with a `code` like '23505'/'ENOENT' included — becomes a
      // vetted INTERNAL so downstream statusFor/toResponse never sees an unknown
      // code or leaks an unvetted message.
      const error: AppError = normalizeAppError(e) ?? { code: "INTERNAL", message: "Step threw" };
      result = { kind: "fail", error };
    }

    if (result.kind === "fail") {
      const failed: ExecutionState = { ...state, status: "failed", cursor, data };
      await store.save(failed, tenant);
      return { executionId: state.id, status: "failed", error: result.error, data };
    }

    if (result.patch) data = { ...data, ...result.patch };
    cursor += 1; // the suspending step has done its work; resume continues after it.

    if (result.kind === "suspend") {
      const suspended: ExecutionState = { ...state, status: "suspended", resumeToken: result.token, cursor, data };
      await store.save(suspended, tenant);
      return { executionId: state.id, status: "suspended", token: result.token, awaiting: result.awaiting, data };
    }
  }

  // Keep resumeToken so a replayed webhook still resolves this (now completed)
  // execution and returns its status idempotently instead of "not-found".
  const completed: ExecutionState = { ...state, status: "completed", cursor, data };
  await store.save(completed, tenant);
  return { executionId: state.id, status: "completed", data };
}

export async function startFlow<D>(
  def: FlowDefinition<D>,
  store: ExecutionStore,
  deps: D,
  input: { executionId: string; tenant: TenantContext; data: FlowData },
): Promise<FlowRunResult> {
  const state: ExecutionState = {
    id: input.executionId,
    orgId: input.tenant.orgId,
    flowId: def.id,
    status: "running",
    resumeToken: null,
    cursor: 0,
    data: input.data,
  };
  await store.create(state, input.tenant);
  return drive(def, store, deps, state, input.tenant);
}

/**
 * Re-drive a FAILED execution from its saved cursor — the start-path mirror of
 * resumeFlow's Vale V7 retry (D-027): writes committed before the failure sit
 * behind per-write idempotency keys, so re-running the failed step is safe and a
 * resubmit of the same client request id recovers instead of dead-ending on the
 * persisted failure. Callers gate on status === "failed".
 */
export async function retryFlow<D>(
  def: FlowDefinition<D>,
  store: ExecutionStore,
  deps: D,
  state: ExecutionState,
  tenant: TenantContext,
): Promise<FlowRunResult> {
  assertTenantContext(tenant);
  if (state.orgId !== tenant.orgId) return { executionId: state.id, status: "failed", error: { code: "AUTH_FAILED", message: "Execution does not belong to this tenant" }, data: {} };
  return drive(def, store, deps, { ...state, status: "running" }, tenant);
}
export async function resumeFlow<D>(
  def: FlowDefinition<D>,
  store: ExecutionStore,
  deps: D,
  token: string,
  payload: FlowData,
  tenant: TenantContext,
): Promise<FlowRunResult | { status: "not-found" }> {
  const state = await store.loadByToken(token);
  if (!state) return { status: "not-found" };
  // The token is the capability, but the caller's tenant (derived from the
  // application row) must agree with the execution row — a cross-tenant
  // token/application mismatch reads as absent, never as another org's state.
  if (state.orgId !== tenant.orgId) return { status: "not-found" };
  if (state.status === "completed") {
    // Already finalized (idempotent): report without re-running.
    return { executionId: state.id, status: "completed", data: state.data };
  }
  if (state.status !== "suspended" && state.status !== "failed") {
    return { executionId: state.id, status: state.status, data: state.data };
  }
  // Failed resumes share retryFlow's saved-cursor, idempotent-write contract
  // (D-027), so transient mid-finalize errors remain recoverable.
  // Trusted flow context takes precedence over the (HMAC-token-authed but
  // unsigned) webhook payload, so a payload cannot override accountType/actor (Vale V18).
  const resumed: ExecutionState = { ...state, status: "running", data: { ...payload, ...state.data } };
  return drive(def, store, deps, resumed, tenant);
}
