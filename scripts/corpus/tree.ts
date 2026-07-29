import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface TreeEntry {
  readonly relPath: string;
  readonly kind: "file" | "unsupported";
  readonly bytes: string | null;
}

export function readTree(dir: string, prefix = ""): TreeEntry[] {
  if (!existsSync(dir)) return [];
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
