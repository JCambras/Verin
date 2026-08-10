/**
 * `loadPolicy` - the deterministic load-time gate (v3 §6.1; prompt 9,
 * ADR-0053; ratified design §3.2). A policy loads against the four pinned
 * registries, and EVERY closure failure is a load error, never an evaluation
 * surprise. The seven checks, in order:
 *
 *  1. grammar parse (strict objects, closed discriminated unions; unknown
 *     operators, effects, comparators, and grammar versions are parse
 *     failures), behind the structural nesting bound that keeps every recursive
 *     walk below this one total, plus refusal of the reserved `elapsed` op
 *     (grammar 1.1.0 parses it; nothing evaluates it until its activating
 *     prompt lands semantics - OQ-7);
 *  2. reference closure - unknown evidence kind/path, instruction kind/path,
 *     context key, primitive, parameter, strategy, or approval template; the
 *     reason-code namespaces the evaluator reserves for its synthesized
 *     fail-closed blockers, which an authored code may not mint into; and the
 *     parameters a primitive's published keys are DERIVED from, which the
 *     closed context-key vocabulary pins and policy therefore may not write;
 *  3. type check - comparator operand agreement, ordering only over orderable
 *     types, homogeneous `in` sets, day-or-finer freshness windows,
 *     `set_parameter` constants against the primitive's own schema;
 *  4. injection inertness - paths are Map keys against the registries (a
 *     `__proto__` path is simply unknown), constants are inert data;
 *  5. effect-conflict rejection via the conservative disjointness prover;
 *  6. stratification - a rule emitting `set_parameter`/`select_candidate` may
 *     not read any primitive-published context key (OQ-6 strict form), in its
 *     `when` or in a `set_parameter` value (the value resolves in Phase 0,
 *     before any primitive has run);
 *  7. self-conflict - one rule writing one target twice.
 *
 * Checks 2-4 live beside this file under the per-file ceiling, split by what
 * they read: load-checks.ts holds the predicate side and the shared value-type
 * resolver, load-effects.ts every check that reads an effect. Errors accumulate
 * so an author sees the whole surface at once; a policy loads only when EMPTY.
 */
import { err, ok, type Result } from "@contracts/result";
import {
  POLICY_GRAMMAR_VERSIONS,
  findReservedOps,
  policyAstSchemaFor,
  type GrammarPolicyAst,
  type PolicyEffect,
  type PolicyGrammarVersion,
  type PolicyRule,
  type PredicateNode,
} from "@contracts/decision-core/policy";
import type { PolicyRegistries } from "./registries";
import { DNF_DISJUNCT_CAP, predicateDnf, proveDisjoint } from "./conflict";
import { checkEffects } from "./load-effects";
import {
  checkPredicate,
  effectTargets,
  isConfigEffect,
  primitiveKeyReads,
  type IssueSink,
  type PolicyLoadIssue,
} from "./load-checks";

export type { PolicyLoadIssue } from "./load-checks";

/**
 * Phase classification (ratified design §3.5): `configuration` rules read no
 * primitive-published key and evaluate in Phase 0 (their `set_parameter` /
 * `select_candidate` effects configure the primitives); `evaluation` rules
 * read primitive outputs and run in Phase 2.
 */
export type LoadedPolicyRule = {
  readonly id: PolicyRule["id"];
  readonly when: PredicateNode;
  readonly effects: readonly PolicyEffect[];
  readonly phase: "configuration" | "evaluation";
};

export type LoadedPolicy = {
  readonly grammarVersion: PolicyGrammarVersion;
  readonly primitiveSetVersion: string;
  readonly rules: readonly LoadedPolicyRule[];
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * The structural nesting bound, and why it is a LOAD-TIME admission rule rather
 * than a grammar arm. `all`/`any`/`not` recurse without limit by ratification,
 * and every consumer of a predicate recurses with them: the Zod parse itself,
 * `findReservedOps`, the closure and key-read walks, `predicateDnf`, and the
 * evaluator's `evaluatePredicate`. An unbounded document therefore exhausts the
 * stack INSIDE a function contracted to return typed errors and never throw -
 * MEASURED, a RangeError out of `safeParse` at a few hundred levels.
 *
 * Bounding admission is what makes the whole module total: a `LoadedPolicy` is
 * the only thing the evaluator consumes, so a depth every walk can carry is
 * proven once, here, instead of guarded (or forgotten) at five recursion sites.
 * The cap counts raw document nesting - roughly two levels per `all`/`any`
 * step - which leaves ~30 nested connectives against the three or four a real
 * firm policy uses, and stays an order of magnitude below the shallowest engine
 * limit measured. It is enforced BEFORE the parse, by an ITERATIVE walk,
 * because the parse is one of the recursions it exists to protect.
 */
const MAX_DOCUMENT_NESTING_DEPTH = 64;

/**
 * The depth of the first node deeper than the cap, or null when none is. The
 * stack carries a plain integer rather than a materialized path: the walk runs
 * over EVERY node of every document on the happy path, where a per-node path
 * array is an allocation nothing ever reads, and the refusal below has no rule
 * to name anyway (it happens before the parse).
 */
const tooDeeplyNested = (root: unknown): number | null => {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value: root, depth: 0 }];
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    if (depth > MAX_DOCUMENT_NESTING_DEPTH) return depth;
    if (Array.isArray(value)) {
      for (const item of value) pending.push({ value: item, depth: depth + 1 });
    } else if (typeof value === "object" && value !== null) {
      for (const key of Object.keys(value)) {
        pending.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
      }
    }
  }
  return null;
};

export const loadPolicy = (
  document: unknown,
  registries: PolicyRegistries,
): Result<LoadedPolicy, readonly PolicyLoadIssue[]> => {
  if (!isPlainRecord(document)) {
    return err([
      { code: "grammar-parse", message: "a policy document must be a plain JSON object" },
    ]);
  }
  const overDeep = tooDeeplyNested(document);
  if (overDeep !== null) {
    return err([
      {
        code: "grammar-parse",
        message: `a node nests ${overDeep} levels deep, past the ${MAX_DOCUMENT_NESTING_DEPTH}-level structural cap; a predicate every load and evaluation walk can carry is bounded here, before any of them recurse`,
      },
    ]);
  }
  const declared = Object.hasOwn(document, "schemaVersion") ? document["schemaVersion"] : undefined;
  const version = POLICY_GRAMMAR_VERSIONS.find((known) => known === declared);
  if (version === undefined) {
    return err([
      {
        code: "unknown-grammar-version",
        message: `unknown grammar version ${JSON.stringify(declared)}; this build parses [${POLICY_GRAMMAR_VERSIONS.join(", ")}]`,
      },
    ]);
  }
  const parsed = policyAstSchemaFor(version).safeParse(document);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) => ({
        code: "grammar-parse" as const,
        message: `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      })),
    );
  }
  const ast: GrammarPolicyAst = parsed.data;

  const reservedIssues: PolicyLoadIssue[] = ast.rules.flatMap((rule) =>
    findReservedOps(rule.when).map((found) => ({
      code: "reserved-op-not-evaluable" as const,
      ruleId: rule.id,
      message: `rule ${rule.id}: op '${found.op}' at ${found.path.join(".")} is ratified grammar-only (OQ-7); it gains semantics through its activating version bump, never here`,
    })),
  );
  if (reservedIssues.length > 0) return err(reservedIssues);
  // Reserved ops are absent, so every predicate is structurally evaluable.
  const rules = ast.rules as readonly PolicyRule[];

  const issues: PolicyLoadIssue[] = [];
  const report: IssueSink = (issue) => issues.push(issue);

  if (ast.primitiveSetVersion !== registries.primitiveSetVersion) {
    report({
      code: "primitive-set-version-mismatch",
      message: `policy pins primitive set ${ast.primitiveSetVersion}; these registries were assembled against ${registries.primitiveSetVersion}`,
    });
  }

  // ONE walk per rule for the ONE definition of "reads a primitive-published
  // key": check 6 below and the phase classification at the bottom are the two
  // consumers, and they must never disagree about what a Phase-0 rule may read.
  const keyReads = new Map<string, readonly string[]>();

  for (const rule of rules) {
    checkPredicate(rule, registries, report);
    checkEffects(rule, registries, report);
    keyReads.set(rule.id, primitiveKeyReads(rule, registries));

    // Check 6 - stratification (OQ-6 strict form).
    if (rule.effects.some(isConfigEffect)) {
      const reads = [...new Set(keyReads.get(rule.id)!)].sort();
      if (reads.length > 0) {
        report({
          code: "configuration-rule-reads-primitive-key",
          ruleId: rule.id,
          message: `rule ${rule.id}: configures a primitive but reads primitive-published context [${reads.join(", ")}]; v1 configuration rules read only evidence, instructions, and intent`,
        });
      }
    }

    // Check 7 - self-conflict.
    const seen = new Set<string>();
    for (const target of effectTargets(rule)) {
      if (seen.has(target.key)) {
        report({
          code: "self-conflict",
          ruleId: rule.id,
          message: `rule ${rule.id}: emits ${target.description} more than once`,
        });
      }
      seen.add(target.key);
    }
  }

  // Check 5 - cross-rule effect conflict via the disjointness prover.
  const writers = new Map<string, { readonly description: string; readonly rules: PolicyRule[] }>();
  for (const rule of rules) {
    for (const target of new Map(effectTargets(rule).map((t) => [t.key, t])).values()) {
      const entry = writers.get(target.key) ?? { description: target.description, rules: [] };
      entry.rules.push(rule);
      writers.set(target.key, entry);
    }
  }
  const dnfCache = new Map<string, ReturnType<typeof predicateDnf>>();
  const tooComplexReported = new Set<string>();
  const dnfOf = (rule: PolicyRule) => {
    const cached = dnfCache.get(rule.id) ?? predicateDnf(rule.when);
    dnfCache.set(rule.id, cached);
    if (!cached.ok && !tooComplexReported.has(rule.id)) {
      tooComplexReported.add(rule.id);
      report({
        code: "predicate-too-complex",
        ruleId: rule.id,
        message: `rule ${rule.id}: predicate exceeds the ${DNF_DISJUNCT_CAP}-branch normalization cap, so conflict freedom cannot be proven; restructure the predicate`,
      });
    }
    return cached;
  };
  for (const { description, rules: writingRules } of [...writers.values()]) {
    for (let a = 0; a < writingRules.length; a += 1) {
      for (let b = a + 1; b < writingRules.length; b += 1) {
        const dnfA = dnfOf(writingRules[a]!);
        const dnfB = dnfOf(writingRules[b]!);
        if (!dnfA.ok || !dnfB.ok) continue;
        const verdict = proveDisjoint(dnfA.dnf, dnfB.dnf);
        if (!verdict.disjoint) {
          report({
            code: "effect-conflict",
            message: `rules ${writingRules[a]!.id} and ${writingRules[b]!.id} both emit ${description} and are not provably disjoint: ${verdict.explanation}. Merge them or give them mutually exclusive guards`,
          });
        }
      }
    }
  }

  if (issues.length > 0) return err(issues);

  return ok({
    grammarVersion: version,
    primitiveSetVersion: ast.primitiveSetVersion,
    rules: rules.map((rule) => ({
      id: rule.id,
      when: rule.when,
      effects: rule.effects,
      phase: keyReads.get(rule.id)!.length === 0 ? "configuration" : "evaluation",
    })),
  });
};
