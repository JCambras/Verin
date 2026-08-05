import { z } from "zod";

export const DIRECT_PROVENANCE_V1_0_0 = "record-v1.0.0";
export const LEGACY_COMPUTED_PROVENANCE_V1_0_0 =
  "computed-legacy-v0.0.0";
export const COMPUTED_PROVENANCE_V1_0_0 = "computed-v1.0.0";
export const PROVENANCE_SERIALIZER_V1_0_0 = "1.0.0";

const SourceSchema = z.enum([
  "verin-crm", "salesforce", "csv-import", "computed", "user-input",
  "estimate", "default", "fixture",
]);
const ConfidenceSchema = z.enum(["high", "medium", "low"]);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const IssuedIdSchema = z.union([
  HashSchema,
  z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  ),
]);
const FirmIdSchema = z.string().regex(/^(?:firm-[a-z0-9]+|org(?:-[a-z0-9]+)*)$/);
const CanonicalTimestampSchema = z.string().refine((value) =>
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value);
const RecordedTimestampSchema = z.string()
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .transform((value) => new Date(value).toISOString());
const scopedRef = (id: z.ZodType<string>) => z.strictObject({
  firmId: FirmIdSchema,
  id,
}).readonly();

export const RecordProvenanceV1Schema = z.strictObject({
  source: SourceSchema,
  asOf: RecordedTimestampSchema,
  confidence: ConfidenceSchema,
}).readonly();
export type RecordProvenanceV1 = z.infer<typeof RecordProvenanceV1Schema>;

const ComputedInputSchema = z.strictObject({
  kind: z.literal("ledger-entry"),
  entryRef: scopedRef(IssuedIdSchema),
  entryHash: HashSchema,
}).readonly();
const TraceRefSchema = scopedRef(z.string().regex(
  /^trace:(?:[a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
));

export const ComputedLedgerProducerProvenanceV1Schema = z.strictObject({
  source: z.literal("computed"),
  asOf: CanonicalTimestampSchema,
  confidence: ConfidenceSchema,
  derivation: z.strictObject({
    schemaVersion: z.literal(COMPUTED_PROVENANCE_V1_0_0),
    serializerVersion: z.literal(PROVENANCE_SERIALIZER_V1_0_0),
    traceRef: TraceRefSchema,
    producer: z.strictObject({
      kind: z.literal("algorithm"),
      id: z.literal("verin.test.decision-score"),
      version: z.string().regex(/^[0-9]+(?:\.[0-9]+){1,3}(?:-[a-z0-9.-]+)?$/),
    }).readonly(),
    inputs: z.array(ComputedInputSchema).min(1).readonly(),
    observedAt: CanonicalTimestampSchema,
    confidence: ConfidenceSchema,
    traceDigest: HashSchema,
  }).readonly(),
}).superRefine((value, context) => {
  if (
    value.derivation.observedAt !== value.asOf ||
    value.derivation.confidence !== value.confidence
  ) context.addIssue({ code: "custom", message: "derived fields disagree" });
  const seen = new Set<string>();
  for (const input of value.derivation.inputs) {
    const key = `${input.entryRef.firmId}\u0000${input.entryRef.id}`;
    if (input.entryRef.firmId !== value.derivation.traceRef.firmId || seen.has(key)) {
      context.addIssue({ code: "custom", message: "input scope is invalid" });
    }
    seen.add(key);
  }
}).readonly();
export type ComputedLedgerProducerProvenanceV1 = z.infer<
  typeof ComputedLedgerProducerProvenanceV1Schema
>;
export type ComputedProvenanceTraceV1 = Omit<
  ComputedLedgerProducerProvenanceV1["derivation"],
  "traceDigest"
>;
export interface DerivedProvenanceV1 extends RecordProvenanceV1 {
  readonly source: "computed";
  readonly demonstration: boolean;
  readonly derivedFrom: readonly RecordProvenanceV1["source"][];
}
