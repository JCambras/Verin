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
    const signedAt = new Date().toISOString();
    const resumed = await resumeAccountOpeningByToken(db, token, { signedAt });
    expect("status" in resumed && resumed.status).toBe("completed");
    expect(await accountCount(db)).toBe(1); // finalized exactly once

    // Finding #2 lock: the e-signature OPENS the account — the store must agree
    // with the product's "Account opened" (never 'pending' forever, openDate set).
    const acct = await db.query<{ status: string; open_date: string | null }>(
      "SELECT status, open_date FROM financial_accounts WHERE org_id = $1",
      [ORG],
    );
    expect(acct.rows[0]!.status).toBe("open");
    expect(acct.rows[0]!.open_date).toBe(signedAt);

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

  it("a DOUBLE-SUBMITTED flow start (same client request id) replays the same execution — no duplicate households (D-027)", async () => {
    const clientRequestId = "3f1f9c2e-8f7a-4b6e-9e2d-1a2b3c4d5e6f";
    const input = {
      householdName: "Dupe Household", firstName: "Do", lastName: "Uble", email: null,
      accountType: "individual", clientRequestId,
    };
    const first = await startAccountOpening(db, advisor, input);
    const second = await startAccountOpening(db, advisor, input); // double-submit (retry / second tab)

    expect(first.status).toBe("suspended");
    expect(second.status).toBe("suspended");
    expect(second.executionId).toBe(first.executionId);
    expect(second.token).toBe(first.token); // the SAME awaiting-signature session reattaches

    const households = await db.query<{ n: string }>("SELECT count(*) AS n FROM households WHERE org_id = $1", [ORG]);
    expect(Number(households.rows[0]!.n)).toBe(1); // one household, not two

    // Companion (charter #4): a DIFFERENT request id is a genuinely new submission
    // and does start a second execution — dedup is by the minted id, not always-once.
    const third = await startAccountOpening(db, advisor, { ...input, clientRequestId: "9d8c7b6a-5f4e-4d3c-9b1a-0f9e8d7c6b5a" });
    expect(third.executionId).not.toBe(first.executionId);
    const after = await db.query<{ n: string }>("SELECT count(*) AS n FROM households WHERE org_id = $1", [ORG]);
    expect(Number(after.rows[0]!.n)).toBe(2);
  });

  it("a FAILED start is re-driven from its saved cursor when the same client request id is resubmitted (Vale V7 on the start path)", async () => {
    const clientRequestId = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const input = {
      householdName: "Retry Household", firstName: "Re", lastName: "Try", email: null,
      accountType: "individual", clientRequestId,
    };
    // Transient mid-flow failure: the application step's table vanishes, so the
    // execution persists as 'failed' AFTER the household/contact writes committed.
    await db.query("ALTER TABLE account_opening_applications RENAME TO applications_offline");
    const first = await startAccountOpening(db, advisor, input);
    expect(first.status).toBe("failed");
    const households = await db.query<{ n: string }>("SELECT count(*) AS n FROM households WHERE org_id = $1", [ORG]);
    expect(Number(households.rows[0]!.n)).toBe(1);
    await db.query("ALTER TABLE applications_offline RENAME TO account_opening_applications");

    // The user resubmits the SAME form session: the replay re-drives from the
    // saved cursor instead of dead-ending on the persisted failure.
    const second = await startAccountOpening(db, advisor, input);
    expect(second.status).toBe("suspended");
    expect(second.token).toBeTruthy();
    expect(second.executionId).toBe(clientRequestId);

    // No duplicated pre-failure writes: still exactly one household.
    const after = await db.query<{ n: string }>("SELECT count(*) AS n FROM households WHERE org_id = $1", [ORG]);
    expect(Number(after.rows[0]!.n)).toBe(1);
    expect((await verifyOrgChain(db, ORG)).ok).toBe(true);
  });

  it("an EDITED resubmit under the same client request id is rejected with a typed CONFLICT — never a silent replay of stale input (D-027)", async () => {
    const clientRequestId = "6c5d4e3f-2a1b-4c0d-9e8f-7a6b5c4d3e2f";
    const input = {
      householdName: "Original Household", firstName: "Or", lastName: "Iginal", email: null,
      accountType: "individual", clientRequestId,
    };
    const first = await startAccountOpening(db, advisor, input);
    expect(first.status).toBe("suspended");

    // The user edits a field and resubmits under the SAME id: refused, not replayed.
    const edited = await startAccountOpening(db, advisor, { ...input, householdName: "Corrected Household" });
    expect(edited.status).toBe("failed");
    expect(edited.error?.code).toBe("CONFLICT");
    expect(edited.token).toBeUndefined(); // the original session's resume token never leaks on a refusal

    // No stale write, no duplicate: exactly one household, the original submission's.
    const households = await db.query<{ name: string }>("SELECT name FROM households WHERE org_id = $1", [ORG]);
    expect(households.rows.map((r) => r.name)).toEqual(["Original Household"]);
  });

  it("an edited resubmit of a FAILED start is rejected with CONFLICT instead of re-driving the stale submission (D-027)", async () => {
    const clientRequestId = "8b7a6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d";
    const input = {
      householdName: "Stale Household", firstName: "St", lastName: "Ale", email: null,
      accountType: "individual", clientRequestId,
    };
    await db.query("ALTER TABLE account_opening_applications RENAME TO applications_offline");
    const first = await startAccountOpening(db, advisor, input);
    expect(first.status).toBe("failed");
    await db.query("ALTER TABLE applications_offline RENAME TO account_opening_applications");

    // The user fixes the form and resubmits under the same id: the persisted
    // failed execution must NOT be re-driven with its stale input.
    const edited = await startAccountOpening(db, advisor, { ...input, householdName: "Fixed Household" });
    expect(edited.status).toBe("failed");
    expect(edited.error?.code).toBe("CONFLICT");

    const apps = await db.query<{ n: string }>("SELECT count(*) AS n FROM account_opening_applications WHERE org_id = $1", [ORG]);
    expect(Number(apps.rows[0]!.n)).toBe(0); // the stale execution was not re-driven
    const households = await db.query<{ name: string }>("SELECT name FROM households WHERE org_id = $1", [ORG]);
    expect(households.rows.map((r) => r.name)).toEqual(["Stale Household"]); // and nothing new was written
  });

  it("a storage failure DURING the re-drive of a failed start surfaces as a typed failure, never an unenveloped throw", async () => {
    const clientRequestId = "1f2e3d4c-5b6a-4798-8091-a2b3c4d5e6f7";
    const input = {
      householdName: "Redrive Household", firstName: "Re", lastName: "Drive", email: null,
      accountType: "individual", clientRequestId,
    };
    await db.query("ALTER TABLE account_opening_applications RENAME TO applications_offline");
    expect((await startAccountOpening(db, advisor, input)).status).toBe("failed");
    await db.query("ALTER TABLE applications_offline RENAME TO account_opening_applications");

    // The identical resubmit re-drives, but persisting the re-driven state blows
    // up: the route must still receive a typed AppError result, not a rejection.
    const failing: SqlDb = {
      ...db,
      query: <T,>(sql: string, params?: unknown[]) =>
        sql.startsWith("UPDATE flow_executions") ? Promise.reject(new Error("disk full")) : db.query<T>(sql, params),
    };
    const retried = await startAccountOpening(failing, advisor, input);
    expect(retried.status).toBe("failed");
    expect(retried.error?.code).toBe("INTERNAL");
    expect(retried.token).toBeUndefined();
  });

  it("a storage failure during the RACE-BRANCH re-drive is mapped the same way (typed failure, no unenveloped 500)", async () => {
    const clientRequestId = "9a8b7c6d-5e4f-4321-8765-4a3b2c1d0e9f";
    const input = {
      householdName: "Race Household", firstName: "Ra", lastName: "Ce", email: null,
      accountType: "individual", clientRequestId,
    };
    await db.query("ALTER TABLE account_opening_applications RENAME TO applications_offline");
    expect((await startAccountOpening(db, advisor, input)).status).toBe("failed");
    await db.query("ALTER TABLE applications_offline RENAME TO account_opening_applications");

    // Simulate the concurrent-race loser: its pre-check load misses (the winner
    // had not committed yet), its INSERT hits the real PK conflict (23505), and
    // the recovery re-drive then fails to persist its state.
    let missedPrecheck = false;
    const racing: SqlDb = {
      ...db,
      query: <T,>(sql: string, params?: unknown[]) => {
        if (sql.startsWith("SELECT * FROM flow_executions") && !missedPrecheck) {
          missedPrecheck = true;
          return Promise.resolve({ rows: [] as T[] });
        }
        if (sql.startsWith("UPDATE flow_executions")) return Promise.reject(new Error("disk full"));
        return db.query<T>(sql, params);
      },
    };
    const result = await startAccountOpening(racing, advisor, input);
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL");
    expect(result.token).toBeUndefined();
  });

  it("a real storage failure mid-start is NOT masked as a double-submit replay (only SQLSTATE 23505 resolves as one)", async () => {
    // The execution row INSERTs fine; the post-step save (UPDATE) blows up — the
    // pre-fix catch would have reported this as a 'running' replay with no token.
    const failing: SqlDb = {
      ...db,
      query: <T,>(sql: string, params?: unknown[]) =>
        sql.startsWith("UPDATE flow_executions") ? Promise.reject(new Error("disk full")) : db.query<T>(sql, params),
    };
    const result = await startAccountOpening(failing, advisor, {
      householdName: "Mask Household", firstName: "Ma", lastName: "Sk", email: null,
      accountType: "individual", clientRequestId: "5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b",
    });
    expect(result.status).toBe("failed"); // a typed failure, never a fake started flow
    expect(result.error?.code).toBe("INTERNAL");
    expect(result.token).toBeUndefined();
  });

  it("a client request id colliding with ANOTHER org's execution fails clean and leaks nothing", async () => {
    const clientRequestId = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
    const started = await startAccountOpening(db, advisor, {
      householdName: "Victim Household", firstName: "Vi", lastName: "Ctim", email: null,
      accountType: "individual", clientRequestId,
    });
    expect(started.status).toBe("suspended");

    const intruder: Principal = { userId: "u2", orgId: "org-2", role: "advisor", actor: "eve@rival.test", sessionId: "s2" };
    const result = await startAccountOpening(db, intruder, {
      householdName: "Intruder Household", firstName: "E", lastName: "Ve", email: null,
      accountType: "individual", clientRequestId, // the PK conflict is a 23505, but not the caller's own execution
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("INTERNAL"); // a clean AppError, not a raw driver error
    expect(result.token).toBeUndefined(); // org-1's resume token never leaks
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
