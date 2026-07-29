import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  DecisionInputBundleV1_7_0Schema,
  EvidenceSnapshotRefV1_7_0Schema,
} from "@contracts/decision-core/v1-7/evidence";
import type {
  DecisionInputBundle,
  EvidenceSnapshotRef,
} from "@contracts/decision-core/evidence";
import {
  DecisionInputBundleV1_8_0Schema,
} from "@contracts/decision-core/v1-8/evidence";
import {
  DecisionRecordV1_7_0Schema,
} from "@contracts/decision-core/v1-7/decision";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import {
  bundleHashPreimageV1_7_0,
  canonicalJsonV1_0_0,
  decisionHashPreimageV1_7_0,
  type JsonValue,
} from "@contracts/decision-core/v1-7/serialization";
import {
  bundleHashPreimageV1_8_0,
} from "@contracts/decision-core/v1-8/serialization";
import { isVersionIdentifier } from "./ledger-pii";

interface ReplaySourceTypes {
  readonly evidence: EvidenceSnapshotRef;
  readonly bundle: DecisionInputBundle;
  readonly decision: DecisionRecord;
}

interface ReplaySourceCodec<TCurrent> {
  readonly parseRecorded: (value: unknown) => {
    readonly recorded: unknown;
    readonly current: TCurrent;
  } | undefined;
  readonly canonicalizeRecorded: (value: unknown) => string | undefined;
  readonly hashRecorded: (value: unknown) => string | undefined;
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

function codecV1_0_0<TRecorded, TCurrent>(
  schema: z.ZodType<TRecorded>,
  hashValue: (value: TRecorded) => unknown,
  upcast: (value: TRecorded) => TCurrent,
): ReplaySourceCodec<TCurrent> {
  return {
    parseRecorded(value) {
      const parsed = schema.safeParse(value);
      return parsed.success
        ? { recorded: parsed.data, current: upcast(parsed.data) }
        : undefined;
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
  };
}

const REGISTRIES = {
  evidence: new Map<string, ReplaySourceCodec<EvidenceSnapshotRef>>([
    ["1.7.0|1.0.0", codecV1_0_0(
      EvidenceSnapshotRefV1_7_0Schema,
      (value) => value,
      (value) => value,
    )],
    ["1.8.0|1.0.0", codecV1_0_0(
      EvidenceSnapshotRefV1_7_0Schema,
      (value) => value,
      (value) => value,
    )],
  ]),
  bundle: new Map<string, ReplaySourceCodec<DecisionInputBundle>>([
    ["1.7.0|1.0.0", codecV1_0_0(
      DecisionInputBundleV1_7_0Schema,
      bundleHashPreimageV1_7_0,
      (value) => Object.freeze({
        ...value,
        regulatoryVersionRefs: Object.freeze([]),
      }) as unknown as DecisionInputBundle,
    )],
    ["1.8.0|1.0.0", codecV1_0_0(
      DecisionInputBundleV1_8_0Schema,
      bundleHashPreimageV1_8_0,
      (value) => value,
    )],
  ]),
  decision: new Map<string, ReplaySourceCodec<DecisionRecord>>([
    ["1.7.0|1.0.0", codecV1_0_0(
      DecisionRecordV1_7_0Schema,
      decisionHashPreimageV1_7_0,
      (value) => value,
    )],
    ["1.8.0|1.0.0", codecV1_0_0(
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
    | ReplaySourceCodec<ReplaySourceTypes[K]>
    | undefined;
  if (!codec) {
    return {
      ok: false,
      reason: `unsupported ${kind} encoding ${safeEncoding(schemaVersion, serializerVersion)}`,
    };
  }
  const parsed = codec.parseRecorded(value);
  if (parsed === undefined) {
    return { ok: false, reason: `${kind} source does not match its recorded schema` };
  }
  const canonicalBytes = codec.canonicalizeRecorded(parsed.recorded);
  if (canonicalBytes === undefined) {
    return { ok: false, reason: `${kind} source is not canonically serializable` };
  }
  const recordedHash = codec.hashRecorded(parsed.recorded);
  return recordedHash === undefined
    ? { ok: false, reason: `${kind} source hash cannot be reproduced` }
    : {
        ok: true,
        value: parsed.current,
        canonicalBytes,
        recordedHash,
      };
}
