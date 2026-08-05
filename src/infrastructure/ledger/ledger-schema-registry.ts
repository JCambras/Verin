import {
  LedgerEntryV1_0_0Schema,
  LedgerEntryV1_1_0Schema,
  type LedgerEntry,
} from "@contracts/decision-core/ledger-v1/ledger";
import {
  canonicalJsonV1_0_0,
  type JsonValue,
} from "@contracts/decision-core/v1-7/serialization";
import type {
  ComputedLedgerProducerProvenance,
  RecordProvenance,
} from "@contracts/provenance";

const DIRECT_PROVENANCE_V1_0_0 = "record-v1.0.0";
const LEGACY_COMPUTED_PROVENANCE_V1_0_0 = "computed-legacy-v0.0.0";
const COMPUTED_PROVENANCE_V1_0_0 = "computed-v1.0.0";
const PROVENANCE_SERIALIZER_V1_0_0 = "1.0.0";

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

function exactKeysV1_0_0(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length &&
    expected.every((key) => keys.includes(key));
}

function canonicalTimestampV1_0_0(value: unknown): value is string {
  return typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function lexicalIdV1_0_0(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
}

function hashV1_0_0(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function scopedRefV1_0_0(
  value: unknown,
): value is { readonly firmId: string; readonly id: string } {
  return value !== null &&
    typeof value === "object" &&
    exactKeysV1_0_0(value, ["firmId", "id"]) &&
    lexicalIdV1_0_0(Reflect.get(value, "firmId")) &&
    lexicalIdV1_0_0(Reflect.get(value, "id"));
}

function parseComputedProvenanceV1_0_0(
  value: unknown,
): ComputedLedgerProducerProvenance | null {
  if (
    value === null ||
    typeof value !== "object" ||
    !exactKeysV1_0_0(value, ["source", "asOf", "confidence", "derivation"]) ||
    Reflect.get(value, "source") !== "computed"
  ) return null;
  const asOf = Reflect.get(value, "asOf");
  const confidence = Reflect.get(value, "confidence");
  const derivation = Reflect.get(value, "derivation");
  if (
    !canonicalTimestampV1_0_0(asOf) ||
    !PROVENANCE_CONFIDENCES_V1_0_0.has(confidence as string) ||
    derivation === null ||
    typeof derivation !== "object" ||
    !exactKeysV1_0_0(derivation, [
      "schemaVersion", "serializerVersion", "traceRef", "producer", "inputs",
      "observedAt", "confidence", "traceDigest",
    ]) ||
    Reflect.get(derivation, "schemaVersion") !== COMPUTED_PROVENANCE_V1_0_0 ||
    Reflect.get(derivation, "serializerVersion") !== PROVENANCE_SERIALIZER_V1_0_0 ||
    !scopedRefV1_0_0(Reflect.get(derivation, "traceRef")) ||
    Reflect.get(derivation, "observedAt") !== asOf ||
    Reflect.get(derivation, "confidence") !== confidence ||
    !hashV1_0_0(Reflect.get(derivation, "traceDigest"))
  ) return null;
  const producer = Reflect.get(derivation, "producer");
  const inputs = Reflect.get(derivation, "inputs");
  if (
    producer === null ||
    typeof producer !== "object" ||
    !exactKeysV1_0_0(producer, ["kind", "id", "version"]) ||
    Reflect.get(producer, "kind") !== "algorithm" ||
    !lexicalIdV1_0_0(Reflect.get(producer, "id")) ||
    typeof Reflect.get(producer, "version") !== "string" ||
    !/^[0-9]+(?:\.[0-9]+){1,3}(?:-[a-z0-9.-]+)?$/.test(
      Reflect.get(producer, "version") as string,
    ) ||
    !Array.isArray(inputs) ||
    inputs.length === 0
  ) return null;
  const traceRef = Reflect.get(derivation, "traceRef") as {
    readonly firmId: string;
  };
  const seen = new Set<string>();
  for (const input of inputs) {
    if (
      input === null ||
      typeof input !== "object" ||
      !exactKeysV1_0_0(input, ["kind", "entryRef", "entryHash"]) ||
      Reflect.get(input, "kind") !== "ledger-entry" ||
      !scopedRefV1_0_0(Reflect.get(input, "entryRef")) ||
      !hashV1_0_0(Reflect.get(input, "entryHash"))
    ) return null;
    const ref = Reflect.get(input, "entryRef") as {
      readonly firmId: string;
      readonly id: string;
    };
    const key = `${ref.firmId}\u0000${ref.id}`;
    if (ref.firmId !== traceRef.firmId || seen.has(key)) return null;
    seen.add(key);
  }
  return value as ComputedLedgerProducerProvenance;
}

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
        COMPUTED_PROVENANCE_V1_0_0,
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
      (version === DIRECT_PROVENANCE_V1_0_0 &&
        source === "computed") ||
      (version === LEGACY_COMPUTED_PROVENANCE_V1_0_0 &&
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
    version !== COMPUTED_PROVENANCE_V1_0_0 ||
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
  const provenance = parseComputedProvenanceV1_0_0(unknown);
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
