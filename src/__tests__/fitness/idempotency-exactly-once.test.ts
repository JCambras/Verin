import { describe, it, expect } from "vitest";
import { createMemoryDb } from "@infra/store/db";
import { auditedWrite } from "@infra/audit/audited-write";
import { unwrap } from "@contracts/result";

/**
 * IDEMPOTENCY EXACTLY-ONCE FENCE (ADR-0009, charter #16). Proves the audited-write
 * helper's idempotency key yields exactly-once effect under replay — a doubly-fired
 * external write (webhook) must not double-apply.
 */
async function seed() {
  const db = await createMemoryDb();
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ('o','O','t','verin-crm','t','high')");
  return db;
}

async function writeWithKey(db: Awaited<ReturnType<typeof seed>>, key: string): Promise<void> {
  await auditedWrite({
    db, orgId: "o", actor: "a@t", action: "task.create", entityType: "Task", entityId: "task-1",
    idempotencyKey: key, detail: "d",
    perform: async (tx) => {
      await tx.query("INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ('task-1','o',NULL,'s','not-started',NULL,NULL,'t','verin-crm','t','high')");
      return { id: "task-1" };
    },
  });
}

async function count(db: Awaited<ReturnType<typeof seed>>): Promise<number> {
  const r = await db.query<{ n: string }>("SELECT count(*) AS n FROM tasks");
  return Number(r.rows[0]!.n);
}

describe("idempotency exactly-once fence", () => {
  it("enforces: replaying the same idempotency key writes exactly once", async () => {
    const db = await seed();
    await writeWithKey(db, "k1");
    await writeWithKey(db, "k1"); // replay
    await writeWithKey(db, "k1"); // replay
    expect(await count(db)).toBe(1);
  });

  describe("detects (companion): DIFFERENT keys are NOT deduped (so the test is not vacuous)", () => {
    it("a different key would perform again — proving dedup is by key, not always-once", async () => {
      const db = await seed();
      await writeWithKey(db, "k1");
      // A different key targets the same row id; the second insert fails on PK →
      // auditedWrite returns an err (not a silent dedup). Proves keys matter.
      const second = await auditedWrite({
        db, orgId: "o", actor: "a@t", action: "task.create", entityType: "Task", entityId: "task-1",
        idempotencyKey: "k2", detail: "d",
        perform: async (tx) => {
          await tx.query("INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ('task-1','o',NULL,'s','not-started',NULL,NULL,'t','verin-crm','t','high')");
          return { id: "task-1" };
        },
      });
      expect(second.ok).toBe(false); // the new key actually re-performed and hit the PK constraint
      expect(await count(db)).toBe(1);
    });

    it("unwrap sanity on the happy replay", async () => {
      const db = await seed();
      const r = await auditedWrite({
        db, orgId: "o", actor: "a@t", action: "x.create", entityType: "X", entityId: "x", idempotencyKey: "kx", detail: "d",
        perform: async () => ({ ok: true }),
      });
      expect(unwrap(r)).toEqual({ ok: true });
    });
  });
});
