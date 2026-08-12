/**
 * CLEAN-SLATE DETECTOR (ADR-0057, charter #3/#7) - the shared core of
 * `pnpm fixture:check`, its adversarial companion, and the readiness path.
 *
 * The populated world exists so no product surface renders empty in
 * development. The other half of that promise is that a PRODUCTION instance
 * contains none of it, so "is this instance clean?" has to be a countable
 * question rather than an assurance.
 *
 * WHAT IS COUNTED IS THE ROW'S ORIGIN (`record_origin`), NEVER ITS VALUE
 * PROVENANCE. `prov_source` says where a VALUE came from and moves the moment a
 * human edits it - an advisor renaming a seeded household has genuinely entered
 * that name - so a sweep keyed on it would let a demonstration household survive
 * into production simply because somebody typed over it. The origin of the
 * record does not move, and it is the whole guarantee.
 *
 * The sweep is deliberately CROSS-TENANT and derives its table list from the
 * shipped DDL rather than a hand-kept list: a new provenance-bearing table that
 * nobody remembered to add here would otherwise be a hole in the guarantee, so
 * an unswept provenance-bearing table is reported as a PROBLEM, never skipped -
 * and so is one that carries a `prov_source` without the `record_origin` this
 * counts, because a table the sweep cannot key on is a table it cannot clear.
 */
import type { SqlDb } from "../src/infrastructure/store/db";
import { MIGRATION_SQL } from "../src/infrastructure/store/migrations";
import { DEMONSTRATION_ORIGINS, RECORD_ORIGIN_COLUMN } from "../src/infrastructure/store/record-origin";

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
const PROV_SOURCE_DECLARED_RE = /(?<![.\w])"?prov_source"?\s+"?([a-z][a-z0-9_]*)"?/gi;
/**
 * The TYPE a `prov_source` declaration names. Declaration-versus-reference is
 * decided by what a DECLARATION looks like, never by listing what may follow a
 * REFERENCE: the set of SQL keywords that can follow a column reference is OPEN
 * and grows with ordinary schema work - `DROP COLUMN prov_source CASCADE`,
 * `ON t (prov_source NULLS LAST)`, a reporting view's `GROUP BY prov_source
 * ORDER BY ...` - and every keyword nobody thought to list would be counted as a
 * declaration and fail this check while naming an unswept table that does not
 * exist. The set of types a text-valued provenance column is declared as is
 * small and CLOSED, so it cannot go stale as SQL usage around the column grows.
 *
 * A declaration naming a type outside this set fails the OTHER way - fewer
 * declarations than the structural parse found - and is reported as this list
 * having gone stale, which is a sentence an author can act on. Either direction
 * fails; neither is a silent pass (charter #4).
 */
const PROVENANCE_COLUMN_TYPES = new Set(["text", "varchar", "character", "char", "citext"]);

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
 * text rather than the table structure: the column name followed by a column
 * TYPE. A mention used as an expression, an index key or an `ALTER` target is a
 * reference, not a declaration, and is not counted. */
export function provenanceDeclarationScan(ddl: string): number {
  PROV_SOURCE_DECLARED_RE.lastIndex = 0;
  return [...withoutComments(ddl).matchAll(PROV_SOURCE_DECLARED_RE)]
    .filter((match) => PROVENANCE_COLUMN_TYPES.has(match[1]!.toLowerCase()))
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
 *
 * The two directions mean different things and are diagnosed separately. More
 * declarations than the parse found is the hole this exists for: a
 * provenance-bearing column the sweep never reads. Fewer means the text reading
 * no longer recognizes a type the parse accepted, so it has stopped being able
 * to see that hole at all - equally fatal, and a different repair.
 */
export function provenanceDerivationProblems(ddl: string = MIGRATION_SQL): string[] {
  const declared = provenanceDeclarationScan(ddl);
  const parsed = provenanceColumnDeclarations(ddl).length;
  if (declared === parsed) return [];
  if (declared > parsed) {
    return [
      `the shipped DDL declares prov_source ${declared} time(s) but the column parse recognized ${parsed} declaration(s) - a provenance-bearing column outside the sweep would report its table clean without ever being read (charter #4)`,
    ];
  }
  return [
    `the column parse recognized ${parsed} prov_source declaration(s) but the text scan recognized only ${declared} - a declaration names a column type the cross-check does not know, so it can no longer see a declaration the parse misses; add the type to PROVENANCE_COLUMN_TYPES (charter #4)`,
  ];
}

/** `record_origin` where a table's own column list declares it, and where a
 * later migration adds it: version 9 gave the column to every table that already
 * existed, so a reading that only looked inside `CREATE TABLE` would conclude no
 * table has one. */
const RECORD_ORIGIN_DECLARATION_RE = new RegExp(`^"?${RECORD_ORIGIN_COLUMN}"?[\\s(]`, "i");
const ALTER_ADD_ORIGIN_RE = new RegExp(
  `ALTER\\s+TABLE\\s+([a-z_][a-z0-9_]*)\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${RECORD_ORIGIN_COLUMN}"?[\\s(]`,
  "gi",
);

/** Every table the shipped DDL gives an origin column, however it got one. */
export function originBearingTables(ddl: string = MIGRATION_SQL): string[] {
  const sql = withoutComments(ddl);
  const declared = createTableBodies(sql)
    .filter((table) => columnItems(table.body).some((item) => RECORD_ORIGIN_DECLARATION_RE.test(item.trim())))
    .map((table) => table.name);
  ALTER_ADD_ORIGIN_RE.lastIndex = 0;
  const added = [...sql.matchAll(ALTER_ADD_ORIGIN_RE)].map((match) => match[1]!);
  return [...new Set([...declared, ...added])].sort();
}

/**
 * The two columns are two FACTS, and a table carrying one without the other is a
 * table this sweep cannot clear: it can hold a demonstration row and has no
 * origin to count it by. Read from the DDL so a new provenance-bearing table
 * fails `pnpm test` rather than waiting for a store to be stood up.
 */
export function recordOriginCoverageProblems(ddl: string = MIGRATION_SQL): string[] {
  const origins = new Set(originBearingTables(ddl));
  return provenanceBearingTables(ddl)
    .filter((table) => !origins.has(table))
    .map((table) => `${table}: the shipped DDL declares prov_source but never gives it a ${RECORD_ORIGIN_COLUMN}, so the sweep has no origin to count and cannot clear it (charter #4)`);
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
  "SELECT DISTINCT c.table_name, c.column_name FROM information_schema.columns c "
  + "JOIN information_schema.tables t "
  + "ON t.table_schema = c.table_schema AND t.table_name = c.table_name "
  + `WHERE c.column_name IN ('prov_source', '${RECORD_ORIGIN_COLUMN}') AND t.table_type = 'BASE TABLE' `
  + "AND c.table_schema = ANY(current_schemas(false))";

/**
 * The THIRD reading, and the only one that is not a reading of the DDL: the
 * store's OWN column catalog. It sees a provenance-bearing table however it was
 * declared - including one created outside `MIGRATION_SQL` entirely - so a table
 * both textual readings missed fails here rather than passing unread. It also
 * answers the question the DDL readings cannot: whether a table the sweep is
 * about to count actually carries the ORIGIN column the count keys on, which is
 * a better diagnostic than the SQL error the sweep would otherwise raise, and
 * the only thing keeping the two columns from drifting apart. A catalog that
 * cannot be read is itself a problem: an unchecked derivation is exactly the
 * state this module exists to refuse.
 */
async function catalogDisagreements(db: SqlDb, derived: readonly string[]): Promise<string[]> {
  const known = new Set(derived);
  try {
    const result = await db.query<{ table_name: string; column_name: string }>(CATALOG_SQL);
    const origins = new Set(
      result.rows.filter((row) => row.column_name === RECORD_ORIGIN_COLUMN).map((row) => row.table_name),
    );
    const provenanceBearing = new Set(
      result.rows.filter((row) => row.column_name === "prov_source").map((row) => row.table_name),
    );
    return [
      ...[...provenanceBearing]
        .filter((table) => !known.has(table))
        .sort()
        .map((table) => `${table}: the store declares a prov_source column the DDL derivation never reached - it would report clean without being read (charter #4)`),
      ...[...provenanceBearing]
        .filter((table) => known.has(table) && !origins.has(table))
        .sort()
        .map((table) => `${table}: carries prov_source but no ${RECORD_ORIGIN_COLUMN}, so the sweep has no origin to count and cannot clear it (charter #4)`),
    ];
  } catch (e) {
    return [`the store's column catalog could not be read, so the derived table list is unchecked (${e instanceof Error ? e.message : String(e)})`];
  }
}

/**
 * Count rows whose ORIGIN is a demonstration one in every provenance-bearing
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
    ...recordOriginCoverageProblems(),
    ...(await catalogDisagreements(db, derived)),
  ];
  const counts: FixtureTableCount[] = [];
  if (tables.length === 0) {
    return { tables: [], totalRows: 0, problems: [...problems, "no provenance-bearing table found in the shipped DDL - the sweep would pass vacuously (charter #4)"] };
  }
  for (const table of tables) {
    // The table name comes from the shipped DDL, never from input; the ORIGIN
    // list is still bound, so the predicate itself is parameterized.
    const placeholders = DEMONSTRATION_ORIGINS.map((_, index) => `$${index + 1}`).join(",");
    try {
      const result = await db.query<{ n: string | number }>(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${RECORD_ORIGIN_COLUMN} IN (${placeholders})`,
        [...DEMONSTRATION_ORIGINS],
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
    `expected at least ${expectedRows} demonstration-origin row(s) across ${sweep.tables.length} swept table(s), found ${sweep.totalRows} - a report that finds nothing proves nothing (charter #4)`,
  ];
}

/** The clean-slate verdict a production instance must satisfy. */
export function cleanSlateViolations(sweep: FixtureSweep): string[] {
  return [
    ...sweep.problems,
    ...sweep.tables
      .filter((count) => count.rows > 0)
      .map((count) => `${count.table}: ${count.rows} demonstration-origin row(s) - a production instance must contain none`),
  ];
}
