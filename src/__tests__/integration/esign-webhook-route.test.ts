import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { computeEsignSignature, startAccountOpening } from "@infra/wire";
import { principalFromIdentity } from "@contracts/principal";
import { actorRefOf, authorizeGovernedAction } from "@contracts/authz";

/**
 * WHAT THE E-SIGN PROVIDER IS TOLD TO DO NEXT.
 *
 * The webhook's status is an INSTRUCTION to an external system, never a window
 * into our internal error taxonomy: a 5xx says the callback was not delivered,
 * so redeliver it, and the saved cursor makes that retry idempotent. That is
 * right for a TRANSIENT failure and wrong for a PERMANENT refusal, which meets
 * the identical answer on every redelivery: a 5xx there spends the provider's
 * retry budget and then drops the signature event with nothing but an error log
 * behind it.
 *
 * PERMANENT VERSUS TRANSIENT WAS A FALSE BINARY, and the configuration-version
 * conflict is the case that proves it (D-255): it is neither, because it clears
 * the moment an operator rolls the published document back. Answering it "never
 * redeliver" DISCARDS A SIGNATURE the client already gave - the client signs and
 * their account never opens - which is strictly worse than the unbounded
 * redelivery the do-not-redeliver status was introduced to stop. So it takes the
 * third category: 503, PACED with Retry-After.
 *
 * All three are asserted here: the operator-recoverable refusal comes back later,
 * a genuinely permanent refusal answers the one do-not-redeliver status whatever
 * internal code produced it (and never a status this endpoint already owns for
 * something else), and a server-side failure still answers 5xx.
 */
const ORG = "org-esign-webhook-route";
const advisorPrincipal = principalFromIdentity({
  userId: "u-esign-route", orgId: ORG, role: "advisor", actor: "advisor@firm.test", sessionId: "s-esign-route",
});
const executionAuthorization = authorizeGovernedAction(actorRefOf(advisorPrincipal), "execution.initiate");
const piiAuthorization = authorizeGovernedAction(actorRefOf(advisorPrincipal), "pii.view");
if (!executionAuthorization.ok || !piiAuthorization.ok) throw new Error("advisor should hold both grants");
const execution = executionAuthorization.value;
const pii = piiAuthorization.value;

const globalStore = globalThis as unknown as { __verinDb?: Promise<SqlDb> };
let db: SqlDb;

async function callback(token: string): Promise<Response> {
  const req = new NextRequest("http://localhost/api/esign/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, signature: computeEsignSignature(token) }),
  });
  const { POST } = await import("@app/api/esign/webhook/route");
  return POST(req);
}

async function suspendedToken(householdName: string): Promise<{ executionId: string; token: string }> {
  const started = await startAccountOpening(db, execution, pii, {
    householdName, firstName: "Web", lastName: "Hook", email: null, accountType: "individual",
  });
  expect(started.status).toBe("suspended");
  return { executionId: started.executionId, token: started.token! };
}

describe("POST /api/esign/webhook honors the taxonomy's retryability", () => {
  beforeEach(async () => {
    db = await createMemoryDb();
    globalStore.__verinDb = Promise.resolve(db);
    const now = new Date().toISOString();
    await db.query(
      "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')",
      [ORG, now],
    );
    await db.query(
      "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('u-esign-route',$1,'advisor@firm.test','Advisor','advisor','active',$2,'verin-crm',$2,'high')",
      [ORG, now],
    );
  });

  /**
   * The signature ARRIVED. Nothing about this deployment can finish the account
   * opening until an operator acts, and then it can - so the provider is asked to
   * come back rather than to give up, and the execution is left suspended with an
   * external event still able to complete it. The pacing is asserted too: an
   * unpaced 503 is the old blanket 5xx wearing a new number.
   */
  it("asks the provider to redeliver LATER when the configuration version was superseded", async () => {
    const { executionId, token } = await suspendedToken("Superseded Version Household");
    const persisted = await db.query<{ context_json: string }>(
      "SELECT context_json FROM flow_executions WHERE id = $1",
      [executionId],
    );
    const context = JSON.parse(persisted.rows[0]!.context_json) as { cursor: number; data: Record<string, unknown> };
    await db.query("UPDATE flow_executions SET context_json = $2 WHERE id = $1", [
      executionId,
      JSON.stringify({ ...context, data: { ...context.data, domainConfigVersionId: "account-opening@2026.09.0" } }),
    ]);

    const response = await callback(token);
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("CONFLICT");
    // Refusing to DRIVE is not abandoning the execution: it stays suspended, so
    // the redelivery after the rollback resumes it rather than finding nothing.
    const after = await db.query<{ status: string }>("SELECT status FROM flow_executions WHERE id = $1", [executionId]);
    expect(after.rows[0]!.status).toBe("suspended");
  });

  /**
   * The collision the single status exists to remove. This handler already
   * answers 404 for "unknown signing token" and 401 for "invalid webhook
   * signature"; a finalize-time NOT_FOUND is a DIFFERENT fact - the token was
   * fine and a downstream write matched no row - and must not be reported with
   * the same code the provider reads as "that token does not exist".
   */
  it("never reports a downstream permanent failure with a status this endpoint already owns", async () => {
    const { token } = await suspendedToken("Collision Household");
    // The application row keeps its token (so the callback resolves) but no
    // longer carries the id the suspended execution recorded, so finalize's
    // org-scoped UPDATE matches zero rows and throws NOT_FOUND.
    await db.query(
      "UPDATE account_opening_applications SET id = $2 WHERE esign_token = $1",
      [token, "11111111-2222-4333-8444-555555555555"],
    );

    const response = await callback(token);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("NOT_FOUND");
    expect(response.status).toBe(422);
  });

  it("still answers an ORDINARY finalize failure with a 5xx, so the provider redelivers", async () => {
    const { token } = await suspendedToken("Redelivered Household");
    // A storage failure inside finalize is what the blanket 5xx was written for,
    // and narrowing the rule must not turn it into a 4xx the provider treats as
    // final: the callback really was not delivered, and the saved cursor makes
    // the redelivery idempotent.
    await db.query("DROP TABLE financial_accounts");

    const response = await callback(token);
    expect(response.status).toBeGreaterThanOrEqual(500);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBeTruthy();
  });
});
