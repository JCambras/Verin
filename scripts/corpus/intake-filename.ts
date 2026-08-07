import { join } from "node:path";
import { evidenceKindVocabularyProblems } from "./real-derived-policy";
import { parseStrictJson } from "./strict-json";
import { readRepositoryFile } from "./tree";
import { REPO_ROOT, SPEC_DIR } from "./world";

/**
 * THE CANONICAL REAL-DERIVED INTAKE NAMING AUTHORITY.
 *
 * A delivered case lives at its own case id, so the filename, the predicate the
 * loader tests and the refusal an operator reads are all READ FROM the delivered
 * schema's `caseId` pattern - never restated beside it, where loader, collection
 * checker and message could disagree while every gate still reports green. The
 * rule lives in its own module because the schema that mints it and the checks
 * that consume it sit in different files, and a rule stated where one consumer
 * happens to live is a rule the next consumer copies.
 */
export const schemaFromSpec = (name: string): Record<string, unknown> =>
  parseStrictJson(
    readRepositoryFile(join(SPEC_DIR, name), REPO_ROOT),
    name,
  ) as Record<string, unknown>;

export const CASE_SCHEMA_FILE = "real-derived-case-schema.json";
export const caseJsonSchema = schemaFromSpec(CASE_SCHEMA_FILE);

const INTAKE_PREFIX = "real-derived/";

/** ANCHORING IS THE RULE, NOT A HABIT OF THE DEFAULT PATTERN. Only
 * `intakeCaseIdPattern` mints a bound pattern, and it refuses anything that is
 * not whole-string - but the consumers below take a `RegExp` from any caller,
 * and an unanchored one corrupts BOTH: `.test()` would match a substring
 * (widening what intake accepts) and stripping the anchors for display would
 * chop real pattern characters off each end, printing a name intake rejects. So
 * the invariant is asserted where it is relied on, and an unanchored pattern is
 * refused by name rather than silently reinterpreted. */
const isWholeStringRule = (source: string): boolean =>
  source.startsWith("^") && source.endsWith("$");

const assertWholeStringRule = (pattern: RegExp): void => {
  if (!isWholeStringRule(pattern.source)) {
    throw new Error(
      `unanchored intake case-id pattern /${pattern.source}/: the canonical intake rule is ` +
        `whole-string (^...$) and is read from ${CASE_SCHEMA_FILE} properties/caseId`,
    );
  }
};

/** The case-id SHAPE a bound rule names - the whole-string anchors stripped for
 * display, never for matching. */
const caseIdShape = (pattern: RegExp): string => {
  assertWholeStringRule(pattern);
  return pattern.source.slice("^".length, -"$".length);
};

/** A missing, unanchored or unparseable pattern mints NO rule: no path is
 * canonical and the gap is NAMED, never widening what intake accepts. */
export const intakeCaseIdPattern = (schema: unknown): RegExp | null => {
  const declared = (schema as { properties?: Record<string, { pattern?: unknown }> } | null)
    ?.properties?.caseId?.pattern;
  if (typeof declared !== "string" || !isWholeStringRule(declared)) return null;
  try { return new RegExp(declared); } catch { return null; }
};
const CASE_ID_PATTERN = intakeCaseIdPattern(caseJsonSchema);

export const canonicalIntakePath = (caseId: string): string => `${INTAKE_PREFIX}${caseId}.json`;
export const canonicalIntakeFilenameRule = (pattern = CASE_ID_PATTERN): string =>
  `filename must be ${canonicalIntakePath(pattern === null ? `<${CASE_SCHEMA_FILE} properties/caseId>` : caseIdShape(pattern))}`;

export const isCanonicalIntakePath = (relPath: string, pattern = CASE_ID_PATTERN): boolean => {
  if (pattern === null) return false;
  assertWholeStringRule(pattern);
  return relPath.startsWith(INTAKE_PREFIX) && relPath.endsWith(".json") &&
    pattern.test(relPath.slice(INTAKE_PREFIX.length, -".json".length));
};

/** The intake vocabulary the delivered schema admits, checked against the
 * executable freshness authority rather than assumed equal to it, plus the
 * binding the filename rule itself depends on. */
export const caseSchemaVocabularyProblems = (): string[] => [
  ...evidenceKindVocabularyProblems(caseJsonSchema, CASE_SCHEMA_FILE),
  ...(CASE_ID_PATTERN === null
    ? [`${CASE_SCHEMA_FILE}: properties/caseId declares no anchored pattern to bind the canonical intake filename to`]
    : []),
];
