import type { SqlTx } from "@infra/store/db";
import { appError } from "@contracts/errors";

/**
 * One lock owner - the tenant's `orgs` row - held in two modes.
 *
 * `append` takes the EXCLUSIVE lock: two concurrent appends must never read the same
 * chain head and compute the same next sequence. `verify` takes the COMPATIBLE lock,
 * which still excludes appends (an exclusive waiter blocks behind it) so a verified
 * snapshot cannot move under the reader, while letting concurrent verified reads of
 * one tenant proceed together. Verification and replay are O(entries); an exclusive
 * lock there would serialize every `GET /api/ledger` against every other one and
 * block appends for the whole examiner-grade sweep.
 */
export type DecisionLedgerLockMode = "append" | "verify";

const LOCK_SQL: Record<DecisionLedgerLockMode, string> = {
  append: "SELECT id FROM orgs WHERE id = $1 FOR UPDATE",
  verify: "SELECT id FROM orgs WHERE id = $1 FOR SHARE",
};

export async function lockDecisionLedgerTenant(
  tx: SqlTx,
  orgId: string,
  mode: DecisionLedgerLockMode,
): Promise<void> {
  const tenant = await tx.query<{ id: string }>(LOCK_SQL[mode], [orgId]);
  if (tenant.rows.length !== 1) {
    throw appError("NOT_FOUND", "decision ledger tenant does not exist");
  }
}
