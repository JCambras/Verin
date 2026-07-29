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
       SELECT 'evidence' AS source_kind, id AS source_id
         FROM evidence_snapshots WHERE org_id = $1
       UNION ALL
       SELECT 'bundle', id
         FROM decision_input_bundles WHERE org_id = $1
       UNION ALL
       SELECT 'decision', id
         FROM decision_records WHERE org_id = $1
     )
     SELECT
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
       (SELECT count(*) FROM decision_replay_source_provenance binding
         WHERE binding.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM bindable_sources source
            WHERE source.source_kind = binding.source_kind
              AND source.source_id = binding.source_id
         )) AS orphan_bindings,
       (SELECT count(*) FROM bindable_sources source
         WHERE NOT EXISTS (
           SELECT 1 FROM decision_replay_source_provenance binding
            WHERE binding.org_id = $1
              AND binding.source_kind = source.source_kind
              AND binding.source_id = source.source_id
         )) AS missing_bindings,
       (SELECT count(*) FROM evidence_snapshots WHERE org_id = $1) +
       (SELECT count(*) FROM decision_input_bundles WHERE org_id = $1) +
       (SELECT count(*) FROM decision_input_bundle_evidence WHERE org_id = $1) +
       (SELECT count(*) FROM decision_records WHERE org_id = $1) AS source_count`,
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
