/**
 * THE PROMPT-9 SEAM (v3 prompt 10; ADR-0053 + ADR-0057).
 *
 * A firm policy loads against four pinned registries: evidence paths,
 * instruction paths, context keys, and approval templates. Every one of them is
 * a projection of a DOMAIN CONFIGURATION - which is the whole reason prompt 10
 * exists before firms author policy. Deriving them here rather than
 * hand-authoring them is what guarantees a policy can never read a fact nothing
 * produces, and the context-key half comes straight from the loaded intent,
 * whose keys were themselves derived from the primitives' `publishedKeys` over
 * the CONFIGURED parameters (D-184/D-185).
 */
import { err, ok, type Result } from "@contracts/result";
import {
  catalogPrimitiveMap,
  evidenceKindDescriptor,
  instructionKindDescriptor,
  type ApprovalTemplateDescriptor,
  type PolicyRegistries,
  type PolicyValueType,
} from "@domain/policy/registries";
import { configError, type DomainConfigError } from "./errors";
import type { LoadedDomainConfig } from "./load";

const pathTypes = (
  paths: Readonly<Record<string, { readonly type: PolicyValueType }>>,
): Readonly<Record<string, PolicyValueType>> =>
  Object.fromEntries(Object.entries(paths).map(([name, descriptor]) => [name, descriptor.type]));

/**
 * The registries a policy for ONE intent of this domain loads against. Scoped
 * per intent because the context-key vocabulary is per intent: two intents in
 * one domain bind different primitives and therefore close over different keys.
 */
export const policyRegistriesFor = (
  config: LoadedDomainConfig,
  actionId: string,
): Result<PolicyRegistries, readonly DomainConfigError[]> => {
  const intent = config.intents.get(actionId);
  if (intent === undefined) {
    return err([configError("unknown-reference", "intents", `no intent named ${JSON.stringify(actionId)}`)]);
  }
  const evidence = new Map(
    config.document.evidence
      .filter((requirement) => requirement.requiredFor.includes(intent.intent.id))
      .map((requirement) => [
        requirement.evidenceKind as string,
        evidenceKindDescriptor(pathTypes(requirement.paths)),
      ]),
  );
  const instructions = new Map(
    config.document.instructionKinds.map((declaration) => [
      declaration.kind as string,
      instructionKindDescriptor(pathTypes(declaration.paths)),
    ]),
  );
  const approvalTemplates = new Map<string, ApprovalTemplateDescriptor>(
    config.document.authority.templates.map((template) => [
      template.id as string,
      { kind: template.kind },
    ]),
  );
  return ok({
    evidence,
    instructions,
    contextKeys: intent.contextKeys,
    approvalTemplates,
    primitives: catalogPrimitiveMap(),
    primitiveSetVersion: config.document.primitiveSetVersion,
  });
};
