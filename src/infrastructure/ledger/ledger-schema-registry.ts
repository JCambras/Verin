import {
  LedgerEntryV1_0_0Schema,
  LedgerEntryV1_1_0Schema,
  type LedgerEntry,
} from "@contracts/decision-core/ledger-v1/ledger";
import {
  canonicalJsonV1_0_0,
  type JsonValue,
} from "@contracts/decision-core/v1-7/serialization";
import {
  COMPUTED_PROVENANCE_V1_0_0,
  LEGACY_COMPUTED_PROVENANCE_V1_0_0,
  PROVENANCE_SERIALIZER_V1_0_0,
  canFeedComplianceDecisionV1,
  chainPreimageForProvenanceV1,
  computedTraceMaterialV1,
  deriveArtifactProvenanceV1,
  parseRecordedProvenanceFieldsV1,
  type ComputedTraceMaterialV1,
  type ComputedLedgerProducerProvenanceV1,
  type DerivedProvenanceV1,
  type RecordedLedgerProvenanceFields,
  type RecordProvenanceV1,
} from "./ledger-provenance-v1";

export type {
  ComputedLedgerProducerProvenanceV1,
  RecordedLedgerProvenanceFields,
} from "./ledger-provenance-v1";

export type RecordedLedgerProvenance =
  | RecordProvenanceV1
  | ComputedLedgerProducerProvenanceV1;

type ParseResult =
  | { readonly ok: true; readonly event: LedgerEntry; readonly canonicalBytes: string }
  | { readonly ok: false; readonly reason: string };

interface RecordedLedgerCodec {
  readonly parse: (value: unknown) => LedgerEntry | undefined;
  readonly canonicalize: (value: unknown) => string | undefined;
}

const encodingKey = (schemaVersion: string, serializerVersion: string): string =>
  `${schemaVersion}|${serializerVersion}`;

function codecV1_0_0(schema: {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | { success: false };
}): RecordedLedgerCodec {
  return {
    parse(value) {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data as LedgerEntry : undefined;
    },
    canonicalize(value) {
      const serialized = canonicalJsonV1_0_0(value as JsonValue);
      return serialized.ok ? serialized.value : undefined;
    },
  };
}

const LEDGER_CODEC_REGISTRY = new Map<string, RecordedLedgerCodec>([
  [encodingKey("1.0.0", "1.0.0"), codecV1_0_0(LedgerEntryV1_0_0Schema)],
  [encodingKey("1.1.0", "1.0.0"), codecV1_0_0(LedgerEntryV1_1_0Schema)],
]);

export function registeredLedgerEncodings(): readonly string[] {
  return [...LEDGER_CODEC_REGISTRY.keys()];
}

export function decisionLedgerChainPreimage(
  schemaVersion: string,
  serializerVersion: string,
  payloadJson: string,
  provenance: RecordedLedgerProvenanceFields,
): string | null {
  const codec = LEDGER_CODEC_REGISTRY.get(encodingKey(schemaVersion, serializerVersion));
  const parsed = parseRecordedProvenanceFieldsV1(provenance);
  if (!codec || !parsed) return null;
  return chainPreimageForProvenanceV1(payloadJson, parsed);
}

export interface RecordedComputedProvenanceSemantics {
  readonly traceMaterial: (
    provenance: ComputedLedgerProducerProvenanceV1,
  ) => ComputedTraceMaterialV1 | null;
  readonly derive: (
    inputs: readonly RecordProvenanceV1[],
    asOf: string,
  ) => DerivedProvenanceV1;
  readonly canFeedComplianceDecision: (
    provenance: RecordProvenanceV1,
  ) => boolean;
}

const COMPUTED_PROVENANCE_SEMANTICS = new Map<
  string,
  RecordedComputedProvenanceSemantics
>([
  [encodingKey(COMPUTED_PROVENANCE_V1_0_0, PROVENANCE_SERIALIZER_V1_0_0), {
    traceMaterial: computedTraceMaterialV1,
    derive: deriveArtifactProvenanceV1,
    canFeedComplianceDecision: canFeedComplianceDecisionV1,
  }],
]);

export function recordedComputedProvenanceSemantics(
  provenance: ComputedLedgerProducerProvenanceV1,
): RecordedComputedProvenanceSemantics | null {
  return COMPUTED_PROVENANCE_SEMANTICS.get(encodingKey(
    provenance.derivation.schemaVersion,
    provenance.derivation.serializerVersion,
  )) ?? null;
}

export function deriveRecordedLegacyComputedProvenance(
  provenanceSchemaVersion: string,
  provenanceSerializerVersion: string,
  provenance: RecordProvenanceV1,
): DerivedProvenanceV1 | null {
  if (
    provenanceSchemaVersion !== LEGACY_COMPUTED_PROVENANCE_V1_0_0 ||
    provenanceSerializerVersion !== PROVENANCE_SERIALIZER_V1_0_0 ||
    provenance.source !== "computed"
  ) return null;
  return deriveArtifactProvenanceV1([provenance], provenance.asOf);
}

export function parseRecordedLedgerProvenance(
  schemaVersion: string,
  serializerVersion: string,
  value: RecordedLedgerProvenanceFields,
): RecordedLedgerProvenance | null {
  if (!LEDGER_CODEC_REGISTRY.has(encodingKey(schemaVersion, serializerVersion))) {
    return null;
  }
  return parseRecordedProvenanceFieldsV1(value)?.provenance ?? null;
}

export function canonicalizeRecordedLedgerValue(
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): string | null {
  return LEDGER_CODEC_REGISTRY
    .get(encodingKey(schemaVersion, serializerVersion))
    ?.canonicalize(value) ?? null;
}

export function parseRecordedLedgerEvent(
  eventType: string,
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): ParseResult {
  const codec = LEDGER_CODEC_REGISTRY.get(encodingKey(schemaVersion, serializerVersion));
  if (!codec) {
    return {
      ok: false,
      reason: `unsupported ledger encoding ${schemaVersion}/${serializerVersion}`,
    };
  }
  const parsed = codec.parse(value);
  if (
    !parsed ||
    parsed.type !== eventType ||
    parsed.schemaVersion !== schemaVersion ||
    parsed.serializerVersion !== serializerVersion
  ) {
    return {
      ok: false,
      reason: "payload does not match its recorded event schema",
    };
  }
  const canonicalBytes = codec.canonicalize(parsed);
  return canonicalBytes === undefined
    ? {
        ok: false,
        reason: "payload is not canonicalizable by its recorded serializer",
      }
    : { ok: true, event: parsed, canonicalBytes };
}
