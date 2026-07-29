import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import type { LedgerEntry } from "@contracts/decision-core/ledger";

export async function assertStatusEvidenceOrder(
  tx: SqlQueryable,
  orgId: string,
  events: readonly { readonly event: LedgerEntry }[],
): Promise<void> {
  const recordedInBatch = new Set<string>();
  const recordedBeforeBatch = new Map<string, boolean>();
  for (const { event } of events) {
    if (event.type === "EvidenceSnapshotRecorded") {
      recordedInBatch.add(event.evidenceSnapshotRef.id);
      continue;
    }
    if (event.type !== "StatusObserved" || !event.evidenceSnapshotRef) continue;
    const id = event.evidenceSnapshotRef.id;
    if (recordedInBatch.has(id)) continue;
    let exists = recordedBeforeBatch.get(id);
    if (exists === undefined) {
      const preceding = await tx.query<{ id: string }>(
        `SELECT id FROM decision_ledger
          WHERE org_id = $1 AND evidence_snapshot_id = $2
            AND event_type = 'EvidenceSnapshotRecorded'
          ORDER BY sequence DESC
          LIMIT 1`,
        [orgId, id],
      );
      exists = preceding.rows.length === 1;
      recordedBeforeBatch.set(id, exists);
    }
    if (!exists) {
      throw appError(
        "STORE_CONSTRAINT",
        "status evidence must have a preceding recording ledger fact",
      );
    }
  }
}
