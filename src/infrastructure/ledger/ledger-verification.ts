/**
 * Decision-ledger integrity verification. L1 hashes stored bytes, L2 dispatches
 * the recorded schema and serializer and checks canonical round-trip, L3 checks
 * promoted columns, and L4 checks the independently maintained anchor.
 */
import type { SqlDb, SqlQueryable } from "@infra/store/db";
import { type LedgerEntry } from "@contracts/decision-core/ledger";
import {
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import {
  verifyStoredByteChain,
  type ChainVerdict,
} from "@infra/audit/hash-chain";
import { parseRecordedLedgerEvent } from "./ledger-schema-registry";

export interface DecisionLedgerRow {
  readonly orgId: string;
  readonly id: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly schemaVersion: string;
  readonly serializerVersion: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly actorJson: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly decisionId: string | null;
  readonly evidenceSnapshotId: string | null;
  readonly triggeringEntryId: string | null;
  readonly payloadJson: string;
  readonly prevHash: string;
  readonly entryHash: string;
  readonly provSource: string;
}

export interface LedgerVerificationLevel extends ChainVerdict {
  readonly level: "L1" | "L2" | "L3" | "L4";
}

export interface LedgerVerification {
  readonly ok: boolean;
  readonly entriesChecked: number;
  /** Entries stored for the tenant; larger than `entriesChecked` on a windowed run. */
  readonly entriesStored: number;
  readonly levels: readonly LedgerVerificationLevel[];
}

interface DbLedgerRow {
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
  payload_json: string;
  prev_hash: string;
  entry_hash: string;
  prov_source: string;
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
    payloadJson: row.payload_json,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    provSource: row.prov_source,
  };
}

/** Ordered by sequence. `tail` reads only the most recent N entries. */
export async function listDecisionLedger(
  db: SqlQueryable,
  orgId: string,
  tail?: number,
): Promise<DecisionLedgerRow[]> {
  if (tail === undefined) {
    const result = await db.query<DbLedgerRow>(
      "SELECT * FROM decision_ledger WHERE org_id = $1 ORDER BY sequence ASC",
      [orgId],
    );
    return result.rows.map(toRow);
  }
  const result = await db.query<DbLedgerRow>(
    "SELECT * FROM decision_ledger WHERE org_id = $1 ORDER BY sequence DESC LIMIT $2",
    [orgId, tail],
  );
  return result.rows.map(toRow).reverse();
}

function level(
  name: LedgerVerificationLevel["level"],
  ok: boolean,
  checked: number,
  sequence: number | null,
  reason: string | null,
): LedgerVerificationLevel {
  return {
    level: name,
    ok,
    entriesChecked: checked,
    brokenAtSequence: sequence,
    reason,
  };
}

function promotedDecisionId(event: LedgerEntry): string | null {
  if ("decisionRef" in event) return event.decisionRef.id;
  if ("priorDecisionRef" in event) return event.priorDecisionRef.id;
  return null;
}

function promotedEvidenceId(event: LedgerEntry): string | null {
  if (event.type === "EvidenceSnapshotRecorded") {
    return event.evidenceSnapshotRef.id;
  }
  if (event.type === "StatusObserved") {
    return event.evidenceSnapshotRef?.id ?? null;
  }
  return null;
}

function promotedTriggeringEntryId(event: LedgerEntry): string | null {
  return event.type === "ExceptionDecisionRequested"
    ? event.triggeringEntryRef.id
    : null;
}

function verifyL2(
  rows: readonly DecisionLedgerRow[],
): { verdict: LedgerVerificationLevel; events: LedgerEntry[] } {
  const events: LedgerEntry[] = [];
  for (const row of rows) {
    let unknown: unknown;
    try {
      unknown = JSON.parse(row.payloadJson);
    } catch {
      return {
        verdict: level("L2", false, events.length, row.sequence, "payload_json is not JSON"),
        events,
      };
    }
    const parsed = parseRecordedLedgerEvent(
      row.eventType,
      row.schemaVersion,
      row.serializerVersion,
      unknown,
    );
    if (!parsed.ok) {
      return {
        verdict: level("L2", false, events.length, row.sequence, parsed.reason),
        events,
      };
    }
    const canonical = canonicalJson(parsed.event as unknown as JsonValue);
    if (!canonical.ok || canonical.value !== row.payloadJson) {
      return {
        verdict: level("L2", false, events.length, row.sequence, "payload bytes are not canonical for the recorded serializer"),
        events,
      };
    }
    events.push(parsed.event);
  }
  return { verdict: level("L2", true, rows.length, null, null), events };
}

function verifyL3(
  rows: readonly DecisionLedgerRow[],
  events: readonly LedgerEntry[],
): LedgerVerificationLevel {
  for (let index = 0; index < events.length; index += 1) {
    const row = rows[index]!;
    const event = events[index]!;
    const actor = canonicalJson(event.actor as unknown as JsonValue);
    const matches =
      event.firmId === row.orgId &&
      event.id === row.id &&
      event.type === row.eventType &&
      event.schemaVersion === row.schemaVersion &&
      event.serializerVersion === row.serializerVersion &&
      event.occurredAt === row.occurredAt &&
      event.recordedAt === row.recordedAt &&
      actor.ok &&
      actor.value === row.actorJson &&
      event.correlationId === row.correlationId &&
      (event.causationRef?.id ?? null) === row.causationId &&
      promotedDecisionId(event) === row.decisionId &&
      promotedEvidenceId(event) === row.evidenceSnapshotId &&
      promotedTriggeringEntryId(event) === row.triggeringEntryId;
    if (!matches) {
      return level("L3", false, index, row.sequence, "promoted column differs from canonical payload");
    }
  }
  return level("L3", true, rows.length, null, null);
}

interface AnchorRow {
  max_sequence: number | string;
  entry_count: number | string;
  head_hash: string;
}

interface LedgerSnapshot {
  readonly rows: DecisionLedgerRow[];
  readonly anchor: AnchorRow | undefined;
  readonly stored: number;
  readonly headSequence: number | null;
  readonly start: { sequence: number; prevHash: string } | undefined;
}

/** The anchor is tenant-wide, so L4 compares it with the stored totals, never the window. */
function verifyL4(
  snapshot: LedgerSnapshot,
  checked: number,
): LedgerVerificationLevel {
  const { anchor, rows, stored, headSequence } = snapshot;
  if (stored === 0) {
    return anchor
      ? level("L4", false, 0, null, "anchor exists for an empty ledger")
      : level("L4", true, 0, null, null);
  }
  if (!anchor) return level("L4", false, checked, null, "ledger anchor is missing");
  const head = rows.at(-1);
  const matches =
    Number(anchor.entry_count) === stored &&
    Number(anchor.max_sequence) === headSequence &&
    (!head || anchor.head_hash === head.entryHash);
  return matches
    ? level("L4", true, checked, null, null)
    : level("L4", false, checked, headSequence, "ledger anchor count, sequence, or head hash differs");
}

function verifyRows(snapshot: LedgerSnapshot): LedgerVerification {
  const { rows, stored } = snapshot;
  const l1Raw = verifyStoredByteChain(rows.map((row) => ({
    sequence: row.sequence,
    canonicalBytes: row.payloadJson,
    prevHash: row.prevHash,
    entryHash: row.entryHash,
  })), snapshot.start);
  const l1 = { ...l1Raw, level: "L1" as const };
  const fail = (levels: LedgerVerificationLevel[]): LedgerVerification => ({
    ok: false,
    entriesChecked: levels.at(-1)!.entriesChecked,
    entriesStored: stored,
    levels,
  });
  if (!l1.ok) return fail([l1]);
  const l2 = verifyL2(rows);
  if (!l2.verdict.ok) return fail([l1, l2.verdict]);
  const l3 = verifyL3(rows, l2.events);
  if (!l3.ok) return fail([l1, l2.verdict, l3]);
  const l4 = verifyL4(snapshot, rows.length);
  return {
    ok: l4.ok,
    entriesChecked: rows.length,
    entriesStored: stored,
    levels: [l1, l2.verdict, l3, l4],
  };
}

/**
 * Reading and verifying the whole chain is O(entries) work under the store's single
 * connection, so callers on a request path pass `window` to verify the most recent
 * entries against the stored hash of their predecessor. The unbounded form stays the
 * examiner-grade check and is what the audit-chain-verify gate runs.
 */
export async function verifyAndListDecisionLedger(
  db: SqlDb,
  orgId: string,
  window?: number,
): Promise<{ verification: LedgerVerification; rows: DecisionLedgerRow[] }> {
  const snapshot = await db.transaction(async (tx) => {
    const totals = await tx.query<{ n: number | string; head: number | string | null }>(
      "SELECT count(*) AS n, max(sequence) AS head FROM decision_ledger WHERE org_id = $1",
      [orgId],
    );
    const stored = Number(totals.rows[0]?.n ?? 0);
    const headRaw = totals.rows[0]?.head;
    const headSequence = headRaw === null || headRaw === undefined ? null : Number(headRaw);
    const anchor = await tx.query<AnchorRow>(
      "SELECT max_sequence, entry_count, head_hash FROM decision_ledger_anchor WHERE org_id = $1",
      [orgId],
    );
    const base = { anchor: anchor.rows[0], stored, headSequence };
    if (window === undefined || window < 1 || stored <= window) {
      return { ...base, rows: await listDecisionLedger(tx, orgId), start: undefined };
    }
    const rows = await listDecisionLedger(tx, orgId, window);
    const first = rows[0]!;
    const predecessor = await tx.query<{ entry_hash: string }>(
      "SELECT entry_hash FROM decision_ledger WHERE org_id = $1 AND sequence = $2",
      [orgId, first.sequence - 1],
    );
    return {
      ...base,
      rows,
      start: {
        sequence: first.sequence,
        prevHash: predecessor.rows[0]?.entry_hash ?? "",
      },
    };
  });
  return { verification: verifyRows(snapshot), rows: snapshot.rows };
}

export async function verifyDecisionLedger(
  db: SqlDb,
  orgId: string,
): Promise<LedgerVerification> {
  return (await verifyAndListDecisionLedger(db, orgId)).verification;
}
