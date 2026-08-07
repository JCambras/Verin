import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import { buildInventory, corpusDigest, taxonomySemanticDigest } from "../../../scripts/corpus/manifest";
import { inspectRealDerivedPartition } from "../../../scripts/corpus/real-derived";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import { committedBytesProblems, readCommittedCorpus } from "../../../scripts/corpus/validate";
import { type LoadedSpec } from "../../../scripts/corpus/world";
import {
  bytesByPath,
  changedPaths,
  file,
  generatorProject,
  realSpec,
  realTaxonomy,
  seedSensitivityProblems,
  specWithInsertedHousehold,
} from "./_corpus-determinism-fixtures";
import { bannedNondeterminismUses } from "./_corpus-nondeterminism-scan";
import {
  inMemoryProject,
  REPO_ROOT,
} from "./_fence-utils";

/**
 * CORPUS-DETERMINISM FENCE (v3 prompt 11, ADR-0052; charter #1/#4).
 *
 * The corpus is only usable as replay input if the same spec and seed produce
 * the same bytes forever. Five properties, each of which a plausible generator
 * fails:
 *
 *  (a) BYTE IDENTITY - two generations agree byte for byte, and the COMMITTED
 *      tree equals a fresh regeneration (so a hand edit to a generated file
 *      fails the build - this is what generated-file ownership actually means);
 *  (b) SEED SENSITIVITY - a different seed produces a different corpus. Without
 *      this, a generator that ignores the seed entirely passes (a);
 *  (c) ORDER INDEPENDENCE - inserting a household in the MIDDLE of the spec
 *      changes only that household's cases. A stream PRNG fails this; the
 *      path-keyed derivation in scripts/corpus/seed.ts is what makes it hold;
 *  (d) NO NON-DETERMINISM AT THE SOURCE - an AST ban on clocks, randomness,
 *      locale APIs and environment reads anywhere under `scripts/corpus/`;
 *  (e) ENVIRONMENT INDEPENDENCE - generating under TZ=UTC and TZ=Asia/Kolkata
 *      yields the identical corpusDigest.
 *
 * The detectors are pure functions over injected input, so the companion can
 * feed violating generators and corpora and prove they CANNOT pass (charter #4).
 */

describe("corpus-determinism fence", () => {
  it("(a) enforces: two generations of the same spec + seed are byte-identical", () => {
    expect(changedPaths(bytesByPath(realSpec, CORPUS_SEED), bytesByPath(realSpec, CORPUS_SEED))).toEqual([]);
  });

  it("(a) enforces: the COMMITTED corpus equals a fresh regeneration (no hand edits)", () => {
    const generated = generateSyntheticCases(realSpec, CORPUS_SEED);
    const problems = committedBytesProblems(generated, readCommittedCorpus().filter((f) => f.relPath !== "manifest.json"));
    expect(problems, `committed corpus drifted:\n${problems.join("\n")}`).toEqual([]);
    expect(generated.length).toBeGreaterThan(0);
  });

  it("(b) enforces: a DIFFERENT seed produces a different corpus", () => {
    const problems = seedSensitivityProblems(
      bytesByPath(realSpec, CORPUS_SEED),
      bytesByPath(realSpec, "verin-corpus/other-seed"),
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("(c) enforces: inserting a PREFIX-COLLIDING household mid-spec changes ONLY that household's cases", () => {
    const before = bytesByPath(realSpec, CORPUS_SEED);
    const after = bytesByPath(specWithInsertedHousehold(realSpec), CORPUS_SEED);
    expect(changedPaths(before, after)).toEqual(["synthetic/CS-smiths-west-control.json"]);
  });

  it("(c) enforces: reordering assumptions does not change emitted bytes", () => {
    const reordered: LoadedSpec = {
      ...realSpec,
      cases: {
        ...realSpec.cases,
        assumptions: [...realSpec.cases.assumptions].reverse(),
      },
    };
    expect(
      changedPaths(
        bytesByPath(realSpec, CORPUS_SEED),
        bytesByPath(reordered, CORPUS_SEED),
      ),
    ).toEqual([]);
  });

  it("(d) enforces: no clock, randomness, locale API, or env read under scripts/corpus/", () => {
    const uses = bannedNondeterminismUses(generatorProject(), REPO_ROOT);
    expect(
      uses,
      `non-deterministic APIs in the generator:\n${uses.map((u) => `${u.file}:${u.line} ${u.api}`).join("\n")}`,
    ).toEqual([]);
  });

  it("(d) enforces: the ban scans a non-empty generator tree (never vacuously green)", () => {
    expect(generatorProject().getSourceFiles().length).toBeGreaterThanOrEqual(8);
  });

  it(
    "(e) enforces: generation under TZ=UTC and TZ=Asia/Kolkata yields the same corpusDigest",
    () => {
      const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
      if (!existsSync(tsx)) throw new Error("tsx binary missing - install dependencies before running this fence");
      const digestUnder = (TZ: string): string => {
        const run = spawnSync(tsx, [join(REPO_ROOT, "scripts", "corpus-generate.ts"), "--print-digest"], {
          cwd: REPO_ROOT,
          env: { ...process.env, TZ },
          encoding: "utf8",
        });
        if (run.status !== 0) throw new Error(`generation under TZ=${TZ} failed: ${run.stderr}`);
        return run.stdout.trim();
      };
      // The expectation must be over the SAME inventory the runner builds -
      // both partitions. Building it from the synthetic partition alone agrees
      // only while real-derived is empty, and the day it is populated this
      // fence would report a time-zone failure for an inventory mismatch.
      const realDerived = inspectRealDerivedPartition(
        realTaxonomy,
        realSpec.world.corpusVersion,
      );
      expect(realDerived.problems).toEqual([]);
      const inProcess = corpusDigest(
        realSpec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(realTaxonomy),
        [
          ...buildInventory(generateSyntheticCases(realSpec, CORPUS_SEED)),
          ...buildInventory(realDerived.inventoryFiles, "real-derived"),
        ],
      );
      expect(digestUnder("UTC")).toBe(inProcess);
      expect(digestUnder("Asia/Kolkata")).toBe(inProcess);
    },
    120_000,
  );
});

describe("detects (companion): a non-deterministic generator or a drifted corpus CANNOT pass", () => {

  it("flags Math.random, Date.now, an argless new Date(), and randomUUID", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "export const a = Math.random();\nexport const b = Date.now();\nexport const c = new Date();\nexport const d = crypto.randomUUID();\n",
        ),
      ),
    );
    expect(uses.map((u) => u.api).sort()).toEqual(["Date.now", "Math.random", "new Date() (argless)", "randomUUID"]);
  });

  it("flags locale APIs and Intl but ALLOWS new Date(<explicit iso>)", () => {
    const banned = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'export const a = new Date(0).toLocaleDateString();\nexport const b = "x".localeCompare("y");\nexport const c = new Intl.DateTimeFormat("en-US");\n',
        ),
      ),
    );
    expect(banned.map((u) => u.api).sort()).toEqual(["Intl", "localeCompare", "toLocaleDateString"]);
    expect(
      bannedNondeterminismUses(inMemoryProject(file('export const t = new Date("2026-07-26T13:30:00.000Z").getTime();\n'))),
    ).toEqual([]);
  });

  it("flags a process.env read inside the generator", () => {
    const uses = bannedNondeterminismUses(inMemoryProject(file('export const s = process.env.SEED ?? "x";\n')));
    expect(uses.some((u) => u.api === "process.env")).toBe(true);
  });

  it("flags dynamic code construction", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'const run = eval; void run("Date.now()");\nconst build = globalThis.Function; void new build("return process.env.SEED");\n',
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["eval", "Function"]),
    );
  });

  it("flags nondeterministic APIs through globalThis and global roots", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "export const a = globalThis.Date.now();\nconst root = globalThis;\nconst { crypto: rng, process: runtime } = root;\nvoid rng.randomUUID();\nvoid runtime.env.SEED;\nvoid global.performance.now();\nvoid global['Math'].random();\n",
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set([
        "Date.now",
        "randomUUID",
        "process.env",
        "performance.now",
        "Math.random",
      ]),
    );
  });

  it("flags Intl and process.env through bracketed ambient-global access", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'void globalThis.Intl.DateTimeFormat("en-US");\nvoid globalThis["process"]["env"]["SEED"];\n',
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["Intl", "process.env"]),
    );
  });

  it("flags destructured, aliased, and named-import nondeterministic APIs", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/globals.ts":
          "const { random: sample } = Math;\nconst alias = sample;\nconst { now: clock } = Date;\nconst { hrtime: highResolution } = process;\nvoid [alias, clock, highResolution];\n",
        "/src/contracts/imported.ts":
          'import { randomUUID as uuid } from "node:crypto";\nvoid uuid;\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["Math.random", "Date.now", "process.hrtime", "randomUUID"]),
    );
  });

  it("flags callable Date and every supported crypto randomness form", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/direct.ts":
          "void Date();\nvoid crypto.randomBytes(8);\nvoid crypto.randomFill(new Uint8Array(8), () => undefined);\nvoid crypto.randomInt(10);\nvoid crypto.getRandomValues(new Uint8Array(8));\nvoid crypto.subtle.generateKey({ name: \"AES-GCM\", length: 256 }, true, [\"encrypt\"]);\n",
        "/src/contracts/aliases.ts":
          "const clock = Date;\nconst { randomBytes: bytes, randomInt: integer } = crypto;\nvoid clock();\nvoid bytes(8);\nvoid integer(10);\n",
        "/src/contracts/imported.ts":
          'import { randomFillSync as fill } from "node:crypto";\nvoid fill(new Uint8Array(8));\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["Date() (callable)", "randomBytes", "randomFill", "randomInt", "getRandomValues", "generateKey", "randomFillSync"]),
    );
  });

  it("flags nondeterministic APIs through assignments, parameters, returns, and dynamic imports", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/assigned.ts":
          "let clock;\nclock = Date;\nvoid clock();\n",
        "/src/contracts/parameter.ts":
          "function invoke(value: unknown) { return value; }\nconst clock = invoke(Date);\nvoid clock();\n",
        "/src/contracts/dynamic.ts":
          "async function sample() { const api = await import(\"node:crypto\"); return api.randomBytes(8); }\nvoid sample;\n",
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["Date() (callable)", "randomBytes"]),
    );
  });

  it("flags nondeterministic origins through logical compound assignments", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "let runtime;\nruntime ??= process;\nvoid runtime.env.SEED;\n",
        ),
      ),
    );
    expect(uses.some((use) => use.api === "process.env")).toBe(true);
  });
});
