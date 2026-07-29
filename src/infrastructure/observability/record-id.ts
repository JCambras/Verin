import { createHmac } from "node:crypto";
import { revealSecret } from "@contracts/secret";
import { isMachineRecordId } from "@contracts/record-id";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import { getConfig } from "@infra/config";
import {
  keyedDigestObservabilityId,
  observabilityIdOrRedacted,
  type ObservabilityId,
  type RecordObservabilityIdField,
} from "@domain/observability/safe-values";
/** Convert a client UUID to stable, tenant/field-scoped, non-reversible correlation. */
export function keyedObservabilityId(
  field: RecordObservabilityIdField,
  tenant: TenantContext,
  value: unknown,
): ObservabilityId {
  try {
    assertTenantContext(tenant);
    if (!isMachineRecordId(value)) {
      return observabilityIdOrRedacted(field, "");
    }
    const purposeKey = createHmac(
      "sha256",
      revealSecret(getConfig().session.secret),
    ).update("verin:observability-record-id:key:v1").digest();
    const digest = createHmac("sha256", purposeKey)
      .update(JSON.stringify(["v1", tenant.orgId, field, value.toLowerCase()]))
      .digest("hex");
    return keyedDigestObservabilityId(field, `h1:${digest}`);
  } catch {
    return observabilityIdOrRedacted(field, "");
  }
}
