/**
 * The typed evaluation trace (prompt 9, ADR-0053; v3 invariant 12's shape: the
 * trace IS the output - explanation and DecisionResult derive from it, never
 * from a post-hoc narrative). Every collection is canonically sorted and every
 * value is a plain JSON shape, so the whole trace round-trips through the
 * canonical serializer and hashes replay-stably.
 */
import type { Scalar } from "@contracts/decision-core/decision";
import type { PublishedFactRecord } from "@contracts/primitives/values";
import type { PolicyGrammarVersion } from "@contracts/decision-core/policy";

/** Codepoint comparison - THE canonical order every trace collection uses. */
export const compareCanonical = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Dedupe + canonical sort: how every id/kind collection enters the trace. */
export const sortUniqueStrings = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort(compareCanonical);

export type RuleOutcome = {
  readonly ruleId: string;
  readonly phase: "configuration" | "evaluation";
  readonly outcome: "fired" | "not-fired" | "unevaluable";
  /** Present exactly when unevaluable: the value refs that failed to resolve. */
  readonly missing?: readonly string[];
};

export type ParameterResolution = {
  readonly primitiveId: string;
  readonly parameter: string;
  readonly value: Scalar;
  readonly ruleId: string;
};

export type StrategyResolution = {
  readonly primitiveId: string;
  readonly strategy: string;
  readonly ruleId: string;
};

export type PrimitiveExecution = {
  readonly primitiveId: string;
  readonly outcome: "published" | "unevaluable";
  readonly published?: PublishedFactRecord;
  readonly missing?: readonly string[];
};

export type TraceBlocker = {
  readonly code: string;
  readonly resolvingEvidenceKinds: readonly string[];
  readonly ruleIds: readonly string[];
};

/**
 * The namespaces the evaluator SYNTHESIZES its fail-closed blocker codes in,
 * and the constructors that mint them - one declaration, so the loader's
 * refusal of an authored code inside them cannot drift from what is actually
 * synthesized. Blockers key on code alone, so an authored `blockerCode` of
 * `rule-unevaluable:rule-x` would MERGE with the platform's entry for that very
 * rule: one trace blocker pooling a firm's rule ids and resolving kinds with a
 * platform unevaluability, and one `blockerCodes` entry for both. Reserving the
 * prefixes at load is what keeps "policy said so" and "the platform could not
 * evaluate this" distinguishable (ruling p9-blocker-namespace).
 */
const RULE_UNEVALUABLE_PREFIX = "rule-unevaluable:";
const EVIDENCE_REQUIRED_PREFIX = "evidence-required:";

export const RESERVED_REASON_CODE_PREFIXES: readonly string[] = [
  RULE_UNEVALUABLE_PREFIX,
  EVIDENCE_REQUIRED_PREFIX,
];

/** The blocker a rule that could not be evaluated contributes. */
export const ruleUnevaluableBlockerCode = (ruleId: string): string =>
  `${RULE_UNEVALUABLE_PREFIX}${ruleId}`;

/** The blocker a fired requirement for an absent evidence kind contributes. */
export const evidenceRequiredBlockerCode = (evidenceKind: string): string =>
  `${EVIDENCE_REQUIRED_PREFIX}${evidenceKind}`;

export type EvidenceRequirementOutcome = {
  readonly evidenceKind: string;
  readonly absence: "block" | "specialist_review";
  readonly outcome: "satisfied" | "absent";
  readonly reviewTemplateId?: string;
  readonly ruleIds: readonly string[];
};

export type ApprovalRequirementOutcome = {
  readonly templateId: string;
  readonly kind: "approval" | "specialist_review";
  readonly ruleIds: readonly string[];
};

/** AST `prohibit` can only ever stamp firm policy (ratified design §3.3). */
export type TraceProhibition = {
  readonly code: string;
  readonly source: ProhibitionSource;
  readonly ruleIds: readonly string[];
};

export type ProhibitionSource = "regulatory" | "firm_policy" | "household_instruction";

/**
 * OQ-5 ruling: when several prohibitions fire, the record's primary one is
 * selected by fixed source rank, then code-lexicographic - fixed HERE so
 * multi-prohibition replay is never underdetermined. All fired prohibitions
 * stay in the trace. The AST plane only produces firm_policy; the
 * restriction-screen plane (regulatory, household) merges through this same
 * comparator when the platform mapping lands.
 */
const PROHIBITION_SOURCE_RANK: Readonly<Record<ProhibitionSource, number>> = {
  regulatory: 0,
  firm_policy: 1,
  household_instruction: 2,
};

export const compareProhibitions = (left: TraceProhibition, right: TraceProhibition): number => {
  const rank = PROHIBITION_SOURCE_RANK[left.source] - PROHIBITION_SOURCE_RANK[right.source];
  if (rank !== 0) return rank;
  return compareCanonical(left.code, right.code);
};

export type AuthoritySummary = {
  readonly mode: "automatic" | "approval" | "specialist_review";
  readonly approvalTemplateIds: readonly string[];
  readonly specialistTemplateIds: readonly string[];
};

export type TraceDisposition =
  | { readonly kind: "proceed"; readonly authority: AuthoritySummary }
  | { readonly kind: "blocked"; readonly blockerCodes: readonly string[] }
  | {
      readonly kind: "prohibited";
      readonly primaryProhibitionCode: string;
      readonly primaryProhibitionSource: ProhibitionSource;
    };

export type PolicyEvaluationTrace = {
  readonly grammarVersion: PolicyGrammarVersion;
  readonly primitiveSetVersion: string;
  readonly ruleOutcomes: readonly RuleOutcome[];
  readonly parameterResolutions: readonly ParameterResolution[];
  readonly strategyResolutions: readonly StrategyResolution[];
  readonly primitiveExecutions: readonly PrimitiveExecution[];
  readonly blockers: readonly TraceBlocker[];
  readonly evidenceRequirements: readonly EvidenceRequirementOutcome[];
  readonly approvalRequirements: readonly ApprovalRequirementOutcome[];
  readonly prohibitions: readonly TraceProhibition[];
  readonly disposition: TraceDisposition;
};

/**
 * A refusal is a STRUCTURAL impossibility (malformed invocation assembly, a
 * loader bypass, a catalog-contract violation) - never policy content. Policy
 * content always lands in the trace, fail-closed, as blockers.
 */
export type PolicyEvaluationRefusalCode =
  | "unknown-primitive-invocation"
  | "duplicate-invocation"
  | "invalid-invocation-parameters"
  | "context-assembly-conflict"
  | "dataflow-cycle"
  | "published-key-escape"
  | "published-key-collision"
  | "duplicate-parameter-write"
  | "duplicate-strategy-write"
  | "config-effect-in-evaluation-phase"
  | "unknown-approval-template";

export type PolicyEvaluationRefusal = {
  readonly code: PolicyEvaluationRefusalCode;
  readonly message: string;
};
