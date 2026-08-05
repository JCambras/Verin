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
import {
  renderCorpusReport,
  type RealDerivedCaseOutcome,
  type SyntheticCaseOutcome,
} from "./corpus/report";
import { validateCorpus } from "./corpus/validate";

const result = validateCorpus();
if (result.problems.length > 0) {
  console.error(
    `corpus:report refuses to measure an invalid corpus - run \`pnpm corpus:validate\` (${result.problems.length} problem(s))`,
  );
  process.exit(1);
}

// No detector exists at prompt 11, so no case is evaluated. A null attribution is
// the honest input, and the reporter turns it into a withheld figure with a
// reason code rather than a zero.
const syntheticOutcomes: SyntheticCaseOutcome[] = result.cases.map((item) => ({
  caseId: item.caseId,
  attributedDefectClassIds: null,
  provenance: "synthetic-fixture",
}));
const realDerivedOutcomes: RealDerivedCaseOutcome[] = result.realDerivedCases.map((item) => {
  return {
    caseId: String(item.caseId),
    attributedDefectClassIds: null,
    provenance: "real-derived-fixture",
  };
});

console.log(renderCorpusReport({
  corpusVersion: result.spec.world.corpusVersion,
  corpusDigest: result.corpusDigest,
  seed: result.seed,
  taxonomyDigest: result.taxonomyDigest,
  authority: result.authority,
  signoff: result.signoff,
  inventory: result.inventory,
  syntheticOutcomes,
  realDerivedOutcomes,
}));
