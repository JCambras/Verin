/**
 * Immutable replay inputs: evidence snapshots, the input bundle with its ordered
 * evidence membership, and the decision record. These rows are content-addressed and
 * append-only, so this module either writes new bytes or reuses byte-identical stored
 * ones - it never rewrites, and it refuses a same-id/different-bytes collision.
 */
import { createHash } from "node:crypto";
import type { SqlQueryable, SqlTx } from "@infra/store/db";
import { appError, type AppError } from "@contracts/errors";
import { err, type Result } from "@contracts/result";
import { assertNoPIIValues } from "@contracts/pii";
import {
  type EvidenceSnapshotRef,
  type DecisionInputBundle,
} from "@contracts/decision-core/evidence";
import {
  type DecisionRecord,
} from "@contracts/decision-core/decision";
import type {
  DecisionRecorded,
  EvidenceSnapshotRecorded,
  LedgerEntry,
} from "@contracts/decision-core/ledger";
import {
  CANONICAL_SERIALIZER_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
  bundleHashPreimage,
  canonicalJson,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { parseRecordedReplaySource } from "./ledger-source-registry";
import { assertReplaySourcePiiBoundary } from "./ledger-pii";

export function canonical(value: unknown, label: string): Result<string, AppError> {
  const serialized = canonicalJson(value as JsonValue);
  return serialized.ok
    ? serialized
    : err(appError("VALIDATION", `${label} is not canonically serializable`));
}

export function canonicalDigest(value: unknown, label: string): Result<string, AppError> {
  const bytes = canonical(value, label);
  return bytes.ok
    ? {
        ok: true,
        value: createHash("sha256").update(bytes.value, "utf8").digest("hex"),
      }
    : bytes;
}

export function replaySourcesContainPII(values: readonly unknown[]): boolean {
  try {
    values.forEach((value) =>
      assertNoPIIValues(value, "decision ledger replay source"));
    return false;
  } catch {
    return true;
  }
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

export async function preflightEvidenceSnapshots(
  tx: SqlTx,
  snapshots: readonly EvidenceSnapshotRef[],
): Promise<void> {
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

/** Evidence recorded with a decision, or gathered later and cited by a status event. */
export async function insertEvidenceSnapshots(
  tx: SqlTx,
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

/** A later decision over the same inputs reuses the stored bundle instead of colliding. */
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
  snapshots: readonly EvidenceSnapshotRef[],
  bundle: DecisionInputBundle,
  record: DecisionRecord,
  recordedAt: string,
): Promise<void> {
  await insertEvidenceSnapshots(tx, snapshots, recordedAt);
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

function replaySourceError(reason: string): never {
  throw appError("STORE_CONSTRAINT", reason);
}

function requireCanonicalSource<
  K extends "evidence" | "bundle" | "decision",
>(
  kind: K,
  value: unknown,
  bytes: string,
  schemaVersion: string,
  serializerVersion: string,
  label: string,
): K extends "evidence"
  ? EvidenceSnapshotRef
  : K extends "bundle"
    ? DecisionInputBundle
    : DecisionRecord {
  const parsed = parseRecordedReplaySource(
    kind,
    schemaVersion,
    serializerVersion,
    value,
  );
  if (!parsed.ok) {
    return replaySourceError(`${parsed.reason} during replay`);
  }
  if (parsed.canonicalBytes !== bytes) {
    return replaySourceError(`${label} bytes are not canonical during replay`);
  }
  if (replaySourcesContainPII([parsed.value])) {
    return replaySourceError(`${label} contains prohibited PII during replay`);
  }
  try {
    assertReplaySourcePiiBoundary(kind, parsed.value);
  } catch {
    return replaySourceError(`${label} contains unclassified text during replay`);
  }
  return parsed.value as never;
}

export async function verifyReplayEvidence(
  tx: SqlQueryable,
  event: EvidenceSnapshotRecorded,
): Promise<string> {
  const result = await tx.query<{
    canonical_json: string;
    schema_version: string;
    contract_schema_version: string;
    serializer_version: string;
    content_hash: string;
    snapshot_hash: string;
  }>(
    `SELECT canonical_json, schema_version, contract_schema_version,
            serializer_version, content_hash, snapshot_hash
       FROM evidence_snapshots
      WHERE org_id = $1 AND id = $2`,
    [event.firmId, event.evidenceSnapshotRef.id],
  );
  const row = result.rows[0];
  if (!row) return replaySourceError("evidence snapshot is missing during replay");
  let value: unknown;
  try {
    value = JSON.parse(row.canonical_json);
  } catch {
    return replaySourceError("evidence snapshot is not JSON during replay");
  }
  const snapshot = requireCanonicalSource(
    "evidence",
    value,
    row.canonical_json,
    row.contract_schema_version,
    row.serializer_version,
    "evidence snapshot",
  );
  const snapshotHash = createHash("sha256")
    .update(row.canonical_json, "utf8")
    .digest("hex");
  if (
    snapshot.firmId !== event.firmId ||
    snapshot.id !== event.evidenceSnapshotRef.id ||
    snapshot.schemaVersion !== row.schema_version ||
    row.serializer_version !== CANONICAL_SERIALIZER_VERSION ||
    snapshot.contentHash !== row.content_hash ||
    event.contentHash !== row.content_hash ||
    snapshotHash !== row.snapshot_hash ||
    event.snapshotHash !== row.snapshot_hash
  ) {
    return replaySourceError("evidence snapshot binding differs during replay");
  }
  return snapshot.id;
}

export async function loadVerifiedReplayDecision(
  tx: SqlQueryable,
  event: DecisionRecorded,
  verifiedEvidence: ReadonlySet<string>,
): Promise<DecisionRecord> {
  const decisions = await tx.query<{
    input_bundle_id: string;
    canonical_json: string;
    schema_version: string;
    serializer_version: string;
    decision_hash: string;
    created_at: string;
  }>(
    `SELECT input_bundle_id, canonical_json, schema_version, serializer_version,
            decision_hash, created_at
       FROM decision_records
      WHERE org_id = $1 AND id = $2`,
    [event.firmId, event.decisionRef.id],
  );
  const decisionRow = decisions.rows[0];
  if (!decisionRow) return replaySourceError("decision record is missing during replay");
  const bundles = await tx.query<{
    canonical_json: string;
    schema_version: string;
    serializer_version: string;
    engine_version: string;
    primitive_set_version: string;
    time_zone_data_version: string;
    bundle_hash: string;
  }>(
    `SELECT canonical_json, schema_version, serializer_version, engine_version,
            primitive_set_version, time_zone_data_version, bundle_hash
       FROM decision_input_bundles
      WHERE org_id = $1 AND id = $2`,
    [event.firmId, decisionRow.input_bundle_id],
  );
  const bundleRow = bundles.rows[0];
  if (!bundleRow) return replaySourceError("decision input bundle is missing during replay");
  let decisionValue: unknown;
  let bundleValue: unknown;
  try {
    decisionValue = JSON.parse(decisionRow.canonical_json);
    bundleValue = JSON.parse(bundleRow.canonical_json);
  } catch {
    return replaySourceError("decision replay source is not JSON");
  }
  const record = requireCanonicalSource(
    "decision",
    decisionValue,
    decisionRow.canonical_json,
    decisionRow.schema_version,
    decisionRow.serializer_version,
    "decision record",
  );
  const bundle = requireCanonicalSource(
    "bundle",
    bundleValue,
    bundleRow.canonical_json,
    bundleRow.schema_version,
    bundleRow.serializer_version,
    "decision input bundle",
  );
  const decisionHash = canonicalDigest(
    decisionHashPreimage(record),
    "decision hash preimage",
  );
  const bundleHash = canonicalDigest(
    bundleHashPreimage(bundle),
    "bundle hash preimage",
  );
  const memberships = await tx.query<{
    evidence_snapshot_id: string;
    ordinal: number | string;
  }>(
    `SELECT evidence_snapshot_id, ordinal
       FROM decision_input_bundle_evidence
      WHERE org_id = $1 AND bundle_id = $2
      ORDER BY ordinal ASC`,
    [event.firmId, bundle.id],
  );
  const memberIds = memberships.rows.map((row, index) =>
    Number(row.ordinal) === index ? row.evidence_snapshot_id : "");
  const expectedIds = bundle.evidenceSnapshotRefs.map((ref) => ref.id);
  if (
    record.firmId !== event.firmId ||
    record.id !== event.decisionRef.id ||
    record.inputBundleRef.id !== bundle.id ||
    decisionRow.input_bundle_id !== bundle.id ||
    decisionRow.schema_version !== bundle.schemaVersion ||
    decisionRow.serializer_version !== bundle.canonicalSerializerVersion ||
    decisionRow.decision_hash !== record.decisionHash ||
    decisionRow.created_at !== record.createdAt ||
    bundleRow.schema_version !== bundle.schemaVersion ||
    bundleRow.serializer_version !== bundle.canonicalSerializerVersion ||
    bundleRow.engine_version !== bundle.engineVersion ||
    bundleRow.primitive_set_version !== bundle.primitiveSetVersion ||
    bundleRow.time_zone_data_version !== bundle.timeZoneDataVersion ||
    bundleRow.bundle_hash !== bundle.bundleHash ||
    !decisionHash.ok ||
    decisionHash.value !== record.decisionHash ||
    event.decisionHash !== record.decisionHash ||
    !bundleHash.ok ||
    bundleHash.value !== bundle.bundleHash ||
    memberIds.length !== expectedIds.length ||
    memberIds.some((id, index) => id !== expectedIds[index]) ||
    expectedIds.some((id) => !verifiedEvidence.has(id))
  ) {
    return replaySourceError("decision replay source binding differs during replay");
  }
  return record;
}

export interface VerifiedReplaySources {
  readonly decisions: ReadonlyMap<string, DecisionRecord>;
  readonly sourcesChecked: number;
}

export async function verifyReplaySources(
  tx: SqlQueryable,
  orgId: string,
  events: readonly LedgerEntry[],
): Promise<VerifiedReplaySources> {
  const evidence = new Set<string>();
  const decisions = new Map<string, DecisionRecord>();
  for (const event of events) {
    if (event.type === "EvidenceSnapshotRecorded") {
      evidence.add(await verifyReplayEvidence(tx, event));
    } else if (event.type === "DecisionRecorded") {
      decisions.set(
        event.decisionRef.id,
        await loadVerifiedReplayDecision(tx, event, evidence),
      );
    }
  }
  const coverage = await tx.query<{
    orphan_evidence: number | string;
    orphan_bundles: number | string;
    orphan_decisions: number | string;
    source_count: number | string;
  }>(
    `SELECT
       (SELECT count(*) FROM evidence_snapshots s
         WHERE s.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_ledger l
            WHERE l.org_id = s.org_id
              AND l.evidence_snapshot_id = s.id
              AND l.event_type = 'EvidenceSnapshotRecorded'
         )) AS orphan_evidence,
       (SELECT count(*) FROM decision_input_bundles b
         WHERE b.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_records r
            WHERE r.org_id = b.org_id AND r.input_bundle_id = b.id
         )) AS orphan_bundles,
       (SELECT count(*) FROM decision_records r
         WHERE r.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_ledger l
            WHERE l.org_id = r.org_id
              AND l.decision_id = r.id
              AND l.event_type = 'DecisionRecorded'
         )) AS orphan_decisions,
       (SELECT count(*) FROM evidence_snapshots WHERE org_id = $1) +
       (SELECT count(*) FROM decision_input_bundles WHERE org_id = $1) +
       (SELECT count(*) FROM decision_input_bundle_evidence WHERE org_id = $1) +
       (SELECT count(*) FROM decision_records WHERE org_id = $1) AS source_count`,
    [orgId],
  );
  const row = coverage.rows[0];
  if (
    !row ||
    Number(row.orphan_evidence) !== 0 ||
    Number(row.orphan_bundles) !== 0 ||
    Number(row.orphan_decisions) !== 0
  ) {
    replaySourceError("immutable replay source has no recording ledger fact");
  }
  return {
    decisions,
    sourcesChecked: Number(row.source_count),
  };
}
