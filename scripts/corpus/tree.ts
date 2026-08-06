import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export interface TreeEntry {
  readonly relPath: string;
  readonly kind: "file" | "unsupported";
  readonly bytes: string | null;
}

const escapesRoot = (fromRoot: string): boolean =>
  fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);

/** Repo-relative when it can be, so a refusal names the file it tried to read.
 * BOTH spellings of the root are offered - the caller's and its canonical form -
 * because a repository reached through a symlinked root would otherwise name
 * every input by absolute path, the case naming exists to fix. */
const describeRepositoryPath = (path: string, ...roots: readonly string[]): string =>
  roots
    .map((root) => relative(root, path))
    .find((fromRoot) => fromRoot.length > 0 && !escapesRoot(fromRoot)) ?? path;

type RepositoryFile = { readonly target: string } | { readonly refusal: string };

/** The ONE containment decision, so the reader and the reporter below cannot
 * drift apart. Containment is decided on the CANONICAL target, which is also the
 * path handed back, so only a target that leaves the repository is refused. Every
 * refusal names its input and reason - an unresolvable ROOT included: this is the
 * single read path for the spec, the golden fixtures, and every executable
 * authority, and the blocking `corpus` job is unusable if a rename fails
 * anonymously. */
const resolveRepositoryFile = (path: string, repoRoot: string): RepositoryFile => {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(repoRoot);
  } catch {
    return { refusal: `repository root "${repoRoot}" does not exist` };
  }
  const where = describeRepositoryPath(path, repoRoot, canonicalRoot);
  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync(path);
  } catch {
    return { refusal: `repository input "${where}" does not exist` };
  }
  if (escapesRoot(relative(canonicalRoot, canonicalTarget)))
    return { refusal: `repository input "${where}" resolves outside this repository` };
  let regularFile: boolean;
  try {
    regularFile = statSync(canonicalTarget).isFile();
  } catch {
    return { refusal: `repository input "${where}" cannot be inspected` };
  }
  if (!regularFile) return { refusal: `repository input "${where}" is not a regular file` };
  return { target: canonicalTarget };
};

/** Reads a repository-contained regular file, refusing anything else by name. */
export function readRepositoryFile(path: string, repoRoot: string): string {
  const resolved = resolveRepositoryFile(path, repoRoot);
  if ("refusal" in resolved) throw new Error(resolved.refusal);
  return readFileSync(resolved.target, "utf8");
}

/** The same decision for a caller that must REPORT a bad path rather than abort
 * (a detector over injected input never crashes). A second hand-rolled copy of a
 * containment predicate is a second place to weaken it. */
export const isRepositoryContainedFile = (path: string, repoRoot: string): boolean =>
  !("refusal" in resolveRepositoryFile(path, repoRoot));

/** Names the repository's own `.gitignore` refuses to track. Every reader of this
 * walk asks what the COMMITTED tree holds - the corpus byte-compare, the exact
 * root inventory, the spec digest coverage - and a platform dropping is neither
 * committed nor committable, so surfacing one turns opening a directory in a file
 * browser into a blocking-gate failure. Stated exactly here rather than guessed
 * per reader, and held against `.gitignore` by the corpus-provenance-split fence
 * so this list can never grant an exemption git does not. */
export const UNTRACKABLE_ENTRY_NAMES = [".DS_Store"] as const;

const untrackableNames: ReadonlySet<string> = new Set(UNTRACKABLE_ENTRY_NAMES);

export function readTree(dir: string, prefix = ""): TreeEntry[] {
  if (!existsSync(dir)) return [];
  if (!lstatSync(dir).isDirectory()) {
    return [{ relPath: prefix === "" ? "." : prefix, kind: "unsupported", bytes: null }];
  }
  const entries: TreeEntry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    if (untrackableNames.has(entry.name)) continue;
    const relPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...readTree(fullPath, relPath));
    } else if (entry.isFile()) {
      entries.push({ relPath, kind: "file", bytes: readFileSync(fullPath, "utf8") });
    } else {
      entries.push({ relPath, kind: "unsupported", bytes: null });
    }
  }
  return entries;
}
