/**
 * Phase 1 of the policy evaluator: running the bound primitives (prompt 9,
 * ADR-0053; ratified design §3.5). Split from evaluate.ts under the per-file
 * ceiling; the phase remains one self-contained pure function.
 *
 * Invocations arrive ASSEMBLED by the harness (prompts 14-16 own evidence
 * projection and tz anchoring); this phase verifies them against the catalog
 * contracts fail-closed, applies the Phase-0 parameter/strategy resolutions,
 * resolves context bindings from accumulated published facts, and executes the
 * real primitives in canonical dependency order (published-key -> consumed-key
 * edges, ties by canonical invocation key). Content problems land in the
 * outcome as unevaluable executions; only structural impossibilities refuse.
 */
import { err, ok, type Result } from "@contracts/result";
import type { PIIBearing } from "@contracts/pii";
import { canonicalJson, type JsonValue } from "@contracts/decision-core/serialization";
import type { PublishedFactRecord, PublishedKeyMap } from "@contracts/primitives/values";
import type { PolicyEvaluationFacts } from "./facts";
import type { PolicyRegistries } from "./registries";
import {
  compareCanonical,
  sortUniqueStrings,
  type ParameterResolution,
  type PolicyEvaluationRefusal,
  type PrimitiveExecution,
  type StrategyResolution,
} from "./trace";

/**
 * PIIBearing: the evidence projection inside an invocation is real bundle
 * content, so the whole input plane stays structurally unreachable from `llm/`.
 */
export type PolicyPrimitiveInvocation = PIIBearing & {
  readonly primitiveId: string;
  /** Domain-config default parameters; Phase-0 resolutions override per name. */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** The primitive-shaped evidence projection, assembled by the harness. */
  readonly evidence: unknown;
  /** Harness-supplied context entries (e.g. the tz-projected anchor date). */
  readonly context?: Readonly<Record<string, unknown>>;
};

export type PrimitivePhaseOutcome = {
  readonly publishedFacts: ReadonlyMap<string, unknown>;
  readonly executions: ReadonlyMap<string, PrimitiveExecution>;
  /** Policy-resolved parameters a primitive's own schema refused (fail-closed). */
  readonly parameterRejections: readonly {
    readonly primitiveId: string;
    readonly ruleIds: readonly string[];
  }[];
};

const refuse = (
  code: PolicyEvaluationRefusal["code"],
  message: string,
): Result<never, PolicyEvaluationRefusal> => err({ code, message });

/** A context-binding parameter value, as the sufficiency-check idiom declares it. */
const contextBinding = (value: unknown): { readonly key: string } | null =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as Record<string, unknown>)["kind"] === "context" &&
  typeof (value as Record<string, unknown>)["key"] === "string"
    ? { key: (value as Record<string, unknown>)["key"] as string }
    : null;

const constantBinding = (value: unknown): { readonly amount: unknown } | null =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as Record<string, unknown>)["kind"] === "constant" &&
  Object.hasOwn(value, "amountMinor")
    ? { amount: (value as Record<string, unknown>)["amountMinor"] }
    : null;

/** PIIBearing for the same reason as the invocation it was prepared from. */
type PreparedInvocation = PIIBearing & {
  readonly canonicalKey: string;
  readonly primitiveId: string;
  readonly parameters: unknown;
  readonly evidence: unknown;
  readonly harnessContext: Readonly<Record<string, unknown>>;
  readonly consumedKeys: readonly string[];
  readonly producedKeys: readonly string[];
  readonly evaluate: (value: never) => PublishedFactRecord;
  readonly inputSchema: {
    safeParse: (value: unknown) => { success: boolean; error?: unknown; data?: unknown };
  };
};

export const runPrimitivePhase = (
  invocations: readonly PolicyPrimitiveInvocation[],
  facts: PolicyEvaluationFacts,
  registries: PolicyRegistries,
  parameterResolutions: ReadonlyMap<string, ParameterResolution>,
  strategyResolutions: ReadonlyMap<string, StrategyResolution>,
): Result<PrimitivePhaseOutcome, PolicyEvaluationRefusal> => {
  const publishedFacts = new Map<string, unknown>();
  const executions = new Map<string, PrimitiveExecution>();
  const parameterRejections: { primitiveId: string; ruleIds: readonly string[] }[] = [];

  const prepared: PreparedInvocation[] = [];
  for (const invocation of invocations) {
    const primitive = registries.primitives.get(invocation.primitiveId);
    if (primitive === undefined) {
      return refuse(
        "unknown-primitive-invocation",
        `invocation names primitive '${invocation.primitiveId}', absent from the catalog these registries pin`,
      );
    }
    const overridden: Record<string, unknown> = { ...invocation.parameters };
    const overridingRules = new Set<string>();
    for (const resolution of parameterResolutions.values()) {
      if (resolution.primitiveId !== invocation.primitiveId) continue;
      overridden[resolution.parameter] = resolution.value;
      overridingRules.add(resolution.ruleId);
    }
    const parsedParameters = primitive.parameterSchema.safeParse(overridden);
    if (!parsedParameters.success) {
      if (overridingRules.size === 0) {
        return refuse(
          "invalid-invocation-parameters",
          `invocation of '${invocation.primitiveId}' carries parameters its own schema refuses (no policy override involved - the assembly is malformed)`,
        );
      }
      // A policy-resolved parameter its target refuses: the writing rules are
      // reported for fail-closed blockers and the primitive does not run half
      // configured - its execution is unevaluable too.
      parameterRejections.push({
        primitiveId: invocation.primitiveId,
        ruleIds: sortUniqueStrings(overridingRules),
      });
      executions.set(`${invocation.primitiveId}:${executions.size}`, {
        primitiveId: invocation.primitiveId,
        outcome: "unevaluable",
        missing: [`parameters rejected by '${invocation.primitiveId}' schema`],
      });
      continue;
    }
    const strategy = strategyResolutions.get(invocation.primitiveId);
    const harnessContext: Record<string, unknown> = { ...(invocation.context ?? {}) };
    if (strategy !== undefined) harnessContext["strategy"] = strategy.strategy;

    const consumed: string[] = [];
    for (const value of Object.values(overridden)) {
      const binding = contextBinding(value);
      if (binding !== null) consumed.push(binding.key);
    }
    const publishedKeyMap: PublishedKeyMap = (
      primitive.publishedKeys as unknown as (parameters: unknown) => PublishedKeyMap
    )(parsedParameters.data);
    // Identity is (primitive, canonical parameter bytes): the ONE canonical
    // serializer orders nested keys too, so invocation-list order never leaks.
    const canonicalParameters = canonicalJson(overridden as JsonValue);
    if (!canonicalParameters.ok) {
      return refuse(
        "invalid-invocation-parameters",
        `parameters for '${invocation.primitiveId}' are not canonically serializable: ${canonicalParameters.error.message}`,
      );
    }
    prepared.push({
      canonicalKey: `${invocation.primitiveId}:${canonicalParameters.value}`,
      primitiveId: invocation.primitiveId,
      parameters: parsedParameters.data,
      evidence: invocation.evidence,
      harnessContext,
      consumedKeys: sortUniqueStrings(consumed),
      producedKeys: sortUniqueStrings(Object.keys(publishedKeyMap)),
      evaluate: primitive.evaluate,
      inputSchema: primitive.inputSchema,
    });
  }

  prepared.sort((a, b) => compareCanonical(a.canonicalKey, b.canonicalKey));
  for (let index = 1; index < prepared.length; index += 1) {
    if (prepared[index]!.canonicalKey === prepared[index - 1]!.canonicalKey) {
      return refuse(
        "duplicate-invocation",
        `primitive '${prepared[index]!.primitiveId}' is invoked twice with identical parameters - published facts would collide`,
      );
    }
  }

  // Canonical dependency order: Kahn's algorithm over published->consumed
  // edges, ready set kept sorted by canonical key.
  const remaining = new Map(prepared.map((entry) => [entry.canonicalKey, entry]));
  const ordered: PreparedInvocation[] = [];
  while (remaining.size > 0) {
    const producedByRemaining = new Set(
      [...remaining.values()].flatMap((entry) => entry.producedKeys),
    );
    const ready = [...remaining.values()]
      .filter((entry) => entry.consumedKeys.every((key) => !producedByRemaining.has(key)))
      .sort((a, b) => compareCanonical(a.canonicalKey, b.canonicalKey));
    if (ready.length === 0) {
      return refuse(
        "dataflow-cycle",
        `primitive dataflow contains a cycle among [${sortUniqueStrings([...remaining.values()].map((entry) => entry.primitiveId)).join(", ")}]`,
      );
    }
    for (const entry of ready) {
      ordered.push(entry);
      remaining.delete(entry.canonicalKey);
    }
  }

  for (const entry of ordered) {
    const assembled: Record<string, unknown> = { ...entry.harnessContext };
    const missingBindings: string[] = [];
    const parameterRecord = entry.parameters as Readonly<Record<string, unknown>>;
    for (const [name, value] of Object.entries(parameterRecord)) {
      const context = contextBinding(value);
      if (context !== null) {
        const resolved = publishedFacts.has(context.key)
          ? publishedFacts.get(context.key)
          : facts.intent.has(context.key)
            ? facts.intent.get(context.key)
            : undefined;
        if (resolved === undefined) {
          missingBindings.push(context.key);
          continue;
        }
        if (Object.hasOwn(assembled, name) && assembled[name] !== resolved) {
          return refuse(
            "context-assembly-conflict",
            `invocation of '${entry.primitiveId}' supplies context '${name}' that disagrees with the bound key '${context.key}'`,
          );
        }
        assembled[name] = resolved;
      }
      const constant = constantBinding(value);
      if (constant !== null) assembled[name] = constant.amount;
    }
    if (missingBindings.length > 0) {
      executions.set(entry.canonicalKey, {
        primitiveId: entry.primitiveId,
        outcome: "unevaluable",
        missing: sortUniqueStrings(missingBindings.map((key) => `context:${key}`)),
      });
      continue;
    }
    const parsedInput = entry.inputSchema.safeParse({
      parameters: entry.parameters,
      evidence: entry.evidence,
      context: assembled,
    });
    if (!parsedInput.success) {
      // Bundle-shaped data the primitive's own schema refuses (a negative
      // resolved draw, a claim of an undeclared kind) is CONTENT, not
      // structure: the execution lands unevaluable, its published keys stay
      // absent, and every dependent rule blocks - never a refusal that would
      // hide a fail-closed outcome, never a silent proceed.
      executions.set(entry.canonicalKey, {
        primitiveId: entry.primitiveId,
        outcome: "unevaluable",
        missing: [`input rejected by '${entry.primitiveId}' schema`],
      });
      continue;
    }
    const published = entry.evaluate(parsedInput.data as never);
    for (const key of Object.keys(published)) {
      if (!entry.producedKeys.includes(key)) {
        return refuse(
          "published-key-escape",
          `'${entry.primitiveId}' published undeclared key '${key}'`,
        );
      }
      if (publishedFacts.has(key)) {
        return refuse(
          "published-key-collision",
          `published key '${key}' emitted twice - bindings overlap`,
        );
      }
      publishedFacts.set(key, published[key]);
    }
    executions.set(entry.canonicalKey, {
      primitiveId: entry.primitiveId,
      outcome: "published",
      published,
    });
  }

  return ok({ publishedFacts, executions, parameterRejections });
};
