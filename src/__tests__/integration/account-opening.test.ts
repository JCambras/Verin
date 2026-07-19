import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { startAccountOpening, resumeAccountOpeningByToken, esignCallback, computeEsignSignature } from "@infra/wire";
import { verifyOrgChain } from "@infra/audit/audit-store";
import { recentSpans } from "@infra/observability/tracer";
import type { Principal } from "@contracts/principal";

const ORG = "org-1";
const advisor: Principal = { userId: "u1", orgId: ORG, role: "advisor", actor: "advisor@firm.test", sessionId: "s1" };

async function seedOrg(db: SqlDb) {
  const now = new Date().toISOString();
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')", [ORG, now]);
  await db.query("INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('u1',$1,'advisor@firm.test','Advisor','advisor','active',$2,'verin-crm',$2,'high')", [ORG, now]);
}

async function accountCount(db: SqlDb): Promise<number> {
  const r = await db.query<{ n: string }>("SELECT count(*) AS n FROM financial_accounts WHERE org_id = $1", [ORG]);
  return Number(r.rows[0]!.n);
}

describe("account opening: start -> suspend -> webhook resume -> exactly-once (integration)", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await seedOrg(db);
  });

  it("suspends at e-sign, then finalizes on resume with a verifiable audit chain", async () => {
    const started = await startAccountOpening(db, advisor, {
      householdName: "Okafor Household",
      firstName: "Ada",
      lastName: "Okafor",
      email: "ada@example.test",
      accountType: "ira-roth",
    });

    // The flow SUSPENDED at the e-sign step (fire-and-return) with a resume token.
    expect(started.status).toBe("suspended");
    expect(started.token).toBeTruthy();
    expect(started.awaiting).toBe("esign-signature");
    expect(await accountCount(db)).toBe(0); // nothing finalized yet

    // The e-sign webhook resumes the flow.
    const token = started.token!;
    const resumed = await resumeAccountOpeningByToken(db, token, { signedAt: new Date().toISOString() });
    expect("status" in resumed && resumed.status).toBe("completed");
    expect(await accountCount(db)).toBe(1); // finalized exactly once

    // Audit chain intact end-to-end and attributes to the initiating advisor's
    // opaque userId (ADR-0006/0007: never the raw email at the audit boundary).
    const verdict = await verifyOrgChain(db, ORG);
    expect(verdict.ok).toBe(true);
    const chain = await db.query<{ actor: string; action: string }>("SELECT actor, action FROM audit_log WHERE org_id=$1 ORDER BY sequence", [ORG]);
    expect(chain.rows.some((r) => r.action === "financial_account.create" && r.actor === "u1")).toBe(true);
    expect(chain.rows.some((r) => r.actor === "advisor@firm.test")).toBe(false);

    // Observability: the flow steps and external calls emitted spans.
    expect(recentSpans().some((s) => s.name === "flow.account-opening.start")).toBe(true);
    expect(recentSpans().some((s) => s.name === "account-opening.finalize")).toBe(true);
  });

  it("a doubly-fired webhook has EXACTLY-ONCE effect (charter #16)", async () => {
    const started = await startAccountOpening(db, advisor, {
      householdName: "Replay Household", firstName: "Rey", lastName: "Play", email: null, accountType: "individual",
    });
    const token = started.token!;

    const first = await resumeAccountOpeningByToken(db, token, { signedAt: "t1" });
    const second = await resumeAccountOpeningByToken(db, token, { signedAt: "t2" }); // replay
    expect("status" in first && first.status).toBe("completed");
    // Second resume finds the flow already completed (idempotent) and does not re-run finalize.
    expect("status" in second && second.status).toBe("completed");

    expect(await accountCount(db)).toBe(1); // exactly once, not twice
    const tasks = await db.query<{ n: string }>("SELECT count(*) AS n FROM tasks WHERE org_id=$1", [ORG]);
    expect(Number(tasks.rows[0]!.n)).toBe(1);
    expect((await verifyOrgChain(db, ORG)).ok).toBe(true);
  });

  it("a forged webhook SIGNATURE is rejected; a valid one finalizes (STRIDE T-S3)", async () => {
    const started = await startAccountOpening(db, advisor, {
      householdName: "Sig Household", firstName: "S", lastName: "T", email: null, accountType: "individual",
    });
    const token = started.token!;

    // Forged: a bad HMAC is rejected BEFORE any resume.
    const forged = await esignCallback(db, token, "deadbeef-not-a-valid-hmac", {});
    expect(forged.status).toBe("invalid-signature");
    expect(await accountCount(db)).toBe(0); // nothing finalized

    // Valid HMAC finalizes.
    const good = await esignCallback(db, token, computeEsignSignature(token), {});
    expect("status" in good && good.status).toBe("completed");
    expect(await accountCount(db)).toBe(1);

    // Unknown token → not-found.
    const bogus = await resumeAccountOpeningByToken(db, "not-a-real-token", {});
    expect(bogus.status).toBe("not-found");
  });
});
