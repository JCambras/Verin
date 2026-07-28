import type { SqlTx } from "@infra/store/db";
import { appError } from "@contracts/errors";

export async function lockDecisionLedgerTenant(
  tx: SqlTx,
  orgId: string,
): Promise<void> {
  const tenant = await tx.query<{ id: string }>(
    "SELECT id FROM orgs WHERE id = $1 FOR UPDATE",
    [orgId],
  );
  if (tenant.rows.length !== 1) {
    throw appError("NOT_FOUND", "decision ledger tenant does not exist");
  }
}
