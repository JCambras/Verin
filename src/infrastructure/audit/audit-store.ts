/**
 * Audit store (ADR-0007/0016). enqueueAudit writes a scrubbed audit intent into
 * the transactional outbox (same tx as the business write). drainOutbox links each
 * entry into the append-only, hash-chained audit_log (one chain per org).
 * verifyOrgChain re-verifies integrity (used by the scheduled CI/ops job and the
 * console). enqueueAudit is called ONLY by the auditedWrite helper (anti-fork fence).
 */
import { randomUUID } from "node:crypto";
import type { SqlDb, SqlQueryable } from "@infra/store/db";
import { scrub } from "@infra/pii/scrub";
import { assertNoPIIValues } from "@contracts/pii";
import { appError } from "@contracts/errors";
import { GENESIS_HASH, computeEntryHash, verifyChain, type ChainRow, type ChainVerdict } from "./hash-chain";

export interface AuditIntent {
  orgId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  detail: string;
}

interface OutboxPayload {
  orgId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  detail: string;
  createdAt: string;
  result: "success" | "failure";
}

/** Enqueue a scrubbed audit entry in the same transaction as the business write. */
export async function enqueueAudit(
  tx: SqlQueryable,
  intent: AuditIntent,
  result: "success" | "failure",
  now: string,
): Promise<void> {
  const scrubbedBefore = intent.before == null ? null : scrub(intent.before);
  const scrubbedAfter = intent.after == null ? null : scrub(intent.after);
  const payload: OutboxPayload = {
    orgId: intent.orgId,
    actor: intent.actor,
    action: intent.action,
    entityType: intent.entityType,
    entityId: intent.entityId,
    beforeJson: scrubbedBefore == null ? null : JSON.stringify(scrubbedBefore),
    afterJson: scrubbedAfter == null ? null : JSON.stringify(scrubbedAfter),
    // detail is free text — scrub value-pattern PII (email/phone/SSN) at the boundary.
    detail: String(scrub(intent.detail)),
    createdAt: now,
    result,
  };
  // Fail-closed backstop (Vale V3): if PII survived scrubbing, refuse to persist it —
  // the business write rolls back rather than leaking PII to the audit. Asserted on
  // the STRUCTURED snapshots (not their JSON strings) so a raw number/boolean under a
  // PII key ({ phone: 5551234567 }) is caught, not just PII-shaped substrings.
  assertNoPIIValues({ before: scrubbedBefore, after: scrubbedAfter, detail: payload.detail }, "audit");
  await tx.query(
    "INSERT INTO audit_outbox (id, org_id, payload_json, status, attempts, created_at) VALUES ($1,$2,$3,'pending',0,$4)",
    [randomUUID(), intent.orgId, JSON.stringify(payload), now],
  );
}

interface OutboxRow {
  id: string;
  payload_json: string;
}
interface HeadRow {
  sequence: number | string;
  entry_hash: string;
}

/** A claim older than this is presumed crashed and returns to 'pending' (at-least-once). */
const CLAIM_TIMEOUT_MS = 5 * 60_000;

/** Drain pending outbox rows for an org into the append-only, hash-chained log. */
export async function drainOutbox(db: SqlDb, orgId: string): Promise<number> {
  // Reclaim stale claims first: a crash between claim and delete must not leave a
  // committed business write permanently unaudited.
  await db.query(
    "UPDATE audit_outbox SET status = 'pending', claimed_at = NULL WHERE org_id = $1 AND status = 'claimed' AND claimed_at < $2",
    [orgId, new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString()],
  );
  const pending = await db.query<OutboxRow>(
    "SELECT id, payload_json FROM audit_outbox WHERE org_id = $1 AND status = 'pending' ORDER BY created_at ASC, id ASC",
    [orgId],
  );
  let drained = 0;
  for (const row of pending.rows) {
    const claimed = await db.query<{ id: string }>(
      "UPDATE audit_outbox SET status = 'claimed', claimed_at = $2 WHERE id = $1 AND status = 'pending' RETURNING id",
      [row.id, new Date().toISOString()],
    );
    if (claimed.rows.length !== 1) continue; // someone else claimed it
    try {
      const p = JSON.parse(row.payload_json) as OutboxPayload;
      // One transaction for head-read → insert → anchor → delete: a partial
      // failure can never append a chain entry the anchor does not count, and
      // interleaved drains can never regress the anchor.
      await db.transaction(async (tx) => {
        const head = await tx.query<HeadRow>(
          "SELECT sequence, entry_hash FROM audit_log WHERE org_id = $1 ORDER BY sequence DESC LIMIT 1",
          [orgId],
        );
        const prevHash = head.rows.length ? head.rows[0]!.entry_hash : GENESIS_HASH;
        const sequence = head.rows.length ? Number(head.rows[0]!.sequence) + 1 : 0;
        const entry = {
          orgId: p.orgId,
          sequence,
          actor: p.actor,
          action: p.result === "failure" ? `${p.action}.failed` : p.action,
          entityType: p.entityType,
          entityId: p.entityId,
          beforeJson: p.beforeJson,
          afterJson: p.afterJson,
          detail: p.detail,
          createdAt: p.createdAt,
        };
        const entryHash = computeEntryHash(entry, prevHash);
        await tx.query(
          `INSERT INTO audit_log (id, org_id, sequence, actor, action, entity_type, entity_id, before_json, after_json, detail, created_at, prev_hash, entry_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [randomUUID(), entry.orgId, entry.sequence, entry.actor, entry.action, entry.entityType, entry.entityId, entry.beforeJson, entry.afterJson, entry.detail, entry.createdAt, prevHash, entryHash],
        );
        // Advance the out-of-band anchor (Vale V1): expected max_sequence + count.
        await tx.query(
          `INSERT INTO audit_anchor (org_id, max_sequence, entry_count, updated_at) VALUES ($1,$2,1,$3)
           ON CONFLICT (org_id) DO UPDATE SET max_sequence = GREATEST(audit_anchor.max_sequence, $2), entry_count = audit_anchor.entry_count + 1, updated_at = $3`,
          [orgId, entry.sequence, new Date().toISOString()],
        );
        // The claim must still be OURS at delivery time. A worker stalled past
        // CLAIM_TIMEOUT_MS whose row was reclaimed and delivered by another worker
        // would otherwise append the same event a second time at the next sequence —
        // an undetectable duplicate in the append-only chain. 0 rows → abort the tx.
        const deleted = await tx.query<{ id: string }>(
          "DELETE FROM audit_outbox WHERE id = $1 AND status = 'claimed' RETURNING id",
          [row.id],
        );
        if (deleted.rows.length !== 1) {
          throw appError("CONFLICT", "outbox claim lost before delivery (reclaimed by another worker)");
        }
      });
      drained += 1;
    } catch {
      // release the claim; a later drain retries (at-least-once).
      await db
        .query("UPDATE audit_outbox SET status = 'pending', attempts = attempts + 1, claimed_at = NULL WHERE id = $1", [row.id])
        .catch(() => undefined);
    }
  }
  return drained;
}

interface AuditLogRow {
  org_id: string;
  sequence: number | string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  detail: string;
  created_at: string;
  prev_hash: string;
  entry_hash: string;
}

function toChainRow(r: AuditLogRow): ChainRow {
  return {
    orgId: r.org_id,
    sequence: Number(r.sequence),
    actor: r.actor,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    beforeJson: r.before_json,
    afterJson: r.after_json,
    detail: r.detail,
    createdAt: r.created_at,
    prevHash: r.prev_hash,
    entryHash: r.entry_hash,
  };
}

/** Load an org's audit chain (examiner export / console). */
export async function listOrgChain(db: SqlDb, orgId: string): Promise<ChainRow[]> {
  const res = await db.query<AuditLogRow>("SELECT * FROM audit_log WHERE org_id = $1 ORDER BY sequence ASC", [orgId]);
  return res.rows.map(toChainRow);
}

/**
 * Re-verify an org's audit chain integrity (charter #13): internal hash-chain
 * consistency AND agreement with the out-of-band anchor, so tail-truncation or full
 * deletion is DETECTED (Vale V1 / Sable F4).
 */
export async function verifyOrgChain(db: SqlDb, orgId: string): Promise<ChainVerdict> {
  // Chain rows and the anchor are read in ONE transaction: a drain committing
  // between two separate reads would otherwise raise a false "rows removed /
  // truncated" tamper alarm (anchor ahead of the rows snapshot).
  const { rows, anchor } = await db.transaction(async (tx) => {
    const chainRes = await tx.query<AuditLogRow>("SELECT * FROM audit_log WHERE org_id = $1 ORDER BY sequence ASC", [orgId]);
    const anchorRes = await tx.query<{ max_sequence: number | string; entry_count: number | string }>(
      "SELECT max_sequence, entry_count FROM audit_anchor WHERE org_id = $1",
      [orgId],
    );
    return { rows: chainRes.rows.map(toChainRow), anchor: anchorRes.rows[0] };
  });
  const verdict = verifyChain(rows);
  if (!verdict.ok) return verdict;
  if (!anchor) {
    // No anchor is legitimate ONLY for an org that has never written. Entries
    // without an anchor mean the anchor row was removed — the full-deletion /
    // truncation cover-up the anchor exists to detect (Vale V1 / Sable F4).
    if (rows.length > 0) {
      return { ok: false, entriesChecked: rows.length, brokenAtSequence: null, reason: `${rows.length} entries but no anchor row (anchor removed)` };
    }
    return verdict;
  }
  const expectedCount = Number(anchor.entry_count);
  const expectedMax = Number(anchor.max_sequence);
  if (rows.length !== expectedCount) {
    return { ok: false, entriesChecked: rows.length, brokenAtSequence: null, reason: `entry count ${rows.length} != anchor ${expectedCount} (rows removed / truncated)` };
  }
  if (rows.length > 0 && rows[rows.length - 1]!.sequence !== expectedMax) {
    return { ok: false, entriesChecked: rows.length, brokenAtSequence: expectedMax, reason: `max sequence ${rows[rows.length - 1]!.sequence} != anchor ${expectedMax}` };
  }
  return verdict;
}
