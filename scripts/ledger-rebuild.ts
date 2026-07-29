/**
 * Decision-projection repair (ADR-0033). Derived decision state is a cache of facts
 * the immutable ledger already states, so the repair for corrupted derived state is a
 * replay, never an edit. This is the operator surface for that: it discards derived
 * rows and folds every stored event again, in sequence order, for ONE named tenant.
 *
 * A replay that rebuilt nothing FAILS (charter #4): an empty result means the script
 * was pointed at the wrong store, not that the store is healthy.
 */
import {
  createDb,
  type SqlDb,
  type SqlQueryable,
} from "../src/infrastructure/store/db";
import { isAppError } from "../src/contracts/errors";
import { rebuildDecisionProjections } from "../src/infrastructure/ledger/ledger-store";
import { verifyDecisionLedgerIntegrity } from "../src/infrastructure/ledger/ledger-verification";
import {
  countDecisionProjections,
  listDecisionProjectionMetadata,
} from "../src/infrastructure/ledger/ledger-projection-store";
import {
  LEDGER_REBUILD_USAGE,
  REBUILD_PLAN_SAMPLE,
  parseRebuildArgs,
  rebuildPlanLines,
} from "./ledger-rebuild.lib";

function fail(message: string): never {
  process.stderr.write(`ledger-rebuild: ${message}\n`);
  process.exit(1);
}

async function printLockedPlan(
  db: SqlQueryable,
  tenant: string,
  entries: number,
): Promise<void> {
  const sample = await listDecisionProjectionMetadata(
    db,
    tenant,
    REBUILD_PLAN_SAMPLE,
  );
  const lines = rebuildPlanLines({
    tenant,
    entries,
    derived: await countDecisionProjections(db, tenant),
    sample,
  });
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function printPlan(db: SqlDb, tenant: string): Promise<number> {
  const integrity = await verifyDecisionLedgerIntegrity(db, tenant);
  const verdict = integrity.ledger;
  if (!integrity.ok) {
    await db.close();
    fail(
      `org ${tenant} ledger does not verify (${verdict.levels.find((level) => !level.ok)?.reason ?? integrity.replaySourceReason ?? "unknown"}) - refusing to replay`,
    );
  }
  if (verdict.entriesChecked === 0) {
    await db.close();
    fail(
      `org ${tenant} has 0 decision-ledger entries - replaying nothing is vacuous (did db:seed run against this store?)`,
    );
  }
  await printLockedPlan(db, tenant, verdict.entriesChecked);
  return verdict.entriesChecked;
}

async function main(): Promise<void> {
  const options = parseRebuildArgs(process.argv.slice(2));
  if (typeof options === "string") {
    process.stderr.write(`ledger-rebuild: ${options}\n${LEDGER_REBUILD_USAGE}\n`);
    process.exit(1);
  }
  const db = await createDb();
  const known = await db.query<{ id: string }>(
    "SELECT id FROM orgs WHERE id = $1",
    [options.tenant],
  );
  if (known.rows.length !== 1) {
    await db.close();
    fail(`org ${options.tenant} does not exist in this store`);
  }
  if (!options.apply) {
    await printPlan(db, options.tenant);
    await db.close();
    process.stdout.write(
      "PREVIEW - nothing was changed. Re-run with --apply to replay this tenant.\n",
    );
    return;
  }
  let entries = 0;
  const rebuilt = await rebuildDecisionProjections(
    db,
    options.tenant,
    async (tx, verifiedEntries) => {
      entries = verifiedEntries;
      await printLockedPlan(tx, options.tenant, verifiedEntries);
    },
  );
  await db.close();
  if (rebuilt.length === 0) {
    fail(
      `org ${options.tenant}: 0 decision projections rebuilt from ${entries} entries - a replay that rebuilt nothing is vacuous`,
    );
  }
  process.stdout.write(
    `ledger-rebuild: org ${options.tenant} replayed ${entries} entries into ${rebuilt.length} decision projection(s)\n`,
  );
}

main().catch((e: unknown) => {
  // A typed AppError is a plain object, so the usual Error narrowing would print
  // "[object Object]" and hide exactly the reason the operator needs.
  const reason = isAppError(e)
    ? `${e.code}: ${e.message}`
    : e instanceof Error ? e.message : String(e);
  process.stderr.write(`ledger-rebuild error: ${reason}\n`);
  process.exit(1);
});
