import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import type { LedgerEntry } from "@contracts/decision-core/ledger";

interface DecisionHashes {
  decision_hash: string;
  bundle_hash: string;
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
  const ref = "decisionRef" in event
    ? event.decisionRef
    : "priorDecisionRef" in event
      ? event.priorDecisionRef
      : undefined;
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
