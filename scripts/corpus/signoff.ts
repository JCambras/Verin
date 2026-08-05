import { join } from "node:path";
import { isAlias, isNode, parseDocument, visit } from "yaml";
import { readRepositoryFile } from "./tree";
import { REPO_ROOT, SPEC_DIR } from "./world";

export const SIGNOFF_PENDING = "pending-captain";
export const SIGNOFF_SIGNED = "signed";
export const SIGNOFF_FILE = "SIGNOFF.md";
export const CAPTAIN_SIGNING_AUTHORITY = "captain";
const CANONICAL_SIGNED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isCanonicalSignedAt = (value: string): boolean => {
  if (!CANONICAL_SIGNED_AT.test(value)) return false;
  const instant = new Date(value);
  return !Number.isNaN(instant.valueOf()) && instant.toISOString() === value;
};
export interface CorpusSignoff {
  readonly corpusVersion: string | null; readonly status: string | null;
  readonly signedBy: string | null; readonly signedAt: string | null;
  readonly signedDigest: string | null;
  readonly parseProblems?: readonly string[];
}
const FENCE = /```ya?ml\r?\n([\s\S]*?)```/g;
const SIGNOFF_KEYS = ["corpusVersion", "status", "signedBy", "signedAt", "signedDigest"] as const;
const emptySignoff = (parseProblems: readonly string[] = []): CorpusSignoff => ({
  corpusVersion: null, status: null, signedBy: null, signedAt: null, signedDigest: null,
  parseProblems,
});
const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
export function parseSignoff(text: string): CorpusSignoff {
  const blocks = [...text.matchAll(FENCE)];
  if (blocks.length !== 1) return emptySignoff([
    `expected exactly one YAML signoff block, found ${blocks.length}`,
  ]);
  const document = parseDocument(blocks[0]?.[1] ?? "", { strict: true, uniqueKeys: true });
  const parseProblems = [
    ...document.errors.map(() => "signoff YAML parse error"),
    ...document.warnings.map(() => "signoff YAML warning"),
  ];
  let hasAlias = false;
  let hasTag = false;
  visit(document, (_key, node) => {
    if (isAlias(node)) hasAlias = true;
    if (isNode(node) && node.tag !== undefined) hasTag = true;
  });
  if (hasAlias) parseProblems.push("signoff YAML aliases are forbidden");
  if (hasTag) parseProblems.push("signoff YAML tags are forbidden");
  if (parseProblems.length > 0) return emptySignoff(parseProblems);
  const data = document.toJS({ maxAliasCount: 0 }) as unknown;
  if (data === null || Array.isArray(data) || typeof data !== "object") {
    parseProblems.push("signoff YAML root must be a mapping");
    return emptySignoff(parseProblems);
  }
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !SIGNOFF_KEYS.includes(key as typeof SIGNOFF_KEYS[number]))) {
    parseProblems.push("signoff YAML contains unexpected top-level keys");
  }
  if (SIGNOFF_KEYS.some((key) => !keys.includes(key))) {
    parseProblems.push("signoff YAML is missing required top-level keys");
  }
  if (Object.values(record).some((value) => typeof value !== "string" && value !== null)) {
    parseProblems.push("signoff YAML fields must be strings or null");
  }
  if (parseProblems.length > 0) return emptySignoff(parseProblems);
  return {
    corpusVersion: asStringOrNull(record.corpusVersion), status: asStringOrNull(record.status),
    signedBy: asStringOrNull(record.signedBy), signedAt: asStringOrNull(record.signedAt),
    signedDigest: asStringOrNull(record.signedDigest), parseProblems: [],
  };
}
export function signoffProblems(
  signoff: CorpusSignoff,
  corpusVersion: string,
  digest: string,
): string[] {
  const problems: string[] = [];
  const where = `fixtures/corpus/spec/${SIGNOFF_FILE}`;
  for (const problem of signoff.parseProblems ?? []) problems.push(`${where}: ${problem}`);
  if (problems.length > 0) return problems;
  if (signoff.status === null) {
    problems.push(`${where}: no signoff block found - a corpus without a signoff record cannot ship`);
    return problems;
  }
  if (signoff.status !== SIGNOFF_PENDING && signoff.status !== SIGNOFF_SIGNED) {
    problems.push(`${where}: status "${signoff.status}" is not "${SIGNOFF_PENDING}" or "${SIGNOFF_SIGNED}"`);
    return problems;
  }
  if (signoff.corpusVersion !== corpusVersion)
    problems.push(`${where}: corpusVersion "${signoff.corpusVersion}" does not match the generated corpus version "${corpusVersion}"`);
  const populated = [signoff.signedBy, signoff.signedAt, signoff.signedDigest].filter((v) => v !== null).length;
  if (signoff.status === SIGNOFF_PENDING) {
    if (populated > 0) {
      problems.push(`${where}: status is "${SIGNOFF_PENDING}" but signedBy/signedAt/signedDigest are partly populated`);
    }
    return problems;
  }
  if (populated < 3) {
    problems.push(`${where}: status is "${SIGNOFF_SIGNED}" but signedBy/signedAt/signedDigest are not all populated`);
    return problems;
  }
  if (signoff.signedBy !== CAPTAIN_SIGNING_AUTHORITY)
    problems.push(`${where}: signedBy "${signoff.signedBy}" is not the closed captain authority "${CAPTAIN_SIGNING_AUTHORITY}"`);
  if (signoff.signedAt === null || !isCanonicalSignedAt(signoff.signedAt)) {
    problems.push(`${where}: signedAt "${signoff.signedAt}" is not a canonical ISO-8601 UTC instant`);
  }
  if (signoff.signedDigest !== digest)
    problems.push(`${where}: signed-but-regenerated - signedDigest ${signoff.signedDigest} does not match the current corpusDigest ${digest}; regeneration invalidates the signature and requires re-signing`);
  return problems;
}
export const isSigned = (signoff: CorpusSignoff, digest: string): boolean =>
  signoff.status === SIGNOFF_SIGNED &&
  signoff.signedBy === CAPTAIN_SIGNING_AUTHORITY &&
  signoff.signedAt !== null &&
  isCanonicalSignedAt(signoff.signedAt) &&
  signoff.signedDigest === digest;
export const loadSignoff = (dir: string = SPEC_DIR): CorpusSignoff =>
  parseSignoff(readRepositoryFile(join(dir, SIGNOFF_FILE), REPO_ROOT));
