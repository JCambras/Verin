import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createHousehold, listHouseholds } from "@infra/crm/house-crm";
import { systemWriteActor } from "@contracts/principal";
import { systemTenant, type TenantContext } from "@contracts/tenant";
import { makeExecutionStore } from "@infra/store/execution-store";
import { resumeFlow, type FlowDefinition } from "@domain/workflow/engine";
import { auditedWrite } from "@infra/audit/audited-write";
import { listOrgChain } from "@infra/audit/audit-store";
import { unwrap } from "@contracts/result";

/**
 * Tenant isolation through the REPOSITORY INTERFACE (v3 §15.2, invariant 2):
 * cross-tenant access fails, and a context that was not factory-minted cannot
 * parse — refused before any SQL runs, in the real adapters against the real
 * store.
 */
const ORG_A = "org-a";
const ORG_B = "org-b";
const tenantA = systemTenant("test", ORG_A);
const tenantB = systemTenant("test", ORG_B);

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
    const a = await listHouseholds(db, tenantA);
    const b = await listHouseholds(db, tenantB);
    expect(a.map((h) => h.orgId)).toEqual([ORG_A]);
    expect(b.map((h) => h.orgId)).toEqual([ORG_B]);
    expect(a[0]!.name).toBe("Alpha Household");
    expect(b[0]!.name).toBe("Beta Household");
  });

  it("an impostor context cannot parse: a cast never reaches SQL", async () => {
    const impostor = { orgId: ORG_A } as unknown as TenantContext;
    await expect(listHouseholds(db, impostor)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("a SPREAD copy of a real context is refused too (the seal does not survive copying)", async () => {
    const spread = { ...tenantA } as TenantContext;
    await expect(listHouseholds(db, spread)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("the write chokepoint refuses an impostor BEFORE any business write or audit row", async () => {
    const impostor = { orgId: ORG_A } as unknown as TenantContext;
    await expect(
      auditedWrite({ db, tenant: impostor, actor: "evil", action: "x.create", entityType: "X", entityId: "x", detail: "d", perform: async () => ({}) }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    const outbox = await db.query<{ n: string }>("SELECT count(*) AS n FROM audit_outbox WHERE org_id = $1", [ORG_A]);
    expect(Number(outbox.rows[0]!.n)).toBe(0);
  });

  it("execution continuations are tenant-scoped: a guessed foreign execution id reads as absent", async () => {
    const store = makeExecutionStore(db);
    const state = { id: "exec-1", orgId: ORG_A, flowId: "f", status: "suspended" as const, resumeToken: "tok-cross", cursor: 1, data: {} };
    await store.create(state, tenantA);
    expect(await store.loadById("exec-1", tenantA)).not.toBeNull();
    expect(await store.loadById("exec-1", tenantB)).toBeNull();
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

  it("audit chains are per-tenant through the repository API", async () => {
    const chainA = await listOrgChain(db, tenantA);
    const chainB = await listOrgChain(db, tenantB);
    expect(chainA.length).toBeGreaterThan(0);
    expect(chainA.every((r) => r.orgId === ORG_A)).toBe(true);
    expect(chainB.every((r) => r.orgId === ORG_B)).toBe(true);
  });
});
