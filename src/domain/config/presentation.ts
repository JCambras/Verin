/**
 * UI PRESENTATION METADATA (v3 prompt 10 deliverable 13; ADR-0056).
 *
 * Three rules make this section inert and fenceable:
 *
 *  1. LABELS ARE DATA, NEVER BEHAVIOR. v3 §16 lets the UI render domain labels
 *     from configuration but forbids domain decision branches in it. There is no
 *     conditional here: per-state copy is separate KEYED entries, so "show X only
 *     when blocked" is a keyed dimension rather than a predicate.
 *  2. THE ONLY INTERPOLATION IS THE CLOSED PLACEHOLDER SET (segments.ts). No
 *     arbitrary paths, no expressions, no format functions.
 *  3. ANYTHING NUMERIC DECLARES `display: metric` WITH A `MetricFormat`, so the
 *     shipped metric-provenance fence keeps holding: a metric-shaped value
 *     rendered without provenance already fails the build.
 *
 * Every field carries a human `describes`, which is what makes the schema
 * traversable as an interview clipboard later (D-098) without any interview
 * machinery existing now.
 */
import { z } from "zod";
import { METRIC_FORMATS } from "@contracts/metric";
import { KEBAB_CASE_RE, SlotNameSchema, kebabId } from "./vocabulary";

/** Copy is keyed by the UNBRANDED byte form of the id it renders, so one map serves every vocabulary. */
const KebabKeySchema = z.string().regex(KEBAB_CASE_RE, "kebab-case key");

/** How a slot's value reaches a screen. `metric` forces a declared MetricFormat. */
const SlotCopySchema = z
  .strictObject({
    label: z.string().min(1),
    display: z.enum(["text", "metric"]),
    format: z.enum(METRIC_FORMATS).optional(),
  })
  .readonly()
  .superRefine((copy, ctx) => {
    if (copy.display === "metric" && copy.format === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "a metric-displayed slot must declare its MetricFormat (charter #3)",
        path: ["format"],
      });
    }
    if (copy.display !== "metric" && copy.format !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "only a metric-displayed slot may declare a MetricFormat",
        path: ["format"],
      });
    }
  });

const EvidenceCopySchema = z
  .strictObject({ label: z.string().min(1), sourceLabel: z.string().min(1) })
  .readonly();

/** One coded outcome's rendered explanation. `body` may use the closed placeholder set. */
const ReasonCopySchema = z
  .strictObject({
    title: z.string().min(1),
    body: z.string().min(1),
    resolution: z.string().min(1),
  })
  .readonly();

/** One rendered form control of the generic renderer (charter #10). */
const FormFieldSchema = z
  .strictObject({
    slot: SlotNameSchema,
    input: z.enum(["text", "email", "select"]),
    hint: z.string().min(1).optional(),
    defaultValue: z.string().min(1).optional(),
  })
  .readonly();

const FormSchema = z
  .strictObject({
    intent: kebabId<"ActionId">(),
    title: z.string().min(1),
    /** The regulation the WhyBubble cites for this domain (charter #10 doctrine). */
    regulation: z.string().min(1),
    /**
     * Which declared station the form itself stands on, and which one the
     * journey stands on while the flow is suspended at its external gate
     * (absent for a domain whose plan never suspends).
     *
     * Declared rather than positional: the renderer must be able to light the
     * right station without transcribing a station id into code, so renaming or
     * reordering `surfaces` moves the rail from THIS document instead of
     * silently lighting whichever station now sits at some ordinal.
     */
    surface: kebabId<"SurfaceId">(),
    awaitingSurface: kebabId<"SurfaceId">().optional(),
    fields: z.array(FormFieldSchema).min(1).readonly(),
  })
  .readonly()
  .superRefine((form, ctx) => {
    const slots = form.fields.map((field) => field.slot);
    if (new Set(slots).size !== slots.length) {
      ctx.addIssue({ code: "custom", message: "duplicate form field", path: ["fields"] });
    }
  });

/** One journey station this domain presents, in declared order. */
const SurfaceSchema = z
  .strictObject({
    id: kebabId<"SurfaceId">(),
    order: z.int().positive(),
    label: z.string().min(1),
  })
  .readonly();

const presentationSchemaImpl = z
  .strictObject({
    domainLabel: z.string().min(1),
    domainSummary: z.string().min(1),
    surfaces: z.array(SurfaceSchema).min(1).readonly(),
    /** The generic renderer's form; absent for a domain with no authored intake screen. */
    form: FormSchema.optional(),
    copy: z
      .strictObject({
        intents: z.record(KebabKeySchema, z.strictObject({ label: z.string().min(1) }).readonly()).readonly(),
        slots: z.record(SlotNameSchema, SlotCopySchema).readonly(),
        evidenceKinds: z.record(KebabKeySchema, EvidenceCopySchema).readonly(),
        reasonCodes: z.record(KebabKeySchema, ReasonCopySchema).readonly(),
        statusLabels: z.record(KebabKeySchema, z.string().min(1)).readonly(),
        /** Templates a command payload may render (the ONE inert interpolation site). */
        commandText: z.record(KebabKeySchema, z.string().min(1)).readonly(),
      })
      .readonly(),
  })
  .readonly()
  .superRefine((presentation, ctx) => {
    const orders = presentation.surfaces.map((surface) => surface.order);
    if (new Set(orders).size !== orders.length) {
      ctx.addIssue({ code: "custom", message: "duplicate surface order", path: ["surfaces"] });
    }
    const ids = new Set<string>(presentation.surfaces.map((surface) => surface.id));
    if (ids.size !== presentation.surfaces.length) {
      ctx.addIssue({ code: "custom", message: "duplicate surface id", path: ["surfaces"] });
    }
    // A station the form names but the document does not declare would leave the
    // journey with no station to light and no step number to show - the exact
    // silent breakage that binding by id exists to prevent, so it is refused
    // here rather than rendered as an empty rail.
    const stations: readonly (readonly [string, string | undefined])[] = [
      ["surface", presentation.form?.surface],
      ["awaitingSurface", presentation.form?.awaitingSurface],
    ];
    for (const [field, station] of stations) {
      if (station !== undefined && !ids.has(station)) {
        ctx.addIssue({
          code: "custom",
          message: `the form names station ${JSON.stringify(station)}, which this document does not declare`,
          path: ["form", field],
        });
      }
    }
  });

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
export interface Presentation extends z.infer<typeof presentationSchemaImpl> {}
export const PresentationSchema: z.ZodType<Presentation> = presentationSchemaImpl;
