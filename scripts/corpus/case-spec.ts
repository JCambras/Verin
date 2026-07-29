import { z } from "zod";

const Instant = z.iso.datetime({ precision: 3 });
const Slug = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "lowercase hyphenated slug",
);
const Money = z.int().nonnegative();

const LabelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("defect"), defectClassId: Slug }),
  z.strictObject({
    kind: z.literal("clean-control"),
    controlRationale: z.string().min(1),
  }),
]);
export type CaseLabel = z.infer<typeof LabelSchema>;

const TreatmentOutcomeSchema = z.strictObject({
  defectClassId: Slug,
  expectedTreatment: Slug,
  observedTreatment: Slug,
});

const CaseSchema = z.strictObject({
  key: Slug,
  title: z.string().min(1),
  firmId: Slug,
  householdRef: Slug,
  assumptionIds: z.array(z.string().regex(/^AS-\d{2}$/)),
  label: LabelSchema,
  request: z.strictObject({
    sourceAccountRef: Slug,
    selectedFundingRefs: z.array(Slug).min(1),
    destinationRef: Slug,
    amountMinor: z.int().positive(),
    discriminator: Slug,
    deadline: Instant,
  }),
  thresholdPolicy: z.strictObject({
    thresholdMinor: Money,
    comparator: z.enum(["strict", "inclusive"]),
  }).optional(),
  taxReviewState: z.enum([
    "not-required",
    "required-pending",
    "completed",
    "unavailable",
  ]).optional(),
  outcomes: z.array(TreatmentOutcomeSchema).min(1),
  evidence: z.array(
    z.string().regex(/^[a-z-]+\/[a-z0-9-]+$/),
  ).min(1),
  conflictFamilies: z.array(Slug).min(1),
});
export type CaseSpec = z.infer<typeof CaseSchema>;

export const CasesSpecSchema = z.strictObject({
  specVersion: z.string().min(1),
  note: z.string().min(1),
  assumptions: z.array(z.strictObject({
    id: z.string().regex(/^AS-\d{2}$/),
    structure: z.string().min(1),
    falsifies: z.string().min(1),
  })).min(1),
  cases: z.array(CaseSchema).min(1),
});
export type CasesSpec = z.infer<typeof CasesSpecSchema>;
