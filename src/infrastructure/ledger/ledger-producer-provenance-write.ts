import type { SqlTx } from "@infra/store/db";
import { appError } from "@contracts/errors";
import type { RecordProvenance } from "@contracts/provenance";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import {
  verifyPreparedLedgerProducerProvenance,
  type PreparedLedgerProducerProvenance,
} from "./ledger-producer-provenance";

async function insertOrMatchTrace(
  tx: SqlTx,
  prepared: PreparedLedgerProducerProvenance,
  recordedAt: string,
): Promise<void> {
  if (
    prepared.value.source !== "computed" ||
    prepared.traceId === null ||
    prepared.traceJson === null ||
    prepared.traceDigest === null
  ) return;
  const traceRef = prepared.value.derivation.traceRef;
  const existing = await tx.query<{
    schema_version: string;
    serializer_version: string;
    canonical_json: string;
    trace_digest: string;
  }>(
    `SELECT schema_version, serializer_version, canonical_json, trace_digest
       FROM decision_provenance_traces
      WHERE org_id = $1 AND id = $2`,
    [traceRef.firmId, traceRef.id],
  );
  const row = existing.rows[0];
  if (row) {
    if (
      row.schema_version !== prepared.schemaVersion ||
      row.serializer_version !== prepared.serializerVersion ||
      row.canonical_json !== prepared.traceJson ||
      row.trace_digest !== prepared.traceDigest
    ) {
      throw appError(
        "STORE_CONSTRAINT",
        "computed provenance trace identity has different bytes",
      );
    }
    return;
  }
  await tx.query(
    `INSERT INTO decision_provenance_traces
      (org_id,id,schema_version,serializer_version,canonical_json,
       trace_digest,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      traceRef.firmId,
      traceRef.id,
      prepared.schemaVersion,
      prepared.serializerVersion,
      prepared.traceJson,
      prepared.traceDigest,
      recordedAt,
    ],
  );
}

export async function persistLedgerProducerProvenance(
  tx: SqlTx,
  tenant: TenantContext,
  prepared: PreparedLedgerProducerProvenance,
  beforeSequence: number,
  recordedAt: string,
): Promise<RecordProvenance> {
  assertTenantContext(tenant);
  if (
    prepared.value.source === "computed" &&
    (prepared.value.derivation.traceRef.firmId !== tenant.orgId ||
      prepared.value.derivation.inputs.some(
        (input) => input.entryRef.firmId !== tenant.orgId,
      ))
  ) {
    throw appError("VALIDATION", "computed provenance tenant does not match authority");
  }
  const verified = await verifyPreparedLedgerProducerProvenance(
    tx,
    tenant,
    prepared,
    beforeSequence,
  );
  await insertOrMatchTrace(tx, prepared, recordedAt);
  return verified;
}
