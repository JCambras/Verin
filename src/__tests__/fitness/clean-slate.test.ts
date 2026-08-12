import { describe, expect, it } from "vitest";
import { MIGRATION_SQL } from "@infra/store/migrations";
import { SYNTHETIC_SOURCES } from "@contracts/provenance";
import {
  cleanSlateViolations, createTableBodies, expectedRowsViolations, provenanceBearingTables,
  provenanceDeclarationScan, provenanceDerivationProblems, type FixtureSweep,
} from "../../../scripts/fixture-purge";

/**
 * CLEAN-SLATE FENCE (ADR-0057; charter #3/#4/#7).
 *
 * The populated world exists so no product surface renders empty in
 * development. The other half of that promise is that a PRODUCTION instance
 * contains none of it - and a promise nobody counts is not a guarantee.
 *
 * The sweep's table list is DERIVED FROM THE SHIPPED DDL rather than hand-kept:
 * a new provenance-bearing table widens the sweep automatically instead of
 * silently escaping it. This fence proves the derivation is complete against
 * the real DDL, that the verdict is fail-closed on an empty sweep (charter #4:
 * a check that verifies nothing must never report clean), and - through its
 * companion - that a single planted fixture row is enough to fail it.
 *
 * The end-to-end proof against a real Postgres store lives beside it in
 * `src/__tests__/integration/fixture-purge.test.ts`.
 */

const REQUIRED = ["orgs", "users", "households", "contacts", "financial_accounts", "tasks"];

const sweep = (tables: { table: string; rows: number }[], problems: string[] = []): FixtureSweep => ({
  tables,
  totalRows: tables.reduce((sum, entry) => sum + entry.rows, 0),
  problems,
});

describe("clean-slate fence", () => {
  it("enforces: the swept table list is derived from the shipped DDL, not hand-kept", () => {
    const tables = provenanceBearingTables();
    expect(tables.length, "no provenance-bearing table derived - the derivation went stale").toBeGreaterThan(5);
    for (const table of REQUIRED) {
      expect(tables, `${table} carries prov_source in the DDL but is not swept`).toContain(table);
    }
    // Both directions: every derived table really does carry the column - read
    // back through the SHIPPED paren-balanced parse, never the line-anchored
    // pattern that parse exists to replace (a table whose closing paren is
    // indented would otherwise fail here naming a derivation bug that is not
    // there; the case three below proves the derivation handles it).
    const bodies = new Map(createTableBodies(MIGRATION_SQL).map((entry) => [entry.name, entry.body]));
    for (const table of tables) {
      const body = bodies.get(table);
      expect(body, `${table} was derived but its DDL body could not be found`).toBeDefined();
      expect(body!).toContain("prov_source");
    }
  });

  it("enforces: the shipped DDL's own prov_source declarations all land inside a swept table", () => {
    expect(provenanceDerivationProblems()).toEqual([]);
  });

  it("enforces: a table whose closing paren is INDENTED is still swept", () => {
    // The shape that used to escape entirely: the derivation is paren-balanced,
    // not anchored on a `);` in column 0.
    const ddl = [
      "CREATE TABLE IF NOT EXISTS indented (",
      "  id text PRIMARY KEY,",
      "  prov_source text NOT NULL",
      "  );",
      "CREATE TABLE IF NOT EXISTS after_it (",
      "  id text PRIMARY KEY,",
      "  prov_source text NOT NULL",
      ");",
    ].join("\n");
    expect(provenanceBearingTables(ddl)).toEqual(["after_it", "indented"]);
    expect(provenanceDerivationProblems(ddl)).toEqual([]);
  });

  it("enforces: an INLINE and a QUOTED prov_source declaration are both swept", () => {
    // Neither is line-oriented, and a reader that only recognizes "the column
    // starting a line" reports both tables clean without ever opening them.
    const ddl = [
      "CREATE TABLE IF NOT EXISTS inline (id text PRIMARY KEY, prov_source text NOT NULL);",
      'CREATE TABLE IF NOT EXISTS quoted (',
      '  id text PRIMARY KEY,',
      '  "prov_source" text NOT NULL',
      ");",
    ].join("\n");
    expect(provenanceBearingTables(ddl)).toEqual(["inline", "quoted"]);
    expect(provenanceDerivationProblems(ddl)).toEqual([]);
  });

  it("enforces: a nested paren inside a column list does not end the table early", () => {
    const ddl = [
      "CREATE TABLE IF NOT EXISTS checked (",
      "  status text NOT NULL CHECK (",
      "    status IN ('a', 'b')",
      "  ),",
      "  prov_source text NOT NULL",
      ");",
    ].join("\n");
    expect(provenanceBearingTables(ddl)).toEqual(["checked"]);
  });

  it("enforces: a CHECK, an INDEX and an ALTER over prov_source are USES, not declarations", () => {
    // The cross-check counts DECLARATIONS. Counting mentions instead fails the
    // whole check on ordinary schema work - a column constraint names the column
    // twice for one declaration, and an index over it is the index this
    // cross-tenant sweep would itself want - and each failure names an unswept
    // table that does not exist. A false alarm here is as corrosive as a false
    // pass: it teaches a reader to discount the one unambiguous verdict.
    const ddl = [
      "CREATE TABLE IF NOT EXISTS constrained (",
      "  id text PRIMARY KEY,",
      "  prov_source text NOT NULL CHECK (prov_source IN ('verin-crm', 'fixture'))",
      ");",
      "CREATE INDEX constrained_prov ON constrained (prov_source);",
      "CREATE INDEX constrained_prov_id ON constrained (prov_source, id);",
      "CREATE INDEX constrained_fixture ON constrained (id) WHERE prov_source = 'fixture';",
      "ALTER TABLE constrained ALTER COLUMN prov_source SET NOT NULL;",
    ].join("\n");
    expect(provenanceBearingTables(ddl)).toEqual(["constrained"]);
    expect(provenanceDeclarationScan(ddl), "six mentions, one declaration").toBe(1);
    expect(provenanceDerivationProblems(ddl)).toEqual([]);
  });

  it("enforces: a reference the DDL happens to write next to an unlisted keyword is still a reference", () => {
    // A declaration is recognized by the TYPE it names, never by listing what may
    // follow a reference: that list is OPEN and every keyword nobody thought of
    // would be counted as a declaration and fail the whole check while naming an
    // unswept table that does not exist. Each line here is ordinary schema work.
    const ddl = [
      "CREATE TABLE IF NOT EXISTS swept (",
      "  id text PRIMARY KEY,",
      "  prov_source text NOT NULL",
      ");",
      "CREATE INDEX swept_prov ON swept (prov_source NULLS LAST);",
      "CREATE INDEX swept_prov_ops ON swept (prov_source text_pattern_ops);",
      "CREATE VIEW swept_by_source AS",
      "  SELECT prov_source, count(*) FROM swept GROUP BY prov_source ORDER BY prov_source;",
      "ALTER TABLE swept DROP COLUMN prov_source CASCADE;",
    ].join("\n");
    expect(provenanceBearingTables(ddl)).toEqual(["swept"]);
    expect(provenanceDeclarationScan(ddl), "seven mentions of the column, exactly one declaration").toBe(1);
    expect(provenanceDerivationProblems(ddl)).toEqual([]);
  });

  it("enforces: a QUOTED column with a parameterized type is a declaration", () => {
    const ddl = 'CREATE TABLE IF NOT EXISTS widened (\n  "prov_source" varchar(32) NOT NULL\n);';
    expect(provenanceBearingTables(ddl)).toEqual(["widened"]);
    expect(provenanceDeclarationScan(ddl)).toBe(1);
    expect(provenanceDerivationProblems(ddl)).toEqual([]);
  });

  it("enforces: every table the world's seed writes is inside the sweep", () => {
    const tables = provenanceBearingTables();
    for (const table of ["households", "contacts", "tasks"]) {
      expect(tables, `the world seed writes ${table}; a sweep that skips it proves nothing`).toContain(table);
    }
  });

  it("enforces: a clean instance passes", () => {
    expect(cleanSlateViolations(sweep(provenanceBearingTables().map((table) => ({ table, rows: 0 }))))).toEqual([]);
  });

  it("enforces: the synthetic source list the sweep counts is the contract's, not a copy", () => {
    expect([...SYNTHETIC_SOURCES].sort()).toEqual(["default", "estimate", "fixture"]);
  });

  describe("detects (companion): an unclean instance CANNOT pass", () => {
    it("one fixture-marked row in one table fails the verdict", () => {
      const violations = cleanSlateViolations(sweep([
        { table: "households", rows: 1 },
        { table: "contacts", rows: 0 },
      ]));
      expect(violations).toEqual(["households: 1 fixture-marked row(s) - a production instance must contain none"]);
    });

    it("a sweep that could not read a table fails rather than reporting clean", () => {
      const violations = cleanSlateViolations(sweep([{ table: "contacts", rows: 0 }], ["households: could not be swept (no such table)"]));
      expect(violations).toEqual(["households: could not be swept (no such table)"]);
    });

    it("a sweep over ZERO tables is a problem, never a pass (charter #4)", () => {
      const empty: FixtureSweep = {
        tables: [],
        totalRows: 0,
        problems: ["no provenance-bearing table found in the shipped DDL - the sweep would pass vacuously (charter #4)"],
      };
      expect(cleanSlateViolations(empty).length).toBe(1);
    });

    it("a DDL with no provenance-bearing table derives nothing, so the runner reports a problem", () => {
      expect(provenanceBearingTables("CREATE TABLE IF NOT EXISTS widgets (\n  id text PRIMARY KEY\n);")).toEqual([]);
    });

    it("a prov_source column the table walk never reached is a PROBLEM, not a silent miss", () => {
      // An ALTER that adds the column stands in for any declaration outside a
      // parsed CREATE TABLE: the two readings disagree, so the sweep fails
      // rather than reporting a table it never read as clean.
      const ddl = [
        "CREATE TABLE IF NOT EXISTS swept (",
        "  id text PRIMARY KEY,",
        "  prov_source text NOT NULL",
        ");",
        "ALTER TABLE unswept ADD COLUMN",
        "  prov_source text NOT NULL;",
      ].join("\n");
      expect(provenanceBearingTables(ddl)).toEqual(["swept"]);
      const problems = provenanceDerivationProblems(ddl);
      expect(problems.length).toBe(1);
      expect(problems[0]).toContain("declares prov_source 2 time(s)");
      expect(problems[0]).toContain("recognized 1 declaration(s)");
      expect(cleanSlateViolations(sweep([{ table: "swept", rows: 0 }], problems))).toEqual(problems);
    });

    it("a declaration naming a type the text scan does not know fails, rather than going quietly blind", () => {
      // The closed type list is what keeps a reference from being miscounted as a
      // declaration, so a type outside it is a real risk: the second reading
      // stops being able to see the hole it exists to see. It fails in the OTHER
      // direction and says so, instead of agreeing with the parse by accident.
      const ddl = "CREATE TABLE IF NOT EXISTS typed (\n  prov_source provenance_source NOT NULL\n);";
      expect(provenanceBearingTables(ddl)).toEqual(["typed"]);
      expect(provenanceDeclarationScan(ddl)).toBe(0);
      const problems = provenanceDerivationProblems(ddl);
      expect(problems.length).toBe(1);
      expect(problems[0]).toContain("the text scan recognized only 0");
      expect(problems[0]).toContain("PROVENANCE_COLUMN_TYPES");
    });

    it("the cross-check does not share the derivation's reading, so it can actually disagree", () => {
      // The failure the previous cross-check could not see: a declaration shape
      // the structural parse does not recognize. Both readings agreeing by
      // construction is not a cross-check, so the shape is counted by the second
      // reading and the table is refused rather than reported clean.
      const ddl = [
        "CREATE TABLE IF NOT EXISTS parsed (",
        "  prov_source text NOT NULL",
        ");",
        "CREATE UNLOGGED TABLE unparsed (",
        "  prov_source text NOT NULL",
        ");",
      ].join("\n");
      expect(provenanceBearingTables(ddl)).toEqual(["parsed"]);
      expect(provenanceDerivationProblems(ddl).length).toBe(1);
    });
  });

  describe("detects (companion): the --report path CAN fail", () => {
    it("a seeded store that reports fewer rows than expected fails", () => {
      const violations = expectedRowsViolations(sweep([{ table: "households", rows: 0 }]), 100);
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("found 0");
    });

    it("a seeded store that meets the floor passes, and still surfaces sweep problems", () => {
      expect(expectedRowsViolations(sweep([{ table: "households", rows: 100 }]), 100)).toEqual([]);
      expect(expectedRowsViolations(sweep([{ table: "households", rows: 100 }], ["contacts: could not be swept"]), 100))
        .toEqual(["contacts: could not be swept"]);
    });

    it("a floor that is not a positive whole number fails rather than waving the report through", () => {
      for (const bad of [Number.NaN, 0, -1, 1.5]) {
        expect(expectedRowsViolations(sweep([{ table: "households", rows: 999 }]), bad).length, `${bad} must be refused`).toBe(1);
      }
    });
  });
});
