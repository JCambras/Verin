/**
 * THE PLAN COMPILER (v3 prompt 10; ADR-0056) - where a configured domain stops
 * being a document and starts being the thing that runs.
 *
 * `compileFlowDefinition` turns a plan TEMPLATE (a DAG of capabilities with
 * unresolved sources) into a `FlowDefinition` the shipped generic engine drives.
 * Nothing in here knows a domain: it resolves declared value sources, renders
 * declared key segments, invokes a declared command type through an injected
 * adapter, and suspends when the step's verification rule awaits an external
 * observation. Deleting a configuration file therefore deletes a flow.
 *
 * WHY THE INTERIM ENGINE AND NOT `ExecutionPlan`. The ratified `ExecutionStep`
 * is an INSTANCE: it carries a content-addressed payload ref, a payload hash,
 * and evidence-snapshot preconditions that only exist once a decision has been
 * made against an assembled bundle. Those arrive with the evaluator and the
 * executor (prompts 16/25). Until then the compiled form is this typed
 * intermediate plus the shipped suspend/resume engine, which is exactly the
 * "interim execution substrate" the design calls for - and the reason a
 * `decision-hash` source is REFUSED here, in every position a compiled step
 * resolves, rather than faked.
 */
import type { AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import { err, ok, type Result } from "@contracts/result";
import type { TenantContext } from "@contracts/tenant";
import type { FlowData, FlowDefinition, FlowStep, StepResult } from "@domain/workflow/engine";
import { configError, type ConfiguredRefusal, type DomainConfigError } from "./errors";
import type { ConfiguredSlot } from "./intents";
import type { LoadedDomainConfig } from "./load";
import type { ExecutionCapability, PlanStep } from "./operations";
import {
  renderKeySegments,
  renderTemplate,
  templatePlaceholders,
  type SourceResolution,
  type ValueSource,
} from "./segments";
import { CONFIG_VERSION_KEY, EXECUTION_SCOPE_KEY, INITIATING_ACTOR_KEY } from "./vocabulary";

/**
 * The reserved flow-data keys this compiler reads, re-exported from the closed
 * vocabulary that also REFUSES a slot declaring one. One declaration, so the
 * key the platform writes and the key the loader rejects cannot drift apart.
 */
export { CONFIG_VERSION_KEY, EXECUTION_SCOPE_KEY, INITIATING_ACTOR_KEY };

export type CommandInvocation = PIIBearing & {
  readonly capabilityId: string;
  readonly commandType: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
};

/**
 * The port a compiled plan runs against. ONE method: infrastructure owns what a
 * command type means, which is what keeps span names, SQL, and audit codes out
 * of configuration files and inside the composition root where their fences see
 * them.
 */
export interface ExecutionAdapters extends PIIBearing {
  invoke(command: CommandInvocation, tenant: TenantContext): Promise<Readonly<Record<string, string>>>;
}

const asString = (value: unknown): string | null => {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
};

/**
 * Deterministic topological order over `dependsOn`; ties break on step id. A
 * template no order exists for is REFUSED, never truncated: the loader's
 * acyclicity check makes that unreachable for a loaded document, but this
 * function is reachable from any `LoadedDomainConfig`, and a partial plan would
 * run to `completed` having skipped work.
 */
const orderedSteps = (
  steps: readonly PlanStep[],
  planTemplateId: string,
  refuse: ConfiguredRefusal,
): Result<readonly PlanStep[], AppError> => {
  const remaining = new Map(steps.map((step) => [step.id as string, step]));
  const done = new Set<string>();
  const out: PlanStep[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((step) => step.dependsOn.every((dependency) => done.has(dependency)))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const next = ready[0];
    if (next === undefined) {
      return err(
        refuse.uncompilable(
          configError(
            "incoherent",
            `execution.planTemplates.${planTemplateId}.steps`,
            "no runnable order exists: a step depends on one that never becomes ready",
          ),
        ),
      );
    }
    out.push(next);
    done.add(next.id);
    remaining.delete(next.id);
  }
  return ok(out);
};

type StepPlan = {
  readonly step: PlanStep;
  readonly capability: ExecutionCapability;
  readonly awaits: boolean;
};

const resolverFor = (
  config: LoadedDomainConfig,
  actionId: string,
  ctx: FlowData,
): ((source: ValueSource) => SourceResolution) => {
  const intent = config.intents.get(actionId);
  const capabilityOf = (stepId: string): ExecutionCapability | undefined => {
    const capabilityId = intent?.stepCapability.get(stepId);
    return config.document.execution.capabilities.find((entry) => entry.id === capabilityId);
  };
  return (source) => {
    if (source.from === "slot") {
      const slot = intent?.slots.get(source.slot);
      const field = slot?.triggerField;
      const value = field === undefined ? null : asString(ctx[field]);
      return value === null ? { kind: "absent" } : { kind: "value", value };
    }
    if (source.from === "execution-scope") {
      const value = asString(ctx[EXECUTION_SCOPE_KEY]);
      return value === null ? { kind: "absent" } : { kind: "value", value };
    }
    if (source.from === "step-output") {
      const alias = capabilityOf(source.step)?.publishes.find((entry) => entry.output === source.output)?.as;
      const value = alias === undefined ? null : asString(ctx[alias]);
      return value === null ? { kind: "absent" } : { kind: "value", value };
    }
    if (source.from === "context") {
      const value = asString(ctx[source.key]);
      return value === null ? { kind: "absent" } : { kind: "value", value };
    }
    if (source.from === "initiating-actor") {
      const value = asString(ctx[INITIATING_ACTOR_KEY]);
      return value === null ? { kind: "absent" } : { kind: "value", value };
    }
    if (source.from === "await-observation") {
      const value = asString(ctx[source.field]);
      return value === null ? { kind: "absent" } : { kind: "value", value };
    }
    if (source.from === "decision-hash") {
      // THE ONE SOURCE THIS SUBSTRATE HAS NO VALUE FOR. `compileFlowDefinition`
      // refuses any capability that reads it, in EVERY position a compiled step
      // resolves, so a compiled plan never arrives here - which is the point: a
      // bare `absent` is what let a payload field sourced from the decision hash
      // load clean, compile clean, and then either fail at the step that consumed
      // it (after earlier steps had committed real records) or, when the field was
      // optional, vanish from the command with no diagnostic anywhere.
      return { kind: "absent" };
    }
    return unresolvableSource(source);
  };
};

/**
 * A value source with NO arm above. Typed `never`, so adding a variant to the
 * grammar without teaching this resolver about it is a BUILD failure rather than
 * a silent run-time `absent` - the shape the decision-hash gap actually had.
 */
const unresolvableSource = (source: never): SourceResolution => {
  void source;
  return { kind: "absent" };
};

/**
 * Every slot ONE capability reads, by all three routes the resolver serves: an
 * idempotency-key segment, a value payload field, and a `{slot:…}` placeholder
 * of the command text a copy payload field renders.
 */
const slotsRead = (
  capability: ExecutionCapability,
  commandText: Readonly<Record<string, string>>,
): readonly string[] => {
  const names: string[] = [];
  for (const segment of capability.idempotencyKey) {
    if (segment.kind !== "literal" && segment.source.from === "slot") names.push(segment.source.slot);
  }
  for (const field of capability.payload) {
    if (field.kind !== "copy") {
      if (field.source.from === "slot") names.push(field.source.slot);
      continue;
    }
    // OWN property: a copy key naming `constructor` would otherwise hand a
    // FUNCTION to the placeholder scanner, and this walk must stay total.
    if (!Object.hasOwn(commandText, field.copy)) continue;
    for (const placeholder of templatePlaceholders(commandText[field.copy] ?? "")) {
      if (placeholder.kind === "slot") names.push(placeholder.token);
    }
  }
  return names;
};

/**
 * A slot a compiled step could never READ. `resolverFor` reads a slot only
 * through its declared `triggerField`, and the intent schema FORBIDS one on any
 * slot that is not `supplied-by-trigger` - so a capability sourcing a
 * `bound-by-primitive` or `derived` slot closes cleanly through every load stage
 * and then fails at the step that consumes it, AFTER earlier steps have
 * committed real records.
 *
 * Refused HERE rather than at load because the authoring is legitimate: money
 * movement's household and source account genuinely ARE selected by primitives,
 * and their values arrive with the evaluator's context plane (prompt 16). What
 * may not happen is a RUNNABLE plan carrying a source nothing can resolve, which
 * is the same line the `decision-hash` deferral above draws.
 */
const unreadableSlot = (
  capability: ExecutionCapability,
  slots: ReadonlyMap<string, ConfiguredSlot>,
  commandText: Readonly<Record<string, string>>,
): ConfiguredSlot | null => {
  for (const name of slotsRead(capability, commandText)) {
    const slot = slots.get(name);
    if (slot !== undefined && slot.triggerField === undefined) return slot;
  }
  return null;
};

/**
 * Does this capability read the DECISION HASH anywhere a compiled step resolves?
 *
 * Named deferral (D-116 pattern): the hash exists once prompt 16 records a
 * decision and prompt 25 executes against it. The guard used to look only at
 * `idempotencyKey`, so a `{kind: value, source: {from: decision-hash}}` PAYLOAD
 * field passed all seven load stages and compiled cleanly - then failed at the
 * step that consumed it, after earlier steps had committed real CRM rows, or
 * (when `optional`) was dropped from the command with no diagnostic at all. Both
 * positions are checked here, which is every position a compiled step resolves:
 * a `copy` field renders only `{slot:…}` and `{context:…}` placeholders, neither
 * of which can name the decision hash.
 */
const readsDecisionHash = (capability: ExecutionCapability): boolean =>
  capability.idempotencyKey.some(
    (segment) => segment.kind !== "literal" && segment.source.from === "decision-hash",
  ) ||
  capability.payload.some(
    (field) => field.kind !== "copy" && field.source.from === "decision-hash",
  );

/**
 * The FIRST fault, for the reason the loader's own diagnosis reports one: the
 * accumulated list is in document order, and a single registered value is the
 * only shape the operator's channel carries.
 */
const failure = (refuse: ConfiguredRefusal, errors: readonly DomainConfigError[]): StepResult => ({
  kind: "fail",
  error: refuse.unrunnableStep(
    errors[0] ??
      configError("incoherent", "execution", "the configured step could not be prepared"),
  ),
});

const buildPayload = (
  config: LoadedDomainConfig,
  actionId: string,
  capability: ExecutionCapability,
  ctx: FlowData,
): Result<Readonly<Record<string, string>>, readonly DomainConfigError[]> => {
  const resolve = resolverFor(config, actionId, ctx);
  const payload: Record<string, string> = {};
  const errors: DomainConfigError[] = [];
  const commandText = config.document.presentation.copy.commandText;
  for (const field of capability.payload) {
    const path = `execution.capabilities.${capability.id}.payload.${field.field}`;
    if (field.kind === "copy") {
      const template = commandText[field.copy];
      if (template === undefined) {
        errors.push(configError("unknown-reference", path, `no command text named ${JSON.stringify(field.copy)}`));
        continue;
      }
      const rendered = renderTemplate(
        template,
        {
          slot: (slotId) => {
            const resolution = resolve({ from: "slot", slot: slotId });
            return resolution.kind === "value" ? resolution.value : null;
          },
          context: (key) => {
            const resolution = resolve({ from: "context", key });
            return resolution.kind === "value" ? resolution.value : null;
          },
        },
        path,
      );
      if (!rendered.ok) errors.push(...rendered.error);
      else payload[field.field] = rendered.value;
      continue;
    }
    const resolution = resolve(field.source);
    if (resolution.kind === "value") {
      payload[field.field] = resolution.value;
      continue;
    }
    if (!field.optional) {
      errors.push(configError("incoherent", path, "a required payload field did not resolve"));
    }
  }
  return errors.length > 0 ? err(errors) : ok(payload);
};

/**
 * One value an adapter returned, read as an OWN property. `OutputNameSchema`
 * admits `toString`, `valueOf` and `constructor`, so a bare index would let
 * `Object.prototype` satisfy the very absence check that exists to fail closed -
 * publishing an inherited function into flow data instead of reporting that the
 * adapter returned nothing. Own-property reads are the module-wide posture
 * (load-closure.ts); this is the one place the values come from outside it.
 */
const publishedOutput = (
  outputs: Readonly<Record<string, string>>,
  name: string,
): string | undefined => (Object.hasOwn(outputs, name) ? outputs[name] : undefined);

const compileStep = (
  config: LoadedDomainConfig,
  actionId: string,
  plan: StepPlan,
  refuse: ConfiguredRefusal,
): FlowStep<ExecutionAdapters> => ({
  id: plan.step.id,
  name: plan.capability.describes,
  async execute(ctx, deps, tenant): Promise<StepResult> {
    const payload = buildPayload(config, actionId, plan.capability, ctx);
    if (!payload.ok) return failure(refuse, payload.error);
    const key = renderKeySegments(
      plan.capability.idempotencyKey,
      resolverFor(config, actionId, ctx),
      `execution.capabilities.${plan.capability.id}.idempotencyKey`,
    );
    if (!key.ok) return failure(refuse, key.error);
    const outputs = await deps.invoke(
      {
        capabilityId: plan.capability.id,
        commandType: plan.capability.commandType,
        payload: payload.value,
        idempotencyKey: key.value,
      },
      tenant,
    );
    const patch: FlowData = {};
    const missing: DomainConfigError[] = [];
    for (const publication of plan.capability.publishes) {
      const value = publishedOutput(outputs, publication.output);
      if (value === undefined) {
        missing.push(
          configError(
            "incoherent",
            `execution.capabilities.${plan.capability.id}.publishes.${publication.output}`,
            "the adapter returned no value for a declared publication",
          ),
        );
        continue;
      }
      patch[publication.as] = value;
    }
    if (missing.length > 0) return failure(refuse, missing);
    if (!plan.awaits) return { kind: "continue", patch };
    const tokenOutput = plan.capability.awaitTokenFrom;
    const token = tokenOutput === undefined ? undefined : publishedOutput(outputs, tokenOutput);
    if (token === undefined) {
      return failure(refuse, [
        configError(
          "incoherent",
          `execution.capabilities.${plan.capability.id}.awaitTokenFrom`,
          "an externally-gated step produced no correlation token",
        ),
      ]);
    }
    return { kind: "suspend", token, awaiting: plan.capability.verificationRule, patch };
  },
});

export type CompiledFlow = {
  readonly definition: FlowDefinition<ExecutionAdapters>;
  /**
   * The mint THIS plan's refusals come through, carried so the adapters its steps
   * invoke refuse through the same one rather than a second port built beside it:
   * what an adapter refuses (a payload field the command did not carry, a command
   * type with no runner) is a fact about the document compiled here.
   */
  readonly refuse: ConfiguredRefusal;
  /**
   * The configuration version this plan was compiled FROM. `definition.id` is the
   * domainConfigId and is stable across versions, so it cannot tell a persisted
   * execution which plan it was started against; this can. The composition root
   * pins it into flow data at start and refuses to drive a stored cursor under a
   * different one.
   */
  readonly domainConfigVersionId: string;
  /**
   * Per COMPILED step, the verification rule that step suspends on - `undefined`
   * when it runs to completion. Emitted from the same ordered plan that produced
   * the steps, so a replay reporting the rule of the step at `cursor - 1` can
   * never disagree with the rule that step actually suspended on.
   */
  readonly awaitingByStep: readonly (string | undefined)[];
};

/**
 * Compile one intent's plan template into a runnable flow definition. Returns a
 * typed error rather than throwing, so a configuration a deployment cannot run
 * surfaces at the surface that asked for it.
 *
 * EVERY refusal here is OPERATOR-RECOVERABLE by cause (D-228): it says this
 * deployment cannot compile the document it publishes, which an operator clears
 * by rolling that document back and no submitter clears by any means. All of them
 * go through the SAME injected mint the compiled steps use, so the classification
 * comes from one place: they used to mark themselves, each interpolating the
 * intent, template, step, capability and slot ids into a message the e-sign
 * webhook returns verbatim to the EXTERNAL provider and the browser reads with no
 * quotable reference at all.
 */
export const compileFlowDefinition = (
  config: LoadedDomainConfig,
  actionId: string,
  refuse: ConfiguredRefusal,
): Result<CompiledFlow, AppError> => {
  const intent = config.intents.get(actionId);
  if (intent === undefined) {
    return err(refuse.uncompilable(
      configError("unknown-reference", `intents.${actionId}`, "this document declares no such intent"),
    ));
  }
  const template = config.document.execution.planTemplates.find(
    (candidate) => candidate.id === intent.intent.executionPlan,
  );
  if (template === undefined) {
    return err(refuse.uncompilable(
      configError(
        "unknown-reference",
        `intents.${actionId}.executionPlan`,
        "this document declares no plan template with that id",
      ),
    ));
  }
  const awaitingRules = new Set(
    config.document.verification.filter((rule) => rule.awaitsExternal).map((rule) => rule.id as string),
  );
  const ordered = orderedSteps(template.steps, template.id, refuse);
  if (!ordered.ok) return ordered;
  const plans: StepPlan[] = [];
  for (const step of ordered.value) {
    const capability = config.document.execution.capabilities.find((entry) => entry.id === step.capability);
    if (capability === undefined) {
      return err(refuse.uncompilable(
        configError(
          "unknown-reference",
          `execution.planTemplates.${template.id}.steps.${step.id}.capability`,
          "this plan step names a capability the document does not declare",
        ),
      ));
    }
    if (readsDecisionHash(capability)) {
      // Refusing here is what stops a compiled plan from inventing a stand-in
      // identity, or from silently omitting a value it cannot resolve.
      return err(refuse.uncompilable(
        configError(
          "incoherent",
          `execution.capabilities.${capability.id}`,
          "this capability reads the decision hash - in an idempotency key or a command payload field - which the interim execution substrate does not have (prompt 25 lands it)",
        ),
      ));
    }
    const unreadable = unreadableSlot(capability, intent.slots, config.document.presentation.copy.commandText);
    if (unreadable !== null) {
      return err(refuse.uncompilable(
        configError(
          "incoherent",
          `execution.capabilities.${capability.id}`,
          `this capability reads a slot that resolves ${unreadable.resolution} and so carries no trigger field; the interim execution substrate reads a slot only from the request that started the flow, and that value arrives with the evaluator's context plane (prompt 16)`,
        ),
      ));
    }
    plans.push({ step, capability, awaits: awaitingRules.has(capability.verificationRule) });
  }
  return ok({
    definition: {
      id: config.document.domainConfigId,
      name: config.document.presentation.domainLabel,
      steps: plans.map((plan) => compileStep(config, actionId, plan, refuse)),
    },
    refuse,
    domainConfigVersionId: config.domainConfigVersionId,
    awaitingByStep: plans.map((plan) => (plan.awaits ? (plan.capability.verificationRule as string) : undefined)),
  });
};
