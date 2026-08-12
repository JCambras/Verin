import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { MIGRATIONS, runMigrations } from "@infra/store/migrations";
import { RECORD_ORIGIN_COLUMN } from "@infra/store/record-origin";
import { seedWorldIntoCrm } from "@infra/crm/world-seed";
import { updateHouseholdName } from "@infra/crm/house-crm";
import { systemWriteActor } from "@contracts/principal";
import { parseMachineRecordId } from "@contracts/record-id";
import { canFeedComplianceDecision, provenanceLabel, syntheticBadgeLabel } from "@contracts/provenance";
import { cleanSlateViolations, originBearingTables, sweepFixtureRows } from "../../../scripts/fixture-purge";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * THE CLEAN-SLATE GUARANTEE, END TO END (ADR-0057; charter #3/#4/#7).
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

/** Child rows first: the household foreign keys are real, which is exactly why a
 * purge is an ordered operation rather than a truncate. Keyed on the ROW's
 * origin, never on the provenance of the values in it. */
async function purgeDemonstrationRecords(store: SqlDb): Promise<void> {
  await store.query("DELETE FROM tasks WHERE record_origin = 'world-fixture'");
  await store.query("DELETE FROM contacts WHERE record_origin = 'world-fixture'");
  await store.query("DELETE FROM households WHERE record_origin = 'world-fixture'");
}

/** The version that introduced `record_origin`, read from the shipped plan
 * rather than typed, so appending a migration cannot silently point the upgrade
 * test at the wrong one. */
const ORIGIN_VERSION = MIGRATIONS.find((migration) => migration.name === "record-origin")!.version;

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

beforeEach(async () => {
  db = await createMemoryDb();
  await runMigrations(db);
  await db.query(
    "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Clean Slate Firm',$2,'verin-crm',$2,'high')",
    [ORG, TS],
  );
});

describe("clean-slate guarantee", () => {
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
