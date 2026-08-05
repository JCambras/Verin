import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import type { DecisionInputBundle } from "@contracts/decision-core/evidence";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import { deriveDecisionReplayProvenance } from "@contracts/decision-core/replay-provenance";
import {
  parseRecordProvenance,
  type DerivedProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";

interface OriginRow {
  source_id: string;
  prov_source: string;
  prov_asof: string;
  prov_confidence: string;
}

export interface ReplaySourceOrigins {
  readonly snapshots: ReadonlyMap<string, RecordProvenance>;
  readonly bundles: ReadonlyMap<string, RecordProvenance>;
}

function parseOrigins(rows: readonly OriginRow[]): Map<string, RecordProvenance> {
  const origins = new Map<string, RecordProvenance>();
  for (const row of rows) {
    const provenance = parseRecordProvenance({
      source: row.prov_source,
      asOf: row.prov_asof,
      confidence: row.prov_confidence,
    });
    if (!provenance) {
      throw appError("STORE_CONSTRAINT", "replay source origin provenance is invalid");
    }
    origins.set(row.source_id, provenance);
  }
  return origins;
}

export async function loadReplaySourceOrigins(
  tx: SqlQueryable,
  tenant: TenantContext,
  evidenceIds: readonly string[],
  bundleIds: readonly string[],
): Promise<ReplaySourceOrigins> {
  assertTenantContext(tenant);
  let snapshots = new Map<string, RecordProvenance>();
  if (evidenceIds.length > 0) {
    const rows = await tx.query<OriginRow>(
      `SELECT DISTINCT ON (evidence_snapshot_id)
              evidence_snapshot_id AS source_id,
              prov_source, prov_asof, prov_confidence
         FROM decision_ledger
        WHERE org_id = $1
          AND event_type = 'EvidenceSnapshotRecorded'
          AND evidence_snapshot_id = ANY($2::text[])
        ORDER BY evidence_snapshot_id, sequence ASC`,
      [tenant.orgId, evidenceIds],
    );
    snapshots = parseOrigins(rows.rows);
  }
  let bundles = new Map<string, RecordProvenance>();
  if (bundleIds.length > 0) {
    const rows = await tx.query<OriginRow>(
      `SELECT DISTINCT ON (record.input_bundle_id)
              record.input_bundle_id AS source_id,
              ledger.prov_source, ledger.prov_asof, ledger.prov_confidence
         FROM decision_ledger ledger
         JOIN decision_records record
           ON record.org_id = ledger.org_id AND record.id = ledger.decision_id
        WHERE ledger.org_id = $1
          AND ledger.event_type = 'DecisionRecorded'
          AND record.input_bundle_id = ANY($2::text[])
        ORDER BY record.input_bundle_id, ledger.sequence ASC`,
      [tenant.orgId, bundleIds],
    );
    bundles = parseOrigins(rows.rows);
  }
  return { snapshots, bundles };
}

export async function deriveRecordedDecisionProvenance(
  tx: SqlQueryable,
  tenant: TenantContext,
  bundle: DecisionInputBundle,
  record: DecisionRecord,
  producer: RecordProvenance,
): Promise<DerivedProvenance> {
  assertTenantContext(tenant);
  const evidenceIds = bundle.evidenceSnapshotRefs.map((ref) => ref.id);
  const origins = await loadReplaySourceOrigins(
    tx,
    tenant,
    evidenceIds,
    [bundle.id],
  );
  return deriveDecisionReplayProvenance(
    bundle,
    record,
    evidenceIds.map((id) => origins.snapshots.get(id) ?? producer),
    origins.bundles.get(bundle.id) ?? producer,
    producer,
  );
}
