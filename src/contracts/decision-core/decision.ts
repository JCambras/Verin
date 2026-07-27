/**
 * The decision contracts: disposition union, prohibition, traces, and the
 * persisted DecisionRecord (v3 §5; ratified shapes: docs/v3/verin-core-contracts.ts;
 * ADR-0029, D-040).
 *
 * THE CENTRAL DISTINCTIONS, STRUCTURALLY (v3 invariants 7–9; scenarios.yaml
 * disposition vocabulary proceed/blocked/prohibited):
 * - proceed REQUIRES an authority requirement and an execution plan;
 * - blocked and prohibited CANNOT carry either (strict objects - the key itself
 *   is a parse error);
 * - a prohibition CANNOT carry resolving evidence (no such field exists and a
 *   smuggled one is rejected), and a prohibited record carries no revaluation
 *   conditions - release arrives as NEW evidence evaluated by a NEW intent
 *   (golden case GC-07: "this decision stays prohibited as recorded");
 * - disposition and authority are separate planes: authority lives INSIDE the
 *   proceed arm, never beside the disposition.
 */
import { z } from "zod";
import {
  DecisionIdSchema,
  DecisionInputBundleIdSchema,
  EvidenceKindSchema,
  EvidenceSnapshotIdSchema,
  HashSchema,
  IntentIdSchema,
  ReasonCodeSchema,
  ScopeRefSchema,
  SubjectRefSchema,
  TimestampSchema,
} from "./ids";
import { AnyActorRefSchema, TenantContextSchema } from "./actor";
import { ResolvableBlockerSchema } from "./trigger";
import { AuthorityRequirementSchema } from "./authority";
import { ExecutionPlanSchema } from "./execution";

/** A versioned governing source: the precedence and explanation planes cite these. */
export const VersionedSourceRefSchema = z.strictObject({
  sourceType: z.enum(["firm_policy", "household_instruction", "regulatory"]),
  sourceId: z.string().min(1),
  versionId: z.string().min(1),
});
export type VersionedSourceRef = z.infer<typeof VersionedSourceRefSchema>;

/** One recorded precedence resolution between two governing sources. */
export const PrecedenceStepSchema = z.strictObject({
  left: VersionedSourceRefSchema,
  right: VersionedSourceRefSchema,
  resolution: z.enum(["left_wins", "right_wins", "narrowed", "exception_required", "blocked"]),
  reasonCode: ReasonCodeSchema,
});
export type PrecedenceStep = z.infer<typeof PrecedenceStepSchema>;

/** Recursive explanation tree - every decision explains itself, citing evidence + sources. */
export const ExplanationNodeSchema = z.strictObject({
  code: z.string().min(1),
  messageTemplate: z.string().min(1),
  evidenceSnapshotIds: z.array(EvidenceSnapshotIdSchema),
  sourceRefs: z.array(VersionedSourceRefSchema),
  get childNodes() {
    return z.array(ExplanationNodeSchema);
  },
});
export type ExplanationNode = z.infer<typeof ExplanationNodeSchema>;

/** JSON-scalar parameter values (canonically serializable; never objects-in-disguise). */
export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof ScalarSchema>;

/** An alternative that was considered and why it lost. */
export const RecommendationAlternativeSchema = z.strictObject({
  code: z.string().min(1),
  summary: z.string().min(1),
  rejectedBecause: z.array(ReasonCodeSchema).min(1),
});
export type RecommendationAlternative = z.infer<typeof RecommendationAlternativeSchema>;

/** The governed action a proceed decision recommends, with its rejected alternatives. */
export const RecommendationSchema = z.strictObject({
  code: z.string().min(1),
  summary: z.string().min(1),
  parameters: z.record(z.string().min(1), ScalarSchema),
  alternatives: z.array(RecommendationAlternativeSchema),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * A permanent refusal citing its governing source. There is NO resolving-evidence
 * field: strictness makes a "resolvable prohibition" unrepresentable - that shape
 * is a ResolvableBlocker and must be modeled as one.
 */
export const ProhibitionSchema = z.strictObject({
  source: VersionedSourceRefSchema,
  scope: ScopeRefSchema,
  reasonCode: ReasonCodeSchema,
  explanation: z.string().min(1),
});
export type Prohibition = z.infer<typeof ProhibitionSchema>;

/** Proceed: recommendation + authority + plan, all REQUIRED (v3 invariant 7). */
export const ProceedDecisionSchema = z.strictObject({
  kind: z.literal("proceed"),
  recommendation: RecommendationSchema,
  authority: AuthorityRequirementSchema,
  executionPlan: ExecutionPlanSchema,
});
export type ProceedDecision = z.infer<typeof ProceedDecisionSchema>;

/**
 * Blocked: at least one resolvable blocker, nothing else (v3 invariant 8). What
 * resolves the block is DERIVED from blockers[].resolvingEvidence - never stored
 * twice; two sources of truth would drift.
 */
export const BlockedDecisionSchema = z.strictObject({
  kind: z.literal("blocked"),
  blockers: z.array(ResolvableBlockerSchema).min(1),
});
export type BlockedDecision = z.infer<typeof BlockedDecisionSchema>;

/** Prohibited: the prohibition, nothing else (v3 invariant 9). */
export const ProhibitedDecisionSchema = z.strictObject({
  kind: z.literal("prohibited"),
  prohibition: ProhibitionSchema,
});
export type ProhibitedDecision = z.infer<typeof ProhibitedDecisionSchema>;

export const DecisionResultSchema = z.discriminatedUnion("kind", [
  ProceedDecisionSchema,
  BlockedDecisionSchema,
  ProhibitedDecisionSchema,
]);
export type DecisionResult = z.infer<typeof DecisionResultSchema>;

export function isProceedDecision(result: DecisionResult): result is ProceedDecision {
  return result.kind === "proceed";
}
export function isBlockedDecision(result: DecisionResult): result is BlockedDecision {
  return result.kind === "blocked";
}
export function isProhibitedDecision(result: DecisionResult): result is ProhibitedDecision {
  return result.kind === "prohibited";
}

export const RiskClassSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

/**
 * When a recorded decision must be re-evaluated (a NEW evaluation on a NEW bundle
 * - never an in-place edit). deadline_reached without a deadline is meaningless
 * and rejected.
 */
export const RevaluationConditionSchema = z
  .strictObject({
    kind: z.enum([
      "evidence_changed",
      "policy_changed",
      "instruction_changed",
      "approval_expired",
      "reservation_expired",
      "status_changed",
      "deadline_reached",
    ]),
    subjectRef: SubjectRefSchema.optional(),
    evidenceKind: EvidenceKindSchema.optional(),
    deadline: TimestampSchema.optional(),
  })
  .refine((c) => c.kind !== "deadline_reached" || c.deadline !== undefined, {
    message: "deadline_reached requires a deadline",
    path: ["deadline"],
  });
export type RevaluationCondition = z.infer<typeof RevaluationConditionSchema>;

/**
 * The persisted decision: tenant-scoped, pinned to its intent and input bundle,
 * carrying its disposition, both traces, risk + reversibility classification,
 * revaluation conditions, and the decision hash approvals bind to. Attribution is
 * tenant-consistent by construction; a prohibited record carries no revaluation
 * conditions (see the module header).
 */
export const DecisionRecordSchema = TenantContextSchema.extend({
  id: DecisionIdSchema,
  intentId: IntentIdSchema,
  inputBundleId: DecisionInputBundleIdSchema,
  result: DecisionResultSchema,
  precedenceTrace: z.array(PrecedenceStepSchema),
  explanationTrace: z.array(ExplanationNodeSchema),
  riskClass: RiskClassSchema,
  reversibility: z.enum(["reversible", "partially_reversible", "irreversible"]),
  reevaluateWhen: z.array(RevaluationConditionSchema),
  derivedFromDecisionId: DecisionIdSchema.optional(),
  decisionHash: HashSchema,
  createdBy: AnyActorRefSchema,
  createdAt: TimestampSchema,
})
  .refine((record) => record.createdBy.firmId === record.firmId, {
    message: "createdBy.firmId must match the record's tenant (cross-tenant attribution is unrepresentable)",
    path: ["createdBy"],
  })
  .refine((record) => record.result.kind !== "prohibited" || record.reevaluateWhen.length === 0, {
    message: "a prohibited decision cannot carry revaluation conditions (a prohibition has no resolving condition)",
    path: ["reevaluateWhen"],
  });
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
