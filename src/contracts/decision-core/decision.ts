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
  DecisionInputBundleRefSchema,
  DecisionRefSchema,
  EvidenceKindSchema,
  EvidenceSnapshotIdRefSchema,
  HashSchema,
  HouseholdInstructionRefSchema,
  HouseholdInstructionVersionRefSchema,
  IntentRefSchema,
  PolicyRefSchema,
  PolicyVersionRefSchema,
  ReasonCodeSchema,
  RegulatorySourceRefSchema,
  RegulatoryVersionRefSchema,
  ScopeRefSchema,
  SubjectRefSchema,
  TimestampSchema,
  compareVersionedScopedReferences,
  hasUniqueByComparator,
  hasUniqueScopedReferences,
  normalizeScopedReferences,
  normalizeVersionedScopedReferences,
} from "./ids";
import {
  AnyActorRefSchema,
  TenantContextSchema,
  normalizeActorRef,
} from "./actor";
import {
  ResolvableBlockerSchema,
  normalizeResolvableBlocker,
} from "./trigger";
import {
  AuthorityRequirementSchema,
  normalizeAuthorityRequirement,
} from "./authority";
import { ExecutionPlanSchema, normalizeExecutionPlan } from "./execution";
import {
  isPlainRecord,
  normalizeExplanationNode,
} from "./normalization";

/** A versioned governing source: the precedence and explanation planes cite these. */
export const VersionedSourceRefSchema = z
  .discriminatedUnion("sourceType", [
    z.strictObject({
      sourceType: z.literal("firm_policy"),
      sourceRef: PolicyRefSchema,
      versionRef: PolicyVersionRefSchema,
    }),
    z.strictObject({
      sourceType: z.literal("household_instruction"),
      sourceRef: HouseholdInstructionRefSchema,
      versionRef: HouseholdInstructionVersionRefSchema,
    }),
    z.strictObject({
      sourceType: z.literal("regulatory"),
      sourceRef: RegulatorySourceRefSchema,
      versionRef: RegulatoryVersionRefSchema,
    }),
  ])
  .refine((source) => source.sourceRef.firmId === source.versionRef.firmId, {
    message: "sourceRef.firmId and versionRef.firmId must match",
    path: ["sourceRef", "firmId"],
  })
  .readonly();
export type VersionedSourceRef = z.infer<typeof VersionedSourceRefSchema>;

/** One recorded precedence resolution between two governing sources. */
export const PrecedenceStepSchema = z.strictObject({
  left: VersionedSourceRefSchema,
  right: VersionedSourceRefSchema,
  resolution: z.enum(["left_wins", "right_wins", "narrowed", "exception_required", "blocked"]),
  reasonCode: ReasonCodeSchema,
}).readonly();
export type PrecedenceStep = z.infer<typeof PrecedenceStepSchema>;

/** Recursive explanation tree - every decision explains itself, citing evidence + sources. */
export const ExplanationNodeSchema = z
  .strictObject({
    code: z.string().min(1),
    messageTemplate: z.string().min(1),
    evidenceSnapshotRefs: z
      .array(EvidenceSnapshotIdRefSchema)
      .refine(
        hasUniqueScopedReferences,
        "duplicate explanation evidence snapshot reference",
      )
      .overwrite(normalizeScopedReferences)
      .readonly(),
    sourceRefs: z
      .array(VersionedSourceRefSchema)
      .refine(
        (refs) =>
          hasUniqueByComparator(refs, compareVersionedScopedReferences),
        "duplicate explanation source reference",
      )
      .overwrite(normalizeVersionedScopedReferences)
      .readonly(),
    get childNodes(): z.ZodReadonly<z.ZodArray<typeof ExplanationNodeSchema>> {
      return z.array(ExplanationNodeSchema).readonly();
    },
  })
  .readonly();
export type ExplanationNode = z.infer<typeof ExplanationNodeSchema>;

type ExplanationTenantReferences = {
  evidenceSnapshotRefs: readonly { firmId: string }[];
  sourceRefs: readonly VersionedSourceRef[];
  childNodes: readonly ExplanationTenantReferences[];
};

type NormalizableDecisionRecord = {
  readonly createdBy: Parameters<typeof normalizeActorRef>[0];
  readonly explanationTrace: readonly unknown[];
  readonly result: {
    readonly kind: string;
    readonly authority?: Parameters<typeof normalizeAuthorityRequirement>[0];
    readonly executionPlan?: Parameters<typeof normalizeExecutionPlan>[0];
    readonly blockers?: readonly Parameters<
      typeof normalizeResolvableBlocker
    >[0][];
  };
};

const normalizeDecisionResult = <
  T extends NormalizableDecisionRecord["result"],
>(
  result: T,
): T => {
  if (!isPlainRecord(result)) return result;
  if (
    result.kind === "proceed" &&
    result.authority !== undefined &&
    result.executionPlan !== undefined
  ) {
    return {
      ...result,
      authority: normalizeAuthorityRequirement(result.authority),
      executionPlan: normalizeExecutionPlan(result.executionPlan),
    } as T;
  }
  if (result.kind === "blocked" && result.blockers !== undefined) {
    return {
      ...result,
      blockers: result.blockers.map(normalizeResolvableBlocker),
    } as T;
  }
  return result;
};

export const normalizeDecisionRecord = <T extends NormalizableDecisionRecord>(
  record: T,
): T => {
  if (!isPlainRecord(record)) return record;
  return {
    ...record,
    createdBy: normalizeActorRef(record.createdBy),
    explanationTrace: record.explanationTrace.map((node) =>
      normalizeExplanationNode(
        node as Parameters<typeof normalizeExplanationNode>[0],
      ),
    ),
    result: normalizeDecisionResult(record.result),
  } as T;
};

/** JSON-scalar parameter values (canonically serializable; never objects-in-disguise). */
export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof ScalarSchema>;

export const RecommendationParameterSchema = z.union([ScalarSchema, SubjectRefSchema]);
export type RecommendationParameter = z.infer<typeof RecommendationParameterSchema>;

/** An alternative that was considered and why it lost. */
export const RecommendationAlternativeSchema = z.strictObject({
  code: z.string().min(1),
  summary: z.string().min(1),
  rejectedBecause: z.array(ReasonCodeSchema).min(1).readonly(),
}).readonly();
export type RecommendationAlternative = z.infer<typeof RecommendationAlternativeSchema>;

/** The governed action a proceed decision recommends, with its rejected alternatives. */
export const RecommendationSchema = z.strictObject({
  code: z.string().min(1),
  summary: z.string().min(1),
  parameters: z.record(z.string().min(1), RecommendationParameterSchema).readonly(),
  alternatives: z.array(RecommendationAlternativeSchema).readonly(),
}).readonly();
export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * A permanent refusal citing its governing source. There is NO resolving-evidence
 * field: strictness makes a "resolvable prohibition" unrepresentable - that shape
 * is a ResolvableBlocker and must be modeled as one.
 */
export const ProhibitionSchema = z.strictObject({
  source: VersionedSourceRefSchema,
  scopeRef: ScopeRefSchema,
  reasonCode: ReasonCodeSchema,
  explanation: z.string().min(1),
}).readonly();
export type Prohibition = z.infer<typeof ProhibitionSchema>;

/** Proceed: recommendation + authority + plan, all REQUIRED (v3 invariant 7). */
export const ProceedDecisionSchema = z.strictObject({
  kind: z.literal("proceed"),
  recommendation: RecommendationSchema,
  authority: AuthorityRequirementSchema,
  executionPlan: ExecutionPlanSchema,
}).readonly();
export type ProceedDecision = z.infer<typeof ProceedDecisionSchema>;

/**
 * Blocked: at least one resolvable blocker, nothing else (v3 invariant 8). What
 * resolves the block is DERIVED from blockers[].resolvingEvidence - never stored
 * twice; two sources of truth would drift.
 */
export const BlockedDecisionSchema = z.strictObject({
  kind: z.literal("blocked"),
  blockers: z.array(ResolvableBlockerSchema).min(1).readonly(),
}).readonly();
export type BlockedDecision = z.infer<typeof BlockedDecisionSchema>;

/** Prohibited: the prohibition, nothing else (v3 invariant 9). */
export const ProhibitedDecisionSchema = z.strictObject({
  kind: z.literal("prohibited"),
  prohibition: ProhibitionSchema,
}).readonly();
export type ProhibitedDecision = z.infer<typeof ProhibitedDecisionSchema>;

export const DecisionResultSchema = z.discriminatedUnion("kind", [
  ProceedDecisionSchema.unwrap(),
  BlockedDecisionSchema.unwrap(),
  ProhibitedDecisionSchema.unwrap(),
]).readonly();
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
  })
  .readonly();
export type RevaluationCondition = z.infer<typeof RevaluationConditionSchema>;

/**
 * The persisted decision: tenant-scoped, pinned to its intent and input bundle,
 * carrying its disposition, both traces, risk + reversibility classification,
 * revaluation conditions, and the decision hash approvals bind to. Attribution is
 * tenant-consistent by construction; a prohibited record carries no revaluation
 * conditions (see the module header).
 */
export const DecisionRecordSchema = TenantContextSchema.unwrap().extend({
  id: DecisionIdSchema,
  intentRef: IntentRefSchema,
  inputBundleRef: DecisionInputBundleRefSchema,
  result: DecisionResultSchema,
  precedenceTrace: z.array(PrecedenceStepSchema).readonly(),
  explanationTrace: z.array(ExplanationNodeSchema).readonly(),
  riskClass: RiskClassSchema,
  reversibility: z.enum(["reversible", "partially_reversible", "irreversible"]),
  reevaluateWhen: z.array(RevaluationConditionSchema).readonly(),
  derivedFromDecisionRef: DecisionRefSchema.optional(),
  decisionHash: HashSchema,
  createdBy: AnyActorRefSchema,
  createdAt: TimestampSchema,
})
  .refine((record) => record.createdBy.firmId === record.firmId, {
    message: "createdBy.firmId must match the record's tenant (cross-tenant attribution is unrepresentable)",
    path: ["createdBy"],
  })
  .refine((record) => record.intentRef.firmId === record.firmId, {
    message: "intentRef.firmId must match the record's tenant",
    path: ["intentRef", "firmId"],
  })
  .refine((record) => record.inputBundleRef.firmId === record.firmId, {
    message: "inputBundleRef.firmId must match the record's tenant",
    path: ["inputBundleRef", "firmId"],
  })
  .superRefine((record, ctx) => {
    const requireSameFirm = (ref: { firmId: string }, path: (string | number)[]) => {
      if (ref.firmId !== record.firmId) {
        ctx.addIssue({ code: "custom", message: "referenced record must belong to the decision tenant", path });
      }
    };
    const requireSource = (source: VersionedSourceRef, path: (string | number)[]) => {
      requireSameFirm(source.sourceRef, [...path, "sourceRef", "firmId"]);
      requireSameFirm(source.versionRef, [...path, "versionRef", "firmId"]);
    };
    const requireExplanation = (
      node: ExplanationTenantReferences,
      path: (string | number)[],
    ) => {
      node.evidenceSnapshotRefs.forEach((ref, index) =>
        requireSameFirm(ref, [...path, "evidenceSnapshotRefs", index, "firmId"]),
      );
      node.sourceRefs.forEach((source, index) =>
        requireSource(source, [...path, "sourceRefs", index]),
      );
      node.childNodes.forEach((child, index) =>
        requireExplanation(child, [...path, "childNodes", index]),
      );
    };
    record.precedenceTrace.forEach((step, index) => {
      requireSource(step.left, ["precedenceTrace", index, "left"]);
      requireSource(step.right, ["precedenceTrace", index, "right"]);
    });
    (record.explanationTrace as readonly ExplanationTenantReferences[]).forEach((node, index) =>
      requireExplanation(node, ["explanationTrace", index]),
    );
    record.reevaluateWhen.forEach((condition, index) => {
      if (condition.subjectRef) {
        requireSameFirm(condition.subjectRef, ["reevaluateWhen", index, "subjectRef", "firmId"]);
      }
    });
    if (record.result.kind === "blocked") {
      record.result.blockers.forEach((blocker, blockerIndex) =>
        blocker.resolvingEvidence.forEach((request, requestIndex) =>
          requireSameFirm(request.subjectRef, [
            "result",
            "blockers",
            blockerIndex,
            "resolvingEvidence",
            requestIndex,
            "subjectRef",
            "firmId",
          ]),
        ),
      );
    }
    if (record.result.kind === "prohibited") {
      requireSource(record.result.prohibition.source, ["result", "prohibition", "source"]);
      requireSameFirm(record.result.prohibition.scopeRef, ["result", "prohibition", "scopeRef", "firmId"]);
    }
    if (record.result.kind === "proceed") {
      for (const [key, parameter] of Object.entries(record.result.recommendation.parameters)) {
        if (parameter !== null && typeof parameter === "object") {
          requireSameFirm(parameter, ["result", "recommendation", "parameters", key, "firmId"]);
        }
      }
      if (record.result.authority.mode !== "automatic") {
        record.result.authority.stages.forEach((stage, stageIndex) => {
          requireSameFirm(stage.templateRef, ["result", "authority", "stages", stageIndex, "templateRef", "firmId"]);
          if (stage.expiresAt <= record.createdAt) {
            ctx.addIssue({
              code: "custom",
              message: "approval-stage expiration must be later than decision creation",
              path: ["result", "authority", "stages", stageIndex, "expiresAt"],
            });
          }
        });
      }
      // execution.ts already binds every reference inside an action to that action's
      // own targetRef, and every step's and compensation's targetRef to steps[0]'s -
      // so ONE step-target edge per step carries the whole plan into this tenant.
      // Re-walking those references here would be a second copy to keep in sync.
      record.result.executionPlan.steps.forEach((step, stepIndex) =>
        requireSameFirm(step.targetRef, [
          "result",
          "executionPlan",
          "steps",
          stepIndex,
          "targetRef",
          "firmId",
        ]),
      );
    }
    if (record.derivedFromDecisionRef) {
      requireSameFirm(record.derivedFromDecisionRef, ["derivedFromDecisionRef", "firmId"]);
    }
  })
  .refine((record) => record.result.kind !== "prohibited" || record.reevaluateWhen.length === 0, {
    message: "a prohibited decision cannot carry revaluation conditions (a prohibition has no resolving condition)",
    path: ["reevaluateWhen"],
  })
  .refine(
    (record) =>
      record.derivedFromDecisionRef === undefined ||
      record.derivedFromDecisionRef.id !== record.id,
    {
      message: "a decision cannot derive from itself",
      path: ["derivedFromDecisionRef"],
    },
  )
  .readonly();
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
