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
  COMPUTED_LEDGER_PROVENANCE_VERSION,
  DIRECT_LEDGER_PROVENANCE_VERSION,
  LEGACY_COMPUTED_LEDGER_PROVENANCE_VERSION,
  LEDGER_PROVENANCE_SERIALIZER_VERSION,
  parseLedgerProducerProvenance,
  type ComputedLedgerProducerProvenance,
  type RecordProvenance,
} from "@contracts/provenance";

export type RecordedLedgerProvenance =
  | RecordProvenance
  | ComputedLedgerProducerProvenance;

export interface RecordedLedgerProvenanceFields {
  readonly source: unknown;
  readonly asOf: unknown;
  readonly confidence: unknown;
  readonly provenanceSchemaVersion?: unknown;
  readonly provenanceSerializerVersion?: unknown;
  readonly provenanceJson?: unknown;
  readonly provenanceTraceId?: unknown;
}

type ParseResult =
  | { readonly ok: true; readonly event: LedgerEntry; readonly canonicalBytes: string }
  | { readonly ok: false; readonly reason: string };

interface RecordedLedgerCodec {
  readonly parse: (value: unknown) => LedgerEntry | undefined;
  readonly canonicalize: (value: unknown) => string | undefined;
}

const encodingKey = (schemaVersion: string, serializerVersion: string): string =>
  `${schemaVersion}|${serializerVersion}`;
const chainPreimageV1_0_0 = (
  payloadJson: string,
  provenance: RecordProvenance,
) =>
  JSON.stringify([
    "1.0.0",
    payloadJson,
    provenance.source,
    provenance.asOf,
    provenance.confidence,
  ]);

const PROVENANCE_SOURCES_V1_0_0 = new Set([
  "verin-crm",
  "salesforce",
  "csv-import",
  "computed",
  "user-input",
  "estimate",
  "default",
  "fixture",
]);
const PROVENANCE_CONFIDENCES_V1_0_0 = new Set([
  "high",
  "medium",
  "low",
]);

function parseProvenanceV1_0_0(
  value: unknown,
): RecordProvenance | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as {
    readonly source?: unknown;
    readonly asOf?: unknown;
    readonly confidence?: unknown;
  };
  if (
    typeof candidate.source !== "string" ||
    !PROVENANCE_SOURCES_V1_0_0.has(candidate.source) ||
    typeof candidate.asOf !== "string" ||
    Number.isNaN(Date.parse(candidate.asOf)) ||
    typeof candidate.confidence !== "string" ||
    !PROVENANCE_CONFIDENCES_V1_0_0.has(candidate.confidence)
  ) {
    return undefined;
  }
  return {
    source: candidate.source as RecordProvenance["source"],
    asOf: new Date(candidate.asOf).toISOString(),
    confidence: candidate.confidence as RecordProvenance["confidence"],
  };
}

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
  [
    encodingKey("1.0.0", "1.0.0"),
    codecV1_0_0(LedgerEntryV1_0_0Schema),
  ],
  [
    encodingKey("1.1.0", "1.0.0"),
    codecV1_0_0(LedgerEntryV1_1_0Schema),
  ],
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
  const parsed = parseRecordedLedgerProvenanceFields(provenance);
  if (!codec || !parsed) return null;
  return parsed.kind === "computed"
    ? JSON.stringify([
        COMPUTED_LEDGER_PROVENANCE_VERSION,
        payloadJson,
        parsed.canonicalBytes,
      ])
    : chainPreimageV1_0_0(payloadJson, parsed.provenance);
}

type ParsedRecordedProvenance =
  | {
      readonly kind: "legacy";
      readonly provenance: RecordProvenance;
    }
  | {
      readonly kind: "computed";
      readonly provenance: ComputedLedgerProducerProvenance;
      readonly canonicalBytes: string;
    };

function parseRecordedLedgerProvenanceFields(
  value: RecordedLedgerProvenanceFields,
): ParsedRecordedProvenance | null {
  const source = value.source;
  const version = value.provenanceSchemaVersion ??
    (source === "computed"
      ? LEGACY_COMPUTED_LEDGER_PROVENANCE_VERSION
      : DIRECT_LEDGER_PROVENANCE_VERSION);
  const serializer = value.provenanceSerializerVersion ??
    LEDGER_PROVENANCE_SERIALIZER_VERSION;
  if (serializer !== LEDGER_PROVENANCE_SERIALIZER_VERSION) return null;
  if (
    version === DIRECT_LEDGER_PROVENANCE_VERSION ||
    version === LEGACY_COMPUTED_LEDGER_PROVENANCE_VERSION
  ) {
    if (
      (version === DIRECT_LEDGER_PROVENANCE_VERSION &&
        source === "computed") ||
      (version === LEGACY_COMPUTED_LEDGER_PROVENANCE_VERSION &&
        source !== "computed") ||
      (value.provenanceJson !== undefined &&
        value.provenanceJson !== null) ||
      (value.provenanceTraceId !== undefined &&
        value.provenanceTraceId !== null)
    ) {
      return null;
    }
    const provenance = parseProvenanceV1_0_0({
      source,
      asOf: value.asOf,
      confidence: value.confidence,
    });
    return provenance ? { kind: "legacy", provenance } : null;
  }
  if (
    version !== COMPUTED_LEDGER_PROVENANCE_VERSION ||
    source !== "computed" ||
    typeof value.provenanceJson !== "string" ||
    typeof value.provenanceTraceId !== "string"
  ) {
    return null;
  }
  let unknown: unknown;
  try {
    unknown = JSON.parse(value.provenanceJson);
  } catch {
    return null;
  }
  const provenance = parseLedgerProducerProvenance(unknown);
  const serialized = canonicalJsonV1_0_0(unknown as JsonValue);
  if (
    !provenance ||
    provenance.source !== "computed" ||
    !serialized.ok ||
    serialized.value !== value.provenanceJson ||
    provenance.asOf !== value.asOf ||
    provenance.confidence !== value.confidence ||
    provenance.derivation.traceRef.id !== value.provenanceTraceId
  ) {
    return null;
  }
  return {
    kind: "computed",
    provenance,
    canonicalBytes: serialized.value,
  };
}

export function parseRecordedLedgerProvenance(
  schemaVersion: string,
  serializerVersion: string,
  value: RecordedLedgerProvenanceFields,
): RecordedLedgerProvenance | null {
  if (
    !LEDGER_CODEC_REGISTRY.has(
      encodingKey(schemaVersion, serializerVersion),
    )
  ) return null;
  return parseRecordedLedgerProvenanceFields(value)?.provenance ?? null;
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
