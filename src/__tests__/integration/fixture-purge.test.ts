import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { MIGRATIONS, runMigrations } from "@infra/store/migrations";
import { DEMONSTRATION_ORIGINS, RECORD_ORIGIN_COLUMN } from "@infra/store/record-origin";
import { DEMO_ORG_ID, DEMO_USERS } from "@infra/store/demo-tenant";
import { seedWorldIntoCrm } from "@infra/crm/world-seed";
import { updateHouseholdName } from "@infra/crm/house-crm";
import { systemWriteActor } from "@contracts/principal";
import { parseMachineRecordId } from "@contracts/record-id";
import { canFeedComplianceDecision, provenanceLabel, syntheticBadgeLabel } from "@contracts/provenance";
import { cleanSlateViolations, originBearingTables, sweepFixtureRows } from "../../../scripts/fixture-purge";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";
import { seedDemoStore } from "../../../scripts/seed-demo-store";

/**
 * THE CLEAN-SLATE GUARANTEE, END TO END (ADR-0057; charter #3/#4/#7).
 *
 * The FIRST case is the guarantee itself: the complete `pnpm db:seed` against a
 * migrated store, a purge derived from the LIVE schema, and a count taken from
 * the live schema too. Everything after it exercises ONE mechanism of that
 * guarantee - the sweep's table derivation, the migration backfill, the
 * origin/provenance split, the world load - and every one of them is an
 * OPTIMISATION of the first, never a substitute for it: a mechanism can be
 * perfectly right while the guarantee fails, and it has, three separate times
 * (a column default that answered for rows it never wrote, an insert path that
 * named no origin, a backfill appended to a migration that had already run).
 * Each of those was a path no case ran end to end.
 *
 * That first case is measured over WHAT THE SEED ACTUALLY WROTE - every base
 * table in the live catalog, counted before and after - never over the tables
 * that happen to carry the origin marker. A guarantee checked only where the
 * marker reaches cannot see a seeded path writing somewhere the marker does not,
 * which is the same blindness, one level up: the tables holding the seed's
 * synthetic decision chain and audit entries carry no origin column at all.
 * What survives is NAMED, one table at a time with the reason the store gives.
 *
 * Against a real Postgres store, not a mock:
 *   - a migrated but unseeded instance sweeps CLEAN;
 *   - loading the populated world makes it UNCLEAN, and the sweep names every
 *     table the world touched (a check that cannot see the rows it is meant to
 *     find is the false-pass class this repository exists to prevent);
 *   - purging the demonstration-origin rows returns it to clean, while the
 *     firm's own rows survive - the ORIGIN is what is purged, not the table, and
 *     not the provenance of whatever somebody has since typed into the row.
 */

const ORG = "org-clean-slate";
const TS = "2026-01-01T00:00:00.000Z";
const world = generateWorld(loadWorldSpec(), WORLD_SEED);
const DIGEST = String((world.manifest.value as Record<string, unknown>).worldDigest);
// A slice keeps the store small; the sweep counts rows, so five households
// prove the same property a hundred do.
const HOUSEHOLDS = world.households.slice(0, 5);

let db: SqlDb;

const ORIGINS = DEMONSTRATION_ORIGINS.map((_, index) => `$${index + 1}`).join(",");

/**
 * EVERY TABLE THE LIVE STORE GIVES AN ORIGIN COLUMN - asked of the store's own
 * catalog, not of the shipped DDL and not of `scripts/fixture-purge.ts`. The
 * purge and the final count both read this, so neither can be right about a set
 * of tables the store does not actually have, and a table a DDL derivation
 * misses is still purged and still counted.
 */
async function originBearingTablesInStore(store: SqlDb): Promise<string[]> {
  const rows = await store.query<{ table_name: string }>(
    "SELECT DISTINCT c.table_name FROM information_schema.columns c "
    + "JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
    + "WHERE c.column_name = $1 AND t.table_type = 'BASE TABLE' AND c.table_schema = ANY(current_schemas(false))",
    [RECORD_ORIGIN_COLUMN],
  );
  return rows.rows.map((row) => row.table_name).sort();
}

/**
 * EVERY BASE TABLE THE LIVE STORE HAS, and how many rows are in it - the reading
 * that does not depend on the origin marker existing anywhere. A table the seed
 * writes and the marker never reaches is invisible to every count keyed on
 * `record_origin`, so the guarantee is measured here instead: what the seed
 * WROTE, against what the purge gave back.
 */
async function rowCountsInStore(store: SqlDb): Promise<Record<string, number>> {
  const tables = await store.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables "
    + "WHERE table_type = 'BASE TABLE' AND table_schema = ANY(current_schemas(false)) ORDER BY table_name",
  );
  const counts: Record<string, number> = {};
  for (const { table_name: table } of tables.rows) {
    const rows = await store.query<{ n: string | number }>(`SELECT COUNT(*)::int AS n FROM ${table}`);
    counts[table] = Number(rows.rows[0]?.n ?? 0);
  }
  return counts;
}

/** Tables `after` holds more rows in than `before` did. */
function grownTables(before: Record<string, number>, after: Record<string, number>): string[] {
  return Object.keys(after).filter((table) => after[table]! > (before[table] ?? 0)).sort();
}

/**
 * WHAT THE COMPLETE SEED LEAVES BEHIND THAT NO PURGE CAN TAKE - named one table
 * at a time, with the reason, rather than skipped because the marker does not
 * reach it. Two different reasons, and neither is "nobody looked":
 *
 *   - rows the STORE refuses to delete, because the decision chain and the audit
 *     chain are append-only by DDL trigger (ADR-0007/0041) and the demonstration
 *     tenant and its users are what those irreversible entries are anchored to;
 *   - rows in tables that carry no origin column at all - the immutable replay
 *     sources of that same chain, the heads and projections derived from it, and
 *     the credential and idempotency rows keyed to the identities above.
 *
 * This is why `assertSeedableEnvironment` refuses `APP_ENV=production` before the
 * seed opens a store, and why the instance-level answer to a seeded production
 * database is to recreate it rather than sweep it. The clean-slate guarantee is
 * that a production instance was never seeded AND that any demonstration row is
 * COUNTABLE if one is - not that the seed is reversible, which it is not.
 *
 * The case below proves this list is exact in BOTH directions: an entry naming a
 * table the seed no longer writes fails as loudly as a seeded table missing from
 * it, so it cannot quietly become a list of excuses.
 */
const IRREVERSIBLE_SEED_RESIDUE: Readonly<Record<string, string>> = {
  audit_anchor: "the audit chain's head, describing entries that cannot be removed",
  audit_log: "append-only by DDL trigger (ADR-0007): the seed's audited marker cannot be deleted at all",
  credentials: "the demo users' password hashes - no origin column of its own, and removable only with the user rows the store refuses to delete",
  crm_write_cache: "the org-keyed idempotency cache the seed's audited write populates - no origin column",
  decision_input_bundle_evidence: "an immutable replay source of the decision chain, append-only by the same trigger",
  decision_input_bundles: "an immutable replay source of the decision chain, append-only by the same trigger",
  decision_ledger: "append-only by DDL trigger (ADR-0041): the synthetic chain entries are irreversible",
  decision_ledger_anchor: "the decision chain's head, describing entries that cannot be removed",
  decision_records: "an immutable replay source of the decision chain, append-only by the same trigger",
  decision_state_projection: "derived state rebuilt FROM entries that cannot be removed (ledger-rebuild.ts)",
  evidence_snapshots: "an immutable replay source of the decision chain, append-only by the same trigger",
  orgs: "the demonstration tenant itself - marked demo-seed and counted as such, and refused because every append-only chain above is anchored to this org",
  users: "the two demo users, marked demo-seed and counted as such, and refused while their credentials reference them",
};

/** Demonstration-origin rows per table, counted the same way. */
async function demonstrationRowsInStore(store: SqlDb): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await originBearingTablesInStore(store)) {
    const rows = await store.query<{ n: string | number }>(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${RECORD_ORIGIN_COLUMN} IN (${ORIGINS})`,
      [...DEMONSTRATION_ORIGINS],
    );
    const n = Number(rows.rows[0]?.n ?? 0);
    if (n > 0) counts[table] = n;
  }
  return counts;
}

/**
 * THE PURGE, DERIVED FROM THE LIVE SCHEMA. A hand-kept list of tables is the
 * same fail-open as a hand-kept list of swept tables: the table nobody
 * remembered is the one holding the rows. Keyed on the ROW's origin, never on
 * the provenance of the values in it.
 *
 * Order is DISCOVERED rather than declared - the household foreign keys are
 * real, so a parent whose children are still there refuses and is retried on the
 * next pass. A table that still refuses when no pass makes progress is REPORTED
 * with the store's own words rather than swallowed: a purge that quietly leaves
 * rows behind and a purge that removed them are indistinguishable to a caller
 * who is not told.
 */
async function purgeDemonstrationRecords(store: SqlDb): Promise<Map<string, string>> {
  const pending = new Set(await originBearingTablesInStore(store));
  const refused = new Map<string, string>();
  for (let progress = true; progress && pending.size > 0;) {
    progress = false;
    for (const table of [...pending]) {
      try {
        await store.query(
          `DELETE FROM ${table} WHERE ${RECORD_ORIGIN_COLUMN} IN (${ORIGINS})`,
          [...DEMONSTRATION_ORIGINS],
        );
        pending.delete(table);
        refused.delete(table);
        progress = true;
      } catch (e) {
        refused.set(table, e instanceof Error ? e.message : String(e));
      }
    }
  }
  return refused;
}

/** The versions that introduced `record_origin` and each corrective backfill,
 * read from the shipped plan rather than typed, so appending a migration cannot
 * silently point the upgrade tests at the wrong one. */
const ORIGIN_VERSION = MIGRATIONS.find((migration) => migration.name === "record-origin")!.version;
const WORLD_BACKFILL_VERSION = MIGRATIONS.find((migration) => migration.name === "record-origin-backfill")!.version;

/** The store as it stood BEFORE the origin column existed: the column gone from
 * every table the shipped DDL gives one, and the ledger recording the versions
 * up to that point - which is what makes the next `runMigrations` a real upgrade
 * rather than a virgin bootstrap. `createMemoryDb` migrates on creation, so this
 * is how a pre-version-9 store is reached at all. The table list is DERIVED from
 * the DDL, so a table added to that migration cannot be left behind here. */
async function rewindPastRecordOrigin(store: SqlDb): Promise<void> {
  for (const table of originBearingTables()) {
    await store.exec(`ALTER TABLE ${table} DROP COLUMN ${RECORD_ORIGIN_COLUMN}`);
  }
  await store.query("DELETE FROM schema_migrations WHERE version >= $1", [ORIGIN_VERSION]);
  const columns = await store.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE column_name = $1 AND table_schema = ANY(current_schemas(false))",
    [RECORD_ORIGIN_COLUMN],
  );
  expect(Number(columns.rows[0]!.n), "the rewind must actually remove the column").toBe(0);
}

/** World rows as they were written before the origin column existed: labeled
 * `prov_source = 'fixture'` and nothing else, beside one row the firm's own
 * console wrote. Literal columns, because the point is that this store's
 * `households` has no `record_origin` to write. */
async function seedTheOldWay(store: SqlDb): Promise<void> {
  for (const [id, name] of [["upgrade-hh-1", "Seeded Household One"], ["upgrade-hh-2", "Seeded Household Two"]]) {
    await store.query(
      "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,NULL,NULL,'active',$4,'fixture',$4,'medium')",
      [id, ORG, name, TS],
    );
    await store.query(
      "INSERT INTO contacts (id,org_id,household_id,first_name,last_name,email,phone,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'Seeded','Person',NULL,NULL,$4,'fixture',$4,'medium')",
      [`${id}-contact`, ORG, id, TS],
    );
  }
  await store.query(
    "INSERT INTO tasks (id,org_id,household_id,subject,status,due_date,assignee_user_id,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,'upgrade-hh-1','Verify the seeded instruction','not-started',NULL,NULL,$3,'fixture',$3,'medium')",
    ["upgrade-task-1", ORG, TS],
  );
  await store.query(
    "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('upgrade-firm-own',$1,'A Real Household',NULL,NULL,'active',$2,'verin-crm',$2,'high')",
    [ORG, TS],
  );
}

/** The demonstration FIRM and its two demonstration accounts as the seed wrote
 * them before either insert named an origin, beside a real account of the same
 * org - the developer whose own user lives in the demo tenant, and whose record
 * a repair that keyed on org membership would condemn to the purge. Literal
 * columns, because the point is that this store's `orgs`/`users` have no
 * `record_origin` to write. */
const DEMO_FIRM_OWN_USER = "demo-firm-own-user";

async function seedTheDemoFirmTheOldWay(store: SqlDb): Promise<void> {
  await store.query(
    "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Verin Demo Firm',$2,'verin-crm',$2,'high')",
    [DEMO_ORG_ID, TS],
  );
  const insertUser = "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence)"
    + " VALUES ($1,$2,$3,$4,$5,'active',$6,'verin-crm',$6,'high')";
  for (const [index, user] of DEMO_USERS.entries()) {
    await store.query(insertUser, [`upgrade-demo-user-${index}`, DEMO_ORG_ID, user.email, user.displayName, user.role, TS]);
  }
  await store.query(insertUser, [DEMO_FIRM_OWN_USER, DEMO_ORG_ID, "real.advisor@example.test", "A Real Advisor", "advisor", TS]);
}

beforeEach(async () => {
  db = await createMemoryDb();
  await runMigrations(db);
  await db.query(
    "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Clean Slate Firm',$2,'verin-crm',$2,'high')",
    [ORG, TS],
  );
});

describe("clean-slate guarantee", () => {
  it("THE GUARANTEE, against the COMPLETE seed: every row the seed wrote is gone, or NAMED with the reason it cannot be", async () => {
    // The whole of `pnpm db:seed` - the org, the users, the audited marker, the
    // synthetic decision chain and the hundred-household world - against a
    // migrated store, then a purge derived from the LIVE schema, then a count
    // taken the same way. Every case below this one exercises ONE mechanism; a
    // mechanism can be right while the guarantee fails, and it has, three
    // separate times (a defaulted column, an unmarked insert path, a migration
    // that never ran). This case is the guarantee itself, so it is the one that
    // has to see every seeded path at once - which means measuring it over EVERY
    // base table in the live catalog, not over the ones carrying the marker.
    const before = await rowCountsInStore(db);
    await seedDemoStore(db);
    const seededTables = grownTables(before, await rowCountsInStore(db));
    expect(seededTables.length, "the seed must actually write something to measure").toBeGreaterThan(5);

    const seeded = await demonstrationRowsInStore(db);
    expect(
      Object.keys(seeded).sort(),
      "every table the complete seed writes demonstration rows into must be countable as such",
    ).toEqual(["contacts", "decision_ledger", "households", "orgs", "tasks", "users"]);

    const refused = await purgeDemonstrationRecords(db);
    const after = await rowCountsInStore(db);

    // THE GUARANTEE, stated over what the seed WROTE. A seeded path writing into
    // a table the marker does not cover is invisible to every origin-keyed count,
    // so it is caught here: its rows are still there, the table is still grown,
    // and it is not one of the named ones.
    const residue = grownTables(before, after);
    expect(
      residue,
      "every table the seed grew is back to where it started, or NAMED with the reason it cannot be",
    ).toEqual(Object.keys(IRREVERSIBLE_SEED_RESIDUE).sort());
    // Both directions: a name that no longer describes a seeded table is a stale
    // excuse, and an excuse nobody re-earns is how a list like this rots.
    expect(
      Object.keys(IRREVERSIBLE_SEED_RESIDUE).filter((table) => !seededTables.includes(table)),
      "a named residue table the seed does not write is a stale excuse",
    ).toEqual([]);
    for (const table of seededTables) {
      if (table in IRREVERSIBLE_SEED_RESIDUE) continue;
      expect(after[table], `${table} was seeded, is not named irreversible, and must be back to its pre-seed count`)
        .toBe(before[table] ?? 0);
    }

    // WHAT THE STORE ITSELF REFUSES, named rather than tolerated silently, and
    // every refusal quoted in the store's own words. The decision chain is
    // append-only by DDL trigger (ADR-0041); the demonstration tenant and its
    // users are marked and counted, and refused because rows that cannot be
    // deleted reference them. No purge returns that store to clean, which is why
    // the seed refuses to run against production at all
    // (`assertSeedableEnvironment`) and why the instance-level answer there is to
    // recreate the store, not to sweep it.
    expect([...refused.keys()].sort()).toEqual(["decision_ledger", "orgs", "users"]);
    expect(refused.get("decision_ledger")).toMatch(/append-only/);
    expect(refused.get("orgs")).toMatch(/foreign key/);
    expect(refused.get("users")).toMatch(/foreign key/);
    const left = await demonstrationRowsInStore(db);
    expect(
      Object.keys(left).filter((table) => !refused.has(table)).sort(),
      "a seeded path that writes a row the purge does not remove fails here",
    ).toEqual([]);

    // And the operator-facing check says so, rather than reporting clean over it.
    const violations = cleanSlateViolations(await sweepFixtureRows(db));
    expect(
      violations.map((violation) => violation.slice(0, violation.indexOf(":"))).sort(),
      "the check names every demonstration row it can still see, and nothing it cannot",
    ).toEqual([...refused.keys()].sort());
  });

  it("a migrated, unseeded instance is clean", async () => {
    const sweep = await sweepFixtureRows(db);
    expect(sweep.problems).toEqual([]);
    expect(sweep.tables.length, "the sweep must actually cover tables").toBeGreaterThan(5);
    expect(cleanSlateViolations(sweep)).toEqual([]);
  });

  it("loading the world makes the instance unclean, and the sweep names every table it touched", async () => {
    const loaded = await seedWorldIntoCrm(db, systemWriteActor("seed", ORG), HOUSEHOLDS, DIGEST);
    expect(loaded.ok).toBe(true);
    const sweep = await sweepFixtureRows(db);
    const dirty = sweep.tables.filter((entry) => entry.rows > 0).map((entry) => entry.table).sort();
    expect(dirty).toEqual(["contacts", "households", "tasks"]);
    const violations = cleanSlateViolations(sweep);
    expect(violations.length, "a populated instance must fail the clean-slate check").toBeGreaterThan(0);
    expect(violations.every((violation) => violation.includes("must contain none"))).toBe(true);
  });

  it("purging the demonstration-origin rows restores clean and leaves the firm's own records alone", async () => {
    await seedWorldIntoCrm(db, systemWriteActor("seed", ORG), HOUSEHOLDS, DIGEST);
    await db.query(
      "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('real-hh',$1,'A Real Household',NULL,NULL,'active',$2,'verin-crm',$2,'high')",
      [ORG, TS],
    );
    await purgeDemonstrationRecords(db);
    const sweep = await sweepFixtureRows(db);
    expect(cleanSlateViolations(sweep)).toEqual([]);
    const survivors = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM households WHERE org_id = $1", [ORG]);
    expect(Number(survivors.rows[0]!.n), "purging fixtures must not touch the firm's own records").toBe(1);
  });

  it("a RENAMED seeded household reads as user-entered AND is still purged", async () => {
    // The two facts, proved apart. The advisor typed the name, so the VALUE is
    // user-entered and renders un-watermarked - labeling their own words "Sample
    // data" is charter #3's mislabel in the direction nobody watches. The ROW is
    // still a demonstration record, so the clean-slate purge still takes it: if
    // an edit exempted a row, demo data would reach production because somebody
    // renamed it, which is the exact hole the guarantee exists to close.
    const actor = systemWriteActor("seed", ORG);
    await seedWorldIntoCrm(db, actor, HOUSEHOLDS, DIGEST);
    const id = parseMachineRecordId("household", HOUSEHOLDS[0]!.id)!;
    const renamed = await updateHouseholdName(db, actor, id, "The Name An Advisor Typed");
    expect(renamed.ok, renamed.ok ? "" : renamed.error.message).toBe(true);

    const provenance = renamed.ok ? renamed.value.provenance : null;
    expect(provenance?.source, "a human typed this name; the value is theirs").toBe("user-input");
    // What the console actually renders beside the name: FreshValue prints this
    // label, and `<Metric>`/the badge helpers print no synthetic class for it.
    expect(provenanceLabel(provenance!)).toMatch(/^Entered · as of /);
    expect(syntheticBadgeLabel(provenance!), "a typed name must carry no synthetic badge").toBeNull();
    expect(canFeedComplianceDecision(provenance!)).toBe(true);

    const row = await db.query<{ record_origin: string; prov_source: string }>(
      "SELECT record_origin, prov_source FROM households WHERE id = $1",
      [HOUSEHOLDS[0]!.id],
    );
    expect(row.rows[0], "the rename must not move where the ROW came from")
      .toEqual({ record_origin: "world-fixture", prov_source: "user-input" });

    const before = await sweepFixtureRows(db);
    expect(cleanSlateViolations(before).length, "the renamed row is still demonstration data").toBeGreaterThan(0);
    await purgeDemonstrationRecords(db);
    expect(cleanSlateViolations(await sweepFixtureRows(db))).toEqual([]);
    const left = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM households WHERE org_id = $1", [ORG]);
    expect(Number(left.rows[0]!.n), "a renamed demonstration household must not survive the purge").toBe(0);
  });

  it("a store seeded BEFORE the origin column existed is still counted after the upgrade", async () => {
    // The upgrade path, which CI's fresh data directory never walks. A store
    // that already holds the world takes the column's default on every existing
    // row, so without a backfill the sweep reports a fully populated instance
    // clean - the guarantee failing open through the migration that enforces it,
    // and re-seeding cannot repair it (the ids conflict and nothing is written).
    await rewindPastRecordOrigin(db);
    await seedTheOldWay(db);

    await runMigrations(db);

    const sweep = await sweepFixtureRows(db);
    expect(sweep.problems).toEqual([]);
    const dirty = Object.fromEntries(sweep.tables.filter((entry) => entry.rows > 0).map((entry) => [entry.table, entry.rows]));
    expect(dirty, "every world row written before the column existed is still a demonstration record")
      .toEqual({ households: 2, contacts: 2, tasks: 1 });
    expect(cleanSlateViolations(sweep).length, "a populated instance must not report clean").toBeGreaterThan(0);
    // ...and the firm's OWN pre-existing row is not swept up by the backfill: a
    // migration that marked everything would pass the assertion above while
    // condemning real records to the purge.
    const firm = await db.query<{ record_origin: string }>("SELECT record_origin FROM households WHERE id = 'upgrade-firm-own'");
    expect(firm.rows[0]?.record_origin).toBe("firm-record");
  });

  it("a store that recorded version 9 BEFORE the backfill existed is repaired by the NEXT version", async () => {
    // The store the repair actually exists for: the column is there, every row
    // took its default, and `(9, record-origin)` is already in the ledger.
    // `runMigrations` matches on `(version, name)`, so a backfill appended to
    // version 9's own SQL would never run again on exactly these stores - the
    // `ALTER` is `IF NOT EXISTS` and the `UPDATE` would be dead code. Shipping it
    // as its own version is what makes it reachable (D-016/D-029).
    await rewindPastRecordOrigin(db);
    await seedTheOldWay(db);
    await runMigrations(db);
    for (const table of ["households", "contacts", "tasks"]) {
      await db.query(`UPDATE ${table} SET ${RECORD_ORIGIN_COLUMN} = $1`, ["firm-record"]);
    }
    await db.query("DELETE FROM schema_migrations WHERE version > $1", [ORIGIN_VERSION]);
    expect(
      Number((await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM schema_migrations WHERE version = $1", [ORIGIN_VERSION])).rows[0]!.n),
      "version 9 stays recorded: this is a store that already applied it",
    ).toBe(1);
    expect((await sweepFixtureRows(db)).totalRows, "and it reports clean while the world is present").toBe(0);

    await runMigrations(db);

    const dirty = Object.fromEntries((await sweepFixtureRows(db)).tables.filter((entry) => entry.rows > 0).map((entry) => [entry.table, entry.rows]));
    expect(dirty, "the backfill must reach a store that already ran version 9").toEqual({ households: 2, contacts: 2, tasks: 1 });
    const firm = await db.query<{ record_origin: string }>("SELECT record_origin FROM households WHERE id = 'upgrade-firm-own'");
    expect(firm.rows[0]?.record_origin, "and must not condemn the firm's own record to the purge").toBe("firm-record");
  });

  it("the demo FIRM and its two demo accounts, seeded before the insert named an origin, are repaired by version 11", async () => {
    // The other half of the same upgrade, and the half version 10 cannot reach:
    // the demonstration tenant and its two publicly-passworded accounts are
    // `prov_source = 'verin-crm'` rows like every record this firm's own flows
    // write, so the world's value-provenance marker names nothing here. Nor can
    // re-seeding repair them - the org insert is ON CONFLICT DO NOTHING and the
    // seed skips a user `findUserByEmail` already resolves - so without an
    // IDENTITY-keyed version they keep the `firm-record` version 9 handed them
    // forever, on exactly the stores the fix was written for.
    await rewindPastRecordOrigin(db);
    await seedTheDemoFirmTheOldWay(db);
    await runMigrations(db);

    // Rewound to the state a store sat in between version 10 and version 11:
    // the column is there, every row took its default, and the ledger's last
    // entry is the world backfill.
    for (const table of ["orgs", "users"]) {
      await db.query(`UPDATE ${table} SET ${RECORD_ORIGIN_COLUMN} = $1`, ["firm-record"]);
    }
    await db.query("DELETE FROM schema_migrations WHERE version > $1", [WORLD_BACKFILL_VERSION]);
    expect(
      (await sweepFixtureRows(db)).totalRows,
      "the false pass version 11 closes: the demo firm and its committed-password accounts read as this firm's own",
    ).toBe(0);

    await runMigrations(db);

    const dirty = Object.fromEntries((await sweepFixtureRows(db)).tables.filter((entry) => entry.rows > 0).map((entry) => [entry.table, entry.rows]));
    expect(dirty, "the demonstration tenant and both demonstration accounts are countable after the upgrade")
      .toEqual({ orgs: 1, users: DEMO_USERS.length });
    const own = await db.query<{ record_origin: string }>("SELECT record_origin FROM users WHERE id = $1", [DEMO_FIRM_OWN_USER]);
    expect(own.rows[0]?.record_origin, "a real account inside the demo org must not be condemned to the purge").toBe("firm-record");
    const other = await db.query<{ record_origin: string }>("SELECT record_origin FROM orgs WHERE id = $1", [ORG]);
    expect(other.rows[0]?.record_origin, "and neither must another firm's org row").toBe("firm-record");
  });

  it("detects (companion): the column's DEFAULT alone reports a populated store CLEAN", async () => {
    // What version 9 without its backfill did, proved rather than asserted: the
    // same store, the same rows, every origin taken from the DDL default.
    await rewindPastRecordOrigin(db);
    await seedTheOldWay(db);
    await runMigrations(db);
    for (const table of ["households", "contacts", "tasks"]) {
      await db.query(`UPDATE ${table} SET ${RECORD_ORIGIN_COLUMN} = $1`, ["firm-record"]);
    }
    const sweep = await sweepFixtureRows(db);
    expect(sweep.totalRows, "nothing is counted").toBe(0);
    expect(cleanSlateViolations(sweep), "this is the silent false pass the backfill exists to close").toEqual([]);
    const present = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM households WHERE prov_source = 'fixture'");
    expect(Number(present.rows[0]!.n), "while the demonstration world is fully present").toBe(2);
  });

  it("a provenance-bearing table the shipped DDL never declared is caught by the store's own catalog", async () => {
    // The reading that is not a reading of the DDL at all. A table created
    // outside `MIGRATION_SQL` - or declared in a shape the DDL parse does not
    // recognize - is invisible to both textual readings, so the sweep would
    // report clean for rows it never counted.
    await db.exec("CREATE TABLE rogue_evidence (id text PRIMARY KEY, prov_source text NOT NULL)");
    const sweep = await sweepFixtureRows(db);
    expect(sweep.problems.some((problem) => problem.startsWith("rogue_evidence:"))).toBe(true);
    expect(cleanSlateViolations(sweep).some((violation) => violation.startsWith("rogue_evidence:"))).toBe(true);
  });

  it("a swept table whose ORIGIN column is missing is refused rather than counted blind", async () => {
    // The pairing, against a real catalog. A table that can hold a demonstration
    // row and has no origin to count it by cannot be cleared, and saying so by
    // name beats the driver error the count would otherwise raise.
    await db.exec("ALTER TABLE tasks DROP COLUMN record_origin");
    const sweep = await sweepFixtureRows(db);
    expect(sweep.problems.some((problem) => problem.startsWith("tasks: carries prov_source but no record_origin"))).toBe(true);
    expect(cleanSlateViolations(sweep).length).toBeGreaterThan(0);
  });

  it("a VIEW over a provenance-bearing table is not mistaken for an unswept table", async () => {
    // The catalog reading must stay a reading of TABLES. A reporting view
    // exposing prov_source holds no rows of its own, and reporting it as a table
    // the derivation missed is a false alarm on the one check that has to be
    // unambiguous - as damaging as a false pass, because it teaches a reader to
    // discount the verdict.
    await db.exec("CREATE VIEW household_provenance AS SELECT id, prov_source FROM households");
    const sweep = await sweepFixtureRows(db);
    expect(sweep.problems).toEqual([]);
    expect(cleanSlateViolations(sweep)).toEqual([]);
  });

  it("another application's table in another schema is not this application's problem", async () => {
    // A shared managed-Postgres database is a supported deployment. A table this
    // app's unqualified DDL never created and its unqualified sweep can never
    // read is outside the guarantee, not a hole in it.
    await db.exec("CREATE SCHEMA other_app");
    await db.exec("CREATE TABLE other_app.their_rows (id text PRIMARY KEY, prov_source text NOT NULL)");
    const sweep = await sweepFixtureRows(db);
    expect(sweep.problems).toEqual([]);
  });

  it("a table the sweep's unqualified SELECT resolves through the search path is READ by the catalog too", async () => {
    // The fail-open direction. Unqualified DDL creates in the first creatable
    // schema, but an unqualified read resolves through the WHOLE search path -
    // so on a deployment running `search_path = app, public` a provenance-bearing
    // table in `public` is swept while a catalog reading pinned to
    // `current_schema()` cannot see it, and the sweep reports clean for a table
    // it never checked against the derivation.
    await db.exec("CREATE SCHEMA app");
    await db.exec("SET search_path TO app, public");
    await db.exec("CREATE TABLE public.late_evidence (id text PRIMARY KEY, prov_source text NOT NULL)");
    const sweep = await sweepFixtureRows(db);
    expect(sweep.problems.some((problem) => problem.startsWith("late_evidence:"))).toBe(true);
  });

  it("the sweep FAILS rather than reporting clean when it cannot read a table (charter #4)", async () => {
    const sweep = await sweepFixtureRows(db, ["households", "table_that_does_not_exist"]);
    expect(sweep.problems.length).toBe(1);
    expect(cleanSlateViolations(sweep)[0]).toContain("table_that_does_not_exist");
  });

  it("a second firm seeding the same world is REFUSED, by name, rather than handed an empty directory", async () => {
    // World ids are derived from the world seed, so they are identical in every
    // org: the second load conflicts on every key and writes nothing. Returning
    // `ok` there books an audit entry for a load that never happened and leaves
    // the second firm's household directory empty with no explanation - the
    // worst available outcome. The refusal names the collision instead.
    const other = "org-second-firm";
    await db.query(
      "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Second Firm',$2,'verin-crm',$2,'high')",
      [other, TS],
    );
    const first = await seedWorldIntoCrm(db, systemWriteActor("seed", ORG), HOUSEHOLDS, DIGEST);
    const second = await seedWorldIntoCrm(db, systemWriteActor("seed", other), HOUSEHOLDS, DIGEST);
    expect(first.ok && first.value.households).toBe(HOUSEHOLDS.length);
    expect(second.ok, "the second firm's load must not report success").toBe(false);
    const message = second.ok ? "" : second.error.message;
    expect(second.ok ? "" : second.error.code).toBe("CONFLICT");
    expect(message, "the refusal names the org it refused").toContain(other);
    expect(message, "the refusal names the ids that collided").toContain(HOUSEHOLDS[0]!.id);
    expect(message, "the refusal names how many collided").toContain(`${HOUSEHOLDS.length} of the ${HOUSEHOLDS.length} household id(s)`);
    expect(message, "the refusal names WHY the ids collide").toContain("derived from the world seed rather than scoped to an org");
    expect(message, "the refusal names the follow-up that makes a second firm work").toContain("fu-world-org-scoped-ids");
    expect(message, "the refusal names WHOSE collision it is").toContain(`held by an org other than ${other}`);
    // The refused load wrote nothing: the transaction rolled back whole.
    const rows = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM households WHERE org_id = $1", [other]);
    expect(Number(rows.rows[0]!.n)).toBe(0);
  });

  it("the SAME firm re-offered a REGENERATED world quietly writes what is new, and refuses nothing", async () => {
    // The condition the refusal exists for is a conflicting row owned by ANOTHER
    // org. Keying it on the symptom those two cases share - nothing written -
    // broke the ordinary development loop instead: ids are derived from the
    // world SEED and the digest from the world's bytes, so regenerating the
    // world keeps every id and changes the idempotency key, and this firm's own
    // re-seed conflicted away to nothing and threw.
    const actor = systemWriteActor("seed", ORG);
    const first = await seedWorldIntoCrm(db, actor, HOUSEHOLDS, DIGEST);
    expect(first.ok && first.value.households).toBe(HOUSEHOLDS.length);
    const again = await seedWorldIntoCrm(db, actor, HOUSEHOLDS, "a".repeat(64));
    expect(again.ok, again.ok ? "" : again.error.message).toBe(true);
    // Honest counts: nothing was written, and nothing claims otherwise.
    expect(again.ok ? again.value : null).toEqual({ households: 0, contacts: 0, tasks: 0 });
    const rows = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM households WHERE org_id = $1", [ORG]);
    expect(Number(rows.rows[0]!.n)).toBe(HOUSEHOLDS.length);
  });

  it("a re-offered world carrying a NEW person writes that person rather than refusing the load", async () => {
    // The documented property the symptom-keyed guard had quietly falsified: a
    // partially-applied load completes rather than duplicating. Adding a person
    // to a household is the commonest thing a world regeneration does.
    const actor = systemWriteActor("seed", ORG);
    await seedWorldIntoCrm(db, actor, HOUSEHOLDS, DIGEST);
    const grown = HOUSEHOLDS.map((household, index) => (index > 0 ? household : {
      ...household,
      members: [...household.members, {
        ...household.members[0]!,
        key: "newcomer",
        id: "11111111-2222-3333-4444-555555555555",
        displayName: "Newcomer Person",
      }],
    }));
    const again = await seedWorldIntoCrm(db, actor, grown, "b".repeat(64));
    expect(again.ok, again.ok ? "" : again.error.message).toBe(true);
    expect(again.ok ? again.value.contacts : -1, "the new person must actually land").toBe(1);
  });

  it("the world load is idempotent: a second run adds no rows", async () => {
    const actor = systemWriteActor("seed", ORG);
    await seedWorldIntoCrm(db, actor, HOUSEHOLDS, DIGEST);
    const first = await sweepFixtureRows(db);
    await seedWorldIntoCrm(db, actor, HOUSEHOLDS, DIGEST);
    const second = await sweepFixtureRows(db);
    expect(second.totalRows).toBe(first.totalRows);
  });
});
