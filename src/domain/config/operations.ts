/**
 * EXECUTION ADAPTER BINDINGS, PLAN TEMPLATES, CONFLICT KEYS, RESERVATION RULES,
 * AND VERIFICATION RULES (v3 prompt 10 deliverables 9-12; ADR-0056).
 *
 * A CAPABILITY is the domain-neutral description of one external action; a PLAN
 * TEMPLATE is the DAG over capabilities. Money movement is one step; account
 * opening is five with `dependsOn` and one externally-gated step - which is the
 * evidence that the execution model is not single-shot and not money-movement
 * shaped (falsifier X-1).
 *
 * `targetCapabilityClass` is firm-neutral; `bindDomainConfig` resolves it to an
 * `ExecutionTargetRef` from the firm registry. That seam is what lets a
 * custodian or CRM stay a removable adapter (v3 §8), and it is why account
 * opening can bind INTERNAL house-CRM capabilities with no special case.
 *
 * INVARIANT 20 IS A SCHEMA PROPERTY HERE: `verificationRule` is required and
 * `idempotencyKey` needs at least one segment, so a capability without either
 * is a parse error rather than a review comment.
 *
 * THE E-SIGN GATE IS A VERIFICATION RULE, NOT A NEW STEP KIND. Modelling it as
 * `awaitsExternal: true` needs zero contract amendment; adding an await kind to
 * `ExecutionStep` would change `ExecutionPlan`, which sits inside `DecisionRecord`
 * and therefore inside the decision-hash preimage, forcing a schema-version bump
 * and a fingerprint re-pin for a gate the reconciler model already expresses.
 */
import { z } from "zod";
import {
  DurationSchema,
  ReasonCodeSchema,
  VerificationRuleIdSchema,
} from "@contracts/decision-core/ids";
import { KeySegmentsSchema, ValueSourceSchema } from "./segments";
import {
  InferenceCeilingSchema,
  ReservationCreatePointSchema,
  ReservationReleaseEventSchema,
  kebabId,
} from "./vocabulary";

const OutputNameSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "camelCase name");

/**
 * One field of an external command. Two arms only: a value drawn from exactly
 * one declared source, or a rendered copy template. There is no concatenation
 * and no formatting - the CRM task subject that used to be a template string in
 * the composition root is now a copy key rendered by the one inert renderer.
 *
 * A `text` slot MAY reach a payload (a household name is what a CRM create IS);
 * what it may never reach is a conflict key or an idempotency key, where
 * unbounded user-typed bytes would make a coordination identity unstable. That
 * distinction is load-checked (see load.ts) and is a correction to the design
 * report's blanket "no text slot in a payload" rule (gap register MR-7).
 */
const payloadFieldSchemaImpl = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("value"),
      field: OutputNameSchema,
      source: ValueSourceSchema,
      /** An absent optional field is omitted from the command, never sent as undefined. */
      optional: z.boolean(),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal("copy"),
      field: OutputNameSchema,
      copy: kebabId<"CopyKey">(),
    })
    .readonly(),
]);

/** What a command returns and the context name its value lands under. */
const CommandPublicationSchema = z
  .strictObject({ output: OutputNameSchema, as: OutputNameSchema })
  .readonly();

const executionCapabilitySchemaImpl = z
  .strictObject({
    id: kebabId<"ExecutionCapabilityId">(),
    describes: z.string().min(1),
    targetCapabilityClass: kebabId<"ExecutionTargetClass">(),
    commandType: kebabId<"CommandType">().or(
      z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/, "dotted command type"),
    ),
    payload: z.array(payloadFieldSchemaImpl).readonly(),
    publishes: z.array(CommandPublicationSchema).readonly(),
    idempotencyKey: KeySegmentsSchema,
    conflictKeys: z.array(kebabId<"ConflictKeyTemplateId">()).readonly(),
    reservations: z.array(kebabId<"ReservationId">()).readonly(),
    preconditions: z.array(ReasonCodeSchema).min(1).readonly(),
    verificationRule: VerificationRuleIdSchema,
    /**
     * Which published output carries the external correlation token, for a
     * capability whose verification rule awaits an external observation. Present
     * exactly when that rule declares `awaitsExternal` (load-checked): a gate
     * with no token to be resumed by would never close.
     */
    awaitTokenFrom: OutputNameSchema.optional(),
  })
  .readonly()
  .superRefine((capability, ctx) => {
    const fields = capability.payload.map((entry) => entry.field);
    if (new Set(fields).size !== fields.length) {
      ctx.addIssue({ code: "custom", message: "duplicate payload field", path: ["payload"] });
    }
    const aliases = capability.publishes.map((entry) => entry.as);
    if (new Set(aliases).size !== aliases.length) {
      ctx.addIssue({ code: "custom", message: "duplicate publication alias", path: ["publishes"] });
    }
    const outputs = capability.publishes.map((entry) => entry.output);
    if (new Set(outputs).size !== outputs.length) {
      ctx.addIssue({ code: "custom", message: "duplicate publication output", path: ["publishes"] });
    }
  });

const PlanStepSchema = z
  .strictObject({
    id: kebabId<"ExecutionStepId">(),
    capability: kebabId<"ExecutionCapabilityId">(),
    dependsOn: z.array(kebabId<"ExecutionStepId">()).readonly(),
  })
  .readonly();
export type PlanStep = z.infer<typeof PlanStepSchema>;

const planTemplateSchemaImpl = z
  .strictObject({
    id: kebabId<"PlanTemplateId">(),
    describes: z.string().min(1),
    steps: z.array(PlanStepSchema).min(1).readonly(),
  })
  .readonly()
  .superRefine((template, ctx) => {
    const ids = template.steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "duplicate step id", path: ["steps"] });
    }
    const known = new Set<string>(ids);
    template.steps.forEach((step, index) => {
      for (const dependency of step.dependsOn) {
        if (!known.has(dependency)) {
          ctx.addIssue({
            code: "custom",
            message: `step depends on unknown step ${JSON.stringify(dependency)}`,
            path: ["steps", index, "dependsOn"],
          });
        }
        if (dependency === step.id) {
          ctx.addIssue({ code: "custom", message: "a step may not depend on itself", path: ["steps", index] });
        }
      }
    });
  });

const conflictKeyTemplateSchemaImpl = z
  .strictObject({
    id: kebabId<"ConflictKeyTemplateId">(),
    describes: z.string().min(1),
    segments: KeySegmentsSchema,
  })
  .readonly();

const reservationRuleSchemaImpl = z
  .strictObject({
    id: kebabId<"ReservationId">(),
    describes: z.string().min(1),
    resourceKind: kebabId<"ResourceKind">(),
    conflictKey: kebabId<"ConflictKeyTemplateId">(),
    quantity: ValueSourceSchema,
    /**
     * WHEN the reservation is created. Configured rather than coded because the
     * timing question ("reserve at decision commit, then revalidate after
     * approval") is a standing product ruling this section CONSUMES; a coded
     * default would put contested truth inside signed-case territory.
     */
    createAt: ReservationCreatePointSchema,
    ttl: DurationSchema,
    extendToApprovalWindow: z.boolean(),
    releaseOn: z.array(ReservationReleaseEventSchema).min(1).readonly(),
    /**
     * The binding this reservation becomes a CLAIM to. This one field is what
     * makes a sibling request's reservation visible to net availability, so two
     * individually valid requests become jointly blocked with a distinct code
     * instead of both proceeding.
     */
    visibleAsClaimTo: kebabId<"PrimitiveBindingId">().optional(),
  })
  .readonly();

const verificationRuleSchemaImpl = z
  .strictObject({
    id: VerificationRuleIdSchema,
    describes: z.string().min(1),
    observedStatuses: z.array(kebabId<"ObservedStatus">()).min(1).readonly(),
    closesWhen: z
      .strictObject({
        status: kebabId<"ObservedStatus">(),
        proof: z.array(kebabId<"ProofKind">()).min(1).readonly(),
      })
      .readonly(),
    lateIngest: z.array(kebabId<"ObservedStatus">()).readonly(),
    /** The externally-gated step: the plan does not advance until this rule closes. */
    awaitsExternal: z.boolean(),
    pollInterval: DurationSchema.optional(),
    unknownTimeout: DurationSchema.optional(),
    stuckAfter: DurationSchema.optional(),
    /** v3 §14's honesty rule as data: never report a state stronger than observed. */
    neverInferStrongerThan: InferenceCeilingSchema,
  })
  .readonly()
  .superRefine((rule, ctx) => {
    const statuses = new Set<string>(rule.observedStatuses);
    if (statuses.size !== rule.observedStatuses.length) {
      ctx.addIssue({ code: "custom", message: "duplicate observed status", path: ["observedStatuses"] });
    }
    if (!statuses.has(rule.closesWhen.status)) {
      ctx.addIssue({
        code: "custom",
        message: "closesWhen names a status this rule cannot observe",
        path: ["closesWhen", "status"],
      });
    }
    for (const [index, status] of rule.lateIngest.entries()) {
      if (!statuses.has(status)) {
        ctx.addIssue({
          code: "custom",
          message: "lateIngest names a status this rule cannot observe",
          path: ["lateIngest", index],
        });
      }
    }
  });

const executionSectionSchemaImpl = z
  .strictObject({
    capabilities: z.array(executionCapabilitySchemaImpl).readonly(),
    planTemplates: z.array(planTemplateSchemaImpl).min(1).readonly(),
  })
  .readonly();


/**
 * COLLAPSED EXPORT (D-193). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-193)
export interface ExecutionCapability extends z.infer<typeof executionCapabilitySchemaImpl> {}

/**
 * COLLAPSED EXPORT (D-193). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-193)
export interface ConflictKeyTemplate extends z.infer<typeof conflictKeyTemplateSchemaImpl> {}
export const ConflictKeyTemplateSchema: z.ZodType<ConflictKeyTemplate> = conflictKeyTemplateSchemaImpl;

/**
 * COLLAPSED EXPORT (D-193). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-193)
export interface ReservationRule extends z.infer<typeof reservationRuleSchemaImpl> {}
export const ReservationRuleSchema: z.ZodType<ReservationRule> = reservationRuleSchemaImpl;

/**
 * COLLAPSED EXPORT (D-193). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-193)
export interface VerificationRule extends z.infer<typeof verificationRuleSchemaImpl> {}
export const VerificationRuleSchema: z.ZodType<VerificationRule> = verificationRuleSchemaImpl;

/**
 * COLLAPSED EXPORT (D-193). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-193)
export interface ExecutionSection extends z.infer<typeof executionSectionSchemaImpl> {}
export const ExecutionSectionSchema: z.ZodType<ExecutionSection> = executionSectionSchemaImpl;
