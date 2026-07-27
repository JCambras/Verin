/**
 * Readiness probe (charter #11/#14). Deliberately CROSS-TENANT: it answers "is
 * the store reachable and is the audit outbox draining", which is an operator
 * question about the deployment, not about any org's data — so it reads no tenant
 * rows and returns no tenant-identifying value (a reviewed escape in the
 * tenant-context-required fence).
 *
 * It lives here rather than inline in the route because raw SQL in the app layer
 * escapes BOTH governed-sink derivation and tenant-scope derivation, which scan
 * infrastructure only (app-layer-persistence fence).
 */
import type { SqlDb } from "@infra/store/db";

export interface StoreReadiness {
  /** Outbox rows still awaiting delivery ('pending' + 'claimed'); 'parked' rows are stuck, not pending. */
  readonly outboxPending: number;
}

export async function readStoreReadiness(db: SqlDb): Promise<StoreReadiness> {
  await db.query("SELECT 1");
  const backlog = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM audit_outbox WHERE status IN ('pending','claimed')",
  );
  return { outboxPending: Number(backlog.rows[0]?.n ?? 0) };
}
