/**
 * CLEAN-SLATE DETECTOR (ADR-0057, charter #3/#7) - the shared core of
 * `pnpm fixture:check`, its adversarial companion, and the readiness path.
 *
 * The populated world exists so no product surface renders empty in
 * development. The other half of that promise is that a PRODUCTION instance
 * contains none of it: every world row is written with a synthetic
 * `prov_source` (`fixture`), so "is this instance clean?" is a countable
 * question rather than an assurance.
 *
 * The sweep is deliberately CROSS-TENANT and derives its table list from the
 * shipped DDL rather than a hand-kept list: a new provenance-bearing table that
 * nobody remembered to add here would otherwise be a hole in the guarantee, so
 * an unswept provenance-bearing table is reported as a PROBLEM, never skipped.
 */
import type { SqlDb } from "../src/infrastructure/store/db";
import { MIGRATION_SQL } from "../src/infrastructure/store/migrations";
import { SYNTHETIC_SOURCES } from "../src/contracts/provenance";

export interface FixtureTableCount {
  readonly table: string;
  readonly rows: number;
}

export interface FixtureSweep {
  readonly tables: readonly FixtureTableCount[];
  readonly totalRows: number;
  readonly problems: readonly string[];
}

/**
 * Every table whose DDL carries a `prov_source` column. Derived from the
 * migration SQL, so adding a provenance-bearing table automatically widens the
 * sweep instead of silently escaping it.
 */
export function provenanceBearingTables(ddl: string = MIGRATION_SQL): string[] {
  const tables: string[] = [];
  for (const match of ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    if (/\bprov_source\b/.test(match[2]!)) tables.push(match[1]!);
  }
  return [...new Set(tables)].sort();
}

/**
 * Count rows carrying a synthetic provenance source in every provenance-bearing
 * table. A missing table is reported rather than swallowed: a sweep that
 * silently skips the table holding the fixture rows is worse than no sweep.
 */
export async function sweepFixtureRows(
  db: SqlDb,
  tables: readonly string[] = provenanceBearingTables(),
): Promise<FixtureSweep> {
  const problems: string[] = [];
  const counts: FixtureTableCount[] = [];
  if (tables.length === 0) {
    return { tables: [], totalRows: 0, problems: ["no provenance-bearing table found in the shipped DDL - the sweep would pass vacuously (charter #4)"] };
  }
  for (const table of tables) {
    // The table name comes from the shipped DDL, never from input; the SOURCE
    // list is still bound, so the predicate itself is parameterized.
    const placeholders = SYNTHETIC_SOURCES.map((_, index) => `$${index + 1}`).join(",");
    try {
      const result = await db.query<{ n: string | number }>(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE prov_source IN (${placeholders})`,
        [...SYNTHETIC_SOURCES],
      );
      counts.push({ table, rows: Number(result.rows[0]?.n ?? 0) });
    } catch (e) {
      problems.push(`${table}: could not be swept (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  const totalRows = counts.reduce((sum, count) => sum + count.rows, 0);
  return { tables: counts, totalRows, problems };
}

/** The clean-slate verdict a production instance must satisfy. */
export function cleanSlateViolations(sweep: FixtureSweep): string[] {
  return [
    ...sweep.problems,
    ...sweep.tables
      .filter((count) => count.rows > 0)
      .map((count) => `${count.table}: ${count.rows} fixture-marked row(s) - a production instance must contain none`),
  ];
}
