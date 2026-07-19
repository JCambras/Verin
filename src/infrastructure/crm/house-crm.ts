/**
 * House-CRM adapter (ADR-0004). The first real adapter behind the CRM boundary:
 * genuine persistence, canonical schema as its schema. EVERY mutation routes
 * through auditedWrite (audited-write-required + anti-fork fences); EVERY read is
 * org-scoped by the principal's orgId (org-id-required fence) — org_id is never
 * client-supplied. Provenance source = verin-crm on every row (charter #3).
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import { auditedWrite } from "@infra/audit/audited-write";
import type { Result } from "@contracts/result";
import type { Principal } from "@contracts/principal";
import type { Household, Contact, FinancialAccount, Task, AccountType, HouseholdStatus } from "@domain/schema/entities";
import type { RecordProvenance } from "@contracts/provenance";

const nowIso = () => new Date().toISOString();
const houseProv = (): RecordProvenance => ({ source: "verin-crm", asOf: nowIso(), confidence: "high" });

interface HouseholdRow {
  id: string; org_id: string; name: string; primary_contact_id: string | null;
  advisor_user_id: string | null; status: HouseholdStatus; created_at: string;
  prov_source: RecordProvenance["source"]; prov_asof: string; prov_confidence: RecordProvenance["confidence"];
}
function toHousehold(r: HouseholdRow): Household {
  return {
    id: r.id, orgId: r.org_id, name: r.name, primaryContactId: r.primary_contact_id,
    advisorUserId: r.advisor_user_id, status: r.status, createdAt: r.created_at,
    provenance: { source: r.prov_source, asOf: r.prov_asof, confidence: r.prov_confidence },
  };
}

export async function createHousehold(
  db: SqlDb, p: Principal, input: { name: string; status?: HouseholdStatus }, idempotencyKey?: string,
): Promise<Result<Household>> {
  const id = randomUUID();
  const createdAt = nowIso();
  const prov = houseProv();
  const status: HouseholdStatus = input.status ?? "prospect";
  return auditedWrite<Household>({
    // detail is PII-minimized (no client name); entityId identifies the record.
    db, orgId: p.orgId, actor: p.actor, action: "household.create", entityType: "Household", entityId: id,
    idempotencyKey, detail: "Created a household",
    buildAfter: (h) => ({ id: h.id, name: h.name, status: h.status }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9)",
        [id, p.orgId, input.name, p.userId, status, createdAt, prov.source, prov.asOf, prov.confidence],
      );
      return { id, orgId: p.orgId, name: input.name, primaryContactId: null, advisorUserId: p.userId, status, createdAt, provenance: prov };
    },
  });
}

export async function updateHouseholdName(db: SqlDb, p: Principal, id: string, name: string): Promise<Result<Household>> {
  const existing = await getHousehold(db, p, id);
  return auditedWrite<Household>({
    db, orgId: p.orgId, actor: p.actor, action: "household.update", entityType: "Household", entityId: id,
    before: existing ? { name: existing.name } : undefined,
    buildAfter: () => ({ name }), detail: "Renamed a household",
    perform: async (tx) => {
      const res = await tx.query<HouseholdRow>(
        "UPDATE households SET name = $3 WHERE id = $1 AND org_id = $2 RETURNING *",
        [id, p.orgId, name],
      );
      if (res.rows.length !== 1) throw { code: "NOT_FOUND", message: "Household not found." };
      return toHousehold(res.rows[0]!);
    },
  });
}

export async function listHouseholds(db: SqlDb, p: Principal): Promise<Household[]> {
  const res = await db.query<HouseholdRow>("SELECT * FROM households WHERE org_id = $1 ORDER BY created_at DESC", [p.orgId]);
  return res.rows.map(toHousehold);
}

export async function getHousehold(db: SqlDb, p: Principal, id: string): Promise<Household | null> {
  const res = await db.query<HouseholdRow>("SELECT * FROM households WHERE org_id = $1 AND id = $2", [p.orgId, id]);
  return res.rows[0] ? toHousehold(res.rows[0]) : null;
}

export async function createContact(
  db: SqlDb, p: Principal, input: { householdId: string; firstName: string; lastName: string; email?: string | null; phone?: string | null },
): Promise<Result<Contact>> {
  const id = randomUUID();
  const createdAt = nowIso();
  const prov = houseProv();
  return auditedWrite<Contact>({
    db, orgId: p.orgId, actor: p.actor, action: "contact.create", entityType: "Contact", entityId: id,
    detail: `Added contact to household`,
    // NOTE: before/after are scrubbed by the audit boundary, so PII (name/email) is redacted in the trail.
    buildAfter: (c) => ({ id: c.id, householdId: c.householdId, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO contacts (id,org_id,household_id,first_name,last_name,email,phone,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [id, p.orgId, input.householdId, input.firstName, input.lastName, input.email ?? null, input.phone ?? null, createdAt, prov.source, prov.asOf, prov.confidence],
      );
      return { id, orgId: p.orgId, householdId: input.householdId, firstName: input.firstName, lastName: input.lastName, email: input.email ?? null, phone: input.phone ?? null, createdAt, provenance: prov };
    },
  });
}

export async function createFinancialAccount(
  db: SqlDb, p: Principal, input: { householdId: string; accountType: AccountType; custodian?: string | null; currency?: string }, idempotencyKey?: string,
): Promise<Result<FinancialAccount>> {
  const id = randomUUID();
  const createdAt = nowIso();
  const prov = houseProv();
  const currency = input.currency ?? "USD";
  return auditedWrite<FinancialAccount>({
    db, orgId: p.orgId, actor: p.actor, action: "financial_account.create", entityType: "FinancialAccount", entityId: id,
    idempotencyKey, detail: `Opened ${input.accountType} account`,
    buildAfter: (a) => ({ id: a.id, householdId: a.householdId, accountType: a.accountType, status: a.status }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO financial_accounts (id,org_id,household_id,account_type,custodian,balance_minor_units,currency,status,open_date,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,$5,NULL,$6,'pending',NULL,$7,$8,$9,$10)",
        [id, p.orgId, input.householdId, input.accountType, input.custodian ?? null, currency, createdAt, prov.source, prov.asOf, prov.confidence],
      );
      return { id, orgId: p.orgId, householdId: input.householdId, accountType: input.accountType, custodian: input.custodian ?? null, balanceMinorUnits: null, currency, status: "pending", openDate: null, createdAt, provenance: prov };
    },
  });
}

export async function createTask(
  db: SqlDb, p: Principal, input: { householdId?: string | null; subject: string }, idempotencyKey?: string,
): Promise<Result<Task>> {
  const id = randomUUID();
  const createdAt = nowIso();
  const prov = houseProv();
  return auditedWrite<Task>({
    db, orgId: p.orgId, actor: p.actor, action: "task.create", entityType: "Task", entityId: id,
    idempotencyKey, detail: `Created task: ${input.subject}`,
    buildAfter: (t) => ({ id: t.id, subject: t.subject, status: t.status }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,'not-started',NULL,NULL,$5,$6,$7,$8)",
        [id, p.orgId, input.householdId ?? null, input.subject, createdAt, prov.source, prov.asOf, prov.confidence],
      );
      return { id, orgId: p.orgId, householdId: input.householdId ?? null, subject: input.subject, status: "not-started", dueDate: null, assigneeUserId: null, createdAt, provenance: prov };
    },
  });
}
