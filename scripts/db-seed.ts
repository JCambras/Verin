/**
 * `pnpm db:seed` - the runner. It opens the configured store, runs the complete
 * seed (`scripts/seed-demo-store.ts`, which owns every write and the
 * production refusal), closes the store and reports what landed.
 *
 * The seeding itself is a function of a store so the clean-slate guarantee can be
 * proved against THIS seed rather than a re-implementation of it; nothing else
 * belongs here.
 */
import { createDb } from "../src/infrastructure/store/db";
import { DEMO_ORG_ID, DEMO_USERS } from "../src/infrastructure/store/demo-tenant";
import { errorMessage } from "./error-message";
import { assertSeedableEnvironment, seedDemoStore } from "./seed-demo-store";

async function main(): Promise<string> {
  // Before a connection is opened, not after: opening the configured store runs
  // migrations, and a production store must not be touched by this at all.
  assertSeedableEnvironment();
  const db = await createDb();
  try {
    return await seedDemoStore(db);
  } finally {
    await db.close();
  }
}

main()
  .then((world) => {
    process.stdout.write(`seeded org ${DEMO_ORG_ID} with ${DEMO_USERS.length} demo users\n  world: ${world}\n`);
  })
  .catch((e) => {
    process.stderr.write(`seed failed: ${errorMessage(e)}\n`);
    process.exit(1);
  });
