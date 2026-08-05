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
  NonEmptyRoleRefSetSchema,
  ReasonCodeSchema,
  TimestampSchema,
  normalizeScopedReferences,
  withTenantClosure,
} from "./ids";
import { TenantContextSchema } from "./actor";
import { isPlainRecord } from "./normalization";

const DURATION_COMPONENT = /(\d+(?:[.,]\d+)?)[YMWDHS]/g;

/**
 * Strictly positive, decided by READING the duration rather than by trusting the
 * shape of the accepted grammar: any sign at all is refused, and at least one
 * component magnitude must exceed zero. A guard written as "does not start with -"
 * silently inherits whatever ISO-8601 profile the validation library ships (8601-2
 * permits a sign on each individual component), so the day that profile widens,
 * "PT-1H" would become a stage that is already expired the moment it is created.
 *
 * Exported so the invariant is testable against signed forms DIRECTLY: today's
 * validator refuses them before this predicate ever runs, which would leave the
 * soundness of the check unverifiable through the schema alone.
 */
export const isStrictlyPositiveDuration = (duration: string): boolean => {
  if (/[+-]/.test(duration)) return false;
  let total = 0;
  for (const match of duration.matchAll(DURATION_COMPONENT)) {
    total += Number.parseFloat((match[1] ?? "0").replace(",", "."));
  }
  return total > 0;
};

/** Every approval duration is strictly positive - relative expiry AND escalation delay. */
const PositiveApprovalDurationSchema = DurationSchema.refine(
  isStrictlyPositiveDuration,
  "approval duration must be strictly positive",
);

/**
 * After `after` with no quorum, escalate to `roleIds` for `reasonCode`. `after` is a
 * positive delay for the same reason `expiresAfter` is: "PT0S" would escalate
 * instantly and "-P1D" would escalate into the past.
 *
 * Positivity is ALL this layer constrains. Whether `after` must fall inside the
 * stage's own expiry, and whether two steps in one path may share a delay, are
 * approval-BINDING semantics owned by prompts 18/24; deferring them is deliberate and
 * recorded (D-054), not an oversight, and un-defers when those prompts land.
 */
export const EscalationStepSchema = z.strictObject({
  after: PositiveApprovalDurationSchema,
  roleIds: NonEmptyRoleRefSetSchema,
  reasonCode: ReasonCodeSchema,
}).readonly();
export type EscalationStep = z.infer<typeof EscalationStepSchema>;

/**
 * One quorum rule: which roles may approve, how many approvals, and the
 * separation-of-duties switches (distinct actors, requester exclusion, prior
 * executor exclusion, reason-required override).
 */
export const ApprovalRequirementSchema = z.strictObject({
  eligibleRoleIds: NonEmptyRoleRefSetSchema,
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
  for (const [index, stage] of stages.entries()) {
    if (stageIds.has(stage.stageId)) ctx.addIssue({ code: "custom", message: `duplicate stage id "${stage.stageId}"`, path: [index, "stageId"] });
    stageIds.add(stage.stageId);
    if (orders.has(stage.order)) ctx.addIssue({ code: "custom", message: `duplicate stage order ${stage.order}`, path: [index, "order"] });
    orders.add(stage.order);
  }
};

type StageRoleRefs = {
  requirements: readonly { eligibleRoleIds: readonly { firmId: string }[] }[];
  escalationPath: readonly { roleIds: readonly { firmId: string }[] }[];
};

type NormalizableStage = {
  readonly order: number;
  readonly requirements: readonly {
    readonly eligibleRoleIds: readonly {
      readonly firmId: string;
      readonly id: string;
    }[];
  }[];
  readonly escalationPath: readonly {
    readonly roleIds: readonly {
      readonly firmId: string;
      readonly id: string;
    }[];
  }[];
};

const normalizeStage = <T extends NormalizableStage>(stage: T): T => {
  if (!isPlainRecord(stage)) return stage;
  return {
    ...stage,
    requirements: stage.requirements.map((requirement) =>
      isPlainRecord(requirement)
        ? {
            ...requirement,
            eligibleRoleIds: normalizeScopedReferences(
              requirement.eligibleRoleIds,
            ),
          }
        : requirement,
    ),
    escalationPath: stage.escalationPath.map((escalation) =>
      isPlainRecord(escalation)
        ? {
            ...escalation,
            roleIds: normalizeScopedReferences(escalation.roleIds),
          }
        : escalation,
    ),
  } as T;
};

export const normalizeApprovalStages = <T extends NormalizableStage>(
  stages: readonly T[],
): T[] => [...stages].sort((left, right) => left.order - right.order);

const requireStageRoleTenant = (
  stage: StageRoleRefs,
  firmId: string,
  ctx: z.core.$RefinementCtx,
  path: (string | number)[] = [],
): void => {
  stage.requirements.forEach((requirement, requirementIndex) =>
    requirement.eligibleRoleIds.forEach((role, roleIndex) => {
      if (role.firmId !== firmId) {
        ctx.addIssue({
          code: "custom",
          message: "eligible role must belong to the authority tenant",
          path: [...path, "requirements", requirementIndex, "eligibleRoleIds", roleIndex, "firmId"],
        });
      }
    }),
  );
  stage.escalationPath.forEach((escalation, escalationIndex) =>
    escalation.roleIds.forEach((role, roleIndex) => {
      if (role.firmId !== firmId) {
        ctx.addIssue({
          code: "custom",
          message: "escalation role must belong to the authority tenant",
          path: [...path, "escalationPath", escalationIndex, "roleIds", roleIndex, "firmId"],
        });
      }
    }),
  );
};

/** Template form (firm configuration): relative expiry - it cannot know wall-clock time. */
export const ApprovalStageTemplateSchema = z.strictObject({
  ...stageCore,
  expiresAfter: PositiveApprovalDurationSchema,
})
  .superRefine((stage, ctx) => {
    const firmId = stage.requirements[0]?.eligibleRoleIds[0]?.firmId;
    if (firmId) requireStageRoleTenant(stage, firmId, ctx);
  })
  .readonly();
export type ApprovalStageTemplate = z.infer<typeof ApprovalStageTemplateSchema>;

const ApprovalStageTemplateListSchema = z
  .array(ApprovalStageTemplateSchema)
  .min(1)
  .superRefine(requireDistinctStages)
  .overwrite(normalizeApprovalStages)
  .readonly();

/** A reusable, referencable stack of stage templates. */
export const ApprovalTemplateSchema = withTenantClosure(
  z.strictObject({
    ...TenantContextSchema.unwrap().shape,
    id: ApprovalTemplateIdSchema,
    stages: ApprovalStageTemplateListSchema,
  })
    .readonly(),
);
export type ApprovalTemplate = z.infer<typeof ApprovalTemplateSchema>;

/**
 * Instance form (attached to one proceed decision): absolute expiry computed at a
 * deterministic, recorded instantiation from the template's expiresAfter.
 */
export const ApprovalStageSchema = z.strictObject({
  ...stageCore,
  templateRef: ApprovalTemplateRefSchema,
  expiresAt: TimestampSchema,
})
  .superRefine((stage, ctx) =>
    requireStageRoleTenant(stage, stage.templateRef.firmId, ctx),
  )
  .readonly();
export type ApprovalStage = z.infer<typeof ApprovalStageSchema>;

const ApprovalStageListSchema = z
  .array(ApprovalStageSchema)
  .min(1)
  .superRefine(requireDistinctStages)
  .overwrite(normalizeApprovalStages)
  .readonly();

/**
 * How authority is satisfied for a proceed decision. "approval" or
 * "specialist_review" with zero stages would be "automatic" wearing a costume -
 * stages are non-empty by construction in BOTH non-automatic modes, and every
 * stage stack keeps stageId and order distinct, so the modes stay honest.
 */
export const AuthorityRequirementSchema = withTenantClosure(
  z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("automatic") }),
    z.strictObject({ mode: z.literal("approval"), stages: ApprovalStageListSchema }),
    z.strictObject({
      mode: z.literal("specialist_review"),
      specialistRoleIds: NonEmptyRoleRefSetSchema,
      stages: ApprovalStageListSchema,
    }),
  ]).readonly(),
);
export type AuthorityRequirement = z.infer<typeof AuthorityRequirementSchema>;

type NormalizableAuthorityRequirement = {
  readonly mode: string;
  readonly specialistRoleIds?: readonly {
    readonly firmId: string;
    readonly id: string;
  }[];
  readonly stages?: readonly NormalizableStage[];
};

export const normalizeAuthorityRequirement = <
  T extends NormalizableAuthorityRequirement,
>(
  requirement: T,
): T => {
  if (!isPlainRecord(requirement) || requirement.mode === "automatic") {
    return requirement;
  }
  return {
    ...requirement,
    ...(requirement.specialistRoleIds === undefined
      ? {}
      : {
          specialistRoleIds: normalizeScopedReferences(
            requirement.specialistRoleIds,
          ),
        }),
    ...(requirement.stages === undefined
      ? {}
      : {
          stages: normalizeApprovalStages(requirement.stages).map(
            normalizeStage,
          ),
        }),
  } as T;
};
