// Canonical decision-record values. Every identity is recomputed from the exact bytes it names;
// callers never supply a digest that can substitute for bytes. The one JSON canonicalizer accepts
// only closed data and sorts object keys, so record, load and verify share one byte definition.
import { createHash } from "node:crypto";
import { z } from "zod";

const SHA = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SOURCE_KINDS = ["request", "evidence", "policy", "engine", "outcome", "replay-manifest"] as const;
type SourceKind = (typeof SOURCE_KINDS)[number];
type ProducerProvenance = { readonly kind: "web" | "tooling" | "test"; readonly id: string; readonly producedAt: string };
type RecordOrigin = "operator-entry" | "demo-seed" | "test-fixture";
type ExactSource = { readonly kind: Exclude<SourceKind, "replay-manifest">; readonly identity: string; readonly bytes: string };
type ReplaySourceSet = {
  readonly request: ExactSource;
  readonly evidence: ExactSource;
  readonly policy: ExactSource;
  readonly engine: ExactSource;
  readonly outcome: ExactSource;
};
type ReplayManifest = {
  readonly version: "drm.v1";
  readonly request: string;
  readonly evidence: string;
  readonly policy: string;
  readonly engine: string;
  readonly outcome: string;
  readonly outcomeSerializer: "dov.v1";
  readonly evidenceVocabulary: string;
  readonly manifestSchema: "drm.v1";
  readonly decisionAsOf: string;
};
type DecisionRecordAppendInput = {
  readonly orgId: string;
  readonly decisionId: string;
  readonly sources: ReplaySourceSet;
  readonly manifest: { readonly identity: string; readonly bytes: string };
  readonly recordedAt: string;
  readonly producer: ProducerProvenance;
  readonly recordOrigin: RecordOrigin;
  readonly projection: { readonly requestRef: string; readonly householdSlug: string; readonly disposition: "proceed" | "blocked" | "prohibited" };
};
type DecisionRecordAppendResult = { readonly entryId: string; readonly sequence: number; readonly chainHash: string; readonly replayManifestId: string; readonly alreadyRecorded: boolean };

function canonical(value: unknown, path = "value"): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${path} is not a safe integer`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((x, i) => canonical(x, `${path}[${i}]`)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x, `${path}.${k}`)}`).join(",")}}`;
  }
  throw new Error(`${path} is not closed canonical data (${typeof value})`);
}
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const identityFor = (version: string, bytes: string) => `${version}:${hash(bytes)}`;
const exactBytesIdentity = (kind: ExactSource["kind"], bytes: string): string =>
  identityFor(kind === "request" ? "drq.v1" : kind === "evidence" ? "evb.v1" : kind === "policy" ? "fpd.v1" : kind === "engine" ? "den.v1" : "dov.v1", bytes);
const renderDecisionIdFromOutcomeBytes = (bytes: string): string => `d${hash(bytes)}`;

const sourceSchema = z.strictObject({ kind: z.enum(SOURCE_KINDS.slice(0, 5)), identity: z.string().min(1).max(160), bytes: z.string().min(1).max(2_000_000) });
const producerSchema = z.strictObject({ kind: z.enum(["web", "tooling", "test"]), id: z.string().min(1).max(120), producedAt: z.string().regex(INSTANT) });
const appendInputSchema = z.strictObject({
  orgId: z.uuid(),
  decisionId: z.string().regex(/^d[0-9a-f]{64}$/),
  sources: z.strictObject({ request: sourceSchema, evidence: sourceSchema, policy: sourceSchema, engine: sourceSchema, outcome: sourceSchema }),
  manifest: z.strictObject({ identity: z.string().regex(/^drm\.v1:[0-9a-f]{64}$/), bytes: z.string().min(1).max(2_000_000) }),
  recordedAt: z.string().regex(INSTANT),
  producer: producerSchema,
  recordOrigin: z.enum(["operator-entry", "demo-seed", "test-fixture"]),
  projection: z.strictObject({ requestRef: z.string().min(1).max(120), householdSlug: z.string().min(1).max(120), disposition: z.enum(["proceed", "blocked", "prohibited"]) }),
});

function parseReplayManifest(bytes: string): ReplayManifest {
  if (!bytes.startsWith("drm.v1|")) throw new Error("replay manifest bytes do not start with drm.v1");
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.slice("drm.v1|".length));
  } catch {
    throw new Error("replay manifest bytes are not canonical JSON");
  }
  const schema = z.strictObject({
    version: z.literal("drm.v1"),
    request: z.string(),
    evidence: z.string(),
    policy: z.string(),
    engine: z.string(),
    outcome: z.string(),
    outcomeSerializer: z.literal("dov.v1"),
    evidenceVocabulary: z.string().min(1),
    manifestSchema: z.literal("drm.v1"),
    decisionAsOf: z.string().regex(INSTANT),
  });
  const parsed = schema.parse(raw);
  if (`drm.v1|${canonical(parsed)}` !== bytes) throw new Error("replay manifest bytes are not in canonical key order");
  return parsed;
}

function validateAppendInput(raw: unknown): DecisionRecordAppendInput {
  const input = appendInputSchema.parse(raw) as DecisionRecordAppendInput;
  for (const kind of ["request", "evidence", "policy", "engine", "outcome"] as const) {
    const source = input.sources[kind];
    if (source.kind !== kind) throw new Error(`decisionRecord.append refuses source '${kind}': row names kind '${source.kind}'`);
    const recomputed = exactBytesIdentity(kind, source.bytes);
    if (source.identity !== recomputed) throw new Error(`decisionRecord.append refuses source '${kind}': declared identity ${source.identity} differs from exact bytes ${recomputed}`);
  }
  if (renderDecisionIdFromOutcomeBytes(input.sources.outcome.bytes) !== input.decisionId)
    throw new Error("decisionRecord.append refuses decisionId: it does not derive from the exact dov.v1 outcome bytes");
  const manifest = parseReplayManifest(input.manifest.bytes);
  const expected = {
    request: input.sources.request.identity,
    evidence: input.sources.evidence.identity,
    policy: input.sources.policy.identity,
    engine: input.sources.engine.identity,
    outcome: input.sources.outcome.identity,
  };
  for (const [name, identity] of Object.entries(expected))
    if (manifest[name as keyof typeof expected] !== identity) throw new Error(`decisionRecord.append refuses replay manifest citation '${name}': exact source identity differs`);
  if (identityFor("drm.v1", input.manifest.bytes) !== input.manifest.identity) throw new Error("decisionRecord.append refuses replay manifest identity: exact bytes differ");
  if (manifest.decisionAsOf !== input.recordedAt && Date.parse(manifest.decisionAsOf) > Date.parse(input.recordedAt))
    throw new Error("decisionRecord.append refuses time order: decision asOf is after recordedAt");
  return input;
}

function buildReplayManifest(sources: ReplaySourceSet, evidenceVocabulary: string, decisionAsOf: string): { identity: string; bytes: string } {
  const manifest: ReplayManifest = {
    version: "drm.v1",
    request: sources.request.identity,
    evidence: sources.evidence.identity,
    policy: sources.policy.identity,
    engine: sources.engine.identity,
    outcome: sources.outcome.identity,
    outcomeSerializer: "dov.v1",
    evidenceVocabulary,
    manifestSchema: "drm.v1",
    decisionAsOf,
  };
  const bytes = `drm.v1|${canonical(manifest)}`;
  return { identity: identityFor("drm.v1", bytes), bytes };
}

function genesisEnvelope(orgId: string, lcmDigest: string, recordedAt: string, producer: ProducerProvenance): string {
  return `dle.v1|${canonical({ version: "dle.v1", kind: "genesis", tenant: orgId, sequence: 0, continuityManifest: lcmDigest, recordedAt, producer })}`;
}
function decisionEnvelope(input: DecisionRecordAppendInput, sequence: number): string {
  return `dle.v1|${canonical({ version: "dle.v1", kind: "decision", tenant: input.orgId, sequence, decisionId: input.decisionId, replayManifest: input.manifest.identity, outcomeBytes: input.sources.outcome.bytes, recordedAt: input.recordedAt, producer: input.producer })}`;
}
const entryId = (envelopeBytes: string) => identityFor("dle.v1", envelopeBytes);
const chainHash = (envelopeBytes: string, previousHash: string) => identityFor("dlh.v1", `dlh.v1|${envelopeBytes}|${previousHash}`);
const GENESIS_PREV_HASH = "dlh.v1:GENESIS" as const;

export type { DecisionRecordAppendInput, DecisionRecordAppendResult, ExactSource, ProducerProvenance, RecordOrigin, ReplayManifest, ReplaySourceSet, SourceKind };
export {
  GENESIS_PREV_HASH,
  SHA,
  SOURCE_KINDS,
  buildReplayManifest,
  canonical,
  chainHash,
  decisionEnvelope,
  entryId,
  exactBytesIdentity,
  genesisEnvelope,
  hash,
  identityFor,
  parseReplayManifest,
  renderDecisionIdFromOutcomeBytes,
  validateAppendInput,
};
