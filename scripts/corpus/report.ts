import { corpusDigest as computeCorpusDigest, type CaseInventoryEntry, type FreshnessPolicyBinding } from "./manifest";
import { isSigned, signoffProblems, type CorpusSignoff } from "./signoff";

export type ReasonCode =
  | "corpus-signoff-pending"
  | "real-derived-corpus-absent"
  | "synthetic-corpus-absent"
  | "detector-outcomes-absent"
  | "detector-outcomes-incomplete"
  | "no-labeled-defects"
  | "no-clean-controls";

interface Measured {
  readonly value: number | null;
  readonly reasonCode: ReasonCode | null;
}

interface CaseOutcomeBase {
  readonly caseId: string;
  readonly attributedDefectClassIds: readonly string[] | null;
}

export interface SyntheticCaseOutcome extends CaseOutcomeBase {
  readonly provenance: "synthetic-fixture";
}

export interface RealDerivedCaseOutcome extends CaseOutcomeBase {
  readonly provenance: "real-derived-fixture";
}

type CaseOutcome = SyntheticCaseOutcome | RealDerivedCaseOutcome;

const withheld = (reasonCode: ReasonCode): Measured => ({ value: null, reasonCode });
const withheldPartition = <T>(counts: T, reason: ReasonCode) => ({
  counts, coverage: withheld(reason), falsePositiveRate: withheld(reason),
});

const rateOf = (numerator: number, denominator: number): number =>
  Math.round((numerator / denominator) * 10_000) / 10_000;

function measurePartition(
  inventory: readonly CaseInventoryEntry[],
  outcomes: readonly CaseOutcome[],
  signed: boolean,
  emptyReason: ReasonCode,
  provenance: CaseOutcome["provenance"],
  partition: CaseInventoryEntry["partition"],
) {
  const partitionInventory = inventory.filter((entry) => entry.partition === partition);
  const knownDefectClasses = new Set(
    inventory.filter((entry) => entry.labelKind === "defect").map((entry) => entry.labelId),
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
    const attributions = outcome.attributedDefectClassIds;
    if (
      attributions !== null &&
      new Set(attributions).size !== attributions.length
    ) {
      throw new Error(
        `corpus report: ${provenance} outcome "${outcome.caseId}" contains duplicate defect attribution`,
      );
    }
    const unknown = attributions?.find((id) => !knownDefectClasses.has(id));
    if (unknown !== undefined) {
      throw new Error(
        `corpus report: ${provenance} outcome "${outcome.caseId}" attributes unknown defect class`,
      );
    }
    if (
      entry.labelKind === "defect" &&
      attributions !== null &&
      !(
        attributions.length === 0 ||
        (attributions.length === 1 &&
          attributions[0] === entry.labelId)
      )
    ) {
      throw new Error(
        `corpus report: ${provenance} outcome "${outcome.caseId}" contradicts its signed defect label; attribution must be empty or the exact signed defect singleton`,
      );
    }
    outcomeByCase.set(outcome.caseId, outcome);
  }
  const counts = {
    totalCases: partitionInventory.length,
    defectCases: partitionInventory.filter((entry) => entry.labelKind === "defect").length,
    cleanControls: partitionInventory.filter((entry) => entry.labelKind === "clean-control").length,
    evaluatedCases: partitionInventory.filter(
      (entry) =>
        outcomeByCase.get(entry.caseId)?.attributedDefectClassIds !== null &&
        outcomeByCase.get(entry.caseId)?.attributedDefectClassIds !== undefined,
    ).length,
  };
  if (!signed) {
    return withheldPartition(counts, "corpus-signoff-pending");
  }
  if (counts.totalCases === 0) {
    return withheldPartition(counts, emptyReason);
  }
  if (counts.evaluatedCases === 0) {
    return withheldPartition(counts, "detector-outcomes-absent");
  }
  if (counts.evaluatedCases !== counts.totalCases) {
    return withheldPartition(counts, "detector-outcomes-incomplete");
  }
  const measured = (
    labelKind: CaseInventoryEntry["labelKind"],
    absentReason: ReasonCode,
    detected: (entry: CaseInventoryEntry) => boolean,
  ): Measured => {
    const cases = partitionInventory.filter((entry) => entry.labelKind === labelKind);
    return cases.length === 0
      ? withheld(absentReason)
      : { value: rateOf(cases.filter(detected).length, cases.length), reasonCode: null };
  };
  return {
    counts,
    coverage: measured("defect", "no-labeled-defects", (entry) =>
      outcomeByCase.get(entry.caseId)!.attributedDefectClassIds!.includes(entry.labelId),
    ),
    falsePositiveRate: measured("clean-control", "no-clean-controls", (entry) =>
      outcomeByCase.get(entry.caseId)!.attributedDefectClassIds!.length > 0,
    ),
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

function buildCorpusReport(input: ReportInput) {
  const inventoryDigest = computeCorpusDigest(input.corpusVersion, input.seed, input.taxonomyDigest, input.inventory, input.freshnessPolicy);
  if (inventoryDigest !== input.corpusDigest) {
    throw new Error(
      `corpus report: manifest inventory digest ${inventoryDigest} does not match corpusDigest ${input.corpusDigest}`,
    );
  }
  const signoffValidation = signoffProblems(input.signoff, input.corpusVersion, input.corpusDigest);
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
