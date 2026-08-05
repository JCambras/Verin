import type { SqlDb, SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import type { RecordProvenance } from "@contracts/provenance";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
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
} from "./ledger-schema-registry";
import { deriveLedgerEventProvenance } from "./ledger-source-provenance";
import { storedLedgerStructureLookup } from "./ledger-structural-store";
import { assertRecordedLedgerStructure } from "./ledger-structural-validator";
import {
  assertNoOrphanComputedProvenanceTraces,
  verifyRecordedLedgerProvenance,
} from "./ledger-producer-provenance";

export async function rebuildDecisionProjections(
  db: SqlDb,
  tenant: TenantContext,
  beforeApply?: (tx: SqlQueryable, entries: number) => Promise<void>,
): Promise<ProjectedDecision[]> {
  assertTenantContext(tenant);
  const orgId = tenant.orgId;
  await db.transaction(async (tx) => {
    // A rebuild REPLACES derived state, so it takes the exclusive tenant lock before
    // the compatible verification lock: no append may land between the snapshot it
    // verifies and the fold it writes.
    await lockDecisionLedgerTenant(tx, tenant, "append");
    const checked = await verifyDecisionLedgerTransaction(tx, tenant);
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
    const verifiedEntryIds = new Set(rows.map((row) => row.id));
    const provenanceCache = new Map<
      string,
      Promise<RecordProvenance>
    >();
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
      const provenance = await verifyRecordedLedgerProvenance(
        tx,
        tenant,
        row,
        verifiedEntryIds,
        provenanceCache,
      );
      replay.push({
        row,
        event: parsed.event,
        provenance,
      });
    }
    await assertNoOrphanComputedProvenanceTraces(tx, tenant);
    await assertRecordedLedgerStructure(
      replay.map((item) => ({
        event: item.event,
        sequence: item.row.sequence,
      })),
      storedLedgerStructureLookup(tx, tenant),
    );
    const sources = await verifyReplaySources(
      tx,
      tenant,
      replay.map((item) => item.event),
    );
    if (beforeApply) await beforeApply(tx, rows.length);
    await clearDerivedState(tx, tenant);
    for (const item of replay) {
      const record = item.event.type === "DecisionRecorded"
        ? sources.decisions.get(item.event.decisionRef.id)
        : undefined;
      await applyProjection(
        tx,
        tenant,
        item.event,
        item.row.sequence,
        await deriveLedgerEventProvenance(
          tx,
          tenant,
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
  return listDecisionProjections(db, tenant);
}
