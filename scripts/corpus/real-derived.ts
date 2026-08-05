import type { Taxonomy } from "./defects";
import type { GeneratedFile } from "./generate";
import { REAL_DERIVED_DEFERRAL } from "./manifest";
import {
  loadRealDerivedDelivery,
  RealDerivedCaseSchema,
  realDerivedCaseProblems,
  realDerivedSemanticContractProblems,
  type RealDerivedDelivery,
} from "./scrub-contract";
import { REAL_DERIVED_DIR } from "./world";

export function realDerivedDeferralProblems(
  delivered: readonly string[],
  deferral: typeof REAL_DERIVED_DEFERRAL = REAL_DERIVED_DEFERRAL,
): string[] {
  if (deferral === null || delivered.length === 0) return [];
  return [
    `real-derived/: ${delivered.length} delivered file(s) present while ${deferral.status} remains active`,
  ];
}
export function realDerivedCollectionProblems(
  files: readonly GeneratedFile[],
  corpusVersion: string,
  deferral: typeof REAL_DERIVED_DEFERRAL = REAL_DERIVED_DEFERRAL,
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  let defects = 0;
  let controls = 0;
  for (const [index, file] of files.entries()) {
    const canonicalPath = /^real-derived\/RD-[0-9a-f]{16}\.json$/.test(file.relPath);
    const where = canonicalPath ? file.relPath : `real-derived delivery ${index + 1}`;
    const parsed = RealDerivedCaseSchema.safeParse(file.value);
    if (!parsed.success) continue;
    const expected = `real-derived/${parsed.data.caseId}.json`;
    if (file.relPath !== expected)
      problems.push(`${where}: canonical filename is "${expected}"`);
    if (parsed.data.corpusVersion !== corpusVersion)
      problems.push(`${where}: corpusVersion "${parsed.data.corpusVersion}" does not match active corpus "${corpusVersion}"`);
    const prior = seen.get(parsed.data.caseId);
    if (prior !== undefined)
      problems.push(`${where}: duplicate caseId "${parsed.data.caseId}" also appears in ${prior}`);
    else seen.set(parsed.data.caseId, where);
    if (parsed.data.label.kind === "defect") defects += 1;
    else controls += 1;
  }
  if (deferral === null) {
    if (defects === 0) problems.push("real-derived/: no labeled defect cases");
    if (controls === 0) problems.push("real-derived/: no labeled clean controls");
  }
  return problems;
}
export interface RealDerivedInspection {
  readonly delivery: RealDerivedDelivery;
  readonly inventoryFiles: readonly GeneratedFile[];
  readonly problems: readonly string[];
}

export function inspectRealDerivedPartition(
  taxonomy: Taxonomy,
  corpusVersion: string,
  dir: string = REAL_DERIVED_DIR,
): RealDerivedInspection {
  const delivery = loadRealDerivedDelivery(dir);
  const classes = new Set(taxonomy.defectClasses.map((entry) => entry.id));
  const problems = [
    ...delivery.problems,
    ...realDerivedDeferralProblems(delivery.deliveredPaths),
    ...realDerivedSemanticContractProblems(classes),
    ...delivery.files.flatMap((file) =>
      realDerivedCaseProblems(file.value, classes, file.relPath),
    ),
    ...realDerivedCollectionProblems(delivery.files, corpusVersion),
  ];
  return { delivery, inventoryFiles: problems.length === 0 ? delivery.files : [], problems };
}
export const realDerivedProblems = (
  taxonomy: Taxonomy,
  corpusVersion: string,
  dir: string = REAL_DERIVED_DIR,
): string[] => [...inspectRealDerivedPartition(taxonomy, corpusVersion, dir).problems];
