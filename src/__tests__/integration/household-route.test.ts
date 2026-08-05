import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { registerTestSystemActor, systemTenant } from "@contracts/tenant";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createUser } from "@infra/identity/identity-store";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";
import { log } from "@infra/observability/logger";
import { readObservabilityId } from "@domain/observability/safe-values";

const cookieStore = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const TEST_SYSTEM_ACTOR = registerTestSystemActor("test");
const ORG = "org-household-route";
const HOUSEHOLD_ID = "123e4567-e89b-12d3-a456-123456789012";
const ACCOUNT_SHAPED_ID = "00000000-0000-0000-0000-941000517334";
const globalStore = globalThis as unknown as { __verinDb?: Promise<SqlDb> };

let db: SqlDb;

async function request(id: string, name: string): Promise<Response> {
  const req = new NextRequest("http://localhost/api/crm/households", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, name }),
  });
  req.cookies.set(SESSION_COOKIE, signSessionCookie("s-household-route"));
  const { PATCH } = await import("@app/api/crm/households/route");
  return PATCH(req);
}

describe("PATCH /api/crm/households record identity", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    cookieStore.set.mockClear();
    db = await createMemoryDb();
    globalStore.__verinDb = Promise.resolve(db);
    const now = new Date().toISOString();
    await db.query(
      "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')",
      [ORG, now],
    );
    const user = await createUser(db, systemTenant(TEST_SYSTEM_ACTOR, ORG), {
      email: "ops-household@firm.test",
      displayName: "Household Operator",
      role: "ops",
      password: "correct-horse-battery",
    });
    await db.query(
      "INSERT INTO sessions (id,lineage_id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ('s-household-route','lineage-household-route',$1,$2,'ops',$3,$4,NULL)",
      [user.id, ORG, now, new Date(Date.now() + 50 * 60_000).toISOString()],
    );
    await db.query(
      "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,'Before',NULL,NULL,'active',$3,'verin-crm',$3,'high')",
      [HOUSEHOLD_ID, ORG, now],
    );
  });

  it("rejects a client-supplied lowercase slug before repository work", async () => {
    const response = await request("alice", "After");
    expect(response.status).toBe(400);
    const row = await db.query<{ name: string }>(
      "SELECT name FROM households WHERE id = $1",
      [HOUSEHOLD_ID],
    );
    expect(row.rows[0]!.name).toBe("Before");
    const audit = await db.query("SELECT id FROM audit_log");
    expect(audit.rows).toHaveLength(0);
  });

  it("canonicalizes a legacy mixed-case UUID before lookup", async () => {
    const response = await request(HOUSEHOLD_ID.toUpperCase(), "After");
    expect(response.status).toBe(200);
    const row = await db.query<{ name: string }>(
      "SELECT name FROM households WHERE id = $1",
      [HOUSEHOLD_ID],
    );
    expect(row.rows[0]!.name).toBe("After");
  });

  it("hashes a client household id in failure logs without suppressing its audit", async () => {
    const info = vi.spyOn(log, "info");
    const response = await request(ACCOUNT_SHAPED_ID, "After");
    expect(response.status).toBe(404);
    const call = info.mock.calls.find((entry) => entry[1] === "audited write failed");
    expect(call).toBeTruthy();
    const logged = readObservabilityId(
      (call![0] as { entityId?: unknown }).entityId,
      "entityId",
    );
    expect(logged).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(logged).not.toContain("941000517334");
    const audit = await db.query<{ entity_id: string; action: string }>(
      "SELECT entity_id, action FROM audit_log ORDER BY sequence",
    );
    expect(audit.rows).toContainEqual({
      entity_id: ACCOUNT_SHAPED_ID,
      action: "household.update.failed",
    });
  });
});
