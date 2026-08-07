/**
 * Decision-projection repair (ADR-0041). Derived decision state is a cache of facts
 * the immutable ledger already states, so the repair for corrupted derived state is a
 * replay, never an edit. This is the operator surface for that: it discards derived
 * rows and folds every stored event again, in sequence order, per tenant.
 *
 * A replay that rebuilt nothing from entries that EXIST fails (charter #4): that result
 * means the script was pointed at the wrong store, not that the store is healthy. An
 * empty ledger is a different fact - the deferred append surface (D-116) - and
 * `decisionLedgerVacuity` is what tells the two apart.
 */
import { createDb } from "../src/infrastructure/store/db";
import { rebuildDecisionProjections } from "../src/infrastructure/ledger/ledger-store";
import { systemTenant } from "../src/contracts/tenant";
import { logLevelFor } from "../src/contracts/errors";
import { getConfig } from "../src/infrastructure/config";
import { classifyErrorMetadata } from "../src/infrastructure/observability/safe-reason";
import { decisionLedgerVacuity } from "./decision-ledger-vacuity";
import { errorMessage } from "./error-message";

async function main(): Promise<void> {
  const db = await createDb();
  const orgs = await db.query<{ id: string }>("SELECT id FROM orgs ORDER BY id");
  let decisions = 0;
  let replayed = 0;
  let broken = 0;
  for (const { id } of orgs.rows) {
    try {
      const rebuilt = await rebuildDecisionProjections(
        db,
        systemTenant("ledger-rebuild", id),
      );
      decisions += rebuilt.projections.length;
      replayed += rebuilt.entriesReplayed;
      process.stdout.write(
        `org ${id}: replayed ${rebuilt.entriesReplayed} entries into ${rebuilt.projections.length} decision projection(s)\n`,
      );
    } catch (error: unknown) {
      broken += 1;
      // An outage, a bug, and a genuine integrity break are different repairs, so the
      // refusal names which one it was. Only closed codes and the fixed-shape reason
      // are printed - never driver prose.
      const metadata = classifyErrorMetadata(error);
      const known = metadata.appError;
      process.stderr.write(
        `ledger-rebuild: org ${id} SKIPPED - ${known?.code ?? "UNKNOWN"} (${metadata.reason}, ${known ? logLevelFor(known.code) : "error"})\n`,
      );
    }
  }
  await db.close();
  if (broken > 0) {
    process.stderr.write(`ledger-rebuild: ${broken} org ledger(s) were not replayed - see the per-org refusal above\n`);
    process.exit(1);
  }
  const vacuity = decisionLedgerVacuity(getConfig().appEnv, replayed, decisions);
  if (vacuity === "vacuous") {
    process.stderr.write(
      `ledger-rebuild: ${replayed} entries replayed into ${decisions} decision projection(s) - a replay that rebuilt nothing is vacuous (did db:seed run against this store?)\n`,
    );
    process.exit(1);
  }
  if (vacuity === "empty-by-design") {
    process.stdout.write("ledger-rebuild: decision ledger empty - the post-decision append surface is deferred (D-116), so there is no history to replay yet\n");
  }
  process.stdout.write(`ledger-rebuild: ${decisions} decision projection(s) rebuilt across ${orgs.rows.length} org(s)\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`ledger-rebuild error: ${errorMessage(e)}\n`);
  process.exit(1);
});
