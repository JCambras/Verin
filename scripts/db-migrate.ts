/**
 * Run migrations (idempotent — createDb applies MIGRATION_SQL). Used to provision
 * the dev/CI store before the app boots.
 */
import { createDb } from "../src/infrastructure/store/db";

createDb()
  .then(async (db) => {
    await db.close();
    process.stdout.write("migrations applied\n");
  })
  .catch((e) => {
    process.stderr.write(`migrate failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
