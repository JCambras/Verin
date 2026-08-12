import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateWorld } from "../../../scripts/world/generate";
import { WORLD_SEED, loadWorldSpec, type LoadedWorldSpec } from "../../../scripts/world/spec";
import { validateWorld } from "../../../scripts/world/validate";
import { generatorProject } from "./_corpus-determinism-fixtures";
import { bannedNondeterminismUses } from "./_corpus-nondeterminism-scan";
import { inMemoryProject, REPO_ROOT } from "./_fence-utils";

/**
 * WORLD-DETERMINISM FENCE (ADR-0057; charter #1/#4).
 *
 * The populated world is a hundred committed files. It is only trustworthy if
 * the same spec and seed produce the same bytes forever, and if the committed
 * bytes are provably the generator's rather than someone's hand edit. Five
 * properties, each of which a plausible generator fails:
 *
 *  (a) BYTE IDENTITY - two generations agree byte for byte, and the COMMITTED
 *      tree equals a fresh regeneration;
 *  (b) SEED SENSITIVITY - a different seed produces a different world. Without
 *      this, a generator that ignores the seed passes (a) trivially;
 *  (c) ORDER INDEPENDENCE - adding a household changes only that household's
 *      bytes. A stream PRNG fails this; the path-keyed derivation this
 *      generator borrows from the replay corpus is what makes it hold;
 *  (d) NO NON-DETERMINISM AT THE SOURCE - the corpus's own AST ban on clocks,
 *      randomness, locale APIs and environment reads, pointed at
 *      `scripts/world/`;
 *  (e) ENVIRONMENT INDEPENDENCE - generating under two timezones yields the
 *      identical worldDigest.
 *
 * Every check below is a NAMED PREDICATE over injected input, so the companions
 * can feed it a seed-ignoring generator, an order-dependent generator and a
 * hand-edited tree and prove each one CANNOT pass (charter #4).
 */

const WORLD_SRC = join(REPO_ROOT, "scripts", "world");
const realSpec = loadWorldSpec();

type Bytes = ReadonlyMap<string, string>;

const bytesByPath = (spec: LoadedWorldSpec, seed: string): Map<string, string> => {
  const world = generateWorld(spec, seed);
  return new Map([...world.files, world.manifest].map((file) => [file.relPath, file.bytes]));
};

const changedPaths = (left: Bytes, right: Bytes): string[] =>
  [...new Set([...left.keys(), ...right.keys()])]
    .filter((path) => left.get(path) !== right.get(path))
    .sort();

/** (b) A world that does not move when the seed moves is a world whose seed is
 * decorative. Reported as problems so the companion can inject one. */
export function seedSensitivityProblems(underSeedA: Bytes, underSeedB: Bytes): string[] {
  const moved = changedPaths(underSeedA, underSeedB);
  return moved.length > underSeedA.size / 2
    ? []
    : [`only ${moved.length} of ${underSeedA.size} generated files moved when the seed changed - the seed is not deciding the world`];
}

/** (c) Only the added household, the slot it displaced, and the manifest may
 * move when a household is added; every household present in BOTH generations
 * must be byte-identical. */
export function orderIndependenceProblems(before: Bytes, after: Bytes): string[] {
  return changedPaths(before, after)
    .filter((path) => path !== "manifest.json" && before.has(path) && after.has(path))
    .map((path) => `${path}: bytes moved because an unrelated household was added - derivation is order-dependent`);
}

/** (a) Committed bytes that are not a fresh generation's bytes. */
export function committedDriftProblems(generated: Bytes, committed: Bytes): string[] {
  const problems: string[] = [];
  for (const [path, bytes] of generated) {
    const actual = committed.get(path);
    if (actual === undefined) problems.push(`${path}: missing from the committed tree`);
    else if (actual !== bytes) problems.push(`${path}: committed bytes differ from a fresh generation`);
  }
  for (const path of committed.keys()) {
    if (!generated.has(path)) problems.push(`${path}: committed but not produced by the generator`);
  }
  return problems;
}

/** The real spec plus ONE extra hand-authored household, inserted at the FRONT
 * so every derived slot shifts - the harshest ordering change available. */
function specWithExtraFeatured(spec: LoadedWorldSpec): LoadedWorldSpec {
  const template = spec.featured[0]!;
  return {
    ...spec,
    featured: [
      { ...template, key: "aardvark-probe", displayName: "Probe Household", surname: "Aardvark", crossHouseholdLinks: [] },
      ...spec.featured,
    ],
  };
}

const digestUnderTimeZone = (timeZone: string): string => {
  const run = spawnSync(
    process.execPath,
    [join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(REPO_ROOT, "scripts", "world-generate.ts"), "--print-digest"],
    { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, TZ: timeZone, NO_COLOR: "1" } },
  );
  if (run.status !== 0) throw new Error(`world generate under TZ=${timeZone} failed: ${run.stderr}`);
  return run.stdout.trim();
};

describe("world-determinism fence", () => {
  it("(a) enforces: two generations of the same spec + seed are byte-identical", () => {
    expect(changedPaths(bytesByPath(realSpec, WORLD_SEED), bytesByPath(realSpec, WORLD_SEED))).toEqual([]);
  });

  it("(a) enforces: the COMMITTED world equals a fresh regeneration (no hand edits)", () => {
    const result = validateWorld();
    expect(result.problems, `committed world drifted:\n${result.problems.join("\n")}`).toEqual([]);
    expect(result.world.households.length, "the world must be the declared hundred households").toBe(100);
  });

  it("(b) enforces: a different seed produces a different world", () => {
    const problems = seedSensitivityProblems(bytesByPath(realSpec, WORLD_SEED), bytesByPath(realSpec, `${WORLD_SEED}/other`));
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("(c) enforces: adding a household leaves every other household's bytes untouched", () => {
    const before = bytesByPath(realSpec, WORLD_SEED);
    const after = bytesByPath(specWithExtraFeatured(realSpec), WORLD_SEED);
    // Non-vacuity: the probe really did land, and the world really is fixed-size,
    // so a derived slot really was displaced. Without this, an inert spec change
    // would make (c) pass by comparing a world to itself.
    expect(after.has("households/aardvark-probe.json")).toBe(true);
    expect(after.size).toBe(before.size);
    const problems = orderIndependenceProblems(before, after);
    expect(problems, `path-keyed derivation broken:\n${problems.join("\n")}`).toEqual([]);
  });

  it("(d) enforces: no clock, randomness, locale API or environment read under scripts/world/", () => {
    const project = generatorProject(WORLD_SRC);
    // Staleness guard: if the generator directory moved, this must FAIL rather
    // than scan nothing and report clean (charter #4).
    expect(project.getSourceFiles().length, "no generator sources scanned - the fence target went stale").toBeGreaterThan(4);
    const uses = bannedNondeterminismUses(project, WORLD_SRC);
    expect(
      uses,
      `non-determinism in the world generator:\n${uses.map((use) => `${use.file}:${use.line} ${use.api}`).join("\n")}`,
    ).toEqual([]);
  });

  it("(e) enforces: the worldDigest is identical under different host timezones", () => {
    expect(digestUnderTimeZone("UTC")).toBe(digestUnderTimeZone("Asia/Kolkata"));
  });

  describe("detects (companion): incomplete or drifted work CANNOT pass", () => {
    it("a seed-ignoring generator fails (b)", () => {
      const fixed = bytesByPath(realSpec, WORLD_SEED);
      // What a generator that never reads the seed produces: the same bytes twice.
      expect(seedSensitivityProblems(fixed, fixed)).not.toEqual([]);
    });

    it("an order-dependent generator fails (c)", () => {
      const before = bytesByPath(realSpec, WORLD_SEED);
      // What a stream PRNG produces when a household is inserted ahead of it:
      // every subsequent household's bytes shift.
      const reshuffled = new Map([...before].map(([path, bytes], index) => [path, index > 3 ? `${bytes} ` : bytes]));
      expect(orderIndependenceProblems(before, reshuffled).length).toBeGreaterThan(50);
    });

    it("a hand-edited committed file fails (a)", () => {
      const generated = bytesByPath(realSpec, WORLD_SEED);
      const victim = [...generated.keys()].find((path) => path.startsWith("households/"))!;
      const tampered = new Map(generated);
      tampered.set(victim, tampered.get(victim)!.replace("Smith", "Smyth"));
      expect(committedDriftProblems(generated, tampered)).toEqual([`${victim}: committed bytes differ from a fresh generation`]);
    });

    it("a stale committed file that the generator no longer emits fails (a)", () => {
      const generated = bytesByPath(realSpec, WORLD_SEED);
      const withStale = new Map(generated).set("households/ghost.json", "{}\n");
      expect(committedDriftProblems(generated, withStale)).toEqual(["households/ghost.json: committed but not produced by the generator"]);
    });

    it("the AST scan rejects a wall clock, Math.random, and Intl in a generator", () => {
      const offending = inMemoryProject({
        "/src/contracts/gen.ts":
          "export const a = Date.now();\n" +
          "export const b = Math.random();\n" +
          "export const c = new Intl.NumberFormat('en-US').format(1);\n",
      });
      const uses = bannedNondeterminismUses(offending, "");
      expect(uses.length, "the scan must catch every one of clock, randomness and locale").toBeGreaterThanOrEqual(3);
    });
  });
});
