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

/** Repo-relative when it can be, so a refusal names the file it tried to read. */
const describeRepositoryPath = (path: string, repoRoot: string): string => {
  const fromRoot = relative(repoRoot, path);
  return fromRoot.length === 0 || escapesRoot(fromRoot) ? path : fromRoot;
};

/** Reads a repository-contained regular file. Containment is decided on the
 * CANONICAL target, which is also the path read, so only a target that leaves
 * the repository is refused. Every refusal names the input and its reason: this
 * is the single read path for the spec, the golden fixtures, and every
 * executable authority, and the blocking `corpus` job is unusable if a rename
 * fails anonymously. */
export function readRepositoryFile(path: string, repoRoot: string): string {
  const canonicalRoot = realpathSync(repoRoot);
  const where = describeRepositoryPath(path, repoRoot);
  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync(path);
  } catch {
    throw new Error(`repository input "${where}" does not exist`);
  }
  if (escapesRoot(relative(canonicalRoot, canonicalTarget)))
    throw new Error(`repository input "${where}" resolves outside this repository`);
  if (!statSync(canonicalTarget).isFile())
    throw new Error(`repository input "${where}" is not a regular file`);
  return readFileSync(canonicalTarget, "utf8");
}

export function readTree(dir: string, prefix = ""): TreeEntry[] {
  if (!existsSync(dir)) return [];
  if (!lstatSync(dir).isDirectory()) {
    return [{ relPath: prefix === "" ? "." : prefix, kind: "unsupported", bytes: null }];
  }
  const entries: TreeEntry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
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
