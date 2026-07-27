/**
 * Trigger, Intent, and resolution-state contracts (v3 §5; ratified shapes:
 * docs/v3/verin-core-contracts.ts; ADR-0029, D-040). Human requests and system
 * events converge on ONE Intent shape (prompt 12 builds the pipeline; the type
 * lands here so both entry paths are already the same thing).
 */
import { z } from "zod";
import {
  DomainConfigVersionRefSchema,
  EvidenceKindSchema,
  EvidenceSourceRefSchema,
  FirmIdSchema,
  IntentIdSchema,
  PrimitiveIdSchema,
  ReasonCodeSchema,
  RoleRefSchema,
  SecureEventRefSchema,
  SecureRequestRefSchema,
  SlotRefSchema,
  SubjectRefSchema,
  TimestampSchema,
  type ScopedReference,
  canonicalizeValues,
  compareScopedReferences,
  hasUniqueScopedReferences,
} from "./ids";
import { ActorRefSchema, TenantContextSchema, TokenizedPayloadSchema, TokenizedStringSchema } from "./actor";

/**
 * Each trigger arm carries its OWN tenant checks and the union is composed from the
 * refined arms - never from bare object schemas with the checks restated inline. A
 * second copy would be the copy that actually runs, so a check added here could
 * silently not apply to a Trigger parsed through IntentSchema (ADR-0029, D-051).
 */

/** A human request: the raw text stays behind SecureRequestRef; only the tokenized form travels. */
const HumanRequestTriggerObjectSchema = z
  .strictObject({
    kind: z.literal("human_request"),
    requester: ActorRefSchema,
    requestRef: SecureRequestRefSchema,
    maskedRequest: TokenizedStringSchema,
  })
  .superRefine((trigger, ctx) => {
    if (trigger.requestRef.firmId !== trigger.requester.firmId) {
      ctx.addIssue({
        code: "custom",
        message: "requestRef.firmId must match the human request tenant",
        path: ["requestRef", "firmId"],
      });
    }
  });

/** A system event from an evidence source: payload tokenized, raw body behind SecureEventRef. */
const SystemEventTriggerObjectSchema = z
  .strictObject({
    kind: z.literal("system_event"),
    firmId: FirmIdSchema,
    sourceRef: EvidenceSourceRefSchema,
    eventType: z.string().min(1),
    eventRef: SecureEventRefSchema,
    tokenizedPayload: TokenizedPayloadSchema,
  })
  .superRefine((trigger, ctx) => {
    if (trigger.sourceRef.firmId !== trigger.firmId) {
      ctx.addIssue({
        code: "custom",
        message: "sourceRef.firmId must match the system event tenant",
        path: ["sourceRef", "firmId"],
      });
    }
    if (trigger.eventRef.firmId !== trigger.firmId) {
      ctx.addIssue({
        code: "custom",
        message: "eventRef.firmId must match the system event tenant",
        path: ["eventRef", "firmId"],
      });
    }
  });

export const TriggerSchema = z
  .discriminatedUnion("kind", [HumanRequestTriggerObjectSchema, SystemEventTriggerObjectSchema])
  .readonly();
export type Trigger = z.infer<typeof TriggerSchema>;

/** The tenant a trigger belongs to (requester's firm for human requests). */
function triggerFirmId(trigger: Trigger): z.infer<typeof FirmIdSchema> {
  return trigger.kind === "human_request" ? trigger.requester.firmId : trigger.firmId;
}

/**
 * The governed intent both trigger paths produce: a primitive action plus bound
 * slots, pinned to the domain-config version that will interpret it. Cross-tenant
 * assembly (an Intent scoped to one firm carrying another firm's trigger) is a
 * parse error, not a convention.
 */
export const IntentSchema = TenantContextSchema.unwrap().extend({
  id: IntentIdSchema,
  trigger: TriggerSchema,
  domainConfigVersionRef: DomainConfigVersionRefSchema,
  action: PrimitiveIdSchema,
  slots: z.record(z.string().min(1), SlotRefSchema).readonly(),
  createdAt: TimestampSchema,
})
  .superRefine((intent, ctx) => {
    if (triggerFirmId(intent.trigger) !== intent.firmId) {
      ctx.addIssue({
        code: "custom",
        message: "intent.firmId must match the trigger's tenant (cross-tenant intents are unrepresentable)",
        path: ["firmId"],
      });
    }
    if (intent.domainConfigVersionRef.firmId !== intent.firmId) {
      ctx.addIssue({
        code: "custom",
        message: "domainConfigVersionRef.firmId must match the intent tenant",
        path: ["domainConfigVersionRef", "firmId"],
      });
    }
  })
  .readonly();
export type Intent = z.infer<typeof IntentSchema>;

/**
 * An unresolved slot: candidate subjects plus the coded question a human must answer.
 * ONE slot's alternatives are a canonically-ordered tenant-scoped set like every other
 * reference collection here, checked cross-field the way EvidenceRequest below is
 * because this record carries no enclosing firmId of its own (D-057).
 */
export const AmbiguityRefSchema = z.strictObject({
  slotName: z.string().min(1),
  candidateRefs: z.array(SubjectRefSchema).min(1)
    .refine(hasUniqueScopedReferences, "duplicate candidate subject reference")
    .refine((refs) => refs.every((ref) => ref.firmId === refs[0]?.firmId), "candidate subjects must belong to one tenant")
    .overwrite((refs) => canonicalizeValues(refs, compareScopedReferences)).readonly(),
  humanQuestionCode: z.string().min(1),
}).readonly();
export type AmbiguityRef = z.infer<typeof AmbiguityRefSchema>;

/**
 * A request for evidence someone can actually supply. suppliableBy is non-empty:
 * an evidence request nobody may satisfy would make its blocker unresolvable -
 * that state is a prohibition and must be modeled as one, never reached by decay.
 */
const EvidenceSupplierSchema = z.union([z.literal("client"), z.literal("external"), RoleRefSchema]);

/** Well-known suppliers sort before role references; roles use THE scoped order. */
export const compareEvidenceSuppliers = (
  left: string | ScopedReference,
  right: string | ScopedReference,
): number => {
  if (typeof left === "string") {
    if (typeof right !== "string") return -1;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof right === "string") return 1;
  return compareScopedReferences(left, right);
};

const EvidenceSupplierSetSchema = z
  .array(EvidenceSupplierSchema)
  .min(1)
  .refine((suppliers) => {
    const roleRefs = suppliers.filter((supplier) => typeof supplier !== "string");
    const wellKnown = suppliers.filter((supplier) => typeof supplier === "string");
    return hasUniqueScopedReferences(roleRefs) && new Set(wellKnown).size === wellKnown.length;
  }, "duplicate evidence supplier")
  .overwrite((suppliers) => canonicalizeValues(suppliers, compareEvidenceSuppliers))
  .readonly();

export const EvidenceRequestSchema = z
  .strictObject({
    evidenceKind: EvidenceKindSchema,
    subjectRef: SubjectRefSchema,
    suppliableBy: EvidenceSupplierSetSchema,
  })
  .refine(
    (request) =>
      request.suppliableBy.every(
        (supplier) => typeof supplier === "string" || supplier.firmId === request.subjectRef.firmId,
      ),
    {
      message: "role suppliers must belong to the evidence subject tenant",
      path: ["suppliableBy"],
    },
  )
  .readonly();
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

/**
 * A blocker that fresh evidence CAN resolve. resolvingEvidence is non-empty by
 * construction - "resolvable with no resolving path" would collapse blocked into
 * prohibited, the exact distinction v3 invariants 8/9 keep apart.
 */
export const ResolvableBlockerSchema = z.strictObject({
  code: ReasonCodeSchema,
  explanation: z.string().min(1),
  resolvingEvidence: z.array(EvidenceRequestSchema).min(1).readonly(),
}).readonly();
export type ResolvableBlocker = z.infer<typeof ResolvableBlockerSchema>;

/** Where slot binding stands: bound, ambiguous (awaiting a human), or missing evidence. */
export const ResolutionStateSchema = z.strictObject({
  bound: z.array(SlotRefSchema).readonly(),
  ambiguous: z.array(AmbiguityRefSchema).readonly(),
  gaps: z.array(EvidenceRequestSchema).readonly(),
}).readonly();
export type ResolutionState = z.infer<typeof ResolutionStateSchema>;
