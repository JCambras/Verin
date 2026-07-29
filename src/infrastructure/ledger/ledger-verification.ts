/**
 * Decision-ledger integrity verification. L1 hashes stored bytes, L2 dispatches
 * the recorded schema and serializer and checks canonical round-trip, L3 checks
 * promoted columns, and L4 checks the independently maintained anchor.
 */
import type { SqlDb, SqlQueryable, SqlTx } from "@infra/store/db";
import { appError, isAppError } from "@contracts/errors";
import { type LedgerEntry } from "@contracts/decision-core/ledger";
import {
  promotedDecisionId,
  promotedEvidenceSnapshotId,
  promotedReservationCreationId,
  promotedTriggeringEntryId,
} from "@contracts/decision-core/ledger-references";
import {
  verifyStoredByteChain,
  type ChainVerdict,
} from "@infra/audit/hash-chain";
import {
  canonicalizeRecordedLedgerValue,
  decisionLedgerChainPreimage,
  parseRecordedLedgerEvent,
} from "./ledger-schema-registry";
import { lockDecisionLedgerTenant } from "./ledger-lock";
import { verifyReplaySources } from "./ledger-sources";
import { storedLedgerStructureLookup } from "./ledger-structural-store";
import { assertRecordedLedgerStructure } from "./ledger-structural-validator";

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
  readonly inputBundleId: string | null;
  readonly expectedInputBundleId: string | null;
  readonly triggeringEntryId: string | null;
  readonly reservationCreationId: string | null;
  readonly payloadJson: string;
  readonly prevHash: string;
  readonly entryHash: string;
  readonly provSource: string;
  readonly provAsOf: string;
  readonly provConfidence: string;
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

export interface DecisionLedgerIntegrityVerification {
  readonly ok: boolean;
  readonly ledger: LedgerVerification;
  readonly replaySourcesChecked: number;
  readonly replaySourceReason: string | null;
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
  input_bundle_id: string | null;
  expected_input_bundle_id: string | null;
  triggering_entry_id: string | null;
  reservation_creation_id: string | null;
  payload_json: string;
  prev_hash: string;
  entry_hash: string;
  prov_source: string;
  prov_asof: string;
  prov_confidence: string;
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
    inputBundleId: row.input_bundle_id,
    expectedInputBundleId: row.expected_input_bundle_id,
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

/** Ordered by sequence. `tail` reads only the most recent N entries. */
export async function listDecisionLedger(
  db: SqlQueryable,
  orgId: string,
  tail?: number,
): Promise<DecisionLedgerRow[]> {
  if (tail === undefined) {
    const result = await db.query<DbLedgerRow>(
      `SELECT ledger.*, record.input_bundle_id AS expected_input_bundle_id
         FROM decision_ledger ledger
         LEFT JOIN decision_records record
           ON record.org_id = ledger.org_id
          AND record.id = ledger.decision_id
        WHERE ledger.org_id = $1
        ORDER BY ledger.sequence ASC`,
      [orgId],
    );
    return result.rows.map(toRow);
  }
  const result = await db.query<DbLedgerRow>(
    `SELECT ledger.*, record.input_bundle_id AS expected_input_bundle_id
       FROM decision_ledger ledger
       LEFT JOIN decision_records record
         ON record.org_id = ledger.org_id
        AND record.id = ledger.decision_id
      WHERE ledger.org_id = $1
      ORDER BY ledger.sequence DESC
      LIMIT $2`,
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
    if (parsed.canonicalBytes !== row.payloadJson) {
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
    const actor = canonicalizeRecordedLedgerValue(
      row.schemaVersion,
      row.serializerVersion,
      event.actor,
    );
    const matches =
      event.firmId === row.orgId &&
      event.id === row.id &&
      event.type === row.eventType &&
      event.schemaVersion === row.schemaVersion &&
      event.serializerVersion === row.serializerVersion &&
      event.occurredAt === row.occurredAt &&
      event.recordedAt === row.recordedAt &&
      actor === row.actorJson &&
      event.correlationId === row.correlationId &&
      (event.causationRef?.id ?? null) === row.causationId &&
      promotedDecisionId(event) === row.decisionId &&
      promotedEvidenceSnapshotId(event) === row.evidenceSnapshotId &&
      row.inputBundleId === (
        event.type === "DecisionRecorded"
          ? row.expectedInputBundleId
          : null
      ) &&
      promotedTriggeringEntryId(event) === row.triggeringEntryId &&
      promotedReservationCreationId(event) === row.reservationCreationId;
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
    if (anchor) {
      return level("L4", false, 0, null, "anchor exists for an empty ledger");
    }
    return rows.length === 0
      ? level("L4", true, 0, null, null)
      : level("L4", false, 0, null, "ledger rows exist without an anchor");
  }
  if (!anchor) return level("L4", false, checked, null, "ledger anchor is missing");
  const head = rows.at(-1);
  const matches =
    Number(anchor.entry_count) === stored &&
    Number(anchor.max_sequence) === headSequence &&
    headSequence !== null &&
    stored === headSequence + 1 &&
    head?.sequence === headSequence &&
    anchor.head_hash === head.entryHash;
  return matches
    ? level("L4", true, checked, null, null)
    : level("L4", false, checked, headSequence, "ledger anchor count, sequence, or head hash differs");
}

function verifyRows(snapshot: LedgerSnapshot): LedgerVerification {
  const { rows, stored } = snapshot;
  const chainRows = [];
  for (const row of rows) {
    const preimage = decisionLedgerChainPreimage(
      row.schemaVersion,
      row.serializerVersion,
      row.payloadJson,
      {
        source: row.provSource,
        asOf: row.provAsOf,
        confidence: row.provConfidence,
      },
    );
    if (!preimage) {
      const l1 = level(
        "L1",
        false,
        chainRows.length,
        row.sequence,
        "ledger chain preimage or provenance is unsupported",
      );
      return {
        ok: false,
        entriesChecked: l1.entriesChecked,
        entriesStored: stored,
        levels: [l1],
      };
    }
    chainRows.push({
      sequence: row.sequence,
      canonicalBytes: preimage,
      prevHash: row.prevHash,
      entryHash: row.entryHash,
    });
  }
  const l1Raw = verifyStoredByteChain(chainRows, snapshot.start);
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
 * entries against the stored hash of their predecessor. The audit-chain-verify gate
 * runs the unbounded integrity form.
 */
export async function verifyAndListDecisionLedger(
  db: SqlDb,
  orgId: string,
  window?: number,
): Promise<{ verification: LedgerVerification; rows: DecisionLedgerRow[] }> {
  return db.transaction((tx) =>
    verifyDecisionLedgerTransaction(tx, orgId, window));
}

export async function verifyDecisionLedgerTransaction(
  tx: SqlTx,
  orgId: string,
  window?: number,
): Promise<{ verification: LedgerVerification; rows: DecisionLedgerRow[] }> {
  await lockDecisionLedgerTenant(tx, orgId, "verify");
  const anchor = await tx.query<AnchorRow>(
    "SELECT max_sequence, entry_count, head_hash FROM decision_ledger_anchor WHERE org_id = $1",
    [orgId],
  );
  const anchorRow = anchor.rows[0];
  const bounded = window !== undefined && Number.isInteger(window) && window > 0;
  let snapshot: LedgerSnapshot;
  if (!bounded) {
    const totals = await tx.query<{
      n: number | string;
      head: number | string | null;
    }>(
      "SELECT count(*) AS n, max(sequence) AS head FROM decision_ledger WHERE org_id = $1",
      [orgId],
    );
    const headRaw = totals.rows[0]?.head;
    snapshot = {
      anchor: anchorRow,
      stored: Number(totals.rows[0]?.n ?? 0),
      headSequence: headRaw === null || headRaw === undefined
        ? null
        : Number(headRaw),
      rows: await listDecisionLedger(tx, orgId),
      start: undefined,
    };
  } else {
    const rows = await listDecisionLedger(tx, orgId, window);
    const first = rows[0]!;
    const predecessor = first && first.sequence > 0
      ? await tx.query<{ entry_hash: string }>(
          "SELECT entry_hash FROM decision_ledger WHERE org_id = $1 AND sequence = $2",
          [orgId, first.sequence - 1],
        )
      : undefined;
    snapshot = {
      anchor: anchorRow,
      stored: Number(anchorRow?.entry_count ?? 0),
      headSequence: anchorRow === undefined
        ? null
        : Number(anchorRow.max_sequence),
      rows,
      start: predecessor === undefined
        ? undefined
        : {
            sequence: first.sequence,
            prevHash: predecessor.rows[0]?.entry_hash ?? "",
          },
    };
  }
  return {
    verification: verifyRows(snapshot),
    rows: snapshot.rows,
  };
}

export async function verifyDecisionLedger(
  db: SqlDb,
  orgId: string,
): Promise<LedgerVerification> {
  return (await verifyAndListDecisionLedger(db, orgId)).verification;
}

export async function verifyDecisionLedgerIntegrity(
  db: SqlDb,
  orgId: string,
): Promise<DecisionLedgerIntegrityVerification> {
  return db.transaction(async (tx) => {
    const checked = await verifyDecisionLedgerTransaction(tx, orgId);
    if (!checked.verification.ok) {
      return {
        ok: false,
        ledger: checked.verification,
        replaySourcesChecked: 0,
        replaySourceReason: "decision ledger chain does not verify",
      };
    }
    const events: LedgerEntry[] = [];
    try {
      for (const row of checked.rows) {
        const value = JSON.parse(row.payloadJson) as unknown;
        const parsed = parseRecordedLedgerEvent(
          row.eventType,
          row.schemaVersion,
          row.serializerVersion,
          value,
        );
        if (!parsed.ok) {
          throw appError("STORE_CONSTRAINT", parsed.reason);
        }
        events.push(parsed.event);
      }
      await assertRecordedLedgerStructure(
        events.map((event, index) => ({
          event,
          sequence: checked.rows[index]!.sequence,
        })),
        storedLedgerStructureLookup(tx, orgId),
      );
      const sources = await verifyReplaySources(tx, orgId, events);
      return {
        ok: true,
        ledger: checked.verification,
        replaySourcesChecked: sources.sourcesChecked,
        replaySourceReason: null,
      };
    } catch (error) {
      // `verifyReplaySources` raises a specific, PII-safe reason for every distinct
      // failure; collapsing them into one constant would leave the unbounded
      // integrity gate undiagnosable. Anything that is not a typed AppError (a driver fault)
      // is reported generically so raw source or driver text never escapes.
      return {
        ok: false,
        ledger: checked.verification,
        replaySourcesChecked: 0,
        replaySourceReason: isAppError(error)
          ? error.message
          : "immutable replay source verification failed",
      };
    }
  });
}
