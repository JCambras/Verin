import type { SqlTx } from "@infra/store/db";
import { appError } from "@contracts/errors";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";

export async function lockDecisionLedgerTenant(
  tx: SqlTx,
  tenant: TenantContext,
): Promise<void> {
  assertTenantContext(tenant);
  const row = await tx.query<{ id: string }>(
    "SELECT id FROM orgs WHERE id = $1 FOR UPDATE",
    [tenant.orgId],
  );
  if (row.rows.length !== 1) {
    throw appError("NOT_FOUND", "decision ledger tenant does not exist");
  }
}
