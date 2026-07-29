import type { SqlQueryable } from "@infra/store/db";

export interface DecisionLedgerRow {
  readonly orgId: string;
  readonly id: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly schemaVersion: string;
  readonly serializerVersion: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorJson: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly decisionId: string | null;
  readonly evidenceSnapshotId: string | null;
  readonly inputBundleId: string | null;
  readonly expectedInputBundleId: string | null;
  readonly triggeringEntryId: string | null;
  readonly reservationCreationId: string | null;
  readonly payloadJson: string;
  readonly prevHash: string;
  readonly entryHash: string;
  readonly provSource: string;
  readonly provAsOf: string;
  readonly provConfidence: string;
  readonly provenanceSchemaVersion: string;
  readonly provenanceSerializerVersion: string;
  readonly provenanceJson: string | null;
  readonly provenanceTraceId: string | null;
}

interface DbLedgerRow {
  org_id: string;
  id: string;
  sequence: number | string;
  event_type: string;
  schema_version: string;
  serializer_version: string;
  occurred_at: string;
  recorded_at: string;
  actor_json: string;
  correlation_id: string;
  causation_id: string | null;
  decision_id: string | null;
  evidence_snapshot_id: string | null;
  input_bundle_id: string | null;
  expected_input_bundle_id: string | null;
  triggering_entry_id: string | null;
  reservation_creation_id: string | null;
  payload_json: string;
  prev_hash: string;
  entry_hash: string;
  prov_source: string;
  prov_asof: string;
  prov_confidence: string;
  prov_schema_version: string;
  prov_serializer_version: string;
  prov_json: string | null;
  prov_trace_id: string | null;
}

function toRow(row: DbLedgerRow): DecisionLedgerRow {
  return {
    orgId: row.org_id,
    id: row.id,
    sequence: Number(row.sequence),
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    serializerVersion: row.serializer_version,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actorJson: row.actor_json,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    decisionId: row.decision_id,
    evidenceSnapshotId: row.evidence_snapshot_id,
    inputBundleId: row.input_bundle_id,
    expectedInputBundleId: row.expected_input_bundle_id,
    triggeringEntryId: row.triggering_entry_id,
    reservationCreationId: row.reservation_creation_id,
    payloadJson: row.payload_json,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    provSource: row.prov_source,
    provAsOf: row.prov_asof,
    provConfidence: row.prov_confidence,
    provenanceSchemaVersion: row.prov_schema_version,
    provenanceSerializerVersion: row.prov_serializer_version,
    provenanceJson: row.prov_json,
    provenanceTraceId: row.prov_trace_id,
  };
}

export async function listDecisionLedger(
  db: SqlQueryable,
  orgId: string,
  tail?: number,
): Promise<DecisionLedgerRow[]> {
  if (tail === undefined) {
    const result = await db.query<DbLedgerRow>(
      `SELECT ledger.*, record.input_bundle_id AS expected_input_bundle_id
         FROM decision_ledger ledger
         LEFT JOIN decision_records record
           ON record.org_id = ledger.org_id
          AND record.id = ledger.decision_id
        WHERE ledger.org_id = $1
        ORDER BY ledger.sequence ASC`,
      [orgId],
    );
    return result.rows.map(toRow);
  }
  const result = await db.query<DbLedgerRow>(
    `SELECT ledger.*, record.input_bundle_id AS expected_input_bundle_id
       FROM decision_ledger ledger
       LEFT JOIN decision_records record
         ON record.org_id = ledger.org_id
        AND record.id = ledger.decision_id
      WHERE ledger.org_id = $1
      ORDER BY ledger.sequence DESC
      LIMIT $2`,
    [orgId, tail],
  );
  return result.rows.map(toRow).reverse();
}
