/**
 * Hash chain for the tamper-evident audit trail (ADR-0007, charter #13). Each
 * entry's hash covers a canonical serialization of its fields PLUS the previous
 * entry's hash, so any edit/reorder/deletion breaks the chain and is detected by
 * verifyChain(). One chain per org, ordered by sequence.
 */
import { createHash } from "node:crypto";
import type { GovernedOutput } from "@contracts/authz";

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
  return computeChainHash(canonicalize(e), prevHash);
}

/** Shared chain primitive. Existing audit preimages remain byte-for-byte unchanged. */
export function computeChainHash(canonicalBytes: string, prevHash: string): string {
  return createHash("sha256")
    .update(canonicalBytes)
    .update("|")
    .update(prevHash)
    .digest("hex");
}

export interface StoredByteChainRow {
  readonly sequence: number;
  readonly canonicalBytes: string;
  readonly prevHash: string;
  readonly entryHash: string;
}

/**
 * L1 verification for chains whose authoritative preimage is already persisted.
 * Always demands a complete GENESIS-rooted chain: a suffix rooted at a stored
 * predecessor hash proves continuity but not that the predecessor is authentic
 * (ADR-0044), so there is no bounded-start form to pass here.
 */
export function verifyStoredByteChain(
  rows: StoredByteChainRow[],
): ChainVerdict {
  let prev = GENESIS_HASH;
  let expectedSequence = 0;
  let checked = 0;
  for (const row of rows) {
    if (row.sequence !== expectedSequence) {
      return broken(row.sequence, checked, `sequence gap: expected ${expectedSequence}, got ${row.sequence}`);
    }
    if (row.prevHash !== prev) {
      return broken(row.sequence, checked, "prev_hash does not match preceding entry_hash");
    }
    if (computeChainHash(row.canonicalBytes, prev) !== row.entryHash) {
      return broken(row.sequence, checked, "entry_hash does not match stored canonical bytes");
    }
    prev = row.entryHash;
    expectedSequence += 1;
    checked += 1;
  }
  return { ok: true, entriesChecked: rows.length, brokenAtSequence: null, reason: null };
}

function broken(sequence: number, checked: number, reason: string): ChainVerdict {
  return {
    ok: false,
    entriesChecked: checked,
    brokenAtSequence: sequence,
    reason,
  };
}

export interface ChainRow extends ChainableEntry, GovernedOutput<"audit.export"> {
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
