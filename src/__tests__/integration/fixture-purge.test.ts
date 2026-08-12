import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { runMigrations } from "@infra/store/migrations";
import { seedWorldIntoCrm } from "@infra/crm/world-seed";
import { systemWriteActor } from "@contracts/principal";
import { cleanSlateViolations, sweepFixtureRows } from "../../../scripts/fixture-purge";
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
 *   - purging the fixture-marked rows returns it to clean, while the firm's own
 *     `verin-crm` rows survive - the marker is what is purged, not the table.
 */

const ORG = "org-clean-slate";
const TS = "2026-01-01T00:00:00.000Z";
const world = generateWorld(loadWorldSpec(), WORLD_SEED);
const DIGEST = String((world.manifest.value as Record<string, unknown>).worldDigest);
// A slice keeps the store small; the sweep counts rows, so five households
// prove the same property a hundred do.
const HOUSEHOLDS = world.households.slice(0, 5);

let db: SqlDb;

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

  it("purging the fixture-marked rows restores clean and leaves the firm's own records alone", async () => {
    await seedWorldIntoCrm(db, systemWriteActor("seed", ORG), HOUSEHOLDS, DIGEST);
    await db.query(
      "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ('real-hh',$1,'A Real Household',NULL,NULL,'active',$2,'verin-crm',$2,'high')",
      [ORG, TS],
    );
    // Child rows first: the household foreign keys are real, which is exactly
    // why a purge is an ordered operation rather than a truncate.
    await db.query("DELETE FROM tasks WHERE prov_source = 'fixture'");
    await db.query("DELETE FROM contacts WHERE prov_source = 'fixture'");
    await db.query("DELETE FROM households WHERE prov_source = 'fixture'");
    const sweep = await sweepFixtureRows(db);
    expect(cleanSlateViolations(sweep)).toEqual([]);
    const survivors = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM households WHERE org_id = $1", [ORG]);
    expect(Number(survivors.rows[0]!.n), "purging fixtures must not touch the firm's own records").toBe(1);
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
    expect(message, "the refusal names how many collided").toContain(`all ${HOUSEHOLDS.length} household id(s)`);
    expect(message, "the refusal names WHY the ids collide").toContain("derived from the world seed rather than scoped to an org");
    expect(message, "the refusal names the follow-up that makes a second firm work").toContain("fu-world-org-scoped-ids");
    expect(message, "a collision from another firm is not the same as this firm's own earlier load")
      .toContain(`held by an org other than ${other}`);
    // The refused load wrote nothing: the transaction rolled back whole.
    const rows = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM households WHERE org_id = $1", [other]);
    expect(Number(rows.rows[0]!.n)).toBe(0);
  });

  it("the SAME firm re-offered a changed world is told so, rather than told it loaded one", async () => {
    // Ids are derived from the world SEED and the digest from the world's bytes,
    // so regenerating the world keeps every id and changes the idempotency key:
    // the load runs again, conflicts away to nothing, and used to report a
    // hundred households written. It now says which store it is looking at.
    const actor = systemWriteActor("seed", ORG);
    await seedWorldIntoCrm(db, actor, HOUSEHOLDS, DIGEST);
    const again = await seedWorldIntoCrm(db, actor, HOUSEHOLDS, "a".repeat(64));
    expect(again.ok).toBe(false);
    expect(again.ok ? "" : again.error.message).toContain(`org ${ORG} already holds them from an earlier load`);
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
