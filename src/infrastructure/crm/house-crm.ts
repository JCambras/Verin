/**
 * House-CRM adapter (ADR-0004). The first real adapter behind the CRM boundary:
 * genuine persistence, canonical schema as its schema. EVERY mutation routes
 * through auditedWrite (audited-write-required + anti-fork fences) and is
 * attributed to a narrow WriteActor (never a fabricated Principal, D-028);
 * EVERY call requires a sealed TenantContext (v3 §15.2). Writes carry it inside
 * the WriteActor, and governed reads derive it from an action grant, so org_id is never client-supplied
 * and a hand-rolled context cannot parse. Provenance source = verin-crm on
 * every row (charter #3).
 */
import { randomUUID } from "node:crypto";
import type { SqlDb } from "@infra/store/db";
import { auditedWrite } from "@infra/audit/audited-write";
import type { Result } from "@contracts/result";
import { assertWriteActor, type WriteActor } from "@contracts/principal";
import { assertTenantContext } from "@contracts/tenant";
import {
  assertActionGrant,
  type ActionGrant,
} from "@contracts/authz";
import type { PIIBearing } from "@contracts/pii";
import type { MachineRecordId } from "@contracts/record-id";
import type { Household, Contact, FinancialAccount, Task, AccountType, HouseholdStatus } from "@domain/schema/entities";
import type { RecordProvenance } from "@contracts/provenance";

const nowIso = () => new Date().toISOString();
const houseProv = (): RecordProvenance => ({ source: "verin-crm", asOf: nowIso(), confidence: "high" });

interface HouseholdRow extends PIIBearing {
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
  db: SqlDb, a: WriteActor, input: { name: string; status?: HouseholdStatus }, idempotencyKey?: string,
): Promise<Result<Household>> {
  assertWriteActor(a);
  const id = randomUUID();
  const createdAt = nowIso();
  const prov = houseProv();
  const status: HouseholdStatus = input.status ?? "prospect";
  // A DELEGATED write actor carries a real human actorUserId while its tenant
  // actor is the delegating SYSTEM (that is what delegatedWriteActor exists for),
  // so keying on the tenant actor's kind alone would drop advisor attribution
  // for exactly the case the factory was built to serve.
  const attributedToHuman = a.delegatedBy !== null || a.tenant.actor.kind === "human";
  const advisorUserId = attributedToHuman ? a.actorUserId : null;
  return auditedWrite<Household>({
    // detail is PII-minimized (no client name); entityId identifies the record.
    db, actor: a, action: "household.create", entityType: "Household", entityId: id,
    idempotencyKey, detail: "Created a household",
    buildAfter: (h) => ({ id: h.id, name: h.name, status: h.status }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9)",
        [id, a.tenant.orgId, input.name, advisorUserId, status, createdAt, prov.source, prov.asOf, prov.confidence],
      );
      return { id, orgId: a.tenant.orgId, name: input.name, primaryContactId: null, advisorUserId, status, createdAt, provenance: prov };
    },
  });
}

/**
 * Rename a household - and re-stamp the VALUE's provenance, because a human just
 * typed it. A seeded demonstration household carries `prov_source = 'fixture'`,
 * and leaving it there would render the advisor's own words receded under a
 * "Sample data" label: the mislabel charter #3 exists to prevent, in the
 * direction nobody watches.
 *
 * `record_origin` is deliberately NOT touched. Where a row came from is a
 * different fact from where its values came from, and editing a demonstration
 * record does not make it the firm's own - if it did, demo data would survive a
 * clean-slate purge simply because somebody renamed it.
 */
export async function updateHouseholdName(
  db: SqlDb,
  a: WriteActor,
  id: MachineRecordId<"household">,
  name: string,
): Promise<Result<Household>> {
  assertWriteActor(a);
  // The before-snapshot is read INSIDE the write transaction (FOR UPDATE row
  // lock), so the audited pre-image can never race a concurrent rename.
  let oldName: string | null = null;
  const entered: RecordProvenance = { source: "user-input", asOf: nowIso(), confidence: "high" };
  return auditedWrite<Household>({
    db, actor: a, action: "household.update", entityType: "Household", entityId: id,
    buildBefore: () => (oldName == null ? undefined : { name: oldName }),
    buildAfter: () => ({ name }), detail: "Renamed a household",
    perform: async (tx) => {
      const existing = await tx.query<{ name: string }>(
        "SELECT name FROM households WHERE id = $1 AND org_id = $2 FOR UPDATE",
        [id, a.tenant.orgId],
      );
      if (existing.rows.length !== 1) throw { code: "NOT_FOUND", message: "Household not found." };
      oldName = existing.rows[0]!.name;
      const res = await tx.query<HouseholdRow>(
        "UPDATE households SET name = $3, prov_source = $4, prov_asof = $5, prov_confidence = $6 WHERE id = $1 AND org_id = $2 RETURNING *",
        [id, a.tenant.orgId, name, entered.source, entered.asOf, entered.confidence],
      );
      if (res.rows.length !== 1) throw { code: "NOT_FOUND", message: "Household not found." };
      return toHousehold(res.rows[0]!);
    },
  });
}

export async function listHouseholds(
  db: SqlDb,
  grant: ActionGrant<"pii.view">,
): Promise<Household[]> {
  assertActionGrant(grant, "pii.view");
  const tenant = grant.tenant;
  assertTenantContext(tenant);
  const res = await db.query<HouseholdRow>("SELECT * FROM households WHERE org_id = $1 ORDER BY created_at DESC", [tenant.orgId]);
  return res.rows.map(toHousehold);
}

/**
 * One household by its record id, scoped to the grant's org. The household
 * surface authorizes through THIS read rather than through the world fixture:
 * the CRM is the authority on which households a tenant may see, and the
 * evidence port only ever supplies depth for an id that already passed here.
 */
export async function getHouseholdById(
  db: SqlDb,
  grant: ActionGrant<"pii.view">,
  id: MachineRecordId<"household">,
): Promise<Household | null> {
  assertActionGrant(grant, "pii.view");
  const tenant = grant.tenant;
  assertTenantContext(tenant);
  const res = await db.query<HouseholdRow>(
    "SELECT * FROM households WHERE id = $1 AND org_id = $2",
    [id, tenant.orgId],
  );
  return res.rows.length === 1 ? toHousehold(res.rows[0]!) : null;
}

export async function createContact(
  db: SqlDb, a: WriteActor, input: { householdId: string; firstName: string; lastName: string; email?: string | null; phone?: string | null }, idempotencyKey?: string,
): Promise<Result<Contact>> {
  assertWriteActor(a);
  const id = randomUUID();
  const createdAt = nowIso();
  const prov = houseProv();
  return auditedWrite<Contact>({
    db, actor: a, action: "contact.create", entityType: "Contact", entityId: id,
    idempotencyKey, detail: `Added contact to household`,
    // NOTE: before/after are scrubbed by the audit boundary, so PII (name/email) is redacted in the trail.
    buildAfter: (c) => ({ id: c.id, householdId: c.householdId, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO contacts (id,org_id,household_id,first_name,last_name,email,phone,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [id, a.tenant.orgId, input.householdId, input.firstName, input.lastName, input.email ?? null, input.phone ?? null, createdAt, prov.source, prov.asOf, prov.confidence],
      );
      return { id, orgId: a.tenant.orgId, householdId: input.householdId, firstName: input.firstName, lastName: input.lastName, email: input.email ?? null, phone: input.phone ?? null, createdAt, provenance: prov };
    },
  });
}

export async function createFinancialAccount(
  db: SqlDb, a: WriteActor,
  input: { householdId: string; accountType: AccountType; custodian?: string | null; currency?: string; openDate?: string | null },
  idempotencyKey?: string,
): Promise<Result<FinancialAccount>> {
  assertWriteActor(a);
  const id = randomUUID();
  const createdAt = nowIso();
  const prov = houseProv();
  const currency = input.currency ?? "USD";
  // An account created with an openDate (finalize passes the e-sign timestamp) IS
  // open; without one it awaits its opening event as 'pending' (finding #2: the
  // store must never say 'pending' forever while the product says "Account opened").
  const openDate = input.openDate ?? null;
  const status: FinancialAccount["status"] = openDate ? "open" : "pending";
  return auditedWrite<FinancialAccount>({
    db, actor: a, action: "financial_account.create", entityType: "FinancialAccount", entityId: id,
    idempotencyKey, detail: `Opened ${input.accountType} account`,
    buildAfter: (acct) => ({ id: acct.id, householdId: acct.householdId, accountType: acct.accountType, status: acct.status }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO financial_accounts (id,org_id,household_id,account_type,custodian,balance_minor_units,currency,status,open_date,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12)",
        [id, a.tenant.orgId, input.householdId, input.accountType, input.custodian ?? null, currency, status, openDate, createdAt, prov.source, prov.asOf, prov.confidence],
      );
      return { id, orgId: a.tenant.orgId, householdId: input.householdId, accountType: input.accountType, custodian: input.custodian ?? null, balanceMinorUnits: null, currency, status, openDate, createdAt, provenance: prov };
    },
  });
}

export async function createTask(
  db: SqlDb, a: WriteActor, input: { householdId?: string | null; subject: string }, idempotencyKey?: string,
): Promise<Result<Task>> {
  assertWriteActor(a);
  const id = randomUUID();
  const createdAt = nowIso();
  const prov = houseProv();
  return auditedWrite<Task>({
    db, actor: a, action: "task.create", entityType: "Task", entityId: id,
    idempotencyKey, detail: `Created task: ${input.subject}`,
    buildAfter: (t) => ({ id: t.id, subject: t.subject, status: t.status }),
    perform: async (tx) => {
      await tx.query(
        "INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,$4,'not-started',NULL,NULL,$5,$6,$7,$8)",
        [id, a.tenant.orgId, input.householdId ?? null, input.subject, createdAt, prov.source, prov.asOf, prov.confidence],
      );
      return { id, orgId: a.tenant.orgId, householdId: input.householdId ?? null, subject: input.subject, status: "not-started", dueDate: null, assigneeUserId: null, createdAt, provenance: prov };
    },
  });
}
