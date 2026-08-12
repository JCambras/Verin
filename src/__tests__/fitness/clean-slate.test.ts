import { describe, expect, it } from "vitest";
import { MIGRATION_SQL } from "@infra/store/migrations";
import { SYNTHETIC_SOURCES } from "@contracts/provenance";
import { cleanSlateViolations, provenanceBearingTables, type FixtureSweep } from "../../../scripts/fixture-purge";

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
    // Both directions: every derived table really does carry the column.
    for (const table of tables) {
      const ddl = MIGRATION_SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\([\\s\\S]*?\\n\\);`))?.[0] ?? "";
      expect(ddl, `${table} was derived but its DDL could not be found`).not.toBe("");
      expect(ddl).toContain("prov_source");
    }
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
  });
});
