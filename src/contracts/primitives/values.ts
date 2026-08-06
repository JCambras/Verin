/**
 * Shared value vocabulary for the decision-primitive catalog (v3 prompt 8;
 * captain ratification: waveb-design-ratification, 2026-07-26; ADR-0039).
 *
 * Primitives are the ONLY place the decision plane computes: the policy AST
 * (prompt 9) deliberately lacks aggregation, arithmetic, per-candidate
 * quantification, and cross-snapshot comparison, and each primitive exists
 * because it needs one of those four capabilities. Everything here is pure
 * data + pure functions: no clock, no randomness, no IO (fenced by
 * `primitive-catalog` purity checks).
 */
import { z } from "zod";
import { PrimitiveIdSchema, type PrimitiveId } from "../decision-core/ids";

/**
 * Plain proleptic-Gregorian calendar date (YYYY-MM-DD), NO time zone. The zone
 * projection (bundle.asOf + bundle.timeZone -> local date) happens ONCE in the
 * evaluation harness that assembles primitive inputs; primitives receive the
 * already-projected date so their calendar arithmetic is pure integer math and
 * the tz database never enters the contracts layer. Lexicographic order on the
 * byte form IS chronological order - comparisons below rely on that.
 */
export const IsoDateSchema = z.iso.date().brand<"IsoDate">();
export type IsoDate = z.infer<typeof IsoDateSchema>;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

/**
 * Calendar-month addition with end-of-month clamping (2026-01-31 + P1M ->
 * 2026-02-28): the only calendar arithmetic the v1 vocabulary performs.
 * Deterministic by construction - no Date, no Intl, no tz data - and TOTAL for
 * every parseable anchor: a target outside the four-digit ISO year range
 * saturates at the range edge instead of rendering an unparseable date.
 */
export const addCalendarMonths = (date: IsoDate, months: number): IsoDate => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const zeroBased = year * 12 + (month - 1) + Math.trunc(months);
  const targetYear = Math.floor(zeroBased / 12);
  if (!(targetYear >= 1 && targetYear <= 9999)) {
    return IsoDateSchema.parse(targetYear < 1 ? "0001-01-01" : "9999-12-31");
  }
  const targetMonth = (zeroBased % 12) + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return IsoDateSchema.parse(
    `${pad(targetYear, 4)}-${pad(targetMonth, 2)}-${pad(clampedDay, 2)}`,
  );
};

/**
 * Vocabulary tokens that become published-context-key segments (claim kinds,
 * slot names, fact kinds) are pinned to kebab-case so the derived key space
 * ("availability.claims.<kind>") stays unambiguous: a dot inside a segment
 * would collide with the key hierarchy separator.
 */
export const KeySegmentSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case key segment");
export type KeySegment = z.infer<typeof KeySegmentSchema>;

export const parsePrimitiveId = (id: string): PrimitiveId =>
  PrimitiveIdSchema.parse(KeySegmentSchema.parse(id));

/**
 * The type a published context key carries, declared per key so the prompt-9
 * load-time closure can type-check AST operands against it. "structured"
 * values are platform-consumed (prohibition mapping, resolution stage,
 * explanation) and are never legal in an AST compare/in position.
 */
export const PublishedValueDescriptorSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("integer"),
      unit: z.enum(["minor-units", "count", "months"]),
      presence: z.enum(["always", "conditional"]),
      description: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("boolean"),
      presence: z.enum(["always", "conditional"]),
      description: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("code"),
      presence: z.enum(["always", "conditional"]),
      description: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("reference"),
      presence: z.enum(["always", "conditional"]),
      description: z.string().min(1),
    }),
    z.strictObject({
      kind: z.literal("structured"),
      presence: z.enum(["always", "conditional"]),
      description: z.string().min(1),
    }),
  ])
  .readonly();
export type PublishedValueDescriptor = z.infer<typeof PublishedValueDescriptorSchema>;

export type PublishedKeyMap = Readonly<Record<string, PublishedValueDescriptor>>;

type Presence = PublishedValueDescriptor["presence"];

export const publishedInteger = (
  unit: "minor-units" | "count" | "months",
  description: string,
  presence: Presence = "always",
): PublishedValueDescriptor => ({ kind: "integer", unit, presence, description });

export const publishedBoolean = (
  description: string,
  presence: Presence = "always",
): PublishedValueDescriptor => ({ kind: "boolean", presence, description });

export const publishedCode = (
  description: string,
  presence: Presence = "always",
): PublishedValueDescriptor => ({ kind: "code", presence, description });

export const publishedReference = (
  description: string,
  presence: Presence = "always",
): PublishedValueDescriptor => ({ kind: "reference", presence, description });

export const publishedStructured = (
  description: string,
  presence: Presence = "always",
): PublishedValueDescriptor => ({ kind: "structured", presence, description });

/** Closed JSON-shaped value space for published facts - nothing callable, nothing lazy. */
export type PublishedFactValue =
  | string
  | number
  | boolean
  | null
  | readonly PublishedFactValue[]
  | { readonly [key: string]: PublishedFactValue };

export type PublishedFactRecord = Readonly<Record<string, PublishedFactValue>>;

/**
 * The falsification contract every primitive owes (v3 prompt 8): the REAL
 * operating case that would prove it wrong or too narrow, and the declared
 * response when that case arrives (activate a declared future primitive,
 * merge, or demote) - so stretching a primitive past its semantics is a
 * visible versioning event, never a quiet patch.
 */
export type PrimitiveFalsification = {
  readonly operatingCase: string;
  readonly falsifiedResponse: string;
};

/**
 * Structural supertype every catalog entry satisfies. The `never` parameters
 * are deliberate contravariant erasure: heterogeneously-typed definitions all
 * assign to this shape, and a generic caller must go through each entry's own
 * schemas to obtain arguments - there is no untyped invocation path.
 */
export type CatalogPrimitive = {
  readonly id: PrimitiveId;
  readonly summary: string;
  readonly parameterSchema: z.ZodType;
  readonly inputSchema: z.ZodType;
  /** Parameter names whose values are evidence kinds - how a binding declares what it consumes. */
  readonly evidenceKindParameters: readonly string[];
  /** Closed per-primitive strategy vocabulary; empty for non-selection primitives. */
  readonly allowedStrategies: readonly string[];
  readonly publishedKeys: (parameters: never) => PublishedKeyMap;
  readonly falsification: PrimitiveFalsification;
  readonly evaluate: (input: never) => PublishedFactRecord;
};

/** All tenant-scoped references inside one primitive input must agree on the firm. */
export const collectFirmIds = (
  refs: readonly { readonly firmId: string }[],
): ReadonlySet<string> => new Set(refs.map((ref) => ref.firmId));

export const addSingleTenantIssue = (
  ctx: z.core.$RefinementCtx,
  refs: readonly { readonly firmId: string }[],
  path: readonly (string | number)[],
): void => {
  if (collectFirmIds(refs).size > 1) {
    ctx.addIssue({
      code: "custom",
      message: "primitive input references must belong to one tenant",
      path: [...path],
    });
  }
};
