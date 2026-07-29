/**
 * The audited-write helper (ADR-0007/0009, charter #13/#16). EVERY house-CRM
 * mutation routes through here with a sealed WriteActor for tenant/actor attribution. It:
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
import { appError, logLevelFor, type AppError } from "@contracts/errors";
import { assertWriteActor, type WriteActor } from "@contracts/principal";
import { classifyErrorMetadata, log, safeReason } from "@infra/observability/logger";
import { keyedObservabilityId } from "@infra/observability/record-id";
import {
  authorityObservabilityId,
  type ObservabilityAction,
  type ObservabilityEntityType,
} from "@domain/observability/safe-values";
import { enqueueAudit, drainOutbox, type AuditIntent } from "./audit-store";

const REPLAY = Symbol("idempotency-replay");

export interface AuditedWriteOpts<T> {
  db: SqlDb;
  actor: WriteActor;
  action: ObservabilityAction;
  entityType: ObservabilityEntityType;
  entityId?: string | null;
  idempotencyKey?: string;
  before?: unknown;
  after?: unknown;
  /** Late-bound before-snapshot: called AFTER perform, so the pre-image can be read inside the transaction (no stale-snapshot race). */
  buildBefore?: () => unknown;
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
  const actor = opts.actor;
  assertWriteActor(actor);
  const { db, idempotencyKey } = opts;
  // The write chokepoint refuses an impostor context before any SQL runs
  // ("missing tenant context cannot parse", v3 §15.2).
  const tenant = actor.tenant;
  const orgId = tenant.orgId;
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
        // A void perform cannot be cached (JSON.stringify(undefined) becomes a NULL
        // result_json → constraint failure that rolls the business write back with a
        // misleading error) AND its replay could never be detected by the cache-hit
        // sentinel. Fail as an explicit invariant instead of a disguised 409.
        if (r === undefined) {
          throw appError("INTERNAL", "auditedWrite: perform returned undefined but an idempotencyKey requires a serializable result");
        }
        // The UNIQUE(org_id, idempotency_key) constraint is the real guard against a race.
        await tx.query(
          "INSERT INTO crm_write_cache (org_id, idempotency_key, result_json, created_at) VALUES ($1,$2,$3,$4)",
          [orgId, idempotencyKey, JSON.stringify(r), now],
        );
      }
      const intent: AuditIntent = {
        orgId,
        actor: actor.actorUserId,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId ?? null,
        before: opts.buildBefore ? opts.buildBefore() : opts.before,
        after: opts.buildAfter ? opts.buildAfter(r) : opts.after,
        detail: opts.detail,
      };
      await enqueueAudit(tx, intent, "success", now);
      return r;
    });
    await drainOutbox(db, tenant).catch(() => undefined);
    return ok(result);
  } catch (e) {
    // Any path where the key already resolved to a cached result is a replay → exactly-once.
    if (idempotencyKey) {
      const hit = await cachedResult<T>(db, orgId, idempotencyKey);
      if (hit !== undefined) return ok(hit);
    }
    // Genuine failure: business rolled back. Log the REAL error before mapping —
    // this helper is the single write chokepoint, the worst place to fly blind
    // (a swallowed TypeError here once surfaced as a generic 409 "write failed").
    const metadata = classifyErrorMetadata(e);
    const known: AppError | null = metadata.appError;
    // Request-controlled entity IDs use the non-throwing keyed boundary. A failure
    // there redacts instead of escaping before the failure-audit entry is enqueued,
    // which preserves both the log line and the "[attempt failed]" chain entry.
    log[known ? logLevelFor(known.code) : "error"](
      {
        orgId: authorityObservabilityId("orgId", tenant),
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId
          ? keyedObservabilityId("entityId", tenant, opts.entityId)
          : null,
        code: known?.code ?? null,
        reason: metadata.reason,
      },
      "audited write failed",
    );
    const failIntent: AuditIntent = {
      orgId,
      actor: actor.actorUserId,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId ?? null,
      before: opts.buildBefore ? opts.buildBefore() : opts.before,
      detail: `${opts.detail} [attempt failed]`,
    };
    await db
      .transaction(async (tx) => enqueueAudit(tx, failIntent, "failure", now))
      .then(() => drainOutbox(db, tenant))
      .catch((auditErr: unknown) => {
        // The business failure is already being reported; the audit-of-failure loss
        // must never be silent (same policy as auditEvent in wire.ts).
        log.error(
          {
            orgId: authorityObservabilityId("orgId", tenant),
            action: opts.action,
            entityType: opts.entityType,
            entityId: opts.entityId
              ? keyedObservabilityId("entityId", tenant, opts.entityId)
              : null,
            reason: safeReason(auditErr),
          },
          "failure-audit entry could not be recorded",
        );
      });
    // Unknown failures default to INTERNAL (500) — STORE_CONSTRAINT (409) is
    // reserved for real driver integrity-constraint codes, so a plain bug in
    // perform is never mislabeled as a client-resolvable conflict.
    const error: AppError = known
      ? known
      : metadata.piiViolation
        ? appError("PII_VIOLATION", "write refused: PII would have reached the audit boundary")
        : metadata.sqlState?.startsWith("23")
          ? appError("STORE_CONSTRAINT", "write failed: store constraint violated")
          : appError("INTERNAL", "write failed");
    return err(error);
  }
}
