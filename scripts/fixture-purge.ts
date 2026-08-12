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
/** `prov_source` in the position a database reads a column name from: the first
 * identifier of a top-level item in a table's column list, quoted or not. */
const PROV_SOURCE_DECLARATION_RE = /^"?prov_source"?[\s(]/i;
/** The SECOND reading, and deliberately a DIFFERENT KIND of one: the column name
 * wherever the DDL DECLARES it - `prov_source <type>` - anywhere in the text,
 * inside a parsed `CREATE TABLE` or not, sharing no code with the structural
 * parse above. Two readings that resolve a declaration the same way agree by
 * construction and cannot cross-check anything; a shape the structural parse
 * fails to recognize still lands in this count, and the disagreement is what
 * makes the miss visible.
 *
 * It counts DECLARATIONS, not mentions. A count of mentions is defeated by
 * ordinary schema work - a column-level `CHECK (prov_source IN (...))` names the
 * column twice for one declaration, and `CREATE INDEX ... ON t (prov_source)` is
 * the index this very sweep would want - and every one of those would fail the
 * check while naming an unswept table that does not exist. A false alarm on the
 * one check that has to be unambiguous is as corrosive as a false pass. */
const PROV_SOURCE_DECLARED_RE = /(?<![.\w])"?prov_source"?\s+([a-z][a-z0-9_]*)/gi;
/** What can follow a REFERENCE to the column but never its type, so a use is not
 * miscounted as a declaration: `CHECK (prov_source IS NOT NULL)`,
 * `ALTER COLUMN prov_source SET NOT NULL`, `ORDER BY prov_source DESC`. An
 * operator (`prov_source = 'fixture'`) or a delimiter (`(prov_source)`,
 * `prov_source,`) is not an identifier at all, so it never reaches this list. */
const REFERENCE_FOLLOWERS = new Set([
  "and", "as", "asc", "between", "collate", "desc", "drop", "from", "ilike", "in",
  "is", "like", "not", "on", "or", "set", "similar", "then", "to", "type", "using", "when", "where",
]);

/** Both readings run on comment-free SQL, so a comment naming the column is
 * neither a declaration nor a disagreement. */
const withoutComments = (sql: string): string => sql.replace(/--[^\n]*/g, "");

/**
 * The body of every `CREATE TABLE` in the DDL, delimited by BALANCED parentheses
 * rather than by a closing paren in column 0. A regex anchored on `\n);` reads a
 * table whose closing paren is indented as running on into the next table, which
 * both loses that table and attributes its columns to its neighbour - a silent
 * hole in a sweep whose whole purpose is that it cannot fail open.
 *
 * Exported so the fence checks the derivation against THIS parse rather than
 * re-matching the DDL with the line-anchored pattern it exists to replace.
 */
export function createTableBodies(ddl: string): { name: string; body: string }[] {
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
 * The items of a table's column list, split on TOP-LEVEL commas: a nested
 * `CHECK (a IN ('x','y'))` or a compound key does not end an item, and a
 * declaration written inline after another one is its own item rather than a
 * line the reader never looks at.
 */
function columnItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char === "'") {
      const close = body.indexOf(char, index + 1);
      index = close === -1 ? body.length : close;
    } else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      items.push(body.slice(start, index));
      start = index + 1;
    }
  }
  items.push(body.slice(start));
  return items;
}

/** Every `prov_source` column declaration in the DDL, as `table` names (one per
 * declaration). Parsed STRUCTURALLY - balanced table bodies, top-level column
 * items, the item's leading identifier - so an indented closing paren, an inline
 * column list and a quoted identifier all read the way a database reads them. */
function provenanceColumnDeclarations(ddl: string): string[] {
  return createTableBodies(withoutComments(ddl)).flatMap((table) =>
    columnItems(table.body)
      .filter((item) => PROV_SOURCE_DECLARATION_RE.test(item.trim()))
      .map(() => table.name),
  );
}

/**
 * Every table whose DDL declares a `prov_source` column. Derived from the
 * migration SQL, so adding a provenance-bearing table automatically widens the
 * sweep instead of silently escaping it.
 */
export function provenanceBearingTables(ddl: string = MIGRATION_SQL): string[] {
  return [...new Set(provenanceColumnDeclarations(ddl))].sort();
}

/** Every place the DDL DECLARES a `prov_source` column, counted by reading the
 * text rather than the table structure: the column name followed by what only a
 * type can be. A mention used as an expression or an index key is a reference,
 * not a declaration, and is not counted. */
export function provenanceDeclarationScan(ddl: string): number {
  PROV_SOURCE_DECLARED_RE.lastIndex = 0;
  return [...withoutComments(ddl).matchAll(PROV_SOURCE_DECLARED_RE)]
    .filter((match) => !REFERENCE_FOLLOWERS.has(match[1]!.toLowerCase()))
    .length;
}

/**
 * The structural parse checked against a reading that shares nothing with it:
 * how many `prov_source` DECLARATIONS the DDL text carries at all. A declaration
 * the parse never recognized - one written in a `CREATE TABLE` shape this does
 * not read, an `ALTER TABLE ... ADD COLUMN prov_source`, a form nobody has
 * written yet - is still counted there, so the two disagree. That disagreement
 * is reported as a PROBLEM, which fails the check: a table the derivation misses
 * must never be a table the sweep silently reports clean (charter #4).
 */
export function provenanceDerivationProblems(ddl: string = MIGRATION_SQL): string[] {
  const declared = provenanceDeclarationScan(ddl);
  const parsed = provenanceColumnDeclarations(ddl).length;
  if (declared === parsed) return [];
  return [
    `the shipped DDL declares prov_source ${declared} time(s) but the column parse recognized ${parsed} declaration(s) - a provenance-bearing column outside the sweep would report its table clean without ever being read (charter #4)`,
  ];
}

/**
 * BASE TABLES IN THIS APPLICATION'S OWN SCHEMA, and nothing else.
 * `information_schema.columns` also lists views and every schema the connection
 * can see, and neither is a table this sweep could count rows in: a reporting
 * view over a provenance-bearing table, or another application's table in a
 * shared managed database, would be reported as a table the derivation missed.
 * A false alarm on the clean-slate check is as corrosive as a false pass - it is
 * the one check that has to be unambiguous - so the reading is pinned to
 * `current_schemas(false)`: the search path the sweep's own unqualified
 * `SELECT` resolves through. `current_schema()` alone would be NARROWER than the
 * sweep, because unqualified DDL creates in the first creatable schema while an
 * unqualified read resolves through the whole path - so on a deployment running
 * `search_path = app, public` a provenance-bearing table the sweep really does
 * read would be invisible here, which is the fail-open direction this module
 * exists to refuse.
 */
const CATALOG_SQL =
  "SELECT DISTINCT c.table_name FROM information_schema.columns c "
  + "JOIN information_schema.tables t "
  + "ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
  + "WHERE c.column_name = 'prov_source' AND t.table_type = 'BASE TABLE' "
  + "AND c.table_schema = ANY(current_schemas(false))";

/**
 * The THIRD reading, and the only one that is not a reading of the DDL: the
 * store's OWN column catalog. It sees a provenance-bearing table however it was
 * declared - including one created outside `MIGRATION_SQL` entirely - so a table
 * both textual readings missed fails here rather than passing unread. A catalog
 * that cannot be read is itself a problem: an unchecked derivation is exactly
 * the state this module exists to refuse.
 */
async function catalogDisagreements(db: SqlDb, derived: readonly string[]): Promise<string[]> {
  const known = new Set(derived);
  try {
    const result = await db.query<{ table_name: string }>(CATALOG_SQL);
    return [...new Set(result.rows.map((row) => row.table_name))]
      .filter((table) => !known.has(table))
      .sort()
      .map((table) => `${table}: the store declares a prov_source column the DDL derivation never reached - it would report clean without being read (charter #4)`);
  } catch (e) {
    return [`the store's column catalog could not be read, so the derived table list is unchecked (${e instanceof Error ? e.message : String(e)})`];
  }
}

/**
 * Count rows carrying a synthetic provenance source in every provenance-bearing
 * table. A missing table is reported rather than swallowed: a sweep that
 * silently skips the table holding the fixture rows is worse than no sweep.
 */
export async function sweepFixtureRows(
  db: SqlDb,
  swept?: readonly string[],
): Promise<FixtureSweep> {
  const derived = provenanceBearingTables();
  const tables = swept ?? derived;
  const problems: string[] = [
    ...provenanceDerivationProblems(),
    ...(await catalogDisagreements(db, derived)),
  ];
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
