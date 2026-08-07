import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import { committedBytesProblems } from "../../../scripts/corpus/validate";
import {
  bytesByPath,
  changedPaths,
  file,
  generatorProject,
  realSpec,
  seedSensitivityProblems,
} from "./_corpus-determinism-fixtures";
import { bannedNondeterminismUses } from "./_corpus-nondeterminism-scan";
import { inMemoryProject } from "./_fence-utils";

/**
 * CORPUS-DETERMINISM FENCE companions - nondeterministic ORIGINS: the shapes a
 * clock, a randomness source, a locale API or a host input can reach a value
 * through, plus the byte-comparison drift detectors.
 */

describe("detects (companion): a non-deterministic generator or a drifted corpus CANNOT pass", () => {

  it("flags local-module and container-member nondeterministic origins", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/helper.ts":
          "export const runtime = process;\nexport const box = { runtime: process };\nexport const list = [process] as const;\n",
        "/src/contracts/consumer.ts":
          'import { runtime, box, list } from "./helper";\nvoid runtime.env.SEED;\nvoid box.runtime.env.SEED;\nvoid list[0].env.SEED;\nvoid ({ runtime: process }).runtime.env.SEED;\n',
      }),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(4);
  });

  it("flags every sensitive conditional, logical, and callable-return origin", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "declare const flag: boolean;\nconst conditional = flag ? Math : process;\nvoid conditional.env.SEED;\nconst logical = Math || process;\nvoid logical.env.SEED;\nfunction runtime() { return flag ? Math : process; }\nvoid runtime().env.SEED;\n",
        ),
      ),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(3);
  });

  it("flags origins passed through nested object and array parameter patterns", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/helper.ts":
          "export const pickObject = ({ runtime }: { runtime: any }) => runtime;\nexport const pickNested = ({ box: { runtime } }: { box: { runtime: any } }) => runtime;\nexport const pickArray = ([runtime]: [any]) => runtime;\n",
        "/src/contracts/consumer.ts":
          'import { pickArray, pickNested, pickObject } from "./helper";\nvoid pickObject({ runtime: process }).env.SEED;\nvoid pickNested({ box: { runtime: process } }).env.SEED;\nvoid pickArray([process]).env.SEED;\n',
      }),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(3);
  });

  it("flags process runtime clocks and crypto prime generation", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/direct.ts":
          "void process.uptime();\nvoid crypto.generatePrime(8, () => undefined);\nvoid crypto.generatePrimeSync(8);\n",
        "/src/contracts/imported.ts":
          'import { generatePrime as prime } from "node:crypto";\nimport { uptime } from "node:process";\nvoid prime(8, () => undefined);\nvoid uptime();\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["process.uptime", "generatePrime", "generatePrimeSync"]),
    );
  });

  it("flags method, accessor, and default-parameter host origins", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "class Helper { runtime() { return process; } get ambient() { return process; } }\nconst helper = new Helper();\nvoid helper.runtime().env.SEED;\nvoid helper.ambient.env.SEED;\nfunction read(runtime = process) { return runtime; }\nvoid read().env.SEED;\n",
        ),
      ),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(3);
  });

  it("flags parameter defaults for explicit undefined and nested binding defaults", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "function direct(runtime = process) { return runtime; }\nvoid direct(undefined).env.SEED;\nfunction nested({ runtime = process } = {}) { return runtime; }\nvoid nested({}).env.SEED;\nfunction tuple([runtime = process] = []) { return runtime; }\nvoid tuple([]).env.SEED;\n",
        ),
      ),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(3);
  });

  it("flags a nondeterministic method invoked through a callable alias", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "class Helper { runtime() { return process; } }\nconst helper = new Helper();\nconst read = helper.runtime;\nvoid read().env.SEED;\n",
        ),
      ),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(1);
  });

  it("flags builtins loaded through import-equals and CommonJS require", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'import os = require("node:os");\nvoid os.hostname();\nconst runtime = require("node:process");\nvoid runtime.env.SEED;\nconst { release } = require("node:os");\nvoid release();\n',
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["os.hostname", "process.env", "os.release"]),
    );
    expect(
      bannedNondeterminismUses(
        inMemoryProject(
          file(
            'const helper = { require: (_name: string) => ({ hostname: () => "fixed" }) };\nvoid helper.require("node:os").hostname();\n',
          ),
        ),
      ),
    ).toEqual([]);
  });

  it("flags constant and runtime-computed access on sensitive origins", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'const envKey = "env";\nvoid process[envKey].SEED;\nconst randomKey = "random";\nvoid Math[randomKey]();\ndeclare const runtimeKey: string;\nvoid process[runtimeKey];\n',
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["process.env", "Math.random", "process.[computed]"]),
    );
  });

  it("flags mutable computed member keys on sensitive origins", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'let key = "fixed";\nkey = "random";\nvoid Math[key]();\n',
        ),
      ),
    );
    expect(uses.map((use) => use.api)).toEqual(["Math.[computed]"]);
  });

  it("flags process properties and operating-system APIs", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/direct.ts":
          "void process.platform;\nvoid process.argv;\n",
        "/src/contracts/imported.ts":
          'import { hostname } from "node:os";\nimport * as os from "node:os";\nvoid hostname();\nvoid os.release();\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["process.platform", "process.argv", "os.hostname", "os.release"]),
    );
  });

  it("flags filesystem, subprocess, and network host inputs", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/io.ts":
          'import { readFileSync } from "node:fs";\nimport { execFileSync } from "node:child_process";\nvoid readFileSync("/etc/hostname", "utf8");\nvoid Reflect.apply(readFileSync, null, ["/etc/hostname", "utf8"]);\nvoid execFileSync("hostname");\nvoid fetch("https://example.com/input");\nvoid new WebSocket("wss://example.com/input");\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set([
        "fs.readFileSync",
        "child_process.execFileSync",
        "fetch",
        "WebSocket",
      ]),
    );
    expect(
      new Set(
        bannedNondeterminismUses(
          inMemoryProject({
            "/scripts/corpus/world.ts":
              'import { readFileSync } from "node:fs";\nexport function unboundInput() { return readFileSync("/etc/hostname", "utf8"); }\n',
          }),
        ).map((use) => use.api),
      ),
    ).toEqual(new Set(["fs.readFileSync"]));
  });

  it("scans every supported executable source extension", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-determinism-"));
    try {
      const extensions = [
        "ts",
        "tsx",
        "mts",
        "cts",
        "js",
        "jsx",
        "mjs",
        "cjs",
      ];
      for (const extension of extensions) {
        writeFileSync(
          join(root, `proof.${extension}`),
          "Math.random();\n",
          "utf8",
        );
      }
      const project = generatorProject(root);
      expect(project.getSourceFiles()).toHaveLength(extensions.length);
      expect(
        bannedNondeterminismUses(project, root)
          .filter((use) => use.api === "Math.random"),
      ).toHaveLength(extensions.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans executable dependencies outside the corpus source root", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-closure-"));
    const corpusRoot = join(root, "corpus");
    try {
      mkdirSync(corpusRoot);
      writeFileSync(
        join(corpusRoot, "entry.ts"),
        'import { runtime } from "../shared";\nvoid runtime.env.SEED;\n',
        "utf8",
      );
      writeFileSync(
        join(root, "shared.ts"),
        "export const runtime = process;\n",
        "utf8",
      );
      const project = generatorProject(corpusRoot);
      expect(project.getSourceFiles()).toHaveLength(2);
      expect(
        bannedNondeterminismUses(project, root)
          .filter((use) => use.api === "process.env"),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a hand edit to a generated file is caught by the byte comparison", () => {
    const generated = generateSyntheticCases(realSpec, CORPUS_SEED);
    const tampered = generated.map((f, index) => ({
      relPath: f.relPath,
      // A version relabel - the smallest edit that changes what a case claims.
      bytes: index === 0 ? f.bytes.replace('"corpusVersion":"2026.07.0"', '"corpusVersion":"9999.99.9"') : f.bytes,
    }));
    expect(tampered[0]!.bytes).not.toBe(generated[0]!.bytes);
    const problems = committedBytesProblems(generated, tampered);
    expect(problems.some((p) => p.includes("committed bytes differ from regeneration"))).toBe(true);
  });

  it("beneficiary ordering is total across every emitted field", () => {
    const before = structuredClone(realSpec);
    before.world.beneficiaries.push({
      accountRef: "smiths-joint-taxable",
      partyRef: "mira-smith",
      sharePercentBps: 2500,
      tier: "contingent",
    });
    const after = structuredClone(before);
    const matching = after.world.beneficiaries
      .map((beneficiary, index) => ({ beneficiary, index }))
      .filter(({ beneficiary }) =>
        beneficiary.accountRef === "smiths-joint-taxable" &&
        beneficiary.partyRef === "mira-smith"
      );
    const left = matching[0]!.index;
    const right = matching[1]!.index;
    [after.world.beneficiaries[left], after.world.beneficiaries[right]] = [
      after.world.beneficiaries[right]!,
      after.world.beneficiaries[left]!,
    ];
    expect(
      changedPaths(
        bytesByPath(before, CORPUS_SEED),
        bytesByPath(after, CORPUS_SEED),
      ),
    ).toEqual([]);
  });

  it("a missing and an orphaned generated file are both caught", () => {
    const generated = generateSyntheticCases(realSpec, CORPUS_SEED);
    const committed = generated.slice(1).map((f) => ({ relPath: f.relPath, bytes: f.bytes }));
    const problems = committedBytesProblems(generated, [
      ...committed,
      { relPath: "synthetic/CS-ghost.json", bytes: "{}\n" },
    ]);
    expect(problems.some((p) => p.includes("generated but not committed"))).toBe(true);
    expect(problems.some((p) => p.includes("committed but no longer generated"))).toBe(true);
  });

  it("a seed-IGNORING generator is caught: identical output under two seeds is a violation", () => {
    // Exactly what a constant-output generator produces: the same bytes for two
    // distinct seeds. The real check above runs the same detector.
    const constant = bytesByPath(realSpec, CORPUS_SEED);
    const problems = seedSensitivityProblems(constant, new Map(constant));
    expect(problems.some((p) => p.includes("the seed is not being used"))).toBe(true);
  });

  it("an ORDER-SENSITIVE generator is caught: a mid-spec insertion touching other cases fails", () => {
    // Simulates a stream PRNG: every case's bytes shift when one household is
    // inserted. The real check above asserts exactly one path changes.
    const before = bytesByPath(realSpec, CORPUS_SEED);
    const reshuffled = new Map([...before].map(([path, bytes]) => [path, `${bytes} `]));
    expect(changedPaths(before, reshuffled).length).toBeGreaterThan(1);
  });
});
