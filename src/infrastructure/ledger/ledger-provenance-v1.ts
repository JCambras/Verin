import { createHash } from "node:crypto";
import {
  COMPUTED_PROVENANCE_V1_0_0,
  ComputedLedgerProducerProvenanceV1Schema,
  DIRECT_PROVENANCE_V1_0_0,
  LEGACY_COMPUTED_PROVENANCE_V1_0_0,
  PROVENANCE_SERIALIZER_V1_0_0,
  RecordProvenanceV1Schema,
  type ComputedLedgerProducerProvenanceV1,
  type ComputedProvenanceTraceV1,
  type DerivedProvenanceV1,
  type RecordProvenanceV1,
} from "@contracts/decision-core/ledger-v1/provenance";
import {
  canonicalJsonV1_0_0,
  type JsonValue,
} from "@contracts/decision-core/v1-7/serialization";
export {
  COMPUTED_PROVENANCE_V1_0_0,
  DIRECT_PROVENANCE_V1_0_0,
  LEGACY_COMPUTED_PROVENANCE_V1_0_0,
  PROVENANCE_SERIALIZER_V1_0_0,
};
export type {
  ComputedLedgerProducerProvenanceV1,
  DerivedProvenanceV1,
  RecordProvenanceV1,
};
export interface RecordedLedgerProvenanceFields {
  readonly source: unknown;
  readonly asOf: unknown;
  readonly confidence: unknown;
  readonly provenanceSchemaVersion?: unknown;
  readonly provenanceSerializerVersion?: unknown;
  readonly provenanceJson?: unknown;
  readonly provenanceTraceId?: unknown;
}
export type ParsedRecordedProvenanceV1 =
  | { readonly kind: "legacy"; readonly provenance: RecordProvenanceV1 }
  | {
      readonly kind: "computed";
      readonly provenance: ComputedLedgerProducerProvenanceV1;
      readonly canonicalBytes: string;
    };
export interface ComputedTraceMaterialV1 {
  readonly trace: ComputedProvenanceTraceV1;
  readonly canonicalBytes: string;
  readonly digest: string;
}
export function parseRecordedProvenanceFieldsV1(
  value: RecordedLedgerProvenanceFields,
): ParsedRecordedProvenanceV1 | null {
  const source = value.source;
  const version = value.provenanceSchemaVersion ??
    (source === "computed"
      ? LEGACY_COMPUTED_PROVENANCE_V1_0_0
      : DIRECT_PROVENANCE_V1_0_0);
  const serializer = value.provenanceSerializerVersion ??
    PROVENANCE_SERIALIZER_V1_0_0;
  if (serializer !== PROVENANCE_SERIALIZER_V1_0_0) return null;
  if (
    version === DIRECT_PROVENANCE_V1_0_0 ||
    version === LEGACY_COMPUTED_PROVENANCE_V1_0_0
  ) {
    if (
      version === DIRECT_PROVENANCE_V1_0_0 && source === "computed" ||
      version === LEGACY_COMPUTED_PROVENANCE_V1_0_0 && source !== "computed" ||
      value.provenanceJson != null || value.provenanceTraceId != null
    ) return null;
    const parsed = RecordProvenanceV1Schema.safeParse({
      source,
      asOf: value.asOf,
      confidence: value.confidence,
    });
    return parsed.success ? { kind: "legacy", provenance: parsed.data } : null;
  }
  if (
    version !== COMPUTED_PROVENANCE_V1_0_0 || source !== "computed" ||
    typeof value.provenanceJson !== "string" ||
    typeof value.provenanceTraceId !== "string"
  ) return null;
  let unknown: unknown;
  try {
    unknown = JSON.parse(value.provenanceJson);
  } catch {
    return null;
  }
  const parsed = ComputedLedgerProducerProvenanceV1Schema.safeParse(unknown);
  const serialized = canonicalJsonV1_0_0(unknown as JsonValue);
  if (
    !parsed.success || !serialized.ok ||
    serialized.value !== value.provenanceJson ||
    parsed.data.asOf !== value.asOf ||
    parsed.data.confidence !== value.confidence ||
    parsed.data.derivation.traceRef.id !== value.provenanceTraceId
  ) return null;
  return {
    kind: "computed",
    provenance: parsed.data,
    canonicalBytes: serialized.value,
  };
}
export function computedTraceMaterialV1(
  provenance: ComputedLedgerProducerProvenanceV1,
): ComputedTraceMaterialV1 | null {
  const { traceDigest: _traceDigest, ...trace } = provenance.derivation;
  void _traceDigest;
  const serialized = canonicalJsonV1_0_0(trace as unknown as JsonValue);
  if (!serialized.ok) return null;
  return {
    trace,
    canonicalBytes: serialized.value,
    digest: createHash("sha256").update(serialized.value, "utf8").digest("hex"),
  };
}
function isDerived(value: RecordProvenanceV1): value is DerivedProvenanceV1 {
  return value.source === "computed" &&
    "demonstration" in value && typeof value.demonstration === "boolean" &&
    "derivedFrom" in value && Array.isArray(value.derivedFrom);
}
const SYNTHETIC_SOURCES = new Set(["estimate", "default", "fixture"]);
const CONFIDENCE_RANK = { high: 2, medium: 1, low: 0 } as const;
export function deriveArtifactProvenanceV1(
  inputs: readonly RecordProvenanceV1[],
  asOf: string,
): DerivedProvenanceV1 {
  const demonstration = inputs.some((input) =>
    SYNTHETIC_SOURCES.has(input.source) ||
    input.source === "computed" && !isDerived(input) ||
    isDerived(input) && input.demonstration);
  const derivedFrom = [...new Set(inputs.flatMap((input) =>
    isDerived(input) ? [input.source, ...input.derivedFrom] : [input.source]))];
  const confidence = demonstration ? "low" : inputs.reduce<
    RecordProvenanceV1["confidence"]
  >((lowest, input) =>
    CONFIDENCE_RANK[input.confidence] < CONFIDENCE_RANK[lowest]
      ? input.confidence
      : lowest, "high");
  return { source: "computed", asOf, confidence, demonstration, derivedFrom };
}
export function canFeedComplianceDecisionV1(
  provenance: RecordProvenanceV1,
): boolean {
  if (SYNTHETIC_SOURCES.has(provenance.source)) return false;
  if (provenance.source !== "computed") return true;
  if (!isDerived(provenance) || provenance.demonstration ||
      provenance.derivedFrom.length === 0) return false;
  const leaves = provenance.derivedFrom.filter((source) => source !== "computed");
  return leaves.length > 0 &&
    leaves.every((source) => !SYNTHETIC_SOURCES.has(source));
}
export function chainPreimageForProvenanceV1(
  payloadJson: string,
  parsed: ParsedRecordedProvenanceV1,
): string {
  return parsed.kind === "computed"
    ? JSON.stringify([
        COMPUTED_PROVENANCE_V1_0_0,
        payloadJson,
        parsed.canonicalBytes,
      ])
    : JSON.stringify([
        PROVENANCE_SERIALIZER_V1_0_0,
        payloadJson,
        parsed.provenance.source,
        parsed.provenance.asOf,
        parsed.provenance.confidence,
      ]);
}
