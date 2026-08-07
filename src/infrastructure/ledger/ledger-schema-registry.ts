import { z } from "zod";
import {
  LedgerEntrySchema,
  LEDGER_SCHEMA_VERSION,
  referencedDecisionId,
  type LedgerEntry,
} from "@contracts/decision-core/ledger";
import {
  CANONICAL_SERIALIZER_VERSION,
  canonicalJsonV1,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import type { RecordProvenance } from "@contracts/provenance";
import type { PIIBearing } from "@contracts/pii";
import { recordedLedgerV1_1 } from "./recorded-schemas";
import { createRecordedVersionRegistry } from "./recorded-version-registry";

type ParseResult = PIIBearing & (
  | {
      readonly ok: true;
      readonly event: LedgerEntry;
      readonly canonicalBytes: string;
      readonly promoted: RecordedLedgerColumns;
    }
  | { readonly ok: false; readonly reason: string }
);

interface LedgerCodec extends PIIBearing {
  readonly parseRecorded: (value: unknown) => unknown | undefined;
  readonly canonicalizeRecorded: (value: unknown) => string | undefined;
  readonly upcast: (value: unknown) => LedgerEntry | undefined;
  readonly promote: (
    value: unknown,
    event: LedgerEntry,
  ) => RecordedLedgerColumns | undefined;
}

export interface RecordedLedgerColumns extends PIIBearing {
  readonly firmId: string;
  readonly id: string;
  readonly eventType: string;
  readonly schemaVersion: string;
  readonly serializerVersion: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorJson: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly decisionId: string | null;
  readonly evidenceSnapshotId: string | null;
  readonly triggeringEntryId: string | null;
  readonly reservationCreationId: string | null;
}

type ChainPreimage = (
  payloadJson: string,
  provenance: RecordProvenance,
) => string;

const LEDGER_EVENT_TYPES_1_1 = [
  "DecisionRecorded",
  "EvidenceSnapshotRecorded",
  "ApprovalRecorded",
  "ApprovalInvalidated",
  "ApprovalStageExpired",
  "ApprovalStageEscalated",
  "ReservationCreated",
  "ReservationReleased",
  "ExecutionStarted",
  "ExecutionSucceeded",
  "ExecutionPartiallySucceeded",
  "ExecutionFailed",
  "StatusObserved",
  "VerificationClosed",
  "VerificationStuck",
  "ExceptionDecisionRequested",
] as const;
const LEDGER_SCHEMA_VERSION_1_1 = "1.1.0";
const SERIALIZER_VERSION_1 = "1.0.0";
const CHAIN_PREIMAGE_VERSION_1 = "1.0.0";
const ledgerSchemaV1_1 = z.fromJSONSchema(recordedLedgerV1_1 as never);

function promoteV1_1(
  value: unknown,
  event: LedgerEntry,
): RecordedLedgerColumns | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const recorded = value as Record<string, unknown>;
  const actor = canonicalJsonV1(recorded.actor as JsonValue);
  if (
    !actor.ok ||
    typeof recorded.schemaVersion !== "string" ||
    typeof recorded.serializerVersion !== "string"
  ) return undefined;
  const evidenceSnapshotId = event.type === "EvidenceSnapshotRecorded"
    ? event.evidenceSnapshotRef.id
    : event.type === "StatusObserved"
      ? event.evidenceSnapshotRef?.id ?? null
      : null;
  return {
    firmId: event.firmId,
    id: event.id,
    eventType: event.type,
    schemaVersion: recorded.schemaVersion,
    serializerVersion: recorded.serializerVersion,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    actorJson: actor.value,
    correlationId: event.correlationId,
    causationId: event.causationRef?.id ?? null,
    decisionId: referencedDecisionId(event) ?? null,
    evidenceSnapshotId,
    triggeringEntryId: event.type === "ExceptionDecisionRequested"
      ? event.triggeringEntryRef.id
      : null,
    reservationCreationId: event.type === "ReservationReleased"
      ? event.reservationCreationRef.id
      : null,
  };
}

const ledgerCodecV1_1: LedgerCodec = {
  parseRecorded(value) {
    const parsed = ledgerSchemaV1_1.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  },
  canonicalizeRecorded(value) {
    const serialized = canonicalJsonV1(value as JsonValue);
    return serialized.ok ? serialized.value : undefined;
  },
  upcast(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const parsed = LedgerEntrySchema.safeParse({
      ...value,
      schemaVersion: LEDGER_SCHEMA_VERSION,
      serializerVersion: CANONICAL_SERIALIZER_VERSION,
    });
    return parsed.success ? parsed.data : undefined;
  },
  promote: promoteV1_1,
};

const ledgerCodecs = createRecordedVersionRegistry<LedgerCodec>(
  LEDGER_EVENT_TYPES_1_1.map((discriminator) => ({
    schemaVersion: LEDGER_SCHEMA_VERSION_1_1,
    serializerVersion: SERIALIZER_VERSION_1,
    discriminator,
    codec: ledgerCodecV1_1,
  })),
);

const chainPreimages = createRecordedVersionRegistry<ChainPreimage>([{
  schemaVersion: LEDGER_SCHEMA_VERSION_1_1,
  serializerVersion: SERIALIZER_VERSION_1,
  codec(payloadJson, provenance) {
    return JSON.stringify([
      CHAIN_PREIMAGE_VERSION_1,
      payloadJson,
      provenance.source,
      provenance.asOf,
      provenance.confidence,
    ]);
  },
}]);

export function decisionLedgerChainPreimage(
  schemaVersion: string,
  serializerVersion: string,
  payloadJson: string,
  provenance: RecordProvenance,
): string | null {
  const handler = chainPreimages.resolve(schemaVersion, serializerVersion);
  return handler?.(payloadJson, provenance) ?? null;
}

export function parseRecordedLedgerEvent(
  eventType: string,
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): ParseResult {
  const codec = ledgerCodecs.resolve(
    schemaVersion,
    serializerVersion,
    eventType,
  );
  if (!codec) {
    return {
      ok: false,
      reason: `unsupported ledger encoding ${schemaVersion}/${serializerVersion}`,
    };
  }
  const recorded = codec.parseRecorded(value);
  if (
    recorded === undefined ||
    recorded === null ||
    typeof recorded !== "object" ||
    !("type" in recorded) ||
    recorded.type !== eventType
  ) {
    return {
      ok: false,
      reason: "payload does not match its recorded event schema",
    };
  }
  const canonicalBytes = codec.canonicalizeRecorded(recorded);
  if (canonicalBytes === undefined) {
    return { ok: false, reason: "ledger payload is not canonically serializable" };
  }
  const event = codec.upcast(recorded);
  if (!event) {
    return { ok: false, reason: "ledger payload cannot upcast to the current schema" };
  }
  const promoted = codec.promote(recorded, event);
  if (!promoted) {
    return { ok: false, reason: "ledger promoted columns cannot be derived" };
  }
  return { ok: true, event, canonicalBytes, promoted };
}
