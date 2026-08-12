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
 * `decision-hash` key segment is REFUSED here rather than faked.
 */
import { appError, type AppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import { err, ok, type Result } from "@contracts/result";
import type { TenantContext } from "@contracts/tenant";
import type { FlowData, FlowDefinition, FlowStep, StepResult } from "@domain/workflow/engine";
import { configError, formatDomainConfigErrors, type DomainConfigError } from "./errors";
import type { LoadedDomainConfig } from "./load";
import type { ExecutionCapability, PlanStep } from "./operations";
import { renderKeySegments, renderTemplate, type SourceResolution, type ValueSource } from "./segments";
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
const orderedSteps = (steps: readonly PlanStep[]): Result<readonly PlanStep[], AppError> => {
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
        appError(
          "INTERNAL",
          `The plan template has no runnable order: ${[...remaining.keys()].sort().join(", ")} depend on a step that never becomes ready.`,
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
    return { kind: "absent" };
  };
};

const failure = (errors: readonly DomainConfigError[]): StepResult => ({
  kind: "fail",
  error: appError("INTERNAL", `The configured step could not be prepared: ${formatDomainConfigErrors(errors)}`),
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
): FlowStep<ExecutionAdapters> => ({
  id: plan.step.id,
  name: plan.capability.describes,
  async execute(ctx, deps, tenant): Promise<StepResult> {
    const payload = buildPayload(config, actionId, plan.capability, ctx);
    if (!payload.ok) return failure(payload.error);
    const key = renderKeySegments(
      plan.capability.idempotencyKey,
      resolverFor(config, actionId, ctx),
      `execution.capabilities.${plan.capability.id}.idempotencyKey`,
    );
    if (!key.ok) return failure(key.error);
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
    if (missing.length > 0) return failure(missing);
    if (!plan.awaits) return { kind: "continue", patch };
    const tokenOutput = plan.capability.awaitTokenFrom;
    const token = tokenOutput === undefined ? undefined : publishedOutput(outputs, tokenOutput);
    if (token === undefined) {
      return failure([
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
 */
export const compileFlowDefinition = (
  config: LoadedDomainConfig,
  actionId: string,
): Result<CompiledFlow, AppError> => {
  const intent = config.intents.get(actionId);
  if (intent === undefined) {
    return err(appError("INTERNAL", `The configuration declares no intent named "${actionId}".`));
  }
  const template = config.document.execution.planTemplates.find(
    (candidate) => candidate.id === intent.intent.executionPlan,
  );
  if (template === undefined) {
    return err(appError("INTERNAL", `The configuration declares no plan template for "${actionId}".`));
  }
  const awaitingRules = new Set(
    config.document.verification.filter((rule) => rule.awaitsExternal).map((rule) => rule.id as string),
  );
  const ordered = orderedSteps(template.steps);
  if (!ordered.ok) return ordered;
  const plans: StepPlan[] = [];
  for (const step of ordered.value) {
    const capability = config.document.execution.capabilities.find((entry) => entry.id === step.capability);
    if (capability === undefined) {
      return err(appError("INTERNAL", `The plan step "${step.id}" names an undeclared capability.`));
    }
    if (capability.idempotencyKey.some((segment) => segment.kind !== "literal" && segment.source.from === "decision-hash")) {
      // Named deferral (D-116 pattern): the decision hash exists once prompt 16
      // records a decision and prompt 25 executes against it. Refusing here is
      // what stops a compiled plan from inventing a stand-in identity.
      return err(
        appError(
          "INTERNAL",
          `Capability "${capability.id}" keys idempotency on the decision hash, which the interim execution substrate does not have (prompt 25 lands it).`,
        ),
      );
    }
    plans.push({ step, capability, awaits: awaitingRules.has(capability.verificationRule) });
  }
  return ok({
    definition: {
      id: config.document.domainConfigId,
      name: config.document.presentation.domainLabel,
      steps: plans.map((plan) => compileStep(config, actionId, plan)),
    },
    domainConfigVersionId: config.domainConfigVersionId,
    awaitingByStep: plans.map((plan) => (plan.awaits ? (plan.capability.verificationRule as string) : undefined)),
  });
};
