import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  shippedSourceFiles,
  REPO_ROOT,
  toolingSourceFiles,
} from "./_fence-utils";
import { relative, join } from "node:path";

/**
 * MAX-FILE-SIZE FENCE (ADR-0018, charter #1). A per-file ceiling stops god
 * components (retro-r7 don't-again #11: decompose reactively at ~1,000 lines,
 * never prevented). Default ceiling for shipped files; a pinned map of
 * known-larger files that ONLY SHRINKS — lower a ceiling when you split a file;
 * never raise one or add an entry without an architecture-review note.
 *
 * EXTENDED to `scripts/**` by ADR-0034 (v3 prompt 11): build-time tooling was
 * invisible to this fence, so a 2,000-line generator could have landed there
 * unnoticed. Tooling is held to the same per-file ceiling as shipped source.
 */
const DEFAULT_CEILING = 500;
const CEILINGS: Record<string, number> = {
  // ADR-0048/ADR-0049 (the architecture-review note this map requires). The ledger DDL
  // already lives in its own module; what remains is the baseline schema and the runner
  // that applies it, and separating those would put a migration's DDL in a different
  // file from the code proving its ledger prefix. The 12 restored lines of sharp-edge
  // prose are documentation this file is POINTED AT for, so the pin is the honest cost.
  // MEASURED 510 at ADR-0049: the pin carries bounded correction headroom for the same
  // reason the layer ceiling does — a ceiling that cannot absorb a correction just
  // converts review findings into documentation deletions, which is how this file's
  // prose was deleted once already.
  "src/infrastructure/store/migrations.ts": 560,
  // ADR-0050 (the architecture-review note for this entry). The ledger's sole write
  // chokepoint sat one line under the default, and the previous round bought that line by
  // folding a six-line call onto one - the same "pay the ceiling in formatting" move
  // ADR-0048 and ADR-0049 exist to end. The natural seams (bindings, sources, projections,
  // verification) are already extracted into siblings, so the remaining content is the
  // append transaction itself. MEASURED 504 with the call restored to its readable form.
  "src/infrastructure/ledger/ledger-store.ts": 550,
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

/** Shipped source PLUS build-time tooling (ADR-0034). */
export function ceilingScopedFiles(): string[] {
  return [...shippedSourceFiles(), ...toolingSourceFiles()];
}

describe("max-file-size fence", () => {
  it(`enforces: no shipped or tooling file exceeds its ceiling (default ${DEFAULT_CEILING})`, () => {
    const over = detectOversizedFiles(ceilingScopedFiles());
    expect(over, `oversized files (split them):\n${over.join("\n")}`).toEqual([]);
  });

  it("enforces: the walk covers scripts/ too, so tooling cannot grow unmeasured", () => {
    const scoped = ceilingScopedFiles().map((f) => relative(REPO_ROOT, f).replace(/\\/g, "/"));
    expect(scoped.filter((f) => f.startsWith("scripts/")).length).toBeGreaterThanOrEqual(10);
  });

  it("the pinned CEILINGS map references only existing files (keeps the ratchet honest)", () => {
    const existing = new Set(ceilingScopedFiles().map((f) => relative(REPO_ROOT, f).replace(/\\/g, "/")));
    const stale = Object.keys(CEILINGS).filter((k) => !existing.has(k));
    expect(stale, `CEILINGS entries point at missing files: ${stale.join(", ")}`).toEqual([]);
  });

  describe("detects (companion): an over-ceiling file is caught", () => {
    it("flags a real file above the default ceiling; a small file passes", () => {
      const dir = mkdtempSync(join(tmpdir(), "verin-fence-"));
      const big = join(dir, "big.mjs");
      const small = join(dir, "small.ts");
      try {
        writeFileSync(big, "// x\n".repeat(DEFAULT_CEILING + 1));
        writeFileSync(small, "// x\n".repeat(10));
        const discovered = toolingSourceFiles(dir);
        expect(discovered).toEqual(expect.arrayContaining([big, small]));
        expect(detectOversizedFiles(discovered).length).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
