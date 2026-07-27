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
}).readonly();
export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;

/** A condition proven before the decision that must still hold when the step runs. */
export const ExecutionPreconditionSchema = z.strictObject({
  code: z.string().min(1),
  requiredEvidenceSnapshotRefs: z.array(EvidenceSnapshotIdRefSchema).readonly(),
  mustStillHoldAtExecution: z.boolean(),
}).readonly();
export type ExecutionPrecondition = z.infer<typeof ExecutionPreconditionSchema>;

/** The recorded undo issued if a later step fails after this one succeeded. */
export const CompensatingActionSchema = z.strictObject({
  targetId: ExecutionTargetIdSchema,
  command: ExecutionCommandSchema,
  reasonCode: ReasonCodeSchema,
}).readonly();
export type CompensatingAction = z.infer<typeof CompensatingActionSchema>;

export const ExecutionStepSchema = z.strictObject({
  id: ExecutionStepIdSchema,
  targetId: ExecutionTargetIdSchema,
  command: ExecutionCommandSchema,
  idempotencyKey: z.string().min(1),
  conflictKeys: z.array(ConflictKeySchema).readonly(),
  reservationRefs: z.array(ReservationIdSchema).readonly(),
  preconditions: z.array(ExecutionPreconditionSchema).readonly(),
  verificationRuleId: VerificationRuleIdSchema,
  dependsOn: z.array(ExecutionStepIdSchema).readonly(),
  compensatingAction: CompensatingActionSchema.optional(),
}).readonly();
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
