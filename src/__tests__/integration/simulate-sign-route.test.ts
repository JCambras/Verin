import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";
import { startAccountOpening } from "@infra/wire";
import { principalFromIdentity } from "@contracts/principal";
import { actorRefOf, authorizeGovernedAction } from "@contracts/authz";

/**
 * THE SURFACE THE SHIPPED DEMO JOURNEY ACTUALLY CLICKS.
 *
 * `/api/esign/simulate-sign` drives the same finalize path the external provider's
 * webhook does, for an ADVISOR sitting in front of a browser - which is why it
 * mattered disproportionately that it once forwarded the raw `AppError`: a
 * superseded configuration version answered 409 with the internal message and no
 * typed instruction, on the one screen a person is watching.
 *
 * It now answers in the shared refusal shape (D-241), and this asserts the two
 * halves that kept going missing: the typed instruction with its pacing, and the
 * REFERENCE the refusal minted - which is the only thing the advisor can hand to
 * operations, and which the reporting surfaces discarded for three rounds while
 * the refusal, the log line and the fence all agreed it existed (D-244).
 */
const cookieStore = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const ORG = "org-simulate-sign-route";
const SESSION = "s-simulate-sign-route";
const globalStore = globalThis as unknown as { __verinDb?: Promise<SqlDb> };

const advisorPrincipal = principalFromIdentity({
  userId: "u-simulate-sign", orgId: ORG, role: "advisor", actor: "advisor@firm.test", sessionId: SESSION,
});
const executionAuthorization = authorizeGovernedAction(actorRefOf(advisorPrincipal), "execution.initiate");
const piiAuthorization = authorizeGovernedAction(actorRefOf(advisorPrincipal), "pii.view");
if (!executionAuthorization.ok || !piiAuthorization.ok) throw new Error("advisor should hold both grants");

let db: SqlDb;

async function sign(token: string): Promise<Response> {
  const req = new NextRequest("http://localhost/api/esign/simulate-sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  req.cookies.set(SESSION_COOKIE, signSessionCookie(SESSION));
  const { POST } = await import("@app/api/esign/simulate-sign/route");
  return POST(req);
}

describe("POST /api/esign/simulate-sign answers a refusal in the shared shape", () => {
  beforeEach(async () => {
    cookieStore.set.mockClear();
    db = await createMemoryDb();
    globalStore.__verinDb = Promise.resolve(db);
    const now = new Date().toISOString();
    await db.query(
      "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')",
      [ORG, now],
    );
    // The user row carries the id the principal above names, so the flow's audit
    // writes resolve the same actor the request is authenticated as.
    await db.query(
      "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('u-simulate-sign',$1,'advisor@firm.test','Demo Advisor','advisor','active',$2,'verin-crm',$2,'high')",
      [ORG, now],
    );
    await db.query(
      "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ($1,'u-simulate-sign',$2,'advisor',$3,$4,NULL)",
      [SESSION, ORG, now, new Date(Date.now() + 50 * 60_000).toISOString()],
    );
  });

  it("answers a superseded configuration version with retry-later, paced, and a quotable reference", async () => {
    const started = await startAccountOpening(db, executionAuthorization.value, piiAuthorization.value, {
      householdName: "Demo Household", firstName: "Ada", lastName: "Demo", email: null, accountType: "individual",
    });
    expect(started.status).toBe("suspended");
    const persisted = await db.query<{ context_json: string }>(
      "SELECT context_json FROM flow_executions WHERE id = $1",
      [started.executionId],
    );
    const context = JSON.parse(persisted.rows[0]!.context_json) as { cursor: number; data: Record<string, unknown> };
    await db.query("UPDATE flow_executions SET context_json = $2 WHERE id = $1", [
      started.executionId,
      JSON.stringify({ ...context, data: { ...context.data, domainConfigVersionId: "account-opening@2026.09.0" } }),
    ]);

    const response = await sign(started.token!);
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await response.json()) as { retry?: string; error?: { code?: string; message?: string } };
    expect(body.retry).toBe("retry-later");
    // The taxonomy stays in the log line, and the reference comes to the screen.
    expect(body.error?.code).toBeUndefined();
    expect(body.error?.message).toMatch(/Quote reference [0-9a-f-]{36}\./);
    // The two configuration version ids are deployment internals (D-242), and the
    // sentence is this deployment's, not the refusal's own.
    expect(body.error?.message).not.toContain("2026.09.0");
    expect(body.error?.message).toContain("operations team");
  });

  it("still finalizes the account opening when the configuration is the one it started under", async () => {
    const started = await startAccountOpening(db, executionAuthorization.value, piiAuthorization.value, {
      householdName: "Completing Household", firstName: "Grace", lastName: "Demo", email: null, accountType: "individual",
    });
    expect(started.status).toBe("suspended");
    const response = await sign(started.token!);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status?: string }).status).toBe("completed");
  });
});
