import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import {
  createContact,
  createFinancialAccount,
  createHousehold,
  createTask,
  listHouseholds,
} from "@infra/crm/house-crm";
import { createApplication } from "@infra/crm/application-store";
import {
  principalFromIdentity,
  systemWriteActor,
  type WriteActor,
} from "@contracts/principal";
import { registerTestSystemActor, systemTenant, type TenantContext } from "@contracts/tenant";
import {
  actorRefOf,
  authorizeGovernedAction,
} from "@contracts/authz";
import { makeExecutionStore } from "@infra/store/execution-store";
import {
  resumeFlow,
  retryFlow,
  type ExecutionStore,
  type FlowDefinition,
} from "@domain/workflow/engine";
import { auditedWrite } from "@infra/audit/audited-write";
import {
  verifyAndListOrgChain,
  verifyOrgChain,
} from "@infra/audit/audit-store";
import { unwrap } from "@contracts/result";

const TEST_SYSTEM_ACTOR = registerTestSystemActor("test");

/**
 * Tenant isolation through the REPOSITORY INTERFACE (v3 §15.2, invariant 2):
 * cross-tenant access fails, and a context that was not factory-minted cannot
 * parse — refused before any SQL runs, in the real adapters against the real
 * store.
 */
const ORG_A = "org-a";
const ORG_B = "org-b";
const tenantA = systemTenant(TEST_SYSTEM_ACTOR, ORG_A);
const tenantB = systemTenant(TEST_SYSTEM_ACTOR, ORG_B);
const piiGrant = (orgId: string, userId: string) =>
  unwrap(authorizeGovernedAction(actorRefOf(principalFromIdentity({
    userId,
    orgId,
    role: "advisor",
    actor: `${userId}@firm.test`,
    sessionId: `session-${userId}`,
  })), "pii.view"));
const grantA = piiGrant(ORG_A, "advisor-a");
const grantB = piiGrant(ORG_B, "advisor-b");
const auditGrant = (orgId: string, userId: string) =>
  unwrap(authorizeGovernedAction(actorRefOf(principalFromIdentity({
    userId,
    orgId,
    role: "ops",
    actor: `${userId}@firm.test`,
    sessionId: `session-${userId}`,
  })), "audit.export"));
const auditGrantA = auditGrant(ORG_A, "ops-a");
const auditGrantB = auditGrant(ORG_B, "ops-b");

describe("tenant isolation (integration)", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    const now = new Date().toISOString();
    for (const org of [ORG_A, ORG_B]) {
      await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')", [org, now]);
    }
    unwrap(await createHousehold(db, systemWriteActor("seed", ORG_A), { name: "Alpha Household" }));
    unwrap(await createHousehold(db, systemWriteActor("seed", ORG_B), { name: "Beta Household" }));
  });

  it("cross-tenant access fails: each tenant reads ONLY its own rows", async () => {
    const a = await listHouseholds(db, grantA);
    const b = await listHouseholds(db, grantB);
    expect(a.map((h) => h.orgId)).toEqual([ORG_A]);
    expect(b.map((h) => h.orgId)).toEqual([ORG_B]);
    expect(a[0]!.name).toBe("Alpha Household");
    expect(b[0]!.name).toBe("Beta Household");
  });

  it("a tenant context alone cannot invoke the governed PII read sink", async () => {
    await expect(listHouseholds(db, tenantA as never)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("tenant-qualified parent relationships reject cross-tenant references", async () => {
    const householdA = (await listHouseholds(db, grantA))[0]!;
    const actorA = systemWriteActor("seed", ORG_A);
    const actorB = systemWriteActor("seed", ORG_B);
    const contactA = unwrap(await createContact(db, actorA, {
      householdId: householdA.id,
      firstName: "Alpha",
      lastName: "Contact",
    }));

    expect((await createContact(db, actorB, {
      householdId: householdA.id,
      firstName: "Cross",
      lastName: "Tenant",
    })).ok).toBe(false);
    expect((await createFinancialAccount(db, actorB, {
      householdId: householdA.id,
      accountType: "individual",
    })).ok).toBe(false);
    expect((await createTask(db, actorB, {
      householdId: householdA.id,
      subject: "Cross-tenant task",
    })).ok).toBe(false);
    expect((await createApplication(db, actorB, {
      householdId: householdA.id,
      contactId: contactA.id,
      accountType: "individual",
    })).ok).toBe(false);

    for (const table of ["contacts", "financial_accounts", "tasks", "account_opening_applications"]) {
      const count = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${table} WHERE org_id = $1`,
        [ORG_B],
      );
      expect(Number(count.rows[0]!.n), table).toBe(0);
    }
  });

  it("an impostor context cannot parse: a cast never reaches SQL", async () => {
    const impostor = { orgId: ORG_A } as unknown as TenantContext;
    await expect(verifyOrgChain(db, impostor)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("a SPREAD copy of a real context is refused too (the seal does not survive copying)", async () => {
    const spread = { ...tenantA } as TenantContext;
    await expect(verifyOrgChain(db, spread)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("the write chokepoint refuses an impostor BEFORE any business write or audit row", async () => {
    const impostor = { orgId: ORG_A } as unknown as TenantContext;
    const actor = { tenant: impostor, actorUserId: "evil", delegatedBy: null } as unknown as WriteActor;
    await expect(
      auditedWrite({ db, actor, action: "household.create", entityType: "Household", entityId: "x", detail: "d", perform: async () => ({}) }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    const outbox = await db.query<{ n: string }>("SELECT count(*) AS n FROM audit_outbox WHERE org_id = $1", [ORG_A]);
    expect(Number(outbox.rows[0]!.n)).toBe(0);
  });

  it("the write chokepoint refuses actor attribution paired with a borrowed tenant", async () => {
    const forged = { tenant: tenantA, actorUserId: "forged-user" } as unknown as WriteActor;
    await expect(
      createHousehold(db, forged, { name: "Forged Attribution" }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    const households = await listHouseholds(db, grantA);
    expect(households.map((household) => household.name)).not.toContain("Forged Attribution");
  });

  it("execution continuations are tenant-scoped: a guessed foreign execution id reads as absent", async () => {
    const store = makeExecutionStore(db);
    const state = { id: "exec-1", orgId: ORG_A, flowId: "f", status: "suspended" as const, resumeToken: "tok-cross", cursor: 1, data: {} };
    await store.create(state, tenantA);
    expect(await store.loadById("exec-1", grantA)).not.toBeNull();
    expect(await store.loadById("exec-1", grantB)).toBeNull();
  });

  it("saving a state under the wrong tenant is refused (org/tenant mismatch is a wiring bug)", async () => {
    const store = makeExecutionStore(db);
    const state = { id: "exec-2", orgId: ORG_A, flowId: "f", status: "running" as const, resumeToken: null, cursor: 0, data: {} };
    await expect(store.create(state, tenantB)).rejects.toMatchObject({ code: "INTERNAL" });
    await store.create(state, tenantA);
    await expect(store.save({ ...state, cursor: 1 }, tenantB)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("a webhook resume under the wrong tenant reads as not-found (token/org mismatch never leaks state)", async () => {
    const store = makeExecutionStore(db);
    await store.create({ id: "exec-3", orgId: ORG_A, flowId: "noop", status: "suspended", resumeToken: "tok-a", cursor: 1, data: {} }, tenantA);
    const noop: FlowDefinition<Record<string, never>> = { id: "noop", name: "noop", steps: [] };
    const crossed = await resumeFlow(noop, store, {}, "tok-a", {}, tenantB);
    expect(crossed.status).toBe("not-found");
    const legit = await resumeFlow(noop, store, {}, "tok-a", {}, tenantA);
    expect(legit.status).toBe("completed");
  });

  it("a forged matching-org context is refused before loading or exposing a continuation", async () => {
    const store = makeExecutionStore(db);
    await store.create({
      id: "exec-forged-resume",
      orgId: ORG_A,
      flowId: "resume-write",
      status: "suspended",
      resumeToken: "tok-forged-resume",
      cursor: 0,
      data: { foreignName: "Sentinel Foreign Client" },
    }, tenantA);
    let loads = 0;
    let saves = 0;
    let stepRuns = 0;
    const trackingStore: ExecutionStore = {
      create: (next, tenant) => store.create(next, tenant),
      save: (next, tenant) => {
        saves += 1;
        return store.save(next, tenant);
      },
      loadById: (id, grant) => store.loadById(id, grant),
      loadByToken: (token) => {
        loads += 1;
        return store.loadByToken(token);
      },
    };
    const flow: FlowDefinition<Record<string, never>> = {
      id: "resume-write",
      name: "resume-write",
      steps: [{
        id: "write",
        name: "write",
        execute: async () => {
          stepRuns += 1;
          unwrap(await createHousehold(db, systemWriteActor("seed", ORG_A), {
            name: "Forged Resume Household",
          }));
          return { kind: "continue" };
        },
      }],
    };
    const forged = {
      orgId: ORG_A,
      actor: tenantA.actor,
    } as unknown as TenantContext;
    await expect(
      resumeFlow(
        flow,
        trackingStore,
        {},
        "tok-forged-resume",
        { signed: true },
        forged,
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL",
      message: expect.not.stringContaining("Sentinel Foreign Client"),
    });
    expect(loads).toBe(0);
    expect(saves).toBe(0);
    expect(stepRuns).toBe(0);
    const rows = await listHouseholds(db, grantA);
    expect(rows.map((row) => row.name)).not.toContain("Forged Resume Household");
  });

  it("a failed execution cannot be retried under another tenant before step work", async () => {
    const store = makeExecutionStore(db);
    const state = {
      id: "exec-retry-crossed",
      orgId: ORG_A,
      flowId: "retry-write",
      status: "failed" as const,
      resumeToken: null,
      cursor: 0,
      data: { foreignName: "Sentinel Foreign Client" },
    };
    await store.create(state, tenantA);
    let stepRuns = 0;
    let saveCalls = 0;
    const trackingStore: ExecutionStore = {
      create: (next, tenant) => store.create(next, tenant),
      save: (next, tenant) => {
        saveCalls += 1;
        return store.save(next, tenant);
      },
      loadById: (id, grant) => store.loadById(id, grant),
      loadByToken: (token) => store.loadByToken(token),
    };
    const flow: FlowDefinition<Record<string, never>> = {
      id: "retry-write",
      name: "retry-write",
      steps: [{
        id: "write",
        name: "write",
        execute: async () => {
          stepRuns += 1;
          unwrap(await createHousehold(db, systemWriteActor("seed", ORG_B), {
            name: "Crossed Retry Household",
          }));
          return { kind: "continue" };
        },
      }],
    };
    const result = await retryFlow(flow, trackingStore, {}, state, tenantB);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AUTH_FAILED");
    expect(result.data).toEqual({});
    expect(stepRuns).toBe(0);
    expect(saveCalls).toBe(0);
    const rows = await listHouseholds(db, grantB);
    expect(rows.map((row) => row.name)).not.toContain("Crossed Retry Household");
  });

  it("audit chains are per-tenant through the repository API", async () => {
    const chainA = (await verifyAndListOrgChain(db, auditGrantA)).rows;
    const chainB = (await verifyAndListOrgChain(db, auditGrantB)).rows;
    // BOTH floors: `every` on an empty array is vacuously true, so without a
    // floor for chainB a regression that made ORG_B's chain unreachable would
    // leave this — the integration proof for v3 invariant 2 — green.
    expect(chainA.length).toBeGreaterThan(0);
    expect(chainB.length).toBeGreaterThan(0);
    expect(chainA.every((r) => r.orgId === ORG_A)).toBe(true);
    expect(chainB.every((r) => r.orgId === ORG_B)).toBe(true);
  });
});
