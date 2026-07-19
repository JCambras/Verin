/**
 * The audited-write helper (ADR-0007/0009, charter #13/#16). EVERY house-CRM
 * mutation routes through here. It:
 *  - enforces idempotency: a repeated idempotencyKey returns the cached result
 *    (exactly-once effect under timeout-replay);
 *  - performs the business write and enqueues the audit entry in ONE transaction
 *    (audit-by-construction — success is audited; failures are audited separately);
 *  - drains the outbox inline (best-effort) so the chain is immediately verifiable.
 *
 * enqueueAudit is called ONLY from here (anti-fork fence: no hand-rolled audits).
 */
import type { SqlDb, SqlQueryable } from "@infra/store/db";
import { type Result, ok, err } from "@contracts/result";
import { appError, isAppError, type AppError } from "@contracts/errors";
import { log } from "@infra/observability/logger";
import { enqueueAudit, drainOutbox, type AuditIntent } from "./audit-store";

const REPLAY = Symbol("idempotency-replay");

export interface AuditedWriteOpts<T> {
  db: SqlDb;
  orgId: string;
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  idempotencyKey?: string;
  before?: unknown;
  after?: unknown;
  buildAfter?: (result: T) => unknown;
  detail: string;
  perform: (tx: SqlQueryable) => Promise<T>;
}

async function cachedResult<T>(db: SqlDb, orgId: string, key: string): Promise<T | undefined> {
  const res = await db.query<{ result_json: string }>(
    "SELECT result_json FROM crm_write_cache WHERE org_id = $1 AND idempotency_key = $2",
    [orgId, key],
  );
  return res.rows.length ? (JSON.parse(res.rows[0]!.result_json) as T) : undefined;
}

export async function auditedWrite<T>(opts: AuditedWriteOpts<T>): Promise<Result<T>> {
  const { db, orgId, idempotencyKey } = opts;
  const now = new Date().toISOString();

  // Fast path: a known replay returns the cached result without touching the DB.
  if (idempotencyKey) {
    const hit = await cachedResult<T>(db, orgId, idempotencyKey);
    if (hit !== undefined) return ok(hit);
  }

  try {
    const result = await db.transaction<T>(async (tx) => {
      if (idempotencyKey) {
        const dup = await tx.query("SELECT 1 FROM crm_write_cache WHERE org_id = $1 AND idempotency_key = $2", [orgId, idempotencyKey]);
        if (dup.rows.length) throw REPLAY;
      }
      const r = await opts.perform(tx);
      if (idempotencyKey) {
        // The UNIQUE(org_id, idempotency_key) constraint is the real guard against a race.
        await tx.query(
          "INSERT INTO crm_write_cache (org_id, idempotency_key, result_json, created_at) VALUES ($1,$2,$3,$4)",
          [orgId, idempotencyKey, JSON.stringify(r), now],
        );
      }
      const intent: AuditIntent = {
        orgId,
        actor: opts.actor,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId ?? null,
        before: opts.before,
        after: opts.buildAfter ? opts.buildAfter(r) : opts.after,
        detail: opts.detail,
      };
      await enqueueAudit(tx, intent, "success", now);
      return r;
    });
    await drainOutbox(db, orgId).catch(() => undefined);
    return ok(result);
  } catch (e) {
    // Any path where the key already resolved to a cached result is a replay → exactly-once.
    if (idempotencyKey) {
      const hit = await cachedResult<T>(db, orgId, idempotencyKey);
      if (hit !== undefined) return ok(hit);
    }
    // Genuine failure: business rolled back; record the failed attempt in its own tx.
    const failIntent: AuditIntent = {
      orgId,
      actor: opts.actor,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId ?? null,
      before: opts.before,
      detail: `${opts.detail} [attempt failed]`,
    };
    await db
      .transaction(async (tx) => enqueueAudit(tx, failIntent, "failure", now))
      .then(() => drainOutbox(db, orgId))
      .catch((auditErr: unknown) => {
        // The business failure is already being reported; the audit-of-failure loss
        // must never be silent (same policy as auditEvent in wire.ts).
        log.error(
          { orgId, action: opts.action, entityType: opts.entityType, entityId: opts.entityId ?? null, reason: auditErr instanceof Error ? auditErr.message : String(auditErr) },
          "failure-audit entry could not be recorded",
        );
      });
    const error: AppError = isAppError(e)
      ? e
      : e instanceof Error && e.name === "PIIViolation"
        ? appError("PII_VIOLATION", "write refused: PII would have reached the audit boundary")
        : appError("STORE_CONSTRAINT", "write failed");
    return err(error);
  }
}
