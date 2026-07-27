/**
 * Authority contracts: approval requirements, stages, and the authority modes
 * (v3 §5; ratified shapes: docs/v3/verin-core-contracts.ts; ADR-0029, D-040).
 *
 * AUTHORITY IS NOT DISPOSITION. These types describe WHO must consent before an
 * already-decided proceed executes; they never appear on blocked or prohibited
 * results (decision.ts makes that structural). The template/instance split is
 * deliberate: a reusable firm-config template carries a RELATIVE expiry
 * (expiresAfter), the instance attached to a specific decision carries the
 * ABSOLUTE expiry (expiresAt) computed at a recorded instantiation - replay uses
 * recorded instances, never re-derives them.
 */
import { z } from "zod";
import {
  ApprovalTemplateIdSchema,
  ApprovalTemplateRefSchema,
  DurationSchema,
  ReasonCodeSchema,
  RoleIdSchema,
  TimestampSchema,
} from "./ids";
import { TenantContextSchema } from "./actor";

/** After `after` with no quorum, escalate to `roleIds` for `reasonCode`. */
export const EscalationStepSchema = z.strictObject({
  after: DurationSchema,
  roleIds: z.array(RoleIdSchema).min(1).readonly(),
  reasonCode: ReasonCodeSchema,
}).readonly();
export type EscalationStep = z.infer<typeof EscalationStepSchema>;

/**
 * One quorum rule: which roles may approve, how many approvals, and the
 * separation-of-duties switches (distinct actors, requester exclusion, prior
 * executor exclusion, reason-required override).
 */
export const ApprovalRequirementSchema = z.strictObject({
  eligibleRoleIds: z.array(RoleIdSchema).min(1).readonly(),
  approvalsRequired: z.int().positive(),
  distinctActorsRequired: z.boolean(),
  requesterMayApprove: z.boolean(),
  priorExecutorMayApprove: z.boolean(),
  reasonRequiredOnOverride: z.boolean(),
}).readonly();
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

const stageCore = {
  stageId: z.string().min(1),
  order: z.int().nonnegative(),
  executionMode: z.enum(["sequential", "parallel"]),
  requirements: z.array(ApprovalRequirementSchema).min(1).readonly(),
  escalationPath: z.array(EscalationStepSchema).readonly(),
};

const PositiveApprovalDurationSchema = DurationSchema.refine(
  (duration) => !duration.startsWith("-") && /[1-9]/.test(duration),
  "approval-stage expiration must be strictly positive",
);

/**
 * Parse-time stage integrity, mirroring ExecutionPlan's: approvals bind to stages
 * by stageId and sequence by order, so a duplicate of either inside one stack
 * would alias that binding the way a duplicate idempotency key aliases retries.
 */
const requireDistinctStages = (
  stages: ReadonlyArray<{ stageId: string; order: number }>,
  ctx: z.core.$RefinementCtx,
): void => {
  const stageIds = new Set<string>();
  const orders = new Set<number>();
  for (const stage of stages) {
    if (stageIds.has(stage.stageId)) ctx.addIssue({ code: "custom", message: `duplicate stage id "${stage.stageId}"`, path: ["stages"] });
    stageIds.add(stage.stageId);
    if (orders.has(stage.order)) ctx.addIssue({ code: "custom", message: `duplicate stage order ${stage.order}`, path: ["stages"] });
    orders.add(stage.order);
  }
};

/** Template form (firm configuration): relative expiry - it cannot know wall-clock time. */
export const ApprovalStageTemplateSchema = z.strictObject({
  ...stageCore,
  expiresAfter: PositiveApprovalDurationSchema,
}).readonly();
export type ApprovalStageTemplate = z.infer<typeof ApprovalStageTemplateSchema>;

/** A reusable, referencable stack of stage templates. */
export const ApprovalTemplateSchema = z
  .strictObject({
    ...TenantContextSchema.unwrap().shape,
    id: ApprovalTemplateIdSchema,
    stages: z.array(ApprovalStageTemplateSchema).min(1).readonly(),
  })
  .superRefine((template, ctx) => requireDistinctStages(template.stages, ctx))
  .readonly();
export type ApprovalTemplate = z.infer<typeof ApprovalTemplateSchema>;

/**
 * Instance form (attached to one proceed decision): absolute expiry computed at a
 * deterministic, recorded instantiation from the template's expiresAfter.
 */
export const ApprovalStageSchema = z.strictObject({
  ...stageCore,
  templateRef: ApprovalTemplateRefSchema,
  expiresAt: TimestampSchema,
}).readonly();
export type ApprovalStage = z.infer<typeof ApprovalStageSchema>;

/**
 * How authority is satisfied for a proceed decision. "approval" or
 * "specialist_review" with zero stages would be "automatic" wearing a costume -
 * stages are non-empty by construction in BOTH non-automatic modes, and every
 * stage stack keeps stageId and order distinct, so the modes stay honest.
 */
export const AuthorityRequirementSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("automatic") }),
  z
    .strictObject({ mode: z.literal("approval"), stages: z.array(ApprovalStageSchema).min(1).readonly() })
    .superRefine((requirement, ctx) => requireDistinctStages(requirement.stages, ctx)),
  z
    .strictObject({
      mode: z.literal("specialist_review"),
      specialistRoleIds: z.array(RoleIdSchema).min(1).readonly(),
      stages: z.array(ApprovalStageSchema).min(1).readonly(),
    })
    .superRefine((requirement, ctx) => requireDistinctStages(requirement.stages, ctx)),
]).readonly();
export type AuthorityRequirement = z.infer<typeof AuthorityRequirementSchema>;
