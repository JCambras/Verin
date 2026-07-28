import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  DecisionInputBundleV1_7_0Schema,
  EvidenceSnapshotRefV1_7_0Schema,
  type DecisionInputBundleV1_7_0,
  type EvidenceSnapshotRefV1_7_0,
} from "@contracts/decision-core/v1-7/evidence";
import type {
  DecisionInputBundle,
  EvidenceSnapshotRef,
} from "@contracts/decision-core/evidence";
import {
  DecisionRecordV1_7_0Schema,
  type DecisionRecordV1_7_0,
} from "@contracts/decision-core/v1-7/decision";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import {
  bundleHashPreimageV1_7_0,
  canonicalJsonV1_0_0,
  decisionHashPreimageV1_7_0,
  type JsonValue,
} from "@contracts/decision-core/v1-7/serialization";
import { isVersionIdentifier } from "./ledger-pii";

interface ReplaySourceTypes {
  readonly evidence: EvidenceSnapshotRef;
  readonly bundle: DecisionInputBundle;
  readonly decision: DecisionRecord;
}

interface ReplaySourceCodec<TRecorded, TCurrent> {
  readonly parseRecorded: (value: unknown) => TRecorded | undefined;
  readonly canonicalizeRecorded: (value: unknown) => string | undefined;
  readonly hashRecorded: (value: unknown) => string | undefined;
  readonly upcast: (value: TRecorded) => TCurrent | undefined;
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

const digestV1_0_0 = (bytes: string): string =>
  createHash("sha256").update(bytes, "utf8").digest("hex");

function codecV1_7_0<TRecorded, TCurrent>(
  schema: z.ZodType<TRecorded>,
  hashValue: (value: TRecorded) => unknown,
  upcast: (value: TRecorded) => TCurrent,
): ReplaySourceCodec<TRecorded, TCurrent> {
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
      return serialized.ok ? digestV1_0_0(serialized.value) : undefined;
    },
    upcast,
  };
}

const REGISTRIES = {
  evidence: new Map<string, ReplaySourceCodec<EvidenceSnapshotRefV1_7_0, EvidenceSnapshotRef>>([
    ["1.7.0|1.0.0", codecV1_7_0(
      EvidenceSnapshotRefV1_7_0Schema,
      (value) => value,
      (value) => value,
    )],
  ]),
  bundle: new Map<string, ReplaySourceCodec<DecisionInputBundleV1_7_0, DecisionInputBundle>>([
    ["1.7.0|1.0.0", codecV1_7_0(
      DecisionInputBundleV1_7_0Schema,
      bundleHashPreimageV1_7_0,
      (value) => value,
    )],
  ]),
  decision: new Map<string, ReplaySourceCodec<DecisionRecordV1_7_0, DecisionRecord>>([
    ["1.7.0|1.0.0", codecV1_7_0(
      DecisionRecordV1_7_0Schema,
      decisionHashPreimageV1_7_0,
      (value) => value,
    )],
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
    | ReplaySourceCodec<unknown, ReplaySourceTypes[K]>
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
