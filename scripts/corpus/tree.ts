import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export interface TreeEntry {
  readonly relPath: string;
  readonly kind: "file" | "unsupported";
  readonly bytes: string | null;
}

export function readRepositoryFile(path: string, repoRoot: string): string {
  try {
    const canonicalRoot = realpathSync(repoRoot);
    const canonicalTarget = realpathSync(path);
    const pathFromRoot = relative(canonicalRoot, canonicalTarget);
    if (
      !lstatSync(path).isFile() ||
      pathFromRoot === ".." ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error();
    }
    return readFileSync(canonicalTarget, "utf8");
  } catch {
    throw new Error(
      "repository input is not a regular file contained in this repository",
    );
  }
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
