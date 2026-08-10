import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Node,
  Project,
  SyntaxKind,
  type IfStatement,
  type SourceFile,
  type Symbol,
} from "ts-morph";
import {
  ACTIVE_MECHANISM_RATCHET,
  ACTIVE_RATCHET,
  gateConstitutionProblems,
  mappedFitnessProblems,
  unattributedFitnessInvocationProblem,
  parseCiJobs,
  validateRegistry,
  type Registry as GateRegistry,
} from "../../../scripts/v3-gates.lib";
import { indexFitnessTestResults } from "../../../scripts/fitness-tests.lib";

/**
 * V3-INVARIANT REGISTRY FENCE (ADR-0023; v3 §17 preamble: CI reports active,
 * not-yet-active, or failed - NEVER FAKE GREEN). v3-invariants.json registers
 * all 30 phase-gated invariants; this fence keeps the registry HONEST:
 *  (a) all 30 invariants present (ids 1..30, unique), each with group + gate;
 *  (b) status is ONLY 'active' or 'not-yet-active' - the registry can never
 *      store a pass/fail RESULT (active-pass vs active-fail is computed by
 *      running the mapped fences: scripts/v3-invariants.ts, CI job
 *      'v3-invariants');
 *  (c) every ACTIVE invariant maps to >=1 runnable fitness mechanism, every
 *      path-like mechanism exists on disk, and every ci-gate mechanism names a
 *      job that EXISTS in the BLOCKING ci.yml and RUNS the mechanism's declared
 *      command (a name surviving only in the non-blocking scheduled.yml, or only
 *      in a comment or a path, does not count - ruling `gatea-fix-review-2`);
 *  (d) every NOT-YET-ACTIVE invariant names its activation prerequisite
 *      (activatesWhen) - a bare "not yet" with no named trigger is the silent
 *      deferral the charter forbids;
 *  (e) ratchet: an invariant that has shipped as 'active' can never flip back
 *      to 'not-yet-active' (activation is monotonic; same doctrine as the
 *      charter-drift ratchet).
 * Disabled-fence detection for mapped fitness files is charter-drift (b),
 * which scans every fence in this directory including the mapped ones.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));

interface Mechanism {
  type: string;
  ref: string;
  /** `ci-gate` only: the command the named blocking job must actually run. */
  command?: string;
}
interface Invariant {
  id: number;
  group: string;
  gate: string;
  name: string;
  status: string;
  activatesWhen: string;
  mechanisms: Mechanism[];
  notes?: string;
}
interface Registry {
  invariants: Invariant[];
}

export function runnerFailsClosedOnValidator(
  source: string,
  validatorName: string,
  resultName: string,
): boolean {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/scripts/v3-invariants.ts", source);
  const imported = file
    .getImportDeclaration("./v3-gates.lib")
    ?.getNamedImports()
    .find(
      (specifier) =>
        specifier.getName() === validatorName,
    )
    ?.getNameNode()
    .getSymbol();
  const registry = file.getVariableDeclaration("registry")?.getSymbol();
  const result = file.getVariableDeclaration(resultName);
  const resultSymbol = result?.getSymbol();
  const fail = file.getFunction("fail")?.getSymbol();
  if (
    imported === undefined ||
    registry === undefined ||
    result === undefined ||
    resultSymbol === undefined ||
    fail === undefined
  ) {
    return false;
  }
  const validation = result.getInitializer();
  if (
    !Node.isCallExpression(validation) ||
    !Node.isIdentifier(validation.getExpression()) ||
    validation.getExpression().getSymbol() !== imported
  ) {
    return false;
  }
  const argument = validation.getArguments()[0];
  if (
    !Node.isIdentifier(argument) ||
    argument.getSymbol() !== registry
  ) {
    return false;
  }
  const declarationStatement =
    result.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  const statements = file.getStatements();
  const declarationIndex =
    declarationStatement === undefined
      ? -1
      : statements.indexOf(declarationStatement);
  const guard = statements[declarationIndex + 1];
  if (!Node.isIfStatement(guard)) return false;
  const condition = guard.getExpression();
  const right = Node.isBinaryExpression(condition)
    ? condition.getRight()
    : undefined;
  if (
    !Node.isBinaryExpression(condition) ||
    condition.getOperatorToken().getKind() !==
      SyntaxKind.GreaterThanToken ||
    !Node.isNumericLiteral(right) ||
    Number(right.getLiteralText()) !== 0
  ) {
    return false;
  }
  const length = condition.getLeft();
  if (
    !Node.isPropertyAccessExpression(length) ||
    length.getName() !== "length" ||
    !Node.isIdentifier(length.getExpression()) ||
    length.getExpression().getSymbol() !== resultSymbol
  ) {
    return false;
  }
  return guard
    .getThenStatement()
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some(
      (call) =>
        Node.isIdentifier(call.getExpression()) &&
        call.getExpression().getSymbol() === fail,
    );
}

interface RunnerFatalGuard {
  readonly guard: IfStatement;
  readonly resultSymbol: Symbol;
}

/**
 * The module-scope `const <resultName> = <importedName>(...)` declaration whose
 * VERY NEXT statement is an `if` that calls the runner's `fail`. Symbol-keyed,
 * so an aliased import, a shadowed helper, or a guard moved away from its
 * declaration is not this shape.
 */
function runnerFatalGuard(
  file: SourceFile,
  importedName: string,
  resultName: string,
): RunnerFatalGuard | undefined {
  const imported = file
    .getImportDeclaration("./v3-gates.lib")
    ?.getNamedImports()
    .find((specifier) => specifier.getName() === importedName)
    ?.getNameNode()
    .getSymbol();
  const result = file.getVariableDeclaration(resultName);
  const resultSymbol = result?.getSymbol();
  const fail = file.getFunction("fail")?.getSymbol();
  if (
    imported === undefined ||
    result === undefined ||
    resultSymbol === undefined ||
    fail === undefined
  ) {
    return undefined;
  }
  const validation = result.getInitializer();
  if (
    !Node.isCallExpression(validation) ||
    !Node.isIdentifier(validation.getExpression()) ||
    validation.getExpression().getSymbol() !== imported
  ) {
    return undefined;
  }
  const declarationStatement =
    result.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  const statements = file.getStatements();
  const declarationIndex =
    declarationStatement === undefined
      ? -1
      : statements.indexOf(declarationStatement);
  const guard = declarationIndex === -1
    ? undefined
    : statements[declarationIndex + 1];
  if (guard === undefined || !Node.isIfStatement(guard)) return undefined;
  const callsFail = guard
    .getThenStatement()
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some(
      (call) =>
        Node.isIdentifier(call.getExpression()) &&
        call.getExpression().getSymbol() === fail,
    );
  return callsFail ? { guard, resultSymbol } : undefined;
}

/** The per-invariant report itself: `for (const inv of registry.invariants)` calling `stateOf`. */
function invariantReportLoop(file: SourceFile): Node | undefined {
  const registry = file.getVariableDeclaration("registry")?.getSymbol();
  const stateOf = file.getFunction("stateOf")?.getSymbol();
  if (registry === undefined || stateOf === undefined) return undefined;
  return file
    .getDescendantsOfKind(SyntaxKind.ForOfStatement)
    .find((loop) => {
      const iterated = loop.getExpression();
      return (
        Node.isPropertyAccessExpression(iterated) &&
        iterated.getName() === "invariants" &&
        Node.isIdentifier(iterated.getExpression()) &&
        iterated.getExpression().getSymbol() === registry &&
        loop
          .getDescendantsOfKind(SyntaxKind.CallExpression)
          .some(
            (call) =>
              Node.isIdentifier(call.getExpression()) &&
              call.getExpression().getSymbol() === stateOf,
          )
      );
    });
}

function parsedRunner(source: string): SourceFile {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile(
    "/scripts/v3-invariants.ts",
    source,
  );
}

/**
 * An invocation failure that NO mapped file result explains is unattributable,
 * so the runner must die before it prints an invariant state or a gate state -
 * every one of them would be a claim that run cannot support.
 */
export function runnerGuardsUnattributedFitnessBeforeReporting(
  source: string,
): boolean {
  const file = parsedRunner(source);
  const fatal = runnerFatalGuard(
    file,
    "unattributedFitnessInvocationProblem",
    "unattributedFitness",
  );
  const report = invariantReportLoop(file);
  if (fatal === undefined || report === undefined) return false;
  const condition = fatal.guard.getExpression();
  if (
    !Node.isBinaryExpression(condition) ||
    condition.getOperatorToken().getKind() !==
      SyntaxKind.ExclamationEqualsEqualsToken ||
    !Node.isIdentifier(condition.getLeft()) ||
    condition.getLeft().getSymbol() !== fatal.resultSymbol ||
    condition.getRight().getText() !== "undefined"
  ) {
    return false;
  }
  return fatal.guard.getEnd() < report.getStart();
}

/**
 * A failure a mapped file DOES explain is attributable, so the per-invariant
 * report - the product this job exists to emit, including `active-fail` and the
 * gate states - is printed FIRST and the run still exits nonzero afterwards.
 * The check itself stays: a gate-only fence maps to no invariant, so nothing in
 * the report above would fail on it.
 */
export function runnerFailsOnMappedFitnessAfterReporting(
  source: string,
): boolean {
  const file = parsedRunner(source);
  const fatal = runnerFatalGuard(
    file,
    "mappedFitnessProblems",
    "fitnessFailures",
  );
  const report = invariantReportLoop(file);
  if (fatal === undefined || report === undefined) return false;
  const condition = fatal.guard.getExpression();
  const right = Node.isBinaryExpression(condition)
    ? condition.getRight()
    : undefined;
  const left = Node.isBinaryExpression(condition)
    ? condition.getLeft()
    : undefined;
  if (
    !Node.isBinaryExpression(condition) ||
    condition.getOperatorToken().getKind() !==
      SyntaxKind.GreaterThanToken ||
    !Node.isNumericLiteral(right) ||
    Number(right.getLiteralText()) !== 0 ||
    !Node.isPropertyAccessExpression(left) ||
    left.getName() !== "length" ||
    !Node.isIdentifier(left.getExpression()) ||
    left.getExpression().getSymbol() !== fatal.resultSymbol
  ) {
    return false;
  }
  return fatal.guard.getStart() > report.getEnd();
}

const registry = JSON.parse(readFileSync(root + "v3-invariants.json", "utf8")) as Registry;
const ciJobs = parseCiJobs(existsSync(root + ".github/workflows/ci.yml") ? readFileSync(root + ".github/workflows/ci.yml", "utf8") : "");
const runnerSource = readFileSync(root + "scripts/v3-invariants.ts", "utf8");
const REPORT_SECTION_MARKER =
  "// ---------- compute per-invariant state ----------";
const UNATTRIBUTED_GUARD_START =
  "const unattributedFitness = unattributedFitnessInvocationProblem(";
/** The runner's real pre-report guard, relocated verbatim by the companions below. */
const unattributedGuardSource = runnerSource.slice(
  runnerSource.indexOf(UNATTRIBUTED_GUARD_START),
  runnerSource.indexOf(REPORT_SECTION_MARKER),
);

describe("v3-invariant registry fence", () => {
  it("enforces: the registry is complete, honest (activation-only), mapped to live mechanisms, and ratcheted", () => {
    const problems = validateRegistry(registry, { exists: (p) => existsSync(root + p), ciJobs });
    expect(problems, `v3-invariants.json problems:\n${problems.join("\n")}`).toEqual([]);
    expect(
      runnerFailsClosedOnValidator(
        runnerSource,
        "gateConstitutionProblems",
        "gateProblems",
      ),
    ).toBe(true);
    expect(
      runnerFailsClosedOnValidator(
        runnerSource,
        "activeInvariantRatchetProblems",
        "activeRatchetProblems",
      ),
    ).toBe(true);
    expect(
      runnerFailsClosedOnValidator(
        runnerSource,
        "validateRegistry",
        "registryProblems",
      ),
    ).toBe(true);
    expect(
      runnerFailsClosedOnValidator(
        runnerSource.replace(
          "if (registryProblems.length > 0)",
          "if (false && registryProblems.length > 0)",
        ),
        "validateRegistry",
        "registryProblems",
      ),
    ).toBe(false);
  });

  describe("detects (companion): a dishonest or hollow registry cannot pass", () => {
    const inv = (id: number, over: Partial<Invariant> = {}): Invariant => ({
      id,
      group: "g",
      gate: "A",
      name: `inv ${id}`,
      status: "not-yet-active",
      activatesWhen: "some prerequisite lands",
      mechanisms: [],
      ...over,
    });
    const full = (over: Map<number, Partial<Invariant>> = new Map()): Registry => ({
      invariants: Array.from({ length: 30 }, (_, k) => inv(k + 1, over.get(k + 1))),
    });
    const deps = {
      exists: () => true,
      ciJobs: parseCiJobs(
        [
          "name: ci",
          "on:",
          "  push:",
          "  pull_request:",
          "jobs:",
          "  audit-chain-verify:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: pnpm exec tsx scripts/audit-chain-verify.ts",
          "      - run: pnpm audit:chain",
          "",
        ].join("\n"),
      ),
    };
    // Ratcheted ids must be active in fixtures that test OTHER failure classes.
    const ratchetActive: Array<[number, Partial<Invariant>]> = ACTIVE_RATCHET.map((id) => [
      id,
      {
        status: "active",
        mechanisms: ACTIVE_MECHANISM_RATCHET[id]!.map((mechanism) => ({
          ...mechanism,
        })),
      },
    ]);

    it("flags a stored pass/fail result masquerading as a status", () => {
      const reg = full(new Map<number, Partial<Invariant>>([...ratchetActive, [10, { status: "active-pass" }]]));
      expect(validateRegistry(reg, deps).some((p) => p.includes("never fake green"))).toBe(true);
    });
    it("flags an active invariant with no runnable fitness mechanism (fake green)", () => {
      const reg = full(new Map<number, Partial<Invariant>>([...ratchetActive, [10, { status: "active", mechanisms: [] }]]));
      expect(validateRegistry(reg, deps).some((p) => p.includes("fake green"))).toBe(true);
    });
    it("flags a not-yet-active invariant with no named activation prerequisite (silent deferral)", () => {
      const reg = full(new Map<number, Partial<Invariant>>([...ratchetActive, [10, { activatesWhen: "" }]]));
      expect(validateRegistry(reg, deps).some((p) => p.includes("silent deferral"))).toBe(true);
    });
    it("flags a mechanism pointing at a missing file and a ci-gate absent from ci.yml", () => {
      const reg = full(
        new Map<number, Partial<Invariant>>([
          ...ratchetActive,
          [
            10,
            {
              status: "active",
              mechanisms: [
                { type: "fitness", ref: "src/__tests__/fitness/ghost.test.ts" },
                { type: "ci-gate", ref: "ghost-gate", command: "pnpm ghost" },
              ],
            },
          ],
        ]),
      );
      const problems = validateRegistry(reg, { exists: (p) => !p.includes("ghost"), ciJobs: deps.ciJobs });
      expect(problems.some((p) => p.includes("does not exist on disk"))).toBe(true);
      expect(problems.some((p) => p.includes("ci job 'ghost-gate' is missing"))).toBe(true);
    });
    it("flags a ci-gate satisfied only by a NAME - the job must exist and run the declared command", () => {
      const named = full(
        new Map<number, Partial<Invariant>>([
          ...ratchetActive,
          [10, { status: "active", mechanisms: [{ type: "fitness", ref: "x.test.ts" }, { type: "ci-gate", ref: "audit-chain-verify" }] }],
        ]),
      );
      expect(validateRegistry(named, deps).some((p) => p.includes("must name the command its blocking job runs"))).toBe(true);
      const wrongCommand = full(
        new Map<number, Partial<Invariant>>([
          ...ratchetActive,
          [10, { status: "active", mechanisms: [{ type: "fitness", ref: "x.test.ts" }, { type: "ci-gate", ref: "audit-chain-verify", command: "pnpm lint" }] }],
        ]),
      );
      expect(validateRegistry(wrongCommand, deps).some((p) => p.includes("does not run 'pnpm lint'"))).toBe(true);
      const honest = full(new Map(ratchetActive));
      expect(validateRegistry(honest, deps)).toEqual([]);
    });
    it("flags a ratcheted invariant regressing to not-yet-active, and a missing invariant", () => {
      const regressed = full(); // the ratcheted ids default to not-yet-active here
      expect(validateRegistry(regressed, deps).some((p) => p.includes("ratchet is monotonic"))).toBe(true);
      const twentyNine = full(new Map(ratchetActive));
      twentyNine.invariants = twentyNine.invariants.filter((i) => i.id !== 17);
      expect(validateRegistry(twentyNine, deps).some((p) => p.includes("missing from the registry: 17"))).toBe(true);
    });
    it("flags a shipped active invariant repointed to an unrelated passing fence", () => {
      const overrides = new Map(ratchetActive);
      overrides.set(7, {
        status: "active",
        mechanisms: [
          {
            type: "fitness",
            ref: "src/__tests__/fitness/unrelated-passing.test.ts",
          },
        ],
      });
      const repointed = full(overrides);
      expect(
        validateRegistry(repointed, deps).some((p) =>
          p.includes("shipped mechanism set drifted"),
        ),
      ).toBe(true);
    });
    it("flags a newly active invariant without a shipped mechanism ratchet", () => {
      const overrides = new Map(ratchetActive);
      overrides.set(4, {
        status: "active",
        mechanisms: [
          {
            type: "fitness",
            ref: "src/__tests__/fitness/unrelated-passing.test.ts",
          },
        ],
      });
      expect(
        validateRegistry(full(overrides), deps).some((p) =>
          p.includes(
            "active invariant ids must exactly match the shipped mechanism ratchet",
          ),
        ),
      ).toBe(true);
    });
    it("proves injected ratchet drift reaches an immediate blocking-runner failure guard", () => {
      const drifted = structuredClone(
        registry as unknown as GateRegistry,
      );
      drifted.gates.B!.outcome = "Both domain files exist.";
      expect(
        gateConstitutionProblems(drifted, () => true).some(
          (problem) => problem.includes("gate metadata drifted"),
        ),
      ).toBe(true);
      expect(
        runnerFailsClosedOnValidator(
          runnerSource.replace(
            "if (gateProblems.length > 0)",
            "if (false && gateProblems.length > 0)",
          ),
          "gateConstitutionProblems",
          "gateProblems",
        ),
      ).toBe(false);
      expect(
        runnerFailsClosedOnValidator(
          runnerSource.replace(
            "if (activeRatchetProblems.length > 0)",
            "activeRatchetProblems.length = 0;\nif (activeRatchetProblems.length > 0)",
          ),
          "activeInvariantRatchetProblems",
          "activeRatchetProblems",
        ),
      ).toBe(false);
    });
    it("proves injected gate-ratchet drift exits the real runner nonzero", () => {
      const drifted = structuredClone(
        registry as unknown as GateRegistry,
      );
      drifted.gates.B!.outcome = "Both domain files exist.";
      const directory = mkdtempSync(
        join(tmpdir(), "verin-v3-runner-drift-"),
      );
      const registryPath = join(directory, "v3-invariants.json");
      writeFileSync(registryPath, JSON.stringify(drifted));
      try {
        const run = spawnSync(
          process.execPath,
          [
            join(root, "node_modules/tsx/dist/cli.mjs"),
            join(root, "scripts/v3-invariants.ts"),
            "--registry",
            registryPath,
          ],
          {
            cwd: root,
            encoding: "utf8",
            env: { ...process.env, NO_COLOR: "1" },
          },
        );
        expect(run.status, run.stderr || run.stdout).toBe(1);
        expect(run.stderr).toContain(
          "v3-invariants: gate constitution problems:",
        );
        expect(run.stderr).toContain("gate metadata drifted");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
    it("flags failed and missing results from every mapped fitness file", () => {
      const refs = ["active.test.ts", "gate-only.test.ts"];
      expect(
        mappedFitnessProblems(
          refs,
          new Map([
            ["active.test.ts", true],
            ["gate-only.test.ts", false],
          ]),
          1,
        ),
      ).toEqual([
        "mapped fitness invocation exited 1",
        "gate-only.test.ts FAILED",
      ]);
      expect(
        mappedFitnessProblems(
          refs,
          new Map([["active.test.ts", true]]),
          0,
        ),
      ).toEqual(["gate-only.test.ts produced no result"]);
      expect(
        mappedFitnessProblems(
          refs,
          new Map(refs.map((ref) => [ref, true])),
          0,
        ),
      ).toEqual([]);
    });
    it("matches mapped fitness results by exact repository-relative path", () => {
      const ref = "src/__tests__/fitness/v3-invariants.test.ts";
      const indexed = indexFitnessTestResults(
        [ref],
        [
          {
            name: `/repo/src/shadow/${ref}`,
            status: "passed",
          },
        ],
        "/repo",
      );
      expect(
        mappedFitnessProblems([ref], indexed.fileResults, 0),
      ).toEqual([`${ref} produced no result`]);
      expect(runnerSource).not.toContain(
        "fitnessFiles.find((f) => name.endsWith(f))",
      );
      expect(runnerSource).toContain(
        "indexFitnessTestResults(\n  fitnessFiles,",
      );
      expect(
        indexFitnessTestResults(
          [ref],
          [
            { name: ref, status: "passed" },
            { name: `/repo/${ref}`, status: "passed" },
          ],
          "/repo",
        ).problems,
      ).toEqual([`${ref} produced duplicate results`]);
    });
    it("blocks an unattributable fitness invocation before any invariant or gate state output", () => {
      expect(runnerSource).toContain(UNATTRIBUTED_GUARD_START);
      expect(runnerSource).toContain(REPORT_SECTION_MARKER);
      expect(
        unattributedFitnessInvocationProblem(
          ["a.test.ts"],
          new Map([["a.test.ts", true]]),
          1,
        ),
      ).toBe("mapped fitness invocation exited 1");
      expect(
        unattributedFitnessInvocationProblem(
          ["a.test.ts", "b.test.ts"],
          new Map([
            ["a.test.ts", true],
            ["b.test.ts", false],
          ]),
          1,
        ),
      ).toBeUndefined();
      expect(
        unattributedFitnessInvocationProblem(
          ["a.test.ts"],
          new Map(),
          null,
        ),
      ).toBeUndefined();
      expect(
        runnerGuardsUnattributedFitnessBeforeReporting(runnerSource),
      ).toBe(true);
      // The same guard AFTER the report would let an unexplained invocation
      // failure print `active-pass` states first.
      expect(
        runnerGuardsUnattributedFitnessBeforeReporting(
          `${runnerSource.replace(unattributedGuardSource, "")}\n${unattributedGuardSource}`,
        ),
      ).toBe(false);
      expect(
        runnerGuardsUnattributedFitnessBeforeReporting(
          runnerSource.replace(
            "if (unattributedFitness !== undefined)",
            "if (false && unattributedFitness !== undefined)",
          ),
        ),
      ).toBe(false);
    });
    it("reports every mapped fitness failure per invariant before it exits nonzero", () => {
      expect(
        runnerFailsOnMappedFitnessAfterReporting(runnerSource),
      ).toBe(true);
      // Hoisting the fatal guard above the report is the suppression this rule
      // exists to reject: a failed fence would lose its per-invariant line.
      expect(
        runnerFailsOnMappedFitnessAfterReporting(
          runnerSource.replace(
            REPORT_SECTION_MARKER,
            `const fitnessFailures = mappedFitnessProblems(fitnessFiles, fileResults, fitnessRunStatus);\nif (fitnessFailures.length > 0) fail("mapped fitness fences failing");\n${REPORT_SECTION_MARKER}`,
          ),
        ),
      ).toBe(false);
      expect(
        runnerFailsOnMappedFitnessAfterReporting(
          runnerSource.replace(
            "if (fitnessFailures.length > 0)",
            "if (false && fitnessFailures.length > 0)",
          ),
        ),
      ).toBe(false);
      // A report loop that no longer computes real per-invariant state is not a
      // report, so nothing downstream of it can be credited as one.
      expect(
        runnerFailsOnMappedFitnessAfterReporting(
          runnerSource.replace(
            "const { state, details } = stateOf(inv);",
            'const { state, details } = { state: "active-pass" as State, details: [] };',
          ),
        ),
      ).toBe(false);
    });
    it("accepts a complete honest registry (cannot pass by always-failing)", () => {
      expect(validateRegistry(full(new Map(ratchetActive)), deps)).toEqual([]);
    });
  });
});
