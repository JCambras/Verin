import type { z } from "zod";
import {
  EvidenceSnapshotRefSchema,
  DecisionInputBundleSchema,
  type EvidenceSnapshotRef,
  type DecisionInputBundle,
} from "@contracts/decision-core/evidence";
import {
  DecisionRecordSchema,
  type DecisionRecord,
} from "@contracts/decision-core/decision";
import {
  CANONICAL_SERIALIZER_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";

interface ReplaySourceTypes {
  readonly evidence: EvidenceSnapshotRef;
  readonly bundle: DecisionInputBundle;
  readonly decision: DecisionRecord;
}

interface ReplaySourceCodec<T> {
  readonly parseRecorded: (value: unknown) => unknown | undefined;
  readonly canonicalizeRecorded: (value: unknown) => string | undefined;
  readonly upcast: (value: unknown) => T | undefined;
}

type ParseResult<T> =
  | { readonly ok: true; readonly value: T; readonly canonicalBytes: string }
  | { readonly ok: false; readonly reason: string };

const key = (schemaVersion: string, serializerVersion: string): string =>
  `${schemaVersion}|${serializerVersion}`;

function currentCodec<T>(
  schema: z.ZodType<T>,
): ReplaySourceCodec<T> {
  return {
    parseRecorded(value) {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    },
    canonicalizeRecorded(value) {
      const serialized = canonicalJson(value as unknown as JsonValue);
      return serialized.ok ? serialized.value : undefined;
    },
    upcast(value) {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    },
  };
}

const CURRENT_ENCODING = key(
  DECISION_CORE_SCHEMA_VERSION,
  CANONICAL_SERIALIZER_VERSION,
);

const REGISTRIES = {
  evidence: new Map<string, ReplaySourceCodec<EvidenceSnapshotRef>>([
    [CURRENT_ENCODING, currentCodec(EvidenceSnapshotRefSchema)],
  ]),
  bundle: new Map<string, ReplaySourceCodec<DecisionInputBundle>>([
    [CURRENT_ENCODING, currentCodec(DecisionInputBundleSchema)],
  ]),
  decision: new Map<string, ReplaySourceCodec<DecisionRecord>>([
    [CURRENT_ENCODING, currentCodec(DecisionRecordSchema)],
  ]),
};

export function parseRecordedReplaySource<
  K extends keyof ReplaySourceTypes,
>(
  kind: K,
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): ParseResult<ReplaySourceTypes[K]> {
  const codec = REGISTRIES[kind].get(
    key(schemaVersion, serializerVersion),
  ) as ReplaySourceCodec<ReplaySourceTypes[K]> | undefined;
  if (!codec) {
    return {
      ok: false,
      reason: `unsupported ${kind} encoding ${schemaVersion}/${serializerVersion}`,
    };
  }
  const recorded = codec.parseRecorded(value);
  if (recorded === undefined) {
    return { ok: false, reason: `${kind} source does not match its recorded schema` };
  }
  const canonicalBytes = codec.canonicalizeRecorded(recorded);
  if (canonicalBytes === undefined) {
    return { ok: false, reason: `${kind} source is not canonically serializable` };
  }
  const current = codec.upcast(recorded);
  if (current === undefined) {
    return { ok: false, reason: `${kind} source cannot upcast to the current schema` };
  }
  return {
    ok: true,
    value: current,
    canonicalBytes,
  };
}
