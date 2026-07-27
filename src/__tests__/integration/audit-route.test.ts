import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { registerTestSystemActor, systemTenant } from "@contracts/tenant";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createUser } from "@infra/identity/identity-store";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";

/**
 * THE AUDIT ROUTE'S TWO GRANTS, ACROSS A SESSION ROTATION (D-051 correction).
 *
 * `/api/audit` binds `audit.export` AND `pii.view` — exporting the chain and
 * resolving actor userIds to raw emails are different authorities. Each bind runs
 * requireActionGrant, and requirePrincipal SLIDES a session past its half-life:
 * it rotates the session id and writes the new cookie to the RESPONSE, while
 * `req.cookies` still holds the id the client presented. A second resolution on
 * the same request would therefore look up an id renewal already deleted and 401
 * — invisible to any test whose session is fresh, and to the user a bare "Could
 * not load the audit trail." roughly 30 minutes into a 60-minute TTL.
 *
 * Both sessions below are driven through the REAL route handler against real
 * PGlite: the aged one is the regression, the fresh one guards the ordinary path.
 */

const cookieStore = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const TEST_SYSTEM_ACTOR = registerTestSystemActor("test");
const ORG = "org-1";
const TTL_MINUTES = 60; // vitest.config.ts
const MIN = 60_000;

const globalStore = globalThis as unknown as { __verinDb?: Promise<SqlDb> };

let db: SqlDb;
let userId: string;

async function seed(): Promise<void> {
  const now = new Date().toISOString();
  await db.query(
    "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')",
    [ORG, now],
  );
  const user = await createUser(db, systemTenant(TEST_SYSTEM_ACTOR, ORG), {
    email: "ops@firm.test",
    displayName: "O Ops",
    role: "ops",
    password: "correct-horse-battery",
  });
  userId = user.id;
}

async function insertSession(id: string, expiresInMs: number): Promise<void> {
  const now = Date.now();
  await db.query(
    "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ($1,$2,$3,'ops',$4,$5,NULL)",
    [
      id,
      userId,
      ORG,
      new Date(now - TTL_MINUTES * MIN).toISOString(),
      new Date(now + expiresInMs).toISOString(),
    ],
  );
}

function auditRequest(sessionId: string): NextRequest {
  const req = new NextRequest("http://localhost/api/audit");
  req.cookies.set(SESSION_COOKIE, signSessionCookie(sessionId));
  return req;
}

describe("GET /api/audit: two grants on one request (integration)", () => {
  beforeEach(async () => {
    cookieStore.set.mockClear();
    db = await createMemoryDb();
    globalStore.__verinDb = Promise.resolve(db);
    await seed();
  });

  it("serves an aged (past half-life) session, rotating exactly once", async () => {
    await insertSession("s-aging", 20 * MIN); // 20m left of a 60m TTL -> renews
    const { GET } = await import("@app/api/audit/route");

    const response = await GET(auditRequest("s-aging"));

    expect(response.status).toBe(200);
    const body = await response.json() as { verdict: { ok: boolean }; entries: unknown[] };
    expect(body.verdict.ok).toBe(true);
    expect(Array.isArray(body.entries)).toBe(true);
    // Renewal happened ONCE: a second identity resolution would have rotated
    // again (or, before the fix, failed against the already-rotated id).
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const rows = await db.query<{ id: string }>("SELECT id FROM sessions");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.id).not.toBe("s-aging");
  });

  it("serves a fresh session with no rotation at all", async () => {
    await insertSession("s-fresh", 50 * MIN);
    const { GET } = await import("@app/api/audit/route");

    const response = await GET(auditRequest("s-fresh"));

    expect(response.status).toBe(200);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("stays FAIL-CLOSED: a role without audit.export is refused", async () => {
    await db.query("UPDATE users SET role = 'advisor' WHERE id = $1", [userId]);
    await insertSession("s-advisor", 50 * MIN);
    const { GET } = await import("@app/api/audit/route");

    // advisor holds pii.view but NOT audit.export — both grants are required, so
    // holding one is not enough.
    const response = await GET(auditRequest("s-advisor"));
    expect(response.status).toBe(403);
  });

  it("stays FAIL-CLOSED: an unauthenticated request never reaches the chain", async () => {
    const { GET } = await import("@app/api/audit/route");
    const response = await GET(new NextRequest("http://localhost/api/audit"));
    expect(response.status).toBe(401);
  });
});
