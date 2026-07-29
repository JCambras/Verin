import { appError } from "@contracts/errors";
import type { SqlQueryable } from "@infra/store/db";

interface ReplaySourceCoverageRow {
  readonly orphan_evidence: number | string;
  readonly orphan_bundles: number | string;
  readonly orphan_decisions: number | string;
  readonly orphan_bindings: number | string;
  readonly missing_bindings: number | string;
  readonly source_count: number | string;
}

export async function verifyReplaySourceCoverage(
  tx: SqlQueryable,
  orgId: string,
): Promise<number> {
  const coverage = await tx.query<ReplaySourceCoverageRow>(
    `WITH bindable_sources AS (
       SELECT 'evidence' AS source_kind, bindable_evidence.id AS source_id
         FROM evidence_snapshots bindable_evidence
        WHERE bindable_evidence.org_id = $1
       UNION ALL
       SELECT 'bundle', bindable_bundle.id
         FROM decision_input_bundles bindable_bundle
        WHERE bindable_bundle.org_id = $1
       UNION ALL
       SELECT 'decision', bindable_decision.id
         FROM decision_records bindable_decision
        WHERE bindable_decision.org_id = $1
     )
     SELECT
       (SELECT count(*) FROM evidence_snapshots orphan_evidence_source
         WHERE orphan_evidence_source.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_ledger evidence_recording
            WHERE evidence_recording.org_id = orphan_evidence_source.org_id
              AND evidence_recording.evidence_snapshot_id =
                  orphan_evidence_source.id
              AND evidence_recording.event_type = 'EvidenceSnapshotRecorded'
         )) AS orphan_evidence,
       (SELECT count(*) FROM decision_input_bundles orphan_bundle_source
         WHERE orphan_bundle_source.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_records bundle_decision
            WHERE bundle_decision.org_id = orphan_bundle_source.org_id
              AND bundle_decision.input_bundle_id = orphan_bundle_source.id
         )) AS orphan_bundles,
       (SELECT count(*) FROM decision_records orphan_decision_source
         WHERE orphan_decision_source.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_ledger decision_recording
            WHERE decision_recording.org_id = orphan_decision_source.org_id
              AND decision_recording.decision_id = orphan_decision_source.id
              AND decision_recording.event_type = 'DecisionRecorded'
         )) AS orphan_decisions,
       (SELECT count(*)
          FROM decision_replay_source_provenance orphan_binding
         WHERE orphan_binding.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM bindable_sources orphan_binding_source
            WHERE orphan_binding_source.source_kind =
                  orphan_binding.source_kind
              AND orphan_binding_source.source_id = orphan_binding.source_id
         )) AS orphan_bindings,
       (SELECT count(*) FROM bindable_sources missing_binding_source
         WHERE NOT EXISTS (
           SELECT 1
             FROM decision_replay_source_provenance missing_source_binding
            WHERE missing_source_binding.org_id = $1
              AND missing_source_binding.source_kind =
                  missing_binding_source.source_kind
              AND missing_source_binding.source_id =
                  missing_binding_source.source_id
         )) AS missing_bindings,
       (SELECT count(*) FROM evidence_snapshots count_evidence
         WHERE count_evidence.org_id = $1) +
       (SELECT count(*) FROM decision_input_bundles count_bundle
         WHERE count_bundle.org_id = $1) +
       (SELECT count(*) FROM decision_input_bundle_evidence count_membership
         WHERE count_membership.org_id = $1) +
       (SELECT count(*) FROM decision_records count_decision
         WHERE count_decision.org_id = $1) AS source_count`,
    [orgId],
  );
  const row = coverage.rows[0];
  if (!row || Number(row.orphan_bindings) !== 0) {
    throw appError(
      "STORE_CONSTRAINT",
      "immutable replay-source provenance binding has no source",
    );
  }
  if (Number(row.missing_bindings) !== 0) {
    throw appError(
      "STORE_CONSTRAINT",
      "immutable replay source has no provenance binding",
    );
  }
  if (
    Number(row.orphan_evidence) !== 0 ||
    Number(row.orphan_bundles) !== 0 ||
    Number(row.orphan_decisions) !== 0
  ) {
    throw appError(
      "STORE_CONSTRAINT",
      "immutable replay source has no recording ledger fact",
    );
  }
  return Number(row.source_count);
}
