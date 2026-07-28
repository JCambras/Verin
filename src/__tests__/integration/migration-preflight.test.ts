import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { MIGRATIONS, MIGRATION_SQL, runMigrations } from "@infra/store/migrations";

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

/**
 * AN EMPTY LEDGER IS A CLAIM, NOT A FACT. The bootstrap path trusts an empty
 * schema_migrations enough to apply version 1 and RECORD it before any later
 * preflight has run, which is safe only on a store that has genuinely never been
 * migrated. A dump restored without its schema_migrations rows (or a dropped ledger)
 * presents exactly the same way while holding real rows, so versions would be
 * recorded against a schema nobody verified. The contract proven here is that such a
 * store is refused BEFORE the first mutation, and that ZERO mutations occur.
 */
describe("virgin-store proof (restored dump with a missing ledger)", () => {
  /** Every object in the schema, so "nothing changed" means the whole surface. */
  const schemaSnapshot = async (db: SqlDb): Promise<unknown[]> => {
    const result = await db.query(`
      SELECT 'relation' AS kind, c.relname AS name FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind IN ('r','i','v','m','S','p')
      UNION ALL
      SELECT 'trigger', t.tgname FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname = current_schema()
      UNION ALL
      SELECT 'routine', p.proname FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = current_schema()
      ORDER BY 1, 2
    `);
    return result.rows;
  };

  it("refuses a store whose managed tables exist while the ledger is empty, changing nothing", async () => {
    const db = await createMemoryDb();
    await seed(db);
    // The restore: every managed object is present, the ledger rows are not.
    await db.query("DELETE FROM schema_migrations");

    const schemaBefore = await schemaSnapshot(db);
    const indexesBefore = await schemaIndexes(db);
    const householdsBefore = await db.query("SELECT id, org_id, name FROM households ORDER BY id");
    expect(await appliedVersions(db)).toEqual([]);

    const message = await runMigrations(db).then(
      () => "",
      (error: { message?: string }) => error.message ?? "",
    );

    expect(message).toContain("the migration ledger is empty but this store already contains");
    expect(message).toContain("no schema change was made and no version was recorded");
    // The diagnostic must be actionable: it names the objects it found, and those
    // are OUR identifiers, never row data.
    expect(message).toContain("households");
    expect(message).toContain("audit_log_no_update");
    expect(message).not.toContain("@");

    // ZERO mutations: the ledger is still empty and the schema is byte-for-byte as found.
    expect(await appliedVersions(db)).toEqual([]);
    expect(await schemaSnapshot(db)).toEqual(schemaBefore);
    expect(await schemaIndexes(db)).toEqual(indexesBefore);
    expect(await db.query("SELECT id, org_id, name FROM households ORDER BY id")).toEqual(householdsBefore);
  });

  it("refuses when a SINGLE managed object survives a partial restore", async () => {
    const db = await createMemoryDb();
    await db.exec("DROP TRIGGER audit_log_no_truncate ON audit_log;");
    await db.exec("DROP TABLE tasks CASCADE;");
    await db.query("DELETE FROM schema_migrations");
    const message = await runMigrations(db).then(() => "", (e: { message?: string }) => e.message ?? "");
    expect(message).toContain("the migration ledger is empty but this store already contains");
    expect(await appliedVersions(db)).toEqual([]);
  });

  it("a GENUINELY virgin store still bootstraps every version (the proof is not a blanket refusal)", async () => {
    const db = await createMemoryDb();
    expect(await appliedVersions(db)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("a NEIGHBOUR schema's same-named objects do not block a virgin bootstrap", async () => {
    // Verin can share a managed Postgres with another schema. The probe asks what
    // THIS schema owns, so a neighbour that happens to own a table, a trigger, or a
    // function with one of our names is none of our business - an unqualified
    // pg_trigger scan sees every schema's triggers and would refuse a correct
    // deployment, telling the operator to restore a ledger that never existed.
    const db = await createMemoryDb();
    // Our schema back to genuinely virgin; the neighbour's objects stay, and they
    // carry OUR names on purpose.
    await db.exec(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      CREATE SCHEMA neighbour;
      CREATE TABLE neighbour.audit_log (id text primary key);
      CREATE FUNCTION neighbour.audit_log_immutable() RETURNS trigger AS $$
        BEGIN RETURN NULL; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON neighbour.audit_log
        FOR EACH ROW EXECUTE FUNCTION neighbour.audit_log_immutable();
    `);
    expect(await schemaSnapshot(db)).toEqual([]);
    await runMigrations(db);
    expect(await appliedVersions(db)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("the managed-object set is DERIVED from the shipped DDL, so a new table cannot escape it", async () => {
    // Not a hand-list: every table, index, trigger, and function the migrations
    // create must be present in the live schema of a fully-migrated store.
    const db = await createMemoryDb();
    const live = new Set((await schemaSnapshot(db)).map((row) => String((row as { name: string }).name)));
    const declared = [
      ...MIGRATION_SQL.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi),
      ...MIGRATION_SQL.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi),
      ...MIGRATION_SQL.matchAll(/CREATE\s+TRIGGER\s+([a-z_][a-z0-9_]*)/gi),
      ...MIGRATION_SQL.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z0-9_]*)/gi),
    ].map((m) => m[1]!.toLowerCase());
    expect(declared.length).toBeGreaterThan(20);
    expect(declared.filter((name) => !live.has(name))).toEqual([]);
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
