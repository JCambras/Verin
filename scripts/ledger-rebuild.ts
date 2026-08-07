/**
 * Decision-projection repair (ADR-0041). Derived decision state is a cache of facts
 * the immutable ledger already states, so the repair for corrupted derived state is a
 * replay, never an edit. This is the operator surface for that: it discards derived
 * rows and folds every stored event again, in sequence order.
 *
 * SCOPED AND OPT-IN. The runbook points here under RTO pressure, where the intent is
 * "repair this one tenant" - so the tenant is an explicit argument, no argument does
 * nothing at all, and writing requires `--apply`. The default is a dry run: the same
 * one-transaction replay, rolled back, so an operator sees exactly what applying
 * would produce before anything is written.
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
import { parseRebuildInvocation, REBUILD_USAGE } from "./ledger-rebuild-args";

async function main(): Promise<void> {
  const invocation = parseRebuildInvocation(process.argv.slice(2));
  if (!invocation) {
    process.stderr.write(REBUILD_USAGE);
    process.exit(1);
  }
  const { orgId, apply } = invocation;
  const db = await createDb();
  let rebuilt;
  try {
    rebuilt = await rebuildDecisionProjections(
      db,
      systemTenant("ledger-rebuild", orgId),
      { apply },
    );
  } catch (error: unknown) {
    // An outage, a bug, and a genuine integrity break are different repairs, so the
    // refusal names which one it was. Only closed codes and the fixed-shape reason
    // are printed - never driver prose.
    const metadata = classifyErrorMetadata(error);
    const known = metadata.appError;
    process.stderr.write(
      `ledger-rebuild: org ${orgId} REFUSED - ${known?.code ?? "UNKNOWN"} (${metadata.reason}, ${known ? logLevelFor(known.code) : "error"})\n`,
    );
    await db.close();
    process.exit(1);
  }
  await db.close();
  const decisions = rebuilt.projections.length;
  const mode = rebuilt.applied ? "rebuilt" : "would rebuild";
  process.stdout.write(
    `ledger-rebuild: org ${orgId} ${mode} ${decisions} decision projection(s) from ${rebuilt.entriesReplayed} replayed entr(ies)\n`,
  );
  for (const { projection } of rebuilt.projections) {
    process.stdout.write(
      `  ${projection.decisionId}: ${projection.disposition} · ${projection.lastEventType} (#${projection.lastSequence})\n`,
    );
  }
  const vacuity = decisionLedgerVacuity(
    getConfig().appEnv,
    rebuilt.entriesReplayed,
    decisions,
  );
  if (vacuity === "vacuous") {
    process.stderr.write(
      `ledger-rebuild: ${rebuilt.entriesReplayed} entries replayed into ${decisions} decision projection(s) - a replay that rebuilt nothing is vacuous (did db:seed run against this store?)\n`,
    );
    process.exit(1);
  }
  if (vacuity === "empty-by-design") {
    process.stdout.write("ledger-rebuild: decision ledger empty - the post-decision append surface is deferred (D-116), so there is no history to replay yet\n");
  }
  if (!rebuilt.applied) {
    process.stdout.write("ledger-rebuild: PREVIEW only - nothing was written; re-run with --apply to commit this replay\n");
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`ledger-rebuild error: ${errorMessage(e)}\n`);
  process.exit(1);
});
