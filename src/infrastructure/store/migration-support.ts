import type { SqlQueryable } from "./db";
import { migrationFailure } from "./migration-errors";

export const SESSION_LINEAGE_SQL = `
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lineage_id text;
UPDATE sessions SET lineage_id = id WHERE lineage_id IS NULL;
ALTER TABLE sessions ALTER COLUMN lineage_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_lineage ON sessions(lineage_id);
`;

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
