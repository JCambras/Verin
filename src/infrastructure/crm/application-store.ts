/**
 * Account-opening application store (ADR-0004/0009). Mutations audited; reads
 * org-scoped. getByToken is used by the e-sign webhook (the token is the
 * capability — the webhook has no session principal).
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import { auditedWrite } from "@infra/audit/audited-write";
import type { Result } from "@contracts/result";
import type { Principal } from "@contracts/principal";
import type { AccountType, ApplicationStatus } from "@domain/schema/entities";

export interface ApplicationRow {
  id: string;
  org_id: string;
  household_id: string;
  contact_id: string;
  account_type: AccountType;
  status: ApplicationStatus;
  esign_token: string | null;
  idempotency_key: string;
}

export async function createApplication(
  db: SqlDb, p: Principal, input: { householdId: string; contactId: string; accountType: AccountType },
): Promise<Result<{ id: string; idempotencyKey: string }>> {
  const id = randomUUID();
  const idempotencyKey = `finalize:${id}`;
  const now = new Date().toISOString();
  return auditedWrite<{ id: string; idempotencyKey: string }>({
    db, orgId: p.orgId, actor: p.actor, action: "application.create", entityType: "AccountOpeningApplication", entityId: id,
    detail: `Opened ${input.accountType} application`,
    buildAfter: () => ({ id, status: "draft", accountType: input.accountType }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO account_opening_applications (id,org_id,household_id,contact_id,account_type,status,esign_token,idempotency_key,created_at,updated_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,$5,'draft',NULL,$6,$7,$7,'verin-crm',$7,'high')",
        [id, p.orgId, input.householdId, input.contactId, input.accountType, idempotencyKey, now],
      );
      return { id, idempotencyKey };
    },
  });
}

export async function setEsignRequested(db: SqlDb, p: Principal, applicationId: string, token: string): Promise<Result<{ token: string }>> {
  return auditedWrite<{ token: string }>({
    db, orgId: p.orgId, actor: p.actor, action: "application.request-esign", entityType: "AccountOpeningApplication", entityId: applicationId,
    detail: "Sent application for e-signature", buildAfter: () => ({ status: "awaiting-signature" }),
    perform: async (tx) => {
      const res = await tx.query<{ id: string }>(
        "UPDATE account_opening_applications SET status='awaiting-signature', esign_token=$3, updated_at=$4 WHERE id=$1 AND org_id=$2 RETURNING id",
        [applicationId, p.orgId, token, new Date().toISOString()],
      );
      // Vale V15: a wrong id/org affects 0 rows — fail instead of silently "succeeding".
      if (res.rows.length !== 1) throw { code: "NOT_FOUND", message: "Application not found." };
      return { token };
    },
  });
}

/** Used by the webhook: the resume token is the capability (no session principal). */
export async function getApplicationByToken(db: SqlDb, token: string): Promise<ApplicationRow | null> {
  const res = await db.query<ApplicationRow>("SELECT * FROM account_opening_applications WHERE esign_token = $1", [token]);
  return res.rows[0] ?? null;
}

/** Mark an application completed (audited with the initiating advisor's actor). */
export async function completeApplication(
  db: SqlDb, orgId: string, actor: string, applicationId: string, idempotencyKey: string,
): Promise<Result<{ id: string }>> {
  return auditedWrite<{ id: string }>({
    db, orgId, actor, action: "application.complete", entityType: "AccountOpeningApplication", entityId: applicationId,
    idempotencyKey, detail: "Account opening completed (e-signature received)",
    buildAfter: () => ({ status: "completed" }),
    perform: async (tx) => {
      const res = await tx.query<{ id: string }>(
        "UPDATE account_opening_applications SET status='completed', updated_at=$3 WHERE id=$1 AND org_id=$2 RETURNING id",
        [applicationId, orgId, new Date().toISOString()],
      );
      // Vale V15: a wrong id/org affects 0 rows — fail instead of silently "succeeding".
      if (res.rows.length !== 1) throw { code: "NOT_FOUND", message: "Application not found." };
      return { id: applicationId };
    },
  });
}
