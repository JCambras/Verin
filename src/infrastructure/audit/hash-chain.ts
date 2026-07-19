/**
 * Hash chain for the tamper-evident audit trail (ADR-0007, charter #13). Each
 * entry's hash covers a canonical serialization of its fields PLUS the previous
 * entry's hash, so any edit/reorder/deletion breaks the chain and is detected by
 * verifyChain(). One chain per org, ordered by sequence.
 */
import { createHash } from "node:crypto";

export const GENESIS_HASH = "GENESIS";

export interface ChainableEntry {
  orgId: string;
  sequence: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  detail: string;
  createdAt: string;
}

/** Deterministic serialization — fixed field order, no incidental whitespace. */
export function canonicalize(e: ChainableEntry): string {
  return JSON.stringify([
    e.orgId,
    e.sequence,
    e.actor,
    e.action,
    e.entityType,
    e.entityId,
    e.beforeJson,
    e.afterJson,
    e.detail,
    e.createdAt,
  ]);
}

export function computeEntryHash(e: ChainableEntry, prevHash: string): string {
  return createHash("sha256").update(canonicalize(e)).update("|").update(prevHash).digest("hex");
}

export interface ChainRow extends ChainableEntry {
  prevHash: string;
  entryHash: string;
}

export interface ChainVerdict {
  ok: boolean;
  entriesChecked: number;
  brokenAtSequence: number | null;
  reason: string | null;
}

/** Verify an ordered (by sequence) list of chain rows for one org. */
export function verifyChain(rows: ChainRow[]): ChainVerdict {
  let prev = GENESIS_HASH;
  let expectedSeq = rows.length > 0 ? rows[0]!.sequence : 0;
  for (const row of rows) {
    if (row.sequence !== expectedSeq) {
      return { ok: false, entriesChecked: expectedSeq, brokenAtSequence: row.sequence, reason: `sequence gap: expected ${expectedSeq}, got ${row.sequence}` };
    }
    if (row.prevHash !== prev) {
      return { ok: false, entriesChecked: row.sequence, brokenAtSequence: row.sequence, reason: "prev_hash does not match preceding entry_hash" };
    }
    const recomputed = computeEntryHash(row, prev);
    if (recomputed !== row.entryHash) {
      return { ok: false, entriesChecked: row.sequence, brokenAtSequence: row.sequence, reason: "entry_hash does not match recomputed hash (row was altered)" };
    }
    prev = row.entryHash;
    expectedSeq += 1;
  }
  return { ok: true, entriesChecked: rows.length, brokenAtSequence: null, reason: null };
}
