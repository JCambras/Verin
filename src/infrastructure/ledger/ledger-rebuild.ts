import type { SqlDb } from "@infra/store/db";
import { appError } from "@contracts/errors";
import { parseRecordProvenance, type RecordProvenance } from "@contracts/provenance";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { listDecisionLedger } from "./ledger-verification";
import {
  loadVerifiedReplayDecision,
  verifyReplayEvidence,
} from "./ledger-sources";
import {
  applyProjection,
  clearDerivedState,
  listDecisionProjections,
  type ProjectedDecision,
} from "./ledger-projection-store";
import { parseRecordedLedgerEvent } from "./ledger-schema-registry";

export async function rebuildDecisionProjections(
  db: SqlDb,
  orgId: string,
): Promise<ProjectedDecision[]> {
  await db.transaction(async (tx) => {
    const tenant = await tx.query<{ id: string }>(
      "SELECT id FROM orgs WHERE id = $1 FOR UPDATE",
      [orgId],
    );
    if (tenant.rows.length !== 1) {
      throw appError("NOT_FOUND", "decision ledger tenant does not exist");
    }
    const rows = await listDecisionLedger(tx, orgId);
    const verifiedEvidence = new Set<string>();
    const replay: Array<{
      row: (typeof rows)[number];
      event: LedgerEntry;
      provenance: RecordProvenance;
      record?: DecisionRecord;
    }> = [];
    for (const row of rows) {
      let value: unknown;
      try {
        value = JSON.parse(row.payloadJson);
      } catch {
        throw appError("STORE_CONSTRAINT", "ledger replay payload is not JSON");
      }
      const parsed = parseRecordedLedgerEvent(
        row.eventType,
        row.schemaVersion,
        row.serializerVersion,
        value,
      );
      if (!parsed.ok) throw appError("STORE_CONSTRAINT", parsed.reason);
      const provenance = parseRecordProvenance({
        source: row.provSource,
        asOf: row.provAsOf,
        confidence: row.provConfidence,
      });
      if (!provenance) {
        throw appError("STORE_CONSTRAINT", "ledger replay provenance is invalid");
      }
      let record: DecisionRecord | undefined;
      if (parsed.event.type === "EvidenceSnapshotRecorded") {
        verifiedEvidence.add(await verifyReplayEvidence(tx, parsed.event));
      } else if (parsed.event.type === "DecisionRecorded") {
        record = await loadVerifiedReplayDecision(
          tx,
          parsed.event,
          verifiedEvidence,
        );
      }
      replay.push({
        row,
        event: parsed.event,
        provenance,
        ...(record ? { record } : {}),
      });
    }
    await clearDerivedState(tx, orgId);
    for (const item of replay) {
      await applyProjection(
        tx,
        item.event,
        item.row.sequence,
        item.provenance,
        item.record,
      );
    }
    const head = rows.at(-1);
    if (head) {
      await tx.query(
        `INSERT INTO decision_projection_checkpoint (org_id,last_sequence,rebuilt_at)
         VALUES ($1,$2,$3)`,
        [orgId, head.sequence, new Date().toISOString()],
      );
    }
  });
  return listDecisionProjections(db, orgId);
}
