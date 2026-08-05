/** Immutable content-addressed replay inputs and their verification. */
import { createHash } from "node:crypto";
import type { SqlQueryable, SqlTx } from "@infra/store/db";
import { appError } from "@contracts/errors";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import type { EvidenceSnapshotRef, DecisionInputBundle } from "@contracts/decision-core/evidence";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import {
  CANONICAL_SERIALIZER_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
} from "@contracts/decision-core/serialization";
import { canonical } from "./ledger-canonical";

async function reuseStoredBytes(
  tx: SqlQueryable,
  table: "evidence_snapshots" | "decision_input_bundles",
  orgId: string,
  id: string,
  bytes: string,
): Promise<boolean> {
  const stored = await tx.query<{ canonical_json: string }>(
    `SELECT canonical_json FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, id],
  );
  const existing = stored.rows[0];
  if (!existing) return false;
  if (existing.canonical_json !== bytes) {
    throw appError(
      "STORE_CONSTRAINT",
      `${table} already stores different immutable bytes under this id`,
    );
  }
  return true;
}

export async function preflightEvidenceSnapshots(
  tx: SqlTx,
  tenant: TenantContext,
  snapshots: readonly EvidenceSnapshotRef[],
): Promise<void> {
  assertTenantContext(tenant);
  if (snapshots.some((snapshot) => snapshot.firmId !== tenant.orgId)) {
    throw appError("AUTH_FAILED", "evidence tenant does not match write authority");
  }
  const ids = new Set<string>();
  for (const snapshot of snapshots) {
    if (ids.has(snapshot.id)) {
      throw appError("STORE_CONSTRAINT", "evidence batch repeats an immutable snapshot id");
    }
    ids.add(snapshot.id);
    const bytes = canonical(snapshot, "evidence snapshot");
    if (!bytes.ok) throw bytes.error;
    await reuseStoredBytes(
      tx,
      "evidence_snapshots",
      snapshot.firmId,
      snapshot.id,
      bytes.value,
    );
  }
}

export async function insertEvidenceSnapshots(
  tx: SqlTx,
  tenant: TenantContext,
  snapshots: readonly EvidenceSnapshotRef[],
  recordedAt: string,
): Promise<void> {
  assertTenantContext(tenant);
  if (snapshots.some((snapshot) => snapshot.firmId !== tenant.orgId)) {
    throw appError("AUTH_FAILED", "evidence tenant does not match write authority");
  }
  for (const snapshot of snapshots) {
    const bytes = canonical(snapshot, "evidence snapshot");
    if (!bytes.ok) throw bytes.error;
    if (await reuseStoredBytes(
      tx, "evidence_snapshots", snapshot.firmId, snapshot.id, bytes.value,
    )) continue;
    await tx.query(
      `INSERT INTO evidence_snapshots
        (org_id,id,canonical_json,schema_version,contract_schema_version,
         serializer_version,
         content_hash,snapshot_hash,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        snapshot.firmId, snapshot.id, bytes.value, snapshot.schemaVersion,
        DECISION_CORE_SCHEMA_VERSION, CANONICAL_SERIALIZER_VERSION,
        snapshot.contentHash,
        createHash("sha256").update(bytes.value, "utf8").digest("hex"), recordedAt,
      ],
    );
  }
}

async function insertBundle(
  tx: SqlTx,
  bundle: DecisionInputBundle,
  recordedAt: string,
): Promise<void> {
  const bytes = canonical(bundle, "decision input bundle");
  if (!bytes.ok) throw bytes.error;
  if (await reuseStoredBytes(
    tx, "decision_input_bundles", bundle.firmId, bundle.id, bytes.value,
  )) return;
  const sameContent = await tx.query<{ id: string }>(
    "SELECT id FROM decision_input_bundles WHERE org_id = $1 AND bundle_hash = $2",
    [bundle.firmId, bundle.bundleHash],
  );
  if (sameContent.rows[0]) {
    throw appError(
      "STORE_CONSTRAINT",
      `identical decision inputs are already stored as bundle ${sameContent.rows[0].id}`,
    );
  }
  await tx.query(
    `INSERT INTO decision_input_bundles
      (org_id,id,canonical_json,schema_version,serializer_version,engine_version,
       primitive_set_version,time_zone_data_version,bundle_hash,recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      bundle.firmId, bundle.id, bytes.value, bundle.schemaVersion,
      bundle.canonicalSerializerVersion, bundle.engineVersion,
      bundle.primitiveSetVersion, bundle.timeZoneDataVersion, bundle.bundleHash,
      recordedAt,
    ],
  );
  for (const [ordinal, ref] of bundle.evidenceSnapshotRefs.entries()) {
    await tx.query(
      `INSERT INTO decision_input_bundle_evidence
        (org_id,bundle_id,evidence_snapshot_id,ordinal) VALUES ($1,$2,$3,$4)`,
      [bundle.firmId, bundle.id, ref.id, ordinal],
    );
  }
}

export async function insertDecisionSources(
  tx: SqlTx,
  tenant: TenantContext,
  snapshots: readonly EvidenceSnapshotRef[],
  bundle: DecisionInputBundle,
  record: DecisionRecord,
  recordedAt: string,
): Promise<void> {
  assertTenantContext(tenant);
  if (
    bundle.firmId !== tenant.orgId ||
    record.firmId !== tenant.orgId ||
    snapshots.some((snapshot) => snapshot.firmId !== tenant.orgId)
  ) {
    throw appError("AUTH_FAILED", "decision source tenant does not match write authority");
  }
  await insertEvidenceSnapshots(tx, tenant, snapshots, recordedAt);
  await insertBundle(tx, bundle, recordedAt);
  const recordBytes = canonical(record, "decision record");
  if (!recordBytes.ok) throw recordBytes.error;
  await tx.query(
    `INSERT INTO decision_records
      (org_id,id,input_bundle_id,canonical_json,schema_version,
       serializer_version,decision_hash,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      record.firmId, record.id, record.inputBundleRef.id, recordBytes.value,
      bundle.schemaVersion, bundle.canonicalSerializerVersion,
      record.decisionHash, record.createdAt,
    ],
  );
}
