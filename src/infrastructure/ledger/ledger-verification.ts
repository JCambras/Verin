/**
 * Decision-ledger integrity verification. L1 hashes stored bytes, L2 dispatches
 * the recorded schema and serializer and checks canonical round-trip, L3 checks
 * promoted columns, and L4 checks the independently maintained anchor.
 */
import type { SqlDb, SqlQueryable, SqlTx } from "@infra/store/db";
import { appError, normalizeAppError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import { parseRecordProvenance } from "@contracts/provenance";
import {
  assertSameTenant,
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import {
  assertActionGrant,
  type ActionGrant,
} from "@contracts/authz";
import { parseRecordedLedgerEvent } from "./ledger-schema-registry";
import { lockDecisionLedgerTenant } from "./ledger-lock";
import {
  verifyReplaySources,
  type RecordedReplayEvent,
} from "./ledger-replay-loader";
import {
  applyProjection,
  clearDerivedState,
  listDecisionProjections,
  type ProjectedDecision,
} from "./ledger-projection-store";
import {
  verifyLedgerSnapshot,
  type DecisionLedgerRow,
  type LedgerSnapshot,
  type LedgerVerification,
} from "./ledger-verification-levels";

export type {
  DecisionLedgerRow,
  LedgerVerification,
} from "./ledger-verification-levels";

export interface DecisionLedgerIntegrityVerification {
  readonly ok: boolean;
  readonly ledger: LedgerVerification;
  readonly replaySourcesChecked: number;
  readonly replaySourceReason: string | null;
}

export interface RebuiltDecisionProjections {
  readonly entriesReplayed: number;
  readonly projections: readonly ProjectedDecision[];
}

interface DbLedgerRow extends PIIBearing {
  org_id: string;
  id: string;
  sequence: number | string;
  event_type: string;
  schema_version: string;
  serializer_version: string;
  occurred_at: string;
  recorded_at: string;
  actor_json: string;
  correlation_id: string;
  causation_id: string | null;
  decision_id: string | null;
  evidence_snapshot_id: string | null;
  triggering_entry_id: string | null;
  reservation_creation_id: string | null;
  payload_json: string;
  prev_hash: string;
  entry_hash: string;
  prov_source: string;
  prov_asof: string;
  prov_confidence: string;
}

type DbRegisterSnapshotRow = PIIBearing & {
  readonly tenant_id: string;
  readonly anchor_max_sequence: number | string | null;
  readonly anchor_entry_count: number | string | null;
  readonly anchor_head_hash: string | null;
} & {
  readonly [K in keyof DbLedgerRow]: DbLedgerRow[K] | null;
};

function hasLedgerRow(
  row: DbRegisterSnapshotRow,
): row is DbRegisterSnapshotRow & DbLedgerRow {
  return row.id !== null;
}

function toRow(row: DbLedgerRow): DecisionLedgerRow {
  return {
    orgId: row.org_id,
    id: row.id,
    sequence: Number(row.sequence),
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    serializerVersion: row.serializer_version,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actorJson: row.actor_json,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    decisionId: row.decision_id,
    evidenceSnapshotId: row.evidence_snapshot_id,
    triggeringEntryId: row.triggering_entry_id,
    reservationCreationId: row.reservation_creation_id,
    payloadJson: row.payload_json,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    provSource: row.prov_source,
    provAsOf: row.prov_asof,
    provConfidence: row.prov_confidence,
  };
}

async function listDecisionLedgerForTenant(
  db: SqlQueryable,
  tenant: TenantContext,
): Promise<DecisionLedgerRow[]> {
  assertTenantContext(tenant);
  const result = await db.query<DbLedgerRow>(
    "SELECT * FROM decision_ledger WHERE org_id = $1 ORDER BY sequence ASC",
    [tenant.orgId],
  );
  return result.rows.map(toRow);
}

export async function verifyAndListDecisionLedger(
  db: SqlDb,
  exportGrant: ActionGrant<"audit.export">,
  piiGrant: ActionGrant<"pii.view">,
  window?: number,
): Promise<{ verification: LedgerVerification; rows: DecisionLedgerRow[] }> {
  assertActionGrant(exportGrant, "audit.export");
  assertActionGrant(piiGrant, "pii.view");
  assertSameTenant(exportGrant.tenant, piiGrant.tenant);
  const tenant = exportGrant.tenant;
  const captured = await db.query<DbRegisterSnapshotRow>(
    `SELECT tenant.id AS tenant_id,
            anchor.max_sequence AS anchor_max_sequence,
            anchor.entry_count AS anchor_entry_count,
            anchor.head_hash AS anchor_head_hash,
            ledger.*
       FROM orgs tenant
       LEFT JOIN decision_ledger_anchor anchor ON anchor.org_id = tenant.id
       LEFT JOIN decision_ledger ledger ON ledger.org_id = tenant.id
      WHERE tenant.id = $1
      ORDER BY ledger.sequence ASC`,
    [tenant.orgId],
  );
  const first = captured.rows[0];
  if (!first) throw appError("NOT_FOUND", "decision ledger tenant does not exist");
  const verificationRows = captured.rows.filter(hasLedgerRow).map(toRow);
  const stored = verificationRows.length;
  const headSequence = verificationRows.at(-1)?.sequence ?? null;
  const anchor = first.anchor_max_sequence === null ||
      first.anchor_entry_count === null || first.anchor_head_hash === null
    ? undefined
    : {
        max_sequence: first.anchor_max_sequence,
        entry_count: first.anchor_entry_count,
        head_hash: first.anchor_head_hash,
      };
  const snapshot: LedgerSnapshot = {
    anchor,
    stored,
    headSequence,
    rows: verificationRows,
  };
  const rows = window !== undefined && window > 0 && stored > window
    ? verificationRows.slice(-window)
    : verificationRows;
  return {
    verification: await verifyLedgerSnapshot(db, tenant, snapshot),
    rows,
  };
}

async function verifySnapshotTransaction(
  tx: SqlTx,
  tenant: TenantContext,
): Promise<{ verification: LedgerVerification; rows: DecisionLedgerRow[] }> {
  assertTenantContext(tenant);
  const orgId = tenant.orgId;
  await lockDecisionLedgerTenant(tx, tenant);
  const totals = await tx.query<{ n: number | string; head: number | string | null }>(
    "SELECT count(*) AS n, max(sequence) AS head FROM decision_ledger WHERE org_id = $1",
    [orgId],
  );
  const stored = Number(totals.rows[0]?.n ?? 0);
  const headRaw = totals.rows[0]?.head;
  const headSequence = headRaw === null || headRaw === undefined
    ? null
    : Number(headRaw);
  const anchor = await tx.query<{
    max_sequence: number | string;
    entry_count: number | string;
    head_hash: string;
  }>(
    "SELECT max_sequence, entry_count, head_hash FROM decision_ledger_anchor WHERE org_id = $1",
    [orgId],
  );
  const base = { anchor: anchor.rows[0], stored, headSequence };
  const verificationRows = await listDecisionLedgerForTenant(tx, tenant);
  const snapshot: LedgerSnapshot = {
    ...base,
    rows: verificationRows,
  };
  return {
    verification: await verifyLedgerSnapshot(tx, tenant, snapshot),
    rows: verificationRows,
  };
}

function parseReplayEvents(
  rows: readonly DecisionLedgerRow[],
): RecordedReplayEvent[] {
  return rows.map((row) => {
    let value: unknown;
    try {
      value = JSON.parse(row.payloadJson);
    } catch {
      throw appError("STORE_CONSTRAINT", "ledger replay payload is not JSON");
    }
    const parsed = parseRecordedLedgerEvent(
      row.eventType,
      row.schemaVersion,
      row.serializerVersion,
      value,
    );
    if (!parsed.ok) throw appError("STORE_CONSTRAINT", parsed.reason);
    const provenance = parseRecordProvenance({
      source: row.provSource,
      asOf: row.provAsOf,
      confidence: row.provConfidence,
    });
    if (!provenance) {
      throw appError("STORE_CONSTRAINT", "ledger replay provenance is invalid");
    }
    return { event: parsed.event, sequence: row.sequence, provenance };
  });
}

async function verifyDecisionLedgerReplayTransaction(
  tx: SqlTx,
  tenant: TenantContext,
): Promise<{
  verification: LedgerVerification;
  entries: RecordedReplayEvent[];
}> {
  assertTenantContext(tenant);
  const checked = await verifySnapshotTransaction(tx, tenant);
  return {
    verification: checked.verification,
    entries: checked.verification.ok ? parseReplayEvents(checked.rows) : [],
  };
}

export async function rebuildDecisionProjections(
  db: SqlDb,
  tenant: TenantContext,
): Promise<RebuiltDecisionProjections> {
  assertTenantContext(tenant);
  return db.transaction(async (tx) => {
    const checked = await verifyDecisionLedgerReplayTransaction(tx, tenant);
    if (!checked.verification.ok) {
      throw appError(
        "STORE_CONSTRAINT",
        `decision ledger integrity failed at ${checked.verification.levels.at(-1)?.level ?? "unknown"}`,
      );
    }
    const sources = await verifyReplaySources(tx, tenant, checked.entries);
    await clearDerivedState(tx, tenant);
    for (const item of checked.entries) {
      const source = item.event.type === "DecisionRecorded"
        ? sources.decisions.get(item.event.decisionRef.id)
        : undefined;
      await applyProjection(
        tx,
        tenant,
        item.event,
        item.sequence,
        source?.provenance ?? item.provenance,
        source?.record,
      );
    }
    return {
      entriesReplayed: checked.entries.length,
      projections: await listDecisionProjections(tx, tenant),
    };
  });
}

export async function verifyDecisionLedgerIntegrity(
  db: SqlDb,
  tenant: TenantContext,
): Promise<DecisionLedgerIntegrityVerification> {
  assertTenantContext(tenant);
  return db.transaction(async (tx) => {
    const checked = await verifyDecisionLedgerReplayTransaction(tx, tenant);
    if (!checked.verification.ok) {
      return {
        ok: false,
        ledger: checked.verification,
        replaySourcesChecked: 0,
        replaySourceReason: "decision ledger chain does not verify",
      };
    }
    try {
      const sources = await verifyReplaySources(tx, tenant, checked.entries);
      return {
        ok: true,
        ledger: checked.verification,
        replaySourcesChecked: sources.sourcesChecked,
        replaySourceReason: null,
      };
    } catch (error: unknown) {
      const normalized = normalizeAppError(error, "trusted-only");
      if (normalized?.code !== "STORE_CONSTRAINT") throw error;
      return {
        ok: false,
        ledger: checked.verification,
        replaySourcesChecked: 0,
        replaySourceReason: normalized.message,
      };
    }
  });
}
