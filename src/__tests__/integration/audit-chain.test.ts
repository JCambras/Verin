import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { auditedWrite } from "@infra/audit/audited-write";
import { listOrgChain, verifyOrgChain, drainOutbox } from "@infra/audit/audit-store";
import { unwrap } from "@contracts/result";

const ORG = "org-1";

async function seedOrg(db: SqlDb) {
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'verin-crm',$3,'high')", [ORG, "Test Org", new Date().toISOString()]);
}

describe("tamper-evident audit chain (integration)", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await seedOrg(db);
  });

  it("an audited write produces a verifiable chain entry with the real actor", async () => {
    const r = await auditedWrite({
      db,
      orgId: ORG,
      actor: "advisor@test",
      action: "household.create",
      entityType: "Household",
      entityId: "hh-1",
      buildAfter: () => ({ id: "hh-1", name: "Nakamura" }),
      detail: "Created household Nakamura",
      perform: async (tx) => {
        await tx.query(
          "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,NULL,NULL,'active',$4,'verin-crm',$4,'high')",
          ["hh-1", ORG, "Nakamura", new Date().toISOString()],
        );
        return { id: "hh-1" };
      },
    });
    expect(unwrap(r).id).toBe("hh-1");

    const chain = await listOrgChain(db, ORG);
    expect(chain.length).toBe(1);
    expect(chain[0]!.actor).toBe("advisor@test"); // NOT hardcoded "system"
    expect(chain[0]!.action).toBe("household.create");
    const verdict = await verifyOrgChain(db, ORG);
    expect(verdict.ok).toBe(true);
    expect(verdict.entriesChecked).toBe(1);
  });

  it("a replayed idempotent write has exactly-once effect (charter #16)", async () => {
    const write = () =>
      auditedWrite({
        db,
        orgId: ORG,
        actor: "system@webhook",
        action: "task.create",
        entityType: "Task",
        entityId: "task-1",
        idempotencyKey: "esign-finalize:app-1",
        buildAfter: () => ({ id: "task-1" }),
        detail: "Finalize account opening",
        perform: async (tx) => {
          await tx.query(
            "INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,NULL,$3,'not-started',NULL,NULL,$4,'verin-crm',$4,'high')",
            ["task-1", ORG, "Follow up", new Date().toISOString()],
          );
          return { id: "task-1" };
        },
      });

    const first = await write();
    const second = await write(); // replay
    expect(unwrap(first).id).toBe("task-1");
    expect(unwrap(second).id).toBe("task-1");

    // exactly-once: one row, one cache entry, one audit entry.
    const tasks = await db.query<{ n: string }>("SELECT count(*) AS n FROM tasks WHERE id = 'task-1'");
    expect(Number(tasks.rows[0]!.n)).toBe(1);
    const chain = await listOrgChain(db, ORG);
    expect(chain.length).toBe(1);
    expect((await verifyOrgChain(db, ORG)).ok).toBe(true);
  });

  it("editing an audit row is rejected by the append-only trigger", async () => {
    await auditedWrite({
      db, orgId: ORG, actor: "a@test", action: "x.create", entityType: "X", entityId: "x1",
      detail: "d", perform: async () => ({ ok: true }),
    });
    await expect(
      db.query("UPDATE audit_log SET detail = 'tampered' WHERE org_id = $1", [ORG]),
    ).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM audit_log WHERE org_id = $1", [ORG])).rejects.toThrow(/append-only/);
  });

  it("verifyChain detects a tampered entry (defeating triggers at the raw level)", async () => {
    for (let i = 0; i < 3; i++) {
      await auditedWrite({ db, orgId: ORG, actor: "a@test", action: `e${i}.create`, entityType: "E", entityId: `e${i}`, detail: `entry ${i}`, perform: async () => ({ i }) });
    }
    expect((await verifyOrgChain(db, ORG)).ok).toBe(true);

    // Simulate a DBA/root bypass of the trigger by disabling it, then corrupt a row.
    await db.exec("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update");
    await db.query("UPDATE audit_log SET detail = 'SECRETLY EDITED' WHERE org_id = $1 AND sequence = 1", [ORG]);
    await db.exec("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update");

    const verdict = await verifyOrgChain(db, ORG);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAtSequence).toBe(1);
  });

  it("detects TAIL-TRUNCATION and full deletion via the out-of-band anchor (Vale V1)", async () => {
    for (let i = 0; i < 4; i++) {
      await auditedWrite({ db, orgId: ORG, actor: "a@test", action: `e${i}.create`, entityType: "E", entityId: `e${i}`, detail: `entry ${i}`, perform: async () => ({ i }) });
    }
    expect((await verifyOrgChain(db, ORG)).ok).toBe(true);

    // Bypass the delete trigger and truncate the newest rows — the remaining rows
    // (seq 0,1) are internally consistent, so the hash chain alone would say OK.
    await db.exec("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete");
    await db.query("DELETE FROM audit_log WHERE org_id = $1 AND sequence >= 2", [ORG]);
    await db.exec("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete");

    const verdict = await verifyOrgChain(db, ORG);
    expect(verdict.ok).toBe(false); // anchor count (4) != rows (2)
    expect(verdict.reason).toMatch(/count|truncat/i);
  });

  it("TRUNCATE on audit_log is blocked by the append-only trigger", async () => {
    await auditedWrite({ db, orgId: ORG, actor: "a@test", action: "x.create", entityType: "X", entityId: "x", detail: "d", perform: async () => ({}) });
    await expect(db.exec("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
  });

  it("detects entries WITHOUT an anchor row (anchor removed to cover a deletion)", async () => {
    await auditedWrite({ db, orgId: ORG, actor: "a@test", action: "x.create", entityType: "X", entityId: "x", detail: "d", perform: async () => ({}) });
    expect((await verifyOrgChain(db, ORG)).ok).toBe(true);

    await db.query("DELETE FROM audit_anchor WHERE org_id = $1", [ORG]);

    const verdict = await verifyOrgChain(db, ORG);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/anchor/i);
  });

  it("reclaims a stale 'claimed' outbox row (a crash between claim and delete must not lose the entry)", async () => {
    const payload = {
      orgId: ORG, actor: "a@test", action: "x.create", entityType: "X", entityId: "x1",
      beforeJson: null, afterJson: null, detail: "d", createdAt: new Date().toISOString(), result: "success",
    };
    await db.query(
      "INSERT INTO audit_outbox (id, org_id, payload_json, status, attempts, created_at, claimed_at) VALUES ($1,$2,$3,'claimed',1,$4,$5)",
      ["ob-stale", ORG, JSON.stringify(payload), new Date().toISOString(), new Date(Date.now() - 10 * 60_000).toISOString()],
    );

    expect(await drainOutbox(db, ORG)).toBe(1);
    expect((await listOrgChain(db, ORG)).length).toBe(1);
    expect((await verifyOrgChain(db, ORG)).ok).toBe(true);
    const left = await db.query<{ n: string }>("SELECT count(*) AS n FROM audit_outbox WHERE org_id = $1", [ORG]);
    expect(Number(left.rows[0]!.n)).toBe(0);
  });
});
