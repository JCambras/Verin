import type { AppError } from "@contracts/errors";
import { appError, logLevelFor, normalizeAppError } from "@contracts/errors";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import { authorityObservabilityId } from "@domain/observability/safe-values";
import { log } from "@infra/observability/logger";
import { isDriverConstraintError, logSafeReason } from "@infra/store/driver-errors";
import type { SqlTx } from "@infra/store/db";

export function storeFailure(
  tenant: TenantContext,
  error: unknown,
): AppError {
  assertTenantContext(tenant);
  const known = normalizeAppError(error, "trusted-only");
  log[known ? logLevelFor(known.code) : "error"](
    {
      orgId: authorityObservabilityId("orgId", tenant),
      code: known?.code ?? null,
      reason: logSafeReason(error),
    },
    "decision ledger append failed",
  );
  if (known) return known;
  return isDriverConstraintError(error)
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
      { orgId: authorityObservabilityId("orgId", tenant), reason: logSafeReason(error) },
      "decision ledger savepoint rollback failed",
    );
  }
  try {
    await tx.exec("RELEASE SAVEPOINT decision_ledger_append");
  } catch (error) {
    log.warn(
      { orgId: authorityObservabilityId("orgId", tenant), reason: logSafeReason(error) },
      "decision ledger savepoint release failed",
    );
  }
}
