import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
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
import { parseRecordedLedgerProvenance } from "./ledger-schema-registry";

type SourceKind = "evidence" | "bundle" | "decision";

interface BindingRow {
  readonly recording_entry_id: string;
  readonly event_type: string;
  readonly decision_id: string | null;
  readonly evidence_snapshot_id: string | null;
  readonly input_bundle_id: string | null;
  readonly has_earlier_recording: boolean;
  readonly prov_source: string;
  readonly prov_asof: string;
  readonly prov_confidence: string;
  readonly schema_version: string;
  readonly serializer_version: string;
}

export const UNVERIFIED_REPLAY_SOURCE_PROVENANCE =
  "immutable replay source provenance binding is outside verified window";

function bindingProvenance(
  row: BindingRow | undefined,
  kind: SourceKind,
  id: string,
): RecordProvenance | null {
  if (!row) return null;
  const matches = kind === "evidence"
    ? row.event_type === "EvidenceSnapshotRecorded" &&
      row.evidence_snapshot_id === id
    : row.event_type === "DecisionRecorded" &&
      (kind === "decision"
        ? row.decision_id === id
        : row.input_bundle_id === id);
  const provenance = parseRecordedLedgerProvenance(
    row.schema_version,
    row.serializer_version,
    {
      source: row.prov_source,
      asOf: row.prov_asof,
      confidence: row.prov_confidence,
    },
  );
  if (!matches || row.has_earlier_recording || !provenance) {
    throw appError(
      "STORE_CONSTRAINT",
      "immutable replay source provenance binding is invalid",
    );
  }
  return provenance;
}

async function loadBinding(
  tx: SqlQueryable,
  orgId: string,
  kind: SourceKind,
  id: string,
  verifiedRecordingEntryIds?: ReadonlySet<string>,
): Promise<RecordProvenance | null> {
  const result = await tx.query<BindingRow>(
    `SELECT binding.recording_entry_id, ledger.event_type, ledger.decision_id,
            ledger.evidence_snapshot_id, record.input_bundle_id,
            EXISTS (
              SELECT 1
                FROM decision_ledger earlier
                LEFT JOIN decision_records earlier_record
                  ON earlier_record.org_id = earlier.org_id
                 AND earlier_record.id = earlier.decision_id
               WHERE earlier.org_id = binding.org_id
                 AND earlier.sequence < ledger.sequence
                 AND (
                   (binding.source_kind = 'evidence'
                     AND earlier.event_type = 'EvidenceSnapshotRecorded'
                     AND earlier.evidence_snapshot_id = binding.source_id)
                   OR (binding.source_kind = 'decision'
                     AND earlier.event_type = 'DecisionRecorded'
                     AND earlier.decision_id = binding.source_id)
                   OR (binding.source_kind = 'bundle'
                     AND earlier.event_type = 'DecisionRecorded'
                     AND earlier_record.input_bundle_id = binding.source_id)
                 )
            ) AS has_earlier_recording,
            ledger.prov_source, ledger.prov_asof, ledger.prov_confidence,
            ledger.schema_version, ledger.serializer_version
       FROM decision_replay_source_provenance binding
       JOIN decision_ledger ledger
         ON ledger.org_id = binding.org_id
        AND ledger.id = binding.recording_entry_id
       LEFT JOIN decision_records record
         ON record.org_id = ledger.org_id
        AND record.id = ledger.decision_id
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
  return bindingProvenance(row, kind, id);
}

async function decisionSourceProvenance(
  tx: SqlQueryable,
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
    event.firmId,
    "decision",
    event.decisionRef.id,
    verifiedRecordingEntryIds,
  );
  const bundle = await loadBinding(
    tx,
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
  event: LedgerEntry,
  eventProvenance: RecordProvenance,
  allowCurrentDecisionBinding = false,
  verifiedRecordingEntryIds?: ReadonlySet<string>,
): Promise<DerivedProvenance> {
  const inputs: RecordProvenance[] = [eventProvenance];
  if (event.type === "DecisionRecorded") {
    inputs.push(...await decisionSourceProvenance(
      tx,
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
  event: EvidenceSnapshotRecorded | DecisionRecorded,
): Promise<void> {
  if (event.type === "EvidenceSnapshotRecorded") {
    if (!await loadBinding(
      tx,
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
  await decisionSourceProvenance(tx, event, null);
}
