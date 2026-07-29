import type { SqlQueryable } from "./db";
import { migrationFailure } from "./migration-errors";
/** Read-only current-schema ledger probe with normalized failure diagnostics. */
export async function migrationLedgerExists(db: SqlQueryable): Promise<boolean> {
  try {
    const { rows } = await db.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname = 'schema_migrations'
      ) AS exists
    `);
    return rows[0]?.exists === true;
  } catch (cause) {
    throw migrationFailure("virginity-check", cause);
  }
}
