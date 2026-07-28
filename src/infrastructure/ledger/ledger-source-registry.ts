import type { z } from "zod";
import {
  DecisionInputBundleV1_7_0Schema,
  EvidenceSnapshotRefV1_7_0Schema,
  type DecisionInputBundle,
  type EvidenceSnapshotRef,
} from "@contracts/decision-core/evidence";
import { DecisionRecordV1_7_0Schema, type DecisionRecord } from "@contracts/decision-core/decision";
import {
  bundleHashPreimageV1_7_0,
  canonicalJsonV1_0_0,
  decisionHashPreimageV1_7_0,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { digestCanonicalBytes } from "./ledger-canonical";
import { isVersionIdentifier } from "./ledger-pii";

interface ReplaySourceTypes {
  readonly evidence: EvidenceSnapshotRef;
  readonly bundle: DecisionInputBundle;
  readonly decision: DecisionRecord;
}

interface ReplaySourceCodec<T> {
  readonly parseRecorded: (value: unknown) => unknown | undefined;
  readonly canonicalizeRecorded: (value: unknown) => string | undefined;
  readonly hashRecorded: (value: unknown) => string | undefined;
  readonly upcast: (value: unknown) => T | undefined;
}

type ParseResult<T> =
  | { readonly ok: true; readonly value: T; readonly canonicalBytes: string; readonly recordedHash: string }
  | { readonly ok: false; readonly reason: string };

const key = (schemaVersion: string, serializerVersion: string): string =>
  `${schemaVersion}|${serializerVersion}`;

const safeEncoding = (schemaVersion: string, serializerVersion: string): string =>
  isVersionIdentifier(schemaVersion) && isVersionIdentifier(serializerVersion)
    ? `${schemaVersion}/${serializerVersion}`
    : "unrecognized";

function codecV1_7_0<T>(
  schema: z.ZodType<T>,
  hashValue: (value: T) => unknown,
): ReplaySourceCodec<T> {
  return {
    parseRecorded(value) {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    },
    canonicalizeRecorded(value) {
      const serialized = canonicalJsonV1_0_0(value as JsonValue);
      return serialized.ok ? serialized.value : undefined;
    },
    hashRecorded(value) {
      const parsed = schema.safeParse(value);
      if (!parsed.success) return undefined;
      const serialized = canonicalJsonV1_0_0(
        hashValue(parsed.data) as JsonValue,
      );
      return serialized.ok ? digestCanonicalBytes(serialized.value) : undefined;
    },
    upcast(value) {
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : undefined;
    },
  };
}

const REGISTRIES = {
  evidence: new Map<string, ReplaySourceCodec<EvidenceSnapshotRef>>([
    ["1.7.0|1.0.0", codecV1_7_0(EvidenceSnapshotRefV1_7_0Schema, (value) => value)],
  ]),
  bundle: new Map<string, ReplaySourceCodec<DecisionInputBundle>>([
    ["1.7.0|1.0.0", codecV1_7_0(DecisionInputBundleV1_7_0Schema, bundleHashPreimageV1_7_0)],
  ]),
  decision: new Map<string, ReplaySourceCodec<DecisionRecord>>([
    ["1.7.0|1.0.0", codecV1_7_0(DecisionRecordV1_7_0Schema, decisionHashPreimageV1_7_0)],
  ]),
};

export function registeredSourceEncodings(kind: keyof ReplaySourceTypes): readonly string[] {
  return [...REGISTRIES[kind].keys()];
}

export function parseRecordedReplaySource<
  K extends keyof ReplaySourceTypes,
>(
  kind: K,
  schemaVersion: string,
  serializerVersion: string,
  value: unknown,
): ParseResult<ReplaySourceTypes[K]> {
  const codec = REGISTRIES[kind].get(key(schemaVersion, serializerVersion)) as
    | ReplaySourceCodec<ReplaySourceTypes[K]>
    | undefined;
  if (!codec) {
    return {
      ok: false,
      reason: `unsupported ${kind} encoding ${safeEncoding(schemaVersion, serializerVersion)}`,
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
  const recordedHash = codec.hashRecorded(recorded);
  return recordedHash === undefined
    ? { ok: false, reason: `${kind} source hash cannot be reproduced` }
    : { ok: true, value: current, canonicalBytes, recordedHash };
}
