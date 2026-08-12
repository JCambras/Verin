/**
 * THE PUBLISHED CONFIGURATION, COMPILED INTO THE FLOW THIS DEPLOYMENT RUNS
 * (v3 prompt 10; ADR-0057).
 *
 * It lives beside the configuration source rather than in the composition root
 * because everything it can refuse is a fact about the DOCUMENT - it cannot be
 * resolved, this build has no adapter for a command it names, or it does not
 * compile - and every one of those is operator-recoverable by cause (D-241). Held
 * in the composition root, it was the one configuration refusal outside the
 * configuration modules, which cost the domain-configuration fence its ability to
 * derive the whole class from the modules that own it (D-244).
 */
import type { AppError } from "@contracts/errors";
import { err, type Result } from "@contracts/result";
import { configError } from "@domain/config/errors";
import { compileFlowDefinition, type CompiledFlow } from "@domain/config/plan-compiler";
import { SUPPORTED_COMMAND_TYPES } from "@infra/execution-adapters";
import {
  ACCOUNT_OPENING_DOMAIN,
  configuredRefusal,
  loadPublishedDomainConfig,
} from "./domain-config-source";

/**
 * The action the published configuration this deployment runs declares. The route
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
export function configuredFlow(): Result<CompiledFlow, AppError> {
  const sourced = loadPublishedDomainConfig(ACCOUNT_OPENING_DOMAIN);
  if (!sourced.ok) return sourced;
  const config = sourced.value.config;
  const refuse = configuredRefusal(ACCOUNT_OPENING_DOMAIN);
  // A document naming a command this build has no adapter for is the same
  // operator-recoverable cause as one that fails to load or compile (D-241):
  // rolling the document back clears it, and no submission can. It is stated
  // through the SAME mint rather than in its own words, which is what gets it a
  // correlation reference on the wire and a log line at all - it had neither, so
  // the command type it names went to the external e-sign provider verbatim and
  // to the operator nowhere.
  const unsupported = config.document.execution.capabilities.find(
    (capability) => !SUPPORTED_COMMAND_TYPES.includes(capability.commandType),
  );
  if (unsupported !== undefined) {
    return err(refuse.uncompilable(
      configError(
        "unknown-reference",
        `execution.capabilities.${unsupported.id}.commandType`,
        "this build ships no execution adapter for the command type this capability names",
      ),
    ));
  }
  // A step that cannot be PREPARED is a configuration refusal too, and the
  // compiler is domain code with no logger to state it to: the minter it is handed
  // is the same one every other stage of this document's resolution is refused
  // through, so the wire gets a reference and the operator gets the diagnosis.
  return compileFlowDefinition(config, ACCOUNT_OPENING_ACTION, refuse);
}
