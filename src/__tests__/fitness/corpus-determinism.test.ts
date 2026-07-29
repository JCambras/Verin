import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { REPO_ROOT, walk } from "./_fence-utils";
import { inMemoryProject } from "./_fence-utils";
import { loadTaxonomy } from "../../../scripts/corpus/defects";
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import { buildInventory, corpusDigest, taxonomySemanticDigest } from "../../../scripts/corpus/manifest";
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
  const seen = new Set<string>();
  const record = (node: Node, api: string, sf: SourceFile): void => {
    const file = sf.getFilePath().replace(root, "");
    const line = node.getStartLineNumber();
    const key = `${file}:${line}:${api}`;
    if (!seen.has(key)) uses.push({ file, line, api });
    seen.add(key);
  };
  for (const sf of project.getSourceFiles()) {
    const origins = new Map<string, string>([
      ["Math", "Math"],
      ["Date", "Date"],
      ["performance", "performance"],
      ["process", "process"],
      ["crypto", "crypto"],
      ["Intl", "Intl"],
    ]);
    const cryptoRandomMembers = new Set([
      "randomUUID",
      "randomBytes",
      "randomFill",
      "randomFillSync",
      "randomInt",
      "getRandomValues",
      "generateKey",
      "generateKeySync",
      "generateKeyPair",
      "generateKeyPairSync",
    ]);
    const bannedCalls = new Set([
      "Math.random",
      "Date.now",
      "performance.now",
      "process.hrtime",
      "process.env",
      ...[...cryptoRandomMembers].flatMap((name) => [
        `crypto.${name}`,
        `crypto.webcrypto.${name}`,
        `crypto.subtle.${name}`,
        `crypto.webcrypto.subtle.${name}`,
      ]),
    ]);
    const apiName = (origin: string): string =>
      origin.startsWith("crypto.") ? origin.split(".").at(-1)! : origin;
    const moduleOrigin = (moduleName: string): string | undefined =>
      moduleName.replace(/^node:/, "") === "crypto" ? "crypto" :
        moduleName.replace(/^node:/, "") === "process" ? "process" :
          moduleName.replace(/^node:/, "") === "perf_hooks" ? "performance" :
            undefined;
    const unwrap = (input: Node): Node => {
      let node = input;
      while (
        Node.isParenthesizedExpression(node) ||
        Node.isAsExpression(node) ||
        Node.isTypeAssertion(node) ||
        Node.isNonNullExpression(node) ||
        Node.isAwaitExpression(node)
      ) {
        node = node.getExpression();
      }
      return node;
    };
    const localFunctions = new Map<
      string,
      { parameters: Node[]; returns: Node[] }
    >();
    const registerFunction = (
      name: string,
      callable: {
        getParameters(): Node[];
        getDescendantsOfKind(kind: SyntaxKind.ReturnStatement): Array<{
          getExpression(): Node | undefined;
        }>;
        getBody(): Node | undefined;
      },
    ): void => {
      const body = callable.getBody();
      const returns = callable
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .flatMap((statement) => statement.getExpression() ?? []);
      if (
        body !== undefined &&
        !Node.isBlock(body)
      ) {
        returns.push(body);
      }
      localFunctions.set(name, {
        parameters: callable.getParameters(),
        returns,
      });
    };
    for (const declaration of sf.getDescendantsOfKind(
      SyntaxKind.FunctionDeclaration,
    )) {
      const name = declaration.getName();
      if (name !== undefined) registerFunction(name, declaration);
    }
    for (const declaration of sf.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    )) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (
        Node.isIdentifier(name) &&
        initializer !== undefined &&
        (Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer))
      ) {
        registerFunction(name.getText(), initializer);
      }
    }
    const originOf = (input: Node | undefined): string | undefined => {
      if (input === undefined) return undefined;
      const node = unwrap(input);
      const direct = origins.get(node.getText());
      if (direct !== undefined) return direct;
      if (
        Node.isCallExpression(node) &&
        node.getExpression().getKind() === SyntaxKind.ImportKeyword
      ) {
        const specifier = node.getArguments()[0];
        return specifier !== undefined &&
            (Node.isStringLiteral(specifier) ||
              Node.isNoSubstitutionTemplateLiteral(specifier))
          ? moduleOrigin(specifier.getLiteralText())
          : undefined;
      }
      if (Node.isCallExpression(node)) {
        const target = unwrap(node.getExpression());
        const callable = Node.isIdentifier(target)
          ? localFunctions.get(target.getText())
          : undefined;
        const returned = callable?.returns
          .map((expression) => originOf(expression))
          .find((origin) => origin !== undefined);
        if (returned !== undefined) return returned;
      }
      if (Node.isIdentifier(node)) return origins.get(node.getText());
      if (Node.isPropertyAccessExpression(node)) {
        const base = originOf(node.getExpression());
        return base === undefined ? undefined : `${base}.${node.getName()}`;
      }
      if (Node.isElementAccessExpression(node)) {
        const base = originOf(node.getExpression());
        const argument = node.getArgumentExpression();
        if (
          base !== undefined &&
          argument !== undefined &&
          (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
        ) {
          return `${base}.${argument.getLiteralText()}`;
        }
      }
      return undefined;
    };
    const sensitive = (origin: string): boolean =>
      origin === "Date" ||
      origin === "Intl" ||
      bannedCalls.has(origin) ||
      origin.startsWith("crypto.") ||
      origin.startsWith("process.env") ||
      origin.startsWith("process.hrtime");
    const setOrigin = (name: string, origin: string): boolean => {
      const current = origins.get(name);
      if (
        current !== undefined &&
        (current === origin || sensitive(current) || !sensitive(origin))
      ) {
        return false;
      }
      origins.set(name, origin);
      return true;
    };
    const bindOrigin = (
      name: Node,
      origin: string,
      source: Node = name,
    ): boolean => {
      if (
        Node.isIdentifier(name) ||
        Node.isPropertyAccessExpression(name) ||
        Node.isElementAccessExpression(name)
      ) {
        const changed = setOrigin(name.getText(), origin);
        if (bannedCalls.has(origin)) {
          record(source, apiName(origin), sf);
        }
        return changed;
      }
      if (Node.isObjectBindingPattern(name)) {
        return name.getElements().map((element) => {
          const local = element.getNameNode();
          const property =
            element.getPropertyNameNode()?.getText() ?? local.getText();
          return bindOrigin(local, `${origin}.${property}`, element);
        }).some(Boolean);
      }
      if (Node.isObjectLiteralExpression(name)) {
        return name.getProperties().map((property) => {
          if (Node.isPropertyAssignment(property)) {
            return bindOrigin(
              property.getInitializer()!,
              `${origin}.${property.getName()}`,
              property,
            );
          }
          return Node.isShorthandPropertyAssignment(property)
            ? bindOrigin(
                property.getNameNode(),
                `${origin}.${property.getName()}`,
                property,
              )
            : false;
        }).some(Boolean);
      }
      return false;
    };
    for (const declaration of sf.getImportDeclarations()) {
      const moduleName = declaration.getModuleSpecifierValue();
      const normalizedModuleName = moduleName.replace(/^node:/, "");
      const namespace = declaration.getNamespaceImport()?.getText();
      const defaultImport = declaration.getDefaultImport()?.getText();
      const base = moduleOrigin(moduleName);
      if (base !== undefined && namespace !== undefined) origins.set(namespace, base);
      if (base !== undefined && defaultImport !== undefined) origins.set(defaultImport, base);
      for (const specifier of declaration.getNamedImports()) {
        const imported = specifier.getName();
        const local = specifier.getAliasNode()?.getText() ?? imported;
        const origin =
          normalizedModuleName === "crypto" &&
            (cryptoRandomMembers.has(imported) || imported === "webcrypto")
            ? `crypto.${imported}` :
            normalizedModuleName === "process" && (imported === "hrtime" || imported === "env") ?
              `process.${imported}` :
              normalizedModuleName === "perf_hooks" && imported === "performance" ? "performance" :
                undefined;
        if (origin === undefined) continue;
        origins.set(local, origin);
        if (bannedCalls.has(origin)) record(specifier, imported, sf);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const declaration of sf.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration,
      )) {
        const initializerOrigin = originOf(declaration.getInitializer());
        if (initializerOrigin !== undefined) {
          changed =
            bindOrigin(
              declaration.getNameNode(),
              initializerOrigin,
            ) || changed;
        }
      }
      for (const assignment of sf.getDescendantsOfKind(
        SyntaxKind.BinaryExpression,
      )) {
        if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) {
          continue;
        }
        const origin = originOf(assignment.getRight());
        if (origin !== undefined) {
          changed =
            bindOrigin(
              unwrap(assignment.getLeft()),
              origin,
              assignment,
            ) || changed;
        }
      }
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const target = unwrap(call.getExpression());
        const callable = Node.isIdentifier(target)
          ? localFunctions.get(target.getText())
          : undefined;
        if (callable === undefined) continue;
        for (const [index, parameter] of callable.parameters.entries()) {
          const origin = originOf(call.getArguments()[index]);
          if (origin !== undefined) {
            changed =
              bindOrigin(
                parameter.getFirstChildByKind(SyntaxKind.Identifier) ??
                  parameter,
                origin,
                parameter,
              ) || changed;
          }
        }
      }
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (originOf(call.getExpression()) === "Date" && call.getArguments().length === 0) {
        record(call, "new Date() (argless)", sf);
      }
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (
        call.getExpression().getKind() === SyntaxKind.ImportKeyword &&
        !call.getArguments().some(
          (argument) =>
            Node.isStringLiteral(argument) ||
            Node.isNoSubstitutionTemplateLiteral(argument),
        )
      ) {
        record(call, "non-literal dynamic import", sf);
      }
      const origin = originOf(call.getExpression());
      if (origin === "Date") {
        record(call, "Date() (callable)", sf);
      } else if (origin !== undefined && bannedCalls.has(origin)) {
        record(call, apiName(origin), sf);
      } else if (origin?.startsWith("process.hrtime.") === true) {
        record(call, "process.hrtime", sf);
      }
    }
    for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const name = access.getName();
      const origin = originOf(access);
      if (origin !== undefined && bannedCalls.has(origin)) {
        record(access, apiName(origin), sf);
      }
      if (origin === "process.env" || origin?.startsWith("process.env.") === true) {
        record(access, "process.env", sf);
      }
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

/**
 * A NEW household inserted in the MIDDLE of every spec collection, so a
 * position-sensitive generator reshuffles and a path-keyed one does not.
 *
 * Its key is `smiths-west`: a deliberate PREFIX COLLISION with the existing
 * `smiths` household, carrying its own position-scoped legal hold. A subgraph
 * that resolved holds by substring (`subjectRef.includes(":smiths")`) would leak
 * this hold into `smiths` and change a foreign household's committed bytes - the
 * exact break a neutrally-keyed `inserted` household cannot detect.
 */
function specWithInsertedHousehold(spec: LoadedSpec): LoadedSpec {
  const middle = <T>(rows: readonly T[], row: T): T[] => {
    const at = Math.floor(rows.length / 2);
    return [...rows.slice(0, at), row, ...rows.slice(at)];
  };
  const world = spec.world;
  const observedAt = world.accounts[0]!.balanceObservedAt;
  return {
    ...spec,
    world: {
      ...world,
      parties: middle(world.parties, {
        key: "smiths-west-party",
        kind: "natural-person",
        rosterName: "Inserted Fixture Person",
        roles: ["client"],
      }),
      households: middle(world.households, {
        key: "smiths-west",
        scopeSlug: "smiths-west",
        displayName: "Inserted Fixture Household",
        memberRefs: ["smiths-west-party"],
        advisorRef: world.households[0]!.advisorRef,
      }),
      accounts: middle(world.accounts, {
        key: "smiths-west-taxable",
        householdRef: "smiths-west",
        registration: "individual",
        ownerRefs: ["smiths-west-party"],
        custodian: world.accounts[0]!.custodian,
        balanceMinor: 1_000_000,
        balanceObservedAt: observedAt,
        taxClass: "taxable",
      }),
      bankInstructions: middle(world.bankInstructions, {
        key: "smiths-west-primary",
        householdRef: "smiths-west",
        titledTo: "smiths-west-party",
        bank: "Inserted Bank",
        lastFour: "0000",
        verifiedAt: world.bankInstructions[0]!.verifiedAt,
        changedAt: null,
        accountRefs: ["smiths-west-taxable"],
        observedAt,
      }),
      legalHolds: middle(world.legalHolds, {
        key: "smiths-west-position-hold",
        subjectRef: "position:smiths-west-taxable:NBRD-2031",
        scope: "position",
        recordedAt: observedAt,
        observedAt,
        releasedAt: null,
      }),
    },
    cases: {
      ...spec.cases,
      cases: middle(spec.cases.cases, {
        key: "smiths-west-control",
        title: "Inserted clean control",
        firmId: "firm-a",
        householdRef: "smiths-west",
        assumptionIds: [],
        label: { kind: "clean-control", controlRationale: "Inserted to prove order independence." },
        request: {
          sourceAccountRef: "smiths-west-taxable",
          destinationRef: "smiths-west-primary",
          amountMinor: 100_000,
          discriminator: "1000-2026-09-10",
          deadline: "2026-09-10T13:00:00.000Z",
        },
        evidence: ["balance/smiths-west-taxable", "bank-instruction/smiths-west-primary"],
        conflictFamilies: ["liquidity"],
      }),
    },
  };
}

const realSpec = loadSpec();
const realTaxonomy = loadTaxonomy();

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
      const inProcess = corpusDigest(
        realSpec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(realTaxonomy),
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
