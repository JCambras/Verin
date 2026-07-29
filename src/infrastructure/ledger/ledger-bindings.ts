import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { DecisionInputBundle } from "@contracts/decision-core/evidence";
import type { VersionedSourceRef } from "@contracts/decision-core/explanation";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { promotedDecisionRef } from "@contracts/decision-core/ledger-references";

interface DecisionHashes {
  decision_hash: string;
  bundle_hash: string;
}

const referenceKey = (ref: { firmId: string; id: string }): string =>
  JSON.stringify([ref.firmId, ref.id]);

export function decisionReplayPinsMatchBundle(
  record: DecisionRecord,
  bundle: DecisionInputBundle,
): boolean {
  if (
    record.firmId !== bundle.firmId ||
    referenceKey(record.inputBundleRef) !== referenceKey({
      firmId: bundle.firmId,
      id: bundle.id,
    })
  ) {
    return false;
  }
  const evidence = new Set(bundle.evidenceSnapshotRefs.map(referenceKey));
  const instructions = new Set(
    bundle.householdInstructionVersionRefs.map(referenceKey),
  );
  const regulations = new Set(
    bundle.regulatoryVersionRefs.map(referenceKey),
  );
  const policy = referenceKey(bundle.policyVersionRef);
  const matchesSource = (source: VersionedSourceRef): boolean =>
    source.sourceType === "regulatory"
      ? regulations.has(referenceKey(source.versionRef))
      : source.sourceType === "firm_policy"
      ? referenceKey(source.versionRef) === policy
      : instructions.has(referenceKey(source.versionRef));
  const explanation = [...record.explanationTrace];
  while (explanation.length > 0) {
    const node = explanation.pop()!;
    if (
      node.evidenceSnapshotRefs.some((ref) => !evidence.has(referenceKey(ref))) ||
      node.sourceRefs.some((source) => !matchesSource(source))
    ) {
      return false;
    }
    explanation.push(...node.childNodes);
  }
  if (record.precedenceTrace.some((step) =>
    !matchesSource(step.left) || !matchesSource(step.right))) {
    return false;
  }
  if (
    record.result.kind === "prohibited" &&
    !matchesSource(record.result.prohibition.source)
  ) {
    return false;
  }
  if (record.result.kind === "proceed") {
    for (const step of record.result.executionPlan.steps) {
      for (const action of [step, step.compensatingAction]) {
        if (
          action?.preconditions.some((precondition) =>
            precondition.requiredEvidenceSnapshotRefs.some(
              (ref) => !evidence.has(referenceKey(ref)),
            ))
        ) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * Bind event hash claims to immutable source rows. This is storage consistency,
 * not decision evaluation: the event may describe any allowed outcome, but it
 * cannot name bytes other than the decision and bundle it references.
 */
export async function assertLedgerSourceBindings(
  tx: SqlQueryable,
  event: LedgerEntry,
): Promise<void> {
  if (event.type === "EvidenceSnapshotRecorded") {
    const snapshot = await tx.query<{
      content_hash: string;
      snapshot_hash: string;
    }>(
      `SELECT content_hash, snapshot_hash
         FROM evidence_snapshots
        WHERE org_id = $1 AND id = $2`,
      [event.firmId, event.evidenceSnapshotRef.id],
    );
    if (
      snapshot.rows[0]?.content_hash !== event.contentHash ||
      snapshot.rows[0]?.snapshot_hash !== event.snapshotHash
    ) {
      throw appError("STORE_CONSTRAINT", "ledger evidence hash does not match immutable snapshot");
    }
    return;
  }
  if (event.type === "StatusObserved" && event.evidenceSnapshotRef) {
    const cited = await tx.query<{ id: string }>(
      "SELECT id FROM evidence_snapshots WHERE org_id = $1 AND id = $2",
      [event.firmId, event.evidenceSnapshotRef.id],
    );
    if (!cited.rows[0]) {
      throw appError("STORE_CONSTRAINT", "cited evidence snapshot is not stored");
    }
  }
  const ref = promotedDecisionRef(event);
  if (!ref) return;
  const hashes = await tx.query<DecisionHashes>(
    `SELECT r.decision_hash, b.bundle_hash
       FROM decision_records r
       JOIN decision_input_bundles b
         ON b.org_id = r.org_id AND b.id = r.input_bundle_id
      WHERE r.org_id = $1 AND r.id = $2`,
    [event.firmId, ref.id],
  );
  const stored = hashes.rows[0];
  if (!stored) {
    throw appError("STORE_CONSTRAINT", "ledger decision reference has no immutable record");
  }
  const claimedDecisionHash =
    event.type === "DecisionRecorded" || event.type === "ApprovalRecorded"
      ? event.decisionHash
      : "priorDecisionHash" in event
        ? event.priorDecisionHash
        : undefined;
  if (
    claimedDecisionHash !== undefined &&
    claimedDecisionHash !== stored.decision_hash
  ) {
    throw appError("STORE_CONSTRAINT", "ledger event decision hash does not match immutable record");
  }
  if (
    (event.type === "ApprovalRecorded" &&
      event.inputBundleHash !== stored.bundle_hash) ||
    (event.type === "DecisionRecorded" &&
      event.bundleHash !== stored.bundle_hash)
  ) {
    throw appError("STORE_CONSTRAINT", "ledger input bundle hash does not match immutable bundle");
  }
}
