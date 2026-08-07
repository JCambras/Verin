import { z } from "zod";
import type { PIIBearing } from "@contracts/pii";
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
  bundleHashPreimageV1_7,
  canonicalJsonV1,
  decisionHashPreimageV1_7,
  type BundleHashPreimage,
  type DecisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import {
  recordedBundleV1_7,
  recordedDecisionV1_7,
  recordedEvidenceV1_7,
} from "./recorded-schemas";
import { createRecordedVersionRegistry } from "./recorded-version-registry";

interface ReplaySourceTypes extends PIIBearing {
  readonly evidence: EvidenceSnapshotRef;
  readonly bundle: DecisionInputBundle;
  readonly decision: DecisionRecord;
}

export type ReplaySourceHashPreimage = PIIBearing & (
  | BundleHashPreimage
  | DecisionHashPreimage
);

interface ReplaySourceCodec<T> extends PIIBearing {
  readonly parseRecorded: (value: unknown) => unknown | undefined;
  readonly canonicalizeRecorded: (value: unknown) => string | undefined;
  readonly upcast: (value: unknown) => T | undefined;
  readonly hashPreimage?: (value: unknown) => ReplaySourceHashPreimage;
}

type ParseResult<T> = PIIBearing & (
  | {
      readonly ok: true;
      readonly value: T;
      readonly canonicalBytes: string;
      readonly hashPreimage: ReplaySourceHashPreimage | null;
    }
  | { readonly ok: false; readonly reason: string }
);

const SOURCE_SCHEMA_VERSION_1_7 = "1.7.0";
const SERIALIZER_VERSION_1 = "1.0.0";
const evidenceSchemaV1_7 = z.fromJSONSchema(recordedEvidenceV1_7 as never);
const bundleSchemaV1_7 = z.fromJSONSchema(recordedBundleV1_7 as never);
const decisionSchemaV1_7 = z.fromJSONSchema(recordedDecisionV1_7 as never);

function sourceCodec<T>(
  recordedSchema: z.ZodType<unknown>,
  currentSchema: z.ZodType<T>,
  prepareCurrent: (value: object) => object,
  hashPreimage?: (value: unknown) => ReplaySourceHashPreimage,
): ReplaySourceCodec<T> {
  return {
    parseRecorded(value) {
      const parsed = recordedSchema.safeParse(value);
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
      const parsed = currentSchema.safeParse(prepareCurrent(value));
      return parsed.success ? parsed.data : undefined;
    },
    ...(hashPreimage ? { hashPreimage } : {}),
  };
}

const evidenceCodecV1_7 = sourceCodec(
  evidenceSchemaV1_7,
  EvidenceSnapshotRefSchema,
  (value) => value,
);
const bundleCodecV1_7 = sourceCodec(
  bundleSchemaV1_7,
  DecisionInputBundleSchema,
  (value) => ({
    ...value,
    schemaVersion: DECISION_CORE_SCHEMA_VERSION,
    canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
  }),
  (value) => bundleHashPreimageV1_7(value as DecisionInputBundle),
);
const decisionCodecV1_7 = sourceCodec(
  decisionSchemaV1_7,
  DecisionRecordSchema,
  (value) => value,
  (value) => decisionHashPreimageV1_7(value as DecisionRecord),
);

const REGISTRIES = {
  evidence: createRecordedVersionRegistry<ReplaySourceCodec<EvidenceSnapshotRef>>([{
    schemaVersion: SOURCE_SCHEMA_VERSION_1_7,
    serializerVersion: SERIALIZER_VERSION_1,
    codec: evidenceCodecV1_7,
  }]),
  bundle: createRecordedVersionRegistry<ReplaySourceCodec<DecisionInputBundle>>([{
    schemaVersion: SOURCE_SCHEMA_VERSION_1_7,
    serializerVersion: SERIALIZER_VERSION_1,
    codec: bundleCodecV1_7,
  }]),
  decision: createRecordedVersionRegistry<ReplaySourceCodec<DecisionRecord>>([{
    schemaVersion: SOURCE_SCHEMA_VERSION_1_7,
    serializerVersion: SERIALIZER_VERSION_1,
    codec: decisionCodecV1_7,
  }]),
};

export function parseRecordedReplaySource<
  K extends Extract<keyof ReplaySourceTypes, string>,
>(
  kind: K,
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): ParseResult<ReplaySourceTypes[K]> {
  const codec = REGISTRIES[kind].resolve(
    schemaVersion,
    serializerVersion,
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
    hashPreimage: codec.hashPreimage?.(recorded) ?? null,
  };
}
