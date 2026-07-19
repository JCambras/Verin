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
  const payload: OutboxPayload = {
    orgId: intent.orgId,
    actor: intent.actor,
    action: intent.action,
    entityType: intent.entityType,
    entityId: intent.entityId,
    beforeJson: intent.before == null ? null : JSON.stringify(scrub(intent.before)),
    afterJson: intent.after == null ? null : JSON.stringify(scrub(intent.after)),
    detail: intent.detail,
    createdAt: now,
    result,
  };
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

/** Drain pending outbox rows for an org into the append-only, hash-chained log. */
export async function drainOutbox(db: SqlDb, orgId: string): Promise<number> {
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
      const head = await db.query<HeadRow>(
        "SELECT sequence, entry_hash FROM audit_log WHERE org_id = $1 ORDER BY sequence DESC LIMIT 1",
        [orgId],
      );
      const prevHash = head.rows.length ? head.rows[0]!.entry_hash : GENESIS_HASH;
      const sequence = head.rows.length ? Number(head.rows[0]!.sequence) + 1 : 0;
      const p = JSON.parse(row.payload_json) as OutboxPayload;
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
      await db.query(
        `INSERT INTO audit_log (id, org_id, sequence, actor, action, entity_type, entity_id, before_json, after_json, detail, created_at, prev_hash, entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [randomUUID(), entry.orgId, entry.sequence, entry.actor, entry.action, entry.entityType, entry.entityId, entry.beforeJson, entry.afterJson, entry.detail, entry.createdAt, prevHash, entryHash],
      );
      await db.query("DELETE FROM audit_outbox WHERE id = $1", [row.id]);
      drained += 1;
    } catch {
      // release the claim; a later drain retries (at-least-once).
      await db.query("UPDATE audit_outbox SET status = 'pending', attempts = attempts + 1, claimed_at = NULL WHERE id = $1", [row.id]);
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

/** Re-verify an org's audit chain integrity (charter #13). */
export async function verifyOrgChain(db: SqlDb, orgId: string): Promise<ChainVerdict> {
  return verifyChain(await listOrgChain(db, orgId));
}
