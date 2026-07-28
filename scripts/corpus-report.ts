/**
 * CORPUS MEASUREMENT REPORT (v3 prompt 11, ADR-0034) - `pnpm corpus:report`.
 *
 * Prints the case inventory and the provenance split. It REFUSES to blend: the
 * synthetic partition's figure is `syntheticDefectCoverage`, only the
 * real-derived partition's may be called `detectionRate`, and neither is emitted
 * until the corpus version is signed and a detector has actually been run over
 * it. Today both are `null` with a reason code, and that is the honest output -
 * prompt 11 ships the split-capable structure, not a number.
 *
 * Every coverage figure prints its FALSE-POSITIVE RATE beside it (captain
 * ruling, 2026-07-28): a detector that blocks everything scores perfect coverage
 * and must be caught by its false positives.
 */
import { buildCorpusReport, type CaseOutcome } from "./corpus/report";
import { isSigned } from "./corpus/signoff";
import { validateCorpus } from "./corpus/validate";

const useColor = process.env.NO_COLOR === undefined;
const paint = (code: string, s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const dim = (s: string) => paint("2", s);
const bold = (s: string) => paint("1", s);
const red = (s: string) => paint("31;1", s);

const result = validateCorpus();
if (result.problems.length > 0) {
  console.error(red(`corpus:report refuses to measure an invalid corpus - run \`pnpm corpus:validate\` (${result.problems.length} problem(s))`));
  process.exit(1);
}

// No detector exists at prompt 11, so no case is evaluated. `flagged: null` is
// the honest input, and the reporter turns it into a withheld figure with a
// reason code rather than a zero.
const syntheticOutcomes: CaseOutcome[] = result.cases.map((item) => ({
  caseId: item.caseId,
  labelKind: item.label.kind === "defect" ? "defect" : "clean-control",
  flagged: null,
}));

const report = buildCorpusReport({
  corpusVersion: result.spec.world.corpusVersion,
  corpusDigest: result.corpusDigest,
  signoffStatus: result.signoff.status ?? "(missing)",
  signed: isSigned(result.signoff, result.corpusDigest),
  syntheticOutcomes,
  realDerivedOutcomes: [],
});

const show = (measured: { value: number | null; reasonCode: string | null }): string =>
  measured.value === null ? dim(`null (${measured.reasonCode})`) : `${(measured.value * 100).toFixed(2)}%`;

console.log(bold(`\nCORPUS MEASUREMENT - split by provenance, never blended\n`));
console.log(`  corpusVersion ${report.corpusVersion}`);
console.log(`  corpusDigest  ${report.corpusDigest}`);
console.log(`  signoff       ${report.signoffStatus}\n`);

console.log(bold("  synthetic-fixture partition"));
console.log(`    cases ${report.synthetic.totalCases}  defects ${report.synthetic.defectCases}  clean controls ${report.synthetic.cleanControls}  evaluated ${report.synthetic.evaluatedCases}`);
console.log(`    syntheticDefectCoverage  ${show(report.synthetic.syntheticDefectCoverage)}`);
console.log(`    falsePositiveRate        ${show(report.synthetic.falsePositiveRate)}`);
console.log(`    interpretable            ${report.synthetic.interpretable}\n`);

console.log(bold("  real-derived-fixture partition"));
console.log(`    cases ${report.realDerived.totalCases}  defects ${report.realDerived.defectCases}  clean controls ${report.realDerived.cleanControls}  evaluated ${report.realDerived.evaluatedCases}`);
console.log(`    detectionRate            ${show(report.realDerived.detectionRate)}`);
console.log(`    falsePositiveRate        ${show(report.realDerived.falsePositiveRate)}`);
console.log(`    interpretable            ${report.realDerived.interpretable}\n`);

console.log(dim("  There is deliberately no blended figure. A rate measured on author-invented"));
console.log(dim("  synthetic defects is synthetic-defect coverage, not detection (architecture v3"));
console.log(dim("  §2.4, demo contract §7). No detection rate is claimed and Gate B is not claimed.\n"));
