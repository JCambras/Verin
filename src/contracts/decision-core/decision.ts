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
  HashSchema,
  IntentRefSchema,
  ReasonCodeSchema,
  ScopeRefSchema,
  SubjectRefSchema,
  TimestampSchema,
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
import {
  ExplanationNodeSchema,
  PrecedenceStepSchema,
  VersionedSourceRefSchema,
  type VersionedSourceRef,
} from "./explanation";
export {
  ExplanationNodeSchema,
  PrecedenceStepSchema,
  VersionedSourceRefSchema,
  type ExplanationNode,
  type PrecedenceStep,
  type VersionedSourceRef,
} from "./explanation";

type ExplanationPath = {
  readonly parent?: ExplanationPath;
  readonly segment: string | number;
};

const materializeExplanationPath = (
  path: ExplanationPath | undefined,
): (string | number)[] => {
  const segments: (string | number)[] = [];
  for (let cursor = path; cursor !== undefined; cursor = cursor.parent) {
    segments.push(cursor.segment);
  }
  return segments.reverse();
};

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

const recommendationSubjectRefs = (
  parameters: Readonly<Record<string, RecommendationParameter>>,
): readonly z.infer<typeof SubjectRefSchema>[] =>
  Object.values(parameters).filter(
    (parameter): parameter is z.infer<typeof SubjectRefSchema> =>
      parameter !== null && typeof parameter === "object",
  );

/** An alternative that was considered and why it lost. */
export const RecommendationAlternativeSchema = z.strictObject({
  code: z.string().min(1),
  summary: z.string().min(1),
  rejectedBecause: z.array(ReasonCodeSchema).min(1).readonly(),
}).readonly();
export type RecommendationAlternative = z.infer<typeof RecommendationAlternativeSchema>;

/** The governed action a proceed decision recommends, with its rejected alternatives. */
export const RecommendationSchema = z
  .strictObject({
    code: z.string().min(1),
    summary: z.string().min(1),
    parameters: z.record(
      z.string().min(1),
      RecommendationParameterSchema,
    ).readonly(),
    alternatives: z.array(RecommendationAlternativeSchema).readonly(),
  })
  .superRefine((recommendation, ctx) => {
    const subjectRefs = recommendationSubjectRefs(recommendation.parameters);
    if (subjectRefs.some((ref) => ref.firmId !== subjectRefs[0]?.firmId)) {
      ctx.addIssue({
        code: "custom",
        message: "recommendation subjects must belong to one tenant",
        path: ["parameters"],
      });
    }
  })
  .readonly();
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
}).refine(
  (prohibition) =>
    prohibition.source.sourceRef.firmId === prohibition.scopeRef.firmId,
  { message: "prohibition source and scope must belong to one tenant" },
).readonly();
export type Prohibition = z.infer<typeof ProhibitionSchema>;

const proceedDecisionFirmIds = (decision: {
  recommendation: z.infer<typeof RecommendationSchema>;
  authority: z.infer<typeof AuthorityRequirementSchema>;
  executionPlan: z.infer<typeof ExecutionPlanSchema>;
}): string[] => [
  ...recommendationSubjectRefs(decision.recommendation.parameters).map(
    (subjectRef) => subjectRef.firmId,
  ),
  ...(decision.authority.mode === "automatic"
    ? []
    : decision.authority.stages.map((stage) => stage.templateRef.firmId)),
  ...decision.executionPlan.steps.map((step) => step.targetRef.firmId),
];

const hasOneTenant = (firmIds: readonly string[]): boolean =>
  firmIds.every((firmId) => firmId === firmIds[0]);

/** Proceed: recommendation + authority + plan, all REQUIRED (v3 invariant 7). */
export const ProceedDecisionSchema = z.strictObject({
  kind: z.literal("proceed"),
  recommendation: RecommendationSchema,
  authority: AuthorityRequirementSchema,
  executionPlan: ExecutionPlanSchema,
}).superRefine((decision, ctx) => {
  if (!hasOneTenant(proceedDecisionFirmIds(decision))) {
    ctx.addIssue({
      code: "custom",
      message: "proceed decision references must belong to one tenant",
    });
  }
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
}).refine((decision) => hasOneTenant(decision.blockers.flatMap((blocker) =>
  blocker.resolvingEvidence.map((request) => request.subjectRef.firmId)
)), "blocked decision references must belong to one tenant").readonly();
export type BlockedDecision = z.infer<typeof BlockedDecisionSchema>;

/** Prohibited: the prohibition, nothing else (v3 invariant 9). */
export const ProhibitedDecisionSchema = z.strictObject({
  kind: z.literal("prohibited"),
  prohibition: ProhibitionSchema,
}).readonly();
export type ProhibitedDecision = z.infer<typeof ProhibitedDecisionSchema>;

const requireDecisionResultTenant = (
  result:
    | z.infer<typeof ProceedDecisionSchema>
    | z.infer<typeof BlockedDecisionSchema>
    | z.infer<typeof ProhibitedDecisionSchema>,
  ctx: z.RefinementCtx,
): void => {
  const firmIds = result.kind === "proceed"
    ? proceedDecisionFirmIds(result)
    : result.kind === "blocked"
      ? result.blockers.flatMap((blocker) =>
          blocker.resolvingEvidence.map((request) => request.subjectRef.firmId)
        )
      : [
          result.prohibition.source.sourceRef.firmId,
          result.prohibition.scopeRef.firmId,
        ];
  if (!hasOneTenant(firmIds)) {
    ctx.addIssue({
      code: "custom",
      message: "decision result references must belong to one tenant",
    });
  }
};

export const DecisionResultSchema = z
  .discriminatedUnion("kind", [
    ProceedDecisionSchema.unwrap(),
    BlockedDecisionSchema.unwrap(),
    ProhibitedDecisionSchema.unwrap(),
  ])
  .superRefine(requireDecisionResultTenant)
  .readonly();
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
    const explanationTasks: Array<{
      readonly node: ExplanationTenantReferences;
      readonly path: ExplanationPath;
    }> = [];
    record.explanationTrace.forEach((node, index) =>
      explanationTasks.push({
        node: node as ExplanationTenantReferences,
        path: {
          parent: { segment: "explanationTrace" },
          segment: index,
        },
      }),
    );
    while (explanationTasks.length > 0) {
      const { node, path } = explanationTasks.pop()!;
      node.evidenceSnapshotRefs.forEach((ref, index) =>
        requireSameFirm(ref, [
          ...materializeExplanationPath(path),
          "evidenceSnapshotRefs",
          index,
          "firmId",
        ]),
      );
      node.sourceRefs.forEach((source, index) =>
        requireSource(source, [
          ...materializeExplanationPath(path),
          "sourceRefs",
          index,
        ]),
      );
      node.childNodes.forEach((child, index) =>
        explanationTasks.push({
          node: child,
          path: {
            parent: {
              parent: path,
              segment: "childNodes",
            },
            segment: index,
          },
        }),
      );
    }
    record.precedenceTrace.forEach((step, index) => {
      requireSource(step.left, ["precedenceTrace", index, "left"]);
      requireSource(step.right, ["precedenceTrace", index, "right"]);
    });
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
