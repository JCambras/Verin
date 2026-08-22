// The DecisionRecord seam (prompt 6, PR-6a-i): exact immutable recording. Product code receives no
// database capability. The one closed governed command owns the complete source, genesis, entry,
// anchor and projection transaction, entered only after dov.v1 minted a real DecisionCorrelation.
import type { ActionGrant } from "../access/context";
import { bundleDigest, serializeBundle, type EvidenceBundle } from "../evidence/bundle";
import type { PublishedPolicyVersion } from "../policy/registry";
import { annotateOperation, getGateway, type DecisionCorrelation } from "../runtime/governed";
import { outcomeDigest, serializeOutcome, serializeRequest, requestIdentity, type DecisionOutcome } from "../decision/outcome";
import engineArtifact from "../decision/engine-identity.json";
import {
  buildReplayManifest,
  exactBytesIdentity,
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
interface DecisionRecord {
  record(material: RecordMaterial): Promise<DecisionRecordAppendResult>;
}

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

function createDecisionRecord(c: DecisionCorrelation, grant: ActionGrant): DecisionRecord {
  if (grant.action !== "decision.record") throw new Error(`decisionRecord.record requires a 'decision.record' grant; '${grant.action}' does not authorize it`);
  const decisionId = `d${c.fields.decisionId.value}`;
  return {
    async record(material) {
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
  };
}

export type { DecisionRecord, RecordMaterial };
export { createDecisionRecord };
