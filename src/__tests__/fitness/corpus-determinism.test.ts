import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { REPO_ROOT, walk } from "./_fence-utils";
import { inMemoryProject } from "./_fence-utils";
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import { buildInventory, corpusDigest } from "../../../scripts/corpus/manifest";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import { loadSpec, type LoadedSpec } from "../../../scripts/corpus/world";
import { committedBytesProblems, readCommittedCorpus } from "../../../scripts/corpus/validate";

/**
 * CORPUS-DETERMINISM FENCE (v3 prompt 11, ADR-0034; charter #1/#4).
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
const CORPUS_SRC = join(REPO_ROOT, "scripts", "corpus");

// ── (d) the non-determinism ban ────────────────────────────────────────────────

interface BannedUse {
  file: string;
  line: number;
  api: string;
}

/**
 * AST, not grep: `Date.now`, an ARGLESS `new Date()`, `Math.random`,
 * `crypto.randomUUID`, `performance.now`, `process.hrtime`, `process.env`, every
 * `toLocale*`/`localeCompare` and every `Intl` reference. `new Date(iso)` with an
 * explicit argument is deterministic and stays legal - that distinction is
 * exactly why this is an AST rule and not a text scan.
 */
export function bannedNondeterminismUses(project: Project, root = ""): BannedUse[] {
  const uses: BannedUse[] = [];
  const record = (node: Node, api: string, sf: SourceFile): void => {
    uses.push({ file: sf.getFilePath().replace(root, ""), line: node.getStartLineNumber(), api });
  };
  for (const sf of project.getSourceFiles()) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (call.getExpression().getText() === "Date" && call.getArguments().length === 0) {
        record(call, "new Date() (argless)", sf);
      }
    }
    for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const text = access.getText();
      const name = access.getName();
      if (/^(Math\.random|Date\.now|performance\.now|process\.hrtime)$/.test(text)) record(access, text, sf);
      if (text === "process.env" || access.getExpression().getText() === "process.env") {
        record(access, "process.env", sf);
      }
      if (name === "randomUUID") record(access, "randomUUID", sf);
      if (/^toLocale(String|DateString|TimeString)$/.test(name) || name === "localeCompare") {
        record(access, name, sf);
      }
    }
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier.getText() !== "Intl") continue;
      const parent = identifier.getParent();
      if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) continue;
      record(identifier, "Intl", sf);
    }
  }
  return uses;
}

const generatorProject = (): Project => {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of walk(CORPUS_SRC, (f) => f.endsWith(".ts"))) project.addSourceFileAtPath(file);
  return project;
};

// ── (b) + (c) comparison helpers ───────────────────────────────────────────────

const bytesByPath = (spec: LoadedSpec, seed: string): Map<string, string> =>
  new Map(generateSyntheticCases(spec, seed).map((file) => [file.relPath, file.bytes]));

/** Files whose bytes differ between two generations (plus added/removed paths). */
export function changedPaths(left: Map<string, string>, right: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [path, bytes] of left) if (right.get(path) !== bytes) changed.add(path);
  for (const [path, bytes] of right) if (left.get(path) !== bytes) changed.add(path);
  return [...changed].sort();
}

/** The seed-sensitivity check itself, as a detector: two DISTINCT seeds that
 * produce identical bytes mean the seed is decorative. */
export function seedSensitivityProblems(underA: Map<string, string>, underB: Map<string, string>): string[] {
  return changedPaths(underA, underB).length === 0
    ? ["generator output is identical under two distinct seeds - the seed is not being used"]
    : [];
}

/** A NEW household inserted in the MIDDLE of every spec collection, so a
 * position-sensitive generator reshuffles and a path-keyed one does not. */
function specWithInsertedHousehold(spec: LoadedSpec): LoadedSpec {
  const middle = <T>(rows: readonly T[], row: T): T[] => {
    const at = Math.floor(rows.length / 2);
    return [...rows.slice(0, at), row, ...rows.slice(at)];
  };
  const world = spec.world;
  return {
    ...spec,
    world: {
      ...world,
      parties: middle(world.parties, {
        key: "inserted-party",
        kind: "natural-person",
        rosterName: "Inserted Fixture Person",
        roles: ["client"],
      }),
      households: middle(world.households, {
        key: "inserted",
        scopeSlug: "inserted",
        displayName: "Inserted Fixture Household",
        memberRefs: ["inserted-party"],
        advisorRef: world.households[0]!.advisorRef,
      }),
      accounts: middle(world.accounts, {
        key: "inserted-taxable",
        householdRef: "inserted",
        registration: "individual",
        ownerRefs: ["inserted-party"],
        custodian: world.accounts[0]!.custodian,
        balanceMinor: 1_000_000,
        balanceObservedAt: world.accounts[0]!.balanceObservedAt,
        taxClass: "taxable",
      }),
      bankInstructions: middle(world.bankInstructions, {
        key: "inserted-primary",
        householdRef: "inserted",
        titledTo: "inserted-party",
        bank: "Inserted Bank",
        lastFour: "0000",
        verifiedAt: world.bankInstructions[0]!.verifiedAt,
        changedAt: null,
        accountRefs: ["inserted-taxable"],
      }),
    },
    cases: {
      ...spec.cases,
      cases: middle(spec.cases.cases, {
        key: "inserted-control",
        title: "Inserted clean control",
        firmId: "firm-a",
        householdRef: "inserted",
        assumptionIds: [],
        label: { kind: "clean-control", controlRationale: "Inserted to prove order independence." },
        request: {
          sourceAccountRef: "inserted-taxable",
          destinationRef: "inserted-primary",
          amountMinor: 100_000,
          discriminator: "1000-2026-09-10",
          deadline: "2026-09-10T13:00:00.000Z",
        },
        evidence: ["balance/inserted-taxable", "bank-instruction/inserted-primary"],
        conflictFamilies: ["liquidity"],
      }),
    },
  };
}

const realSpec = loadSpec();

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

  it("(c) enforces: inserting a household mid-spec changes ONLY that household's cases", () => {
    const before = bytesByPath(realSpec, CORPUS_SEED);
    const after = bytesByPath(specWithInsertedHousehold(realSpec), CORPUS_SEED);
    expect(changedPaths(before, after)).toEqual(["synthetic/CS-inserted-control.json"]);
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
      const inProcess = corpusDigest(
        realSpec.world.corpusVersion,
        CORPUS_SEED,
        buildInventory(generateSyntheticCases(realSpec, CORPUS_SEED)),
      );
      expect(digestUnder("UTC")).toBe(inProcess);
      expect(digestUnder("Asia/Kolkata")).toBe(inProcess);
    },
    120_000,
  );
});

describe("detects (companion): a non-deterministic generator or a drifted corpus CANNOT pass", () => {
  const file = (body: string) => ({ "/src/contracts/gen.ts": body });

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
