/**
 * Authority contracts: approval requirements, stages, and the authority modes
 * (v3 §5; ratified shapes: docs/v3/verin-core-contracts.ts; ADR-0029, D-036).
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
import { ApprovalTemplateIdSchema, DurationSchema, ReasonCodeSchema, RoleIdSchema, TimestampSchema } from "./ids";

/** After `after` with no quorum, escalate to `roleIds` for `reasonCode`. */
export const EscalationStepSchema = z.strictObject({
  after: DurationSchema,
  roleIds: z.array(RoleIdSchema).min(1),
  reasonCode: ReasonCodeSchema,
});
export type EscalationStep = z.infer<typeof EscalationStepSchema>;

/**
 * One quorum rule: which roles may approve, how many approvals, and the
 * separation-of-duties switches (distinct actors, requester exclusion, prior
 * executor exclusion, reason-required override).
 */
export const ApprovalRequirementSchema = z.strictObject({
  eligibleRoleIds: z.array(RoleIdSchema).min(1),
  approvalsRequired: z.int().positive(),
  distinctActorsRequired: z.boolean(),
  requesterMayApprove: z.boolean(),
  priorExecutorMayApprove: z.boolean(),
  reasonRequiredOnOverride: z.boolean(),
});
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

const stageCore = {
  stageId: z.string().min(1),
  order: z.int().nonnegative(),
  executionMode: z.enum(["sequential", "parallel"]),
  requirements: z.array(ApprovalRequirementSchema).min(1),
  escalationPath: z.array(EscalationStepSchema),
};

/** Template form (firm configuration): relative expiry - it cannot know wall-clock time. */
export const ApprovalStageTemplateSchema = z.strictObject({
  ...stageCore,
  expiresAfter: DurationSchema,
});
export type ApprovalStageTemplate = z.infer<typeof ApprovalStageTemplateSchema>;

/** A reusable, referencable stack of stage templates. */
export const ApprovalTemplateSchema = z.strictObject({
  id: ApprovalTemplateIdSchema,
  stages: z.array(ApprovalStageTemplateSchema).min(1),
});
export type ApprovalTemplate = z.infer<typeof ApprovalTemplateSchema>;

/**
 * Instance form (attached to one proceed decision): absolute expiry computed at a
 * deterministic, recorded instantiation from the template's expiresAfter.
 */
export const ApprovalStageSchema = z.strictObject({
  ...stageCore,
  templateId: ApprovalTemplateIdSchema,
  expiresAt: TimestampSchema,
});
export type ApprovalStage = z.infer<typeof ApprovalStageSchema>;

/**
 * How authority is satisfied for a proceed decision. "approval" with zero stages
 * would be "automatic" wearing a costume - stages are non-empty by construction,
 * so the modes stay honest.
 */
export const AuthorityRequirementSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("automatic") }),
  z.strictObject({ mode: z.literal("approval"), stages: z.array(ApprovalStageSchema).min(1) }),
  z.strictObject({
    mode: z.literal("specialist_review"),
    specialistRoleIds: z.array(RoleIdSchema).min(1),
    stages: z.array(ApprovalStageSchema),
  }),
]);
export type AuthorityRequirement = z.infer<typeof AuthorityRequirementSchema>;
