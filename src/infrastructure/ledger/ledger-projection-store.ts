/**
 * Derived decision state. Every row here is a cache of facts the immutable ledger
 * already states and is rebuilt by replaying it, so nothing in this module may be
 * the source of an answer the ledger does not contain.
 */
import type { SqlDb, SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import { deriveArtifactProvenance, type Confidence, type DerivedProvenance, type RecordProvenance, type SourceSystem } from "@contracts/provenance";
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

function decisionIdOf(event: LedgerEntry): string | undefined {
  if ("decisionRef" in event) return event.decisionRef.id;
  if ("priorDecisionRef" in event) return event.priorDecisionRef.id;
  return undefined;
}

/**
 * A reservation names its decision only when it is created, so a release resolves
 * its owner through the indexed mapping - never by scanning projections in physical
 * row order, which is not stable across rewrites and would make the online fold and
 * a later rebuild disagree.
 */
async function resolveDecisionId(
  tx: SqlQueryable,
  orgId: string,
  event: LedgerEntry,
): Promise<string | undefined> {
  const direct = decisionIdOf(event);
  if (direct) return direct;
  if (event.type !== "ReservationReleased") return undefined;
  const row = await tx.query<{ decision_id: string }>(
    "SELECT decision_id FROM decision_reservation_index WHERE org_id = $1 AND reservation_id = $2",
    [orgId, event.reservationRef.id],
  );
  return row.rows[0]?.decision_id;
}

async function loadProjection(
  tx: SqlQueryable,
  orgId: string,
  event: LedgerEntry,
): Promise<DecisionProjection | undefined> {
  const id = await resolveDecisionId(tx, orgId, event);
  if (!id) return undefined;
  const row = await tx.query<{ state_json: string }>(
    "SELECT state_json FROM decision_state_projection WHERE org_id = $1 AND decision_id = $2",
    [orgId, id],
  );
  return row.rows[0]
    ? JSON.parse(row.rows[0].state_json) as DecisionProjection
    : undefined;
}

/** One live reservation belongs to one decision; a competing live claim is refused. */
async function indexReservation(
  tx: SqlQueryable,
  event: LedgerEntry,
  ownerDecisionId: string,
): Promise<void> {
  if (event.type === "ReservationCreated") {
    const claimed = await tx.query<{ decision_id: string }>(
      `INSERT INTO decision_reservation_index
        (org_id, reservation_id, decision_id, status)
       VALUES ($1,$2,$3,'active')
       ON CONFLICT (org_id, reservation_id) DO UPDATE
         SET decision_id = EXCLUDED.decision_id, status = 'active'
         WHERE decision_reservation_index.decision_id = EXCLUDED.decision_id
            OR decision_reservation_index.status = 'released'
       RETURNING decision_id`,
      [event.firmId, event.reservationRef.id, ownerDecisionId],
    );
    if (claimed.rows.length === 0) {
      throw appError(
        "STORE_CONSTRAINT",
        "reservation is already held live by another decision",
      );
    }
    return;
  }
  if (event.type === "ReservationReleased") {
    await tx.query(
      `UPDATE decision_reservation_index SET status = 'released'
        WHERE org_id = $1 AND reservation_id = $2`,
      [event.firmId, event.reservationRef.id],
    );
  }
}

/** Fold one appended event into derived state, stamped with its ledger sequence. */
export async function applyProjection(
  tx: SqlQueryable,
  event: LedgerEntry,
  sequence: number,
  record?: DecisionRecord,
): Promise<void> {
  const current = await loadProjection(tx, event.firmId, event);
  const next = foldDecisionProjection({
    ...(current ? { current } : {}),
    event,
    sequence,
    ...(record ? { decisionRecord: record } : {}),
  });
  if (!next) return;
  await indexReservation(tx, event, next.decisionId);
  const stateJson = canonicalJson(next as unknown as JsonValue);
  if (!stateJson.ok) {
    throw appError("VALIDATION", "decision projection is not canonically serializable");
  }
  await tx.query(
    `INSERT INTO decision_state_projection
      (org_id, decision_id, state_json, last_sequence, updated_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (org_id, decision_id) DO UPDATE
       SET state_json = EXCLUDED.state_json,
           last_sequence = EXCLUDED.last_sequence,
           updated_at = EXCLUDED.updated_at`,
    [event.firmId, next.decisionId, stateJson.value, sequence, event.recordedAt],
  );
}

/** Discard derived state so a replay can rebuild it from immutable rows alone. */
export async function clearDerivedState(
  tx: SqlQueryable,
  orgId: string,
): Promise<void> {
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
  db: SqlDb,
  orgId: string,
): Promise<number> {
  const rows = await db.query<{ n: number | string }>(
    "SELECT count(*) AS n FROM decision_state_projection WHERE org_id = $1",
    [orgId],
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
  db: SqlDb,
  orgId: string,
  limit?: number,
): Promise<ProjectedDecision[]> {
  const rows = await db.query<{
    decision_id: string;
    state_json: string;
    prov_source: string;
    prov_asof: string;
    prov_confidence: string;
  }>(
    `WITH windowed AS (
       SELECT decision_id, state_json, last_sequence
         FROM decision_state_projection
        WHERE org_id = $1
        ORDER BY last_sequence DESC, decision_id ASC
        LIMIT $2::bigint
     )
     SELECT w.decision_id, w.state_json,
            l.prov_source, l.prov_asof, l.prov_confidence
       FROM windowed w
       JOIN decision_ledger l
         ON l.org_id = $1 AND l.decision_id = w.decision_id
      ORDER BY w.last_sequence DESC, w.decision_id ASC, l.sequence ASC`,
    [orgId, limit ?? null],
  );
  const folded = new Map<string, { state: string; inputs: RecordProvenance[] }>();
  for (const row of rows.rows) {
    const entry = folded.get(row.decision_id) ?? { state: row.state_json, inputs: [] };
    entry.inputs.push({
      source: row.prov_source as SourceSystem,
      asOf: row.prov_asof,
      confidence: row.prov_confidence as Confidence,
    });
    folded.set(row.decision_id, entry);
  }
  return [...folded.values()].map(({ state, inputs }) => ({
    projection: JSON.parse(state) as DecisionProjection,
    provenance: deriveArtifactProvenance(
      inputs,
      inputs.reduce((latest, input) =>
        input.asOf > latest ? input.asOf : latest, inputs[0]!.asOf),
    ),
  }));
}
