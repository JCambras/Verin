// The DecisionRecord seam (prompt 6, PR-6a-i): exact immutable recording. Product code receives no
// database capability. The one closed governed command owns the complete source, genesis, entry,
// anchor and projection transaction, entered only after dov.v1 minted a real DecisionCorrelation.
import type { ActionGrant } from "../access/context";
import { bundleDigest, serializeBundle, type EvidenceBundle } from "../evidence/bundle";
import type { PublishedPolicyVersion } from "../policy/registry";
import { annotateOperation, getGateway, type DecisionCorrelation, type RequestCorrelation } from "../runtime/governed";
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
  parseLedgerEnvelope,
  parseReplayManifest,
  projectionFromOutcomeBytes,
  renderDecisionIdFromOutcomeBytes,
  type DecisionRecordAppendResult,
  type ProjectionValue,
  type ProducerProvenance,
  type RecordOrigin,
  type ReplaySourceSet,
  type SourceKind,
} from "./canonical";
import { z } from "zod";

type RecordMaterial = {
  readonly outcome: DecisionOutcome;
  readonly evidence: EvidenceBundle;
  readonly policy: PublishedPolicyVersion;
  readonly recordedAt: string;
  readonly producer: ProducerProvenance;
  readonly recordOrigin: RecordOrigin;
};
interface DecisionRecord {
  record(material: RecordMaterial): Promise<DecisionRecordAppendResult>;
  load(): Promise<RecordedDecision | null>;
  verify(): Promise<ChainVerification>;
}

type RecordSummary = ProjectionValue & { readonly outcomeBytes: string };
// prettier-ignore
type VerificationFailure = { readonly ok: false; readonly failure: "empty-chain" | "anchor-present-ledger-empty" | "ledger-without-anchor" | "genesis-missing" | "sequence-gap" | "payload-rewritten" | "broken-link" | "entry-hash-mismatch" | "source-missing" | "source-identity-mismatch" | "source-substitution" | "anchor-count-mismatch" | "anchor-max-sequence-mismatch" | "anchor-head-mismatch" | "terminal-not-found" | "projection-mismatch"; readonly sequence: number | null; readonly identityClass?: SourceKind; readonly identity?: string };
// prettier-ignore
type ChainVerification = VerificationFailure | { readonly ok: true; readonly through: string; readonly entryCount: number; readonly headHash: string; readonly continuityManifest: string; readonly rebuiltProjection: readonly ProjectionValue[] };
// prettier-ignore
type RecordedDecision = { readonly summary: ProjectionValue; readonly entryId: string; readonly chainHash: string; readonly identities: { readonly request: string; readonly evidence: string; readonly policy: string; readonly engine: string; readonly outcome: string; readonly replayManifest: string }; readonly outcome: { readonly disposition: "proceed" | "blocked" | "prohibited"; readonly authorityMode: string; readonly authorityStages: readonly string[]; readonly blockers: readonly string[]; readonly prohibition: string | null; readonly policyBasis: Readonly<Record<string, string | number | boolean>> }; readonly evidence: { readonly source: string; readonly asOf: string }; readonly producer: ProducerProvenance; readonly verification: Extract<ChainVerification, { ok: true }> };
type HeadResolution = { readonly kind: "head"; readonly decisionId: string; readonly outcomeIdentity: string } | { readonly kind: "refused"; readonly failure: VerificationFailure["failure"] };

const utf8 = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const sequenceBucket = (n: number) => (n <= 10 ? "1-10" : n <= 100 ? "11-100" : n <= 1000 ? "101-1000" : "over-1000");

function materialSources(material: RecordMaterial): ReplaySourceSet {
  const sources: ReplaySourceSet = {
    request: { kind: "request", identity: requestIdentity(material.outcome.request), bytes: serializeRequest(material.outcome.request) },
    evidence: { kind: "evidence", identity: bundleDigest(material.evidence), bytes: serializeBundle(material.evidence) },
    policy: { kind: "policy", identity: `fpd.v1:${material.policy.id.digest}`, bytes: utf8(material.policy.bytes) },
    engine: { kind: "engine", identity: engineArtifact.engine, bytes: engineArtifact.bytes },
    outcome: { kind: "outcome", identity: outcomeDigest(material.outcome), bytes: serializeOutcome(material.outcome) },
  };
  for (const source of Object.values(sources)) {
    const recomputed = exactBytesIdentity(source.kind, source.bytes);
    if (recomputed !== source.identity) throw new Error(`decisionRecord.record refuses ${source.kind}: declared identity ${source.identity} differs from exact bytes ${recomputed}`);
  }
  if (
    material.outcome.citations.request !== sources.request.identity ||
    material.outcome.citations.evidenceBundle !== sources.evidence.identity ||
    material.outcome.citations.policy !== sources.policy.identity
  )
    throw new Error("decisionRecord.record refuses source substitution: exact request, evidence or policy bytes differ from the outcome citations");
  return sources;
}

const ORIGIN = z.enum(["operator-entry", "demo-seed", "test-fixture"]);
// prettier-ignore
const sourceRow = z.strictObject({ kind: z.enum(["request", "evidence", "policy", "engine", "outcome", "replay-manifest"]), identity: z.string(), bytes: z.string(), producerKind: z.enum(["web", "tooling", "test"]), producerId: z.string(), producedAt: z.string(), recordOrigin: ORIGIN });
// prettier-ignore
const entryRow = z.strictObject({ seq: z.number().int(), entryId: z.string(), decisionId: z.string().nullable(), replayManifestId: z.string().nullable(), envelopeBytes: z.string(), prevHash: z.string(), entryHash: z.string(), recordedAt: z.string(), producerKind: z.enum(["web", "tooling", "test"]), producerId: z.string(), producedAt: z.string(), recordOrigin: ORIGIN });
// prettier-ignore
const projectionRow = z.strictObject({ decisionId: z.string(), sequence: z.number().int(), replayManifestId: z.string(), requestRef: z.string(), householdSlug: z.string(), disposition: z.enum(["proceed", "blocked", "prohibited"]), recordedAt: z.string(), recordOrigin: ORIGIN });
// prettier-ignore
const chainSnapshot = z.strictObject({ entry_count: z.number().int().nullable(), max_seq: z.number().int().nullable(), head_hash: z.string().nullable(), head_decision_id: z.string().nullable(), updated_at: z.string().nullable(), entries: z.array(entryRow), sources: z.array(sourceRow), projections: z.array(projectionRow) });
const decode = (bytes: string) => Buffer.from(bytes, "base64").toString("utf8");
const failure = (name: VerificationFailure["failure"], sequence: number | null, extra: Pick<VerificationFailure, "identityClass" | "identity"> = {}): VerificationFailure => ({
  ok: false,
  failure: name,
  sequence,
  ...extra,
});

function viewFromOutcome(bytes: string) {
  const parsed = z
    .object({
      disposition: z.enum(["proceed", "blocked", "prohibited"]),
      authority: z.object({ mode: z.string(), stages: z.array(z.object({ stageId: z.string() }).passthrough()).optional() }).passthrough(),
      blockers: z.array(z.object({ code: z.string() }).passthrough()).optional(),
      prohibition: z.object({ reasonCode: z.string() }).passthrough().optional(),
      policyBasis: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    })
    .passthrough()
    .parse(JSON.parse(bytes.slice("dov.v1|".length)));
  return {
    disposition: parsed.disposition,
    authorityMode: parsed.authority.mode,
    authorityStages: (parsed.authority.stages ?? []).map((x) => x.stageId),
    blockers: (parsed.blockers ?? []).map((x) => x.code),
    prohibition: parsed.prohibition?.reasonCode ?? null,
    policyBasis: parsed.policyBasis,
  };
}

async function listDecisionRecords(c: RequestCorrelation, grant: ActionGrant): Promise<RecordSummary[]> {
  if (grant.action !== "decision.read") throw new Error(`decisionRecord.list requires a 'decision.read' grant; '${grant.action}' does not authorize it`);
  return getGateway().enterDecisionRecordList(c, async () => {
    const rows = z
      .array(
        z.strictObject({
          decision_id: z.string(),
          seq: z.number().int(),
          replay_manifest_id: z.string(),
          request_ref: z.string(),
          household_slug: z.string(),
          disposition: z.enum(["proceed", "blocked", "prohibited"]),
          recorded_at: z.string(),
          record_origin: ORIGIN,
          outcome_bytes: z.instanceof(Uint8Array),
        }),
      )
      .parse(await getGateway().enterDecisionRecordListForTenant(c, { orgId: grant.principal.tenant.orgId, statementTimeoutMs: "2000" }));
    return rows.map((x) => {
      const outcomeBytes = utf8(x.outcome_bytes);
      if (renderDecisionIdFromOutcomeBytes(outcomeBytes) !== x.decision_id) throw new Error(`decisionRecord.list refuses payload-rewritten at sequence ${x.seq}`);
      return {
        decisionId: x.decision_id,
        sequence: x.seq,
        replayManifestId: x.replay_manifest_id,
        requestRef: x.request_ref,
        householdSlug: x.household_slug,
        disposition: x.disposition,
        recordedAt: x.recorded_at,
        recordOrigin: x.record_origin,
        outcomeBytes,
      };
    });
  });
}

async function resolveDecisionRecordHead(c: RequestCorrelation, grant: ActionGrant): Promise<HeadResolution> {
  if (grant.action !== "decision.read") throw new Error(`decisionRecord.resolveHead requires a 'decision.read' grant; '${grant.action}' does not authorize it`);
  const raw = await getGateway().enterDecisionRecordResolveHead(c, { orgId: grant.principal.tenant.orgId, statementTimeoutMs: "2000" });
  if (raw === null) return { kind: "refused", failure: "empty-chain" };
  const head = z
    .strictObject({
      entry_count: z.number().int(),
      max_seq: z.number().int(),
      head_hash: z.string(),
      head_decision_id: z.string().nullable(),
      ledger_count: z.number().int(),
      envelope_bytes: z.instanceof(Uint8Array).nullable(),
      outcome_identity: z.string().nullable(),
      outcome_bytes: z.instanceof(Uint8Array).nullable(),
    })
    .parse(raw);
  if (!head.envelope_bytes) return { kind: "refused", failure: head.ledger_count === 0 ? "anchor-present-ledger-empty" : "anchor-max-sequence-mismatch" };
  if (!head.head_decision_id || !head.outcome_identity || !head.outcome_bytes) return { kind: "refused", failure: "source-missing" };
  const outcomeBytes = utf8(head.outcome_bytes);
  const outcomeIdentity = exactBytesIdentity("outcome", outcomeBytes);
  if (outcomeIdentity !== head.outcome_identity || renderDecisionIdFromOutcomeBytes(outcomeBytes) !== head.head_decision_id) return { kind: "refused", failure: "source-identity-mismatch" };
  return { kind: "head", decisionId: head.head_decision_id, outcomeIdentity };
}

type VerifiedParts = {
  readonly entry: z.infer<typeof entryRow>;
  readonly projection: ProjectionValue;
  readonly manifest: ReturnType<typeof parseReplayManifest>;
  readonly sources: Readonly<Record<Exclude<SourceKind, "replay-manifest">, z.infer<typeof sourceRow>>>;
};

async function verifyStoredChain(c: DecisionCorrelation, grant: ActionGrant): Promise<{ verification: ChainVerification; records: Map<string, VerifiedParts> }> {
  if (grant.action !== "decision.read") throw new Error(`decisionRecord.verify requires a 'decision.read' grant; '${grant.action}' does not authorize it`);
  return getGateway().enterDecisionRecordVerify(c, async () => {
    const state = chainSnapshot.parse(await getGateway().enterDecisionRecordReadChain(c, { orgId: grant.principal.tenant.orgId, statementTimeoutMs: "4000" }));
    const records = new Map<string, VerifiedParts>();
    const refuse = (f: VerificationFailure) => {
      annotateOperation({ verificationResult: "refused" });
      return { verification: f, records };
    };
    const anchorPresent = state.entry_count !== null || state.max_seq !== null || state.head_hash !== null;
    if (!anchorPresent) return refuse(state.entries.length ? failure("ledger-without-anchor", 0) : failure("empty-chain", null));
    if (!state.entries.length) return refuse(failure("anchor-present-ledger-empty", 0));
    if (state.entry_count === null || state.max_seq === null || state.head_hash === null) return refuse(failure("anchor-present-ledger-empty", 0));
    const sourceMap = new Map(state.sources.map((source) => [`${source.kind}|${source.identity}`, source]));
    const projectionMap = new Map(state.projections.map((projection) => [projection.decisionId, projection]));
    const rebuilt: ProjectionValue[] = [];
    let continuityManifest = "";
    for (let expected = 0; expected < state.entries.length; expected++) {
      const entry = state.entries[expected];
      if (entry.seq !== expected) return refuse(failure("sequence-gap", expected));
      const envelopeBytes = decode(entry.envelopeBytes);
      let envelope;
      try {
        envelope = parseLedgerEnvelope(envelopeBytes);
      } catch {
        return refuse(failure("payload-rewritten", entry.seq));
      }
      if (envelope.sequence !== entry.seq || envelope.tenant !== grant.principal.tenant.orgId) return refuse(failure("payload-rewritten", entry.seq));
      if (entry.entryId !== entryId(envelopeBytes)) return refuse(failure("payload-rewritten", entry.seq));
      const expectedPrevious = expected === 0 ? GENESIS_PREV_HASH : state.entries[expected - 1].entryHash;
      if (entry.prevHash !== expectedPrevious) return refuse(failure("broken-link", entry.seq));
      if (entry.entryHash !== chainHash(envelopeBytes, expectedPrevious)) return refuse(failure("entry-hash-mismatch", entry.seq));
      if (entry.recordedAt !== envelope.recordedAt || entry.producerKind !== envelope.producer.kind || entry.producerId !== envelope.producer.id || entry.producedAt !== envelope.producer.producedAt)
        return refuse(failure("payload-rewritten", entry.seq));
      if (expected === 0) {
        if (envelope.kind !== "genesis" || entry.decisionId !== null || entry.replayManifestId !== null) return refuse(failure("genesis-missing", 0));
        continuityManifest = envelope.continuityManifest;
        continue;
      }
      if (envelope.kind !== "decision" || entry.decisionId !== envelope.decisionId || entry.replayManifestId !== envelope.replayManifest) return refuse(failure("payload-rewritten", entry.seq));
      const manifestSource = sourceMap.get(`replay-manifest|${envelope.replayManifest}`);
      if (!manifestSource) return refuse(failure("source-missing", entry.seq, { identityClass: "replay-manifest", identity: envelope.replayManifest }));
      const manifestBytes = decode(manifestSource.bytes);
      if (identityFor("drm.v1", manifestBytes) !== manifestSource.identity)
        return refuse(failure("source-identity-mismatch", entry.seq, { identityClass: "replay-manifest", identity: manifestSource.identity }));
      let manifest;
      try {
        manifest = parseReplayManifest(manifestBytes);
      } catch {
        return refuse(failure("source-identity-mismatch", entry.seq, { identityClass: "replay-manifest", identity: manifestSource.identity }));
      }
      const sources = {} as Record<Exclude<SourceKind, "replay-manifest">, z.infer<typeof sourceRow>>;
      for (const kind of ["request", "evidence", "policy", "engine", "outcome"] as const) {
        const identity = manifest[kind];
        const source = sourceMap.get(`${kind}|${identity}`);
        if (!source) return refuse(failure("source-missing", entry.seq, { identityClass: kind, identity }));
        if (exactBytesIdentity(kind, decode(source.bytes)) !== identity) return refuse(failure("source-identity-mismatch", entry.seq, { identityClass: kind, identity }));
        sources[kind] = source;
      }
      const outcomeBytes = decode(sources.outcome.bytes);
      if (outcomeBytes !== envelope.outcomeBytes || renderDecisionIdFromOutcomeBytes(outcomeBytes) !== envelope.decisionId)
        return refuse(failure("source-substitution", entry.seq, { identityClass: "outcome", identity: sources.outcome.identity }));
      const expectedProjection = projectionFromOutcomeBytes(envelope.decisionId, entry.seq, envelope.replayManifest, outcomeBytes, envelope.recordedAt, entry.recordOrigin);
      const liveProjection = projectionMap.get(envelope.decisionId);
      if (!liveProjection || canonical(liveProjection) !== canonical(expectedProjection)) return refuse(failure("projection-mismatch", entry.seq));
      rebuilt.push(expectedProjection);
      records.set(envelope.decisionId, { entry, projection: expectedProjection, manifest, sources });
    }
    const last = state.entries.at(-1)!;
    if (state.entry_count !== state.entries.length) return refuse(failure("anchor-count-mismatch", state.entries.length));
    if (state.max_seq !== last.seq) return refuse(failure("anchor-max-sequence-mismatch", last.seq));
    if (state.head_hash !== last.entryHash || state.head_decision_id !== last.decisionId) return refuse(failure("anchor-head-mismatch", last.seq));
    const through = `d${c.fields.decisionId.value}`;
    if (!records.has(through)) return refuse(failure("terminal-not-found", null));
    if (rebuilt.length !== state.projections.length) return refuse(failure("projection-mismatch", null));
    const verification = { ok: true, through, entryCount: state.entries.length, headHash: state.head_hash, continuityManifest, rebuiltProjection: rebuilt } as const;
    annotateOperation({ verificationResult: "verified" });
    return { verification, records };
  });
}

function createDecisionRecord(c: DecisionCorrelation, grant: ActionGrant): DecisionRecord {
  const decisionId = `d${c.fields.decisionId.value}`;
  return {
    async record(material) {
      if (grant.action !== "decision.record") throw new Error(`decisionRecord.record requires a 'decision.record' grant; '${grant.action}' does not authorize it`);
      return getGateway().enterDecisionRecordRecord(c, async () => {
        const sources = materialSources(material);
        if (renderDecisionIdFromOutcomeBytes(sources.outcome.bytes) !== decisionId)
          throw new Error("decisionRecord.record refuses a correlation whose DecisionId differs from the exact outcome bytes");
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
      if (grant.action !== "decision.read") throw new Error(`decisionRecord.load requires a 'decision.read' grant; '${grant.action}' does not authorize it`);
      return getGateway().enterDecisionRecordLoad(c, async () => {
        const selected = await getGateway().enterDecisionRecordLoadById(c, { orgId: grant.principal.tenant.orgId, decisionId, statementTimeoutMs: "2000" });
        if (selected === null) return null;
        projectionRow.parse({
          decisionId: (selected as Record<string, unknown>)["decision_id"],
          sequence: (selected as Record<string, unknown>)["seq"],
          replayManifestId: (selected as Record<string, unknown>)["replay_manifest_id"],
          requestRef: (selected as Record<string, unknown>)["request_ref"],
          householdSlug: (selected as Record<string, unknown>)["household_slug"],
          disposition: (selected as Record<string, unknown>)["disposition"],
          recordedAt: (selected as Record<string, unknown>)["recorded_at"],
          recordOrigin: (selected as Record<string, unknown>)["record_origin"],
        });
        const checked = await verifyStoredChain(c, grant);
        if (!checked.verification.ok)
          throw new Error(
            `decisionRecord.load refuses unverified chain: ${checked.verification.failure}${checked.verification.sequence === null ? "" : ` at sequence ${checked.verification.sequence}`}`,
          );
        const parts = checked.records.get(decisionId);
        if (!parts) return null;
        const outcomeBytes = decode(parts.sources.outcome.bytes);
        const evidenceBytes = decode(parts.sources.evidence.bytes);
        const evidence = z
          .object({ source: z.string(), asOf: z.string() })
          .passthrough()
          .parse(JSON.parse(evidenceBytes.slice("evb.v1|".length)));
        return {
          summary: parts.projection,
          entryId: parts.entry.entryId,
          chainHash: parts.entry.entryHash,
          identities: { ...parts.manifest, replayManifest: parts.entry.replayManifestId! },
          outcome: viewFromOutcome(outcomeBytes),
          evidence,
          producer: { kind: parts.entry.producerKind, id: parts.entry.producerId, producedAt: parts.entry.producedAt },
          verification: checked.verification,
        };
      });
    },
    async verify() {
      return (await verifyStoredChain(c, grant)).verification;
    },
  };
}

export type { ChainVerification, DecisionRecord, HeadResolution, RecordedDecision, RecordMaterial, RecordSummary };
export { createDecisionRecord, listDecisionRecords, resolveDecisionRecordHead };
