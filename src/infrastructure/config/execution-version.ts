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
import { appError, type AppError } from "@contracts/errors";
import { CONFIG_VERSION_KEY, type CompiledFlow } from "@domain/config/plan-compiler";
import type { ExecutionState } from "@domain/workflow/engine";

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
 * MISSING IS NOT MISMATCHED. An execution carrying no recorded version predates
 * the pinning itself, so it can only have started under the plan published
 * before this guard existed: it is LEGACY and continues. Refusing it would make
 * the guard's first act on deployment the stranding of every legitimate in-flight
 * execution - the very before-deploy/after-deploy harm it exists to prevent. A
 * recorded value that is not a version string is neither, and fails closed.
 *
 * WHAT THE REFUSAL MEANS TO WHOEVER SENT THE REQUEST is decided by the caller
 * (D-226): it clears when an operator rolls the published document back, so it is
 * neither permanent nor a transient fault, and the CONFLICT code carried here
 * cannot express that on its own.
 */
export function versionMismatch(flow: CompiledFlow, state: ExecutionState): AppError | null {
  const started = state.data[CONFIG_VERSION_KEY];
  if (started === undefined) return null;
  if (started === flow.domainConfigVersionId) return null;
  if (typeof started !== "string") {
    return appError(
      "CONFLICT",
      `This execution records no readable configuration version and cannot be continued against the published ${flow.domainConfigVersionId}.`,
    );
  }
  return appError(
    "CONFLICT",
    `This execution was started under configuration version ${started} and cannot be continued against the published ${flow.domainConfigVersionId}.`,
  );
}
