/**
 * Generic workflow engine with suspend / await-external-input / resume (ADR-0011,
 * charter #6) — Iris's admitted largest gap, in the core contract before any flow
 * is authored. A step may `suspend` (returning a resume token) instead of running
 * to completion; the engine persists the continuation and returns. An external
 * event (a webhook) calls resumeFlow(token, payload) to run the remaining steps.
 * Resume is idempotent at the write layer (auditedWrite), so a doubly-fired
 * webhook has exactly-once effect (charter #16).
 */
import { isAppError, type AppError } from "@contracts/errors";

export type FlowData = Record<string, unknown>;

export type ExecutionStatus = "running" | "suspended" | "completed" | "failed";

export interface ExecutionState {
  id: string;
  orgId: string;
  flowId: string;
  status: ExecutionStatus;
  resumeToken: string | null;
  cursor: number;
  data: FlowData;
}

/** Port: persist/load flow continuations (implemented in infrastructure). */
export interface ExecutionStore {
  create(state: ExecutionState): Promise<void>;
  save(state: ExecutionState): Promise<void>;
  loadById(id: string): Promise<ExecutionState | null>;
  loadByToken(token: string): Promise<ExecutionState | null>;
}

export type StepResult =
  | { kind: "continue"; patch?: FlowData }
  | { kind: "suspend"; token: string; awaiting: string; patch?: FlowData }
  | { kind: "fail"; error: AppError };

export interface FlowStep<D> {
  id: string;
  name: string;
  execute(ctx: FlowData, deps: D): Promise<StepResult>;
}

export interface FlowDefinition<D> {
  id: string;
  name: string;
  steps: FlowStep<D>[];
}

export interface FlowRunResult {
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
): Promise<FlowRunResult> {
  let { cursor, data } = state;
  while (cursor < def.steps.length) {
    const step = def.steps[cursor]!;
    let result: StepResult;
    try {
      result = await step.execute(data, deps);
    } catch (e) {
      // Only a real AppError (in-taxonomy code) passes through; anything else —
      // driver errors with a `code` like '23505'/'ENOENT' included — becomes a
      // vetted INTERNAL so downstream statusFor/toResponse never sees an unknown
      // code or leaks an unvetted message.
      const error: AppError = isAppError(e) ? e : { code: "INTERNAL", message: "Step threw" };
      result = { kind: "fail", error };
    }

    if (result.kind === "fail") {
      const failed: ExecutionState = { ...state, status: "failed", cursor, data };
      await store.save(failed);
      return { executionId: state.id, status: "failed", error: result.error, data };
    }

    if (result.patch) data = { ...data, ...result.patch };
    cursor += 1; // the suspending step has done its work; resume continues after it.

    if (result.kind === "suspend") {
      const suspended: ExecutionState = { ...state, status: "suspended", resumeToken: result.token, cursor, data };
      await store.save(suspended);
      return { executionId: state.id, status: "suspended", token: result.token, awaiting: result.awaiting, data };
    }
  }

  // Keep resumeToken so a replayed webhook still resolves this (now completed)
  // execution and returns its status idempotently instead of "not-found".
  const completed: ExecutionState = { ...state, status: "completed", cursor, data };
  await store.save(completed);
  return { executionId: state.id, status: "completed", data };
}

export async function startFlow<D>(
  def: FlowDefinition<D>,
  store: ExecutionStore,
  deps: D,
  input: { executionId: string; orgId: string; data: FlowData },
): Promise<FlowRunResult> {
  const state: ExecutionState = {
    id: input.executionId,
    orgId: input.orgId,
    flowId: def.id,
    status: "running",
    resumeToken: null,
    cursor: 0,
    data: input.data,
  };
  await store.create(state);
  return drive(def, store, deps, state);
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
): Promise<FlowRunResult> {
  return drive(def, store, deps, { ...state, status: "running" });
}

export async function resumeFlow<D>(
  def: FlowDefinition<D>,
  store: ExecutionStore,
  deps: D,
  token: string,
  payload: FlowData,
): Promise<FlowRunResult | { status: "not-found" }> {
  const state = await store.loadByToken(token);
  if (!state) return { status: "not-found" };
  if (state.status === "completed") {
    // Already finalized (idempotent): report without re-running.
    return { executionId: state.id, status: "completed", data: state.data };
  }
  if (state.status !== "suspended" && state.status !== "failed") {
    return { executionId: state.id, status: state.status, data: state.data };
  }
  // A "failed" execution is RETRIED from its saved cursor (Vale V7): the per-write
  // idempotency keys make the already-committed writes replay safely, so a transient
  // mid-finalize error is recoverable instead of permanently wedged.
  // Trusted flow context takes precedence over the (HMAC-token-authed but
  // unsigned) webhook payload, so a payload cannot override accountType/actor (Vale V18).
  const resumed: ExecutionState = { ...state, status: "running", data: { ...payload, ...state.data } };
  return drive(def, store, deps, resumed);
}
