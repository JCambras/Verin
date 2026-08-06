/**
 * DEFECT TAXONOMY (v3 prompt 11, ADR-0039).
 *
 * A CLOSED vocabulary: a corpus case carries exactly one label - a defect class
 * from this taxonomy, or the labeled clean control. Two honesty rules are
 * machine-enforced here rather than asserted in prose:
 *
 *  1. Every class carries a citation to a document IN THIS REPOSITORY, and the
 *     cited file must exist on disk. A class cannot cite a renamed or imagined
 *     source.
 *  2. Nothing in the taxonomy claims a defect has been OBSERVED. These are
 *     classes derived from requirements and signed cases; real defect history is
 *     the deferred real-derived partition (docs/corpus-scrub-procedure.md).
 */
import { join, resolve } from "node:path";
import { z } from "zod";
import { parseStrictJson } from "./strict-json";
import { isRepositoryContainedFile, readRepositoryFile } from "./tree";
import { REPO_ROOT, SPEC_DIR, type CasesSpec } from "./world";

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase hyphenated slug");

const CitationSchema = z.strictObject({
  file: z.string().min(1),
  anchor: z.string().min(1),
});

const ClassSchema = z.strictObject({
  id: Slug,
  title: z.string().min(1),
  description: z.string().min(1),
  sourceCitation: CitationSchema,
});

export const TaxonomySchema = z.strictObject({
  specVersion: z.string().min(1),
  note: z.string().min(1),
  cleanControlLabel: ClassSchema,
  defectClasses: z.array(ClassSchema).min(1),
});
export type Taxonomy = z.infer<typeof TaxonomySchema>;

/** The one label id reserved for a case that carries no defect. */
export const CLEAN_CONTROL_ID = "clean-control";

export function taxonomyProblems(taxonomy: Taxonomy, repoRoot: string = REPO_ROOT): string[] {
  const problems: string[] = [];
  if (taxonomy.cleanControlLabel.id !== CLEAN_CONTROL_ID) {
    problems.push(`cleanControlLabel.id must be "${CLEAN_CONTROL_ID}", got "${taxonomy.cleanControlLabel.id}"`);
  }
  const seen = new Set<string>();
  for (const entry of [taxonomy.cleanControlLabel, ...taxonomy.defectClasses]) {
    if (seen.has(entry.id)) problems.push(`defectClasses: duplicate id "${entry.id}"`);
    seen.add(entry.id);
    if (
      !isRepositoryContainedFile(
        resolve(repoRoot, entry.sourceCitation.file),
        repoRoot,
      )
    ) {
      problems.push(
        `defectClasses[${entry.id}].sourceCitation.file -> "${entry.sourceCitation.file}" is not a regular file contained in this repository`,
      );
    }
  }
  if (taxonomy.defectClasses.some((entry) => entry.id === CLEAN_CONTROL_ID)) {
    problems.push(`defectClasses must not contain "${CLEAN_CONTROL_ID}" - a control is not a defect class`);
  }
  return problems;
}

export function loadTaxonomy(dir: string = SPEC_DIR, repoRoot: string = REPO_ROOT): Taxonomy {
  const taxonomy = TaxonomySchema.parse(
    parseStrictJson(
      readRepositoryFile(join(dir, "defect-taxonomy.json"), repoRoot),
      "defect-taxonomy.json",
    ),
  );
  const problems = taxonomyProblems(taxonomy, repoRoot);
  if (problems.length > 0) {
    throw new Error(`corpus defect taxonomy has ${problems.length} problem(s):\n${problems.join("\n")}`);
  }
  return taxonomy;
}

export const defectClassIds = (taxonomy: Taxonomy): Set<string> =>
  new Set(taxonomy.defectClasses.map((entry) => entry.id));

/**
 * The REVERSE completeness rule, mirroring `specReferenceProblems`'s assumption
 * check: every class in the closed taxonomy must be carried by at least one
 * labeled defect case. Without it a class nobody attacks ships silently and
 * inflates the taxonomy relative to what the corpus actually exercises - an
 * unexercised class is decoration, exactly as an unexercised structure is.
 */
export function taxonomyExerciseProblems(taxonomy: Taxonomy, cases: CasesSpec): string[] {
  const exercised = new Set(
    cases.cases.flatMap((entry) => (entry.label.kind === "defect" ? [entry.label.defectClassId] : [])),
  );
  return taxonomy.defectClasses
    .filter((entry) => !exercised.has(entry.id))
    .map(
      (entry) =>
        `defectClasses[${entry.id}] is carried by no labeled defect case - an unexercised class is decoration`,
    );
}
