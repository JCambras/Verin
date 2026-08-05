/**
 * Decision-projection repair (ADR-0041). Derived decision state is a cache of facts
 * the immutable ledger already states, so the repair for corrupted derived state is a
 * replay, never an edit. This is the operator surface for that: it discards derived
 * rows and folds every stored event again, in sequence order, per tenant.
 *
 * A replay that rebuilt nothing FAILS (charter #4): an empty result means the script
 * was pointed at the wrong store, not that the store is healthy.
 */
import { createDb } from "../src/infrastructure/store/db";
import { rebuildDecisionProjections } from "../src/infrastructure/ledger/ledger-store";
import { systemTenant } from "../src/contracts/tenant";

async function main(): Promise<void> {
  const db = await createDb();
  const orgs = await db.query<{ id: string }>("SELECT id FROM orgs ORDER BY id");
  let decisions = 0;
  let broken = 0;
  for (const { id } of orgs.rows) {
    try {
      const rebuilt = await rebuildDecisionProjections(
        db,
        systemTenant("ledger-rebuild", id),
      );
      decisions += rebuilt.projections.length;
      process.stdout.write(
        `org ${id}: replayed ${rebuilt.entriesReplayed} entries into ${rebuilt.projections.length} decision projection(s)\n`,
      );
    } catch {
      broken += 1;
      process.stderr.write(
        `ledger-rebuild: org ${id} SKIPPED - ledger or retained replay sources do not verify\n`,
      );
    }
  }
  await db.close();
  if (broken > 0) {
    process.stderr.write(`ledger-rebuild: ${broken} org ledger(s) failed verification and were not replayed\n`);
    process.exit(1);
  }
  if (decisions === 0) {
    process.stderr.write("ledger-rebuild: 0 decision projections rebuilt - a replay that rebuilt nothing is vacuous (did db:seed run against this store?)\n");
    process.exit(1);
  }
  process.stdout.write(`ledger-rebuild: ${decisions} decision projection(s) rebuilt across ${orgs.rows.length} org(s)\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`ledger-rebuild error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
