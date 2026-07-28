/**
 * CORPUS SIGNOFF (v3 prompt 11, ADR-0034; captain ruling `corpus-signoff-and-measurement`,
 * 2026-07-28).
 *
 * Signoff is PER CORPUS VERSION and bound to the canonical `corpusDigest`. Any
 * regeneration that changes the digest invalidates the signature and requires
 * re-signing; narrative wording outside the signed projection does not.
 *
 * Two legal shapes only - `pending-captain` (all three signature fields null) and
 * `signed` (all three populated, with `signedDigest` equal to the recomputed
 * `corpusDigest`). An agent-invented in-between state cannot pass, and AGENTS
 * NEVER SIGN: no generator writes this file, and the `corpus-provenance-split`
 * fence proves no code path under `scripts/corpus/` can originate a `signedBy`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { SPEC_DIR } from "./world";

export const SIGNOFF_PENDING = "pending-captain";
export const SIGNOFF_SIGNED = "signed";
export const SIGNOFF_FILE = "SIGNOFF.md";

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

/** Parse the single fenced YAML block. A file with no block is a malformed
 * signoff, reported as such rather than defaulted to "pending". */
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

/**
 * Signoff honesty. Injected digest/version so the companion can drive every
 * branch without touching the committed file (charter #4).
 */
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
  if (signoff.signedDigest !== digest) {
    problems.push(
      `${where}: signed-but-regenerated - signedDigest ${signoff.signedDigest} does not match the current corpusDigest ${digest}; regeneration invalidates the signature and requires re-signing`,
    );
  }
  return problems;
}

export const isSigned = (signoff: CorpusSignoff, digest: string): boolean =>
  signoff.status === SIGNOFF_SIGNED && signoff.signedDigest === digest;

export const loadSignoff = (dir: string = SPEC_DIR): CorpusSignoff =>
  parseSignoff(readFileSync(join(dir, SIGNOFF_FILE), "utf8"));
