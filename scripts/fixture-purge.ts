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

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
/** A column declaration, which is what widens the sweep - not a mention of the
 * column in an index, a constraint, or a comment. Line-oriented on purpose: it
 * is a SECOND reading of the DDL, independent of the paren scan below, and two
 * independent readings that disagree are what makes a miss detectable. */
const PROV_SOURCE_COLUMN_RE = /^[ \t]*prov_source[ \t]+[a-z]/gim;

const matchCount = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length;

/**
 * The body of every `CREATE TABLE` in the DDL, delimited by BALANCED parentheses
 * rather than by a closing paren in column 0. A regex anchored on `\n);` reads a
 * table whose closing paren is indented as running on into the next table, which
 * both loses that table and attributes its columns to its neighbour - a silent
 * hole in a sweep whose whole purpose is that it cannot fail open.
 */
function createTableBodies(ddl: string): { name: string; body: string }[] {
  const bodies: { name: string; body: string }[] = [];
  CREATE_TABLE_RE.lastIndex = 0;
  for (let match = CREATE_TABLE_RE.exec(ddl); match !== null; match = CREATE_TABLE_RE.exec(ddl)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    for (; index < ddl.length && depth > 0; index += 1) {
      const char = ddl[index]!;
      if (char === "'" || char === '"') {
        const close = ddl.indexOf(char, index + 1);
        index = close === -1 ? ddl.length : close;
      } else if (char === "-" && ddl[index + 1] === "-") {
        const eol = ddl.indexOf("\n", index);
        index = eol === -1 ? ddl.length : eol;
      } else if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
    }
    if (depth !== 0) continue;
    bodies.push({ name: match[1]!, body: ddl.slice(start, index - 1) });
    CREATE_TABLE_RE.lastIndex = index;
  }
  return bodies;
}

/**
 * Every table whose DDL declares a `prov_source` column. Derived from the
 * migration SQL, so adding a provenance-bearing table automatically widens the
 * sweep instead of silently escaping it.
 */
export function provenanceBearingTables(ddl: string = MIGRATION_SQL): string[] {
  const tables = createTableBodies(ddl)
    .filter((table) => matchCount(table.body, PROV_SOURCE_COLUMN_RE) > 0)
    .map((table) => table.name);
  return [...new Set(tables)].sort();
}

/**
 * The derivation checked against itself. Counting `prov_source` column
 * declarations across the whole DDL is independent of walking each table's
 * body, so a declaration the table walk never reached - an indented closing
 * paren, a `CREATE TABLE` shape this does not parse, an `ALTER TABLE ... ADD
 * COLUMN prov_source` - shows up here as a disagreement. That disagreement is
 * reported as a PROBLEM, which fails the check: a table the derivation misses
 * must never be a table the sweep silently reports clean (charter #4).
 */
export function provenanceDerivationProblems(ddl: string = MIGRATION_SQL): string[] {
  const declared = matchCount(ddl, PROV_SOURCE_COLUMN_RE);
  const derived = provenanceBearingTables(ddl).length;
  if (declared === derived) return [];
  return [
    `the shipped DDL declares ${declared} prov_source column(s) but the sweep derived ${derived} provenance-bearing table(s) - a provenance-bearing table is outside the sweep and would report clean without ever being read (charter #4)`,
  ];
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
  const problems: string[] = [...provenanceDerivationProblems()];
  const counts: FixtureTableCount[] = [];
  if (tables.length === 0) {
    return { tables: [], totalRows: 0, problems: [...problems, "no provenance-bearing table found in the shipped DDL - the sweep would pass vacuously (charter #4)"] };
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

/**
 * The report path's floor. `--report` exists for a SEEDED store, where the world
 * is supposed to be there and the interesting number is how much of it - but a
 * report that exits 0 whatever it finds cannot tell a loaded world from a seed
 * that quietly wrote nothing. Given an expected minimum, the same sweep becomes
 * an assertion: too few rows, or a sweep that could not read the tables, fails.
 */
export function expectedRowsViolations(sweep: FixtureSweep, expectedRows: number): string[] {
  if (!Number.isInteger(expectedRows) || expectedRows < 1) {
    return [`--expect-rows needs a positive whole number of rows; got ${JSON.stringify(String(expectedRows))}`];
  }
  if (sweep.totalRows >= expectedRows) return [...sweep.problems];
  return [
    ...sweep.problems,
    `expected at least ${expectedRows} fixture-marked row(s) across ${sweep.tables.length} swept table(s), found ${sweep.totalRows} - a report that finds nothing proves nothing (charter #4)`,
  ];
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
