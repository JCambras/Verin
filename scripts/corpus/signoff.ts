import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { SPEC_DIR } from "./world";

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
  readonly corpusVersion: string | null;
  readonly status: string | null;
  readonly signedBy: string | null;
  readonly signedAt: string | null;
  readonly signedDigest: string | null;
}

const FENCE = /```ya?ml\r?\n([\s\S]*?)```/;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export function parseSignoff(text: string): CorpusSignoff {
  const block = FENCE.exec(text);
  if (block === null) {
    return { corpusVersion: null, status: null, signedBy: null, signedAt: null, signedDigest: null };
  }
  const data = (parseDocument(block[1] ?? "").toJS() ?? {}) as Record<string, unknown>;
  return {
    corpusVersion: asStringOrNull(data.corpusVersion),
    status: asStringOrNull(data.status),
    signedBy: asStringOrNull(data.signedBy),
    signedAt: asStringOrNull(data.signedAt),
    signedDigest: asStringOrNull(data.signedDigest),
  };
}

export function signoffProblems(
  signoff: CorpusSignoff,
  corpusVersion: string,
  digest: string,
): string[] {
  const problems: string[] = [];
  const where = `fixtures/corpus/spec/${SIGNOFF_FILE}`;
  if (signoff.status === null) {
    problems.push(`${where}: no signoff block found - a corpus without a signoff record cannot ship`);
    return problems;
  }
  if (signoff.status !== SIGNOFF_PENDING && signoff.status !== SIGNOFF_SIGNED) {
    problems.push(`${where}: status "${signoff.status}" is not "${SIGNOFF_PENDING}" or "${SIGNOFF_SIGNED}"`);
    return problems;
  }
  if (signoff.corpusVersion !== corpusVersion) {
    problems.push(
      `${where}: corpusVersion "${signoff.corpusVersion}" does not match the generated corpus version "${corpusVersion}"`,
    );
  }
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
  if (signoff.signedBy !== CAPTAIN_SIGNING_AUTHORITY) {
    problems.push(
      `${where}: signedBy "${signoff.signedBy}" is not the closed captain authority "${CAPTAIN_SIGNING_AUTHORITY}"`,
    );
  }
  if (signoff.signedAt === null || !isCanonicalSignedAt(signoff.signedAt)) {
    problems.push(`${where}: signedAt "${signoff.signedAt}" is not a canonical ISO-8601 UTC instant`);
  }
  if (signoff.signedDigest !== digest) {
    problems.push(
      `${where}: signed-but-regenerated - signedDigest ${signoff.signedDigest} does not match the current corpusDigest ${digest}; regeneration invalidates the signature and requires re-signing`,
    );
  }
  return problems;
}

export const isSigned = (signoff: CorpusSignoff, digest: string): boolean =>
  signoff.status === SIGNOFF_SIGNED &&
  signoff.signedBy === CAPTAIN_SIGNING_AUTHORITY &&
  signoff.signedAt !== null &&
  isCanonicalSignedAt(signoff.signedAt) &&
  signoff.signedDigest === digest;

export const loadSignoff = (dir: string = SPEC_DIR): CorpusSignoff =>
  parseSignoff(readFileSync(join(dir, SIGNOFF_FILE), "utf8"));
