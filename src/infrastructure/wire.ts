/**
 * Composition root (ADR-0001: app-layer wiring; keeps ports and adapters apart).
 *
 * SINCE PROMPT 10 (ADR-0056) THIS FILE COMPOSES; IT NO LONGER DESCRIBES. The
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
import type { PIIBearing } from "@contracts/pii";
import { type Result, ok, err } from "@contracts/result";
import { appError, normalizeAppError, type AppError } from "@contracts/errors";
import { MACHINE_RECORD_ID_RE, parseMachineRecordId } from "@contracts/record-id";
import { startFlow, resumeFlow, retryFlow, type ExecutionState, type ExecutionStore, type FlowRunResult } from "@domain/workflow/engine";
import {
  compileFlowDefinition,
  EXECUTION_SCOPE_KEY,
  INITIATING_ACTOR_KEY,
  type CompiledFlow,
  type ExecutionAdapters,
} from "@domain/config/plan-compiler";
import { ACCOUNT_OPENING_DOMAIN, loadPublishedDomainConfig } from "@infra/config/domain-config-source";
import { makeExecutionAdapters, SUPPORTED_COMMAND_TYPES } from "@infra/execution-adapters";
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

/**
 * The action the published configuration this surface runs declares. The route
 * and the page carry the same shipped names (CD-1 leaves shipped URLs and record
 * vocabulary unrenamed); everything the flow DOES comes from the document, whose
 * id lives beside the source that resolves it.
 */
const ACCOUNT_OPENING_ACTION = "open-account";

/**
 * Compile the shipped domain configuration into a runnable flow. Every failure
 * here is a typed AppError the surface reports: a missing, invalid, or
 * unrunnable configuration must break the flow loudly, never degrade to a
 * hard-coded fallback (which would make the configuration dead data).
 */
function configuredFlow(): Result<CompiledFlow, AppError> {
  const sourced = loadPublishedDomainConfig(ACCOUNT_OPENING_DOMAIN);
  if (!sourced.ok) return sourced;
  const config = sourced.value.config;
  const unsupported = config.document.execution.capabilities
    .map((capability) => capability.commandType)
    .filter((commandType) => !SUPPORTED_COMMAND_TYPES.includes(commandType));
  if (unsupported.length > 0) {
    return err(
      appError("INTERNAL", `This deployment has no execution adapter for: ${[...new Set(unsupported)].sort().join(", ")}.`),
    );
  }
  return compileFlowDefinition(config, ACCOUNT_OPENING_ACTION);
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

/**
 * Report an already-started execution's current state (double-submit replay).
 * The awaited rule is the one the SUSPENDING step emitted - the engine advances
 * the cursor past that step before persisting, so it is the compiled step at
 * `cursor - 1`. Scanning the document for the first externally-gated capability
 * would agree only while a domain has exactly one.
 */
function replayedRunResult(flow: CompiledFlow, state: ExecutionState): FlowRunResult {
  return {
    executionId: state.id,
    status: state.status,
    token: state.resumeToken ?? undefined,
    awaiting: state.status === "suspended" ? flow.awaitingByStep[state.cursor - 1] : undefined,
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
async function retryFailedStart(flow: CompiledFlow, store: ExecutionStore, deps: ExecutionAdapters, existing: ExecutionState, tenant: TenantContext): Promise<FlowRunResult> {
  try {
    return await retryFlow(flow.definition, store, deps, existing, tenant);
  } catch (e) {
    const error = normalizeAppError(e) ??
      appError("INTERNAL", "The account-opening flow could not be retried.");
    return { executionId: existing.id, status: "failed", error, data: {} };
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
    return { executionId: "", status: "failed", error: canonical.error, data: {} };
  }
  // The configuration IS the flow: a missing or unrunnable document fails the
  // request before any write, rather than silently falling back to code.
  const flow = configuredFlow();
  if (!flow.ok) {
    return { executionId: canonical.value.id, status: "failed", error: flow.error, data: {} };
  }
  const store = makeExecutionStore(db);
  const executionId = canonical.value.id;
  const observableExecutionId = canonical.value.observable;
  const deps = makeExecutionAdapters(db, grant.writeActor);
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
    let result: FlowRunResult;
    try {
      result = await startFlow(flow.value.definition, store, deps, {
        executionId,
        tenant,
        data: {
          ...input,
          [INITIATING_ACTOR_KEY]: grant.actorId,
          // The per-execution idempotency scope the configuration's key segments
          // draw on. Persisted with the execution, so a retry of the SAME
          // execution replays the committed writes instead of duplicating them.
          [EXECUTION_SCOPE_KEY]: executionId,
        },
      });
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
        const error = metadata.appError ??
          appError("INTERNAL", "The account-opening flow could not be started.");
        result = { executionId, status: "failed", error, data: {} };
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
  const flow = configuredFlow();
  if (!flow.ok) {
    return { executionId: "", status: "failed", error: flow.error, data: {} };
  }
  const deps = makeExecutionAdapters(db, starter);
  return withSpan("flow.account-opening.resume", {
    orgId: authorityObservabilityId("orgId", starter.tenant),
  }, () =>
    resumeFlow(flow.value.definition, store, deps, token, payload, starter.tenant),
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
