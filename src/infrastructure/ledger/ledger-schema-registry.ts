import {
  LedgerEntryV1_0_0Schema,
  LedgerEntryV1_1_0Schema,
  type LedgerEntry,
} from "@contracts/decision-core/ledger-v1/ledger";
import {
  canonicalJsonV1_0_0,
  type JsonValue,
} from "@contracts/decision-core/v1-7/serialization";
import type { RecordProvenance } from "@contracts/provenance";

type ParseResult =
  | { readonly ok: true; readonly event: LedgerEntry; readonly canonicalBytes: string }
  | { readonly ok: false; readonly reason: string };

interface RecordedLedgerCodec {
  readonly parse: (value: unknown) => LedgerEntry | undefined;
  readonly canonicalize: (value: unknown) => string | undefined;
  readonly parseProvenance: (value: unknown) => RecordProvenance | undefined;
  readonly chainPreimage: (
    payloadJson: string,
    provenance: RecordProvenance,
  ) => string;
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
    parseProvenance: parseProvenanceV1_0_0,
    chainPreimage: chainPreimageV1_0_0,
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
  provenance: unknown,
): string | null {
  const codec = LEDGER_CODEC_REGISTRY.get(encodingKey(schemaVersion, serializerVersion));
  const parsed = codec?.parseProvenance(provenance);
  return codec && parsed ? codec.chainPreimage(payloadJson, parsed) : null;
}

export function parseRecordedLedgerProvenance(
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): RecordProvenance | null {
  return LEDGER_CODEC_REGISTRY
    .get(encodingKey(schemaVersion, serializerVersion))
    ?.parseProvenance(value) ?? null;
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
