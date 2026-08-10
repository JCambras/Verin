/**
 * The PREDICATE-side closure and type checks behind `loadPolicy` (prompt 9,
 * ADR-0053; ratified design §3.2 checks 2-4), plus the walks checks 6-7 rest
 * on and the value-type resolver both halves share. Split from load.ts under
 * the per-file ceiling, and split again from load-effects.ts (which holds every
 * check that reads an effect) along the same ceiling. Every lookup goes
 * through the pinned registries' Maps - a `__proto__` path is simply unknown,
 * and constants are inert data the checks validate but never interpret.
 */
import type {
  PolicyEffect,
  PolicyRule,
  PredicateNode,
  ValueNode,
} from "@contracts/decision-core/policy";
import {
  ORDERABLE_VALUE_TYPES,
  type PolicyRegistries,
  type PolicyValueType,
} from "./registries";
import { durationToMillis, isCanonicalDate, isCanonicalTimestamp } from "./temporal";

export type PolicyLoadIssueCode =
  | "grammar-parse"
  | "unknown-grammar-version"
  | "reserved-op-not-evaluable"
  | "primitive-set-version-mismatch"
  | "unknown-evidence-kind"
  | "unknown-evidence-path"
  | "unknown-instruction-kind"
  | "unknown-instruction-path"
  | "unknown-context-key"
  | "unknown-primitive"
  | "unknown-parameter"
  | "key-shaping-parameter-not-writable"
  | "unknown-strategy"
  | "unknown-approval-template"
  | "template-kind-mismatch"
  | "reserved-reason-namespace"
  | "type-mismatch"
  | "non-comparable-value"
  | "unorderable-comparison"
  | "non-integer-number-constant"
  | "duplicate-in-member"
  | "duration-granularity-unsupported"
  | "parameter-constant-invalid"
  | "effect-conflict"
  | "predicate-too-complex"
  | "configuration-rule-reads-primitive-key"
  | "self-conflict";

export type PolicyLoadIssue = {
  readonly code: PolicyLoadIssueCode;
  readonly message: string;
  readonly ruleId?: string;
};

export type IssueSink = (issue: PolicyLoadIssue) => void;

const walkPredicate = (node: PredicateNode, visit: (node: PredicateNode) => void): void => {
  visit(node);
  if (node.op === "all" || node.op === "any") {
    for (const child of node.nodes) walkPredicate(child, visit);
  } else if (node.op === "not") {
    walkPredicate(node.node, visit);
  }
};

/** Constant scalars type as the loader sees them; null pairs only with eq/neq. */
type ResolvedType = PolicyValueType | "null";

/** A resolved operand plus the one fact the agreement rule turns on: is it a constant? */
type ResolvedOperand = { readonly type: ResolvedType; readonly isConstant: boolean };

/**
 * Resolves a value node's declared type against the registries, recording
 * closure issues as it goes. Returns null when the reference itself failed
 * (the closure issue already names it, so type checking stops for that node).
 * Shared with the effect-side checks in load-effects.ts, so a `set_parameter`
 * value and a `compare` operand are typed by ONE resolver.
 */
export const resolveValueType = (
  node: ValueNode,
  registries: PolicyRegistries,
  ruleId: string,
  report: IssueSink,
): ResolvedType | null => {
  switch (node.kind) {
    case "constant": {
      const value = node.value;
      if (value === null) return "null";
      if (typeof value === "boolean") return "boolean";
      if (typeof value === "string") return "string";
      if (!Number.isSafeInteger(value)) {
        report({
          code: "non-integer-number-constant",
          ruleId,
          message: `rule ${ruleId}: numeric constant ${value} is not a safe integer (monetary values are integers in minor units)`,
        });
        return null;
      }
      return "integer";
    }
    case "evidence": {
      const kind = registries.evidence.get(node.evidenceKind);
      if (kind === undefined) {
        report({
          code: "unknown-evidence-kind",
          ruleId,
          message: `rule ${ruleId}: unknown evidence kind '${node.evidenceKind}'`,
        });
        return null;
      }
      const path = kind.paths.get(node.path);
      if (path === undefined) {
        report({
          code: "unknown-evidence-path",
          ruleId,
          message: `rule ${ruleId}: evidence kind '${node.evidenceKind}' declares no path '${node.path}'`,
        });
        return null;
      }
      return path.valueType;
    }
    case "household_instruction": {
      const kind = registries.instructions.get(node.instructionKind);
      if (kind === undefined) {
        report({
          code: "unknown-instruction-kind",
          ruleId,
          message: `rule ${ruleId}: unknown instruction kind '${node.instructionKind}'`,
        });
        return null;
      }
      const path = kind.paths.get(node.path);
      if (path === undefined) {
        report({
          code: "unknown-instruction-path",
          ruleId,
          message: `rule ${ruleId}: instruction kind '${node.instructionKind}' declares no path '${node.path}'`,
        });
        return null;
      }
      return path.valueType;
    }
    case "context": {
      const descriptor = registries.contextKeys.get(node.key);
      if (descriptor === undefined) {
        report({
          code: "unknown-context-key",
          ruleId,
          message: `rule ${ruleId}: unknown context key '${node.key}'`,
        });
        return null;
      }
      return descriptor.valueType;
    }
  }
};

/**
 * A string CONSTANT agrees with a date/timestamp-typed reference (its canonical
 * byte form is checked immediately after, by `constantMatchesTemporalForm`). A
 * non-constant `string` reference never widens into a temporal type: nothing
 * proves its bytes are canonical, so a lexicographic ordering over it would not
 * be chronological - and the canonical-form guard has no constant to inspect.
 */
const typesAgree = (a: ResolvedOperand, b: ResolvedOperand): boolean => {
  if (a.type === b.type) return true;
  const widensToTemporal = (from: ResolvedOperand, to: ResolvedOperand): boolean =>
    from.isConstant &&
    from.type === "string" &&
    (to.type === "iso-date" || to.type === "iso-timestamp");
  return widensToTemporal(a, b) || widensToTemporal(b, a);
};

const checkComparisonOperand = (
  resolved: ResolvedType | null,
  ruleId: string,
  report: IssueSink,
): void => {
  if (resolved === "reference" || resolved === "structured") {
    report({
      code: "non-comparable-value",
      ruleId,
      message: `rule ${ruleId}: a ${resolved} value is platform-consumed and never legal in a compare/in position`,
    });
  }
};

const constantMatchesTemporalForm = (node: ValueNode, expected: ResolvedType): boolean => {
  if (node.kind !== "constant" || typeof node.value !== "string") return true;
  if (expected === "iso-date") return isCanonicalDate(node.value);
  if (expected === "iso-timestamp") return isCanonicalTimestamp(node.value);
  return true;
};

// ── The per-rule closure + type walk (checks 2-4) ───────────────────────────────

export const checkPredicate = (
  rule: PolicyRule,
  registries: PolicyRegistries,
  report: IssueSink,
): void => {
  walkPredicate(rule.when, (node) => {
    switch (node.op) {
      case "exists":
        resolveValueType(node.value, registries, rule.id, report);
        return;
      case "is_fresh": {
        if (!registries.evidence.has(node.evidenceKind)) {
          report({
            code: "unknown-evidence-kind",
            ruleId: rule.id,
            message: `rule ${rule.id}: is_fresh references unknown evidence kind '${node.evidenceKind}'`,
          });
        }
        const window = durationToMillis(node.maxAge);
        if (!window.ok) {
          report({
            code: "duration-granularity-unsupported",
            ruleId: rule.id,
            message: `rule ${rule.id}: is_fresh window '${node.maxAge}' refused (${window.refusal.reason}); freshness windows are day-or-finer with integer components`,
          });
        }
        return;
      }
      case "compare": {
        const left = resolveValueType(node.left, registries, rule.id, report);
        const right = resolveValueType(node.right, registries, rule.id, report);
        checkComparisonOperand(left, rule.id, report);
        checkComparisonOperand(right, rule.id, report);
        if (left === null || right === null) return;
        if (left === "reference" || left === "structured" || right === "reference" || right === "structured") return;
        const ordering = node.comparator !== "eq" && node.comparator !== "neq";
        if (!ordering && (left === "null" || right === "null")) return;
        const leftOperand: ResolvedOperand = { type: left, isConstant: node.left.kind === "constant" };
        const rightOperand: ResolvedOperand = { type: right, isConstant: node.right.kind === "constant" };
        if (!typesAgree(leftOperand, rightOperand)) {
          report({
            code: "type-mismatch",
            ruleId: rule.id,
            message: `rule ${rule.id}: compare(${node.comparator}) operands disagree (${left} vs ${right})`,
          });
          return;
        }
        if (
          !constantMatchesTemporalForm(node.left, right) ||
          !constantMatchesTemporalForm(node.right, left)
        ) {
          report({
            code: "type-mismatch",
            ruleId: rule.id,
            message: `rule ${rule.id}: compare(${node.comparator}) string constant is not in the canonical temporal byte form its operand declares`,
          });
          return;
        }
        if (ordering) {
          // Types already agree here, so the only orderable pairs left are
          // integer/integer and temporal pairs (where a plain-string side is a
          // canonical-form constant). Two plain strings have no ratified order.
          const bothPlainStrings = left === "string" && right === "string";
          const eitherUnorderable = [left, right].some(
            (type) => type !== "string" && !ORDERABLE_VALUE_TYPES.has(type as PolicyValueType),
          );
          if (bothPlainStrings || eitherUnorderable) {
            report({
              code: "unorderable-comparison",
              ruleId: rule.id,
              message: `rule ${rule.id}: ordering comparator '${node.comparator}' over ${left}/${right}; ordering runs only over integer, iso-date, or iso-timestamp values`,
            });
          }
        }
        return;
      }
      case "in": {
        const valueType = resolveValueType(node.value, registries, rule.id, report);
        checkComparisonOperand(valueType, rule.id, report);
        const memberValues = node.set.map((member) => member.value);
        if (new Set(memberValues).size !== memberValues.length) {
          report({
            code: "duplicate-in-member",
            ruleId: rule.id,
            message: `rule ${rule.id}: 'in' set contains duplicate members`,
          });
        }
        const memberTypes = new Set(node.set.map((member) => typeof member.value));
        if (memberTypes.size > 1) {
          report({
            code: "type-mismatch",
            ruleId: rule.id,
            message: `rule ${rule.id}: 'in' set members are not homogeneous`,
          });
          return;
        }
        if (valueType === null || valueType === "reference" || valueType === "structured") return;
        const valueOperand: ResolvedOperand = {
          type: valueType,
          isConstant: node.value.kind === "constant",
        };
        for (const member of node.set) {
          const memberType = resolveValueType(member, registries, rule.id, report);
          if (memberType === null) continue;
          if (
            !typesAgree(valueOperand, { type: memberType, isConstant: true }) ||
            !constantMatchesTemporalForm(member, valueType)
          ) {
            report({
              code: "type-mismatch",
              ruleId: rule.id,
              message: `rule ${rule.id}: 'in' member ${JSON.stringify(member.value)} does not agree with the ${valueType} value`,
            });
            return;
          }
        }
        return;
      }
      default:
        return;
    }
  });
};

// ── Walks that checks 6-7 and phase classification rest on ──────────────────────

export const isConfigEffect = (effect: PolicyEffect): boolean =>
  effect.kind === "set_parameter" || effect.kind === "select_candidate";

/** Every primitive-published context key a rule reads (when + set_parameter values). */
export const primitiveKeyReads = (
  rule: PolicyRule,
  registries: PolicyRegistries,
): readonly string[] => {
  const reads: string[] = [];
  const visitValue = (value: ValueNode): void => {
    if (value.kind !== "context") return;
    const descriptor = registries.contextKeys.get(value.key);
    if (descriptor !== undefined && descriptor.origin.source === "primitive") {
      reads.push(value.key);
    }
  };
  walkPredicate(rule.when, (node) => {
    if (node.op === "exists") visitValue(node.value);
    if (node.op === "compare") {
      visitValue(node.left);
      visitValue(node.right);
    }
    if (node.op === "in") visitValue(node.value);
  });
  for (const effect of rule.effects) {
    if (effect.kind === "set_parameter") visitValue(effect.value);
  }
  return reads;
};

export type ConflictTarget = { readonly key: string; readonly description: string };

export const effectTargets = (rule: PolicyRule): readonly ConflictTarget[] =>
  rule.effects.flatMap((effect) => {
    if (effect.kind === "set_parameter") {
      return [
        {
          key: `set_parameter:${effect.primitiveId}:${effect.parameter}`,
          description: `set_parameter on (${effect.primitiveId}, ${effect.parameter})`,
        },
      ];
    }
    if (effect.kind === "select_candidate") {
      return [
        {
          key: `select_candidate:${effect.primitiveId}`,
          description: `select_candidate on ${effect.primitiveId}`,
        },
      ];
    }
    return [];
  });
