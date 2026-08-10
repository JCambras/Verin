/**
 * The EFFECT half of load check 2 (reference closure) plus the effect-side type
 * checks of check 3 (prompt 9, ADR-0053; ratified design §3.2). Split from
 * load-checks.ts under the per-file ceiling along the seam D-183 named: every
 * check here reads an effect, so check 2's reserved-namespace half - which the
 * ceiling had stranded in load.ts - is reunited with the walk it belongs to and
 * `rule.effects` is iterated once instead of twice.
 *
 * Every lookup goes through the pinned registries' Maps, so a `__proto__`
 * primitive or template is simply unknown, and constants stay inert data.
 */
import type { PolicyEffect, PolicyRule } from "@contracts/decision-core/policy";
import {
  parameterConstantAdmissible,
  parameterSchemaKeys,
} from "@contracts/primitives/values";
import type { PolicyRegistries } from "./registries";
import { resolveValueType, type IssueSink } from "./load-checks";
import { RESERVED_REASON_CODE_PREFIXES } from "./trace";

/** The authored reason code an effect carries, if it carries one at all. */
const authoredReasonCode = (effect: PolicyEffect): string | null =>
  effect.kind === "block"
    ? effect.blockerCode
    : effect.kind === "prohibit"
      ? effect.prohibitionCode
      : null;

/**
 * Check 2, namespace half: `ReasonCodeSchema` is an opaque brand with no shape
 * to refuse a collision at parse time, and the evaluator keys its blockers on
 * the code alone - so an authored code inside a synthesized namespace would
 * merge with a platform entry instead of standing beside it. Ownership is
 * therefore proven at admission, against the ONE prefix list the evaluator's
 * synthesizers are built from.
 */
const checkReservedReasonNamespace = (
  rule: PolicyRule,
  effect: PolicyEffect,
  report: IssueSink,
): void => {
  const authored = authoredReasonCode(effect);
  if (authored === null) return;
  const reserved = RESERVED_REASON_CODE_PREFIXES.find((prefix) => authored.startsWith(prefix));
  if (reserved !== undefined) {
    report({
      code: "reserved-reason-namespace",
      ruleId: rule.id,
      message: `rule ${rule.id}: reason code '${authored}' is inside the reserved '${reserved}' namespace the evaluator synthesizes its fail-closed blockers under; choose a code outside it`,
    });
  }
};

/**
 * Check 2, writability half (ruling p9-key-shaping-params): a primitive's
 * published context keys are DERIVED from its configured parameters, once, at
 * load - `deriveContextKeys` closes the vocabulary over exactly those names.
 * A `set_parameter` on a parameter the primitive's `publishedKeys` reads would
 * therefore run it under a key namespace the loader never closed over: every
 * rule reading the derived key would miss and land unevaluable, the
 * published-key escape check would compare the shifted call against itself, and
 * two invocations that differ only in that parameter would collapse onto one
 * identity - a duplicate-invocation or published-key-collision REFUSAL driven by
 * admissible policy content, which the module contract reserves for structural
 * impossibilities. The catalog declares the shaping names; refusing here is what
 * keeps the derived registry and the runtime key space the same vocabulary.
 */
const checkKeyShapingWrite = (
  rule: PolicyRule,
  primitiveId: string,
  parameter: string,
  keyShapingParameters: readonly string[],
  report: IssueSink,
): boolean => {
  if (!keyShapingParameters.includes(parameter)) return false;
  report({
    code: "key-shaping-parameter-not-writable",
    ruleId: rule.id,
    message: `rule ${rule.id}: '${primitiveId}.${parameter}' shapes the context keys '${primitiveId}' publishes, and the key vocabulary is derived from the CONFIGURED value at load; policy may not write it`,
  });
  return true;
};

export const checkEffects = (
  rule: PolicyRule,
  registries: PolicyRegistries,
  report: IssueSink,
): void => {
  for (const effect of rule.effects) {
    checkReservedReasonNamespace(rule, effect, report);
    switch (effect.kind) {
      case "require_evidence": {
        if (!registries.evidence.has(effect.evidenceKind)) {
          report({
            code: "unknown-evidence-kind",
            ruleId: rule.id,
            message: `rule ${rule.id}: require_evidence references unknown evidence kind '${effect.evidenceKind}'`,
          });
        }
        if (effect.reviewTemplateId !== undefined) {
          const template = registries.approvalTemplates.get(effect.reviewTemplateId);
          if (template === undefined) {
            report({
              code: "unknown-approval-template",
              ruleId: rule.id,
              message: `rule ${rule.id}: unknown review template '${effect.reviewTemplateId}'`,
            });
          } else if (template.kind !== "specialist_review") {
            report({
              code: "template-kind-mismatch",
              ruleId: rule.id,
              message: `rule ${rule.id}: review template '${effect.reviewTemplateId}' is kind '${template.kind}', not specialist_review`,
            });
          }
        }
        break;
      }
      case "require_approval": {
        if (!registries.approvalTemplates.has(effect.templateId)) {
          report({
            code: "unknown-approval-template",
            ruleId: rule.id,
            message: `rule ${rule.id}: unknown approval template '${effect.templateId}'`,
          });
        }
        break;
      }
      case "block": {
        for (const kind of effect.resolvingEvidenceKinds) {
          if (!registries.evidence.has(kind)) {
            report({
              code: "unknown-evidence-kind",
              ruleId: rule.id,
              message: `rule ${rule.id}: block resolving evidence kind '${kind}' is unknown`,
            });
          }
        }
        break;
      }
      case "set_parameter": {
        const primitive = registries.primitives.get(effect.primitiveId);
        if (primitive === undefined) {
          report({
            code: "unknown-primitive",
            ruleId: rule.id,
            message: `rule ${rule.id}: unknown primitive '${effect.primitiveId}'`,
          });
          break;
        }
        if (!parameterSchemaKeys(primitive.parameterSchema).has(effect.parameter)) {
          report({
            code: "unknown-parameter",
            ruleId: rule.id,
            message: `rule ${rule.id}: primitive '${effect.primitiveId}' declares no parameter '${effect.parameter}'`,
          });
          break;
        }
        if (
          checkKeyShapingWrite(
            rule,
            effect.primitiveId,
            effect.parameter,
            primitive.keyShapingParameters,
            report,
          )
        ) {
          break;
        }
        if (effect.value.kind === "constant") {
          if (!parameterConstantAdmissible(primitive.parameterSchema, effect.parameter, effect.value.value)) {
            report({
              code: "parameter-constant-invalid",
              ruleId: rule.id,
              message: `rule ${rule.id}: constant ${JSON.stringify(effect.value.value)} is not admissible for '${effect.primitiveId}.${effect.parameter}'`,
            });
          }
        } else {
          const type = resolveValueType(effect.value, registries, rule.id, report);
          if (type === "reference" || type === "structured") {
            report({
              code: "non-comparable-value",
              ruleId: rule.id,
              message: `rule ${rule.id}: a ${type} value cannot feed set_parameter '${effect.primitiveId}.${effect.parameter}'`,
            });
          }
        }
        break;
      }
      case "select_candidate": {
        const primitive = registries.primitives.get(effect.primitiveId);
        if (primitive === undefined) {
          report({
            code: "unknown-primitive",
            ruleId: rule.id,
            message: `rule ${rule.id}: unknown primitive '${effect.primitiveId}'`,
          });
          break;
        }
        if (!primitive.allowedStrategies.includes(effect.strategy)) {
          report({
            code: "unknown-strategy",
            ruleId: rule.id,
            message: `rule ${rule.id}: strategy '${effect.strategy}' is not in '${effect.primitiveId}' allowed strategies [${primitive.allowedStrategies.join(", ")}]`,
          });
        }
        break;
      }
      case "prohibit":
        break;
    }
  }
};
