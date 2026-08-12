/**
 * CLEAN-SLATE CHECK RUNNER (ADR-0057) - `pnpm fixture:check`.
 *
 * Asserts that the configured store contains ZERO fixture-marked rows. Run it
 * against a production instance (or a restored backup) to prove the clean-slate
 * guarantee; run it in dev after a purge to prove the purge worked. It exits
 * non-zero on the first fixture-marked row it finds, and it exits non-zero when
 * it could not sweep at all - a check that verifies nothing must never report
 * clean (charter #4).
 *
 * `--report` prints the counts and exits 0 whatever it finds, which is what a
 * seeded development store wants: there the world is SUPPOSED to be there, and
 * the interesting number is how much of it.
 */
import { createDb } from "../src/infrastructure/store/db";
import { getConfig } from "../src/infrastructure/config";
import { cleanSlateViolations, sweepFixtureRows } from "./fixture-purge";
import { errorMessage } from "./error-message";

async function main(): Promise<void> {
  const reportOnly = process.argv.includes("--report");
  const db = await createDb();
  const sweep = await sweepFixtureRows(db);
  await db.close();
  for (const count of sweep.tables) {
    process.stdout.write(`  ${count.table.padEnd(32)} ${String(count.rows).padStart(6)} fixture-marked row(s)\n`);
  }
  const violations = cleanSlateViolations(sweep);
  if (reportOnly) {
    process.stdout.write(`\nfixture:check --report: ${sweep.totalRows} fixture-marked row(s) across ${sweep.tables.length} table(s) in APP_ENV=${getConfig().appEnv}\n`);
    if (sweep.problems.length > 0) {
      process.stderr.write(`${sweep.problems.map((problem) => `  ✗ ${problem}\n`).join("")}`);
      process.exit(1);
    }
    return;
  }
  if (violations.length > 0) {
    process.stderr.write(`\nfixture:check FAILED - this instance is not clean:\n${violations.map((v) => `  ✗ ${v}\n`).join("")}`);
    process.exit(1);
  }
  process.stdout.write(`\nfixture:check: clean - zero fixture-marked rows across ${sweep.tables.length} provenance-bearing table(s)\n`);
}

main().catch((e) => {
  process.stderr.write(`fixture:check failed: ${errorMessage(e)}\n`);
  process.exit(1);
});
