import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Taxonomy } from "./defects";
import type { GeneratedFile } from "./generate";
import { REAL_DERIVED_DEFERRAL } from "./manifest";
import {
  loadRealDerivedDelivery,
  RealDerivedCaseSchema,
  realDerivedCaseProblems,
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
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const parsed = RealDerivedCaseSchema.safeParse(file.value);
    if (!parsed.success) continue;
    const expected = `real-derived/${parsed.data.caseId}.json`;
    if (file.relPath !== expected) {
      problems.push(
        `${file.relPath}: canonical filename is "${expected}"`,
      );
    }
    if (parsed.data.corpusVersion !== corpusVersion) {
      problems.push(
        `${file.relPath}: corpusVersion "${parsed.data.corpusVersion}" does not match active corpus "${corpusVersion}"`,
      );
    }
    const prior = seen.get(parsed.data.caseId);
    if (prior !== undefined) {
      problems.push(
        `${file.relPath}: duplicate caseId "${parsed.data.caseId}" also appears in ${prior}`,
      );
    } else {
      seen.set(parsed.data.caseId, file.relPath);
    }
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
    ...(!existsSync(join(dir, "README.md"))
      ? [
          "real-derived/README.md is missing - the intake contract must ship with the empty partition",
        ]
      : []),
    ...delivery.problems,
    ...realDerivedDeferralProblems(delivery.deliveredPaths),
    ...delivery.files.flatMap((file) =>
      realDerivedCaseProblems(file.value, classes, file.relPath),
    ),
    ...realDerivedCollectionProblems(delivery.files, corpusVersion),
  ];
  return {
    delivery,
    inventoryFiles: problems.length === 0 ? delivery.files : [],
    problems,
  };
}

export function realDerivedProblems(
  taxonomy: Taxonomy,
  corpusVersion: string,
  dir: string = REAL_DERIVED_DIR,
): string[] {
  return [...inspectRealDerivedPartition(taxonomy, corpusVersion, dir).problems];
}
