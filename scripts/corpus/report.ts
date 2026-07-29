import {
  corpusDigest as computeCorpusDigest,
  type CaseInventoryEntry,
  type FreshnessPolicyBinding,
} from "./manifest";
import {
  isSigned,
  signoffProblems,
  type CorpusSignoff,
} from "./signoff";

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

interface PartitionFigures {
  readonly counts: PartitionCounts;
  readonly coverage: Measured;
  readonly falsePositiveRate: Measured;
}

function measurePartition(
  inventory: readonly CaseInventoryEntry[],
  outcomes: readonly CaseOutcome[],
  signed: boolean,
  emptyReason: ReasonCode,
  provenance: CaseOutcome["provenance"],
  partition: CaseInventoryEntry["partition"],
): PartitionFigures {
  const partitionInventory = inventory.filter(
    (entry) => entry.partition === partition,
  );
  const inventoryByCase = new Map<string, CaseInventoryEntry>();
  for (const entry of partitionInventory) {
    if (inventoryByCase.has(entry.caseId)) {
      throw new Error(
        `corpus report: ${partition} manifest inventory contains duplicate caseId "${entry.caseId}"`,
      );
    }
    inventoryByCase.set(entry.caseId, entry);
  }
  const mismatched = outcomes.filter((outcome) => outcome.provenance !== provenance);
  if (mismatched.length > 0) {
    throw new Error(
      `corpus report: ${provenance} measurement received ${mismatched.length} outcome(s) from another provenance partition`,
    );
  }
  const outcomeByCase = new Map<string, CaseOutcome>();
  for (const outcome of outcomes) {
    if (outcomeByCase.has(outcome.caseId)) {
      throw new Error(
        `corpus report: ${provenance} received duplicate outcome for "${outcome.caseId}"`,
      );
    }
    const entry = inventoryByCase.get(outcome.caseId);
    if (entry === undefined) {
      throw new Error(
        `corpus report: ${provenance} outcome "${outcome.caseId}" is absent from the signed manifest inventory`,
      );
    }
    if (entry.labelKind !== outcome.labelKind) {
      throw new Error(
        `corpus report: ${provenance} outcome "${outcome.caseId}" label "${outcome.labelKind}" does not match manifest label "${entry.labelKind}"`,
      );
    }
    outcomeByCase.set(outcome.caseId, outcome);
  }
  const counts: PartitionCounts = {
    totalCases: partitionInventory.length,
    defectCases: partitionInventory.filter(
      (entry) => entry.labelKind === "defect",
    ).length,
    cleanControls: partitionInventory.filter(
      (entry) => entry.labelKind === "clean-control",
    ).length,
    evaluatedCases: partitionInventory.filter(
      (entry) => outcomeByCase.get(entry.caseId)?.flagged !== null &&
        outcomeByCase.get(entry.caseId)?.flagged !== undefined,
    ).length,
  };
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
  const evaluatedDefects = partitionInventory
    .filter((entry) => entry.labelKind === "defect")
    .map((entry) => outcomeByCase.get(entry.caseId)!);
  const evaluatedControls = partitionInventory
    .filter((entry) => entry.labelKind === "clean-control")
    .map((entry) => outcomeByCase.get(entry.caseId)!);
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
  readonly seed: string;
  readonly taxonomyDigest: string;
  readonly freshnessPolicy: FreshnessPolicyBinding;
  readonly signoff: CorpusSignoff;
  readonly inventory: readonly CaseInventoryEntry[];
  readonly syntheticOutcomes: readonly SyntheticCaseOutcome[];
  readonly realDerivedOutcomes: readonly RealDerivedCaseOutcome[];
}

export function buildCorpusReport(input: ReportInput): CorpusReport {
  const inventoryDigest = computeCorpusDigest(
    input.corpusVersion,
    input.seed,
    input.taxonomyDigest,
    input.inventory,
    input.freshnessPolicy,
  );
  if (inventoryDigest !== input.corpusDigest) {
    throw new Error(
      `corpus report: manifest inventory digest ${inventoryDigest} does not match corpusDigest ${input.corpusDigest}`,
    );
  }
  const signoffValidation = signoffProblems(
    input.signoff,
    input.corpusVersion,
    input.corpusDigest,
  );
  if (signoffValidation.length > 0) {
    throw new Error(
      `corpus report: invalid signoff\n${signoffValidation.join("\n")}`,
    );
  }
  const signed = isSigned(input.signoff, input.corpusDigest);
  const synthetic = measurePartition(
    input.inventory,
    input.syntheticOutcomes,
    signed,
    "synthetic-corpus-absent",
    "synthetic-fixture",
    "synthetic",
  );
  const realDerived = measurePartition(
    input.inventory,
    input.realDerivedOutcomes,
    signed,
    "real-derived-corpus-absent",
    "real-derived-fixture",
    "real-derived",
  );
  return {
    corpusVersion: input.corpusVersion,
    corpusDigest: input.corpusDigest,
    signoffStatus: input.signoff.status ?? "(missing)",
    signed,
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

const show = (measured: Measured): string =>
  measured.value === null
    ? `null (${measured.reasonCode})`
    : `${(measured.value * 100).toFixed(2)}%`;

export function renderCorpusReport(input: ReportInput): string {
  const report = buildCorpusReport(input);
  return [
    "",
    "CORPUS MEASUREMENT - split by provenance, never blended",
    "",
    `  corpusVersion ${report.corpusVersion}`,
    `  corpusDigest  ${report.corpusDigest}`,
    `  signoff       ${report.signoffStatus}`,
    "",
    "  synthetic-fixture partition",
    `    cases ${report.synthetic.totalCases}  defects ${report.synthetic.defectCases}  clean controls ${report.synthetic.cleanControls}  evaluated ${report.synthetic.evaluatedCases}`,
    `    syntheticDefectCoverage  ${show(report.synthetic.syntheticDefectCoverage)}`,
    `    falsePositiveRate        ${show(report.synthetic.falsePositiveRate)}`,
    `    interpretable            ${report.synthetic.interpretable}`,
    "",
    "  real-derived-fixture partition",
    `    cases ${report.realDerived.totalCases}  defects ${report.realDerived.defectCases}  clean controls ${report.realDerived.cleanControls}  evaluated ${report.realDerived.evaluatedCases}`,
    `    detectionRate            ${show(report.realDerived.detectionRate)}`,
    `    falsePositiveRate        ${show(report.realDerived.falsePositiveRate)}`,
    `    interpretable            ${report.realDerived.interpretable}`,
    "",
    "  There is deliberately no blended figure. A rate measured on author-invented",
    "  synthetic defects is synthetic-defect coverage, not detection (architecture v3",
    "  §2.4, demo contract §7). No detection rate is claimed and Gate B is not claimed.",
    "",
  ].join("\n");
}
