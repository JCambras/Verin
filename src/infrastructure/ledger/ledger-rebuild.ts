import type { SqlDb } from "@infra/store/db";
import { appError } from "@contracts/errors";
import { parseRecordProvenance, type RecordProvenance } from "@contracts/provenance";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { verifyDecisionLedgerTransaction } from "./ledger-verification";
import { verifyReplaySources } from "./ledger-sources";
import {
  applyProjection,
  clearDerivedState,
  listDecisionProjections,
  type ProjectedDecision,
} from "./ledger-projection-store";
import { parseRecordedLedgerEvent } from "./ledger-schema-registry";

export interface RebuiltDecisionProjections {
  readonly entriesReplayed: number;
  readonly projections: readonly ProjectedDecision[];
}

export async function rebuildDecisionProjections(
  db: SqlDb,
  tenant: TenantContext,
): Promise<RebuiltDecisionProjections> {
  assertTenantContext(tenant);
  return db.transaction(async (tx) => {
    const verification = await verifyDecisionLedgerTransaction(tx, tenant);
    if (!verification.ok) {
      throw appError(
        "STORE_CONSTRAINT",
        `decision ledger integrity failed at ${verification.levels.at(-1)?.level ?? "unknown"}`,
      );
    }
    const stored = await tx.query<{
      sequence: number | string;
      event_type: string;
      schema_version: string;
      serializer_version: string;
      payload_json: string;
      prov_source: string;
      prov_asof: string;
      prov_confidence: string;
    }>(
      `SELECT sequence, event_type, schema_version, serializer_version,
              payload_json, prov_source, prov_asof, prov_confidence
         FROM decision_ledger
        WHERE org_id = $1
        ORDER BY sequence ASC`,
      [tenant.orgId],
    );
    const rows = stored.rows.map((row) => ({
      sequence: Number(row.sequence),
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      serializerVersion: row.serializer_version,
      payloadJson: row.payload_json,
      provSource: row.prov_source,
      provAsOf: row.prov_asof,
      provConfidence: row.prov_confidence,
    }));
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
      replay.push({
        row,
        event: parsed.event,
        provenance,
      });
    }
    const sources = await verifyReplaySources(
      tx,
      tenant,
      replay.map((item) => item.event),
    );
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
        item.provenance,
        record,
      );
    }
    const head = rows.at(-1);
    if (head) {
      await tx.query(
        `INSERT INTO decision_projection_checkpoint (org_id,last_sequence,rebuilt_at)
         VALUES ($1,$2,$3)`,
        [tenant.orgId, head.sequence, new Date().toISOString()],
      );
    }
    return {
      entriesReplayed: rows.length,
      projections: await listDecisionProjections(tx, tenant),
    };
  });
}
