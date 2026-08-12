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
  /** Ask for a document that is genuinely not published, so the REAL refusal is exercised. */
  unresolvableConfiguration: false,
  /**
   * The same real refusal, but reaching only the FLOW: the form still projects,
   * so the request passes the boundary and the START PATH is the thing that
   * refuses. That is the layer whose instruction was wrong (D-228).
   */
  unrunnableFlow: false,
}));
vi.mock("@infra/config/domain-config-source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@infra/config/domain-config-source")>();
  return {
    ...actual,
    loadIntakeForm: (domainConfigId: string) => {
      const form = actual.loadIntakeForm(
        injected.unresolvableConfiguration ? "no-such-published-domain" : domainConfigId,
      );
      if (injected.extraField === null || !form.ok) return form;
      return { ok: true as const, value: { ...form.value, fields: [...form.value.fields, injected.extraField] } };
    },
    loadPublishedDomainConfig: (domainConfigId: string) =>
      actual.loadPublishedDomainConfig(
        injected.unrunnableFlow ? "no-such-published-domain" : domainConfigId,
      ),
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
    injected.unresolvableConfiguration = false;
    injected.unrunnableFlow = false;
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

  /**
   * THE EDITED-RESUBMIT PATH IS REACHABLE AND IT CLEARS (D-225).
   *
   * D-027 refuses a request id replayed with DIFFERENT input rather than silently
   * writing the stale values - the right refusal, and one the submitter clears by
   * sending the corrected details under a fresh identity. It is also the exact
   * case a code-keyed client rule got wrong: the refusal is a CONFLICT, and so is
   * the version-mismatch refusal that must NOT re-mint, so no rule reading the
   * code could serve both. This asserts the instruction, not the code, and then
   * asserts that FOLLOWING it succeeds - a refusal with no remedy would otherwise
   * read green.
   */
  it("tells an edited resubmit to mint a new identity, and that identity opens the corrected account", async () => {
    expect((await post(SUBMISSION)).status).toBe(200);

    const edited = { ...SUBMISSION, householdName: "Corrected Household" };
    const refused = await post(edited);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { retry?: string; error?: { code?: string; message?: string } };
    expect(body.retry).toBe("retry-with-new-identity");
    // The internal taxonomy stays in the log, never the browser's copy of it.
    expect(body.error?.code).toBeUndefined();
    expect(body.error?.message).toContain("Submit again");
    // The refused resubmit wrote nothing: the first submission still stands alone.
    expect(await rowCounts()).toEqual({ households: 1, contacts: 1, applications: 1, executions: 1 });

    const followed = await post({ ...edited, clientRequestId: "9c1e7b40-2d63-4f18-9a55-8e0b1c2d3f4a" });
    expect(followed.status).toBe(200);
    expect(((await followed.json()) as { status?: string }).status).toBe("suspended");
    expect(await rowCounts()).toEqual({ households: 2, contacts: 2, applications: 2, executions: 2 });
  });

  /**
   * A DEPLOYMENT AN OPERATOR CAN REPAIR IS NOT A DEAD END (D-226/D-227).
   *
   * The published configuration could not be resolved, which is neither the
   * submitter's fault nor permanent: an operator restores the document and the
   * next submit works. So the browser is told to keep this form session's identity
   * and come back - paced, so a retry loop cannot hammer a deployment mid-repair -
   * and it is told that in a GENERIC sentence carrying a correlation id, because
   * the dotted document paths and SHA-256 hashes the refusal used to spell out are
   * deployment internals that were crossing a trust boundary.
   */
  it("answers an unresolvable configuration with retry-later, paced, and no diagnosis on the wire", async () => {
    injected.unresolvableConfiguration = true;
    const response = await post(SUBMISSION);
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await response.json()) as { retry?: string; error?: { code?: string; message?: string } };
    expect(body.retry).toBe("retry-later");
    // The taxonomy stays in the log line, as every other refusal on this route does.
    expect(body.error?.code).toBeUndefined();
    expect(body.error?.message).toContain("Quote reference");
    expect(body.error?.message).not.toMatch(/[0-9a-f]{32}/);
    expect(body.error?.message).not.toContain("config/domains");
    expect(await rowCounts()).toEqual({ households: 0, contacts: 0, applications: 0, executions: 0 });
  });

  /**
   * THE SAME CAUSE ANSWERS THE SAME WAY ONE LAYER IN (D-228).
   *
   * The boundary case above and this one are the SAME broken document; the only
   * difference is which layer notices. This one gets past the intake projection
   * and is refused by the START PATH, which used to answer 422 with "resubmitting
   * will not help; contact your operations team" - a false instruction, because an
   * operator rollback WILL clear it. The classification now travels with the
   * refusal's cause rather than being chosen per call site, so this path cannot
   * disagree with that one.
   */
  it("answers a configuration-caused START refusal with retry-later, paced - not do-not-retry", async () => {
    injected.unrunnableFlow = true;
    const response = await post(SUBMISSION);
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await response.json()) as { retry?: string; error?: { code?: string; message?: string } };
    expect(body.retry).toBe("retry-later");
    expect(body.error?.message).not.toContain("Resubmitting will not help");
    expect(await rowCounts()).toEqual({ households: 0, contacts: 0, applications: 0, executions: 0 });
  });

  /**
   * THE REFERENCE SURVIVES THE WHOLE WAY TO THE BODY (D-231).
   *
   * The refusal narrows its own message to a generic sentence precisely so it can
   * carry a correlation id instead of dotted document paths, and the reporting
   * surfaces threw that id away and substituted a sentence of their own - for
   * three rounds running, which is why the shape now carries the reference and no
   * caller can drop it. Asserted at BOTH layers a broken document is noticed at,
   * because giving an advisor something to quote at one of them and nothing at the
   * other is the per-surface disagreement this whole taxonomy exists to remove.
   */
  it.each([
    ["the intake projection", "unresolvableConfiguration"],
    ["the start path", "unrunnableFlow"],
  ] as const)("gives an advisor a quotable reference when %s refuses", async (_layer, noticedBy) => {
    injected[noticedBy] = true;
    const response = await post(SUBMISSION);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { retry?: string; error?: { message?: string } };
    expect(body.retry).toBe("retry-later");
    expect(body.error?.message).toMatch(/Quote reference [0-9a-f-]{36}\./);
    // ...and it is still the GENERIC sentence: the reference is what narrowing
    // the message costs nothing, not a licence to put the diagnosis back.
    expect(body.error?.message).toContain("operations team");
    expect(body.error?.message).not.toMatch(/[0-9a-f]{32}/);
    expect(body.error?.message).not.toContain("config/domains");
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
