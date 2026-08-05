import { appError, normalizeAppError } from "@contracts/errors";
import type { SqlDb, SqlQueryable } from "./db";
import { migrationFailure } from "./migration-errors";
import { migrationLedgerExists } from "./migration-support";
import {
  MIGRATIONS,
  MIGRATION_SQL,
  SCHEMA_MIGRATIONS_DDL,
  type Migration,
} from "./migrations";

async function assertPreflightClean(
  db: SqlQueryable,
  migration: Migration,
): Promise<void> {
  try {
    const blocked: string[] = [];
    for (const probe of migration.preflight ?? []) {
      const { rows } = await db.query<{ orphans: number }>(probe.sql);
      const orphans = Number(rows[0]?.orphans ?? 0);
      if (orphans > 0) {
        blocked.push(
          `${probe.relationship}: ${orphans} row(s) in ${probe.subject} reference a parent in another tenant (or no parent at all)`,
        );
      }
    }
    if (blocked.length > 0) {
      throw appError(
        "INTERNAL",
        `migration ${migration.version} (${migration.name}) cannot be applied to this store; no schema change was made and no row was modified. Re-point or remove the rows below, then restart:\n${blocked.join("\n")}`,
      );
    }
  } catch (cause) {
    const error = normalizeAppError(cause);
    if (error) throw error;
    throw migrationFailure("preflight", cause, migration);
  }
}

const MANAGED_OBJECT_RE =
  /CREATE\s+(?:(?:OR\s+REPLACE\s+)?FUNCTION|TRIGGER|(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+([a-z_][a-z0-9_]*)/gi;
const LEDGER_TABLE = "schema_migrations";
const MANAGED_OBJECT_PROBE_SQL = `
SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relkind IN ('r','i','v','m','S','p')
UNION SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = current_schema()
UNION SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema();
`;

function managedObjectNames(migrationSql: string): ReadonlySet<string> {
  return new Set(
    [...migrationSql.matchAll(MANAGED_OBJECT_RE)]
      .map((match) => match[1]!.toLowerCase()),
  );
}

async function assertManagedSchemaEmpty(
  db: SqlQueryable,
  managedNames: ReadonlySet<string>,
): Promise<void> {
  let existing: string[];
  try {
    const { rows } = await db.query<{ name: string }>(MANAGED_OBJECT_PROBE_SQL);
    existing = rows
      .map((row) => String(row.name).toLowerCase())
      .filter((name) => name !== LEDGER_TABLE && managedNames.has(name))
      .sort();
  } catch (cause) {
    throw migrationFailure("virginity-check", cause);
  }
  if (existing.length === 0) return;
  throw appError(
    "INTERNAL",
    `the migration ledger is empty but this store already contains ${existing.length} object(s) this schema owns; no schema change was made and no version was recorded. This is the shape of a restored dump whose schema_migrations rows were not restored, or a dropped ledger. Restore the ledger to the version the data was written at (or adopt the store deliberately by recording the applied versions), then restart. Objects found: ${existing.join(", ")}`,
    { stage: "virginity-check", existingCount: existing.length },
  );
}

export async function runMigrationPlan(
  db: SqlDb,
): Promise<void> {
  let stage: Parameters<typeof migrationFailure>[0] = "virginity-check";
  let activeMigration: Migration | undefined;
  const managedNames = managedObjectNames(MIGRATION_SQL);
  try {
    await db.transaction(async (tx) => {
      const ledgerExisted = await migrationLedgerExists(tx);
      if (!ledgerExisted) await assertManagedSchemaEmpty(tx, managedNames);
      stage = "ledger-bootstrap";
      await tx.exec(SCHEMA_MIGRATIONS_DDL);
      stage = "applied-version-read";
      const recorded = await tx.query<{ version: number; name: string }>(
        "SELECT version, name FROM schema_migrations ORDER BY version",
      );
      if (recorded.rows.length === 0 && ledgerExisted) {
        stage = "virginity-check";
        await assertManagedSchemaEmpty(tx, managedNames);
      }
      const mismatch = recorded.rows.findIndex((row, index) =>
        Number(row.version) !== MIGRATIONS[index]?.version ||
        String(row.name) !== MIGRATIONS[index]?.name
      );
      if (mismatch >= 0) {
        throw appError(
          "INTERNAL",
          "the migration ledger is not an exact contiguous prefix of the shipped migration plan; no schema change was made",
          { stage: "applied-version-read", recordedCount: recorded.rows.length },
        );
      }
      const pending = MIGRATIONS.slice(recorded.rows.length);
      for (const migration of pending) {
        activeMigration = migration;
        stage = "preflight";
        await assertPreflightClean(tx, migration);
        stage = "mutation";
        await tx.exec(migration.sql);
        await tx.query(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, now())",
          [migration.version, migration.name],
        );
      }
    });
  } catch (cause) {
    const error = normalizeAppError(cause);
    if (error) throw error;
    throw migrationFailure(stage, cause, activeMigration);
  }
}
