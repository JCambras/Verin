import type { SqlQueryable } from "@infra/store/db";
import type { DecisionRecorded } from "@contracts/decision-core/ledger";
import { appError } from "@contracts/errors";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";

export async function listReplayDecisionEvidenceCoverage(
  tx: SqlQueryable,
  tenant: TenantContext,
  event: DecisionRecorded,
  windowStart: number,
  decisionSequence: number,
): Promise<{
  readonly items: Array<{
    readonly id: string;
    readonly recordedSequence: number | null;
    readonly hasPrecedingRecording: boolean;
  }>;
  readonly complete: boolean;
}> {
  assertTenantContext(tenant);
  if (event.firmId !== tenant.orgId) {
    throw appError("VALIDATION", "ledger event tenant does not match authority");
  }
  const maximumInWindow = Math.max(0, decisionSequence - windowStart);
  const resultLimit = maximumInWindow + 1;
  const result = await tx.query<{
    evidence_snapshot_id: string;
    recorded_sequence: number | string | null;
  }>(
    `SELECT m.evidence_snapshot_id,
            recording.sequence AS recorded_sequence
       FROM decision_records r
       JOIN decision_input_bundle_evidence m
         ON m.org_id = r.org_id AND m.bundle_id = r.input_bundle_id
       LEFT JOIN LATERAL (
         SELECT l.sequence
           FROM decision_ledger l
          WHERE l.org_id = m.org_id
            AND l.evidence_snapshot_id = m.evidence_snapshot_id
            AND l.event_type = 'EvidenceSnapshotRecorded'
            AND l.sequence <= $3
          ORDER BY l.sequence DESC
          LIMIT 1
       ) recording ON TRUE
      WHERE r.org_id = $1 AND r.id = $2
      ORDER BY m.ordinal ASC
      LIMIT $4`,
    [
      event.firmId,
      event.decisionRef.id,
      decisionSequence,
      resultLimit,
    ],
  );
  const complete = result.rows.length <= maximumInWindow;
  return {
    complete,
    items: result.rows.slice(0, maximumInWindow).map((row) => {
      const latest = row.recorded_sequence === null
        ? null
        : Number(row.recorded_sequence);
      return {
        id: row.evidence_snapshot_id,
        recordedSequence:
          latest !== null && latest >= windowStart ? latest : null,
        hasPrecedingRecording: latest !== null,
      };
    }),
  };
}
