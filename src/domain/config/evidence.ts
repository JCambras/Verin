/**
 * EVIDENCE REQUIREMENTS AND FRESHNESS (v3 prompt 10 deliverable 3; ADR-0058).
 *
 * Two decisions this section makes, stated once:
 *
 *  - THE PATH DICTIONARY LIVES HERE, NOT IN THE POLICY. Prompt 9's loader must
 *    reject `evidence(kind, path)` for an unknown path and must type-check
 *    comparator operands; the only place those declared types can come from is
 *    the domain configuration. This is the concrete prompt-9 <-> prompt-10 seam
 *    (registries.ts turns this section into `PolicyRegistries.evidence`).
 *
 *  - `maxAge` IS A DOMAIN FLOOR, NOT THE POLICY WINDOW. A firm's staleness
 *    window is firm judgment and stays in the AST (`is_fresh(kind, P30D)`). The
 *    floor exists so a firm cannot configure a window looser than the evidence
 *    can support. Without the distinction, "evidence requirements and freshness"
 *    would simply duplicate policy - the failure the primitive design's razor
 *    warns about.
 */
import { z } from "zod";
import { DurationSchema, EvidenceKindSchema } from "@contracts/decision-core/ids";
import {
  EvidenceAbsenceSchema,
  FreshnessBasisSchema,
  PathValueTypeSchema,
  SlotNameSchema,
  kebabId,
} from "./vocabulary";

/**
 * Who may supply this evidence when it is missing. Mirrors
 * `EvidenceRequest.suppliableBy` (trigger.ts) so a domain-declared gap enriches
 * into a real EvidenceRequest with no translation table: `role:<id>` binds to a
 * RoleRef at firm-binding time, `client`/`external` are well-known arms.
 */
const EvidenceSupplierSchema = z.union([
  z.literal("client"),
  z.literal("external"),
  z.string().regex(/^role:[a-z0-9]+(-[a-z0-9]+)*$/, "role:<kebab-case class>"),
]);

/** One declared path inside an evidence kind, with the type prompt 9 checks against. */
const PathDescriptorSchema = z
  .strictObject({
    type: PathValueTypeSchema,
    describes: z.string().min(1),
  })
  .readonly();

const evidenceRequirementSchemaImpl = z
  .strictObject({
    evidenceKind: EvidenceKindSchema,
    describes: z.string().min(1),
    schemaVersion: z.string().min(1),
    /** The slot whose subject this evidence is about. */
    subjectSlot: SlotNameSchema,
    paths: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/, "camelCase path"), PathDescriptorSchema).readonly(),
    freshnessBasis: FreshnessBasisSchema,
    /** DOMAIN FLOOR: firm policy may only narrow this window, never widen it. */
    maxAge: DurationSchema,
    absence: EvidenceAbsenceSchema,
    requiredFor: z.array(kebabId<"ActionId">()).min(1).readonly(),
    suppliableBy: z.array(EvidenceSupplierSchema).min(1).readonly(),
  })
  .readonly()
  .superRefine((requirement, ctx) => {
    if (Object.keys(requirement.paths).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "an evidence kind with no declared path can never be read by a policy",
        path: ["paths"],
      });
    }
    if (new Set(requirement.suppliableBy).size !== requirement.suppliableBy.length) {
      ctx.addIssue({ code: "custom", message: "duplicate evidence supplier", path: ["suppliableBy"] });
    }
    if (new Set(requirement.requiredFor).size !== requirement.requiredFor.length) {
      ctx.addIssue({ code: "custom", message: "duplicate requiredFor entry", path: ["requiredFor"] });
    }
  });

/**
 * ISO-8601 duration -> whole seconds, integer-only and total. Used ONLY to
 * compare declared windows with each other (a firm window against the domain
 * floor); nothing here reads a clock. Calendar-variable designators are
 * normalized with the fixed conventions the comparison needs (a month is 30
 * days, a year 365) - which is safe because both operands go through the same
 * function, and unsafe only for absolute date arithmetic, which this never does.
 */
const DURATION_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export const durationSeconds = (duration: string): number | null => {
  // `duration.match(...)` rather than `DURATION_RE.exec(...)`: the ledger
  // anti-fork fence resolves a SQL executor by the NAME it is called under, and
  // `exec` is one of them - a regex receiver would read as an unresolvable
  // dynamic insert. Same semantics, no ambiguity for the fence.
  const match = duration.match(DURATION_RE);
  if (!match || duration === "P" || duration.endsWith("T")) return null;
  const [, years, months, weeks, days, hours, minutes, seconds] = match;
  const n = (value: string | undefined): number => (value === undefined ? 0 : Number(value));
  return (
    n(years) * 365 * 86400 +
    n(months) * 30 * 86400 +
    n(weeks) * 7 * 86400 +
    n(days) * 86400 +
    n(hours) * 3600 +
    n(minutes) * 60 +
    Math.trunc(n(seconds))
  );
};

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
export interface EvidenceRequirement extends z.infer<typeof evidenceRequirementSchemaImpl> {}
export const EvidenceRequirementSchema: z.ZodType<EvidenceRequirement> = evidenceRequirementSchemaImpl;
