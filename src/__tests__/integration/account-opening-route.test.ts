import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { registerTestSystemActor, systemTenant } from "@contracts/tenant";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createUser } from "@infra/identity/identity-store";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";

/**
 * THE ACCOUNT-OPENING REQUEST BOUNDARY (regression, prompt 10 / ADR-0056).
 *
 * This is the assertion that stops one specific regression recurring. The
 * migration to configuration briefly moved the registration-vocabulary check out
 * of this route: an unsupported registration was then refused by the execution
 * adapter at the THIRD compiled step, AFTER `household.create` and
 * `contact.create` had committed - an orphan household, an orphan contact, and a
 * persisted failed execution where the previous code refused with a clean 400 and
 * zero writes. So the test asserts the RECORD COUNTS, not merely the status code:
 * a 400 alone would have passed while the partial write happened.
 *
 * The refusal is DERIVED from the document (`admitIntakeSubmission` over the
 * projected form), and RULE G of the domain-configuration fence binds the
 * document's declared registrations to the vocabulary the store accepts, so the
 * boundary can neither disagree with the configuration nor admit a value the
 * adapter would refuse.
 */
const cookieStore = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

/**
 * A DOCUMENT that declares a trigger field this deployment's fixed start input
 * has no room for. It cannot be authored in `config/domains/account-opening.yaml`
 * (the file is content-hash pinned and the route would then be broken for every
 * other case), so the published form is projected and one extra field appended -
 * exactly what adding a slot would produce. Null for every other test, which
 * leaves `loadIntakeForm` the real one.
 */
const injected = vi.hoisted(() => ({
  extraField: null as null | { field: string; label: string; type: "text"; required: boolean },
}));
vi.mock("@infra/config/domain-config-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@infra/config/domain-config-source")>();
  return {
    ...actual,
    loadIntakeForm: (domainConfigId: string) => {
      const form = actual.loadIntakeForm(domainConfigId);
      if (injected.extraField === null || !form.ok) return form;
      return { ok: true as const, value: { ...form.value, fields: [...form.value.fields, injected.extraField] } };
    },
  };
});

const TEST_SYSTEM_ACTOR = registerTestSystemActor("test");
const ORG = "org-account-opening-route";
const SESSION = "s-account-opening-route";
const globalStore = globalThis as unknown as { __verinDb?: Promise<SqlDb> };

const SUBMISSION = {
  householdName: "Boundary Household",
  firstName: "Ada",
  lastName: "Boundary",
  email: "ada@example.test",
  accountType: "ira-roth",
  clientRequestId: "3f1c8a52-4d7b-4e6a-9c11-0a2b3c4d5e6f",
};

let db: SqlDb;

async function post(body: Readonly<Record<string, unknown>>): Promise<Response> {
  const req = new NextRequest("http://localhost/api/flows/account-opening", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  req.cookies.set(SESSION_COOKIE, signSessionCookie(SESSION));
  const { POST } = await import("@app/api/flows/account-opening/route");
  return POST(req);
}

async function rowCounts(): Promise<Record<string, number>> {
  const of = async (sql: string): Promise<number> => {
    const result = await db.query<{ n: string }>(sql, [ORG]);
    return Number(result.rows[0]!.n);
  };
  return {
    households: await of("SELECT count(*) AS n FROM households WHERE org_id = $1"),
    contacts: await of("SELECT count(*) AS n FROM contacts WHERE org_id = $1"),
    applications: await of("SELECT count(*) AS n FROM account_opening_applications WHERE org_id = $1"),
    executions: await of("SELECT count(*) AS n FROM flow_executions WHERE org_id = $1"),
  };
}

describe("POST /api/flows/account-opening refuses an undeclared registration at the boundary", () => {
  beforeEach(async () => {
    cookieStore.set.mockClear();
    injected.extraField = null;
    db = await createMemoryDb();
    globalStore.__verinDb = Promise.resolve(db);
    const now = new Date().toISOString();
    await db.query(
      "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')",
      [ORG, now],
    );
    const user = await createUser(db, systemTenant(TEST_SYSTEM_ACTOR, ORG), {
      email: "advisor-route@firm.test",
      displayName: "Route Advisor",
      role: "advisor",
      password: "correct-horse-battery",
    });
    await db.query(
      "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ($1,$2,$3,'advisor',$4,$5,NULL)",
      [SESSION, user.id, ORG, now, new Date(Date.now() + 50 * 60_000).toISOString()],
    );
  });

  it("refuses a registration the configuration does not declare, committing NOTHING", async () => {
    const response = await post({ ...SUBMISSION, accountType: "not-a-registration" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("VALIDATION");
    expect(body.error?.message).toContain("Account type must be one of");
    // The whole point: a refusal at the boundary leaves no partial CRM state.
    expect(await rowCounts()).toEqual({ households: 0, contacts: 0, applications: 0, executions: 0 });
  });

  /**
   * A DEPLOYMENT DEFECT IS REPORTED AS ONE (D-224). A configured field the fixed
   * start input cannot carry is caused by the published document and fixable by
   * nobody submitting the form, so it answers 5xx/INTERNAL - the status an
   * operator alerts on - rather than joining the client-error noise a 400 would
   * bury it in. It is also what makes the journey's request-identity rule sound:
   * every VALIDATION this endpoint answers is one the submitter can act on.
   */
  it("reports a configured field this deployment cannot carry as a SERVER defect, committing NOTHING", async () => {
    injected.extraField = { field: "advisorNote", label: "Advisor note", type: "text", required: false };
    const response = await post({ ...SUBMISSION, advisorNote: "Prefers morning calls" });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("INTERNAL");
    expect(body.error?.message).toContain("advisorNote");
    expect(await rowCounts()).toEqual({ households: 0, contacts: 0, applications: 0, executions: 0 });
  });

  it("still starts the flow for a registration the configuration DOES declare", async () => {
    const response = await post(SUBMISSION);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe("suspended");
    const counts = await rowCounts();
    expect(counts).toEqual({ households: 1, contacts: 1, applications: 1, executions: 1 });
  });
});
