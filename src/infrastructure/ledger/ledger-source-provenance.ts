import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import {
  deriveArtifactProvenance,
  type DerivedProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
import type {
  DecisionRecorded,
  EvidenceSnapshotRecorded,
  LedgerEntry,
} from "@contracts/decision-core/ledger";
import { verifyRecordedLedgerProvenance } from "./ledger-producer-provenance";

type SourceKind = "evidence" | "bundle" | "decision";

interface BindingRow {
  readonly org_id: string;
  readonly recording_entry_id: string;
  readonly entry_hash: string;
  readonly event_type: string;
  readonly decision_id: string | null;
  readonly evidence_snapshot_id: string | null;
  readonly input_bundle_id: string | null;
  readonly sequence: number | string;
  readonly prov_source: string;
  readonly prov_asof: string;
  readonly prov_confidence: string;
  readonly prov_schema_version: string;
  readonly prov_serializer_version: string;
  readonly prov_json: string | null;
  readonly prov_trace_id: string | null;
  readonly schema_version: string;
  readonly serializer_version: string;
}

export const UNVERIFIED_REPLAY_SOURCE_PROVENANCE =
  "immutable replay source provenance binding is outside verified window";

async function bindingProvenance(
  tx: SqlQueryable,
  tenant: TenantContext,
  row: BindingRow | undefined,
  kind: SourceKind,
  id: string,
  hasEarlierRecording: boolean,
  verifiedRecordingEntryIds?: ReadonlySet<string>,
): Promise<RecordProvenance | null> {
  if (!row) return null;
  const matches = kind === "evidence"
    ? row.event_type === "EvidenceSnapshotRecorded" &&
      row.evidence_snapshot_id === id
    : row.event_type === "DecisionRecorded" &&
      (kind === "decision"
        ? row.decision_id === id
        : row.input_bundle_id === id);
  if (!matches || hasEarlierRecording) {
    throw appError(
      "STORE_CONSTRAINT",
      "immutable replay source provenance binding is invalid",
    );
  }
  return verifyRecordedLedgerProvenance(
    tx,
    tenant,
    {
      orgId: row.org_id,
      id: row.recording_entry_id,
      sequence: Number(row.sequence),
      entryHash: row.entry_hash,
      schemaVersion: row.schema_version,
      serializerVersion: row.serializer_version,
      provSource: row.prov_source,
      provAsOf: row.prov_asof,
      provConfidence: row.prov_confidence,
      provenanceSchemaVersion: row.prov_schema_version,
      provenanceSerializerVersion: row.prov_serializer_version,
      provenanceJson: row.prov_json,
      provenanceTraceId: row.prov_trace_id,
    },
    verifiedRecordingEntryIds,
  );
}

async function hasEarlierSourceRecording(
  tx: SqlQueryable,
  orgId: string,
  kind: SourceKind,
  id: string,
  beforeSequence: number,
): Promise<boolean> {
  const params = [orgId, id, beforeSequence];
  const result = kind === "evidence"
    ? await tx.query<{ sequence: number | string }>(
        `SELECT sequence
           FROM decision_ledger earlier
          WHERE earlier.org_id = $1
            AND earlier.evidence_snapshot_id = $2
            AND earlier.event_type = 'EvidenceSnapshotRecorded'
            AND earlier.sequence < $3
          ORDER BY earlier.sequence DESC
          LIMIT 1`,
        params,
      )
    : kind === "decision"
    ? await tx.query<{ sequence: number | string }>(
        `SELECT sequence
           FROM decision_ledger earlier
          WHERE earlier.org_id = $1
            AND earlier.decision_id = $2
            AND earlier.event_type = 'DecisionRecorded'
            AND earlier.sequence < $3
          ORDER BY earlier.sequence DESC
          LIMIT 1`,
        params,
      )
    : await tx.query<{ sequence: number | string }>(
        `SELECT sequence
           FROM decision_ledger earlier
          WHERE earlier.org_id = $1
            AND earlier.input_bundle_id = $2
            AND earlier.event_type = 'DecisionRecorded'
            AND earlier.sequence < $3
          ORDER BY earlier.sequence DESC
          LIMIT 1`,
        params,
      );
  return result.rows.length > 0;
}

async function loadBinding(
  tx: SqlQueryable,
  tenant: TenantContext,
  orgId: string,
  kind: SourceKind,
  id: string,
  verifiedRecordingEntryIds?: ReadonlySet<string>,
): Promise<RecordProvenance | null> {
  const result = await tx.query<BindingRow>(
    `SELECT ledger.org_id, binding.recording_entry_id, ledger.entry_hash,
            ledger.event_type, ledger.decision_id,
            ledger.evidence_snapshot_id, ledger.input_bundle_id,
            ledger.sequence,
            ledger.prov_source, ledger.prov_asof, ledger.prov_confidence,
            ledger.prov_schema_version, ledger.prov_serializer_version,
            ledger.prov_json, ledger.prov_trace_id,
            ledger.schema_version, ledger.serializer_version
       FROM decision_replay_source_provenance binding
       JOIN decision_ledger ledger
         ON ledger.org_id = binding.org_id
        AND ledger.id = binding.recording_entry_id
      WHERE binding.org_id = $1
        AND binding.source_kind = $2
        AND binding.source_id = $3`,
    [orgId, kind, id],
  );
  const row = result.rows[0];
  if (
    row &&
    verifiedRecordingEntryIds &&
    !verifiedRecordingEntryIds.has(row.recording_entry_id)
  ) {
    throw appError(
      "STORE_CONSTRAINT",
      UNVERIFIED_REPLAY_SOURCE_PROVENANCE,
    );
  }
  const hasEarlierRecording = row
    ? await hasEarlierSourceRecording(
        tx,
        orgId,
        kind,
        id,
        Number(row.sequence),
      )
    : false;
  return bindingProvenance(
    tx,
    tenant,
    row,
    kind,
    id,
    hasEarlierRecording,
    verifiedRecordingEntryIds,
  );
}

async function decisionSourceProvenance(
  tx: SqlQueryable,
  tenant: TenantContext,
  event: DecisionRecorded,
  fallback: RecordProvenance | null,
  verifiedRecordingEntryIds?: ReadonlySet<string>,
): Promise<RecordProvenance[]> {
  const record = await tx.query<{ input_bundle_id: string }>(
    `SELECT input_bundle_id FROM decision_records
      WHERE org_id = $1 AND id = $2`,
    [event.firmId, event.decisionRef.id],
  );
  const bundleId = record.rows[0]?.input_bundle_id;
  if (!bundleId) {
    throw appError(
      "STORE_CONSTRAINT",
      "decision provenance has no immutable input bundle",
    );
  }
  const decision = await loadBinding(
    tx,
    tenant,
    event.firmId,
    "decision",
    event.decisionRef.id,
    verifiedRecordingEntryIds,
  );
  const bundle = await loadBinding(
    tx,
    tenant,
    event.firmId,
    "bundle",
    bundleId,
    verifiedRecordingEntryIds,
  );
  if ((!decision || !bundle) && !fallback) {
    throw appError(
      "STORE_CONSTRAINT",
      "immutable decision provenance binding is missing",
    );
  }
  const members = await tx.query<{ evidence_snapshot_id: string }>(
    `SELECT evidence_snapshot_id
       FROM decision_input_bundle_evidence
      WHERE org_id = $1 AND bundle_id = $2
      ORDER BY ordinal ASC`,
    [event.firmId, bundleId],
  );
  const provenances: RecordProvenance[] = [
    decision ?? fallback!,
    bundle ?? fallback!,
  ];
  for (const member of members.rows) {
    const provenance = await loadBinding(
      tx,
      tenant,
      event.firmId,
      "evidence",
      member.evidence_snapshot_id,
      verifiedRecordingEntryIds,
    );
    if (!provenance) {
      throw appError(
        "STORE_CONSTRAINT",
        "immutable evidence provenance binding is missing",
      );
    }
    provenances.push(provenance);
  }
  return provenances;
}

export async function deriveLedgerEventProvenance(
  tx: SqlQueryable,
  tenant: TenantContext,
  event: LedgerEntry,
  eventProvenance: RecordProvenance,
  allowCurrentDecisionBinding = false,
  verifiedRecordingEntryIds?: ReadonlySet<string>,
): Promise<DerivedProvenance> {
  assertTenantContext(tenant);
  if (event.firmId !== tenant.orgId) {
    throw appError("VALIDATION", "ledger event tenant does not match authority");
  }
  const inputs: RecordProvenance[] = [eventProvenance];
  if (event.type === "DecisionRecorded") {
    inputs.push(...await decisionSourceProvenance(
      tx,
      tenant,
      event,
      allowCurrentDecisionBinding ? eventProvenance : null,
      verifiedRecordingEntryIds,
    ));
  } else if (
    event.type === "StatusObserved" &&
    event.evidenceSnapshotRef
  ) {
    const provenance = await loadBinding(
      tx,
      tenant,
      event.firmId,
      "evidence",
      event.evidenceSnapshotRef.id,
      verifiedRecordingEntryIds,
    );
    if (!provenance) {
      throw appError(
        "STORE_CONSTRAINT",
        "status evidence provenance binding is missing",
      );
    }
    inputs.push(provenance);
  }
  const asOf = inputs.reduce(
    (latest, input) => input.asOf > latest ? input.asOf : latest,
    inputs[0]!.asOf,
  );
  return deriveArtifactProvenance(inputs, asOf);
}

export async function verifyReplaySourceProvenanceBinding(
  tx: SqlQueryable,
  tenant: TenantContext,
  event: EvidenceSnapshotRecorded | DecisionRecorded,
): Promise<void> {
  assertTenantContext(tenant);
  if (event.firmId !== tenant.orgId) {
    throw appError("VALIDATION", "ledger event tenant does not match authority");
  }
  if (event.type === "EvidenceSnapshotRecorded") {
    if (!await loadBinding(
      tx,
      tenant,
      event.firmId,
      "evidence",
      event.evidenceSnapshotRef.id,
    )) {
      throw appError(
        "STORE_CONSTRAINT",
        "immutable evidence provenance binding is missing",
      );
    }
    return;
  }
  await decisionSourceProvenance(tx, tenant, event, null);
}
