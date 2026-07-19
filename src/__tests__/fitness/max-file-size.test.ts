import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { shippedSourceFiles, REPO_ROOT } from "./_fence-utils";
import { relative, join } from "node:path";

/**
 * MAX-FILE-SIZE FENCE (ADR-0018, charter #1). A per-file ceiling stops god
 * components (retro-r7 don't-again #11: decompose reactively at ~1,000 lines,
 * never prevented). Default ceiling for shipped files; a pinned map of
 * known-larger files that ONLY SHRINKS — lower a ceiling when you split a file;
 * never raise one or add an entry without an architecture-review note.
 */
const DEFAULT_CEILING = 500;
const CEILINGS: Record<string, number> = {
  // (empty at foundation start — no file is grandfathered above the default)
};

function lines(file: string): number {
  return readFileSync(file, "utf8").split("\n").length;
}

export function detectOversizedFiles(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const rel = relative(REPO_ROOT, f).replace(/\\/g, "/");
    const ceiling = CEILINGS[rel] ?? DEFAULT_CEILING;
    const n = lines(f);
    if (n > ceiling) out.push(`${rel}: ${n} > ${ceiling}`);
  }
  return out;
}

describe("max-file-size fence", () => {
  it(`enforces: no shipped file exceeds its ceiling (default ${DEFAULT_CEILING})`, () => {
    const over = detectOversizedFiles(shippedSourceFiles());
    expect(over, `oversized files (split them):\n${over.join("\n")}`).toEqual([]);
  });

  it("the pinned CEILINGS map references only existing files (keeps the ratchet honest)", () => {
    const existing = new Set(shippedSourceFiles().map((f) => relative(REPO_ROOT, f).replace(/\\/g, "/")));
    const stale = Object.keys(CEILINGS).filter((k) => !existing.has(k));
    expect(stale, `CEILINGS entries point at missing files: ${stale.join(", ")}`).toEqual([]);
  });

  describe("detects (companion): an over-ceiling file is caught", () => {
    it("flags a real file above the default ceiling; a small file passes", () => {
      const dir = mkdtempSync(join(tmpdir(), "verin-fence-"));
      const big = join(dir, "big.ts");
      const small = join(dir, "small.ts");
      try {
        writeFileSync(big, "// x\n".repeat(DEFAULT_CEILING + 1));
        writeFileSync(small, "// x\n".repeat(10));
        expect(detectOversizedFiles([big]).length).toBe(1);
        expect(detectOversizedFiles([small])).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
