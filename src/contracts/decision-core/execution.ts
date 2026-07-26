/**
 * Execution-plan contracts (v3 §5; ratified shapes: docs/v3/verin-core-contracts.ts;
 * ADR-0029, D-036). A plan exists ONLY inside a proceed decision (decision.ts).
 * Every step is idempotent and retry-safe by construction (charter #16): it carries
 * its idempotency key, conflict keys, reservations, preconditions that must still
 * hold at execution, its verification rule, and dependency edges for
 * dependency-aware ordering (prompt 25's planner consumes them).
 */
import { z } from "zod";
import {
  ConflictKeySchema,
  EvidenceSnapshotIdSchema,
  ExecutionPlanIdSchema,
  ExecutionStepIdSchema,
  ExecutionTargetIdSchema,
  HashSchema,
  ReasonCodeSchema,
  ReservationIdSchema,
  SecureBlobRefSchema,
  VerificationRuleIdSchema,
} from "./ids";

/** The externally-executable command: payload behind a blob ref, pinned by hash. */
export const ExecutionCommandSchema = z.strictObject({
  commandType: z.string().min(1),
  payloadRef: SecureBlobRefSchema,
  payloadHash: HashSchema,
});
export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;

/** A condition proven before the decision that must still hold when the step runs. */
export const ExecutionPreconditionSchema = z.strictObject({
  code: z.string().min(1),
  requiredEvidenceSnapshotIds: z.array(EvidenceSnapshotIdSchema),
  mustStillHoldAtExecution: z.boolean(),
});
export type ExecutionPrecondition = z.infer<typeof ExecutionPreconditionSchema>;

/** The recorded undo issued if a later step fails after this one succeeded. */
export const CompensatingActionSchema = z.strictObject({
  targetId: ExecutionTargetIdSchema,
  command: ExecutionCommandSchema,
  reasonCode: ReasonCodeSchema,
});
export type CompensatingAction = z.infer<typeof CompensatingActionSchema>;

export const ExecutionStepSchema = z.strictObject({
  id: ExecutionStepIdSchema,
  targetId: ExecutionTargetIdSchema,
  command: ExecutionCommandSchema,
  idempotencyKey: z.string().min(1),
  conflictKeys: z.array(ConflictKeySchema),
  reservationRefs: z.array(ReservationIdSchema),
  preconditions: z.array(ExecutionPreconditionSchema),
  verificationRuleId: VerificationRuleIdSchema,
  dependsOn: z.array(ExecutionStepIdSchema),
  compensatingAction: CompensatingActionSchema.optional(),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

/**
 * A non-empty, internally-consistent plan. Empty would be "proceed without a plan"
 * (v3 invariant 7) wearing a wrapper. Structural integrity is parse-time: step ids
 * unique, idempotency keys unique (two steps sharing one would alias retries),
 * dependsOn edges resolve inside the plan, and no step depends on itself. Full
 * cycle/ordering semantics belong to the planner (prompt 25), not the schema.
 */
export const ExecutionPlanSchema = z
  .strictObject({
    id: ExecutionPlanIdSchema,
    steps: z.array(ExecutionStepSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    const idemKeys = new Set<string>();
    for (const step of plan.steps) {
      if (ids.has(step.id)) ctx.addIssue({ code: "custom", message: `duplicate step id "${step.id}"`, path: ["steps"] });
      ids.add(step.id);
      if (idemKeys.has(step.idempotencyKey)) {
        ctx.addIssue({ code: "custom", message: `duplicate idempotency key "${step.idempotencyKey}"`, path: ["steps"] });
      }
      idemKeys.add(step.idempotencyKey);
    }
    plan.steps.forEach((step, i) => {
      for (const dep of step.dependsOn) {
        if (dep === step.id) ctx.addIssue({ code: "custom", message: `step "${step.id}" depends on itself`, path: ["steps", i, "dependsOn"] });
        else if (!ids.has(dep)) ctx.addIssue({ code: "custom", message: `step "${step.id}" depends on unknown step "${dep}"`, path: ["steps", i, "dependsOn"] });
      }
    });
  });
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;
