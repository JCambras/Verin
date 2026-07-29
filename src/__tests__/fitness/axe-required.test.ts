import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type SourceFile,
} from "ts-morph";
import { REPO_ROOT } from "./_fence-utils";

const REQUIRED_AXE_SPECS = [
  "e2e/smoke.spec.ts",
  "e2e/walkthrough.spec.ts",
  "e2e/demo-journey.spec.ts",
] as const;

type ScanFunction = ArrowFunction | FunctionDeclaration | FunctionExpression;

function originatesFromBuilder(node: Node, builders: ReadonlySet<string>): boolean {
  if (Node.isNewExpression(node)) return builders.has(node.getExpression().getText());
  if (Node.isCallExpression(node)) return originatesFromBuilder(node.getExpression(), builders);
  if (Node.isPropertyAccessExpression(node)) return originatesFromBuilder(node.getExpression(), builders);
  if (Node.isParenthesizedExpression(node) || Node.isAwaitExpression(node)) {
    return originatesFromBuilder(node.getExpression(), builders);
  }
  return false;
}

function isScanFunction(node: Node): node is ScanFunction {
  return Node.isArrowFunction(node) || Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node);
}

function nearestFunction(node: Node): ScanFunction | undefined {
  return node.getAncestors().find(isScanFunction);
}

function ownedCalls(fn: ScanFunction) {
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => nearestFunction(call) === fn);
}

function axeAnalysisCalls(fn: ScanFunction, builders: ReadonlySet<string>) {
  return ownedCalls(fn).filter((call) => {
    const expression = call.getExpression();
    return (
      Node.isPropertyAccessExpression(expression) &&
      expression.getName() === "analyze" &&
      originatesFromBuilder(expression.getExpression(), builders)
    );
  });
}

function contains(container: Node, node: Node): boolean {
  return container === node || node.getAncestors().includes(container);
}

function isStaticallyDead(node: Node, boundary?: Node): boolean {
  for (const ancestor of node.getAncestors()) {
    if (ancestor === boundary) break;
    if (Node.isIfStatement(ancestor)) {
      const condition = ancestor.getExpression().getKind();
      if (condition === SyntaxKind.FalseKeyword && contains(ancestor.getThenStatement(), node)) return true;
      if (condition === SyntaxKind.TrueKeyword && ancestor.getElseStatement() !== undefined && contains(ancestor.getElseStatement()!, node)) return true;
    }
    if (Node.isConditionalExpression(ancestor)) {
      const condition = ancestor.getCondition().getKind();
      if (condition === SyntaxKind.FalseKeyword && contains(ancestor.getWhenTrue(), node)) return true;
      if (condition === SyntaxKind.TrueKeyword && contains(ancestor.getWhenFalse(), node)) return true;
    }
    if (Node.isBlock(ancestor)) {
      const statements = ancestor.getStatements();
      const index = statements.findIndex((statement) => contains(statement, node));
      if (index > 0 && statements.slice(0, index).some((statement) => Node.isReturnStatement(statement) || Node.isThrowStatement(statement))) return true;
    }
  }
  return false;
}

function isAwaited(call: Node): boolean {
  return call.getParent()?.getKind() === SyntaxKind.AwaitExpression;
}

function referencesNames(node: Node, names: ReadonlySet<string>): boolean {
  if (Node.isIdentifier(node) && names.has(node.getText())) return true;
  return node.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => names.has(identifier.getText()));
}

function referencesViolations(node: Node, resultNames: ReadonlySet<string>): boolean {
  const accesses = [
    ...(Node.isPropertyAccessExpression(node) ? [node] : []),
    ...node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
  ];
  return accesses.some((access) => access.getName() === "violations" && referencesNames(access.getExpression(), resultNames));
}

function assertionFailsOnViolations(
  fn: ScanFunction,
  expectNames: ReadonlySet<string>,
  resultNames: ReadonlySet<string>,
): boolean {
  const derivedNames = new Set<string>();
  const declarations = fn
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((declaration) => nearestFunction(declaration) === fn && !isStaticallyDead(declaration, fn));
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(name) || initializer === undefined || derivedNames.has(name.getText())) continue;
      if (referencesViolations(initializer, resultNames) || referencesNames(initializer, derivedNames)) {
        derivedNames.add(name.getText());
        changed = true;
      }
    }
  }
  const isDerived = (node: Node) => referencesViolations(node, resultNames) || referencesNames(node, derivedNames);

  return ownedCalls(fn).some((call) => {
    if (isStaticallyDead(call, fn)) return false;
    const matcher = call.getExpression();
    if (!Node.isPropertyAccessExpression(matcher)) return false;
    const expectation = matcher.getExpression();
    if (!Node.isCallExpression(expectation) || !expectNames.has(expectation.getExpression().getText())) return false;
    const subject = expectation.getArguments()[0];
    const expected = call.getArguments()[0];
    if (subject === undefined || expected === undefined) return false;
    if (
      (matcher.getName() === "toEqual" || matcher.getName() === "toStrictEqual") &&
      Node.isArrayLiteralExpression(expected) &&
      expected.getElements().length === 0
    ) {
      return isDerived(subject);
    }
    if (matcher.getName() === "toHaveLength" && expected.getText() === "0") return isDerived(subject);
    return (
      matcher.getName() === "toBe" &&
      expected.getText() === "0" &&
      Node.isPropertyAccessExpression(subject) &&
      subject.getName() === "length" &&
      isDerived(subject.getExpression())
    );
  });
}

function functionHasGatingAnalysis(
  fn: ScanFunction,
  builders: ReadonlySet<string>,
  expectNames: ReadonlySet<string>,
): boolean {
  return axeAnalysisCalls(fn, builders).some((analysis) => {
    if (!isAwaited(analysis) || isStaticallyDead(analysis, fn)) return false;
    const declaration = analysis.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (declaration === undefined || nearestFunction(declaration) !== fn) return false;
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(name) || initializer === undefined || !contains(initializer, analysis)) return false;
    return assertionFailsOnViolations(fn, expectNames, new Set([name.getText()]));
  });
}

function importedNames(sourceFile: SourceFile, imported: string): Set<string> {
  return new Set(
    sourceFile
      .getImportDeclarations()
      .filter((declaration) => declaration.getModuleSpecifierValue() === "@playwright/test")
      .flatMap((declaration) =>
        declaration
          .getNamedImports()
          .filter((specifier) => specifier.getName() === imported)
          .map((specifier) => specifier.getAliasNode()?.getText() ?? specifier.getName()),
      ),
  );
}

function isDisabledTest(call: Node, callback: ScanFunction, testNames: ReadonlySet<string>): boolean {
  const disabled = new Set(
    [...testNames].flatMap((name) => [`${name}.skip`, `${name}.fixme`, `${name}.describe${".skip"}`, `${name}.describe${".fixme"}`]),
  );
  if (
    call
      .getAncestors()
      .filter(Node.isCallExpression)
      .some((ancestor) => disabled.has(ancestor.getExpression().getText()))
  ) {
    return true;
  }
  return ownedCalls(callback).some((nested) => disabled.has(nested.getExpression().getText()));
}

function hasTestedAxeAnalysis(
  sourceFile: SourceFile,
  builders: ReadonlySet<string>,
  testNames: ReadonlySet<string>,
  expectNames: ReadonlySet<string>,
): boolean {
  const helperNames = new Set(
    sourceFile
      .getDescendantsOfKind(SyntaxKind.FunctionDeclaration)
      .filter((fn) => fn.getName() !== undefined && !isStaticallyDead(fn) && functionHasGatingAnalysis(fn, builders, expectNames))
      .map((fn) => fn.getName()!),
  );
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    if (!testNames.has(call.getExpression().getText())) return false;
    const callback = call.getArguments().find((argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument));
    if (callback === undefined || isStaticallyDead(call) || isDisabledTest(call, callback, testNames)) return false;
    if (functionHasGatingAnalysis(callback, builders, expectNames)) return true;
    return ownedCalls(callback).some(
      (nested) =>
        helperNames.has(nested.getExpression().getText()) &&
        isAwaited(nested) &&
        !isStaticallyDead(nested, callback),
    );
  });
}

export function axeCoverageProblems(sources: Readonly<Record<string, string>>): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const problems: string[] = [];
  for (const path of REQUIRED_AXE_SPECS) {
    const source = sources[path];
    if (source === undefined) {
      problems.push(`${path}:1 required Axe E2E specification is missing`);
      continue;
    }
    const sourceFile = project.createSourceFile(`/${path}`, source);
    const builders = new Set(
      sourceFile
        .getImportDeclarations()
        .filter((declaration) => declaration.getModuleSpecifierValue() === "@axe-core/playwright")
        .flatMap((declaration) => {
          const defaultImport = declaration.getDefaultImport();
          return defaultImport === undefined ? [] : [defaultImport.getText()];
        }),
    );
    if (builders.size === 0) {
      problems.push(`${path}:1 must import the Axe Playwright builder`);
    } else if (!hasTestedAxeAnalysis(sourceFile, builders, importedNames(sourceFile, "test"), importedNames(sourceFile, "expect"))) {
      problems.push(`${path}:1 must execute an enabled, reachable, awaited Axe analysis whose violations fail the Playwright test`);
    }
  }
  return problems;
}

describe("axe-required fence", () => {
  it("enforces: public, authenticated, and demo E2E surfaces execute Axe", () => {
    const sources = Object.fromEntries(
      REQUIRED_AXE_SPECS.map((path) => [path, readFileSync(join(REPO_ROOT, path), "utf8")]),
    );
    const problems = axeCoverageProblems(sources);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  describe("detects (companion): removing an Axe scan cannot leave accessibility enforcement green", () => {
    it("rejects a required spec with ordinary browser assertions but no Axe analysis", () => {
      const valid = `import { test, expect } from "@playwright/test";\nimport Axe from "@axe-core/playwright";\ntest("axe", async ({ page }) => { const results = await new Axe({ page }).withTags(["wcag22aa"]).analyze(); expect(results.violations).toEqual([]); });`;
      const sources = Object.fromEntries(REQUIRED_AXE_SPECS.map((path) => [path, valid]));
      sources["e2e/walkthrough.spec.ts"] = `import { test } from "@playwright/test";\ntest("page works", async ({ page }) => page.goto("/"));`;
      expect(axeCoverageProblems(sources)).toEqual([
        "e2e/walkthrough.spec.ts:1 must import the Axe Playwright builder",
      ]);
    });

    it("accepts aliased builders only when their analysis executes", () => {
      const valid = `import { test as check, expect as verify } from "@playwright/test";\nimport AccessibilityScanner from "@axe-core/playwright";\ncheck("axe", async ({ page }) => { const results = await new AccessibilityScanner({ page }).analyze(); const serious = results.violations.filter(Boolean); verify(serious.map((item) => item.id)).toStrictEqual([]); });`;
      const sources = Object.fromEntries(REQUIRED_AXE_SPECS.map((path) => [path, valid]));
      expect(axeCoverageProblems(sources)).toEqual([]);
    });

    it("rejects skipped, dead, unawaited, and unasserted Axe scans", () => {
      const wrap = (body: string) =>
        `import { test, expect } from "@playwright/test";\nimport Axe from "@axe-core/playwright";\n${body}`;
      const invalid = [
        wrap(`test.${"describe" + ".skip"}("off", () => { test("axe", async ({ page }) => { const results = await new Axe({ page }).analyze(); expect(results.violations).toEqual([]); }); });`),
        wrap(`test("axe", async ({ page }) => { if (false) { const results = await new Axe({ page }).analyze(); expect(results.violations).toEqual([]); } });`),
        wrap(`test("axe", async ({ page }) => { return; const results = await new Axe({ page }).analyze(); expect(results.violations).toEqual([]); });`),
        wrap(`test("axe", async ({ page }) => { const results = new Axe({ page }).analyze(); expect(results).toBeDefined(); });`),
        wrap(`test("axe", async ({ page }) => { await new Axe({ page }).analyze(); expect([]).toEqual([]); });`),
        wrap(`test("axe", async ({ page }) => { test.${"skip"}(); const results = await new Axe({ page }).analyze(); expect(results.violations).toEqual([]); });`),
      ];
      for (const source of invalid) {
        const sources = Object.fromEntries(REQUIRED_AXE_SPECS.map((path) => [path, source]));
        expect(axeCoverageProblems(sources), source).toHaveLength(REQUIRED_AXE_SPECS.length);
      }
    });

    it("requires an Axe helper to assert violations and be awaited by an enabled test", () => {
      const helper = `import { test, expect } from "@playwright/test";\nimport Axe from "@axe-core/playwright";\nasync function check(page: unknown) { const results = await new Axe({ page }).analyze(); expect(results.violations).toHaveLength(0); }\ntest("axe", async ({ page }) => { await check(page); });`;
      const sources = Object.fromEntries(REQUIRED_AXE_SPECS.map((path) => [path, helper]));
      expect(axeCoverageProblems(sources)).toEqual([]);
      sources["e2e/demo-journey.spec.ts"] = helper.replace("await check(page)", "check(page)");
      expect(axeCoverageProblems(sources)).toEqual([
        "e2e/demo-journey.spec.ts:1 must execute an enabled, reachable, awaited Axe analysis whose violations fail the Playwright test",
      ]);
    });
  });
});
