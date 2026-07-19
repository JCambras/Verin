import { describe, it, expect } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { startAccountOpening } from "@infra/wire";
import { withSpan, recentSpans } from "@infra/observability/tracer";
import type { Principal } from "@contracts/principal";

/**
 * OBSERVABILITY-COVERAGE FENCE (ADR-0013, charter #14). Proves flow steps and
 * external/store calls actually emit spans — observability is measured, not
 * modeled. If the engine or the CRM calls were not instrumented, these spans would
 * be absent.
 */
const advisor: Principal = { userId: "u1", orgId: "o", role: "advisor", actor: "a@t", sessionId: "s" };

async function seed(): Promise<SqlDb> {
  const db = await createMemoryDb();
  const t = "2026-01-01T00:00:00.000Z";
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ('o','O',$1,'verin-crm',$1,'high')", [t]);
  await db.query("INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('u1','o','a@t','A','advisor','active',$1,'verin-crm',$1,'high')", [t]);
  return db;
}

describe("observability-coverage fence", () => {
  it("enforces: the account-opening flow emits spans for the flow and its external calls", async () => {
    const db = await seed();
    await startAccountOpening(db, advisor, { householdName: "H", firstName: "A", lastName: "B", email: null, accountType: "ira-roth" });
    const names = new Set(recentSpans().map((s) => s.name));
    expect(names.has("flow.account-opening.start"), "missing flow span").toBe(true);
    expect(names.has("crm.household.create"), "missing external-call span").toBe(true);
    expect(names.has("esign.request"), "missing e-sign span").toBe(true);
  });

  describe("detects (companion): withSpan actually records (the ring is real)", () => {
    it("a wrapped op records a span; success/failure are captured", async () => {
      const before = recentSpans().length;
      await withSpan("test.op.ok", { k: "v" }, async () => 42);
      const afterOk = recentSpans();
      expect(afterOk.length).toBe(before + 1);
      expect(afterOk[afterOk.length - 1]).toMatchObject({ name: "test.op.ok", ok: true });

      await expect(withSpan("test.op.fail", {}, async () => {
        throw new Error("boom");
      })).rejects.toThrow();
      const last = recentSpans()[recentSpans().length - 1]!;
      expect(last).toMatchObject({ name: "test.op.fail", ok: false });
    });
  });
});
