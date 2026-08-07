/**
 * Load-time effect-conflict rejection: the conservative syntactic disjointness
 * prover (v3 §6.1 normative rule; ratified design §3.4; captain ruling: when
 * disjointness cannot be proven, REJECT rather than let behavior depend on
 * rule order).
 *
 * Two rules that both write `set_parameter` on one `(primitiveId, parameter)`,
 * or both `select_candidate` on one `primitiveId`, are legal only if their
 * predicates PROVABLY cannot hold together. The prover is sound and
 * deliberately incomplete: it normalizes each `when` to bounded DNF over
 * atomic literals and demands that every cross-rule conjunction pair carry a
 * contradiction on some shared variable. An admitted policy therefore has a
 * single writer per target on EVERY input; a clever-but-safe pair the prover
 * cannot separate is rejected with a named reason - an authoring-time event
 * with a visible fix, where order-resolved conflict would be silent judgment
 * corruption.
 */
import type { Scalar } from "@contracts/decision-core/decision";
import type {
  Comparator,
  PolicyConstant,
  PredicateNode,
  ValueNode,
} from "@contracts/decision-core/policy";
import { durationToMillis } from "./temporal";

/** The DNF expansion cap: exceeding it is a load error, never a silent pass. */
export const DNF_DISJUNCT_CAP = 64;

/**
 * Ordering atoms canonicalize onto two base comparators with a polarity, so a
 * negated `gt` and a stated `lte` land on the SAME atom and can contradict:
 * gt/lte -> base "gt", gte/lt -> base "gte".
 */
type Literal =
  | { readonly kind: "exists"; readonly varKey: string; readonly positive: boolean }
  | {
      readonly kind: "fresh";
      readonly varKey: string;
      readonly withinMillis: number;
      readonly positive: boolean;
    }
  | { readonly kind: "eq"; readonly varKey: string; readonly constant: Scalar; readonly positive: boolean }
  | {
      readonly kind: "order";
      readonly varKey: string;
      readonly base: "gt" | "gte";
      readonly constant: number | string;
      readonly positive: boolean;
    }
  | {
      readonly kind: "in";
      readonly varKey: string;
      readonly set: readonly Scalar[];
      readonly positive: boolean;
    }
  | { readonly kind: "opaque"; readonly varKey: string; readonly positive: boolean };

type Conjunction = readonly Literal[];
/** [] is FALSE; [[]] is TRUE (one conjunction with no constraints). */
type Dnf = readonly Conjunction[];

export type DnfResult =
  | { readonly ok: true; readonly dnf: Dnf }
  | { readonly ok: false; readonly reason: "too-complex" };

const valueKey = (node: ValueNode): string => {
  switch (node.kind) {
    case "constant":
      return `constant:${JSON.stringify(node.value)}`;
    case "evidence":
      return `evidence:${node.evidenceKind}:${node.path}`;
    case "household_instruction":
      return `instruction:${node.instructionKind}:${node.path}`;
    case "context":
      return `context:${node.key}`;
  }
};

const foldScalarCompare = (comparator: Comparator, left: Scalar, right: Scalar): boolean => {
  switch (comparator) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return typeof left === typeof right && (left as number | string) > (right as number | string);
    case "gte":
      return typeof left === typeof right && (left as number | string) >= (right as number | string);
    case "lt":
      return typeof left === typeof right && (left as number | string) < (right as number | string);
    case "lte":
      return typeof left === typeof right && (left as number | string) <= (right as number | string);
  }
};

const TRUE_DNF: Dnf = [[]];
const FALSE_DNF: Dnf = [];

const literalDnf = (literal: Literal): Dnf => [[literal]];
const booleanDnf = (value: boolean): Dnf => (value ? TRUE_DNF : FALSE_DNF);

/** Swaps operand roles: `c <op> x` is `x <mirror(op)> c`. */
const mirror = (comparator: Comparator): Comparator => {
  switch (comparator) {
    case "gt":
      return "lt";
    case "gte":
      return "lte";
    case "lt":
      return "gt";
    case "lte":
      return "gte";
    default:
      return comparator;
  }
};

const compareLiteral = (
  comparator: Comparator,
  varNode: ValueNode,
  constant: Scalar,
  negated: boolean,
): Literal => {
  const varKey = valueKey(varNode);
  switch (comparator) {
    case "eq":
      return { kind: "eq", varKey, constant, positive: !negated };
    case "neq":
      return { kind: "eq", varKey, constant, positive: negated };
    case "gt":
    case "lte": {
      if (typeof constant !== "number" && typeof constant !== "string") {
        return { kind: "opaque", varKey: `${varKey}:${comparator}:${JSON.stringify(constant)}`, positive: !negated };
      }
      const stated = comparator === "gt";
      return { kind: "order", varKey, base: "gt", constant, positive: negated ? !stated : stated };
    }
    case "gte":
    case "lt": {
      if (typeof constant !== "number" && typeof constant !== "string") {
        return { kind: "opaque", varKey: `${varKey}:${comparator}:${JSON.stringify(constant)}`, positive: !negated };
      }
      const stated = comparator === "gte";
      return { kind: "order", varKey, base: "gte", constant, positive: negated ? !stated : stated };
    }
  }
};

/** A var-vs-var compare canonicalized to an opaque atom whose negation pairs up. */
const opaqueCompare = (
  comparator: Comparator,
  left: ValueNode,
  right: ValueNode,
  negated: boolean,
): Literal => {
  const [keyA, keyB] = [valueKey(left), valueKey(right)];
  const swap = keyA > keyB;
  const canonical = swap ? mirror(comparator) : comparator;
  const operands = swap ? `${keyB}|${keyA}` : `${keyA}|${keyB}`;
  // eq/neq and gt/lte and gte/lt are complement pairs sharing one atom id.
  const table: Record<Comparator, { readonly id: string; readonly positive: boolean }> = {
    eq: { id: `eq:${operands}`, positive: true },
    neq: { id: `eq:${operands}`, positive: false },
    gt: { id: `gt:${operands}`, positive: true },
    lte: { id: `gt:${operands}`, positive: false },
    gte: { id: `gte:${operands}`, positive: true },
    lt: { id: `gte:${operands}`, positive: false },
  };
  const entry = table[canonical];
  return { kind: "opaque", varKey: `compare:${entry.id}`, positive: negated ? !entry.positive : entry.positive };
};

const conjoin = (parts: readonly Dnf[]): Dnf | null => {
  let product: Dnf = TRUE_DNF;
  for (const part of parts) {
    const next: Conjunction[] = [];
    for (const a of product) {
      for (const b of part) {
        next.push([...a, ...b]);
        if (next.length > DNF_DISJUNCT_CAP) return null;
      }
    }
    product = next;
  }
  return product;
};

const disjoin = (parts: readonly Dnf[]): Dnf | null => {
  const all = parts.flat();
  return all.length > DNF_DISJUNCT_CAP ? null : all;
};

const nodeDnf = (node: PredicateNode, negated: boolean): Dnf | null => {
  switch (node.op) {
    case "all": {
      const children = node.nodes.map((child) => nodeDnf(child, negated));
      if (children.some((child) => child === null)) return null;
      return negated ? disjoin(children as Dnf[]) : conjoin(children as Dnf[]);
    }
    case "any": {
      const children = node.nodes.map((child) => nodeDnf(child, negated));
      if (children.some((child) => child === null)) return null;
      return negated ? conjoin(children as Dnf[]) : disjoin(children as Dnf[]);
    }
    case "not":
      return nodeDnf(node.node, !negated);
    case "exists":
      return node.value.kind === "constant"
        ? booleanDnf(!negated)
        : literalDnf({ kind: "exists", varKey: valueKey(node.value), positive: !negated });
    case "is_fresh": {
      const window = durationToMillis(node.maxAge);
      // The loader refuses calendar-granular windows before proving; an
      // unconvertible window degrades to an opaque atom, never a wrong interval.
      if (!window.ok) {
        return literalDnf({
          kind: "opaque",
          varKey: `fresh:${node.evidenceKind}:${node.maxAge}`,
          positive: !negated,
        });
      }
      return literalDnf({
        kind: "fresh",
        varKey: `fresh:${node.evidenceKind}`,
        withinMillis: window.millis,
        positive: !negated,
      });
    }
    case "compare": {
      const leftConstant = node.left.kind === "constant";
      const rightConstant = node.right.kind === "constant";
      if (leftConstant && rightConstant) {
        const folded = foldScalarCompare(
          node.comparator,
          (node.left as PolicyConstant).value,
          (node.right as PolicyConstant).value,
        );
        return booleanDnf(negated ? !folded : folded);
      }
      if (rightConstant) {
        return literalDnf(
          compareLiteral(node.comparator, node.left, (node.right as PolicyConstant).value, negated),
        );
      }
      if (leftConstant) {
        return literalDnf(
          compareLiteral(mirror(node.comparator), node.right, (node.left as PolicyConstant).value, negated),
        );
      }
      return literalDnf(opaqueCompare(node.comparator, node.left, node.right, negated));
    }
    case "in": {
      if (node.value.kind === "constant") {
        const constant = node.value.value;
        const contained = node.set.some((entry) => entry.value === constant);
        return booleanDnf(negated ? !contained : contained);
      }
      return literalDnf({
        kind: "in",
        varKey: valueKey(node.value),
        set: node.set.map((entry) => entry.value),
        positive: !negated,
      });
    }
  }
};

export const predicateDnf = (node: PredicateNode): DnfResult => {
  const dnf = nodeDnf(node, false);
  return dnf === null ? { ok: false, reason: "too-complex" } : { ok: true, dnf };
};

// ── Pairwise contradiction ──────────────────────────────────────────────────────

const orderExcludes = (literal: Extract<Literal, { kind: "order" }>, value: Scalar): boolean => {
  if (typeof value !== typeof literal.constant) return false;
  const v = value as number | string;
  if (literal.base === "gt") {
    return literal.positive ? v <= literal.constant : v > literal.constant;
  }
  return literal.positive ? v < literal.constant : v >= literal.constant;
};

/** True iff the two literals (same var) provably cannot hold together. */
const contradicts = (a: Literal, b: Literal): boolean => {
  if (a.varKey !== b.varKey) return false;
  if (a.kind === "exists" && b.kind === "exists") return a.positive !== b.positive;
  if (a.kind === "opaque" && b.kind === "opaque") return a.positive !== b.positive;
  if (a.kind === "fresh" && b.kind === "fresh") {
    if (a.positive === b.positive) return false;
    const within = a.positive ? a : b;
    const beyond = a.positive ? b : a;
    // age <= within AND age > beyond is empty iff within <= beyond.
    return within.withinMillis <= beyond.withinMillis;
  }
  if (a.kind === "eq" && b.kind === "eq") {
    if (a.positive && b.positive) return a.constant !== b.constant;
    if (a.positive !== b.positive) return a.constant === b.constant;
    return false;
  }
  if (a.kind === "eq" && b.kind === "in") return eqInContradiction(a, b);
  if (a.kind === "in" && b.kind === "eq") return eqInContradiction(b, a);
  if (a.kind === "in" && b.kind === "in") {
    if (a.positive && b.positive) {
      return a.set.every((value) => !b.set.includes(value));
    }
    const inside = a.positive ? a : b.positive ? b : null;
    const outside = a.positive ? (b.positive ? null : b) : b.positive ? a : null;
    if (inside === null || outside === null) return false;
    return inside.set.every((value) => outside.set.includes(value));
  }
  if (a.kind === "order" && b.kind === "order") {
    if (a.positive === b.positive && a.base === b.base) return false;
    // Try both roles: a lower bound against an upper bound.
    return orderPairEmpty(a, b) || orderPairEmpty(b, a);
  }
  if (a.kind === "order" && b.kind === "eq" && b.positive) return orderExcludes(a, b.constant);
  if (a.kind === "eq" && a.positive && b.kind === "order") return orderExcludes(b, a.constant);
  if (a.kind === "order" && b.kind === "in" && b.positive) {
    return b.set.every((value) => orderExcludes(a, value));
  }
  if (a.kind === "in" && a.positive && b.kind === "order") {
    return a.set.every((value) => orderExcludes(b, value));
  }
  return false;
};

const eqInContradiction = (
  eq: Extract<Literal, { kind: "eq" }>,
  membership: Extract<Literal, { kind: "in" }>,
): boolean => {
  if (!eq.positive) return false;
  const contained = membership.set.includes(eq.constant);
  return membership.positive ? !contained : contained;
};

/** Lower bound `low` (positive gt/gte) against upper bound `high` (negative). */
const orderPairEmpty = (low: Literal, high: Literal): boolean => {
  if (low.kind !== "order" || high.kind !== "order") return false;
  if (!low.positive || high.positive) return false;
  if (typeof low.constant !== typeof high.constant) return false;
  // low: x > c (base gt) or x >= c (base gte); high: x <= d (base gt, negative)
  // or x < d (base gte, negative). Empty iff the bounds cross.
  const strictLow = low.base === "gt";
  const strictHigh = high.base === "gte";
  if (low.constant > high.constant) return true;
  if (low.constant === high.constant) return strictLow || strictHigh;
  return false;
};

export type DisjointnessVerdict =
  | { readonly disjoint: true }
  | { readonly disjoint: false; readonly explanation: string };

/**
 * Both DNFs are disjoint iff EVERY cross pair of conjunctions carries a
 * contradiction on some shared variable. The failure explanation names the
 * first pair no shared variable separates - the named fix the rejection owes
 * its author.
 */
export const proveDisjoint = (a: Dnf, b: Dnf): DisjointnessVerdict => {
  for (const [indexA, conjunctionA] of a.entries()) {
    for (const [indexB, conjunctionB] of b.entries()) {
      const separated = conjunctionA.some((literalA) =>
        conjunctionB.some((literalB) => contradicts(literalA, literalB)),
      );
      if (!separated) {
        const varsA = [...new Set(conjunctionA.map((literal) => literal.varKey))].sort();
        const varsB = [...new Set(conjunctionB.map((literal) => literal.varKey))].sort();
        const shared = varsA.filter((varName) => varsB.includes(varName));
        return {
          disjoint: false,
          explanation:
            shared.length === 0
              ? `branches ${indexA} and ${indexB} share no variable, so both can hold on one input`
              : `branches ${indexA} and ${indexB} share [${shared.join(", ")}] but no contradictory constraints`,
        };
      }
    }
  }
  return { disjoint: true };
};
