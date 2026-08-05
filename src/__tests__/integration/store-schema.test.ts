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
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ('org-2','Other Firm',$1,'verin-crm',$1,'high')", [TS]);
  await db.query(
    "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('u1',$1,'a@firm.test','A','advisor','active',$2,'verin-crm',$2,'high')",
    [ORG, TS],
  );
  await db.query(
    "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('hh1',$1,'H',NULL,NULL,'active',$2,'verin-crm',$2,'high')",
    [ORG, TS],
  );
  await db.query(
    "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('hh2','org-2','H2',NULL,NULL,'active',$1,'verin-crm',$1,'high')",
    [TS],
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

    it("household references must belong to the row's org", async () => {
      await expect(insertContact(db, "c-cross", "hh2")).rejects.toThrow(/foreign key|violates|constraint/i);
      await expect(insertAccount(db, "fa-cross", "hh2")).rejects.toThrow(/foreign key|violates|constraint/i);
    });

    it("a session user must belong to the session org", async () => {
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
      await expect(
        db.query(
          "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ('s-cross','u1','org-2','advisor',$1,$1,NULL)",
          [TS],
        ),
      ).rejects.toThrow(/foreign key|violates|constraint/i);
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

    it("creates the tenant-scoped partial replay-coverage index", async () => {
      const idx = await db.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'decision_ledger_evidence_recorded'",
      );
      expect(idx.rows).toHaveLength(1);
      expect(idx.rows[0]!.indexdef).toContain(
        "(org_id, evidence_snapshot_id, sequence)",
      );
      expect(idx.rows[0]!.indexdef).toContain(
        "WHERE (event_type = 'EvidenceSnapshotRecorded'::text)",
      );
    });

    it("indexes bundle provenance lookup by tenant and input bundle", async () => {
      const idx = await db.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'decision_records_input_bundle'",
      );
      expect(idx.rows).toHaveLength(1);
      expect(idx.rows[0]!.indexdef).toContain("(org_id, input_bundle_id)");
    });

    it("indexes tenant-scoped first-recording predecessor checks", async () => {
      const indexes = await db.query<{
        indexname: string;
        indexdef: string;
      }>(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'decision_ledger_evidence_recorded',
              'decision_ledger_decision_recorded',
              'decision_ledger_bundle_recorded'
            )`,
      );
      const byName = new Map(
        indexes.rows.map((row) => [row.indexname, row.indexdef]),
      );
      expect(byName.get("decision_ledger_evidence_recorded")).toContain(
        "(org_id, evidence_snapshot_id, sequence)",
      );
      expect(byName.get("decision_ledger_decision_recorded")).toContain(
        "(org_id, decision_id, sequence)",
      );
      expect(byName.get("decision_ledger_bundle_recorded")).toContain(
        "(org_id, input_bundle_id, sequence)",
      );

      await db.exec("SET enable_seqscan = off");
      const plans = await Promise.all([
        db.query<Record<string, string>>(
          `EXPLAIN (COSTS OFF)
           SELECT sequence FROM decision_ledger earlier
            WHERE earlier.org_id = $1
              AND earlier.evidence_snapshot_id = $2
              AND earlier.event_type = 'EvidenceSnapshotRecorded'
              AND earlier.sequence < $3
            ORDER BY earlier.sequence DESC
            LIMIT 1`,
          [ORG, "evidence:test", 100],
        ),
        db.query<Record<string, string>>(
          `EXPLAIN (COSTS OFF)
           SELECT sequence FROM decision_ledger earlier
            WHERE earlier.org_id = $1
              AND earlier.decision_id = $2
              AND earlier.event_type = 'DecisionRecorded'
              AND earlier.sequence < $3
            ORDER BY earlier.sequence DESC
            LIMIT 1`,
          [ORG, "decision:test", 100],
        ),
        db.query<Record<string, string>>(
          `EXPLAIN (COSTS OFF)
           SELECT sequence FROM decision_ledger earlier
            WHERE earlier.org_id = $1
              AND earlier.input_bundle_id = $2
              AND earlier.event_type = 'DecisionRecorded'
              AND earlier.sequence < $3
            ORDER BY earlier.sequence DESC
            LIMIT 1`,
          [ORG, "bundle:test", 100],
        ),
      ]);
      const rendered = plans.map((plan) =>
        plan.rows.flatMap((row) => Object.values(row)).join("\n"));
      expect(rendered[0]).toContain("decision_ledger_evidence_recorded");
      expect(rendered[1]).toContain("decision_ledger_decision_recorded");
      expect(rendered[2]).toContain("decision_ledger_bundle_recorded");
    });

    it("indexes both sides of immutable active-reservation lookup", async () => {
      const indexes = await db.query<{
        indexname: string;
        indexdef: string;
      }>(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'decision_ledger_active_reservation_created',
              'decision_ledger_reservation_released'
            )`,
      );
      const byName = new Map(
        indexes.rows.map((row) => [row.indexname, row.indexdef]),
      );
      expect(
        byName.get("decision_ledger_active_reservation_created"),
      ).toContain(
        "((payload_json)::jsonb #>> '{reservationRef,id}'::text[])",
      );
      expect(
        byName.get("decision_ledger_active_reservation_created"),
      ).toContain("sequence DESC");
      expect(
        byName.get("decision_ledger_active_reservation_created"),
      ).toContain("WHERE (event_type = 'ReservationCreated'::text)");
      expect(
        byName.get("decision_ledger_reservation_released"),
      ).toContain("(org_id, reservation_creation_id, sequence)");
      expect(
        byName.get("decision_ledger_reservation_released"),
      ).toContain("WHERE (event_type = 'ReservationReleased'::text)");

      await db.exec("SET enable_seqscan = off");
      const explained = await db.query<Record<string, string>>(
        `EXPLAIN (COSTS OFF)
         SELECT created.sequence
           FROM decision_ledger created
          WHERE created.org_id = $1
            AND created.event_type = 'ReservationCreated'
            AND created.payload_json::jsonb #>> '{reservationRef,id}' = $2
            AND created.sequence < $3
            AND NOT EXISTS (
                  SELECT 1
                    FROM decision_ledger released
                   WHERE released.org_id = created.org_id
                     AND released.event_type = 'ReservationReleased'
                     AND released.reservation_creation_id = created.id
                     AND released.sequence < $3
                )
          ORDER BY created.sequence DESC
          LIMIT 1`,
        [ORG, "reservation:test", 100],
      );
      const plan = explained.rows
        .flatMap((row) => Object.values(row))
        .join("\n");
      expect(plan).toContain("decision_ledger_active_reservation_created");
      expect(plan).toContain("decision_ledger_reservation_released");
    });

    it("indexes approval authority and execution-handle history lookups", async () => {
      const indexes = await db.query<{ indexname: string }>(
        `SELECT indexname
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'decision_ledger_approval_escalations',
              'decision_ledger_execution_handles'
            )`,
      );
      expect(new Set(indexes.rows.map((row) => row.indexname))).toEqual(
        new Set([
          "decision_ledger_approval_escalations",
          "decision_ledger_execution_handles",
        ]),
      );
      await db.exec("SET enable_seqscan = off");
      const approval = await db.query<Record<string, string>>(
        `EXPLAIN (COSTS OFF)
         SELECT sequence
           FROM decision_ledger ledger
          WHERE ledger.org_id = $1
            AND ledger.decision_id = $2
            AND ledger.event_type = 'ApprovalStageEscalated'
            AND ledger.payload_json::jsonb #>> '{stageId}' = $3
            AND ledger.sequence < $4
          ORDER BY ledger.sequence ASC
          LIMIT $5`,
        [ORG, "decision:test", "stage:test", 100, 2],
      );
      const execution = await db.query<Record<string, string>>(
        `EXPLAIN (COSTS OFF)
         SELECT sequence
           FROM decision_ledger ledger
          WHERE ledger.org_id = $1
            AND ledger.event_type IN (
              'ExecutionSucceeded', 'ExecutionPartiallySucceeded',
              'StatusObserved', 'VerificationStuck'
            )
            AND ledger.payload_json::jsonb #>> '{executionHandleRef,id}' = $2
            AND ledger.sequence < $3
          ORDER BY ledger.sequence ASC
          LIMIT 1`,
        [ORG, "handle:test", 100],
      );
      expect(approval.rows.flatMap((row) => Object.values(row)).join("\n"))
        .toContain("decision_ledger_approval_escalations");
      expect(execution.rows.flatMap((row) => Object.values(row)).join("\n"))
        .toContain("decision_ledger_execution_handles");
    });
  });
});

async function insertAccountAt(db: SqlDb, id: string, openDate: string): Promise<void> {
  await db.query(
    "INSERT INTO financial_accounts (id,org_id,household_id,account_type,custodian,balance_minor_units,currency,status,open_date,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,'hh1','individual',NULL,NULL,'USD','open',$3,$4,'verin-crm',$4,'high')",
    [id, ORG, openDate, TS],
  );
}
