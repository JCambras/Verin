import {
  LEDGER_EVENT_TYPES,
  LEDGER_SCHEMA_VERSION,
  LedgerEntrySchema,
  type LedgerEntry,
} from "@contracts/decision-core/ledger";
import {
  CANONICAL_SERIALIZER_VERSION,
} from "@contracts/decision-core/serialization";
import type { RecordProvenance } from "@contracts/provenance";

type ParseResult =
  | { readonly ok: true; readonly event: LedgerEntry }
  | { readonly ok: false; readonly reason: string };

const schemaKey = (
  eventType: string,
  schemaVersion: string,
  serializerVersion: string,
) => `${eventType}|${schemaVersion}|${serializerVersion}`;

/**
 * Additive recorded-byte registry. Future versions add keys and optional pure
 * upcasts. Existing keys are never removed or made to use a newer serializer.
 */
const LEDGER_SCHEMA_REGISTRY = new Map(
  LEDGER_EVENT_TYPES.map((eventType) => [
    schemaKey(
      eventType,
      LEDGER_SCHEMA_VERSION,
      CANONICAL_SERIALIZER_VERSION,
    ),
    LedgerEntrySchema,
  ]),
);

const DECISION_LEDGER_CHAIN_PREIMAGE_VERSION = "1.0.0";

export function decisionLedgerChainPreimage(
  schemaVersion: string,
  serializerVersion: string,
  payloadJson: string,
  provenance: RecordProvenance,
): string | null {
  if (
    schemaVersion !== LEDGER_SCHEMA_VERSION ||
    serializerVersion !== CANONICAL_SERIALIZER_VERSION
  ) {
    return null;
  }
  return JSON.stringify([
    DECISION_LEDGER_CHAIN_PREIMAGE_VERSION,
    payloadJson,
    provenance.source,
    provenance.asOf,
    provenance.confidence,
  ]);
}

export function parseRecordedLedgerEvent(
  eventType: string,
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): ParseResult {
  const schema = LEDGER_SCHEMA_REGISTRY.get(
    schemaKey(eventType, schemaVersion, serializerVersion),
  );
  if (!schema) {
    return {
      ok: false,
      reason: `unsupported ledger encoding ${schemaVersion}/${serializerVersion}`,
    };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data.type !== eventType) {
    return {
      ok: false,
      reason: "payload does not match its recorded event schema",
    };
  }
  return { ok: true, event: parsed.data };
}
