import {
  LEDGER_ENTRY_SCHEMAS,
  type LedgerEntry,
  type LedgerSchemaVersion,
} from "@contracts/decision-core/ledger";
import type { RecordProvenance } from "@contracts/provenance";

type ParseResult =
  | { readonly ok: true; readonly event: LedgerEntry }
  | { readonly ok: false; readonly reason: string };

type ChainPreimage = (
  payloadJson: string,
  provenance: RecordProvenance,
) => string;

const encodingKey = (
  schemaVersion: string,
  serializerVersion: string,
): string => `${schemaVersion}|${serializerVersion}`;

const schemaFor = (version: LedgerSchemaVersion) =>
  LEDGER_ENTRY_SCHEMAS.get(version)!;

/**
 * Recorded-byte registries. Both are keyed by EXPLICIT version literals, never by
 * the current-version constants: a write-side bump adds a key here and leaves every
 * older key answering for the bytes it wrote. `decision_ledger` refuses DELETE, so a
 * dropped key would make already-committed rows permanently unverifiable.
 */
const LEDGER_SCHEMA_REGISTRY = new Map([
  [encodingKey("1.0.0", "1.0.0"), schemaFor("1.0.0")],
  [encodingKey("1.1.0", "1.0.0"), schemaFor("1.1.0")],
]);

const chainPreimageV1_0_0: ChainPreimage = (payloadJson, provenance) =>
  JSON.stringify([
    "1.0.0",
    payloadJson,
    provenance.source,
    provenance.asOf,
    provenance.confidence,
  ]);

const CHAIN_PREIMAGE_REGISTRY = new Map<string, ChainPreimage>([
  [encodingKey("1.0.0", "1.0.0"), chainPreimageV1_0_0],
  [encodingKey("1.1.0", "1.0.0"), chainPreimageV1_0_0],
]);

/** Registered recorded encodings, for the fence that proves none was dropped. */
export function registeredLedgerEncodings(): readonly string[] {
  return [...LEDGER_SCHEMA_REGISTRY.keys()].filter((key) =>
    CHAIN_PREIMAGE_REGISTRY.has(key));
}

export function decisionLedgerChainPreimage(
  schemaVersion: string,
  serializerVersion: string,
  payloadJson: string,
  provenance: RecordProvenance,
): string | null {
  const preimage = CHAIN_PREIMAGE_REGISTRY.get(
    encodingKey(schemaVersion, serializerVersion),
  );
  return preimage ? preimage(payloadJson, provenance) : null;
}

export function parseRecordedLedgerEvent(
  eventType: string,
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): ParseResult {
  const schema = LEDGER_SCHEMA_REGISTRY.get(
    encodingKey(schemaVersion, serializerVersion),
  );
  if (!schema) {
    return {
      ok: false,
      reason: `unsupported ledger encoding ${schemaVersion}/${serializerVersion}`,
    };
  }
  const parsed = schema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.type !== eventType ||
    parsed.data.schemaVersion !== schemaVersion
  ) {
    return {
      ok: false,
      reason: "payload does not match its recorded event schema",
    };
  }
  return { ok: true, event: parsed.data };
}
