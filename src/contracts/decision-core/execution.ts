/**
 * Execution-plan contracts (v3 §5; ratified shapes: docs/v3/verin-core-contracts.ts;
 * ADR-0029, D-040). A plan exists ONLY inside a proceed decision (decision.ts).
 * Every step is idempotent and retry-safe by construction (charter #16): it carries
 * its idempotency key, conflict keys, reservations, preconditions that must still
 * hold at execution, its verification rule, and dependency edges for
 * dependency-aware ordering (prompt 25's planner consumes them).
 */
import { z } from "zod";
import {
  ConflictKeySchema,
  EvidenceSnapshotIdRefSchema,
  ExecutionPlanIdSchema,
  ExecutionStepIdSchema,
  ExecutionTargetRefSchema,
  HashSchema,
  ReasonCodeSchema,
  ReservationRefSchema,
  SecureBlobRefSchema,
  VerificationRuleRefSchema,
  compareCanonicalStrings,
  compareExecutionPreconditions,
  hasUniqueByComparator,
  hasUniqueScopedReferences,
  normalizeCanonicalStrings,
  normalizeExecutionPreconditions,
  normalizeScopedReferences,
  withTenantClosure,
} from "./ids";
import { isPlainRecord } from "./normalization";

/** The externally-executable command: payload behind a blob ref, pinned by hash. */
export const ExecutionCommandSchema = z.strictObject({
  commandType: z.string().min(1),
  payloadRef: SecureBlobRefSchema,
  payloadHash: HashSchema,
}).readonly();
export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;

type NormalizableExecutionPrecondition = {
  readonly code: string;
  readonly requiredEvidenceSnapshotRefs: readonly {
    readonly firmId: string;
    readonly id: string;
  }[];
  readonly mustStillHoldAtExecution: true;
};

const normalizeExecutionPrecondition = <T extends NormalizableExecutionPrecondition>(
  precondition: T,
): T => {
  if (!isPlainRecord(precondition)) return precondition;
  return {
    ...precondition,
    requiredEvidenceSnapshotRefs: normalizeScopedReferences(
      precondition.requiredEvidenceSnapshotRefs,
    ),
  } as T;
};

/** A condition proven before the decision that must still hold when the step runs. */
export const ExecutionPreconditionSchema = z
  .strictObject({
    code: z.string().min(1),
    requiredEvidenceSnapshotRefs: z
      .array(EvidenceSnapshotIdRefSchema)
      .min(1)
      .refine(hasUniqueScopedReferences, "duplicate required evidence snapshot reference")
      .refine(
        (refs) => refs.every((ref) => ref.firmId === refs[0]?.firmId),
        "required evidence snapshots must belong to one tenant",
      )
      .overwrite(normalizeScopedReferences)
      .readonly(),
    mustStillHoldAtExecution: z.literal(true),
  })
  .readonly();
export type ExecutionPrecondition = z.infer<typeof ExecutionPreconditionSchema>;

const retrySafeExternalActionShape = {
  targetRef: ExecutionTargetRefSchema,
  command: ExecutionCommandSchema,
  idempotencyKey: z.string().min(1),
  conflictKeys: z
    .array(ConflictKeySchema)
    .min(1)
    .refine(
      (keys) => hasUniqueByComparator(keys, compareCanonicalStrings),
      "duplicate conflict key",
    )
    .overwrite(normalizeCanonicalStrings)
    .readonly(),
  reservationRefs: z
    .array(ReservationRefSchema)
    .refine(hasUniqueScopedReferences, "duplicate reservation reference")
    .overwrite(normalizeScopedReferences)
    .readonly(),
  preconditions: z
    .array(ExecutionPreconditionSchema)
    .min(1)
    .refine(
      (preconditions) =>
        hasUniqueByComparator(preconditions, compareExecutionPreconditions),
      "duplicate execution precondition",
    )
    .overwrite(normalizeExecutionPreconditions)
    .readonly(),
  verificationRuleRef: VerificationRuleRefSchema,
};

type NormalizableExternalAction = {
  readonly conflictKeys: readonly string[];
  readonly reservationRefs: readonly {
    readonly firmId: string;
    readonly id: string;
  }[];
  readonly preconditions: readonly NormalizableExecutionPrecondition[];
};

const normalizeExternalAction = <T extends NormalizableExternalAction>(
  action: T,
): T => {
  if (!isPlainRecord(action)) return action;
  return {
    ...action,
    conflictKeys: normalizeCanonicalStrings(action.conflictKeys),
    reservationRefs: normalizeScopedReferences(action.reservationRefs),
    preconditions: normalizeExecutionPreconditions(
      action.preconditions.map(normalizeExecutionPrecondition),
    ),
  } as T;
};

const requireActionTenant = (
  action: {
    targetRef: { firmId: string };
    command: { payloadRef: { firmId: string } };
    reservationRefs: readonly { firmId: string }[];
    preconditions: readonly {
      requiredEvidenceSnapshotRefs: readonly { firmId: string }[];
    }[];
    verificationRuleRef: { firmId: string };
  },
  ctx: z.RefinementCtx,
): void => {
  const firmId = action.targetRef.firmId;
  const requireSameFirm = (ref: { firmId: string }, path: (string | number)[]) => {
    if (ref.firmId !== firmId) {
      ctx.addIssue({
        code: "custom",
        message: "external-action references must belong to one tenant",
        path,
      });
    }
  };
  requireSameFirm(action.command.payloadRef, ["command", "payloadRef", "firmId"]);
  action.reservationRefs.forEach((ref, index) =>
    requireSameFirm(ref, ["reservationRefs", index, "firmId"]),
  );
  action.preconditions.forEach((precondition, preconditionIndex) =>
    precondition.requiredEvidenceSnapshotRefs.forEach((ref, refIndex) =>
      requireSameFirm(ref, [
        "preconditions",
        preconditionIndex,
        "requiredEvidenceSnapshotRefs",
        refIndex,
        "firmId",
      ]),
    ),
  );
  requireSameFirm(action.verificationRuleRef, ["verificationRuleRef", "firmId"]);
};

export const RetrySafeExternalActionSchema = z
  .strictObject(retrySafeExternalActionShape)
  .superRefine(requireActionTenant)
  .readonly();
export type RetrySafeExternalAction = z.infer<typeof RetrySafeExternalActionSchema>;

export const CompensatingActionSchema = z
  .strictObject({
    ...retrySafeExternalActionShape,
    reasonCode: ReasonCodeSchema,
  })
  .superRefine(requireActionTenant)
  .readonly();
export type CompensatingAction = z.infer<typeof CompensatingActionSchema>;

export const ExecutionStepSchema = withTenantClosure(
  z.strictObject({
    id: ExecutionStepIdSchema,
    ...retrySafeExternalActionShape,
    dependsOn: z
      .array(ExecutionStepIdSchema)
      .refine(
        (dependencies) =>
          hasUniqueByComparator(dependencies, compareCanonicalStrings),
        "duplicate execution dependency",
      )
      .overwrite(normalizeCanonicalStrings)
      .readonly(),
    compensatingAction: CompensatingActionSchema.optional(),
  })
  .superRefine(requireActionTenant)
  .superRefine((step, ctx) => {
    if (step.dependsOn.includes(step.id)) {
      ctx.addIssue({
        code: "custom",
        message: "an execution step cannot depend on itself",
        path: ["dependsOn"],
      });
    }
    if (
      step.compensatingAction !== undefined &&
      step.compensatingAction.targetRef.firmId !== step.targetRef.firmId
    ) {
      ctx.addIssue({
        code: "custom",
        message: "compensating action must belong to the step tenant",
        path: ["compensatingAction", "targetRef", "firmId"],
      });
    }
    if (
      step.compensatingAction !== undefined &&
      step.compensatingAction.idempotencyKey === step.idempotencyKey
    ) {
      ctx.addIssue({
        code: "custom",
        message: "a compensating action must use a distinct idempotency key",
        path: ["compensatingAction", "idempotencyKey"],
      });
    }
  })
    .readonly(),
);
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

type NormalizableExecutionPlan = {
  readonly steps: readonly (NormalizableExternalAction & {
    readonly dependsOn: readonly string[];
    readonly compensatingAction?: NormalizableExternalAction;
  })[];
};

export const normalizeExecutionPlan = <T extends NormalizableExecutionPlan>(
  plan: T,
): T => {
  if (!isPlainRecord(plan)) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      if (!isPlainRecord(step)) return step;
      return {
        ...normalizeExternalAction(step),
        dependsOn: normalizeCanonicalStrings(step.dependsOn),
        ...(step.compensatingAction === undefined
          ? {}
          : {
              compensatingAction: normalizeExternalAction(
                step.compensatingAction,
              ),
            }),
      };
    }),
  } as T;
};

/**
 * A non-empty plan with unique identities, resolvable dependency edges, and an
 * acyclic dependency graph.
 */
export const ExecutionPlanSchema = withTenantClosure(
  z.strictObject({
    id: ExecutionPlanIdSchema,
    steps: z.array(ExecutionStepSchema).min(1).readonly(),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    const idemKeys = new Set<string>();
    let dependenciesValid = true;
    const registerIdempotencyKey = (key: string, path: (string | number)[]) => {
      if (idemKeys.has(key)) {
        ctx.addIssue({ code: "custom", message: `duplicate idempotency key "${key}"`, path });
      }
      idemKeys.add(key);
    };
    for (const [index, step] of plan.steps.entries()) {
      if (ids.has(step.id)) ctx.addIssue({ code: "custom", message: `duplicate step id "${step.id}"`, path: ["steps"] });
      ids.add(step.id);
      registerIdempotencyKey(step.idempotencyKey, ["steps", index, "idempotencyKey"]);
      if (step.compensatingAction) {
        registerIdempotencyKey(step.compensatingAction.idempotencyKey, [
          "steps",
          index,
          "compensatingAction",
          "idempotencyKey",
        ]);
      }
    }
    plan.steps.forEach((step, i) => {
      for (const dep of step.dependsOn) {
        if (dep === step.id) {
          dependenciesValid = false;
          ctx.addIssue({ code: "custom", message: `step "${step.id}" depends on itself`, path: ["steps", i, "dependsOn"] });
        } else if (!ids.has(dep)) {
          dependenciesValid = false;
          ctx.addIssue({ code: "custom", message: `step "${step.id}" depends on unknown step "${dep}"`, path: ["steps", i, "dependsOn"] });
        }
      }
    });
    if (dependenciesValid && ids.size === plan.steps.length) {
      const incoming = new Map<string, number>(plan.steps.map((step) => [step.id, step.dependsOn.length]));
      const dependents = new Map<string, string[]>(plan.steps.map((step) => [step.id, []]));
      for (const step of plan.steps) {
        for (const dep of step.dependsOn) dependents.get(dep)?.push(step.id);
      }
      const ready: string[] = plan.steps.filter((step) => incoming.get(step.id) === 0).map((step) => step.id);
      for (let i = 0; i < ready.length; i += 1) {
        for (const dependent of dependents.get(ready[i]!) ?? []) {
          const remaining = (incoming.get(dependent) ?? 0) - 1;
          incoming.set(dependent, remaining);
          if (remaining === 0) ready.push(dependent);
        }
      }
      if (ready.length !== plan.steps.length) {
        ctx.addIssue({ code: "custom", message: "execution plan dependency graph contains a cycle", path: ["steps"] });
      }
    }
  })
    .readonly(),
);
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
