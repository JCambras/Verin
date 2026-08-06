import { describe, expect, it } from "vitest";
import { Node, SyntaxKind, type Project } from "ts-morph";
import {
  inMemoryProject,
  normalizedPath,
  realSemanticProject,
} from "./_fence-utils";
import {
  registerTestLedgerIdentifier,
  registerTestLedgerIdentifierPrefix,
} from "@infra/ledger/ledger-pii";

/**
 * LEDGER PII VOCABULARY FENCE (charter #3/#7, CLAUDE.md test-vocabulary rule).
 *
 * The immutable-source PII boundary is fail-closed: a value reaches the ledger only
 * if it is a UUID, a hash, a retained-text reference, or an identifier the module
 * recognises. That recognition list is production authority - a string listed there
 * is accepted into a real tenant's hash chain forever - so it may carry ONLY reviewed
 * production, seed, demo, and golden identifiers. Test fixtures widen it through the
 * SAME shape the rest of the repo uses (registerTestSpanName, registerTestSystemActor):
 * a reserved-namespace injection seam that no shipped module can reach.
 *
 * Derived BOTH ways from the real module, so neither half can rot:
 *   1. the seams still exist and are exported (otherwise 2 resolves nothing and passes
 *      vacuously),
 *   2. no shipped module - src/ outside the test tree, or scripts/ - references either
 *      seam, keyed on RESOLVED SYMBOL so an aliased import cannot evade it,
 *   3. no entry in any shipped allowlist lives in the reserved `test` namespace,
 *      collected from every `REGISTERED_*` set the module declares rather than a list
 *      this fence would have to keep in step by hand.
 */
const LEDGER_PII = "src/infrastructure/ledger/ledger-pii.ts";
const SEAM_NAMES = [
  registerTestLedgerIdentifier.name,
  registerTestLedgerIdentifierPrefix.name,
] as const;
/** The sets the boundary is KNOWN to hold; the scan below finds them by shape. */
const EXPECTED_ALLOWLISTS = [
  "REGISTERED_RETAINED_CODES",
  "REGISTERED_RETAINED_IDENTIFIERS",
  "REGISTERED_MACHINE_IDENTIFIERS",
  "REGISTERED_INDEXED_IDENTIFIER_PREFIXES",
  "REGISTERED_VERSIONED_IDENTIFIER_PREFIXES",
];
const RESERVED_TEST_NAMESPACE = /^test(?:$|[.:-])/;

function isShipped(file: string): boolean {
  return (
    (file.startsWith("src/") && !file.startsWith("src/__tests__/")) ||
    file.startsWith("scripts/")
  );
}

function sourceFile(project: Project, file: string) {
  return project.getSourceFiles().find((candidate) =>
    normalizedPath(candidate.getFilePath()) === file
  );
}

export interface AllowlistEntry {
  readonly set: string;
  readonly value: string;
}

/** Every string literal in every `const REGISTERED_… = new Set([...])` of the module. */
export function shippedAllowlistEntries(
  project: Project,
  file: string,
): AllowlistEntry[] {
  const sf = sourceFile(project, file);
  const out: AllowlistEntry[] = [];
  for (const declaration of sf?.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  ) ?? []) {
    const set = declaration.getName();
    if (!set.startsWith("REGISTERED_")) continue;
    const initializer = declaration.getInitializer();
    if (
      !initializer ||
      !Node.isNewExpression(initializer) ||
      initializer.getExpression().getText() !== "Set"
    ) continue;
    for (const literal of initializer.getDescendantsOfKind(
      SyntaxKind.StringLiteral,
    )) {
      out.push({ set, value: literal.getLiteralText() });
    }
  }
  return out;
}

/** A shipped allowlist entry whose only possible justification is a fixture. */
export function shippedTestShapedEntries(
  project: Project,
  file: string,
): string[] {
  return shippedAllowlistEntries(project, file)
    .filter(({ value }) => RESERVED_TEST_NAMESPACE.test(value))
    .map(({ set, value }) =>
      `${file}: ${set} ships reserved-namespace entry "${value}"`
    );
}

function resolvesToSeam(
  node: Node,
  file: string,
  names: readonly string[],
): boolean {
  const symbol = node.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  const name = target?.getName();
  return Boolean(
    name &&
      names.includes(name) &&
      target?.getDeclarations().some((declaration) =>
        normalizedPath(declaration.getSourceFile().getFilePath()) === file
      ),
  );
}

/**
 * References to the test-only seams from anywhere that ships. Keyed SEMANTICALLY, never
 * on the identifier's text, so `import { registerTestLedgerIdentifier as widen }` is
 * caught at the call site.
 */
export function shippedTestSeamUses(
  project: Project,
  file: string,
  names: readonly string[],
  shipped: (path: string) => boolean = isShipped,
): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const path = normalizedPath(sf.getFilePath());
    if (!shipped(path) || path === file) continue;
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
      if (!resolvesToSeam(identifier, file, names)) continue;
      out.push(
        `${path}:${identifier.getStartLineNumber()} references ${identifier.getText()}`,
      );
    }
  }
  return out;
}

/** The seams must stay exported, or the shipped-caller scan resolves nothing. */
export function unresolvedSeams(
  project: Project,
  file: string,
  names: readonly string[],
): string[] {
  const exported = sourceFile(project, file)?.getExportedDeclarations();
  return names
    .filter((name) =>
      !(exported?.get(name) ?? []).some((declaration) =>
        normalizedPath(declaration.getSourceFile().getFilePath()) === file
      )
    )
    .map((name) =>
      `${file} no longer exports '${name}' - the shipped-caller scan would pass vacuously`
    );
}

const SEAM_MODULE = `
  export function registerTestLedgerIdentifier(value: string): string { return value; }
  export function registerTestLedgerIdentifierPrefix(value: string): string { return value; }
  const REGISTERED_MACHINE_IDENTIFIERS = new Set(["evs:GC-01:balance"]);
  export function known(value: string): boolean {
    return REGISTERED_MACHINE_IDENTIFIERS.has(value);
  }
`;

function seamFixture(consumer: string, seamModule = SEAM_MODULE): Project {
  return inMemoryProject({
    "/src/infrastructure/ledger/ledger-pii.ts": seamModule,
    "/src/infrastructure/ledger/consumer.ts": consumer,
  });
}

const FIXTURE_MODULE = "src/infrastructure/ledger/ledger-pii.ts";

describe("ledger-pii vocabulary fence (charter #3/#7)", () => {
  const project = realSemanticProject();
  const entries = shippedAllowlistEntries(project, LEDGER_PII);

  it("enforces: the allowlist scan finds the real sets (charter #4 non-vacuity)", () => {
    const sets = new Set(entries.map(({ set }) => set));
    expect(
      [...sets].sort(),
      "the REGISTERED_* scan went stale - it found no shipped allowlist",
    ).toEqual([...EXPECTED_ALLOWLISTS].sort());
    expect(entries.length).toBeGreaterThanOrEqual(50);
  });

  it("enforces: both test-only injection seams stay exported", () => {
    expect(unresolvedSeams(project, LEDGER_PII, SEAM_NAMES)).toEqual([]);
  });

  it("enforces: the seam scan resolves the REAL fixture call sites", () => {
    const anywhere = shippedTestSeamUses(
      project,
      LEDGER_PII,
      SEAM_NAMES,
      (path) => path.startsWith("src/__tests__/"),
    );
    expect(
      anywhere.length,
      "no fixture call site resolved - resolvesToSeam went stale",
    ).toBeGreaterThan(0);
  });

  it("enforces: no shipped module can widen the ledger identifier boundary", () => {
    expect(shippedTestSeamUses(project, LEDGER_PII, SEAM_NAMES)).toEqual([]);
  });

  it("enforces: no shipped allowlist entry lives in the reserved test namespace", () => {
    expect(shippedTestShapedEntries(project, LEDGER_PII)).toEqual([]);
  });

  it("enforces: the seams refuse anything outside the reserved namespace", () => {
    expect(() => registerTestLedgerIdentifier("projection:sneaky")).toThrow();
    expect(() => registerTestLedgerIdentifierPrefix("sample")).toThrow();
    expect(registerTestLedgerIdentifier("test:fence:probe")).toBe("test:fence:probe");
  });
});

describe("detects (companion — charter #4)", () => {
  it("flags a shipped module calling a test-only seam", () => {
    const uses = shippedTestSeamUses(
      seamFixture(`
        import { registerTestLedgerIdentifier } from "./ledger-pii";
        registerTestLedgerIdentifier("test:widened");
      `),
      FIXTURE_MODULE,
      SEAM_NAMES,
    );
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain("src/infrastructure/ledger/consumer.ts");
  });

  it("flags an ALIASED shipped call (keyed on symbol, not identifier text)", () => {
    const uses = shippedTestSeamUses(
      seamFixture(`
        import { registerTestLedgerIdentifierPrefix as widen } from "./ledger-pii";
        widen("test:widened");
      `),
      FIXTURE_MODULE,
      SEAM_NAMES,
    );
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain("references widen");
  });

  it("flags a test-shaped entry smuggled into a shipped allowlist", () => {
    const flagged = shippedTestShapedEntries(
      seamFixture(
        "export const unused = 1;",
        SEAM_MODULE.replace('"evs:GC-01:balance"', '"evs:GC-01:balance", "test:sneaky"'),
      ),
      FIXTURE_MODULE,
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain('"test:sneaky"');
  });

  it("flags a seam that stopped being exported (the vacuity trap)", () => {
    expect(
      unresolvedSeams(
        seamFixture(
          "export const unused = 1;",
          "export function registerTestLedgerIdentifier(v: string): string { return v; }",
        ),
        FIXTURE_MODULE,
        SEAM_NAMES,
      ),
    ).toEqual([
      `${FIXTURE_MODULE} no longer exports 'registerTestLedgerIdentifierPrefix' - the shipped-caller scan would pass vacuously`,
    ]);
  });

  it("passes a shipped module that only reads a production allowlist", () => {
    const project = seamFixture(`
      import { known } from "./ledger-pii";
      export const ok = known("evs:GC-01:balance");
    `);
    expect(shippedTestSeamUses(project, FIXTURE_MODULE, SEAM_NAMES)).toEqual([]);
    expect(shippedTestShapedEntries(project, FIXTURE_MODULE)).toEqual([]);
  });
});
