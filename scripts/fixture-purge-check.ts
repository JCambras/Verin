/**
 * CLEAN-SLATE CHECK RUNNER (ADR-0057) - `pnpm fixture:check`.
 *
 * Asserts that the configured store contains ZERO demonstration-origin rows. Run it
 * against a production instance (or a restored backup) to prove the clean-slate
 * guarantee; run it in dev after a purge to prove the purge worked. It exits
 * non-zero on the first demonstration-origin row it finds, and it exits non-zero when
 * it could not sweep at all - a check that verifies nothing must never report
 * clean (charter #4).
 *
 * What it counts is the ROW's origin, never the provenance of the values in it:
 * a seeded household somebody has since renamed carries a user-entered name and
 * is still a demonstration record, and a purge that let the edit exempt it would
 * leave demo data in production because somebody typed over it.
 *
 * `--report` prints the counts and exits 0 whatever it finds, which is what a
 * seeded development store wants: there the world is SUPPOSED to be there, and
 * the interesting number is how much of it. `--expect-rows=<n>` turns that
 * report into an assertion for the callers that need one (CI, after the seed):
 * a store that reports fewer demonstration-origin rows than the world it just loaded
 * would fail the same way an unswept table does. It belongs to that path only, so
 * passing it without `--report` is a USAGE ERROR rather than a no-op - the run it
 * would silently fall through to asserts the opposite verdict.
 */
import { createDb } from "../src/infrastructure/store/db";
import { getConfig } from "../src/infrastructure/config";
import { cleanSlateViolations, expectedRowsViolations, sweepFixtureRows } from "./fixture-purge";
import { errorMessage } from "./error-message";

const EXPECT_ROWS_FLAG = "--expect-rows=";

async function main(): Promise<void> {
  const reportOnly = process.argv.includes("--report");
  const expectRowsArg = process.argv.find((arg) => arg.startsWith(EXPECT_ROWS_FLAG));
  // A flag that silently does nothing is a check quietly doing something other
  // than what it was asked: `--expect-rows` is the REPORT path's floor, and
  // outside it the run would assert clean-slate instead - the opposite verdict -
  // while the caller believes their floor was applied.
  if (expectRowsArg !== undefined && !reportOnly) {
    process.stderr.write(`fixture:check: ${EXPECT_ROWS_FLAG}<n> is the --report path's floor and does nothing without --report; the default run asserts a CLEAN store, which is the opposite assertion\n`);
    process.exit(2);
  }
  const db = await createDb();
  const sweep = await sweepFixtureRows(db);
  await db.close();
  for (const count of sweep.tables) {
    process.stdout.write(`  ${count.table.padEnd(32)} ${String(count.rows).padStart(6)} demonstration-origin row(s)\n`);
  }
  const violations = cleanSlateViolations(sweep);
  if (reportOnly) {
    process.stdout.write(`\nfixture:check --report: ${sweep.totalRows} demonstration-origin row(s) across ${sweep.tables.length} table(s) in APP_ENV=${getConfig().appEnv}\n`);
    const reported = expectRowsArg === undefined
      ? [...sweep.problems]
      : expectedRowsViolations(sweep, Number(expectRowsArg.slice(EXPECT_ROWS_FLAG.length)));
    if (reported.length > 0) {
      process.stderr.write(`${reported.map((problem) => `  ✗ ${problem}\n`).join("")}`);
      process.exit(1);
    }
    return;
  }
  if (violations.length > 0) {
    process.stderr.write(`\nfixture:check FAILED - this instance is not clean:\n${violations.map((v) => `  ✗ ${v}\n`).join("")}`);
    process.exit(1);
  }
  process.stdout.write(`\nfixture:check: clean - zero demonstration-origin rows across ${sweep.tables.length} provenance-bearing table(s)\n`);
}

main().catch((e) => {
  process.stderr.write(`fixture:check failed: ${errorMessage(e)}\n`);
  process.exit(1);
});
