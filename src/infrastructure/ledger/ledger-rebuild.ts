import type { SqlDb } from "@infra/store/db";
import { appError } from "@contracts/errors";
import type { RecordProvenance } from "@contracts/provenance";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { verifyDecisionLedgerTransaction } from "./ledger-verification";
import { lockDecisionLedgerTenant } from "./ledger-lock";
import { verifyReplaySources } from "./ledger-sources";
import {
  applyProjection,
  clearDerivedState,
  listDecisionProjections,
  type ProjectedDecision,
} from "./ledger-projection-store";
import {
  parseRecordedLedgerEvent,
  parseRecordedLedgerProvenance,
} from "./ledger-schema-registry";
import { deriveLedgerEventProvenance } from "./ledger-source-provenance";

export async function rebuildDecisionProjections(
  db: SqlDb,
  orgId: string,
): Promise<ProjectedDecision[]> {
  await db.transaction(async (tx) => {
    // A rebuild REPLACES derived state, so it takes the exclusive tenant lock before
    // the compatible verification lock: no append may land between the snapshot it
    // verifies and the fold it writes.
    await lockDecisionLedgerTenant(tx, orgId, "append");
    const checked = await verifyDecisionLedgerTransaction(tx, orgId);
    if (!checked.verification.ok) {
      throw appError(
        "STORE_CONSTRAINT",
        `decision ledger integrity failed at ${checked.verification.levels.at(-1)?.level ?? "unknown"}`,
      );
    }
    const rows = checked.rows;
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
      const provenance = parseRecordedLedgerProvenance(
        row.schemaVersion,
        row.serializerVersion,
        {
          source: row.provSource,
          asOf: row.provAsOf,
          confidence: row.provConfidence,
        },
      );
      if (!provenance) {
        throw appError("STORE_CONSTRAINT", "ledger replay provenance is invalid");
      }
      replay.push({
        row,
        event: parsed.event,
        provenance,
      });
    }
    const sources = await verifyReplaySources(
      tx,
      orgId,
      replay.map((item) => item.event),
    );
    await clearDerivedState(tx, orgId);
    for (const item of replay) {
      const record = item.event.type === "DecisionRecorded"
        ? sources.decisions.get(item.event.decisionRef.id)
        : undefined;
      await applyProjection(
        tx,
        item.event,
        item.row.sequence,
        await deriveLedgerEventProvenance(
          tx,
          item.event,
          item.provenance,
        ),
        record,
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
