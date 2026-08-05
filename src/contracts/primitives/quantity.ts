/**
 * The quantity family of decision primitives (v3 prompt 8; ADR-0039):
 * net-availability, horizon-projection, sufficiency-check. These three exist
 * because they aggregate and do arithmetic - the two capabilities the policy
 * AST deliberately lacks - and sufficiency-check is the ONLY subtraction in
 * the decision plane, so the AST never grows a numeric operator.
 *
 * All monetary values are integers in minor units end to end; the schemas
 * refuse anything else at the parse boundary, so evaluate functions are total
 * over their parsed inputs and never throw.
 */
import { z } from "zod";
import {
  EvidenceKindSchema,
  EvidenceSnapshotIdRefSchema,
  normalizeCanonicalStrings,
} from "../decision-core/ids";
import {
  IsoDateSchema,
  KeySegmentSchema,
  addCalendarMonths,
  addSingleTenantIssue,
  parsePrimitiveId,
  publishedBoolean,
  publishedInteger,
  publishedStructured,
  type PrimitiveFalsification,
  type PublishedFactRecord,
  type PublishedKeyMap,
} from "./values";

/** Evidence kinds that become published-key segments must stay kebab-case. */
const SegmentEvidenceKindSchema = KeySegmentSchema.pipe(EvidenceKindSchema);

// ── net-availability ────────────────────────────────────────────────────────────

/**
 * Net available quantity of a constrained resource = observed gross quantity
 * minus the sum of recorded claims, with a per-claim-kind breakdown. The
 * formula is FIXED linear netting - the falsification criterion below is what
 * guards that choice. A binding with zero claim kinds is refused by schema:
 * netting over nothing is a plain evidence read the AST already owns, and a
 * primitive that duplicates the AST is a second place for the same judgment.
 */
const NetAvailabilityParameterSchema = z
  .strictObject({
    resourceEvidenceKind: SegmentEvidenceKindSchema,
    claimEvidenceKinds: z
      .array(SegmentEvidenceKindSchema)
      .min(1)
      .refine((kinds) => new Set(kinds).size === kinds.length, "duplicate claim kind")
      .overwrite(normalizeCanonicalStrings)
      .readonly(),
    /**
     * Which subjects the evidence assembler gathers for the binding: the bound
     * slot's subject alone, or its enclosing subject group (the golden truth
     * set nets an account-level resource against group-level claims).
     */
    subjectScope: z.enum(["bound-subject", "subject-group"]),
  })
  .readonly();

const ClaimObservationSchema = z
  .strictObject({
    claimKind: SegmentEvidenceKindSchema,
    snapshotRef: EvidenceSnapshotIdRefSchema,
    amountMinor: z.int().nonnegative(),
  })
  .readonly();

const NetAvailabilityInputSchema = z
  .strictObject({
    parameters: NetAvailabilityParameterSchema,
    evidence: z
      .strictObject({
        resource: z
          .strictObject({
            snapshotRef: EvidenceSnapshotIdRefSchema,
            amountMinor: z.int(),
          })
          .readonly(),
        claims: z.array(ClaimObservationSchema).readonly(),
      })
      .readonly(),
    context: z.strictObject({}).readonly(),
  })
  .superRefine((input, ctx) => {
    const declared = new Set<string>(input.parameters.claimEvidenceKinds);
    input.evidence.claims.forEach((claim, index) => {
      // A claim of an undeclared kind is an assembly error: silently summing or
      // silently dropping it would both corrupt the netting - refuse instead.
      if (!declared.has(claim.claimKind)) {
        ctx.addIssue({
          code: "custom",
          message: "claim kind is not declared by the binding",
          path: ["evidence", "claims", index, "claimKind"],
        });
      }
    });
    addSingleTenantIssue(
      ctx,
      [
        input.evidence.resource.snapshotRef,
        ...input.evidence.claims.map((claim) => claim.snapshotRef),
      ],
      ["evidence"],
    );
  })
  .readonly();

const netAvailabilityFalsification: PrimitiveFalsification = {
  operatingCase:
    "A real availability rule that is not linear netting: conditional claims such as pending purchases that count only after T+1 settlement, margin or overdraft facilities that extend effective availability, or partial netting by claim class. Second kill test: if every domain except money movement computes availability differently, this is domain logic wearing a neutral name.",
  falsifiedResponse:
    "Introduce a claim-classifier parameter or a sibling primitive under a primitive-set version bump - never a conditional branch inside the netting formula. If the second kill test fires, merge or demote the primitive.",
};

export const netAvailability = {
  id: parsePrimitiveId("net-availability"),
  summary:
    "Net available quantity of a constrained resource: observed gross minus the sum of recorded claims, published with a per-claim-kind breakdown so policy can name WHICH claim class consumed the capacity.",
  parameterSchema: NetAvailabilityParameterSchema,
  inputSchema: NetAvailabilityInputSchema,
  evidenceKindParameters: ["resourceEvidenceKind", "claimEvidenceKinds"],
  allowedStrategies: [],
  publishedKeys: (
    parameters: z.infer<typeof NetAvailabilityParameterSchema>,
  ): PublishedKeyMap => {
    const keys: Record<string, ReturnType<typeof publishedInteger>> = {};
    for (const kind of parameters.claimEvidenceKinds) {
      keys[`availability.claims.${kind}`] = publishedInteger(
        "minor-units",
        `Total recorded claims of kind ${kind}; zero when none are present.`,
      );
    }
    keys["availability.gross"] = publishedInteger(
      "minor-units",
      "Observed gross quantity of the bound resource.",
    );
    keys["availability.net"] = publishedInteger(
      "minor-units",
      "Gross minus the sum of all recorded claims.",
    );
    return keys;
  },
  falsification: netAvailabilityFalsification,
  evaluate: (
    input: z.infer<typeof NetAvailabilityInputSchema>,
  ): PublishedFactRecord => {
    const gross = input.evidence.resource.amountMinor;
    const published: Record<string, number> = {};
    let totalClaims = 0;
    for (const kind of input.parameters.claimEvidenceKinds) {
      let kindTotal = 0;
      for (const claim of input.evidence.claims) {
        if (claim.claimKind === kind) kindTotal += claim.amountMinor;
      }
      totalClaims += kindTotal;
      published[`availability.claims.${kind}`] = kindTotal;
    }
    published["availability.gross"] = gross;
    published["availability.net"] = gross - totalClaims;
    return published;
  },
};

// ── horizon-projection ──────────────────────────────────────────────────────────

/**
 * Sum of a dated scheduled-flow series over a calendar horizon anchored at the
 * bundle's asOf date. The window is half-open [anchor, anchor + horizonMonths):
 * a flow due on the anchor date is still scheduled and counts; a flow due
 * exactly at the far edge belongs to the next window. `direction` is a literal
 * so a backward projection is a parse error today and a deliberate version
 * bump tomorrow, never a silent widening.
 */
const HorizonProjectionParameterSchema = z
  .strictObject({
    seriesEvidenceKind: SegmentEvidenceKindSchema,
    horizonMonths: z.int().positive(),
    direction: z.literal("forward"),
  })
  .readonly();

const HorizonProjectionInputSchema = z
  .strictObject({
    parameters: HorizonProjectionParameterSchema,
    evidence: z
      .strictObject({
        series: z
          .strictObject({
            snapshotRef: EvidenceSnapshotIdRefSchema,
            flows: z
              .array(
                z
                  .strictObject({ dueOn: IsoDateSchema, amountMinor: z.int() })
                  .readonly(),
              )
              .readonly(),
          })
          .readonly(),
      })
      .readonly(),
    /**
     * anchorDate is the bundle's asOf instant projected into the bundle's time
     * zone by the evaluation harness - the one place tz data is consulted - so
     * the arithmetic here is pure proleptic-Gregorian integer math.
     */
    context: z.strictObject({ anchorDate: IsoDateSchema }).readonly(),
  })
  .readonly();

const horizonProjectionFalsification: PrimitiveFalsification = {
  operatingCase:
    "A real reserve or commitment rule needing non-sum aggregation (largest monthly gap, inflation-adjusted projection) or irregular schedules the forward horizon-sum cannot express. Hard kill criterion from the captain's OQ-4 ruling: if no second domain (trading cash-needs, life-event required-distribution projection) has bound this primitive by the trading wave, it was a money-movement one-off.",
  falsifiedResponse:
    "Non-sum aggregation activates a sibling primitive under a primitive-set version bump. If the kill criterion fires at the trading wave, merge or demote this primitive rather than defending it.",
};

export const horizonProjection = {
  id: parsePrimitiveId("horizon-projection"),
  summary:
    "Sum of a dated scheduled-flow series over a half-open calendar horizon anchored at the bundle asOf date, computed with deterministic month arithmetic and end-of-month clamping.",
  parameterSchema: HorizonProjectionParameterSchema,
  inputSchema: HorizonProjectionInputSchema,
  evidenceKindParameters: ["seriesEvidenceKind"],
  allowedStrategies: [],
  publishedKeys: (): PublishedKeyMap => ({
    "projection.horizon": publishedStructured(
      "The evaluated window: startsOn (inclusive), endsOnExclusive, and months.",
    ),
    "projection.total": publishedInteger(
      "minor-units",
      "Sum of scheduled flows due inside the window.",
    ),
  }),
  falsification: horizonProjectionFalsification,
  evaluate: (
    input: z.infer<typeof HorizonProjectionInputSchema>,
  ): PublishedFactRecord => {
    const anchor = input.context.anchorDate;
    const endExclusive = addCalendarMonths(anchor, input.parameters.horizonMonths);
    let total = 0;
    for (const flow of input.evidence.series.flows) {
      if (flow.dueOn >= anchor && flow.dueOn < endExclusive) total += flow.amountMinor;
    }
    return {
      "projection.horizon": {
        startsOn: anchor,
        endsOnExclusive: endExclusive,
        months: input.parameters.horizonMonths,
      },
      "projection.total": total,
    };
  },
};

// ── sufficiency-check ───────────────────────────────────────────────────────────

/**
 * Whether a proposed draw against an available quantity preserves a required
 * floor, or stays within a cap. Parameters BIND context keys or constants;
 * the evaluation harness resolves them and supplies the resolved integers in
 * context, so the primitive itself never walks the context - the input schema
 * proves the resolution is consistent with the binding.
 */
const ContextKeyBindingSchema = z
  .strictObject({ kind: z.literal("context"), key: z.string().min(1) })
  .readonly();

const ConstantBindingSchema = z
  .strictObject({ kind: z.literal("constant"), amountMinor: z.int() })
  .readonly();

/** The ratified shape admits exactly the ZERO constant for draw ("may be the zero constant"). */
const ZeroConstantBindingSchema = z
  .strictObject({ kind: z.literal("constant"), amountMinor: z.literal(0) })
  .readonly();

const FloorPreservingParameterSchema = z.strictObject({
  mode: z.literal("floor-preserving"),
  available: ContextKeyBindingSchema,
  draw: z.union([ContextKeyBindingSchema, ZeroConstantBindingSchema]),
  bound: z.union([ContextKeyBindingSchema, ConstantBindingSchema]),
});

const CapLimitedParameterSchema = z.strictObject({
  mode: z.literal("cap-limited"),
  draw: ContextKeyBindingSchema,
  bound: z.union([ContextKeyBindingSchema, ConstantBindingSchema]),
});

const SufficiencyParameterSchema = z.discriminatedUnion("mode", [
  FloorPreservingParameterSchema,
  CapLimitedParameterSchema,
]);

const constantConsistencyIssues = (
  parameters: { readonly [key: string]: unknown },
  context: { readonly [key: string]: number },
  ctx: z.core.$RefinementCtx,
): void => {
  for (const [name, binding] of Object.entries(parameters)) {
    if (
      typeof binding === "object" &&
      binding !== null &&
      "kind" in binding &&
      binding.kind === "constant" &&
      "amountMinor" in binding &&
      context[name] !== binding.amountMinor
    ) {
      ctx.addIssue({
        code: "custom",
        message: "resolved context value must equal the constant binding",
        path: ["context", name],
      });
    }
  }
};

const FloorPreservingInputSchema = z
  .strictObject({
    parameters: FloorPreservingParameterSchema,
    evidence: z.strictObject({}).readonly(),
    context: z
      .strictObject({
        available: z.int(),
        draw: z.int().nonnegative(),
        bound: z.int(),
      })
      .readonly(),
  })
  .superRefine((input, ctx) =>
    constantConsistencyIssues(input.parameters, input.context, ctx),
  )
  .readonly();

const CapLimitedInputSchema = z
  .strictObject({
    parameters: CapLimitedParameterSchema,
    evidence: z.strictObject({}).readonly(),
    context: z
      .strictObject({ draw: z.int().nonnegative(), bound: z.int() })
      .readonly(),
  })
  .superRefine((input, ctx) =>
    constantConsistencyIssues(input.parameters, input.context, ctx),
  )
  .readonly();

const SufficiencyInputSchema = z.union([
  FloorPreservingInputSchema,
  CapLimitedInputSchema,
]);

const sufficiencyFalsification: PrimitiveFalsification = {
  operatingCase:
    "A real rule needing ratio or percentage headroom (keep 110 percent of the floor) or joint sufficiency across multiple resources at once - either proves the two-mode integer shape too narrow.",
  falsifiedResponse:
    "Activate the declared future primitive deviation-from-target under a primitive-set version bump instead of stretching this shape with ratio modes.",
};

export const sufficiencyCheck = {
  id: parsePrimitiveId("sufficiency-check"),
  summary:
    "Whether a proposed draw against an available quantity preserves a required floor (floor-preserving) or stays within a cap (cap-limited), publishing satisfied, shortfall, and headroom as the typed arithmetic trace. The only subtraction in the decision plane.",
  parameterSchema: SufficiencyParameterSchema,
  inputSchema: SufficiencyInputSchema,
  evidenceKindParameters: [],
  allowedStrategies: [],
  publishedKeys: (): PublishedKeyMap => ({
    "sufficiency.headroom": publishedInteger(
      "minor-units",
      "How far above the bound the effective quantity sits; zero when unsatisfied.",
    ),
    "sufficiency.satisfied": publishedBoolean(
      "Whether the draw preserves the floor or stays within the cap.",
    ),
    "sufficiency.shortfall": publishedInteger(
      "minor-units",
      "How far below the bound the effective quantity falls; zero when satisfied.",
    ),
  }),
  falsification: sufficiencyFalsification,
  evaluate: (
    input: z.infer<typeof SufficiencyInputSchema>,
  ): PublishedFactRecord => {
    // distance >= 0 is "satisfied" in BOTH modes: floor mode measures how far
    // (available - draw) sits above the floor; cap mode how far draw sits
    // below the cap. Shortfall and headroom are the two signs of one number.
    const distance =
      "available" in input.context
        ? input.context.available - input.context.draw - input.context.bound
        : input.context.bound - input.context.draw;
    return {
      "sufficiency.headroom": Math.max(0, distance),
      "sufficiency.satisfied": distance >= 0,
      "sufficiency.shortfall": Math.max(0, -distance),
    };
  },
};
