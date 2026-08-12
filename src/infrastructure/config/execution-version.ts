/**
 * WHICH PUBLISHED CONFIGURATION VERSION A PERSISTED EXECUTION IS BOUND TO
 * (v3 prompt 10; ADR-0056).
 *
 * One rule, in one place, because three paths ask it and they must not answer
 * differently: the start path's re-drive of a failed execution, the e-sign
 * webhook's resume, and the replay report that only STATES what an execution is
 * doing. It lives beside the configuration source rather than in the composition
 * root because it is a fact about the document, not about how a request is wired.
 */
import { randomUUID } from "node:crypto";
import { appError, type AppError } from "@contracts/errors";
import { CLIENT_RETRY, operatorRecoverable } from "@contracts/client-retry";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import { CONFIG_VERSION_KEY, type CompiledFlow } from "@domain/config/plan-compiler";
import type { ExecutionState } from "@domain/workflow/engine";
import {
  authorityObservabilityId,
  configurationDiagnosisId,
  generatedObservabilityId,
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
 * A persisted execution may only be DRIVEN by the configuration version it
 * started under. The cursor is POSITIONAL and the plan is now versioned data, so
 * a legitimate version bump between the e-sign suspend and the signature webhook
 * would otherwise resume at the wrong step - skipping finalize, or re-running a
 * committed one, either of which means missing or duplicated real records. The
 * flowId cannot carry this: it is the domainConfigId and is stable across
 * versions. Resuming against the PINNED document rather than refusing is the end
 * state and stays owned by PC-4 (prompts 15/19, docs/domain-config-gaps.md).
 *
 * THE TWO VERSION IDS ARE DEPLOYMENT INTERNALS (D-229). This refusal is the one
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
 * (D-228): it clears when an operator rolls the published document back, so it is
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
  const correlationId = generatedObservabilityId("correlationId", randomUUID());
  log.error({
    correlationId,
    configStage: "superseded-version",
    orgId: authorityObservabilityId("orgId", tenant),
    // The same keyed value the start path logged, so the parked execution joins
    // to the request that produced it.
    executionId: keyedObservabilityId("executionId", tenant, state.id),
    domainConfigId: configurationDiagnosisId("domainConfigId", flow.definition.id),
    configVersion: configurationDiagnosisId("configVersion", flow.domainConfigVersionId),
    configVersionStarted: verdict.kind === "superseded"
      ? configurationDiagnosisId("configVersionStarted", verdict.started)
      : undefined,
    retry: CLIENT_RETRY.later,
  }, "execution parked until an operator restores the configuration version");
  return operatorRecoverable(appError(
    "CONFLICT",
    `This work was started under a configuration version this deployment no longer publishes, so it cannot be continued until an operator restores it. Quote reference ${correlationId.value}.`,
    { stage: "superseded-version", correlationId: correlationId.value },
  ));
}
