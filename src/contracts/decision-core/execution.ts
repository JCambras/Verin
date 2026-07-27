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
} from "./ids";

/** The externally-executable command: payload behind a blob ref, pinned by hash. */
export const ExecutionCommandSchema = z.strictObject({
  commandType: z.string().min(1),
  payloadRef: SecureBlobRefSchema,
  payloadHash: HashSchema,
}).readonly();
export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;

const uniqueStrings = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const uniqueScopedReferences = (
  values: readonly { firmId: string; id: string }[],
): boolean =>
  new Set(values.map((value) => `${value.firmId}\u0000${value.id}`)).size === values.length;

/** A condition proven before the decision that must still hold when the step runs. */
export const ExecutionPreconditionSchema = z.strictObject({
  code: z.string().min(1),
  requiredEvidenceSnapshotRefs: z
    .array(EvidenceSnapshotIdRefSchema)
    .refine(uniqueScopedReferences, "duplicate required evidence snapshot reference")
    .readonly(),
  mustStillHoldAtExecution: z.literal(true),
}).readonly();
export type ExecutionPrecondition = z.infer<typeof ExecutionPreconditionSchema>;

const retrySafeExternalActionShape = {
  targetRef: ExecutionTargetRefSchema,
  command: ExecutionCommandSchema,
  idempotencyKey: z.string().min(1),
  conflictKeys: z
    .array(ConflictKeySchema)
    .min(1)
    .refine(uniqueStrings, "duplicate conflict key")
    .readonly(),
  reservationRefs: z
    .array(ReservationRefSchema)
    .refine(uniqueScopedReferences, "duplicate reservation reference")
    .readonly(),
  preconditions: z.array(ExecutionPreconditionSchema).min(1).readonly(),
  verificationRuleRef: VerificationRuleRefSchema,
};

const requirePayloadTenant = (
  action: {
    targetRef: { firmId: string };
    command: { payloadRef: { firmId: string } };
  },
  ctx: z.RefinementCtx,
): void => {
  if (action.command.payloadRef.firmId !== action.targetRef.firmId) {
    ctx.addIssue({
      code: "custom",
      message: "payloadRef.firmId must match the execution target tenant",
      path: ["command", "payloadRef", "firmId"],
    });
  }
};

export const RetrySafeExternalActionSchema = z
  .strictObject(retrySafeExternalActionShape)
  .superRefine(requirePayloadTenant)
  .readonly();
export type RetrySafeExternalAction = z.infer<typeof RetrySafeExternalActionSchema>;

export const CompensatingActionSchema = z
  .strictObject({
    ...retrySafeExternalActionShape,
    reasonCode: ReasonCodeSchema,
  })
  .superRefine(requirePayloadTenant)
  .readonly();
export type CompensatingAction = z.infer<typeof CompensatingActionSchema>;

export const ExecutionStepSchema = z
  .strictObject({
    id: ExecutionStepIdSchema,
    ...retrySafeExternalActionShape,
    dependsOn: z
      .array(ExecutionStepIdSchema)
      .refine(uniqueStrings, "duplicate execution dependency")
      .readonly(),
    compensatingAction: CompensatingActionSchema.optional(),
  })
  .superRefine(requirePayloadTenant)
  .readonly();
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

/**
 * A non-empty plan with unique identities, resolvable dependency edges, and an
 * acyclic dependency graph.
 */
export const ExecutionPlanSchema = z
  .strictObject({
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
  .readonly();
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
