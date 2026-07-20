import { describe, it, expect, vi, afterEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { auditedWrite } from "@infra/audit/audited-write";
import { REDACTED } from "@contracts/pii";
import { log } from "@infra/observability/logger";

/**
 * Failure-path contract of the audited-write helper (finding #3; charter #4
 * companion). The helper is the single write chokepoint, so its error handling
 * must never fly blind or mislabel: the caught error is LOGGED before mapping,
 * unknown failures map to INTERNAL (500) — STORE_CONSTRAINT (409) is reserved for
 * real driver integrity-constraint codes — and a void perform under an
 * idempotencyKey fails as an explicit invariant instead of a disguised constraint
 * rollback.
 */

async function seed(): Promise<SqlDb> {
  const db = await createMemoryDb();
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ('o','O','2026-01-01T00:00:00.000Z','verin-crm','2026-01-01T00:00:00.000Z','high')");
  return db;
}

const base = { orgId: "o", actor: "u1", action: "task.create", entityType: "Task", entityId: "task-1", detail: "d" } as const;

const insertTask = (id: string) =>
  `INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ('${id}','o',NULL,'s','not-started',NULL,NULL,'2026-01-01T00:00:00.000Z','verin-crm','2026-01-01T00:00:00.000Z','high')`;

async function taskCount(db: SqlDb): Promise<number> {
  const r = await db.query<{ n: string }>("SELECT count(*) AS n FROM tasks");
  return Number(r.rows[0]!.n);
}

describe("auditedWrite failure paths (finding #3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a VOID perform under an idempotencyKey fails as an explicit INTERNAL invariant, rolling the business write back", async () => {
    const db = await seed();
    const result = await auditedWrite<void>({
      db, ...base, idempotencyKey: "k-void",
      perform: async (tx) => {
        await tx.query(insertTask("task-1"));
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL"); // never a misleading 409 "write failed"
      expect(result.error.message).toContain("idempotencyKey");
    }
    expect(await taskCount(db)).toBe(0); // business write rolled back
    const cache = await db.query("SELECT * FROM crm_write_cache");
    expect(cache.rows.length).toBe(0); // nothing half-cached
  });

  it("an UNKNOWN error thrown by perform (a plain bug) maps to INTERNAL, not STORE_CONSTRAINT", async () => {
    const db = await seed();
    const result = await auditedWrite<{ id: string }>({
      db, ...base,
      perform: async () => {
        throw new TypeError("cannot read properties of undefined");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });

  it("a REAL driver constraint violation (SQLSTATE class 23) maps to STORE_CONSTRAINT", async () => {
    const db = await seed();
    await db.query(insertTask("task-1"));
    const result = await auditedWrite<{ id: string }>({
      db, ...base,
      perform: async (tx) => {
        await tx.query(insertTask("task-1")); // duplicate PK → 23505
        return { id: "task-1" };
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STORE_CONSTRAINT");
  });

  it("a typed AppError thrown by perform passes through unchanged", async () => {
    const db = await seed();
    const result = await auditedWrite<{ id: string }>({
      db, ...base,
      perform: async () => {
        throw { code: "NOT_FOUND", message: "Task not found." };
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("the caught error is LOGGED before mapping (the chokepoint is never blind)", async () => {
    const db = await seed();
    const errorSpy = vi.spyOn(log, "error");
    await auditedWrite<{ id: string }>({
      db, ...base,
      perform: async () => {
        throw new TypeError("boom-visible");
      },
    });
    const call = errorSpy.mock.calls.find(
      (c) => typeof c[0] === "object" && c[0] !== null && String((c[0] as { reason?: unknown }).reason).includes("boom-visible"),
    );
    expect(call, "expected a log.error carrying the real underlying error").toBeTruthy();
    expect(call![1]).toBe("audited write failed");
  });

  it("a driver message quoting a PII-shaped row VALUE is redacted from the failure log (name-based redaction cannot see into free text)", async () => {
    const db = await seed();
    const errorSpy = vi.spyOn(log, "error");
    await auditedWrite<{ id: string }>({
      db, ...base,
      perform: async () => {
        throw new Error('duplicate key value violates unique constraint "users_email_unique": Key (email)=(ada@example.test) already exists');
      },
    });
    const call = errorSpy.mock.calls.find((c) => c[1] === "audited write failed");
    expect(call, "expected the chokepoint failure log").toBeTruthy();
    expect((call![0] as { reason?: unknown }).reason).toBe(REDACTED);
  });
});
