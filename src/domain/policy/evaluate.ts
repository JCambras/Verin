/**
 * The deterministic four-phase policy evaluator (v3 §6.1; prompt 9, ADR-0053;
 * ratified design §3.5). A PURE function of its arguments:
 *
 *  Phase 0 - configuration rules (predicates read only evidence, instructions,
 *            and intent - load check 6 guarantees it) resolve `set_parameter`
 *            and `select_candidate` over the domain-config defaults;
 *  Phase 1 - bound primitives run in canonical dependency order
 *            (evaluate-primitives.ts);
 *  Phase 2 - the remaining rules evaluate over the full context;
 *  Phase 3 - a FIXED resolution lattice: any prohibition -> prohibited; else
 *            any blocker -> blocked; else proceed with authority as the
 *            most-restrictive union (prohibit > block > specialist_review >
 *            approval > automatic - the §6.1 normative cumulative rule).
 *
 * Determinism constraints (complete list, each fenced or property-tested): no
 * clock (asOf only), no randomness, no IO, no iteration-order dependence
 * (effects accumulate in commutative structures; serialized orderings are
 * canonical sorts), integer money end to end. The evaluator never throws:
 * policy content lands in the trace fail-closed; only structural
 * impossibilities refuse, as typed errors. Nothing here reads a domain id -
 * the `policy-ast` fence holds the whole module to that.
 */
import { err, ok, type Result } from "@contracts/result";
import type { PIIBearing } from "@contracts/pii";
import {
  evaluatePredicate,
  resolveValue,
  type PolicyContextPlane,
  type PolicyEvaluationFacts,
} from "./facts";
import type { LoadedPolicy, LoadedPolicyRule } from "./load";
import type { PolicyRegistries } from "./registries";
import {
  runPrimitivePhase,
  type PolicyPrimitiveInvocation,
} from "./evaluate-primitives";
import {
  compareCanonical,
  compareProhibitions,
  evidenceRequiredBlockerCode,
  ruleUnevaluableBlockerCode,
  sortUniqueStrings,
  type ApprovalRequirementOutcome,
  type EvidenceRequirementOutcome,
  type ParameterResolution,
  type PolicyEvaluationRefusal,
  type PolicyEvaluationTrace,
  type RuleOutcome,
  type StrategyResolution,
  type TraceBlocker,
  type TraceDisposition,
  type TraceProhibition,
} from "./trace";

export type { PolicyPrimitiveInvocation } from "./evaluate-primitives";

export type PolicyEvaluationInput = PIIBearing & {
  readonly facts: PolicyEvaluationFacts;
  readonly invocations: readonly PolicyPrimitiveInvocation[];
};

/**
 * Blocker code -> contributing rule id -> the resolving evidence kinds THAT
 * rule offered. Per-rule, not pooled: unwinding one rule's contribution has to
 * take its resolving kinds with it, and a pooled set could not say which were
 * whose.
 */
type BlockerAccumulator = Map<string, Map<string, Set<string>>>;

const addBlocker = (
  accumulator: BlockerAccumulator,
  code: string,
  resolving: readonly string[],
  ruleId: string,
): void => {
  const contributions = accumulator.get(code) ?? new Map<string, Set<string>>();
  const kinds = contributions.get(ruleId) ?? new Set<string>();
  for (const kind of resolving) kinds.add(kind);
  contributions.set(ruleId, kinds);
  accumulator.set(code, contributions);
};

/** What the evidence-requirement map actually holds: the outcome's rule ids are a SET until emission. */
type EvidenceRequirementAccumulator = {
  readonly evidenceKind: string;
  readonly absence: EvidenceRequirementOutcome["absence"];
  readonly outcome: EvidenceRequirementOutcome["outcome"];
  readonly reviewTemplateId?: string;
  readonly ruleIds: Set<string>;
};

export const evaluatePolicy = (
  policy: LoadedPolicy,
  input: PolicyEvaluationInput,
  registries: PolicyRegistries,
): Result<PolicyEvaluationTrace, PolicyEvaluationRefusal> => {
  const { facts } = input;
  const ruleOutcomes = new Map<string, RuleOutcome>();
  const parameterResolutions = new Map<string, ParameterResolution>();
  const strategyResolutions = new Map<string, StrategyResolution>();
  const blockers: BlockerAccumulator = new Map();
  const evidenceRequirements = new Map<string, EvidenceRequirementAccumulator>();
  const approvals = new Map<string, { kind: "approval" | "specialist_review"; ruleIds: Set<string> }>();
  const prohibitions = new Map<string, { ruleIds: Set<string> }>();

  const configurationRules = [...policy.rules]
    .filter((rule) => rule.phase === "configuration")
    .sort((a, b) => compareCanonical(a.id, b.id));
  const evaluationRules = [...policy.rules]
    .filter((rule) => rule.phase === "evaluation")
    .sort((a, b) => compareCanonical(a.id, b.id));

  const markUnevaluable = (
    rule: LoadedPolicyRule,
    missing: readonly string[],
    evidenceKinds: readonly string[],
  ): void => {
    ruleOutcomes.set(rule.id, {
      ruleId: rule.id,
      phase: rule.phase,
      outcome: "unevaluable",
      missing: sortUniqueStrings(missing),
    });
    addBlocker(blockers, ruleUnevaluableBlockerCode(rule.id), sortUniqueStrings(evidenceKinds), rule.id);
  };

  /**
   * ATOMIC UNWIND (firm ruling p9-param-rejection-trace). A rule that turns out
   * to be unevaluable contributes NOTHING to the trace except its own
   * rule-unevaluable blocker, so every Phase-0 effect it already applied is
   * rolled back first: a parameter resolution the primitive never ran with, and
   * a rule id sitting in an approval/prohibition/blocker/evidence entry while
   * that same rule reads `unevaluable`, are both traces that describe a run that
   * did not happen. An accumulator whose only contributor was the unwound rule
   * disappears with it; the synthesized blocker carries the reason.
   */
  const unwindRule = (ruleId: string): void => {
    for (const [key, resolution] of parameterResolutions) {
      if (resolution.ruleId === ruleId) parameterResolutions.delete(key);
    }
    for (const [key, resolution] of strategyResolutions) {
      if (resolution.ruleId === ruleId) strategyResolutions.delete(key);
    }
    for (const [code, contributions] of blockers) {
      if (contributions.delete(ruleId) && contributions.size === 0) blockers.delete(code);
    }
    for (const [key, entry] of evidenceRequirements) {
      if (entry.ruleIds.delete(ruleId) && entry.ruleIds.size === 0) evidenceRequirements.delete(key);
    }
    for (const [templateId, entry] of approvals) {
      if (entry.ruleIds.delete(ruleId) && entry.ruleIds.size === 0) approvals.delete(templateId);
    }
    for (const [code, entry] of prohibitions) {
      if (entry.ruleIds.delete(ruleId) && entry.ruleIds.size === 0) prohibitions.delete(code);
    }
  };

  const applyRule = (
    rule: LoadedPolicyRule,
    context: PolicyContextPlane,
  ): PolicyEvaluationRefusal | null => {
    const outcome = evaluatePredicate(rule.when, facts, context);
    if (outcome.truth === "unevaluable") {
      markUnevaluable(
        rule,
        outcome.missing.map((miss) => miss.ref),
        outcome.missing.flatMap((miss) => (miss.evidenceKind === undefined ? [] : [miss.evidenceKind])),
      );
      return null;
    }
    if (outcome.truth === "false") {
      ruleOutcomes.set(rule.id, { ruleId: rule.id, phase: rule.phase, outcome: "not-fired" });
      return null;
    }

    // A fired rule applies atomically: resolve every set_parameter value FIRST,
    // and if any is missing the WHOLE rule is unevaluable (no half-applied
    // rule). Keyed by the write TARGET, which load check 7 proves unique within
    // a rule, so the application below reads its own resolution by name - an
    // identity re-scan of a list would be quadratic and would lean on a
    // non-null assertion inside a function contracted never to throw.
    const resolvedWrites = new Map<string, ParameterResolution>();
    for (const effect of rule.effects) {
      if (effect.kind !== "set_parameter") continue;
      if (rule.phase !== "configuration") {
        return {
          code: "config-effect-in-evaluation-phase",
          message: `rule ${rule.id}: set_parameter reached Phase 2 - the loader was bypassed`,
        };
      }
      const key = `${effect.primitiveId}:${effect.parameter}`;
      if (resolvedWrites.has(key) || parameterResolutions.has(key)) {
        return {
          code: "duplicate-parameter-write",
          message: `(${effect.primitiveId}, ${effect.parameter}) written twice at runtime - the load-time conflict prover was bypassed`,
        };
      }
      const resolution = resolveValue(effect.value, facts, context);
      if (resolution.state === "missing") {
        markUnevaluable(
          rule,
          resolution.missing.map((miss) => miss.ref),
          resolution.missing.flatMap((miss) => (miss.evidenceKind === undefined ? [] : [miss.evidenceKind])),
        );
        return null;
      }
      resolvedWrites.set(key, {
        primitiveId: effect.primitiveId,
        parameter: effect.parameter,
        value: resolution.value,
        ruleId: rule.id,
      });
    }

    ruleOutcomes.set(rule.id, { ruleId: rule.id, phase: rule.phase, outcome: "fired" });
    // The resolutions ARE the parameter writes, so they land together with the
    // pass that proved them applicable - all of them or, above, none.
    for (const [key, write] of resolvedWrites) parameterResolutions.set(key, write);

    for (const effect of rule.effects) {
      switch (effect.kind) {
        // Applied above, atomically with the resolution pass that produced it.
        case "set_parameter":
          break;
        case "select_candidate": {
          if (rule.phase !== "configuration") {
            return {
              code: "config-effect-in-evaluation-phase",
              message: `rule ${rule.id}: select_candidate reached Phase 2 - the loader was bypassed`,
            };
          }
          if (strategyResolutions.has(effect.primitiveId)) {
            return {
              code: "duplicate-strategy-write",
              message: `select_candidate on ${effect.primitiveId} written twice at runtime - the load-time conflict prover was bypassed`,
            };
          }
          strategyResolutions.set(effect.primitiveId, {
            primitiveId: effect.primitiveId,
            strategy: effect.strategy,
            ruleId: rule.id,
          });
          break;
        }
        case "require_evidence": {
          const present = facts.evidence.has(effect.evidenceKind);
          const key = `${effect.evidenceKind}:${effect.absence}:${effect.reviewTemplateId ?? ""}`;
          const ruleIds = evidenceRequirements.get(key)?.ruleIds ?? new Set<string>();
          ruleIds.add(rule.id);
          evidenceRequirements.set(key, {
            evidenceKind: effect.evidenceKind,
            absence: effect.absence,
            outcome: present ? "satisfied" : "absent",
            ...(effect.reviewTemplateId === undefined ? {} : { reviewTemplateId: effect.reviewTemplateId }),
            ruleIds,
          });
          if (!present && effect.absence === "block") {
            addBlocker(
              blockers,
              evidenceRequiredBlockerCode(effect.evidenceKind),
              [effect.evidenceKind],
              rule.id,
            );
          }
          if (!present && effect.absence === "specialist_review") {
            const template = registries.approvalTemplates.get(effect.reviewTemplateId!);
            if (template === undefined) {
              return {
                code: "unknown-approval-template",
                message: `review template ${effect.reviewTemplateId} vanished between load and evaluation`,
              };
            }
            const entry =
              approvals.get(effect.reviewTemplateId!) ??
              { kind: "specialist_review" as const, ruleIds: new Set<string>() };
            entry.ruleIds.add(rule.id);
            approvals.set(effect.reviewTemplateId!, entry);
          }
          break;
        }
        case "require_approval": {
          const template = registries.approvalTemplates.get(effect.templateId);
          if (template === undefined) {
            return {
              code: "unknown-approval-template",
              message: `approval template ${effect.templateId} vanished between load and evaluation`,
            };
          }
          const entry = approvals.get(effect.templateId) ?? { kind: template.kind, ruleIds: new Set<string>() };
          entry.ruleIds.add(rule.id);
          approvals.set(effect.templateId, entry);
          break;
        }
        case "block":
          addBlocker(blockers, effect.blockerCode, effect.resolvingEvidenceKinds, rule.id);
          break;
        case "prohibit": {
          const entry = prohibitions.get(effect.prohibitionCode) ?? { ruleIds: new Set<string>() };
          entry.ruleIds.add(rule.id);
          prohibitions.set(effect.prohibitionCode, entry);
          break;
        }
      }
    }
    return null;
  };

  // ── Phase 0 ───────────────────────────────────────────────────────────────────
  // Nothing is published yet, and a primitive-origin key resolves ONLY from the
  // published plane - which is what load check 6's stratification already
  // proves no configuration rule reads.
  const { contextKeys } = registries;
  const configurationContext: PolicyContextPlane = { published: new Map(), contextKeys };
  for (const rule of configurationRules) {
    const refusal = applyRule(rule, configurationContext);
    if (refusal !== null) return err(refusal);
  }

  // ── Phase 1 ───────────────────────────────────────────────────────────────────
  const phase = runPrimitivePhase(
    input.invocations,
    facts,
    registries,
    parameterResolutions,
    strategyResolutions,
  );
  if (!phase.ok) return phase;
  const { publishedFacts, executions, parameterRejections } = phase.value;
  const rejectingPrimitives = new Map<string, Set<string>>();
  for (const rejection of parameterRejections) {
    for (const ruleId of rejection.ruleIds) {
      const named = rejectingPrimitives.get(ruleId) ?? new Set<string>();
      named.add(rejection.primitiveId);
      rejectingPrimitives.set(ruleId, named);
    }
  }
  const rejectedRuleIds = sortUniqueStrings(rejectingPrimitives.keys());
  // Unwind EVERY rejected rule before marking any of them: a rule can be
  // rejected by two primitives at once, and an unwind that ran between two
  // marks would delete the blocker the first mark just synthesized.
  for (const ruleId of rejectedRuleIds) unwindRule(ruleId);
  const configurationRuleById = new Map<string, LoadedPolicyRule>(
    configurationRules.map((rule) => [rule.id, rule]),
  );
  for (const ruleId of rejectedRuleIds) {
    markUnevaluable(
      configurationRuleById.get(ruleId)!,
      [...rejectingPrimitives.get(ruleId)!].map((id) => `set_parameter rejected by ${id}`),
      [],
    );
  }

  // ── Phase 2 ───────────────────────────────────────────────────────────────────
  const evaluationContext: PolicyContextPlane = { published: publishedFacts, contextKeys };
  for (const rule of evaluationRules) {
    const refusal = applyRule(rule, evaluationContext);
    if (refusal !== null) return err(refusal);
  }

  // ── Phase 3 - the fixed lattice ───────────────────────────────────────────────
  const traceProhibitions: TraceProhibition[] = [...prohibitions.entries()]
    .map(([code, entry]) => ({
      code,
      source: "firm_policy" as const,
      ruleIds: sortUniqueStrings(entry.ruleIds),
    }))
    .sort(compareProhibitions);
  const traceBlockers: TraceBlocker[] = [...blockers.entries()]
    .map(([code, contributions]) => ({
      code,
      resolvingEvidenceKinds: sortUniqueStrings(
        [...contributions.values()].flatMap((kinds) => [...kinds]),
      ),
      ruleIds: sortUniqueStrings(contributions.keys()),
    }))
    .sort((a, b) => compareCanonical(a.code, b.code));
  const approvalOutcomes: ApprovalRequirementOutcome[] = [...approvals.entries()]
    .map(([templateId, entry]) => ({
      templateId,
      kind: entry.kind,
      ruleIds: sortUniqueStrings(entry.ruleIds),
    }))
    .sort((a, b) => compareCanonical(a.templateId, b.templateId));

  const specialistTemplateIds = approvalOutcomes
    .filter((entry) => entry.kind === "specialist_review")
    .map((entry) => entry.templateId);
  const approvalTemplateIds = approvalOutcomes
    .filter((entry) => entry.kind === "approval")
    .map((entry) => entry.templateId);

  const disposition: TraceDisposition =
    traceProhibitions.length > 0
      ? {
          kind: "prohibited",
          primaryProhibitionCode: traceProhibitions[0]!.code,
          primaryProhibitionSource: traceProhibitions[0]!.source,
        }
      : traceBlockers.length > 0
        ? { kind: "blocked", blockerCodes: traceBlockers.map((blocker) => blocker.code) }
        : {
            kind: "proceed",
            authority: {
              mode:
                specialistTemplateIds.length > 0
                  ? "specialist_review"
                  : approvalTemplateIds.length > 0
                    ? "approval"
                    : "automatic",
              approvalTemplateIds,
              specialistTemplateIds,
            },
          };

  return ok({
    grammarVersion: policy.grammarVersion,
    primitiveSetVersion: policy.primitiveSetVersion,
    ruleOutcomes: [...ruleOutcomes.values()].sort((a, b) => compareCanonical(a.ruleId, b.ruleId)),
    parameterResolutions: [...parameterResolutions.values()].sort(
      (a, b) =>
        compareCanonical(a.primitiveId, b.primitiveId) || compareCanonical(a.parameter, b.parameter),
    ),
    strategyResolutions: [...strategyResolutions.values()].sort((a, b) =>
      compareCanonical(a.primitiveId, b.primitiveId),
    ),
    primitiveExecutions: [...executions.entries()]
      .sort(([a], [b]) => compareCanonical(a, b))
      .map(([, execution]) => execution),
    blockers: traceBlockers,
    evidenceRequirements: [...evidenceRequirements.values()]
      .map((entry) => ({
        evidenceKind: entry.evidenceKind,
        absence: entry.absence,
        outcome: entry.outcome,
        ...(entry.reviewTemplateId === undefined ? {} : { reviewTemplateId: entry.reviewTemplateId }),
        ruleIds: sortUniqueStrings(entry.ruleIds),
      }))
      // As total as the accumulation key `kind:absence:reviewTemplateId`, or
      // two specialist requirements on one evidence kind under DIFFERENT review
      // templates would compare equal and fall back to Map insertion order -
      // rule-id order leaking into bytes the migration fixture pins.
      .sort(
        (a, b) =>
          compareCanonical(a.evidenceKind, b.evidenceKind) ||
          compareCanonical(a.absence, b.absence) ||
          compareCanonical(a.reviewTemplateId ?? "", b.reviewTemplateId ?? ""),
      ),
    approvalRequirements: approvalOutcomes,
    prohibitions: traceProhibitions,
    disposition,
  });
};
