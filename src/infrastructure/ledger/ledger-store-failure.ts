import type { AppError } from "@contracts/errors";
import { appError, logLevelFor } from "@contracts/errors";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import { authorityObservabilityId } from "@domain/observability/safe-values";
import { log, safeReason } from "@infra/observability/logger";
import { classifyStoreFailure } from "@infra/store/driver-errors";
import type { SqlTx } from "@infra/store/db";

export function storeFailure(
  tenant: TenantContext,
  error: unknown,
): AppError {
  assertTenantContext(tenant);
  const classified = classifyStoreFailure(error);
  const known = classified.appError;
  log[known ? logLevelFor(known.code) : "error"](
    {
      orgId: authorityObservabilityId("orgId", tenant),
      code: known?.code ?? null,
      reason: classified.reason,
    },
    "decision ledger append failed",
  );
  if (known) return known;
  return classified.constraint
    ? appError("STORE_CONSTRAINT", "decision ledger append violated a store constraint")
    : appError("INTERNAL", "decision ledger append failed");
}

export async function cleanUpAppendSavepoint(
  tx: SqlTx,
  tenant: TenantContext,
): Promise<void> {
  assertTenantContext(tenant);
  try {
    await tx.exec("ROLLBACK TO SAVEPOINT decision_ledger_append");
  } catch (error) {
    log.warn(
      { orgId: authorityObservabilityId("orgId", tenant), reason: safeReason(error) },
      "decision ledger savepoint rollback failed",
    );
  }
  try {
    await tx.exec("RELEASE SAVEPOINT decision_ledger_append");
  } catch (error) {
    log.warn(
      { orgId: authorityObservabilityId("orgId", tenant), reason: safeReason(error) },
      "decision ledger savepoint release failed",
    );
  }
}
