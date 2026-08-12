/**
 * `loadDomainConfig` - the deterministic load-time gate for a domain
 * configuration (v3 prompt 10; ADR-0057). Seven ordered stages, every failure a
 * VALUE, and a document loads only when the error list is EMPTY:
 *
 *  1. inert document   - a plain data record (the YAML adapter refuses tags,
 *                        anchors, aliases and merge keys before this point);
 *  2. grammar          - strict, readonly Zod objects throughout: an unknown
 *                        key is a parse failure, matching decision-core style;
 *  3. reference closure- unknown primitive, parameter, strategy, evidence kind,
 *                        slot, binding, capability, plan, conflict key,
 *                        reservation, verification rule, template, or code;
 *  4. type check       - slot type against its use site, bucket granularity
 *                        against a date-typed source, freshness floors;
 *  5. coherence        - the binding dataflow DAG, plan acyclicity, and the
 *                        no-dead-configuration rule;
 *  6. completeness     - two-sided copy coverage and a submittable form;
 *  7. identity         - version shape, catalog and grammar agreement, and the
 *                        authorship provenance whose declared change record must
 *                        match the diff its own bytes produce.
 *
 * Errors ACCUMULATE within a stage so an author sees the whole surface at once,
 * and a stage that cannot run on broken input short-circuits rather than
 * reporting cascading noise.
 */
import { err, ok, type Result } from "@contracts/result";
import { PRIMITIVE_SET_VERSION } from "@contracts/primitives/catalog";
import { parameterSchemaKeys, type CatalogPrimitive, type PublishedKeyMap } from "@contracts/primitives/values";
import { POLICY_GRAMMAR_VERSIONS } from "@contracts/decision-core/policy";
import {
  catalogPrimitiveMap,
  deriveContextKeys,
  type ContextKeyDescriptor,
} from "@domain/policy/registries";
import { orderBindings, type BindingNode, type PrimitiveBinding } from "./bindings";
import {
  DomainConfigDocumentSchema,
  domainConfigVersionId,
  type DomainConfigDocument,
} from "./document";
import { configError, configPathFrom, type DomainConfigError } from "./errors";
import type { ConfiguredIntent, ConfiguredSlot } from "./intents";
import { checkEvidenceWindows } from "./load-closure";
import { checkIdentity, checkReferences } from "./load-references";
import {
  checkCopyCompleteness,
  checkCopyTemplates,
  checkForm,
  checkPlanAcyclicity,
  checkReachability,
} from "./load-coherence";
import {
  contextKeyReads,
  neutralRefResolver,
  resolveParameters,
  type ParameterOwner,
} from "./parameters";
import { SLOT_TYPE_TO_VALUE_TYPE, type PathValueType } from "./vocabulary";

export type LoadedBinding = {
  readonly binding: PrimitiveBinding;
  readonly primitive: CatalogPrimitive;
  /** The primitive's parameter surface, adapted once so no signature names a schema type. */
  readonly owner: ParameterOwner;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly publishedKeys: PublishedKeyMap;
  readonly reads: readonly string[];
};

export type LoadedIntent = {
  readonly intent: ConfiguredIntent;
  readonly slots: ReadonlyMap<string, ConfiguredSlot>;
  readonly contextKeys: ReadonlyMap<string, ContextKeyDescriptor>;
  /** Deterministic evaluation order, derived from the dataflow, never from file order. */
  readonly bindingOrder: readonly string[];
  readonly stepCapability: ReadonlyMap<string, string>;
};

export type LoadedDomainConfig = {
  readonly document: DomainConfigDocument;
  readonly domainConfigVersionId: string;
  readonly intents: ReadonlyMap<string, LoadedIntent>;
  readonly bindings: ReadonlyMap<string, LoadedBinding>;
};

export type DomainConfigEnvironment = {
  readonly primitives: ReadonlyMap<string, CatalogPrimitive>;
  readonly primitiveSetVersion: string;
  readonly supportedPolicyGrammarVersions: readonly string[];
  /** The parent version's document, when one is available to diff against. */
  readonly parent?: Readonly<Record<string, unknown>>;
};

/** The environment the shipped catalog and grammar supply. */
export const shippedConfigEnvironment = (): DomainConfigEnvironment => ({
  primitives: catalogPrimitiveMap(),
  primitiveSetVersion: PRIMITIVE_SET_VERSION,
  supportedPolicyGrammarVersions: POLICY_GRAMMAR_VERSIONS,
});

/**
 * Adapt a catalog primitive to the narrow shape parameter resolution needs.
 * UNEXPORTED on purpose: it is the one place a Zod schema type is touched, and
 * keeping it out of every exported signature is what keeps the repo's
 * type-resolving fences able to walk this module at all (D-206).
 */
const parameterOwnerOf = (primitive: CatalogPrimitive): ParameterOwner => ({
  id: primitive.id as string,
  keyShapingParameters: primitive.keyShapingParameters,
  declaredParameters: parameterSchemaKeys(primitive.parameterSchema),
  parseParameters: (value) => {
    const parsed = primitive.parameterSchema.safeParse(value);
    return parsed.success
      ? { ok: true, parameters: parsed.data as Readonly<Record<string, unknown>> }
      : {
          ok: false,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.map(String),
            message: issue.message,
          })),
        };
  },
});

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const loadBindings = (
  document: DomainConfigDocument,
  environment: DomainConfigEnvironment,
  sink: (error: DomainConfigError) => void,
): Map<string, LoadedBinding> => {
  const loaded = new Map<string, LoadedBinding>();
  for (const binding of document.primitiveBindings) {
    const path = `primitiveBindings.${binding.id}`;
    const primitive = environment.primitives.get(binding.primitiveId);
    if (primitive === undefined) {
      sink(configError("unknown-reference", `${path}.primitiveId`, `no catalog primitive named ${JSON.stringify(binding.primitiveId)}`));
      continue;
    }
    if (primitive.allowedStrategies.length === 0 && binding.defaultStrategy !== undefined) {
      sink(configError("type-mismatch", `${path}.defaultStrategy`, `primitive ${primitive.id} has no strategy vocabulary`));
    }
    if (primitive.allowedStrategies.length > 0) {
      if (binding.defaultStrategy === undefined) {
        sink(configError("incomplete", `${path}.defaultStrategy`, `primitive ${primitive.id} requires a default strategy`));
      } else if (!primitive.allowedStrategies.includes(binding.defaultStrategy)) {
        sink(
          configError(
            "unknown-reference",
            `${path}.defaultStrategy`,
            `strategy ${JSON.stringify(binding.defaultStrategy)} is not one of ${primitive.allowedStrategies.join(", ")}`,
          ),
        );
      }
    }
    const owner = parameterOwnerOf(primitive);
    const resolved = resolveParameters(owner, binding.parameters, neutralRefResolver, `${path}.parameters`);
    if (!resolved.ok) {
      for (const error of resolved.error) sink(error);
      continue;
    }
    loaded.set(binding.id, {
      binding,
      primitive,
      owner,
      parameters: resolved.value.parsed,
      publishedKeys: primitive.publishedKeys(resolved.value.parsed as never),
      reads: [...contextKeyReads(resolved.value.parsed)].sort(),
    });
  }
  return loaded;
};

const loadIntent = (
  intent: ConfiguredIntent,
  document: DomainConfigDocument,
  bindings: ReadonlyMap<string, LoadedBinding>,
  sink: (error: DomainConfigError) => void,
): LoadedIntent | null => {
  const path = `intents.${intent.id}`;
  const slots = new Map(intent.slots.map((slot) => [slot.id, slot]));
  const bound: LoadedBinding[] = [];
  for (const id of intent.primitiveBindings) {
    const binding = bindings.get(id);
    if (binding === undefined) {
      sink(configError("unknown-reference", `${path}.primitiveBindings`, `no primitive binding named ${JSON.stringify(id)}`));
      continue;
    }
    bound.push(binding);
  }
  const intentSlots = Object.fromEntries(
    intent.slots.map((slot) => [slot.id, SLOT_TYPE_TO_VALUE_TYPE[slot.type] as PathValueType]),
  );
  const derived = deriveContextKeys(
    intentSlots,
    bound.map((entry) => ({ primitiveId: entry.primitive.id as string, publishedKeys: entry.publishedKeys })),
  );
  if (!derived.ok) {
    for (const key of derived.error) {
      sink(configError("incoherent", `${path}.contextKeys.${key}`, "context key is claimed by an intent slot and a bound primitive at once"));
    }
    return null;
  }
  const nodes: BindingNode[] = bound.map((entry) => ({
    id: entry.binding.id,
    primitiveId: entry.primitive.id as string,
    reads: entry.reads,
    publishes: Object.keys(entry.publishedKeys),
  }));
  const ordered = orderBindings(nodes, new Set(Object.keys(intentSlots)));
  if (!ordered.ok) {
    for (const failure of ordered.failures) {
      sink(
        failure.kind === "cycle"
          ? configError("incoherent", `${path}.primitiveBindings`, `binding dataflow forms a cycle: ${failure.members.join(", ")}`)
          : configError(
              "unknown-reference",
              `${path}.primitiveBindings.${failure.binding}`,
              `reads context key ${JSON.stringify(failure.key)}, which no bound primitive or intent slot publishes`,
            ),
      );
    }
    return null;
  }
  const template = document.execution.planTemplates.find((candidate) => candidate.id === intent.executionPlan);
  if (template === undefined) {
    sink(configError("unknown-reference", `${path}.executionPlan`, `no plan template named ${JSON.stringify(intent.executionPlan)}`));
    return null;
  }
  return {
    intent,
    slots,
    contextKeys: derived.value,
    bindingOrder: ordered.order,
    stepCapability: new Map(template.steps.map((step) => [step.id as string, step.capability as string])),
  };
};

export const loadDomainConfig = (
  input: unknown,
  environment: DomainConfigEnvironment = shippedConfigEnvironment(),
): Result<LoadedDomainConfig, readonly DomainConfigError[]> => {
  if (!isPlainRecord(input)) {
    return err([configError("not-inert", "", "a domain configuration must be a plain data record")]);
  }
  const parsed = DomainConfigDocumentSchema.safeParse(input);
  if (!parsed.success) {
    // BUILT FROM SEGMENTS, never joined (D-250): a record key the schema rejects is
    // reported THROUGH by Zod's own issue path, and an author's key may be anything
    // - `{ "Household.Name": … }` joined would name a node this document does not
    // have, while a key the channel cannot carry at all would censor the whole
    // location. Either way the honest answer is the deepest node that CAN be named.
    // The step is handed to `configError` WHOLE (D-253): this is the loader's most
    // common failure, and passing only its path let the constructor re-walk an
    // already-carriable string and call a truncated location complete.
    return err(
      parsed.error.issues.map((issue) =>
        configError("grammar", configPathFrom(issue.path.map(String)), issue.message)),
    );
  }
  const document = parsed.data;
  const errors: DomainConfigError[] = [];
  const sink = (error: DomainConfigError): void => {
    errors.push(error);
  };

  const bindings = loadBindings(document, environment, sink);
  const intents = new Map<string, LoadedIntent>();
  for (const intent of document.intents) {
    const loaded = loadIntent(intent, document, bindings, sink);
    if (loaded !== null) intents.set(intent.id, loaded);
  }
  if (errors.length > 0) return err(errors);

  checkReferences(document, intents, bindings, sink);
  checkEvidenceWindows(document, sink);
  checkReachability(document, sink);
  checkPlanAcyclicity(document, sink);
  checkCopyCompleteness(document, sink);
  checkCopyTemplates(
    document,
    new Set(document.intents.flatMap((intent) => intent.slots.map((slot) => slot.id))),
    new Set([...intents.values()].flatMap((intent) => [...intent.contextKeys.keys()])),
    sink,
  );
  checkForm(document, sink);
  checkIdentity(document, environment, sink);
  if (errors.length > 0) return err(errors);

  return ok({
    document,
    domainConfigVersionId: domainConfigVersionId(document),
    intents,
    bindings,
  });
};
