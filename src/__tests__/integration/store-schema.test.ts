import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { MIGRATIONS, runMigrations } from "@infra/store/migrations";

/**
 * STORE SCHEMA HARDENING (deep-review r6 finding #6, D-016 executed). Locks the
 * DDL guarantees the hardening added, each proven ADVERSARIALLY (a violation is
 * injected and the store must reject it - detection is not verification):
 *   - timestamptz temporal columns order/compare by INSTANT, not lexicographically
 *     on whatever offset a writer emitted (the `claimed_at < $2` reclaim foot-gun),
 *     and reads normalize back to a canonical UTC ISO-8601 string;
 *   - the household_id / org_id foreign keys reject orphaned rows;
 *   - the versioned-migration mechanism records applied versions and is idempotent.
 * Uses real PGlite Postgres (no mocks) - the FKs and type coercion are the DB's.
 */

const ORG = "org-1";
const TS = "2026-01-01T00:00:00.000Z";

async function seed(db: SqlDb): Promise<void> {
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')", [ORG, TS]);
  await db.query(
    "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('u1',$1,'a@firm.test','A','advisor','active',$2,'verin-crm',$2,'high')",
    [ORG, TS],
  );
  await db.query(
    "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('hh1',$1,'H',NULL,NULL,'active',$2,'verin-crm',$2,'high')",
    [ORG, TS],
  );
}

const insertContact = (db: SqlDb, id: string, householdId: string) =>
  db.query(
    "INSERT INTO contacts (id,org_id,household_id,first_name,last_name,email,phone,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'F','L',NULL,NULL,$4,'verin-crm',$4,'high')",
    [id, ORG, householdId, TS],
  );

const insertAccount = (db: SqlDb, id: string, householdId: string) =>
  db.query(
    "INSERT INTO financial_accounts (id,org_id,household_id,account_type,custodian,balance_minor_units,currency,status,open_date,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'individual',NULL,NULL,'USD','open',NULL,$4,'verin-crm',$4,'high')",
    [id, ORG, householdId, TS],
  );

describe("store schema hardening (integration)", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await seed(db);
  });

  describe("foreign keys reject orphaned rows (missing before the hardening)", () => {
    it("contacts.household_id must reference an existing household", async () => {
      // Adversarial: a household id that does not exist is REJECTED.
      await expect(insertContact(db, "c-orphan", "ghost-household")).rejects.toThrow(/foreign key|violates|constraint/i);
      // The same insert against a real household succeeds (the FK is not just always-throwing).
      await expect(insertContact(db, "c-ok", "hh1")).resolves.toBeDefined();
    });

    it("financial_accounts.household_id must reference an existing household", async () => {
      await expect(insertAccount(db, "fa-orphan", "ghost-household")).rejects.toThrow(/foreign key|violates|constraint/i);
      await expect(insertAccount(db, "fa-ok", "hh1")).resolves.toBeDefined();
    });

    it("sessions.org_id must reference an existing org", async () => {
      // Valid user, but a non-existent org: the newly-added sessions.org_id FK rejects it.
      await expect(
        db.query(
          "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ('s-orphan','u1','ghost-org','advisor',$1,$1,NULL)",
          [TS],
        ),
      ).rejects.toThrow(/foreign key|violates|constraint/i);
      await expect(
        db.query(
          "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ('s-ok','u1',$1,'advisor',$2,$2,NULL)",
          [ORG, TS],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("temporal columns are timestamptz (order by instant, not lexicographically)", () => {
    it("orders by the true instant even when the offset makes the wall-clock string misleading", async () => {
      // EARLY is the earlier INSTANT (01:00Z) but its written form ('…T13:00…+12:00')
      // sorts LEXICOGRAPHICALLY AFTER LATE ('…T10:00…Z'). Under the old `text` column
      // ORDER BY would return [LATE, EARLY]; timestamptz orders by instant → [EARLY, LATE].
      await insertAccountAt(db, "acct-early", "2026-07-19T13:00:00.000+12:00"); // = 2026-07-19T01:00Z
      await insertAccountAt(db, "acct-late", "2026-07-19T10:00:00.000Z");
      const rows = await db.query<{ id: string }>(
        "SELECT id FROM financial_accounts WHERE org_id = $1 AND open_date IS NOT NULL ORDER BY open_date ASC",
        [ORG],
      );
      expect(rows.rows.map((r) => r.id)).toEqual(["acct-early", "acct-late"]);
    });

    it("reads normalize any written offset back to a canonical UTC ISO-8601 string", async () => {
      await insertAccountAt(db, "acct-offset", "2026-07-19T13:00:00.000+12:00");
      const r = await db.query<{ open_date: string }>("SELECT open_date FROM financial_accounts WHERE id = 'acct-offset'");
      expect(r.rows[0]!.open_date).toBe("2026-07-19T01:00:00.000Z");
      expect(typeof r.rows[0]!.open_date).toBe("string"); // never a Date object at the app boundary
    });

    it("the audit_outbox reclaim predicate (`claimed_at < $2`, audit-store.ts) compares by instant, not string", async () => {
      // Mirrors drainOutbox's reclaim WHERE clause exactly, with a CONTROLLED cutoff so
      // the proof is clock-independent. The stale claim's instant (00:00Z) is written
      // with a +12:00 offset ('…T12:00…+12:00'), so its STRING sorts AFTER the fresh
      // claim's and after the cutoff - under a `text` column `claimed_at < cutoff` would
      // MISS this genuinely stale row (the foot-gun). timestamptz compares by instant.
      const enqueue = (id: string, claimedAt: string) =>
        db.query(
          "INSERT INTO audit_outbox (id, org_id, payload_json, status, attempts, created_at, claimed_at) VALUES ($1,$2,'{}','claimed',1,$3,$4)",
          [id, ORG, TS, claimedAt],
        );
      await enqueue("ob-stale", "2026-07-19T12:00:00.000+12:00"); // instant = 2026-07-19T00:00Z (stale)
      await enqueue("ob-fresh", "2026-07-19T10:00:00.000Z"); // instant = 2026-07-19T10:00Z (fresh)
      const cutoff = "2026-07-19T05:00:00.000Z"; // between the two instants
      const reclaimable = await db.query<{ id: string }>(
        "SELECT id FROM audit_outbox WHERE org_id = $1 AND status = 'claimed' AND claimed_at < $2 ORDER BY id ASC",
        [ORG, cutoff],
      );
      // Only the genuinely-stale claim (by instant) is reclaimable; the fresh one is not.
      expect(reclaimable.rows.map((r) => r.id)).toEqual(["ob-stale"]);
    });
  });

  describe("versioned-migration mechanism (D-016)", () => {
    it("records every migration version in schema_migrations after a fresh createDb", async () => {
      const applied = await db.query<{ version: number; name: string }>("SELECT version, name FROM schema_migrations ORDER BY version ASC");
      expect(applied.rows.map((r) => ({ version: Number(r.version), name: r.name }))).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
    });

    it("stamps applied_at as a timestamptz (a real ISO instant, not a Date object)", async () => {
      const r = await db.query<{ applied_at: string }>("SELECT applied_at FROM schema_migrations WHERE version = 1");
      expect(typeof r.rows[0]!.applied_at).toBe("string");
      expect(new Date(r.rows[0]!.applied_at).toISOString()).toBe(r.rows[0]!.applied_at); // canonical ISO round-trip
    });

    it("re-running runMigrations is idempotent - no error, no duplicate ledger rows", async () => {
      await runMigrations(db);
      await runMigrations(db);
      const n = await db.query<{ n: string }>("SELECT count(*) AS n FROM schema_migrations");
      expect(Number(n.rows[0]!.n)).toBe(MIGRATIONS.length);
    });

    it("creates the household_id / user_id lookup indexes the hardening added", async () => {
      const idx = await db.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('contacts_household','financial_accounts_household','sessions_user')",
      );
      expect(new Set(idx.rows.map((r) => r.indexname))).toEqual(new Set(["contacts_household", "financial_accounts_household", "sessions_user"]));
    });
  });
});

async function insertAccountAt(db: SqlDb, id: string, openDate: string): Promise<void> {
  await db.query(
    "INSERT INTO financial_accounts (id,org_id,household_id,account_type,custodian,balance_minor_units,currency,status,open_date,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,'hh1','individual',NULL,NULL,'USD','open',$3,$4,'verin-crm',$4,'high')",
    [id, ORG, openDate, TS],
  );
}
