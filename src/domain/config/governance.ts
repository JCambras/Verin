/**
 * POLICY REFERENCES, HOUSEHOLD INSTRUCTION KINDS, PROHIBITIONS, AND APPROVAL
 * TEMPLATES (v3 prompt 10 deliverables 5-8; ADR-0056).
 *
 * The line this section holds is the firm/domain boundary:
 *
 *  - The configuration contains NO POLICY. It contains the closed VOCABULARY a
 *    policy for this domain may use - which is what "policy references" means
 *    once prompt 9's load-time closure requirement is in hand. Firm A's and
 *    Firm B's policies validate against one slot, so invariant 26 is checkable
 *    at load rather than at demo time.
 *
 *  - The configuration declares INSTRUCTION KINDS, never instruction instances,
 *    and never the class-to-effect mapping. A firm must not be able to
 *    reinterpret a client mandate, so the mapping stays platform code and the
 *    firm never touches this section at all (v3 §10's narrowing rule, structural).
 *
 *  - The configuration declares a PROHIBITION VOCABULARY, never a prohibition
 *    instance. Instances carry one of the three ratified `VersionedSourceRef`
 *    arms; `sources` here is the allow-list of arms that may raise a code, which
 *    turns "a firm rule impersonating a client mandate" into a load rejection.
 *
 *  - The configuration declares APPROVAL TEMPLATE SLOTS AND KINDS; the firm
 *    supplies the `ApprovalTemplate` record, because that type carries firmId
 *    and a non-empty role-ref set - both firm data by construction.
 */
import { z } from "zod";
import {
  ApprovalTemplateIdSchema,
  EvidenceKindSchema,
  InstructionKindSchema,
  ReasonCodeSchema,
} from "@contracts/decision-core/ids";
import { POLICY_EFFECT_KINDS } from "@contracts/decision-core/policy";
import {
  ApprovalTemplateKindSchema,
  InstructionClassSchema,
  InstructionPrecedenceSchema,
  PathValueTypeSchema,
  ProhibitionSourceSchema,
  SlotNameSchema,
  kebabId,
} from "./vocabulary";

// ── policy references ───────────────────────────────────────────────────────────

/** A parameter a firm's policy may write, with its admissible range. */
const SettableParameterSchema = z
  .strictObject({
    binding: kebabId<"PrimitiveBindingId">(),
    parameter: z.string().min(1),
    describes: z.string().min(1),
  })
  .readonly();

const SelectableBindingSchema = z
  .strictObject({
    binding: kebabId<"PrimitiveBindingId">(),
    strategies: z.array(z.string().min(1)).min(1).readonly(),
  })
  .readonly();

const policySlotSchemaImpl = z
  .strictObject({
    id: kebabId<"PolicyId">(),
    describes: z.string().min(1),
    required: z.boolean(),
    oneActivePerFirm: z.boolean(),
    allowedEffects: z.array(z.enum(POLICY_EFFECT_KINDS)).min(1).readonly(),
    settableParameters: z.array(SettableParameterSchema).readonly(),
    selectableBindings: z.array(SelectableBindingSchema).readonly(),
    referenceableTemplates: z.array(ApprovalTemplateIdSchema).readonly(),
    referenceableBlockerCodes: z.array(ReasonCodeSchema).readonly(),
    referenceableProhibitionCodes: z.array(ReasonCodeSchema).readonly(),
  })
  .readonly();

// ── household instruction kinds ─────────────────────────────────────────────────

const InstructionPathSchema = z
  .strictObject({ type: PathValueTypeSchema, describes: z.string().min(1) })
  .readonly();

const instructionKindDeclarationSchemaImpl = z
  .strictObject({
    kind: InstructionKindSchema,
    describes: z.string().min(1),
    class: InstructionClassSchema,
    versioned: z.literal(true),
    paths: z
      .record(z.string().regex(/^[a-z][A-Za-z0-9]*$/, "camelCase path"), InstructionPathSchema)
      .readonly(),
    appliesToSlots: z.array(SlotNameSchema).readonly(),
    precedence: InstructionPrecedenceSchema,
    /** Which coded outcome a violation raises; the EFFECT stays platform code. */
    onViolation: ReasonCodeSchema.optional(),
    consumedBy: z.array(kebabId<"PrimitiveBindingId">()).readonly(),
  })
  .readonly()
  .superRefine((declaration, ctx) => {
    if (Object.keys(declaration.paths).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "an instruction kind with no declared path can never be read",
        path: ["paths"],
      });
    }
    if (declaration.class === "restriction" && declaration.onViolation === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "a restriction-class instruction must name the code its violation raises",
        path: ["onViolation"],
      });
    }
  });

// ── prohibitions ────────────────────────────────────────────────────────────────

const prohibitionSchemaImpl = z
  .strictObject({
    code: ReasonCodeSchema,
    describes: z.string().min(1),
    /** Which VersionedSourceRef arms may raise this code. Never `domain_config`. */
    sources: z.array(ProhibitionSourceSchema).min(1).readonly(),
    scopeSlot: SlotNameSchema,
  })
  .readonly()
  .superRefine((prohibition, ctx) => {
    if (new Set(prohibition.sources).size !== prohibition.sources.length) {
      ctx.addIssue({ code: "custom", message: "duplicate prohibition source", path: ["sources"] });
    }
  });

/** A blocker a domain can emit; the resolving evidence kinds make it resolvable by construction. */
const blockerSchemaImpl = z
  .strictObject({
    code: ReasonCodeSchema,
    describes: z.string().min(1),
    resolvingEvidence: z.array(EvidenceKindSchema).min(1).readonly(),
  })
  .readonly();

// ── approval templates ──────────────────────────────────────────────────────────

const ApprovalTemplateSlotSchema = z
  .strictObject({
    id: ApprovalTemplateIdSchema,
    describes: z.string().min(1),
    kind: ApprovalTemplateKindSchema,
    /**
     * Firm-neutral role CLASSES the firm's own template must staff. An empty
     * list RECORDS a silence rather than inventing an approver: when a case
     * needing this template is ever authored, `ApprovalRequirement.eligibleRoleIds`
     * has min(1), so the silence forces a decision by construction.
     */
    requiredRoleClasses: z.array(kebabId<"RoleClass">()).readonly(),
  })
  .readonly();

const authoritySectionSchemaImpl = z
  .strictObject({
    templates: z.array(ApprovalTemplateSlotSchema).readonly(),
    /**
     * The honest home for an `automatic` authority outcome: it arises from the
     * ABSENCE of a fired requirement, so recording it here means the evaluator
     * has no coded default to drift from.
     */
    automaticWhenNoRequirementFires: z.boolean(),
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
export interface PolicySlot extends z.infer<typeof policySlotSchemaImpl> {}
export const PolicySlotSchema: z.ZodType<PolicySlot> = policySlotSchemaImpl;

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
export interface InstructionKindDeclaration extends z.infer<typeof instructionKindDeclarationSchemaImpl> {}
export const InstructionKindDeclarationSchema: z.ZodType<InstructionKindDeclaration> = instructionKindDeclarationSchemaImpl;

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
export interface Prohibition extends z.infer<typeof prohibitionSchemaImpl> {}
export const ProhibitionSchema: z.ZodType<Prohibition> = prohibitionSchemaImpl;

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
export interface Blocker extends z.infer<typeof blockerSchemaImpl> {}
export const BlockerSchema: z.ZodType<Blocker> = blockerSchemaImpl;

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
export interface AuthoritySection extends z.infer<typeof authoritySectionSchemaImpl> {}
export const AuthoritySectionSchema: z.ZodType<AuthoritySection> = authoritySectionSchemaImpl;
