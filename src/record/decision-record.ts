// The DecisionRecord seam (prompt 6, PR-6a): record, load and verify over exact immutable bytes.
// Product code receives no database capability. One closed governed command owns the complete append
// transaction; bounded list and head reads remain RequestCorrelation until outcome bytes reproduce a
// real dov.v1 identity, after which the sealed correlation changes to DecisionCorrelation.
import { z } from "zod";
import type { ActionGrant } from "../access/context";
import { bundleDigest, serializeBundle, type EvidenceBundle } from "../evidence/bundle";
import type { PublishedPolicyVersion } from "../policy/registry";
import { annotateOperation, decisionCorrelation, decisionIdFromOutcomeDigest, getGateway, type DecisionCorrelation, type RequestCorrelation, type RequestId } from "../runtime/governed";
import { outcomeDigest, serializeOutcome, serializeRequest, requestIdentity, type DecisionOutcome } from "../decision/outcome";
import engineArtifact from "../decision/engine-identity.json";
import {
  GENESIS_PREV_HASH,
  buildReplayManifest,
  canonical,
  chainHash,
  entryId,
  exactBytesIdentity,
  identityFor,
  parseReplayManifest,
  renderDecisionIdFromOutcomeBytes,
  type DecisionRecordAppendResult,
  type ProducerProvenance,
  type RecordOrigin,
  type ReplaySourceSet,
} from "./canonical";

type RecordMaterial = {
  readonly outcome: DecisionOutcome;
  readonly evidence: EvidenceBundle;
  readonly policy: PublishedPolicyVersion;
  readonly recordedAt: string;
  readonly producer: ProducerProvenance;
  readonly recordOrigin: RecordOrigin;
};
type DecisionRecordSummary = {
  readonly decisionId: string;
  readonly sequence: number;
  readonly replayManifestId: string;
  readonly requestRef: string;
  readonly householdSlug: string;
  readonly disposition: DecisionOutcome["disposition"];
  readonly recordedAt: string;
  readonly recordOrigin: string;
  readonly exactOutcomeBytes: string;
};
type RecordedDecision = DecisionRecordSummary & {
  readonly entryId: string;
  readonly previousHash: string;
  readonly chainHash: string;
  readonly envelopeBytes: string;
  readonly replayManifestBytes: string;
  readonly outcome: DecisionOutcome;
  readonly producer: ProducerProvenance;
};
type VerificationReason =
  | "not-found"
  | "empty-chain"
  | "truncated-read"
  | "authorization-missing"
  | "authorization-ambiguous"
  | "sequence-gap"
  | "genesis-invalid"
  | "envelope-rewritten"
  | "entry-identity-mismatch"
  | "source-missing"
  | "source-rewritten"
  | "source-substitution"
  | "link-mismatch"
  | "entry-hash-mismatch"
  | "tail-count-mismatch"
  | "tail-sequence-mismatch"
  | "tail-hash-mismatch"
  | "tail-decision-mismatch"
  | "time-order-invalid";
type ChainVerification =
  | { readonly status: "verified"; readonly throughDecisionId: string; readonly entryCount: number; readonly headHash: string; readonly threatBoundary: string }
  | { readonly status: "failed"; readonly reason: VerificationReason; readonly sequence: number | null; readonly detail: string };

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const summaryRow = z.strictObject({
  decision_id: z.string(),
  seq: z.number().int(),
  replay_manifest_id: z.string(),
  request_ref: z.string(),
  household_slug: z.string(),
  disposition: z.enum(["proceed", "blocked", "prohibited"]),
  recorded_at: z.date(),
  record_origin: z.string(),
  outcome_base64: z.string(),
});
const detailRow = summaryRow.omit({ outcome_base64: true }).extend({
  entry_id: z.string(),
  prev_hash: z.string(),
  entry_hash: z.string(),
  envelope_base64: z.string(),
  outcome_base64: z.string(),
  manifest_base64: z.string(),
  producer_kind: z.enum(["web", "tooling", "test"]),
  producer_id: z.string(),
  produced_at: z.date(),
});
const headRow = z.strictObject({ head_decision_id: z.string().nullable(), entry_count: z.number().int(), max_seq: z.number().int(), head_hash: z.string(), outcome_base64: z.string().nullable() });
const text = (base64: string) => Buffer.from(base64, "base64").toString("utf8");
const sequenceBucket = (n: number) => (n === 0 ? "genesis" : n <= 10 ? "1-10" : n <= 100 ? "11-100" : n <= 1000 ? "101-1000" : "over-1000");
const requireAction = (grant: ActionGrant, action: "decision.record" | "decision.read", operation: string) => {
  if (grant.action !== action) throw new Error(`${operation} requires a '${action}' grant; '${grant.action}' does not authorize it`);
};
const utf8 = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

function outcomeFromBytes(bytes: string): DecisionOutcome {
  if (!bytes.startsWith("dov.v1|")) throw new Error("recorded outcome bytes do not start with dov.v1");
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.slice("dov.v1|".length));
  } catch {
    throw new Error("recorded outcome bytes are not UTF-8 canonical JSON");
  }
  const minimum = z
    .object({
      version: z.literal("dov.v1"),
      disposition: z.enum(["proceed", "blocked", "prohibited"]),
      request: z.object({ requestRef: z.string(), householdSlug: z.string() }),
      citations: z.object({ asOf: z.string().regex(INSTANT) }),
    })
    .passthrough()
    .parse(raw);
  if (`dov.v1|${canonical(raw)}` !== bytes) throw new Error("recorded outcome bytes are not canonical");
  return minimum as unknown as DecisionOutcome;
}

function correlationFromExactOutcome(requestId: RequestId, declaredDecisionId: string, exactOutcomeBytes: string): DecisionCorrelation {
  if (!exactOutcomeBytes.startsWith("dov.v1|")) throw new Error("a stored DecisionCorrelation cannot resolve from bytes outside dov.v1");
  const digest = exactBytesIdentity("outcome", exactOutcomeBytes);
  const resolved = `d${digest.slice("dov.v1:".length)}`;
  if (resolved !== declaredDecisionId) throw new Error(`stored projection identity ${declaredDecisionId} differs from exact outcome identity ${resolved}; refusing the correlation transition`);
  return decisionCorrelation(requestId, decisionIdFromOutcomeDigest(digest));
}

function materialSources(material: RecordMaterial): ReplaySourceSet {
  const requestBytes = serializeRequest(material.outcome.request);
  const evidenceBytes = serializeBundle(material.evidence);
  const policyBytes = utf8(material.policy.bytes);
  const outcomeBytes = serializeOutcome(material.outcome);
  const sources: ReplaySourceSet = {
    request: { kind: "request", identity: requestIdentity(material.outcome.request), bytes: requestBytes },
    evidence: { kind: "evidence", identity: bundleDigest(material.evidence), bytes: evidenceBytes },
    policy: { kind: "policy", identity: `fpd.v1:${material.policy.id.digest}`, bytes: policyBytes },
    engine: { kind: "engine", identity: engineArtifact.engine, bytes: engineArtifact.bytes },
    outcome: { kind: "outcome", identity: outcomeDigest(material.outcome), bytes: outcomeBytes },
  };
  for (const source of Object.values(sources)) {
    const recomputed = exactBytesIdentity(source.kind, source.bytes);
    if (recomputed !== source.identity) throw new Error(`decisionRecord.record refuses ${source.kind}: declared identity ${source.identity} differs from exact bytes ${recomputed}`);
  }
  return sources;
}

async function listDecisionRecords(c: RequestCorrelation, grant: ActionGrant): Promise<DecisionRecordSummary[]> {
  requireAction(grant, "decision.read", "decisionRecord.list");
  return getGateway().enterDecisionRecordList(c, async () => {
    const rows = z.array(summaryRow).parse(await getGateway().enterDecisionRecordListForTenant(c, { orgId: grant.principal.tenant.orgId }));
    if (rows.length > 200) throw new Error("decisionRecord.list refuses a truncated result beyond its 200-record bound");
    annotateOperation({ recordResult: rows.length ? "found" : "empty", sequenceBucket: rows.length ? sequenceBucket(rows[0].seq) : "genesis" });
    return rows.map((row) => ({
      decisionId: row.decision_id,
      sequence: row.seq,
      replayManifestId: row.replay_manifest_id,
      requestRef: row.request_ref,
      householdSlug: row.household_slug,
      disposition: row.disposition,
      recordedAt: row.recorded_at.toISOString(),
      recordOrigin: row.record_origin,
      exactOutcomeBytes: text(row.outcome_base64),
    }));
  });
}

async function resolveDecisionHead(
  c: RequestCorrelation,
  grant: ActionGrant,
): Promise<{ summary: Pick<DecisionRecordSummary, "decisionId" | "exactOutcomeBytes">; entryCount: number; headHash: string } | null> {
  requireAction(grant, "decision.read", "decisionRecord.resolveHead");
  const raw = await getGateway().enterDecisionRecordResolveHead(c, { orgId: grant.principal.tenant.orgId });
  if (raw === null) return null;
  const head = headRow.parse(raw);
  if (head.head_decision_id === null || head.outcome_base64 === null) return null;
  return { summary: { decisionId: head.head_decision_id, exactOutcomeBytes: text(head.outcome_base64) }, entryCount: head.entry_count, headHash: head.head_hash };
}

const failed = (reason: VerificationReason, sequence: number | null, detail: string): ChainVerification => ({ status: "failed", reason, sequence, detail });
const verificationClass = (reason: VerificationReason) =>
  reason === "not-found"
    ? "not-found"
    : reason === "empty-chain"
      ? "empty-chain"
      : reason === "truncated-read"
        ? "truncated-read"
        : reason.startsWith("authorization") || reason === "genesis-invalid"
          ? "authorization"
          : reason === "sequence-gap"
            ? "sequence"
            : reason.includes("envelope") || reason.includes("identity")
              ? "envelope"
              : reason.startsWith("source")
                ? "source"
                : reason.includes("link") || (reason.includes("hash") && !reason.startsWith("tail"))
                  ? "link"
                  : reason.startsWith("tail")
                    ? "tail"
                    : "time";

function verifyChain(raw: unknown, throughDecisionId: string): ChainVerification {
  const shape = z
    .strictObject({
      entries: z.array(z.record(z.string(), z.unknown())),
      sources: z.array(z.record(z.string(), z.unknown())),
      anchor: z.record(z.string(), z.unknown()).nullable(),
      authorizations: z.array(z.record(z.string(), z.unknown())),
    })
    .parse(raw);
  if (shape.entries.length === 0) return failed("empty-chain", null, "the verifier saw no genesis or decision entry and never reports empty as verified");
  if (shape.entries.length > 1001 || shape.sources.length > 6001) return failed("truncated-read", null, "the verifier refuses a chain or source set beyond its bounded read");
  if (shape.authorizations.length === 0) return failed("authorization-missing", 0, "the genesis continuity digest has no authorization row");
  if (shape.authorizations.length !== 1) return failed("authorization-ambiguous", 0, "the tenant has more than one continuity authorization row");
  const auth = z
    .strictObject({
      lcm_digest: z.string(),
      manifest_base64: z.string(),
      signature_base64: z.string(),
      authorizing_actor: z.string(),
      authorized_at: z.string(),
      producer_kind: z.string(),
      producer_id: z.string(),
      produced_at: z.string(),
      record_origin: z.string(),
    })
    .parse(shape.authorizations[0]);
  if (!/^lcm\.v1:[0-9a-f]{64}$/.test(auth.lcm_digest) || text(auth.manifest_base64).length === 0 || text(auth.signature_base64).length === 0)
    return failed("genesis-invalid", 0, "the continuity authorization is not a complete lcm.v1 authorization record");
  const sourceRows = shape.sources.map((x) =>
    z
      .strictObject({
        source_kind: z.enum(["request", "evidence", "policy", "engine", "outcome", "replay-manifest"]),
        identity: z.string(),
        bytes_base64: z.string(),
        producer_kind: z.string(),
        producer_id: z.string(),
        produced_at: z.string(),
        record_origin: z.string(),
      })
      .parse(x),
  );
  const sources = new Map(sourceRows.map((s) => [`${s.source_kind}|${s.identity}`, { ...s, bytes: text(s.bytes_base64) }]));
  if (sources.size !== sourceRows.length) return failed("source-substitution", null, "two source rows resolve to the same typed identity");
  let previous: string = GENESIS_PREV_HASH;
  let lastDecision: string | null = null;
  let lastRecordedAt = 0;
  for (let i = 0; i < shape.entries.length; i++) {
    const row = z
      .strictObject({
        seq: z.number().int(),
        entry_id: z.string(),
        decision_id: z.string().nullable(),
        replay_manifest_id: z.string().nullable(),
        envelope_base64: z.string(),
        prev_hash: z.string(),
        entry_hash: z.string(),
        recorded_at: z.string(),
        producer_kind: z.string(),
        producer_id: z.string(),
        produced_at: z.string(),
        record_origin: z.string(),
      })
      .parse(shape.entries[i]);
    if (row.seq !== i) return failed("sequence-gap", row.seq, `expected sequence ${i}, found ${row.seq}`);
    const envelope = text(row.envelope_base64);
    if (!envelope.startsWith("dle.v1|")) return failed("envelope-rewritten", row.seq, "entry bytes do not start with dle.v1");
    let parsed: unknown;
    try {
      parsed = JSON.parse(envelope.slice("dle.v1|".length));
    } catch {
      return failed("envelope-rewritten", row.seq, "entry bytes are not canonical JSON");
    }
    if (`dle.v1|${canonical(parsed)}` !== envelope) return failed("envelope-rewritten", row.seq, "entry bytes are not canonical");
    if (entryId(envelope) !== row.entry_id) return failed("entry-identity-mismatch", row.seq, "dle.v1 identity does not reproduce from the envelope bytes");
    if (row.prev_hash !== previous) return failed("link-mismatch", row.seq, `previous hash does not cite sequence ${row.seq - 1}`);
    const recomputedHash = chainHash(envelope, row.prev_hash);
    if (recomputedHash !== row.entry_hash) return failed("entry-hash-mismatch", row.seq, "dlh.v1 does not reproduce from the envelope and previous hash");
    const recordedAt = new Date(row.recorded_at).getTime();
    if (!Number.isFinite(recordedAt) || recordedAt < lastRecordedAt || new Date(row.produced_at).getTime() > recordedAt)
      return failed("time-order-invalid", row.seq, "recorded and producer instants are not monotonic and causal");
    lastRecordedAt = recordedAt;
    if (row.seq === 0) {
      const genesis = z
        .strictObject({
          version: z.literal("dle.v1"),
          kind: z.literal("genesis"),
          tenant: z.string(),
          sequence: z.literal(0),
          continuityManifest: z.string(),
          recordedAt: z.string().regex(INSTANT),
          producer: z.record(z.string(), z.unknown()),
        })
        .parse(parsed);
      if (row.prev_hash !== GENESIS_PREV_HASH || row.decision_id !== null || row.replay_manifest_id !== null || genesis.continuityManifest !== auth.lcm_digest)
        return failed("genesis-invalid", 0, "genesis must cite only the authorized lcm.v1 digest and the new-chain sentinel");
    } else {
      if (row.decision_id === null || row.replay_manifest_id === null) return failed("envelope-rewritten", row.seq, "a decision entry omits its DecisionId or drm.v1 identity");
      const decision = z
        .strictObject({
          version: z.literal("dle.v1"),
          kind: z.literal("decision"),
          tenant: z.string(),
          sequence: z.number().int(),
          decisionId: z.string(),
          replayManifest: z.string(),
          outcomeBytes: z.string(),
          recordedAt: z.string().regex(INSTANT),
          producer: z.record(z.string(), z.unknown()),
        })
        .parse(parsed);
      if (decision.sequence !== row.seq || decision.decisionId !== row.decision_id || decision.replayManifest !== row.replay_manifest_id)
        return failed("envelope-rewritten", row.seq, "typed envelope fields differ from the indexed row");
      const manifestSource = sources.get(`replay-manifest|${row.replay_manifest_id}`);
      if (!manifestSource) return failed("source-missing", row.seq, "the exact drm.v1 source row is missing");
      if (exactBytesIdentity("outcome", decision.outcomeBytes) !== `dov.v1:${row.decision_id.slice(1)}`)
        return failed("source-substitution", row.seq, "the envelope outcome bytes do not reproduce its DecisionId");
      const outcomeSource = sources.get(`outcome|dov.v1:${row.decision_id.slice(1)}`);
      if (!outcomeSource) return failed("source-missing", row.seq, "the exact dov.v1 source row is missing");
      if (outcomeSource.bytes !== decision.outcomeBytes) return failed("source-substitution", row.seq, "the envelope and outcome source carry different bytes");
      let manifest;
      try {
        manifest = parseReplayManifest(manifestSource.bytes);
      } catch (error) {
        return failed("source-rewritten", row.seq, (error as Error).message);
      }
      if (exactBytesIdentity("outcome", outcomeSource.bytes) !== manifest.outcome) return failed("source-rewritten", row.seq, "the content-addressed outcome no longer reproduces");
      if (identityFor("drm.v1", manifestSource.bytes) !== row.replay_manifest_id) return failed("source-rewritten", row.seq, "the drm.v1 identity does not reproduce from exact bytes");
      for (const kind of ["request", "evidence", "policy", "engine", "outcome"] as const) {
        const identity = manifest[kind];
        const source = sources.get(`${kind}|${identity}`);
        if (!source) return failed("source-missing", row.seq, `manifest citation '${kind}' has no exact typed source row`);
        if (exactBytesIdentity(kind, source.bytes) !== identity) return failed("source-rewritten", row.seq, `source '${kind}' bytes do not reproduce ${identity}`);
        if (new Date(source.produced_at).getTime() > recordedAt) return failed("time-order-invalid", row.seq, `source '${kind}' was produced after the entry was recorded`);
      }
      if (Date.parse(manifest.decisionAsOf) > recordedAt) return failed("time-order-invalid", row.seq, "decision asOf is after its recorded instant");
      lastDecision = row.decision_id;
    }
    previous = row.entry_hash;
  }
  if (lastDecision === null || !shape.entries.some((x) => x["decision_id"] === throughDecisionId))
    return failed("not-found", null, "the requested real DecisionId is not in the verified tenant chain");
  if (shape.anchor === null) return failed("tail-count-mismatch", null, "the complete chain has no derived anchor");
  const anchor = z
    .strictObject({ entry_count: z.number().int(), max_seq: z.number().int(), head_hash: z.string(), head_decision_id: z.string().nullable(), updated_at: z.string() })
    .parse(shape.anchor);
  const last = shape.entries.length - 1;
  if (anchor.entry_count !== shape.entries.length) return failed("tail-count-mismatch", last, "anchor count differs from the complete ledger length");
  if (anchor.max_seq !== last) return failed("tail-sequence-mismatch", last, "anchor maximum sequence differs from the terminal ledger sequence");
  if (anchor.head_hash !== previous) return failed("tail-hash-mismatch", last, "anchor head hash differs from the terminal dlh.v1 hash");
  if (anchor.head_decision_id !== lastDecision) return failed("tail-decision-mismatch", last, "anchor DecisionId differs from the terminal decision entry");
  return {
    status: "verified",
    throughDecisionId,
    entryCount: shape.entries.length,
    headHash: previous,
    threatBoundary:
      "Tamper evidence covers application and database-owner mutation through append-only privileges, triggers, exact source identities, chain links and the derived anchor. A fully compromised database superuser could rewrite all rows and recompute the chain and anchor.",
  };
}

interface DecisionRecord {
  record(material: RecordMaterial): Promise<DecisionRecordAppendResult>;
  load(): Promise<RecordedDecision | null>;
  verify(): Promise<ChainVerification>;
}

function createDecisionRecord(c: DecisionCorrelation, grant: ActionGrant): DecisionRecord {
  const decisionId = `d${c.fields.decisionId.value}`;
  return {
    async record(material) {
      requireAction(grant, "decision.record", "decisionRecord.record");
      return getGateway().enterDecisionRecordRecord(c, async () => {
        const sources = materialSources(material);
        if (renderDecisionIdFromOutcomeBytes(sources.outcome.bytes) !== decisionId)
          throw new Error("decisionRecord.record refuses a grant/correlation whose DecisionId differs from the outcome bytes");
        const manifest = buildReplayManifest(sources, material.evidence.vocabulary, material.outcome.citations.asOf);
        const result = await getGateway().enterDecisionRecordAppend(c, {
          orgId: grant.principal.tenant.orgId,
          decisionId,
          sources,
          manifest,
          recordedAt: material.recordedAt,
          producer: material.producer,
          recordOrigin: material.recordOrigin,
          projection: { requestRef: material.outcome.request.requestRef, householdSlug: material.outcome.request.householdSlug, disposition: material.outcome.disposition },
        });
        annotateOperation({ recordResult: result.alreadyRecorded ? "already-recorded" : "recorded", sequenceBucket: sequenceBucket(result.sequence) });
        return result;
      });
    },
    async load() {
      requireAction(grant, "decision.read", "decisionRecord.load");
      return getGateway().enterDecisionRecordLoad(c, async () => {
        const raw = await getGateway().enterDecisionRecordLoadById(c, { orgId: grant.principal.tenant.orgId, decisionId });
        if (raw === null) {
          annotateOperation({ recordResult: "empty" });
          return null;
        }
        const row = detailRow.parse(raw);
        const outcomeBytes = text(row.outcome_base64);
        if (renderDecisionIdFromOutcomeBytes(outcomeBytes) !== row.decision_id) throw new Error("decisionRecord.load refuses outcome bytes that no longer reproduce the indexed DecisionId");
        const manifestBytes = text(row.manifest_base64);
        if (exactBytesIdentity("outcome", outcomeBytes) !== `dov.v1:${row.decision_id.slice(1)}` || !manifestBytes.startsWith("drm.v1|"))
          throw new Error("decisionRecord.load refuses content-addressed bytes that no longer reproduce");
        annotateOperation({ recordResult: "found", sequenceBucket: sequenceBucket(row.seq) });
        return {
          decisionId: row.decision_id,
          sequence: row.seq,
          replayManifestId: row.replay_manifest_id,
          requestRef: row.request_ref,
          householdSlug: row.household_slug,
          disposition: row.disposition,
          recordedAt: row.recorded_at.toISOString(),
          recordOrigin: row.record_origin,
          exactOutcomeBytes: outcomeBytes,
          entryId: row.entry_id,
          previousHash: row.prev_hash,
          chainHash: row.entry_hash,
          envelopeBytes: text(row.envelope_base64),
          replayManifestBytes: manifestBytes,
          outcome: outcomeFromBytes(outcomeBytes),
          producer: { kind: row.producer_kind, id: row.producer_id, producedAt: row.produced_at.toISOString() },
        };
      });
    },
    async verify() {
      requireAction(grant, "decision.read", "decisionRecord.verify");
      return getGateway().enterDecisionRecordVerify(c, async () => {
        const result = verifyChain(await getGateway().enterDecisionRecordReadChain(c, { orgId: grant.principal.tenant.orgId }), decisionId);
        annotateOperation({
          verificationResult: result.status === "verified" ? "verified" : verificationClass(result.reason),
          recordResult: result.status === "verified" ? "found" : result.reason === "not-found" ? "empty" : "refused",
        });
        return result;
      });
    },
  };
}

export type { ChainVerification, DecisionRecord, DecisionRecordSummary, RecordMaterial, RecordedDecision, VerificationReason };
export { correlationFromExactOutcome, createDecisionRecord, listDecisionRecords, resolveDecisionHead, verifyChain };
