import type { SqlQueryable } from "@infra/store/db";
import type { PIIBearing } from "@contracts/pii";
import type { GovernedOutput } from "@contracts/authz";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import {
  verifyStoredByteChain,
  type ChainVerdict,
} from "@infra/audit/hash-chain";
import { parseRecordProvenance } from "@contracts/provenance";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import {
  decisionLedgerChainPreimage,
  parseRecordedLedgerEvent,
  type RecordedLedgerColumns,
} from "./ledger-schema-registry";
import { verifyStoredLedgerEventAcceptance } from "./ledger-bindings";

export interface DecisionLedgerRow
  extends PIIBearing, GovernedOutput<"audit.export"> {
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
  readonly entriesStored: number;
  readonly levels: readonly LedgerVerificationLevel[];
}

export interface LedgerSnapshot extends PIIBearing {
  readonly rows: DecisionLedgerRow[];
  readonly anchor: {
    max_sequence: number | string;
    entry_count: number | string;
    head_hash: string;
  } | undefined;
  readonly stored: number;
  readonly headSequence: number | null;
  readonly start: { sequence: number; prevHash: string } | undefined;
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
): {
  verdict: LedgerVerificationLevel;
  events: LedgerEntry[];
  promoted: RecordedLedgerColumns[];
} {
  const events: LedgerEntry[] = [];
  const promoted: RecordedLedgerColumns[] = [];
  for (const row of rows) {
    let unknown: unknown;
    try {
      unknown = JSON.parse(row.payloadJson);
    } catch {
      return {
        verdict: level("L2", false, events.length, row.sequence, "payload_json is not JSON"),
        events,
        promoted,
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
        promoted,
      };
    }
    if (parsed.canonicalBytes !== row.payloadJson) {
      return {
        verdict: level("L2", false, events.length, row.sequence, "payload bytes are not canonical for the recorded serializer"),
        events,
        promoted,
      };
    }
    events.push(parsed.event);
    promoted.push(parsed.promoted);
  }
  return {
    verdict: level("L2", true, rows.length, null, null),
    events,
    promoted,
  };
}

function verifyL3(
  rows: readonly DecisionLedgerRow[],
  promoted: readonly RecordedLedgerColumns[],
): LedgerVerificationLevel {
  for (let index = 0; index < promoted.length; index += 1) {
    const row = rows[index]!;
    const event = promoted[index]!;
    const matches =
      event.firmId === row.orgId &&
      event.id === row.id &&
      event.eventType === row.eventType &&
      event.schemaVersion === row.schemaVersion &&
      event.serializerVersion === row.serializerVersion &&
      event.occurredAt === row.occurredAt &&
      event.recordedAt === row.recordedAt &&
      event.actorJson === row.actorJson &&
      event.correlationId === row.correlationId &&
      event.causationId === row.causationId &&
      event.decisionId === row.decisionId &&
      event.evidenceSnapshotId === row.evidenceSnapshotId &&
      event.triggeringEntryId === row.triggeringEntryId &&
      event.reservationCreationId === row.reservationCreationId;
    if (!matches) {
      return level("L3", false, index, row.sequence, "promoted column differs from canonical payload");
    }
  }
  return level("L3", true, rows.length, null, null);
}

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

export async function verifyLedgerSnapshot(
  tx: SqlQueryable,
  tenant: TenantContext,
  snapshot: LedgerSnapshot,
): Promise<LedgerVerification> {
  assertTenantContext(tenant);
  const { rows, stored } = snapshot;
  const chainRows = [];
  for (const row of rows) {
    const provenance = parseRecordProvenance({
      source: row.provSource,
      asOf: row.provAsOf,
      confidence: row.provConfidence,
    });
    const preimage = provenance
      ? decisionLedgerChainPreimage(
          row.schemaVersion,
          row.serializerVersion,
          row.payloadJson,
          provenance,
        )
      : null;
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
  const acceptance = await verifyStoredLedgerEventAcceptance(
    tx,
    tenant,
    l2.events.map((event, index) => ({
      event,
      sequence: rows[index]!.sequence,
    })),
  );
  if (!acceptance.ok) {
    const checked = acceptance.sequence === null
      ? 0
      : rows.findIndex((row) => row.sequence === acceptance.sequence);
    return fail([
      l1,
      level(
        "L2",
        false,
        checked < 0 ? 0 : checked,
        acceptance.sequence,
        acceptance.reason,
      ),
    ]);
  }
  const l3 = verifyL3(rows, l2.promoted);
  if (!l3.ok) return fail([l1, l2.verdict, l3]);
  const l4 = verifyL4(snapshot, rows.length);
  return {
    ok: l4.ok,
    entriesChecked: rows.length,
    entriesStored: stored,
    levels: [l1, l2.verdict, l3, l4],
  };
}
