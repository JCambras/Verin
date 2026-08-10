/**
 * The facts plane the interpreter evaluates over, and the three-valued
 * predicate semantics (prompt 9, ADR-0053; ratified design §3.5).
 *
 * Facts arrive PRE-RESOLVED from the immutable DecisionInputBundle by the
 * evaluation harness (prompts 14-16 own assembly): per-kind evidence snapshots
 * (one per kind - AST paths resolve to at most one snapshot per kind BY
 * DESIGN), instruction values, and intent context. Paths are opaque
 * registry-declared keys looked up as own properties of a values record -
 * never traversal expressions - so an injected `__proto__` path reads nothing.
 * Assembly ALSO owes canonical temporal bytes (the prompt 14-16 obligation):
 * the declared-type guard in `resolveValue` is a fail-closed backstop for
 * temporal values that arrive in a non-canonical byte form, not a substitute
 * for canonicalizing them at the assembly boundary (firm ruling
 * p9-temporal-fact-bytes).
 *
 * FAIL-CLOSED TOTALITY (the load-bearing rule): `exists` and `is_fresh` are
 * presence-aware - an absent snapshot is a legitimate `false`. But an absent
 * value reached in a VALUE position (compare/in operand, set_parameter value)
 * makes the enclosing rule UNEVALUABLE, and an unevaluable rule synthesizes a
 * blocker rather than being skipped. Kleene logic keeps that honest: a rule
 * guarded by `exists` collapses to plain `false` when the guard fails, so
 * optional behavior is expressible, while an unguarded read of missing data
 * can never silently not-fire.
 */
import type {
  PolicyConstant,
  PredicateNode,
  ValueNode,
} from "@contracts/decision-core/policy";
import type { Scalar } from "@contracts/decision-core/decision";
import type { PIIBearing } from "@contracts/pii";
import type {
  ContextKeyDescriptor,
  EvidenceKindDescriptor,
  InstructionKindDescriptor,
  PolicyValueType,
} from "./registries";
import {
  durationToMillis,
  epochMillisOf,
  isCanonicalDate,
  isCanonicalTimestamp,
} from "./temporal";

export type EvidenceFactSnapshot = {
  /** Canonical UTC instant the source observed the fact (drives is_fresh). */
  readonly observedAt: string;
  readonly values: Readonly<Record<string, Scalar>>;
};

/**
 * PIIBearing: the facts plane carries evidence VALUES (client financial data),
 * so it can never be reachable from `llm/` - structurally, via the marker.
 */
export type PolicyEvaluationFacts = PIIBearing & {
  /** The bundle's asOf instant - the ONLY "now" the interpreter ever sees. */
  readonly asOf: string;
  readonly evidence: ReadonlyMap<string, EvidenceFactSnapshot>;
  readonly instructions: ReadonlyMap<string, Readonly<Record<string, Scalar>>>;
  readonly intent: ReadonlyMap<string, Scalar>;
};

/** A value miss, precise enough to enrich a synthesized blocker. */
export type MissingValue = {
  readonly ref: string;
  /** Set when the miss is resolvable by supplying an evidence kind. */
  readonly evidenceKind?: string;
};

export type ValueResolution =
  | { readonly state: "resolved"; readonly value: Scalar }
  | { readonly state: "missing"; readonly missing: readonly MissingValue[] };

const missing = (ref: string, evidenceKind?: string): ValueResolution => ({
  state: "missing",
  missing: [evidenceKind === undefined ? { ref } : { ref, evidenceKind }],
});

const isScalar = (value: unknown): value is Scalar =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

/**
 * The plane a value node resolves against: what the bound primitives have
 * published SO FAR in this run, plus the declared vocabularies resolution
 * validates with - the derived context-key registry that declares where each
 * key legitimately comes from, and the evidence/instruction path registries
 * that declare each path's value type (which is what lets `resolveValue`
 * refuse non-canonical temporal bytes instead of comparing them).
 */
export type PolicyContextPlane = {
  readonly published: ReadonlyMap<string, unknown>;
  readonly contextKeys: ReadonlyMap<string, ContextKeyDescriptor>;
  readonly evidence: ReadonlyMap<string, EvidenceKindDescriptor>;
  readonly instructions: ReadonlyMap<string, InstructionKindDescriptor>;
};

/**
 * THE context-key resolution, shared by the AST value plane and the Phase-1
 * binding assembly so one key can never resolve two ways inside one
 * evaluation. It reads the key's DECLARED ORIGIN rather than searching both
 * planes in order: a primitive-origin key comes only from the published facts,
 * an intent-origin key only from the intent slots, and a key the registry never
 * declared resolves nowhere.
 *
 * Searching in order would be a fail-OPEN. `facts.intent` is a plain map the
 * harness assembles - nothing validates its keys against the vocabulary - so an
 * intent entry sitting under a primitive's published key would SUBSTITUTE for a
 * fact whenever that primitive landed unevaluable and published nothing. The
 * enclosing rule would then fire on harness data instead of landing unevaluable
 * and synthesizing its blocker, which is precisely the silent not-fail-closed
 * this module exists to prevent. Origin-keyed resolution makes the substitution
 * unrepresentable rather than merely improbable.
 */
export const resolveContextKey = (
  key: string,
  facts: PolicyEvaluationFacts,
  context: PolicyContextPlane,
): { readonly found: true; readonly value: unknown } | { readonly found: false } => {
  const origin = context.contextKeys.get(key)?.origin;
  if (origin === undefined) return { found: false };
  if (origin.source === "intent") {
    return facts.intent.has(key) ? { found: true, value: facts.intent.get(key) } : { found: false };
  }
  return context.published.has(key)
    ? { found: true, value: context.published.get(key) }
    : { found: false };
};

/**
 * Fail-closed canonical-byte guard for temporal-typed fact reads (firm ruling
 * p9-temporal-fact-bytes). Ordering over `iso-date`/`iso-timestamp` values is
 * codepoint-lexicographic, which is chronological ONLY for the canonical byte
 * forms: a harness-supplied `'2026-8-1'` or `'2026-08-01T12:00:00+02:00'`
 * under a temporal-typed path would order chronologically WRONG while `eq`/`in`
 * silently never match - the same silent-wrong-answer class as a non-scalar.
 * Returns the declared temporal form the bytes fail, or null when the value is
 * admissible (or the declared type is not temporal, whose forms load check 5
 * already pins for constants).
 */
const temporalByteMiss = (
  declared: PolicyValueType | undefined,
  value: Scalar,
): "iso-date" | "iso-timestamp" | null => {
  if (declared !== "iso-date" && declared !== "iso-timestamp") return null;
  if (
    typeof value === "string" &&
    (declared === "iso-date" ? isCanonicalDate(value) : isCanonicalTimestamp(value))
  ) {
    return null;
  }
  return declared;
};

/**
 * Resolves a value node over the facts plane plus the accumulated context
 * (intent slots and primitive-published facts).
 *
 * EVERY source is scalar-checked at runtime, not just the published-fact one
 * that is structured by declaration. `PolicyEvaluationFacts` is a plain type
 * the harness assembles - nothing validates its shape here - and a structured
 * value that slipped into a declared path would compare by reference in `eq`,
 * fall into the unorderable branch under every ordering comparator, and never
 * match an `in` member: three different silent not-fires. A non-scalar in a
 * value position is therefore the same miss everywhere, which is what makes
 * the enclosing rule unevaluable and synthesizes its blocker. Temporal-typed
 * paths additionally hold their values to the canonical byte forms, for the
 * same reason (`temporalByteMiss` above).
 */
export const resolveValue = (
  node: ValueNode,
  facts: PolicyEvaluationFacts,
  context: PolicyContextPlane,
): ValueResolution => {
  switch (node.kind) {
    case "constant":
      return { state: "resolved", value: node.value };
    case "evidence": {
      const snapshot = facts.evidence.get(node.evidenceKind);
      const ref = `evidence:${node.evidenceKind}:${node.path}`;
      if (snapshot === undefined) return missing(ref, node.evidenceKind);
      if (!Object.hasOwn(snapshot.values, node.path)) return missing(ref, node.evidenceKind);
      const value = snapshot.values[node.path];
      if (!isScalar(value)) return missing(`${ref} (non-scalar)`, node.evidenceKind);
      const declared = context.evidence.get(node.evidenceKind)?.paths.get(node.path)?.valueType;
      const badForm = temporalByteMiss(declared, value);
      if (badForm !== null) {
        return missing(`${ref} (non-canonical ${badForm} bytes)`, node.evidenceKind);
      }
      return { state: "resolved", value };
    }
    case "household_instruction": {
      const values = facts.instructions.get(node.instructionKind);
      const ref = `instruction:${node.instructionKind}:${node.path}`;
      if (values === undefined || !Object.hasOwn(values, node.path)) return missing(ref);
      const value = values[node.path];
      if (!isScalar(value)) return missing(`${ref} (non-scalar)`);
      const declared = context.instructions.get(node.instructionKind)?.paths.get(node.path)?.valueType;
      const badForm = temporalByteMiss(declared, value);
      if (badForm !== null) return missing(`${ref} (non-canonical ${badForm} bytes)`);
      return { state: "resolved", value };
    }
    case "context": {
      const key = node.key as string;
      const resolved = resolveContextKey(key, facts, context);
      if (!resolved.found) return missing(`context:${key}`);
      if (!isScalar(resolved.value)) return missing(`context:${key} (non-scalar)`);
      const declared = context.contextKeys.get(key)?.valueType;
      const badForm = temporalByteMiss(declared, resolved.value);
      if (badForm !== null) return missing(`context:${key} (non-canonical ${badForm} bytes)`);
      return { state: "resolved", value: resolved.value };
    }
  }
};

/** Presence semantics for `exists` - total, never unevaluable. */
const valueExists = (
  node: ValueNode,
  facts: PolicyEvaluationFacts,
  context: PolicyContextPlane,
): boolean => {
  switch (node.kind) {
    case "constant":
      return true;
    case "evidence": {
      const snapshot = facts.evidence.get(node.evidenceKind);
      return snapshot !== undefined && Object.hasOwn(snapshot.values, node.path);
    }
    case "household_instruction": {
      const values = facts.instructions.get(node.instructionKind);
      return values !== undefined && Object.hasOwn(values, node.path);
    }
    case "context":
      return resolveContextKey(node.key as string, facts, context).found;
  }
};

export type PredicateOutcome =
  | { readonly truth: "true" | "false" }
  | { readonly truth: "unevaluable"; readonly missing: readonly MissingValue[] };

const TRUE: PredicateOutcome = { truth: "true" };
const FALSE: PredicateOutcome = { truth: "false" };

const ofBoolean = (value: boolean): PredicateOutcome => (value ? TRUE : FALSE);

const unevaluable = (missingValues: readonly MissingValue[]): PredicateOutcome => ({
  truth: "unevaluable",
  missing: missingValues,
});

/**
 * Scalar comparison. Equality is strict scalar equality. Ordering is numeric
 * for numbers and codepoint-lexicographic for strings (canonical ISO date and
 * timestamp byte forms make that chronological); the load-time type check
 * restricts ordering comparators to those types, so a null/boolean/mixed
 * ordering reaching runtime is a fact-shape violation and lands unevaluable.
 */
const compareScalars = (
  comparator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  left: Scalar,
  right: Scalar,
): PredicateOutcome => {
  if (comparator === "eq") return ofBoolean(left === right);
  if (comparator === "neq") return ofBoolean(left !== right);
  if (typeof left === "number" && typeof right === "number") {
    if (comparator === "gt") return ofBoolean(left > right);
    if (comparator === "gte") return ofBoolean(left >= right);
    if (comparator === "lt") return ofBoolean(left < right);
    return ofBoolean(left <= right);
  }
  if (typeof left === "string" && typeof right === "string") {
    if (comparator === "gt") return ofBoolean(left > right);
    if (comparator === "gte") return ofBoolean(left >= right);
    if (comparator === "lt") return ofBoolean(left < right);
    return ofBoolean(left <= right);
  }
  return unevaluable([
    { ref: `compare:${comparator} over ${typeof left}/${typeof right} (unorderable)` },
  ]);
};

const memberOf = (value: Scalar, set: readonly PolicyConstant[]): boolean =>
  set.some((member) => member.value === value);

/**
 * Three-valued (Kleene) predicate evaluation: false dominates all, true
 * dominates any, and unevaluable propagates otherwise. Deterministic by
 * construction - no clock (asOf only), no iteration-order dependence (the
 * connectives are commutative in this algebra), no ambient reads.
 */
export const evaluatePredicate = (
  node: PredicateNode,
  facts: PolicyEvaluationFacts,
  context: PolicyContextPlane,
): PredicateOutcome => {
  switch (node.op) {
    case "all": {
      const missingValues: MissingValue[] = [];
      for (const child of node.nodes) {
        const outcome = evaluatePredicate(child, facts, context);
        if (outcome.truth === "false") return FALSE;
        if (outcome.truth === "unevaluable") missingValues.push(...outcome.missing);
      }
      return missingValues.length > 0 ? unevaluable(missingValues) : TRUE;
    }
    case "any": {
      const missingValues: MissingValue[] = [];
      for (const child of node.nodes) {
        const outcome = evaluatePredicate(child, facts, context);
        if (outcome.truth === "true") return TRUE;
        if (outcome.truth === "unevaluable") missingValues.push(...outcome.missing);
      }
      return missingValues.length > 0 ? unevaluable(missingValues) : FALSE;
    }
    case "not": {
      const outcome = evaluatePredicate(node.node, facts, context);
      if (outcome.truth === "unevaluable") return outcome;
      return outcome.truth === "true" ? FALSE : TRUE;
    }
    case "exists":
      return ofBoolean(valueExists(node.value, facts, context));
    case "is_fresh": {
      const snapshot = facts.evidence.get(node.evidenceKind);
      if (snapshot === undefined) return FALSE;
      const observedAt = epochMillisOf(snapshot.observedAt);
      const asOf = epochMillisOf(facts.asOf);
      if (observedAt === null || asOf === null) {
        return unevaluable([
          { ref: `is_fresh:${node.evidenceKind} (non-canonical instant)`, evidenceKind: node.evidenceKind },
        ]);
      }
      // An observation the bundle claims to postdate its own asOf has a
      // NEGATIVE age, which every window admits - impossible data would read as
      // maximally fresh and a staleness guard would silently not fire. Age is
      // undefined here, so the honest answer is the same unevaluable every
      // other content failure gets, and the rule synthesizes its blocker.
      if (asOf - observedAt < 0) {
        return unevaluable([
          {
            ref: `is_fresh:${node.evidenceKind} (observation after asOf)`,
            evidenceKind: node.evidenceKind,
          },
        ]);
      }
      const window = durationToMillis(node.maxAge);
      // Load check 3 refuses calendar-granular windows; reaching one here means
      // the loader was bypassed, and the honest outcome is unevaluable.
      if (!window.ok) {
        return unevaluable([{ ref: `is_fresh:${node.evidenceKind} (${window.refusal.reason})` }]);
      }
      return ofBoolean(asOf - observedAt <= window.millis);
    }
    case "compare": {
      const left = resolveValue(node.left, facts, context);
      const right = resolveValue(node.right, facts, context);
      if (left.state === "missing" || right.state === "missing") {
        return unevaluable([
          ...(left.state === "missing" ? left.missing : []),
          ...(right.state === "missing" ? right.missing : []),
        ]);
      }
      return compareScalars(node.comparator, left.value, right.value);
    }
    case "in": {
      const value = resolveValue(node.value, facts, context);
      if (value.state === "missing") return unevaluable(value.missing);
      return ofBoolean(memberOf(value.value, node.set));
    }
  }
};
