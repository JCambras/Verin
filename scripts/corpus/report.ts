/**
 * CORPUS MEASUREMENT - SPLIT BY PROVENANCE, NEVER BLENDED (v3 prompt 11,
 * ADR-0034; architecture v3 §2.4, demo contract §7).
 *
 * Four structural rules make blending impossible rather than merely discouraged:
 *
 *  1. NO AGGREGATE TYPE EXISTS. There is no `overall`, no index signature, and no
 *     accessor that reduces across provenance classes. The `no-blending` rule in
 *     `corpus-provenance-split` fails the build on any expression that combines
 *     the two partitions arithmetically.
 *  2. THE LABELS ARE DIFFERENT WORDS. The synthetic partition's figure is
 *     `syntheticDefectCoverage`; only the real-derived partition's figure may be
 *     called `detectionRate`. A rate measured on author-invented defects is
 *     synthetic-defect coverage, not detection.
 *  3. HONEST EMPTY. With no real-derived cases the report emits
 *     `detectionRate: null` with `reasonCode: "real-derived-corpus-absent"` and
 *     refuses to substitute the synthetic figure. `null` is a real branch: the
 *     companion feeds a populated real-derived partition and a number appears.
 *  4. FALSE POSITIVES BESIDE COVERAGE (captain ruling, 2026-07-28). Every
 *     coverage figure ships with a false-positive rate computed from LABELED
 *     CLEAN CONTROLS, and a coverage figure without one is marked
 *     `interpretable: false` - so a detector that blocks everything scores 1.0
 *     coverage AND 1.0 false positives and cannot claim success.
 */
export type ReasonCode =
  | "corpus-signoff-pending"
  | "real-derived-corpus-absent"
  | "synthetic-corpus-absent"
  | "detector-outcomes-absent"
  | "no-labeled-defects"
  | "no-clean-controls";

export interface Measured {
  readonly value: number | null;
  readonly reasonCode: ReasonCode | null;
}

/** One case's label and, if a detector ran, whether that detector flagged it. */
export interface CaseOutcome {
  readonly caseId: string;
  readonly labelKind: "defect" | "clean-control";
  /** `null` when no detector has been run over this case. */
  readonly flagged: boolean | null;
}

interface PartitionCounts {
  readonly totalCases: number;
  readonly defectCases: number;
  readonly cleanControls: number;
  readonly evaluatedCases: number;
}

export interface SyntheticPartitionReport extends PartitionCounts {
  readonly provenance: "synthetic-fixture";
  readonly syntheticDefectCoverage: Measured;
  readonly falsePositiveRate: Measured;
  readonly interpretable: boolean;
}

export interface RealDerivedPartitionReport extends PartitionCounts {
  readonly provenance: "real-derived-fixture";
  readonly detectionRate: Measured;
  readonly falsePositiveRate: Measured;
  readonly interpretable: boolean;
}

export interface CorpusReport {
  readonly corpusVersion: string;
  readonly corpusDigest: string;
  readonly signoffStatus: string;
  readonly signed: boolean;
  readonly synthetic: SyntheticPartitionReport;
  readonly realDerived: RealDerivedPartitionReport;
}

const withheld = (reasonCode: ReasonCode): Measured => ({ value: null, reasonCode });

const rateOf = (numerator: number, denominator: number): number =>
  Math.round((numerator / denominator) * 10_000) / 10_000;

const countsOf = (outcomes: readonly CaseOutcome[]): PartitionCounts => ({
  totalCases: outcomes.length,
  defectCases: outcomes.filter((outcome) => outcome.labelKind === "defect").length,
  cleanControls: outcomes.filter((outcome) => outcome.labelKind === "clean-control").length,
  evaluatedCases: outcomes.filter((outcome) => outcome.flagged !== null).length,
});

interface PartitionFigures {
  readonly counts: PartitionCounts;
  readonly coverage: Measured;
  readonly falsePositiveRate: Measured;
}

/** The shared arithmetic, run INDEPENDENTLY per partition - never across them. */
function measurePartition(
  outcomes: readonly CaseOutcome[],
  signed: boolean,
  emptyReason: ReasonCode,
): PartitionFigures {
  const counts = countsOf(outcomes);
  if (!signed) {
    return {
      counts,
      coverage: withheld("corpus-signoff-pending"),
      falsePositiveRate: withheld("corpus-signoff-pending"),
    };
  }
  if (counts.totalCases === 0) {
    return { counts, coverage: withheld(emptyReason), falsePositiveRate: withheld(emptyReason) };
  }
  if (counts.evaluatedCases === 0) {
    return {
      counts,
      coverage: withheld("detector-outcomes-absent"),
      falsePositiveRate: withheld("detector-outcomes-absent"),
    };
  }
  const evaluatedDefects = outcomes.filter((o) => o.labelKind === "defect" && o.flagged !== null);
  const evaluatedControls = outcomes.filter((o) => o.labelKind === "clean-control" && o.flagged !== null);
  return {
    counts,
    coverage:
      evaluatedDefects.length === 0
        ? withheld("no-labeled-defects")
        : {
            value: rateOf(evaluatedDefects.filter((o) => o.flagged === true).length, evaluatedDefects.length),
            reasonCode: null,
          },
    falsePositiveRate:
      evaluatedControls.length === 0
        ? withheld("no-clean-controls")
        : {
            value: rateOf(evaluatedControls.filter((o) => o.flagged === true).length, evaluatedControls.length),
            reasonCode: null,
          },
  };
}

export interface ReportInput {
  readonly corpusVersion: string;
  readonly corpusDigest: string;
  readonly signoffStatus: string;
  readonly signed: boolean;
  readonly syntheticOutcomes: readonly CaseOutcome[];
  readonly realDerivedOutcomes: readonly CaseOutcome[];
}

export function buildCorpusReport(input: ReportInput): CorpusReport {
  const synthetic = measurePartition(input.syntheticOutcomes, input.signed, "synthetic-corpus-absent");
  const realDerived = measurePartition(input.realDerivedOutcomes, input.signed, "real-derived-corpus-absent");
  return {
    corpusVersion: input.corpusVersion,
    corpusDigest: input.corpusDigest,
    signoffStatus: input.signoffStatus,
    signed: input.signed,
    synthetic: {
      provenance: "synthetic-fixture",
      ...synthetic.counts,
      syntheticDefectCoverage: synthetic.coverage,
      falsePositiveRate: synthetic.falsePositiveRate,
      interpretable: synthetic.coverage.value !== null && synthetic.falsePositiveRate.value !== null,
    },
    realDerived: {
      provenance: "real-derived-fixture",
      ...realDerived.counts,
      detectionRate: realDerived.coverage,
      falsePositiveRate: realDerived.falsePositiveRate,
      interpretable: realDerived.coverage.value !== null && realDerived.falsePositiveRate.value !== null,
    },
  };
}
