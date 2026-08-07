import { corpusDigest } from "../../../scripts/corpus/manifest";
import type {
  RealDerivedCaseOutcome,
  ReportInput,
  SyntheticCaseOutcome,
} from "../../../scripts/corpus/report";
import {
  CAPTAIN_SIGNING_AUTHORITY,
  type CorpusSignoff,
} from "../../../scripts/corpus/signoff";
import { real } from "./_corpus-world";

export const reportExportProblems = (names: readonly string[]): string[] =>
  names.filter((name) => name !== "renderCorpusReport");

export const outcomes = (
  defects: number,
  controls: number,
  detected: boolean | null,
): SyntheticCaseOutcome[] => [
  ...Array.from({ length: defects }, (_, i) => ({
    caseId: `d${i}`,
    attributedDefectClassIds:
      detected === null ? null : detected ? ["test-defect"] : [],
    provenance: "synthetic-fixture" as const,
  })),
  ...Array.from({ length: controls }, (_, i) => ({
    caseId: `c${i}`,
    attributedDefectClassIds:
      detected === null ? null : detected ? ["test-defect"] : [],
    provenance: "synthetic-fixture" as const,
  })),
];

export const inventoryOf = (
  synthetic: readonly SyntheticCaseOutcome[],
  realDerived: readonly RealDerivedCaseOutcome[] = [],
) => [
  ...synthetic.map((outcome) => ({
    caseId: outcome.caseId,
    file: `synthetic/${outcome.caseId}.json`,
    digest: outcome.caseId,
    partition: "synthetic" as const,
    labelKind: outcome.caseId.startsWith("d") ? "defect" as const : "clean-control" as const,
    labelId:
      outcome.caseId.startsWith("d") ? "test-defect" : "clean-control",
  })),
  ...realDerived.map((outcome) => ({
    caseId: outcome.caseId,
    file: `real-derived/${outcome.caseId}.json`,
    digest: outcome.caseId,
    partition: "real-derived" as const,
    labelKind: outcome.caseId === "RD-c" ? "clean-control" as const : "defect" as const,
    labelId:
      outcome.caseId === "RD-c" ? "clean-control" : "test-defect",
  })),
];

export const signedSignoff = (
  corpusVersion = "x",
  corpusDigest = "y",
): CorpusSignoff => ({
  corpusVersion,
  status: "signed",
  signedBy: CAPTAIN_SIGNING_AUTHORITY,
  signedAt: "2026-07-28T12:00:00.000Z",
  signedDigest: corpusDigest,
});

export const reportInput = (
  syntheticOutcomes: readonly SyntheticCaseOutcome[],
  realDerivedOutcomes: readonly RealDerivedCaseOutcome[] = [],
  overrides: Partial<ReportInput> = {},
): ReportInput => {
  const corpusVersion = overrides.corpusVersion ?? "x";
  const seed = overrides.seed ?? "test-seed";
  const taxonomyDigest = overrides.taxonomyDigest ?? "test-taxonomy-digest";
  // The already-resolved binding, not a rebuild: `currentAuthorityBindings()`
  // re-reads and re-hashes ~40 files, and every report test called it again for
  // a value it only ever feeds to a digest as an opaque input.
  const authority = overrides.authority ?? real.authority;
  const inventory =
    overrides.inventory ??
    inventoryOf(syntheticOutcomes, realDerivedOutcomes);
  const digest =
    overrides.corpusDigest ??
    corpusDigest(corpusVersion, seed, taxonomyDigest, inventory, authority);
  return {
    corpusVersion,
    corpusDigest: digest,
    seed,
    taxonomyDigest,
    authority,
    signoff:
      overrides.signoff ?? signedSignoff(corpusVersion, digest),
    inventory,
    syntheticOutcomes:
      overrides.syntheticOutcomes ?? syntheticOutcomes,
    realDerivedOutcomes:
      overrides.realDerivedOutcomes ?? realDerivedOutcomes,
  };
};
