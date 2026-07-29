import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { REPO_ROOT } from "./_fence-utils";

const REQUIRED_AXE_SPECS = [
  "e2e/smoke.spec.ts",
  "e2e/walkthrough.spec.ts",
  "e2e/demo-journey.spec.ts",
] as const;

function originatesFromBuilder(node: Node, builders: ReadonlySet<string>): boolean {
  if (Node.isNewExpression(node)) return builders.has(node.getExpression().getText());
  if (Node.isCallExpression(node)) return originatesFromBuilder(node.getExpression(), builders);
  if (Node.isPropertyAccessExpression(node)) return originatesFromBuilder(node.getExpression(), builders);
  if (Node.isParenthesizedExpression(node) || Node.isAwaitExpression(node)) {
    return originatesFromBuilder(node.getExpression(), builders);
  }
  return false;
}

function axeAnalysisCalls(sourceFile: SourceFile, builders: ReadonlySet<string>) {
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const expression = call.getExpression();
    return (
      Node.isPropertyAccessExpression(expression) &&
      expression.getName() === "analyze" &&
      originatesFromBuilder(expression.getExpression(), builders)
    );
  });
}

function hasTestedAxeAnalysis(sourceFile: SourceFile, builders: ReadonlySet<string>): boolean {
  const analyses = axeAnalysisCalls(sourceFile, builders);
  const helperNames = new Set(
    analyses.flatMap((analysis) => {
      const fn = analysis.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
      const name = fn?.getName();
      return name === undefined ? [] : [name];
    }),
  );
  const testNames = new Set(
    sourceFile
      .getImportDeclarations()
      .filter((declaration) => declaration.getModuleSpecifierValue() === "@playwright/test")
      .flatMap((declaration) =>
        declaration
          .getNamedImports()
          .filter((specifier) => specifier.getName() === "test")
          .map((specifier) => specifier.getAliasNode()?.getText() ?? specifier.getName()),
      ),
  );
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    if (!testNames.has(call.getExpression().getText())) return false;
    const callback = call.getArguments().find((argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument));
    if (callback === undefined) return false;
    if (analyses.some((analysis) => analysis.getAncestors().includes(callback))) return true;
    return callback
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some((nested) => helperNames.has(nested.getExpression().getText()));
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
    } else if (!hasTestedAxeAnalysis(sourceFile, builders)) {
      problems.push(`${path}:1 must execute an Axe analysis from a live Playwright test`);
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
      const valid = `import { test } from "@playwright/test";\nimport Axe from "@axe-core/playwright";\ntest("axe", async ({ page }) => { await new Axe({ page }).withTags(["wcag22aa"]).analyze(); });`;
      const sources = Object.fromEntries(REQUIRED_AXE_SPECS.map((path) => [path, valid]));
      sources["e2e/walkthrough.spec.ts"] = `import { test } from "@playwright/test";\ntest("page works", async ({ page }) => page.goto("/"));`;
      expect(axeCoverageProblems(sources)).toEqual([
        "e2e/walkthrough.spec.ts:1 must import the Axe Playwright builder",
      ]);
    });

    it("accepts aliased builders only when their analysis executes", () => {
      const valid = `import { test as check } from "@playwright/test";\nimport AccessibilityScanner from "@axe-core/playwright";\ncheck("axe", async ({ page }) => { await new AccessibilityScanner({ page }).analyze(); });`;
      const sources = Object.fromEntries(REQUIRED_AXE_SPECS.map((path) => [path, valid]));
      expect(axeCoverageProblems(sources)).toEqual([]);
    });
  });
});
