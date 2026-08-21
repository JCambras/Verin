// The amplification harness (prompt 4 deliverable 6; ADR-0061 ruling CD-5e: BOTH regimes, always -
// a single amplification figure is meaningless without saying which regime it measures). The change
// class measured is the oracle's reproduced inert delta: Firm A's cash-reserve horizon, six months
// to nine. COUNTING RULE (the harness's own, committed with it): gross = added plus deleted lines
// over the whole repository diff for the change, as git counts them, with the diff for each regime
// included in the report. The ruled generalization clause: a repair is excluded from the
// steady-state figure only when a second, unanticipated change of the same class demonstrates the
// exclusion - regime two IS that second change, and a coupling that recurs there is never excluded.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 24 });
// The change set is DISCOVERED, not assumed: each coupled site must hold the exact current value or
// the harness refuses - a moved coupling means the edit set below no longer measures the class.
function applyHorizon(from: number, to: number): void {
  const edits: [string, string][] = [
    ["src/tools/cli.ts", `"reserveHorizonMonths":${from},"dualApproval":{"thresholdUsd":25000`],
    ["src/e2e/app.e2e.ts", `"${from} months of planned withdrawals"`],
  ];
  for (const [file, oldText] of edits) {
    const s = readFileSync(file, "utf8");
    if (!s.includes(oldText)) throw new Error(`amplification: expected coupling '${oldText}' not found in ${file}; the change class moved - re-derive the edit set`);
    writeFileSync(file, s.replace(oldText, oldText.replaceAll(String(from), String(to))));
    console.log(`edited ${file}: ${oldText} -> ${to}`);
  }
}
const gross = (numstat: string) =>
  numstat
    .trim()
    .split("\n")
    .filter(Boolean)
    .reduce((n, l) => n + Number(l.split("\t")[0]) + Number(l.split("\t")[1]), 0);

if (git("status", "--porcelain").trim() !== "") {
  console.error("amplification: the tree must be clean; refusing to measure over unrelated changes");
  process.exit(2);
}
console.log("Amplification report (deliverable 6; CD-5e: both regimes, always; gross = added + deleted lines over the whole repository diff).");
console.log("The true product change - a firm's policy changing - is a NEW PUBLISHED VERSION through the operator");
console.log("surface: ZERO repository diff, the registry working as designed. The figures below price the DEMO");
console.log("WORLD's hand-authored re-expression (the seed fixture) and its coupled browser assertion.");
try {
  console.log("\n== Regime 1: first encounter - Firm A's reserve horizon, six months to nine ==");
  applyHorizon(6, 9);
  console.log(git("diff"));
  console.log(`first-encounter gross: ${gross(git("diff", "--numstat"))} lines`);
  git("add", "-A"); // stage regime one as the baseline the second change diffs against
  console.log("\n== Regime 2: steady state - a second, unanticipated change of the same class, nine to twelve ==");
  applyHorizon(9, 12);
  console.log(git("diff"));
  console.log(`steady-state gross: ${gross(git("diff", "--numstat"))} lines`);
  console.log("\nThe browser-assertion repair RECURS in regime two, so the ruled clause excludes nothing: both");
  console.log("regimes price the same standing fixture coupling, and the product path remains a zero-diff publish.");
} finally {
  git("reset", "-q");
  git("checkout", "-q", "--", "src/tools/cli.ts", "src/e2e/app.e2e.ts");
}
