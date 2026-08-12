/**
 * WHICH PUBLISHED CONFIGURATION VERSION A PERSISTED EXECUTION IS BOUND TO
 * (v3 prompt 10; ADR-0058).
 *
 * One rule, in one place, because three paths ask it and they must not answer
 * differently: the start path's re-drive of a failed execution, the e-sign
 * webhook's resume, and the replay report that only STATES what an execution is
 * doing. It lives beside the configuration source rather than in the composition
 * root because it is a fact about the document, not about how a request is wired.
 */
import { randomUUID } from "node:crypto";
import { appError, type AppError } from "@contracts/errors";
import { CLIENT_RETRY, clientRetryFor, operatorRecoverable } from "@contracts/client-retry";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import { CONFIG_VERSION_KEY, type CompiledFlow } from "@domain/config/plan-compiler";
import type { ExecutionState } from "@domain/workflow/engine";
import {
  authorityObservabilityId,
  configurationDiagnosisId,
  generatedObservabilityId,
  type ConfigurationStage,
} from "@domain/observability/safe-values";
import { keyedObservabilityId } from "@infra/observability/record-id";
import { log } from "@infra/observability/logger";

/**
 * MISSING IS NOT MISMATCHED. An execution carrying no recorded version predates
 * the pinning itself, so it can only have started under the plan published
 * before this guard existed: it is LEGACY and continues. Refusing it would make
 * the guard's first act on deployment the stranding of every legitimate in-flight
 * execution - the very before-deploy/after-deploy harm it exists to prevent. A
 * recorded value that is not a version string is neither, and fails closed.
 */
type VersionVerdict =
  | { readonly kind: "compatible" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "superseded"; readonly started: string };

/**
 * TREATING AN ABSENT PERSISTED VERSION AS COMPATIBLE IS INTENTIONAL (D-246/D-250).
 *
 * WHY: an execution carrying no pinned version can only have started under the
 * plan published BEFORE pinning existed, so refusing on absence would make the
 * guard's first act on deployment the stranding of every legitimate in-flight
 * execution - a client who has already signed, parked forever - which is the exact
 * harm this guard exists to prevent.
 *
 * WHAT IT COSTS: a persisted version that was stripped or is genuinely unreadable
 * as a KEY is indistinguishable from a legacy one, so it resumes rather than
 * refusing. (A recorded value that is present but is not a version STRING is a
 * different fact and still fails closed, below.) The guard is therefore inert for
 * exactly the executions that exist at the moment it deploys, and it is safe here
 * only because the compiled plan's step order matches the deleted hand-coded
 * flow's - a property of this migration, not one this function checks. Resuming
 * against the PINNED document instead is the end state and stays owned by PC-4
 * (prompts 15/19, docs/domain-config-gaps.md).
 *
 * Tightening this to refuse on absence is a REGRESSION, not a hardening: it trades
 * a bounded, migration-scoped blind spot for the stranding bug itself.
 */
const compareVersion = (flow: CompiledFlow, state: ExecutionState): VersionVerdict => {
  const started = state.data[CONFIG_VERSION_KEY];
  if (started === undefined || started === flow.domainConfigVersionId) return { kind: "compatible" };
  return typeof started === "string" ? { kind: "superseded", started } : { kind: "unreadable" };
};

/**
 * Do the persisted and published versions disagree? PURE - no mint, no log - so
 * the replay report, which only STATES what an execution is doing, can ask
 * without emitting an operator alert on every poll.
 */
export function versionSuperseded(flow: CompiledFlow, state: ExecutionState): boolean {
  return compareVersion(flow, state).kind !== "compatible";
}

/**
 * WHAT EACH VERDICT SAYS, TO WHOM. `compareVersion` distinguishes a version this
 * deployment no longer publishes from a persisted value that is not a version at
 * all, and collapsing them cost the operator that distinction: an ABSENT
 * `configVersionStarted` is also what a shape violation and an omitted optional
 * produce, so the line could not express which of the three it was. Each verdict
 * now carries its own registered stage - queryable apart - and its own sentence.
 */
const VERSION_REFUSALS: Readonly<Record<"superseded" | "unreadable", {
  readonly stage: ConfigurationStage;
  readonly sentence: string;
}>> = {
  superseded: {
    stage: "superseded-version",
    sentence:
      "This work was started under a configuration version this deployment no longer publishes, so it cannot be continued until an operator restores it.",
  },
  unreadable: {
    stage: "unreadable-version",
    sentence:
      "This work records no readable configuration version, so it cannot be continued until an operator repairs it.",
  },
};

/**
 * A persisted execution may only be DRIVEN by the configuration version it
 * started under. The cursor is POSITIONAL and the plan is now versioned data, so
 * a legitimate version bump between the e-sign suspend and the signature webhook
 * would otherwise resume at the wrong step - skipping finalize, or re-running a
 * committed one, either of which means missing or duplicated real records. The
 * flowId cannot carry this: it is the domainConfigId and is stable across
 * versions. Resuming against the PINNED document rather than refusing is the end
 * state and stays owned by PC-4 (prompts 15/19, docs/domain-config-gaps.md).
 *
 * THE TWO VERSION IDS ARE DEPLOYMENT INTERNALS (D-258). This refusal is the one
 * the e-sign webhook most commonly emits, and its message was returned verbatim
 * to the EXTERNAL provider and to the browser - the same trust-boundary leak the
 * configuration source closed. So the wire gets a generic sentence carrying a
 * correlation id, and the version pair goes to the operator's line under that id,
 * as REGISTERED ID FIELDS rather than prose the formatter would censor.
 *
 * A SIGNATURE THAT ARRIVED AND IS WAITING ON AN OPERATOR must never be discovered
 * by a client phoning to ask why nothing happened, so this is the operator-visible
 * line for the refusal, on every path that can raise it. WHAT THE REFUSAL MEANS TO
 * WHOEVER SENT THE REQUEST is carried by the cause, not chosen by the caller
 * (D-257): it clears when an operator rolls the published document back, so it is
 * neither permanent nor a transient fault, and the CONFLICT code cannot say that.
 */
export function versionMismatch(
  flow: CompiledFlow,
  state: ExecutionState,
  tenant: TenantContext,
): AppError | null {
  assertTenantContext(tenant);
  const verdict = compareVersion(flow, state);
  if (verdict.kind === "compatible") return null;
  const refusal = VERSION_REFUSALS[verdict.kind];
  const correlationId = generatedObservabilityId("correlationId", randomUUID());
  const error = operatorRecoverable(appError(
    "CONFLICT",
    `${refusal.sentence} Quote reference ${correlationId.value}.`,
    { stage: refusal.stage, correlationId: correlationId.value },
  ));
  log.error({
    correlationId,
    configStage: refusal.stage,
    orgId: authorityObservabilityId("orgId", tenant),
    // The same keyed value the start path logged, so the parked execution joins
    // to the request that produced it.
    executionId: keyedObservabilityId("executionId", tenant, state.id),
    domainConfigId: configurationDiagnosisId("domainConfigId", flow.definition.id),
    configVersion: configurationDiagnosisId("configVersion", flow.domainConfigVersionId),
    configVersionStarted: verdict.kind === "superseded"
      ? configurationDiagnosisId("configVersionStarted", verdict.started)
      : undefined,
    // READ OFF THE REFUSAL, never stated here (D-257): the instruction an operator
    // sees on this line is then provably the one the surfaces will give, rather
    // than a second copy of the classification that can drift from it.
    retry: clientRetryFor(error, CLIENT_RETRY.sameIdentity),
  }, "execution parked until an operator restores the configuration version");
  return error;
}
