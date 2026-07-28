import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { MIGRATIONS, runMigrations } from "@infra/store/migrations";

/**
 * MIGRATION-3 UPGRADE REHEARSAL (D-016/D-061). Migration 3 adds tenant-qualified
 * composite foreign keys to tables that had none, so a store written before it can
 * hold rows the new constraints refuse. The contract proven here is that such a
 * store is REPORTED, never repaired: the read-only preflight names the migration and
 * every violating relationship BEFORE any DDL runs, and the offending rows are still
 * there afterwards, byte-for-byte, for an operator to re-point deliberately. A
 * migration that silently NULLs or deletes a row a human put there is data loss
 * dressed as an upgrade.
 *
 * The rehearsal is real: a fully-migrated PGlite store is rewound to version 2 (the
 * v3 constraints dropped, the ledger row removed), legacy rows are planted, and the
 * SHIPPED `runMigrations` is re-run against it.
 */
const TS = "2026-01-01T00:00:00.000Z";
const A = "org-1";
const B = "org-2";

/** (table, constraint) for every FK version 3 adds. Asserted EQUAL to the shipped preflight below. */
const V3_CONSTRAINTS: ReadonlyArray<readonly [string, string]> = [
  ["sessions", "sessions_user_org_fk"],
  ["households", "households_advisor_org_fk"],
  ["contacts", "contacts_household_org_fk"],
  ["financial_accounts", "financial_accounts_household_org_fk"],
  ["account_opening_applications", "applications_household_org_fk"],
  ["account_opening_applications", "applications_contact_household_org_fk"],
  ["tasks", "tasks_household_org_fk"],
];

const V3_INDEXES = ["users_id_org_unique", "households_id_org_unique", "contacts_id_household_org_unique"];

async function seed(db: SqlDb): Promise<void> {
  for (const org of [A, B]) {
    await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')", [org, TS]);
  }
  for (const [id, org] of [["u1", A], ["u2", B]] as const) {
    await db.query(
      "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'Name','advisor','active',$4,'verin-crm',$4,'high')",
      [id, org, `${id}@firm.test`, TS],
    );
  }
  for (const [id, org] of [["hh1", A], ["hh2", B], ["hh3", A]] as const) {
    await db.query(
      "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,'H',NULL,NULL,'active',$3,'verin-crm',$3,'high')",
      [id, org, TS],
    );
  }
  for (const [id, household] of [["c1", "hh1"], ["c3", "hh3"]] as const) {
    await db.query(
      "INSERT INTO contacts (id,org_id,household_id,first_name,last_name,email,phone,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'F','L',NULL,NULL,$4,'verin-crm',$4,'high')",
      [id, A, household, TS],
    );
  }
}

/** Put the store back in the state a pre-migration-3 deployment left it in. */
async function rewindToVersion2(db: SqlDb): Promise<void> {
  for (const [table, constraint] of V3_CONSTRAINTS) {
    await db.exec(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint};`);
  }
  for (const index of V3_INDEXES) await db.exec(`DROP INDEX ${index};`);
  await db.query("DELETE FROM schema_migrations WHERE version = 3");
}

async function rewindToVersion1(db: SqlDb): Promise<void> {
  await db.exec("DROP INDEX sessions_expires;");
  await db.query("DELETE FROM schema_migrations WHERE version = 2");
}

const appliedVersions = async (db: SqlDb): Promise<number[]> => {
  const r = await db.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version ASC");
  return r.rows.map((row) => Number(row.version));
};

const schemaIndexes = async (db: SqlDb): Promise<unknown[]> => {
  const result = await db.query(
    "SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname",
  );
  return result.rows;
};

/** Every planted orphan class, each keyed to the ONE relationship it must trip. */
const ORPHANS: ReadonlyArray<{
  readonly relationship: string;
  readonly plant: (db: SqlDb) => Promise<unknown>;
  /** A read that must still return the planted row after the refusal. */
  readonly survives: readonly [sql: string, params: readonly unknown[]];
}> = [
  {
    relationship: "sessions_user_org_fk",
    plant: (db) => db.query("INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ('s-legacy','u1',$1,'advisor',$2,$2,NULL)", [B, TS]),
    survives: ["SELECT org_id AS v FROM sessions WHERE id = 's-legacy'", []],
  },
  {
    relationship: "households_advisor_org_fk",
    plant: (db) => db.query("UPDATE households SET advisor_user_id = 'u1' WHERE id = 'hh2'"),
    survives: ["SELECT advisor_user_id AS v FROM households WHERE id = 'hh2'", []],
  },
  {
    relationship: "contacts_household_org_fk",
    plant: (db) => db.query(
      "INSERT INTO contacts (id,org_id,household_id,first_name,last_name,email,phone,created_at,prov_source,prov_asof,prov_confidence) VALUES ('c-legacy',$1,'hh1','F','L',NULL,NULL,$2,'verin-crm',$2,'high')",
      [B, TS],
    ),
    survives: ["SELECT household_id AS v FROM contacts WHERE id = 'c-legacy'", []],
  },
  {
    relationship: "financial_accounts_household_org_fk",
    plant: (db) => db.query(
      "INSERT INTO financial_accounts (id,org_id,household_id,account_type,custodian,balance_minor_units,currency,status,open_date,created_at,prov_source,prov_asof,prov_confidence) VALUES ('fa-legacy',$1,'hh1','individual',NULL,NULL,'USD','open',NULL,$2,'verin-crm',$2,'high')",
      [B, TS],
    ),
    survives: ["SELECT household_id AS v FROM financial_accounts WHERE id = 'fa-legacy'", []],
  },
  {
    relationship: "applications_household_org_fk",
    plant: (db) => db.query(
      "INSERT INTO account_opening_applications (id,org_id,household_id,contact_id,account_type,status,esign_token,idempotency_key,created_at,updated_at,prov_source,prov_asof,prov_confidence) VALUES ('app-legacy',$1,'hh1','c1','individual','draft',NULL,'k1',$2,$2,'verin-crm',$2,'high')",
      [B, TS],
    ),
    survives: ["SELECT household_id AS v FROM account_opening_applications WHERE id = 'app-legacy'", []],
  },
  {
    relationship: "applications_contact_household_org_fk",
    // The household edge is CLEAN here (hh1 really is in org-1): only the contact
    // composite is wrong, so this class cannot hide behind the household probe.
    plant: (db) => db.query(
      "INSERT INTO account_opening_applications (id,org_id,household_id,contact_id,account_type,status,esign_token,idempotency_key,created_at,updated_at,prov_source,prov_asof,prov_confidence) VALUES ('app-crossed',$1,'hh1','c3','individual','draft',NULL,'k2',$2,$2,'verin-crm',$2,'high')",
      [A, TS],
    ),
    survives: ["SELECT contact_id AS v FROM account_opening_applications WHERE id = 'app-crossed'", []],
  },
  {
    relationship: "tasks_household_org_fk",
    plant: (db) => db.query(
      "INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ('t-legacy',$1,'hh1','S','open',NULL,NULL,$2,'verin-crm',$2,'high')",
      [B, TS],
    ),
    survives: ["SELECT household_id AS v FROM tasks WHERE id = 't-legacy'", []],
  },
];

describe("migration 3 upgrade rehearsal (preflight, integration)", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await seed(db);
    await rewindToVersion2(db);
  });

  it("the planted classes cover EXACTLY the relationships migration 3 preflights (no class goes unchecked)", () => {
    const shipped = (MIGRATIONS.find((m) => m.version === 3)?.preflight ?? []).map((p) => p.relationship);
    expect(new Set(shipped)).toEqual(new Set(V3_CONSTRAINTS.map(([, c]) => c)));
    expect(new Set(ORPHANS.map((o) => o.relationship))).toEqual(new Set(shipped));
    expect(shipped.length).toBe(V3_CONSTRAINTS.length);
  });

  it("the all-valid upgrade path applies migration 3 and records it", async () => {
    expect(await appliedVersions(db)).toEqual([1, 2]);
    await runMigrations(db);
    expect(await appliedVersions(db)).toEqual([1, 2, 3]);
    // The constraints really came back: a cross-tenant contact is refused again.
    await expect(db.query(
      "INSERT INTO contacts (id,org_id,household_id,first_name,last_name,email,phone,created_at,prov_source,prov_asof,prov_confidence) VALUES ('c-after',$1,'hh1','F','L',NULL,NULL,$2,'verin-crm',$2,'high')",
      [B, TS],
    )).rejects.toThrow(/foreign key|violates|constraint/i);
  });

  it("runs all pending preflights before the first pending schema mutation", async () => {
    await rewindToVersion1(db);
    await ORPHANS[0]!.plant(db);
    const indexesBefore = await schemaIndexes(db);
    const rowBefore = await db.query<{ org_id: string }>(
      "SELECT org_id FROM sessions WHERE id = 's-legacy'",
    );

    const message = await runMigrations(db).then(
      () => "",
      (error: { message?: string }) => error.message ?? "",
    );

    expect(message).toContain("migration 3 (tenant-qualified-relationships) cannot be applied");
    expect(await appliedVersions(db)).toEqual([1]);
    expect(await schemaIndexes(db)).toEqual(indexesBefore);
    expect(await db.query<{ org_id: string }>(
      "SELECT org_id FROM sessions WHERE id = 's-legacy'",
    )).toEqual(rowBefore);
  });

  for (const orphan of ORPHANS) {
    it(`refuses the upgrade and preserves the row when ${orphan.relationship} is violated`, async () => {
      await orphan.plant(db);
      const before = await db.query<{ v: string }>(orphan.survives[0], [...orphan.survives[1]]);

      const message = await runMigrations(db).then(() => "", (e: { message?: string }) => e.message ?? "");
      // The PREFLIGHT phrasing, not the rolled-back-DDL phrasing: a constraint that
      // merely blew up inside the transaction would also name the relationship, so
      // asserting on the relationship alone would pass with no preflight at all.
      expect(message).toContain("migration 3 (tenant-qualified-relationships) cannot be applied to this store");
      expect(message).toContain("no schema change was made and no row was modified");
      expect(message).toContain(orphan.relationship);

      // Nothing was applied and nothing was touched.
      expect(await appliedVersions(db)).toEqual([1, 2]);
      const after = await db.query<{ v: string }>(orphan.survives[0], [...orphan.survives[1]]);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows.length).toBe(1);
    });
  }

  it("reports EVERY violating relationship at once, not just the first", async () => {
    await ORPHANS[0]!.plant(db);
    await ORPHANS[6]!.plant(db);
    const message = await runMigrations(db).then(
      () => "",
      (e: { message?: string }) => e.message ?? "",
    );
    expect(message).toContain("sessions_user_org_fk");
    expect(message).toContain("tasks_household_org_fk");
    expect(message).toContain("no row was modified");
  });

  it("an orphan whose key columns are NULL is NOT refused (the probe mirrors MATCH SIMPLE)", async () => {
    // tasks.household_id is nullable; MATCH SIMPLE skips the check, so must the probe.
    await db.query(
      "INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ('t-null',$1,NULL,'S','open',NULL,NULL,$2,'verin-crm',$2,'high')",
      [B, TS],
    );
    await runMigrations(db);
    expect(await appliedVersions(db)).toEqual([1, 2, 3]);
  });
});

describe("migration failure diagnostics", () => {
  it("names the failing migration without surfacing driver text", async () => {
    const stub: SqlDb = {
      query: async (sql: string) => ({ rows: sql.includes("schema_migrations") ? [] : [{ orphans: 0 }] }) as never,
      exec: async () => undefined,
      transaction: async () => {
        throw Object.assign(
          new Error("duplicate key value includes alice@example.com"),
          { code: "23505" },
        );
      },
      dump: async () => new Blob(),
      close: async () => undefined,
    };
    const failure = await runMigrations(stub).then(() => null, (e: unknown) => e as { code: string; message: string; context?: Record<string, unknown> });
    expect(failure).toMatchObject({
      code: "INTERNAL",
      context: {
        version: 1,
        name: "baseline",
        category: "driver-error:23505",
      },
    });
    expect(failure!.message).toContain("migration 1 (baseline) failed and was rolled back");
    expect(failure!.message).toContain("driver-error:23505");
    expect(failure!.message).not.toContain("duplicate key");
    expect(failure!.message).not.toContain("alice@example.com");
  });

  it.each([
    "ledger-bootstrap",
    "applied-version-read",
    "preflight",
  ] as const)("sanitizes driver failures during %s", async (stage) => {
    let queryCount = 0;
    const driverError = Object.assign(
      new Error("violating row includes alice@example.com"),
      { code: "23503" },
    );
    const stub: SqlDb = {
      exec: async () => {
        if (stage === "ledger-bootstrap") throw driverError;
      },
      query: async () => {
        queryCount += 1;
        if (stage === "applied-version-read" && queryCount === 1) throw driverError;
        if (stage === "preflight" && queryCount > 1) throw driverError;
        return {
          rows: stage === "preflight"
            ? [{ version: 1 }, { version: 2 }]
            : [],
        } as never;
      },
      transaction: async <T>() => undefined as T,
      dump: async () => new Blob(),
      close: async () => undefined,
    };
    const failure = await runMigrations(stub).then(
      () => null,
      (error: unknown) => error as { code: string; message: string; context?: Record<string, unknown> },
    );
    expect(failure?.code).toBe("INTERNAL");
    expect(failure?.context).toMatchObject({
      stage,
      category: "driver-error:23503",
    });
    expect(failure?.message).not.toContain("violating row");
    expect(failure?.message).not.toContain("alice@example.com");
  });
});
