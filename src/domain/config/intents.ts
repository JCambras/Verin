/**
 * SUPPORTED INTENTS AND SLOT REQUIREMENTS (v3 prompt 10 deliverable 1-2;
 * ADR-0058).
 *
 * An intent is what a domain can be ASKED for; slots are what must be bound
 * before anyone may decide. Two facts live here that nothing else in the repo
 * supplies: `riskClass` and `reversibility`. Both are required fields of
 * `DecisionRecord` (decision.ts) and both are DOMAIN facts, not firm judgment.
 * If the configuration did not carry them, the Wave D evaluator would have to
 * invent them - which is precisely the domain-named evaluator branch invariant 3
 * exists to forbid.
 */
import { z } from "zod";
import { RiskClassSchema } from "@contracts/decision-core/decision";
import { EvidenceKindSchema } from "@contracts/decision-core/ids";
import {
  ContextKeySchema,
  MoneyUnitSchema,
  RESERVED_TRIGGER_FIELDS,
  SlotNameSchema,
  SlotResolutionSchema,
  SlotTypeSchema,
  SubjectKindSchema,
  TriggerFieldSchema,
  TriggerKindSchema,
  kebabId,
} from "./vocabulary";

/** Which binding fills a `bound-by-primitive` slot, and under which published key. */
const SlotBindingSchema = z
  .strictObject({
    binding: kebabId<"PrimitiveBindingId">(),
    publishes: ContextKeySchema,
  })
  .readonly();

/**
 * One slot. The optional fields are made mandatory-by-type through the
 * refinements below rather than by a discriminated union: a union on `type`
 * would re-parse every arm for a shape whose only variation is three optional
 * keys, and the load-time message ("a money slot must declare its unit") is far
 * better than "no union arm matched".
 */
const slotSchemaImpl = z
  .strictObject({
    /**
     * The slot's identifier. Named `id` (not `name`) to match every other
     * section's identifier field AND to keep the PII field-name heuristic
     * honest: a bare `name` on a configuration type reads as a person's name to
     * the llm-pii-boundary detector, and one fewer reviewed escape is one fewer
     * place a real PII field could later hide.
     */
    id: SlotNameSchema,
    /** Human description - the genesis-interview clipboard reads these (D-098). */
    describes: z.string().min(1),
    type: SlotTypeSchema,
    required: z.boolean(),
    resolution: SlotResolutionSchema,
    unit: MoneyUnitSchema.optional(),
    subjectKind: SubjectKindSchema.optional(),
    values: z.array(z.string().min(1)).min(1).readonly().optional(),
    maxLength: z.int().positive().max(4096).optional(),
    boundBy: SlotBindingSchema.optional(),
    /**
     * The transport field a trigger-supplied slot reads. This is the declared
     * bridge between a shipped route's camelCase payload (which CD-1 keeps
     * unrenamed) and the domain's kebab-case slot vocabulary, so no adapter has
     * to know a domain's field names.
     */
    triggerField: TriggerFieldSchema.optional(),
  })
  .readonly()
  .superRefine((slot, ctx) => {
    const require = (condition: boolean, message: string, path: string): void => {
      if (!condition) ctx.addIssue({ code: "custom", message, path: [path] });
    };
    require(slot.type !== "money" || slot.unit !== undefined, "a money slot must declare its unit", "unit");
    require(slot.type === "money" || slot.unit === undefined, "only a money slot may declare a unit", "unit");
    require(
      slot.type !== "subject" || slot.subjectKind !== undefined,
      "a subject slot must declare its subject kind",
      "subjectKind",
    );
    require(
      slot.type === "subject" || slot.subjectKind === undefined,
      "only a subject slot may declare a subject kind",
      "subjectKind",
    );
    require(slot.type !== "enum" || slot.values !== undefined, "an enum slot must declare its values", "values");
    require(slot.type === "enum" || slot.values === undefined, "only an enum slot may declare values", "values");
    require(slot.type === "text" || slot.maxLength === undefined, "only a text slot may declare a maximum length", "maxLength");
    require(slot.type !== "text" || slot.maxLength !== undefined, "a text slot must declare a maximum length", "maxLength");
    require(
      slot.resolution !== "bound-by-primitive" || slot.boundBy !== undefined,
      "a bound-by-primitive slot must name the binding and published key that fills it",
      "boundBy",
    );
    require(
      slot.resolution === "bound-by-primitive" || slot.boundBy === undefined,
      "only a bound-by-primitive slot may declare boundBy",
      "boundBy",
    );
    require(
      slot.values === undefined || new Set(slot.values).size === slot.values.length,
      "duplicate enum value",
      "values",
    );
    require(
      slot.resolution !== "supplied-by-trigger" || slot.triggerField !== undefined,
      "a trigger-supplied slot must declare the transport field it reads",
      "triggerField",
    );
    require(
      slot.resolution === "supplied-by-trigger" || slot.triggerField === undefined,
      "only a trigger-supplied slot may declare a transport field",
      "triggerField",
    );
  });

const intentSchemaImpl = z
  .strictObject({
    id: kebabId<"ActionId">(),
    describes: z.string().min(1),
    riskClass: RiskClassSchema,
    reversibility: z.enum(["reversible", "partially_reversible", "irreversible"]),
    triggerKinds: z.array(TriggerKindSchema).min(1).readonly(),
    slots: z.array(slotSchemaImpl).min(1).readonly(),
    requiresEvidence: z.array(EvidenceKindSchema).readonly(),
    primitiveBindings: z.array(kebabId<"PrimitiveBindingId">()).readonly(),
    /** Optional: a domain may have no firm-configurable policy surface at all. */
    policySlot: kebabId<"PolicyId">().optional(),
    conflictKeys: z.array(kebabId<"ConflictKeyTemplateId">()).readonly(),
    reservations: z.array(kebabId<"ReservationId">()).readonly(),
    executionPlan: kebabId<"PlanTemplateId">(),
  })
  .readonly()
  .superRefine((intent, ctx) => {
    const duplicate = <T>(values: readonly T[]): boolean => new Set(values).size !== values.length;
    if (duplicate(intent.slots.map((slot) => slot.id))) {
      ctx.addIssue({ code: "custom", message: "duplicate slot name", path: ["slots"] });
    }
    // A transport field is a KEY, not a label: two slots reading one field would
    // render two controls sharing an id and a name, and one submitted value would
    // overwrite the other before either slot resolved.
    const triggerFields = intent.slots
      .map((slot) => slot.triggerField)
      .filter((field): field is string => field !== undefined);
    if (duplicate(triggerFields)) {
      ctx.addIssue({ code: "custom", message: "duplicate slot trigger field", path: ["slots"] });
    }
    // The platform writes its own keys into flow data AFTER the caller's values,
    // so a slot reading one would resolve to the execution id rather than to what
    // the requester supplied - silently, unlike every other slot mistake here.
    const reserved: readonly string[] = RESERVED_TRIGGER_FIELDS;
    for (const field of triggerFields.filter((candidate) => reserved.includes(candidate))) {
      ctx.addIssue({
        code: "custom",
        message: `slot trigger field ${JSON.stringify(field)} is reserved by the platform`,
        path: ["slots"],
      });
    }
    const idLists: readonly (readonly [string, readonly string[]])[] = [
      ["requiresEvidence", intent.requiresEvidence],
      ["primitiveBindings", intent.primitiveBindings],
      ["conflictKeys", intent.conflictKeys],
      ["reservations", intent.reservations],
    ];
    for (const [key, values] of idLists) {
      if (duplicate(values)) {
        ctx.addIssue({ code: "custom", message: `duplicate ${key} entry`, path: [key] });
      }
    }
  });

/**
 * COLLAPSED EXPORT (D-222). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-222)
export interface ConfiguredSlot extends z.infer<typeof slotSchemaImpl> {}

/**
 * COLLAPSED EXPORT (D-222). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-222)
export interface ConfiguredIntent extends z.infer<typeof intentSchemaImpl> {}
export const IntentSchema: z.ZodType<ConfiguredIntent> = intentSchemaImpl;
