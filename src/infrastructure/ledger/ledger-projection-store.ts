/**
 * Derived decision state. Every row here is a cache of facts the immutable ledger
 * already states and is rebuilt by replaying it, so nothing in this module may be
 * the source of an answer the ledger does not contain.
 */
import type { SqlQueryable, SqlTx } from "@infra/store/db";
import { appError } from "@contracts/errors";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import {
  deriveArtifactProvenance,
  type DerivedProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { canonicalJson, type JsonValue } from "@contracts/decision-core/serialization";
import {
  foldDecisionProjection,
  type DecisionProjection,
} from "@domain/ledger/projections";

/**
 * A projection with the provenance of the fold that produced it. A projection is a
 * derived artifact, so its label comes from the LEAST trustworthy event folded into it
 * (ADR-0022), never the recording event alone - one synthetic approval, execution, or
 * status event makes the whole displayed state a demonstration.
 */
export interface ProjectedDecision {
  readonly projection: DecisionProjection;
  readonly provenance: DerivedProvenance;
}

export interface PreparedProjection {
  readonly event: LedgerEntry;
  readonly decisionId: string;
  readonly stateJson: string;
  readonly provenanceJson: string;
}

function decisionIdOf(event: LedgerEntry): string | undefined {
  if ("decisionRef" in event) return event.decisionRef.id;
  if ("priorDecisionRef" in event) return event.priorDecisionRef.id;
  return undefined;
}

async function resolveDecisionId(
  _tx: SqlTx,
  _orgId: string,
  event: LedgerEntry,
): Promise<string | undefined> {
  return decisionIdOf(event);
}

async function loadProjection(
  tx: SqlTx,
  orgId: string,
  event: LedgerEntry,
): Promise<{
  readonly decisionId: string;
  readonly state?: DecisionProjection;
  readonly provenance?: DerivedProvenance;
} | undefined> {
  const id = await resolveDecisionId(tx, orgId, event);
  if (!id) return undefined;
  const row = await tx.query<{ state_json: string; provenance_json: string }>(
    `SELECT state_json, provenance_json
       FROM decision_state_projection
      WHERE org_id = $1 AND decision_id = $2 FOR UPDATE`,
    [orgId, id],
  );
  return row.rows[0]
    ? {
        decisionId: id,
        state: JSON.parse(row.rows[0].state_json) as DecisionProjection,
        provenance: JSON.parse(row.rows[0].provenance_json) as DerivedProvenance,
      }
    : { decisionId: id };
}

async function assertReservationGeneration(
  tx: SqlTx,
  event: LedgerEntry,
  ownerDecisionId: string,
): Promise<void> {
  if (event.type === "ReservationCreated") {
    const active = await tx.query<{ decision_id: string }>(
      `SELECT decision_id FROM decision_reservation_index
        WHERE org_id = $1 AND reservation_id = $2 AND status = 'active'
        FOR UPDATE`,
      [event.firmId, event.reservationRef.id],
    );
    if (active.rows[0]) {
      throw appError(
        "STORE_CONSTRAINT",
        "reservation already has an active generation",
      );
    }
  } else if (event.type === "ReservationReleased") {
    const generation = await tx.query<{ decision_id: string }>(
      `SELECT decision_id FROM decision_reservation_index
        WHERE org_id = $1 AND reservation_id = $2 AND creation_entry_id = $3
        FOR UPDATE`,
      [
        event.firmId,
        event.reservationRef.id,
        event.reservationCreationRef.id,
      ],
    );
    if (!generation.rows[0]) {
      throw appError("STORE_CONSTRAINT", "reservation generation does not exist");
    }
    if (generation.rows[0].decision_id !== ownerDecisionId) {
      throw appError(
        "STORE_CONSTRAINT",
        "reservation generation belongs to another decision",
      );
    }
  }
}

async function writeReservationIndex(
  tx: SqlTx,
  projection: PreparedProjection,
  sequence: number,
): Promise<void> {
  const { event, decisionId } = projection;
  if (event.type === "ReservationCreated") {
    await tx.query(
      `INSERT INTO decision_reservation_index
        (org_id, reservation_id, decision_id, creation_entry_id,
         created_sequence, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [event.firmId, event.reservationRef.id, decisionId, event.id, sequence],
    );
  } else if (event.type === "ReservationReleased") {
    await tx.query(
      `UPDATE decision_reservation_index SET status = 'released'
        WHERE org_id = $1 AND reservation_id = $2 AND decision_id = $3
          AND creation_entry_id = $4`,
      [
        event.firmId,
        event.reservationRef.id,
        decisionId,
        event.reservationCreationRef.id,
      ],
    );
  }
}

async function prepareProjection(
  tx: SqlTx,
  tenant: TenantContext,
  event: LedgerEntry,
  sequence: number,
  provenance: RecordProvenance,
  record?: DecisionRecord,
): Promise<PreparedProjection | undefined> {
  assertTenantContext(tenant);
  if (event.firmId !== tenant.orgId) {
    throw appError("AUTH_FAILED", "projection event tenant does not match write authority");
  }
  const loaded = await loadProjection(tx, event.firmId, event);
  if (
    event.type !== "DecisionRecorded" &&
    decisionIdOf(event) !== undefined &&
    !loaded?.state
  ) {
    throw appError("STORE_CONSTRAINT", "decision projection is missing");
  }
  if (event.type === "ReservationReleased" && !loaded?.state) {
    throw appError("STORE_CONSTRAINT", "reservation owner projection is missing");
  }
  const next = foldDecisionProjection({
    ...(loaded?.state ? { current: loaded.state } : {}),
    event,
    sequence,
    ...(record ? { decisionRecord: record } : {}),
  });
  if (!next) return undefined;
  await assertReservationGeneration(tx, event, next.decisionId);
  const stateJson = canonicalJson(next as unknown as JsonValue);
  const nextProvenance = deriveArtifactProvenance(
    loaded?.provenance ? [loaded.provenance, provenance] : [provenance],
    loaded?.provenance && loaded.provenance.asOf > provenance.asOf
      ? loaded.provenance.asOf
      : provenance.asOf,
  );
  const provenanceJson = canonicalJson(nextProvenance as unknown as JsonValue);
  if (!stateJson.ok || !provenanceJson.ok) {
    throw appError("VALIDATION", "decision projection is not canonically serializable");
  }
  return {
    event,
    decisionId: next.decisionId,
    stateJson: stateJson.value,
    provenanceJson: provenanceJson.value,
  };
}

async function persistProjection(
  tx: SqlTx,
  tenant: TenantContext,
  projection: PreparedProjection | undefined,
  sequence: number,
): Promise<void> {
  assertTenantContext(tenant);
  if (!projection) return;
  if (projection.event.firmId !== tenant.orgId) {
    throw appError("AUTH_FAILED", "projection tenant does not match write authority");
  }
  await writeReservationIndex(tx, projection, sequence);
  await tx.query(
    `INSERT INTO decision_state_projection
      (org_id, decision_id, state_json, provenance_json, last_sequence, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (org_id, decision_id) DO UPDATE
       SET state_json = EXCLUDED.state_json,
           provenance_json = EXCLUDED.provenance_json,
           last_sequence = EXCLUDED.last_sequence,
           updated_at = EXCLUDED.updated_at`,
    [
      projection.event.firmId,
      projection.decisionId,
      projection.stateJson,
      projection.provenanceJson,
      sequence,
      projection.event.recordedAt,
    ],
  );
}

export async function applyProjection(
  tx: SqlTx,
  tenant: TenantContext,
  event: LedgerEntry,
  sequence: number,
  provenance: RecordProvenance,
  record?: DecisionRecord,
): Promise<void> {
  assertTenantContext(tenant);
  const projection = await prepareProjection(
    tx,
    tenant,
    event,
    sequence,
    provenance,
    record,
  );
  await persistProjection(tx, tenant, projection, sequence);
}

export async function validateProjection(
  tx: SqlTx,
  tenant: TenantContext,
  event: LedgerEntry,
  sequence: number,
  provenance: RecordProvenance,
  record?: DecisionRecord,
): Promise<void> {
  assertTenantContext(tenant);
  await prepareProjection(tx, tenant, event, sequence, provenance, record);
}

/** Discard derived state so a replay can rebuild it from immutable rows alone. */
export async function clearDerivedState(
  tx: SqlTx,
  tenant: TenantContext,
): Promise<void> {
  assertTenantContext(tenant);
  const orgId = tenant.orgId;
  await tx.query(
    "DELETE FROM decision_state_projection WHERE org_id = $1",
    [orgId],
  );
  await tx.query(
    "DELETE FROM decision_reservation_index WHERE org_id = $1",
    [orgId],
  );
  await tx.query(
    "DELETE FROM decision_projection_checkpoint WHERE org_id = $1",
    [orgId],
  );
}

/** How many decisions this tenant has derived state for, so a window can say so. */
export async function countDecisionProjections(
  db: SqlQueryable,
  tenant: TenantContext,
): Promise<number> {
  assertTenantContext(tenant);
  const rows = await db.query<{ n: number | string }>(
    "SELECT count(*) AS n FROM decision_state_projection WHERE org_id = $1",
    [tenant.orgId],
  );
  return Number(rows.rows[0]?.n ?? 0);
}

/**
 * Derived decision state, most recently active first, each row labeled with the
 * provenance of every event folded into it. `limit` bounds a request-path read; the
 * unbounded form is the replay/repair path. Ordering is total, so the online fold and
 * a later rebuild return the same list in the same order.
 */
export async function listDecisionProjections(
  db: SqlQueryable,
  tenant: TenantContext,
  limit?: number,
): Promise<ProjectedDecision[]> {
  assertTenantContext(tenant);
  const rows = await db.query<{
    state_json: string;
    provenance_json: string;
  }>(
    `SELECT state_json, provenance_json
       FROM decision_state_projection
      WHERE org_id = $1
      ORDER BY last_sequence DESC, decision_id ASC
      LIMIT $2::bigint`,
    [tenant.orgId, limit ?? null],
  );
  return rows.rows.map((row) => ({
    projection: JSON.parse(row.state_json) as DecisionProjection,
    provenance: JSON.parse(row.provenance_json) as DerivedProvenance,
  }));
}
