export type ReasonCode =
  | "corpus-signoff-pending"
  | "real-derived-corpus-absent"
  | "synthetic-corpus-absent"
  | "detector-outcomes-absent"
  | "detector-outcomes-incomplete"
  | "no-labeled-defects"
  | "no-clean-controls";

export interface Measured {
  readonly value: number | null;
  readonly reasonCode: ReasonCode | null;
}

/** One case's label and, if a detector ran, whether that detector flagged it. */
interface CaseOutcomeBase {
  readonly caseId: string;
  readonly labelKind: "defect" | "clean-control";
  readonly flagged: boolean | null;
}

export interface SyntheticCaseOutcome extends CaseOutcomeBase {
  readonly provenance: "synthetic-fixture";
}

export interface RealDerivedCaseOutcome extends CaseOutcomeBase {
  readonly provenance: "real-derived-fixture";
}

export type CaseOutcome = SyntheticCaseOutcome | RealDerivedCaseOutcome;

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

function measurePartition(
  outcomes: readonly CaseOutcome[],
  signed: boolean,
  emptyReason: ReasonCode,
  provenance: CaseOutcome["provenance"],
): PartitionFigures {
  const mismatched = outcomes.filter((outcome) => outcome.provenance !== provenance);
  if (mismatched.length > 0) {
    throw new Error(
      `corpus report: ${provenance} measurement received ${mismatched.length} outcome(s) from another provenance partition`,
    );
  }
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
  if (counts.evaluatedCases !== counts.totalCases) {
    return {
      counts,
      coverage: withheld("detector-outcomes-incomplete"),
      falsePositiveRate: withheld("detector-outcomes-incomplete"),
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
  readonly syntheticOutcomes: readonly SyntheticCaseOutcome[];
  readonly realDerivedOutcomes: readonly RealDerivedCaseOutcome[];
}

export function buildCorpusReport(input: ReportInput): CorpusReport {
  const synthetic = measurePartition(
    input.syntheticOutcomes,
    input.signed,
    "synthetic-corpus-absent",
    "synthetic-fixture",
  );
  const realDerived = measurePartition(
    input.realDerivedOutcomes,
    input.signed,
    "real-derived-corpus-absent",
    "real-derived-fixture",
  );
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
