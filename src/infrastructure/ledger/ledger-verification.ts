/**
 * Decision-ledger integrity verification. L1 hashes stored bytes, L2 dispatches
 * the recorded schema and serializer and checks canonical round-trip, L3 checks
 * promoted columns, and L4 checks the independently maintained anchor.
 */
import type { SqlDb, SqlTx } from "@infra/store/db";
import { appError, normalizeAppError } from "@contracts/errors";
import { type LedgerEntry } from "@contracts/decision-core/ledger";
import type { RecordProvenance } from "@contracts/provenance";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
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
import {
  assertNoOrphanComputedProvenanceTraces,
  verifyRecordedLedgerProvenance,
} from "./ledger-producer-provenance";
import {
  listDecisionLedger,
  type DecisionLedgerRow,
} from "./ledger-rows";
export { listDecisionLedger, type DecisionLedgerRow } from "./ledger-rows";

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

interface TotalWitnessRow {
  entry_count: number | string;
  compromised: boolean;
}

interface LedgerSnapshot {
  readonly rows: DecisionLedgerRow[];
  readonly anchor: AnchorRow | undefined;
  readonly stored: number;
  readonly totalTrusted: boolean;
  readonly headSequence: number | null;
  readonly start: { sequence: number; prevHash: string } | undefined;
}

/** The anchor is tenant-wide, so L4 compares it with the stored totals, never the window. */
function verifyL4(
  snapshot: LedgerSnapshot,
  checked: number,
): LedgerVerificationLevel {
  const { anchor, rows, stored, headSequence } = snapshot;
  if (!snapshot.totalTrusted) {
    return level("L4", false, checked, headSequence, "ledger tenant total witness is missing or compromised");
  }
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
        provenanceSchemaVersion: row.provenanceSchemaVersion,
        provenanceSerializerVersion: row.provenanceSerializerVersion,
        provenanceJson: row.provenanceJson,
        provenanceTraceId: row.provenanceTraceId,
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
  tenant: TenantContext,
  window?: number,
): Promise<{ verification: LedgerVerification; rows: DecisionLedgerRow[] }> {
  assertTenantContext(tenant);
  return db.transaction((tx) =>
    verifyDecisionLedgerTransaction(tx, tenant, window));
}

export async function verifyDecisionLedgerTransaction(
  tx: SqlTx,
  tenant: TenantContext,
  window?: number,
): Promise<{ verification: LedgerVerification; rows: DecisionLedgerRow[] }> {
  assertTenantContext(tenant);
  const orgId = tenant.orgId;
  await lockDecisionLedgerTenant(tx, tenant, "verify");
  const anchor = await tx.query<AnchorRow>(
    "SELECT max_sequence, entry_count, head_hash FROM decision_ledger_anchor WHERE org_id = $1",
    [orgId],
  );
  const anchorRow = anchor.rows[0];
  const witnessed = await tx.query<TotalWitnessRow>(
    "SELECT entry_count, compromised FROM decision_ledger_total_witness WHERE org_id = $1",
    [orgId],
  );
  const witness = witnessed.rows[0];
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
      totalTrusted: witness === undefined
        ? Number(totals.rows[0]?.n ?? 0) === 0
        : !witness.compromised &&
          Number(witness.entry_count) === Number(totals.rows[0]?.n ?? 0),
      headSequence: headRaw === null || headRaw === undefined
        ? null
        : Number(headRaw),
      rows: await listDecisionLedger(tx, tenant),
      start: undefined,
    };
  } else {
    const rows = await listDecisionLedger(tx, tenant, window);
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
      totalTrusted: witness === undefined
        ? anchorRow === undefined && rows.length === 0
        : !witness.compromised &&
          Number(witness.entry_count) === Number(anchorRow?.entry_count ?? 0),
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
  tenant: TenantContext,
): Promise<LedgerVerification> {
  assertTenantContext(tenant);
  return (await verifyAndListDecisionLedger(db, tenant)).verification;
}

export async function verifyDecisionLedgerIntegrity(
  db: SqlDb,
  tenant: TenantContext,
): Promise<DecisionLedgerIntegrityVerification> {
  assertTenantContext(tenant);
  return db.transaction(async (tx) => {
    const checked = await verifyDecisionLedgerTransaction(tx, tenant);
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
      const verifiedEntryIds = new Set(checked.rows.map((entry) => entry.id));
      const provenanceCache = new Map<
        string,
        Promise<RecordProvenance>
      >();
      for (const row of checked.rows) {
        await verifyRecordedLedgerProvenance(
          tx,
          tenant,
          row,
          verifiedEntryIds,
          provenanceCache,
        );
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
      await assertNoOrphanComputedProvenanceTraces(tx, tenant);
      await assertRecordedLedgerStructure(
        events.map((event, index) => ({
          event,
          sequence: checked.rows[index]!.sequence,
        })),
        storedLedgerStructureLookup(tx, tenant),
      );
      const sources = await verifyReplaySources(tx, tenant, events);
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
        replaySourceReason: normalizeAppError(error, "trusted-only")?.message
          ??
          "immutable replay source verification failed",
      };
    }
  });
}
