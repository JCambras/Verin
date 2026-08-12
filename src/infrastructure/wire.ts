/**
 * Composition root (ADR-0001: app-layer wiring; keeps ports and adapters apart).
 *
 * SINCE PROMPT 10 (ADR-0057) THIS FILE COMPOSES; IT NO LONGER DESCRIBES. The
 * five-step account-opening flow used to be a hand-coded `FlowDefinition` in the
 * domain layer. It is now `config/domains/account-opening.yaml`, compiled into a
 * flow definition at request time - so deleting that file breaks the shipped
 * `/app/account-opening` journey, which is the honesty check the migration
 * exists to pass. What stays here is what a configuration must never contain:
 * span names, idempotency conventions, adapter dispatch, and the double-submit
 * semantics of the shipped route.
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import {
  assertWriteActor,
  systemWriteActor,
  type WriteActor,
} from "@contracts/principal";
import {
  assertActionGrant,
  type ActionGrant,
  type GovernedOutput,
} from "@contracts/authz";
import { assertSameTenant, type TenantContext } from "@contracts/tenant";
import { CLIENT_RETRY, clientRetryFor, type ClientRetry } from "@contracts/client-retry";
import type { PIIBearing } from "@contracts/pii";
import { type Result, ok, err } from "@contracts/result";
import { appError, normalizeAppError, type AppError } from "@contracts/errors";
import { MACHINE_RECORD_ID_RE, parseMachineRecordId } from "@contracts/record-id";
import { startFlow, resumeFlow, retryFlow, type ExecutionState, type ExecutionStore, type FlowRunResult, type ResumeGuard } from "@domain/workflow/engine";
import {
  CONFIG_VERSION_KEY,
  EXECUTION_SCOPE_KEY,
  INITIATING_ACTOR_KEY,
  type CompiledFlow,
  type ExecutionAdapters,
} from "@domain/config/plan-compiler";
import { configuredFlow } from "@infra/config/configured-flow";
import { versionMismatch, versionSuperseded } from "@infra/config/execution-version";
import { makeExecutionAdapters } from "@infra/execution-adapters";
import { makeExecutionStore } from "@infra/store/execution-store";
import { auditedWrite } from "@infra/audit/audited-write";
import { getApplicationByToken } from "@infra/crm/application-store";
import { signCallback, verifyCallback } from "@infra/esign/esign";
import { withSpan } from "@infra/observability/tracer";
import { keyedObservabilityId } from "@infra/observability/record-id";
import { classifyErrorMetadata, log } from "@infra/observability/logger";
import {
  authorityObservabilityId,
  generatedObservabilityId,
  type ObservabilityId,
  type ObservabilityAction,
  type ObservabilityEntityType,
} from "@domain/observability/safe-values";

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

/**
 * The start outcome, plus WHAT THE SUBMITTER SHOULD DO NEXT on a failure (D-237).
 * Every refusal below names its own instruction where the reason is still known;
 * by the time a surface holds the result, the code that produced it no longer
 * answers the question - two CONFLICTs from this function have opposite remedies.
 */
type AccountOpeningStartResult =
  & FlowRunResult
  & GovernedOutput<"execution.initiate">
  & { readonly retry?: ClientRetry };

/**
 * A refusal that carries its own instruction. The instruction is ASKED OF THE
 * CAUSE, never stated by the call site (D-241): the caller supplies what it knows
 * when the cause says nothing, and a configuration this deployment cannot resolve
 * or compile overrides it with `later` wherever it arises. Choosing per call site
 * is what left the start path telling an advisor "resubmitting will not help;
 * contact your operations team" about a document an operator rollback repairs.
 */
function refused(executionId: string, error: AppError, otherwise: ClientRetry): AccountOpeningStartResult {
  return { executionId, status: "failed", error, retry: clientRetryFor(error, otherwise), data: {} };
}

/**
 * The outcome of actually DRIVING steps. A step that failed did so after the
 * execution row committed, so the submitter's next move is to resubmit UNCHANGED:
 * that re-drives this same execution from its saved cursor and the per-write
 * idempotency keys replay the committed writes, where a fresh identity would open
 * a second execution and duplicate them. Which internal code the step raised does
 * not change that answer - and is exactly what must not reach the browser as if it
 * did, since an adapter can raise a VALIDATION long after a step has committed.
 */
function drivenOutcome(outcome: FlowRunResult): AccountOpeningStartResult {
  return outcome.status === "failed"
    ? { ...outcome, retry: clientRetryFor(outcome.error, CLIENT_RETRY.sameIdentity) }
    : outcome;
}

/**
 * Report an already-started execution's current state (double-submit replay).
 * The awaited rule is the one the SUSPENDING step emitted - the engine advances
 * the cursor past that step before persisting, so it is the compiled step at
 * `cursor - 1`. Scanning the document for the first externally-gated capability
 * would agree only while a domain has exactly one.
 *
 * REFUSING TO DRIVE IS NOT REFUSING TO REPORT (D-237). That cursor is POSITIONAL,
 * so the awaited rule is only this execution's under the plan it started with:
 * read out of a DIFFERENT version's plan it names a step the execution never
 * took. But this path runs no step - it states what an execution that already
 * exists is doing - so a version disagreement DEGRADES the one derived field
 * rather than answering `failed`. The persisted facts (status, resume token) are
 * reported as they stand, and the awaited rule is left UNDETERMINED, which is
 * the truth: this configuration cannot name the step. Answering `failed` here
 * would tell a browser its submission did not happen, and a client that mints a
 * fresh request id on that reading opens a SECOND execution - the duplicate
 * household the version guard exists to prevent. The paths that genuinely drive
 * steps still refuse.
 */
function replayedRunResult(flow: CompiledFlow, state: ExecutionState): FlowRunResult {
  const undetermined = state.status === "suspended" && versionSuperseded(flow, state);
  return {
    executionId: state.id,
    status: state.status,
    token: state.resumeToken ?? undefined,
    awaiting: state.status === "suspended" && !undetermined
      ? flow.awaitingByStep[state.cursor - 1]
      : undefined,
    data: state.data,
  };
}

/**
 * The client-editable fields persisted at start (D-027): a replayed request id is
 * honored only when these match the original submission, so an edited resubmit
 * under the same id can never silently write the stale values.
 *
 * This is ALSO the exact set `StartAccountOpeningInput` can carry, which is why
 * the intake route refuses an admitted field outside it rather than dropping it:
 * a configured slot this fixed shape has no room for would otherwise be judged
 * at the boundary and then silently discarded, failing at whatever step consumes
 * it - after earlier steps have already committed. Deriving the start input from
 * the configured trigger fields is the generic intake pipeline (prompt 12,
 * D-223); until then the seam refuses instead of losing a value.
 */
export const START_INPUT_FIELDS = ["householdName", "firstName", "lastName", "email", "accountType"] as const;

function inputMatchesExecution(input: StartAccountOpeningInput, existing: ExecutionState): boolean {
  return START_INPUT_FIELDS.every((field) => existing.data[field] === input[field]);
}

/**
 * Typed refusal of an edited replay: the client must mint a new request id (D-027).
 * This is the one refusal here whose remedy IS a fresh identity, so it says so
 * structurally rather than in message text a client cannot act on.
 */
function editedReplayConflict(executionId: string): AccountOpeningStartResult {
  return refused(
    executionId,
    appError("CONFLICT", "This request id was already used with different input; mint a new request id and resubmit."),
    CLIENT_RETRY.newIdentity,
  );
}

/**
 * THE shape of a client-minted request id (D-027) — the account-opening route
 * validates against this same constant, so the surface and the flow can never
 * disagree about what it accepts. UUIDs are minted in either case.
 */
export const CLIENT_REQUEST_ID_RE = MACHINE_RECORD_ID_RE;

/**
 * The request id becomes the persisted executionId. Server-generated IDs carry
 * direct mint provenance; client IDs are canonicalized for persistence and use
 * a tenant-scoped keyed observability value. Invalid input is refused before any
 * household, contact, or application write commits.
 */
function canonicalExecutionId(
  clientRequestId: string | undefined,
  tenant: TenantContext,
): Result<{ readonly id: string; readonly observable: ObservabilityId }, AppError> {
  if (clientRequestId === undefined) {
    const generated = generatedObservabilityId("executionId", randomUUID());
    return ok({
      id: generated.value,
      observable: generated,
    });
  }
  const id = parseMachineRecordId("execution", clientRequestId);
  if (!id) {
    return err(appError("VALIDATION", "A client request id must be an opaque machine identifier (a UUID minted once per form session)."));
  }
  return ok({
    id,
    observable: keyedObservabilityId("executionId", tenant, id),
  });
}

/** Re-drive a failed start; a storage throw surfaces as a typed failure, never an unenveloped 500. */
async function retryFailedStart(flow: CompiledFlow, store: ExecutionStore, deps: ExecutionAdapters, existing: ExecutionState, tenant: TenantContext): Promise<AccountOpeningStartResult> {
  // The re-drive resumes from the SAVED cursor, so it carries the same
  // positional hazard a webhook resume does. No resubmission clears it - only a
  // configuration change an operator makes - so the submitter keeps this
  // execution's identity and is told to come back once that repair has landed,
  // never to give up on work that is still completable (D-239).
  const stale = versionMismatch(flow, existing, tenant);
  if (stale) return refused(existing.id, stale, CLIENT_RETRY.sameIdentity);
  try {
    return drivenOutcome(await retryFlow(flow.definition, store, deps, existing, tenant));
  } catch (e) {
    const error = normalizeAppError(e) ??
      appError("INTERNAL", "The account-opening flow could not be retried.");
    return refused(existing.id, error, CLIENT_RETRY.sameIdentity);
  }
}

export async function startAccountOpening(
  db: SqlDb,
  grant: ActionGrant<"execution.initiate">,
  piiGrant: ActionGrant<"pii.view">,
  input: StartAccountOpeningInput,
): Promise<AccountOpeningStartResult> {
  assertActionGrant(grant, "execution.initiate");
  assertActionGrant(piiGrant, "pii.view");
  assertSameTenant(grant.tenant, piiGrant.tenant);
  const tenant = grant.tenant;
  const canonical = canonicalExecutionId(input.clientRequestId, tenant);
  if (!canonical.ok) {
    // The identity itself is the thing refused, so a fresh one is the remedy.
    return refused("", canonical.error, CLIENT_RETRY.newIdentity);
  }
  // The configuration IS the flow: a missing or unrunnable document fails the
  // request before any write, rather than silently falling back to code. No
  // submission can fix a document, so the submitter is told not to keep trying.
  const flow = configuredFlow();
  if (!flow.ok) {
    return refused(canonical.value.id, flow.error, CLIENT_RETRY.none);
  }
  const store = makeExecutionStore(db);
  const executionId = canonical.value.id;
  const observableExecutionId = canonical.value.observable;
  const deps = makeExecutionAdapters(db, grant.writeActor, flow.value.refuse);
  // A client-minted id that already started is a double-submit: report the
  // existing execution's state instead of starting a duplicate. The tenant-scoped
  // loadById filters org_id in SQL, so a (guessed) foreign execution id can never
  // leak another tenant's state.
  const loadOwnExecution = async (): Promise<ExecutionState | null> => {
    const existing = await store.loadById(executionId, piiGrant);
    return existing && existing.flowId === flow.value.definition.id ? existing : null;
  };
  if (input.clientRequestId) {
    const existing = await loadOwnExecution();
    if (existing && !inputMatchesExecution(input, existing)) return editedReplayConflict(executionId);
    if (existing && existing.status !== "failed") return replayedRunResult(flow.value, existing);
    if (existing) {
      // A replayed id whose execution FAILED is re-driven from its saved cursor
      // (resumeFlow's Vale V7 retry, applied to the start path): the per-write
      // idempotency keys replay the committed writes, so the user's resubmit
      // recovers instead of dead-ending on the persisted failure.
      return withSpan("flow.account-opening.retry", {
        orgId: authorityObservabilityId("orgId", tenant),
        actor: authorityObservabilityId("actor", tenant),
      }, async () => {
        const result = await retryFailedStart(flow.value, store, deps, existing, tenant);
        log.info({
          orgId: authorityObservabilityId("orgId", tenant),
          flow: "account-opening",
          status: result.status,
          executionId: observableExecutionId,
        }, "flow retried");
        return result;
      });
    }
  }
  // Span attribution is the opaque userId, never the email — OTel attributes are
  // exported to the OTLP endpoint and must not carry PII (ADR-0006/0013).
  return withSpan("flow.account-opening.start", {
    orgId: authorityObservabilityId("orgId", tenant),
    actor: authorityObservabilityId("actor", tenant),
  }, async () => {
    let result: AccountOpeningStartResult;
    try {
      result = drivenOutcome(await startFlow(flow.value.definition, store, deps, {
        executionId,
        tenant,
        data: {
          ...input,
          [INITIATING_ACTOR_KEY]: grant.actorId,
          // The per-execution idempotency scope the configuration's key segments
          // draw on. Persisted with the execution, so a retry of the SAME
          // execution replays the committed writes instead of duplicating them.
          [EXECUTION_SCOPE_KEY]: executionId,
          // The plan this execution is bound to, persisted so a later drive of
          // its stored cursor can prove it is still the same plan.
          [CONFIG_VERSION_KEY]: flow.value.domainConfigVersionId,
        },
      }));
    } catch (e) {
      // Two concurrent submits can both miss the pre-check; ONLY the loser's
      // INSERT hitting the flow_executions PK (SQLSTATE 23505) resolves as the
      // same replay. Any other throw is a real storage failure and surfaces as a
      // typed failure — never masked as a started flow, never an unenveloped 500.
      const metadata = classifyErrorMetadata(e);
      const raced = input.clientRequestId && metadata.sqlState === "23505"
        ? await loadOwnExecution()
        : null;
      if (raced && !inputMatchesExecution(input, raced)) {
        result = editedReplayConflict(executionId);
      } else if (raced) {
        result = raced.status === "failed"
          ? await retryFailedStart(flow.value, store, deps, raced, tenant)
          : replayedRunResult(flow.value, raced);
      } else {
        // A storage failure at the very first write: whether the row landed is
        // exactly what is unknown here, so the submitter keeps the identity - a
        // resubmit that finds the row replays it, and one that does not starts it.
        const error = metadata.appError ??
          appError("INTERNAL", "The account-opening flow could not be started.");
        result = refused(executionId, error, CLIENT_RETRY.sameIdentity);
      }
    }
    // Structured log — no PII (orgId + status only), scrubbed by the pino redactor.
    log.info({
      orgId: authorityObservabilityId("orgId", tenant),
      flow: "account-opening",
      status: result.status,
      executionId: observableExecutionId,
    }, "flow started");
    return result;
  });
}

/**
 * The resume outcome plus WHAT THE SENDER SHOULD DO NEXT, in the same closed
 * vocabulary the browser reads (D-239). The e-sign provider is a different
 * audience, so the webhook route turns the instruction into a status - but the
 * instruction itself is decided HERE, where the reason is still known.
 */
type AccountOpeningResumeResult = FlowRunResult & { readonly retry?: ClientRetry };

export async function resumeAccountOpeningByToken(
  db: SqlDb,
  token: string,
  payload: Record<string, unknown>,
): Promise<AccountOpeningResumeResult | { status: "not-found" }> {
  const app = await getApplicationByToken(db, token);
  if (!app) return { status: "not-found" };
  const store = makeExecutionStore(db);
  // The starter here is the reserved SYSTEM actor id (typed truth, finding #13:
  // no fabricated Principal/role) with a system-minted tenant scoped to the
  // application row's org; finalize attributes its audit to the initiating
  // advisor's userId threaded through the flow context (ctx.initiatedBy).
  // Resume only runs post-suspend steps, so the pre-suspend key scope is inert.
  const starter = systemWriteActor("esign-webhook", app.org_id);
  const flow = configuredFlow();
  if (!flow.ok) {
    // The same operator-recoverable cause the start path answers, answered the
    // same way (D-241): without this the webhook fell through to an unpaced 500,
    // which is the unbounded redelivery the do-not-redeliver status exists to stop.
    return {
      executionId: "",
      status: "failed",
      error: flow.error,
      retry: clientRetryFor(flow.error, CLIENT_RETRY.sameIdentity),
      data: {},
    };
  }
  const deps = makeExecutionAdapters(db, starter, flow.value.refuse);
  // The cursor this resume would drive is POSITIONAL, so it is only meaningful
  // against the plan the execution started under. A mid-flight configuration
  // version bump fails LOUDLY rather than silently resuming at the wrong step.
  //
  // Judged INSIDE the resume, against the snapshot the drive itself loaded.
  // Loading the row here to check it and letting `resumeFlow` load it again was a
  // third sequential round trip on the webhook path, against a store that
  // serializes every operation behind a mutex - and two snapshots, so the version
  // checked was not provably the version driven. The guard emits the parked-callback
  // line an operator watches, so a signature waiting on a rollback is never
  // discovered by a client phoning to ask why nothing happened.
  const refuseSupersededVersion: ResumeGuard = (state, tenant) =>
    versionMismatch(flow.value, state, tenant);
  const outcome = await withSpan("flow.account-opening.resume", {
    orgId: authorityObservabilityId("orgId", starter.tenant),
  }, () =>
    resumeFlow(flow.value.definition, store, deps, token, payload, starter.tenant, refuseSupersededVersion),
  );
  // A superseded version CLEARS when an operator rolls the published document
  // back (or when PC-4 lands), so the sender is told to come back - never that
  // the callback is refused for good, which would discard the signature event.
  // Read off the refusal's own cause, so the webhook never has to know which
  // failures those are.
  return outcome.status === "failed"
    ? { ...outcome, retry: clientRetryFor(outcome.error, CLIENT_RETRY.sameIdentity) }
    : outcome;
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
): Promise<AccountOpeningResumeResult | { status: "not-found" } | { status: "invalid-signature" }> {
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
  opts: { actor: WriteActor; action: ObservabilityAction; entityType: ObservabilityEntityType; entityId: string; detail: string },
): Promise<void> {
  const actor = opts.actor;
  assertWriteActor(actor);
  const recorded = await auditedWrite({
    db, actor, action: opts.action, entityType: opts.entityType,
    entityId: opts.entityId, detail: opts.detail, perform: async () => ({}),
  });
  if (!recorded.ok) {
    // The auth operation proceeds (availability over completeness — an explicit
    // ADR-0007 deferral with a fail-closed trigger), but the loss is never silent.
    log.error(
      {
        // A request-controlled entity ID hashes or redacts without throwing, so a
        // digest failure cannot silence the lost-audit report or fail its caller.
        orgId: authorityObservabilityId("orgId", actor.tenant),
        action: opts.action,
        entityType: opts.entityType,
        entityId: keyedObservabilityId("entityId", actor.tenant, opts.entityId),
        code: recorded.error.code,
      },
      "security-event audit could not be recorded",
    );
  }
}
