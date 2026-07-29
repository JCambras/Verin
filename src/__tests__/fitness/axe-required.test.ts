import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Node,
  Project,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type SourceFile,
} from "ts-morph";
import { REPO_ROOT } from "./_fence-utils";

const AXE_HELPER_PATH = "e2e/axe.ts";
const AXE_HELPER_EXPORT = "assertNoAxeViolations";
const REQUIRED_AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;
const REQUIRED_AXE_SPECS = [
  "e2e/smoke.spec.ts",
  "e2e/walkthrough.spec.ts",
  "e2e/demo-journey.spec.ts",
] as const;

type Callback = ArrowFunction | FunctionExpression;
type FunctionNode = Callback | FunctionDeclaration;

function importModuleOf(node: Node): string | undefined {
  return node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue();
}

function isNamedImportIdentifier(node: Node, moduleName: string, imported: string): boolean {
  if (!Node.isIdentifier(node)) return false;
  return (
    node
      .getSymbol()
      ?.getDeclarations()
      .some(
        (declaration) =>
          Node.isImportSpecifier(declaration) &&
          declaration.getName() === imported &&
          importModuleOf(declaration) === moduleName,
      ) ?? false
  );
}

function isDefaultImportIdentifier(node: Node, moduleName: string): boolean {
  if (!Node.isIdentifier(node)) return false;
  return (
    node
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => {
        const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
        return (
          importDeclaration?.getModuleSpecifierValue() === moduleName &&
          importDeclaration.getDefaultImport()?.getText() === node.getText()
        );
      }) ?? false
  );
}

function isNamedImportCall(call: CallExpression, moduleName: string, imported: string): boolean {
  return isNamedImportIdentifier(call.getExpression(), moduleName, imported);
}

function isNamedImportMemberCall(
  call: CallExpression,
  moduleName: string,
  imported: string,
  member: string,
): boolean {
  const expression = call.getExpression();
  return (
    Node.isPropertyAccessExpression(expression) &&
    expression.getName() === member &&
    isNamedImportIdentifier(expression.getExpression(), moduleName, imported)
  );
}

function isFunctionNode(node: Node): node is FunctionNode {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node);
}

function nearestFunction(node: Node): FunctionNode | undefined {
  return node.getAncestors().find(isFunctionNode);
}

function ownedCalls(fn: FunctionNode): CallExpression[] {
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => nearestFunction(call) === fn);
}

function contains(container: Node, node: Node): boolean {
  return container === node || node.getAncestors().includes(container);
}

function isStaticallyDead(node: Node, boundary: Node): boolean {
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

function isInsideTry(node: Node, boundary: Node): boolean {
  return node.getAncestors().some((ancestor) => ancestor !== boundary && Node.isTryStatement(ancestor));
}

function directCallContainer(call: CallExpression): Node | undefined {
  const statement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  return statement?.getExpression() === call ? statement.getParent() : undefined;
}

function callbackOf(call: CallExpression): Callback | undefined {
  return call.getArguments().find((argument): argument is Callback => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument));
}

function registrationScopeOf(call: CallExpression, sourceFile: SourceFile): SourceFile | Callback | undefined {
  const directContainer = directCallContainer(call);
  if (directContainer === sourceFile) return sourceFile;
  const callback = nearestFunction(call);
  if (callback === undefined || Node.isFunctionDeclaration(callback) || !Node.isBlock(callback.getBody())) return undefined;
  if (directContainer !== callback.getBody()) return undefined;
  const describeCall = callback.getParent();
  if (!Node.isCallExpression(describeCall) || !describeCall.getArguments().includes(callback)) return undefined;
  return isNamedImportMemberCall(describeCall, "@playwright/test", "test", "describe") &&
    directCallContainer(describeCall) === sourceFile
    ? callback
    : undefined;
}

function isNeutralizingAnnotation(call: CallExpression): boolean {
  return ["skip", "fixme", "fail"].some((member) =>
    isNamedImportMemberCall(call, "@playwright/test", "test", member),
  );
}

function scopeHasNeutralizingAnnotation(scope: SourceFile | Callback): boolean {
  if (Node.isSourceFile(scope)) {
    return scope
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some(isNeutralizingAnnotation);
  }
  const container = scope.getBody();
  if (!Node.isBlock(container)) return true;
  return container
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => directCallContainer(call) === container && isNeutralizingAnnotation(call));
}

function testIsDisabled(callback: Callback): boolean {
  return ownedCalls(callback).some(isNeutralizingAnnotation);
}

function specAwaitsSanctionedHelper(sourceFile: SourceFile): boolean {
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    if (!isNamedImportCall(call, "@playwright/test", "test")) return false;
    const scope = registrationScopeOf(call, sourceFile);
    if (
      scope === undefined ||
      scopeHasNeutralizingAnnotation(sourceFile) ||
      (scope !== sourceFile && scopeHasNeutralizingAnnotation(scope))
    ) {
      return false;
    }
    const callback = callbackOf(call);
    if (callback === undefined || testIsDisabled(callback)) return false;
    return ownedCalls(callback).some(
      (nested) =>
        isNamedImportCall(nested, "./axe", AXE_HELPER_EXPORT) &&
        Node.isAwaitExpression(nested.getParent()) &&
        !isStaticallyDead(nested, callback) &&
        !isInsideTry(nested, callback),
    );
  });
}

function pageArgumentUsesParameter(call: CallExpression, pageName: string): boolean {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== "withTags") return false;
  const created = expression.getExpression();
  if (!Node.isNewExpression(created)) return false;
  const config = created.getArguments()[0];
  if (!Node.isObjectLiteralExpression(config)) return false;
  const page = config.getProperty("page");
  if (Node.isShorthandPropertyAssignment(page)) return page.getName() === pageName;
  return Node.isPropertyAssignment(page) && page.getInitializer()?.getText() === pageName;
}

function configuredAxeAnalysis(
  initializer: Node,
  pageName: string,
): CallExpression | undefined {
  if (!Node.isAwaitExpression(initializer)) return undefined;
  const analysis = initializer.getExpression();
  if (!Node.isCallExpression(analysis)) return undefined;
  const analyze = analysis.getExpression();
  if (!Node.isPropertyAccessExpression(analyze) || analyze.getName() !== "analyze") return undefined;
  const withTags = analyze.getExpression();
  if (!Node.isCallExpression(withTags) || !pageArgumentUsesParameter(withTags, pageName)) return undefined;
  const constructor = withTags.getExpression();
  if (!Node.isPropertyAccessExpression(constructor)) return undefined;
  const created = constructor.getExpression();
  if (!Node.isNewExpression(created) || !isDefaultImportIdentifier(created.getExpression(), "@axe-core/playwright")) return undefined;
  const tags = withTags.getArguments()[0];
  if (!Node.isArrayLiteralExpression(tags)) return undefined;
  const values = tags.getElements().map((element) => (Node.isStringLiteral(element) ? element.getLiteralText() : ""));
  return values.length === REQUIRED_AXE_TAGS.length && REQUIRED_AXE_TAGS.every((tag, index) => values[index] === tag)
    ? analysis
    : undefined;
}

function isUnshadowedGlobal(node: Node, name: string): boolean {
  return (
    Node.isIdentifier(node) &&
    node.getText() === name &&
    (node
      .getSymbol()
      ?.getDeclarations()
      .every((declaration) => declaration.getSourceFile() !== node.getSourceFile()) ??
      true)
  );
}

function isAnimationSettlement(statement: Node, pageName: string): boolean {
  if (!Node.isExpressionStatement(statement)) return false;
  const awaited = statement.getExpression();
  if (!Node.isAwaitExpression(awaited)) return false;
  const call = awaited.getExpression();
  if (!Node.isCallExpression(call)) return false;
  const expression = call.getExpression();
  if (
    !Node.isPropertyAccessExpression(expression) ||
    expression.getName() !== "evaluate" ||
    expression.getExpression().getText() !== pageName ||
    call.getArguments().length !== 1
  ) {
    return false;
  }
  const callback = call.getArguments()[0];
  if (!Node.isArrowFunction(callback) || callback.getParameters().length !== 0) return false;
  const promiseAll = callback.getBody();
  if (!Node.isCallExpression(promiseAll) || promiseAll.getArguments().length !== 1) return false;
  const all = promiseAll.getExpression();
  if (
    !Node.isPropertyAccessExpression(all) ||
    all.getName() !== "all" ||
    !isUnshadowedGlobal(all.getExpression(), "Promise")
  ) {
    return false;
  }
  const map = promiseAll.getArguments()[0];
  if (!Node.isCallExpression(map) || map.getArguments().length !== 1) return false;
  const mapExpression = map.getExpression();
  if (!Node.isPropertyAccessExpression(mapExpression) || mapExpression.getName() !== "map") return false;
  const getAnimations = mapExpression.getExpression();
  if (!Node.isCallExpression(getAnimations) || getAnimations.getArguments().length !== 0) return false;
  const getAnimationsExpression = getAnimations.getExpression();
  if (
    !Node.isPropertyAccessExpression(getAnimationsExpression) ||
    getAnimationsExpression.getName() !== "getAnimations" ||
    !isUnshadowedGlobal(getAnimationsExpression.getExpression(), "document")
  ) {
    return false;
  }
  const animationCallback = map.getArguments()[0];
  if (!Node.isArrowFunction(animationCallback) || animationCallback.getParameters().length !== 1) return false;
  const animationName = animationCallback.getParameters()[0]!.getName();
  const finished = animationCallback.getBody();
  return (
    Node.isPropertyAccessExpression(finished) &&
    finished.getName() === "finished" &&
    finished.getExpression().getText() === animationName
  );
}

function isDirectViolationAssertion(statement: Node, resultName: string): boolean {
  if (!Node.isExpressionStatement(statement)) return false;
  const matcherCall = statement.getExpression();
  if (!Node.isCallExpression(matcherCall)) return false;
  const matcher = matcherCall.getExpression();
  if (!Node.isPropertyAccessExpression(matcher) || matcher.getName() !== "toEqual") return false;
  const expectation = matcher.getExpression();
  if (!Node.isCallExpression(expectation) || !isNamedImportCall(expectation, "@playwright/test", "expect")) return false;
  const subject = expectation.getArguments()[0];
  if (
    !Node.isPropertyAccessExpression(subject) ||
    subject.getName() !== "violations" ||
    subject.getExpression().getText() !== resultName
  ) {
    return false;
  }
  const expected = matcherCall.getArguments()[0];
  return Node.isArrayLiteralExpression(expected) && expected.getElements().length === 0;
}

function helperIsSanctioned(sourceFile: SourceFile): boolean {
  const helpers = sourceFile
    .getFunctions()
    .filter((fn) => fn.getName() === AXE_HELPER_EXPORT && fn.isExported() && fn.isAsync());
  if (helpers.length !== 1) return false;
  const helper = helpers[0]!;
  const body = helper.getBody();
  const pageName = helper.getParameters()[0]?.getName();
  if (!Node.isBlock(body) || pageName === undefined || body.getStatements().length !== 3) return false;
  const [settle, declarationStatement, assertion] = body.getStatements();
  if (!isAnimationSettlement(settle!, pageName) || !Node.isVariableStatement(declarationStatement)) return false;
  const declarations = declarationStatement.getDeclarations();
  if (declarations.length !== 1) return false;
  const declaration = declarations[0]!;
  const resultName = declaration.getNameNode();
  const initializer = declaration.getInitializer();
  if (!Node.isIdentifier(resultName) || initializer === undefined) return false;
  if (configuredAxeAnalysis(initializer, pageName) === undefined) return false;
  return isDirectViolationAssertion(assertion!, resultName.getText());
}

export function axeCoverageProblems(sources: Readonly<Record<string, string>>): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const problems: string[] = [];
  const sourceFiles = new Map<string, SourceFile>();
  for (const [path, source] of Object.entries(sources)) {
    sourceFiles.set(path, project.createSourceFile(`/${path}`, source));
  }
  const helper = sourceFiles.get(AXE_HELPER_PATH);
  if (helper === undefined) {
    problems.push(`${AXE_HELPER_PATH}:1 sanctioned Axe assertion helper is missing`);
  } else if (!helperIsSanctioned(helper)) {
    problems.push(
      `${AXE_HELPER_PATH}:1 must settle document animations without mutating the DOM, directly await the complete WCAG Axe scan, and assert its unmodified violations`,
    );
  }
  for (const path of REQUIRED_AXE_SPECS) {
    const sourceFile = sourceFiles.get(path);
    if (sourceFile === undefined) {
      problems.push(`${path}:1 required Axe E2E specification is missing`);
    } else if (!specAwaitsSanctionedHelper(sourceFile)) {
      problems.push(`${path}:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe`);
    }
  }
  return problems;
}

const VALID_HELPER = `import Axe from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
export async function assertNoAxeViolations(page: Page, context: string): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  const results = await new Axe({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations, context).toEqual([]);
}`;

const VALID_SPEC = `import { test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
test("axe", async ({ page }) => {
  await assertNoAxeViolations(page, "surface");
});`;

function completeSources(spec = VALID_SPEC, helper = VALID_HELPER): Record<string, string> {
  return {
    [AXE_HELPER_PATH]: helper,
    ...Object.fromEntries(REQUIRED_AXE_SPECS.map((path) => [path, spec])),
  };
}

describe("axe-required fence", () => {
  it("enforces: public, authenticated, and demo E2E surfaces execute the sanctioned Axe assertion", () => {
    const paths = [AXE_HELPER_PATH, ...REQUIRED_AXE_SPECS];
    const sources = Object.fromEntries(paths.map((path) => [path, readFileSync(join(REPO_ROOT, path), "utf8")]));
    const problems = axeCoverageProblems(sources);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  describe("detects (companion): accessibility enforcement cannot become false-green", () => {
    it("rejects a required spec without an awaited sanctioned scan", () => {
      const sources = completeSources();
      sources["e2e/walkthrough.spec.ts"] = `import { test } from "@playwright/test"; test("page works", async ({ page }) => page.goto("/"));`;
      expect(axeCoverageProblems(sources)).toEqual([
        "e2e/walkthrough.spec.ts:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe",
      ]);
    });

    it("accepts aliases at module scope and directly inside enabled test.describe", () => {
      const moduleSpec = `import { test as check } from "@playwright/test";
import { assertNoAxeViolations as scan } from "./axe";
check("axe", async ({ page }) => { await scan(page, "surface"); });`;
      expect(axeCoverageProblems(completeSources(moduleSpec))).toEqual([]);
      const describeSpec = `import { test as check } from "@playwright/test";
import { assertNoAxeViolations as scan } from "./axe";
check.describe("group", () => {
  check("axe", async ({ page }) => { await scan(page, "surface"); });
});`;
      expect(axeCoverageProblems(completeSources(describeSpec))).toEqual([]);
    });

    it("rejects unreachable, disabled, expected-failure, unawaited, and caught helper calls", () => {
      const wrap = (body: string) =>
        `import { test } from "@playwright/test";\nimport { assertNoAxeViolations } from "./axe";\n${body}`;
      const invalid = [
        wrap(`function neverCalled() { test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); }); }`),
        wrap(`if (false) { test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); }); }`),
        wrap(`test.${"describe" + ".skip"}("off", () => { test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); }); });`),
        wrap(`test.${"skip"}(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test.describe("group", () => { test.${"fixme"}(() => true, "suite disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); }); });`),
        wrap(`test.describe("group", () => { test.beforeEach(() => test.${"skip"}()); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); }); });`),
        wrap(`test("axe", async ({ page }) => { test.${"skip"}(); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }) => { test.${"fail"}(); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }) => { assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }) => { try { await assertNoAxeViolations(page, "surface"); } catch {} });`),
        wrap(`test("axe", async () => { const assertNoAxeViolations = async () => {}; await assertNoAxeViolations(); });`),
        wrap(`test.describe("group", () => { const test = (...args: unknown[]) => args; test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); }); });`),
      ];
      for (const spec of invalid) {
        expect(axeCoverageProblems(completeSources(spec)), spec).toHaveLength(REQUIRED_AXE_SPECS.length);
      }
    });

    it("rejects caught, transformed, incomplete, or masked helper assertions", () => {
      const invalid = [
        VALID_HELPER.replace("expect(results.violations, context).toEqual([]);", "try { expect(results.violations, context).toEqual([]); } catch {}"),
        VALID_HELPER.replace("results.violations, context", "results.violations.filter(() => false), context"),
        VALID_HELPER.replace("expect(results.violations, context)", "results.violations.length = 0;\n  expect(results.violations, context)"),
        VALID_HELPER.replace("const results = await", "const results ="),
        VALID_HELPER.replace(".withTags(", '.exclude("body").withTags('),
        VALID_HELPER.replace(
          "await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));",
          'await page.evaluate(() => { document.body.replaceChildren(); });',
        ),
        VALID_HELPER.replace(
          "await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));",
          "await page.evaluate(() => Promise.resolve());",
        ),
      ];
      for (const helper of invalid) {
        expect(axeCoverageProblems(completeSources(VALID_SPEC, helper)), helper).toContain(
          "e2e/axe.ts:1 must settle document animations without mutating the DOM, directly await the complete WCAG Axe scan, and assert its unmodified violations",
        );
      }
    });
  });
});
