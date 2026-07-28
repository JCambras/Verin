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
  readonly payloadJson: string;
  readonly prevHash: string;
  readonly entryHash: string;
}

export interface LedgerVerificationLevel extends ChainVerdict {
  readonly level: "L1" | "L2" | "L3" | "L4";
}

export interface LedgerVerification {
  readonly ok: boolean;
  readonly entriesChecked: number;
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
  payload_json: string;
  prev_hash: string;
  entry_hash: string;
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
    payloadJson: row.payload_json,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
  };
}

export async function listDecisionLedger(
  db: SqlQueryable,
  orgId: string,
): Promise<DecisionLedgerRow[]> {
  const result = await db.query<DbLedgerRow>(
    "SELECT * FROM decision_ledger WHERE org_id = $1 ORDER BY sequence ASC",
    [orgId],
  );
  return result.rows.map(toRow);
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
      promotedEvidenceId(event) === row.evidenceSnapshotId;
    if (!matches) {
      return level("L3", false, index, row.sequence, "promoted column differs from canonical payload");
    }
  }
  return level("L3", true, rows.length, null, null);
}

function verifyL4(
  rows: readonly DecisionLedgerRow[],
  anchor: {
    max_sequence: number | string;
    entry_count: number | string;
    head_hash: string;
  } | undefined,
): LedgerVerificationLevel {
  if (rows.length === 0) {
    return anchor
      ? level("L4", false, 0, null, "anchor exists for an empty ledger")
      : level("L4", true, 0, null, null);
  }
  if (!anchor) return level("L4", false, rows.length, null, "ledger anchor is missing");
  const head = rows.at(-1)!;
  const matches =
    Number(anchor.entry_count) === rows.length &&
    Number(anchor.max_sequence) === head.sequence &&
    anchor.head_hash === head.entryHash;
  return matches
    ? level("L4", true, rows.length, null, null)
    : level("L4", false, rows.length, head.sequence, "ledger anchor count, sequence, or head hash differs");
}

function verifyRows(
  rows: readonly DecisionLedgerRow[],
  anchor: {
    max_sequence: number | string;
    entry_count: number | string;
    head_hash: string;
  } | undefined,
): LedgerVerification {
  const l1Raw = verifyStoredByteChain(rows.map((row) => ({
    sequence: row.sequence,
    canonicalBytes: row.payloadJson,
    prevHash: row.prevHash,
    entryHash: row.entryHash,
  })));
  const l1 = { ...l1Raw, level: "L1" as const };
  if (!l1.ok) return { ok: false, entriesChecked: l1.entriesChecked, levels: [l1] };
  const l2 = verifyL2(rows);
  if (!l2.verdict.ok) return { ok: false, entriesChecked: l2.verdict.entriesChecked, levels: [l1, l2.verdict] };
  const l3 = verifyL3(rows, l2.events);
  if (!l3.ok) return { ok: false, entriesChecked: l3.entriesChecked, levels: [l1, l2.verdict, l3] };
  const l4 = verifyL4(rows, anchor);
  return {
    ok: l4.ok,
    entriesChecked: rows.length,
    levels: [l1, l2.verdict, l3, l4],
  };
}

export async function verifyAndListDecisionLedger(
  db: SqlDb,
  orgId: string,
): Promise<{ verification: LedgerVerification; rows: DecisionLedgerRow[] }> {
  const snapshot = await db.transaction(async (tx) => {
    const rows = await listDecisionLedger(tx, orgId);
    const anchor = await tx.query<{
      max_sequence: number | string;
      entry_count: number | string;
      head_hash: string;
    }>(
      "SELECT max_sequence, entry_count, head_hash FROM decision_ledger_anchor WHERE org_id = $1",
      [orgId],
    );
    return { rows, anchor: anchor.rows[0] };
  });
  return {
    verification: verifyRows(snapshot.rows, snapshot.anchor),
    rows: snapshot.rows,
  };
}

export async function verifyDecisionLedger(
  db: SqlDb,
  orgId: string,
): Promise<LedgerVerification> {
  return (await verifyAndListDecisionLedger(db, orgId)).verification;
}
