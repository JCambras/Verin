/**
 * GOLDEN-CASE VALIDATION RUNNER (v3 build-sequence prompt 2; blocking CI job
 * `golden-cases`).
 *
 * Validates the golden-case truth set (fixtures/golden/*.json + docs/golden-cases.md)
 * with the shared core in scripts/golden-cases.lib.ts: every required field
 * present and populated, vocabulary aligned with config/demo/scenarios.yaml,
 * structural consistency (blocked/prohibited cases carry no authority or
 * execution), doc/fixture ids in sync, all twelve spec-required cases covered,
 * and every signoff in a legal state (pending-captain until the captain signs).
 *
 * The same validator runs inside `pnpm test` via the golden-cases fitness fence,
 * which also ships the adversarial companion (charter #4). This runner is the
 * human-readable CI report, the same split as v3-invariants.json's runner/fence
 * pair.
 */
import { readFileSync, existsSync } from "node:fs";
import { GOLDEN_DOC, SIGNOFF_PENDING, loadGoldenCases, loadScenarioRefs, validateGoldenCases } from "./golden-cases.lib";

const useColor = process.env.NO_COLOR === undefined;
const paint = (code: string, s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const green = (s: string) => paint("32", s);
const red = (s: string) => paint("31;1", s);
const dim = (s: string) => paint("2", s);
const bold = (s: string) => paint("1", s);

const cases = loadGoldenCases();
const refs = loadScenarioRefs();
const docText = existsSync(GOLDEN_DOC) ? readFileSync(GOLDEN_DOC, "utf8") : "";
if (docText === "") {
  console.error(red("golden-cases: docs/golden-cases.md is missing"));
  process.exit(1);
}

const problems = validateGoldenCases(cases, refs, docText);

console.log(bold(`\nGOLDEN CASES - the prompt-2 truth set (${cases.length} case(s))`));
console.log(dim("expected results are product truth subject to captain signoff, not agent invention\n"));

for (const { rel, data } of cases) {
  const c = data as Record<string, unknown>;
  const id = typeof c.caseId === "string" ? c.caseId : rel;
  const disposition = typeof c.expectedDisposition === "string" ? c.expectedDisposition : "?";
  const signoff = (c.signoff as Record<string, unknown> | undefined)?.status;
  const mine = problems.filter((p) => p.startsWith(`${rel} ::`));
  const flag = mine.length === 0 ? green("✓") : red("✗");
  const signoffLabel = signoff === SIGNOFF_PENDING ? dim(String(signoff)) : bold(String(signoff));
  console.log(`  ${flag} ${id}  ${dim(`disposition=${disposition}`)}  signoff=${signoffLabel}`);
  for (const p of mine) console.log(red(`      └ ${p.slice(rel.length + 4)}`));
}

const global = problems.filter((p) => !p.includes(" :: "));
for (const p of global) console.log(red(`  ✗ ${p}`));

if (problems.length > 0) {
  console.error(red(`\ngolden-cases: ${problems.length} problem(s) - an incomplete case cannot pass (charter #4)`));
  process.exit(1);
}
console.log(green(`\nall ${cases.length} cases complete, aligned, and signoff-gated\n`));
