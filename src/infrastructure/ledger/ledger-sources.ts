/**
 * Immutable replay inputs: evidence snapshots, the input bundle with its ordered
 * evidence membership, and the decision record. These rows are content-addressed and
 * append-only, so this module either writes new bytes or reuses byte-identical stored
 * ones - it never rewrites, and it refuses a same-id/different-bytes collision.
 */
import type { SqlQueryable } from "@infra/store/db";
import { appError, type AppError } from "@contracts/errors";
import { err, type Result } from "@contracts/result";
import type { EvidenceSnapshotRef, DecisionInputBundle } from "@contracts/decision-core/evidence";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import {
  CANONICAL_SERIALIZER_VERSION,
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";

export function canonical(value: unknown, label: string): Result<string, AppError> {
  const serialized = canonicalJson(value as JsonValue);
  return serialized.ok
    ? serialized
    : err(appError("VALIDATION", `${label} is not canonically serializable`));
}

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

async function insertEvidence(
  tx: SqlQueryable,
  snapshots: readonly EvidenceSnapshotRef[],
  recordedAt: string,
): Promise<void> {
  for (const snapshot of snapshots) {
    const bytes = canonical(snapshot, "evidence snapshot");
    if (!bytes.ok) throw bytes.error;
    if (await reuseStoredBytes(
      tx, "evidence_snapshots", snapshot.firmId, snapshot.id, bytes.value,
    )) continue;
    await tx.query(
      `INSERT INTO evidence_snapshots
        (org_id,id,canonical_json,schema_version,serializer_version,
         content_hash,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        snapshot.firmId, snapshot.id, bytes.value, snapshot.schemaVersion,
        CANONICAL_SERIALIZER_VERSION, snapshot.contentHash, recordedAt,
      ],
    );
  }
}

/** A later decision over the same inputs reuses the stored bundle instead of colliding. */
async function insertBundle(
  tx: SqlQueryable,
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
  tx: SqlQueryable,
  snapshots: readonly EvidenceSnapshotRef[],
  bundle: DecisionInputBundle,
  record: DecisionRecord,
  recordedAt: string,
): Promise<void> {
  await insertEvidence(tx, snapshots, recordedAt);
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
