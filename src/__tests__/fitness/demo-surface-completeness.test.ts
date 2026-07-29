import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Node,
  Project,
  SyntaxKind,
  VariableDeclarationKind,
} from "ts-morph";
import {
  DEMO_SURFACES,
  type DemoSurfaceDefinition,
} from "../../app/demo/surface-contract";
import { DEMO_SEQUENCE } from "../../app/demo/model";
import { REPO_ROOT } from "./_fence-utils";

const CONTRACT_PATH = "docs/demo-contract.md";
const ROUTE_PATH = "src/app/app/demo/[station]/page.tsx";
const E2E_PATH = "e2e/demo-journey.spec.ts";
const JOURNEY_TEST = "the seven-minute journey is clickable end-to-end on labeled fakes";

function contractSurfaceNames(markdown: string): string[] {
  const section = markdown.match(
    /^## 4\. Required product surfaces\s*$([\s\S]*?)^## 5\./m,
  )?.[1];
  if (section === undefined) return [];
  return [...section.matchAll(/^(\d+)\.\s+([^\n]+)/gm)]
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => match[2]!.replace(/\s+\(.*$/, "").trim());
}

function switchStations(source: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/route.tsx", source);
  return file
    .getDescendantsOfKind(SyntaxKind.CaseClause)
    .map((clause) => clause.getExpression())
    .filter(Node.isStringLiteral)
    .map((literal) => literal.getLiteralText());
}

function importModuleOf(node: Node): string | undefined {
  return node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue();
}

function isNamedImportIdentifier(
  node: Node,
  moduleName: string,
  imported: string,
): boolean {
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

function screenshotSequence(source: string): Array<{ number: number; name: string }> {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/demo.spec.ts", source);
  const registration = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => {
      const [title] = call.getArguments();
      const statement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
      return (
        isNamedImportIdentifier(call.getExpression(), "@playwright/test", "test") &&
        statement?.getExpression() === call &&
        statement.getParent() === file &&
        Node.isStringLiteral(title) &&
        title.getLiteralText() === JOURNEY_TEST
      );
    });
  const callback = registration
    ?.getArguments()
    .find(
      (argument) =>
        Node.isArrowFunction(argument) || Node.isFunctionExpression(argument),
    );
  const body = callback?.getBody();
  const helper = file.getFunction("snap");
  if (
    callback === undefined ||
    !callback.isAsync() ||
    !Node.isBlock(body) ||
    helper === undefined
  ) {
    return [];
  }
  const statements = body.getStatements();
  return statements.flatMap((statement, index) => {
    if (
      statements
        .slice(0, index)
        .some(
          (preceding) =>
            Node.isReturnStatement(preceding) ||
            Node.isThrowStatement(preceding),
        )
    ) {
      return [];
    }
    if (!Node.isExpressionStatement(statement)) return [];
    const awaited = statement.getExpression();
    if (!Node.isAwaitExpression(awaited)) return [];
    const call = awaited.getExpression();
    if (!Node.isCallExpression(call)) return [];
    const expression = call.getExpression();
    if (
      !Node.isIdentifier(expression) ||
      !expression
        .getSymbol()
        ?.getDeclarations()
        .some((declaration) => declaration === helper)
    ) {
      return [];
    }
    const [page, number, name] = call.getArguments();
    if (
      call.getArguments().length !== 3 ||
      page?.getText() !== "page" ||
      !Node.isNumericLiteral(number) ||
      !Node.isStringLiteral(name)
    ) {
      return [];
    }
    const value = Number(number.getLiteralText());
    return value >= 1
      ? [{ number: value, name: name.getLiteralText() }]
      : [];
  });
}

function hasRealScreenshotHelper(source: string): boolean {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("/demo.spec.ts", source);
  const helper = file.getFunction("snap");
  const body = helper?.getBody();
  const shots = file.getVariableDeclaration("SHOTS")?.getInitializer();
  if (
    helper === undefined ||
    !helper.isAsync() ||
    !Node.isBlock(body) ||
    !Node.isStringLiteral(shots) ||
    shots.getLiteralText() !== "demo-screens" ||
    file.getVariableDeclaration("SHOTS")?.getVariableStatement()?.getDeclarationKind() !==
      VariableDeclarationKind.Const ||
    helper.getParameters().map((parameter) => parameter.getName()).join(",") !==
      "page,index,name" ||
    body.getStatements().length !== 3
  ) {
    return false;
  }
  const settlement = body.getStatements()[0];
  if (
    settlement?.getText() !==
    "await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));"
  ) {
    return false;
  }
  const declarationStatement = body.getStatements()[1];
  if (!Node.isVariableStatement(declarationStatement)) return false;
  const declarations = declarationStatement.getDeclarations();
  if (declarations.length !== 1) return false;
  const declaration = declarations[0]!;
  if (declaration.getName() !== "screenshot") return false;
  const awaited = declaration.getInitializer();
  if (!Node.isAwaitExpression(awaited)) return false;
  const call = awaited.getExpression();
  if (!Node.isCallExpression(call) || call.getArguments().length !== 1) {
    return false;
  }
  const expression = call.getExpression();
  if (
    !Node.isPropertyAccessExpression(expression) ||
    expression.getExpression().getText() !== "page" ||
    expression.getName() !== "screenshot"
  ) {
    return false;
  }
  const options = call.getArguments()[0];
  if (
    !Node.isObjectLiteralExpression(options) ||
    options.getProperties().some(Node.isSpreadAssignment)
  ) {
    return false;
  }
  const path = options.getProperty("path");
  const fullPage = options.getProperty("fullPage");
  if (
    !Node.isPropertyAssignment(path) ||
    path.getInitializer()?.getText() !==
      '`${SHOTS}/${String(index).padStart(2, "0")}-${name}.png`' ||
    !Node.isPropertyAssignment(fullPage) ||
    fullPage.getInitializer()?.getKind() !== SyntaxKind.TrueKeyword
  ) {
    return false;
  }
  const assertionStatement = body.getStatements()[2];
  if (!Node.isExpressionStatement(assertionStatement)) return false;
  const assertion = assertionStatement.getExpression();
  if (!Node.isCallExpression(assertion) || assertion.getArguments().length !== 1) {
    return false;
  }
  const matcher = assertion.getExpression();
  if (
    !Node.isPropertyAccessExpression(matcher) ||
    matcher.getName() !== "toBeGreaterThan"
  ) {
    return false;
  }
  const expectation = matcher.getExpression();
  if (
    !Node.isCallExpression(expectation) ||
    !isNamedImportIdentifier(
      expectation.getExpression(),
      "@playwright/test",
      "expect",
    ) ||
    expectation.getArguments().length !== 1 ||
    expectation.getArguments()[0]?.getText() !== "screenshot.byteLength"
  ) {
    return false;
  }
  const threshold = assertion.getArguments()[0];
  return Node.isNumericLiteral(threshold) && threshold.getLiteralText() === "0";
}

export function surfaceCompletenessProblems(
  contract: string,
  surfaces: readonly DemoSurfaceDefinition[],
  route: string,
  e2e: string,
  exists: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  const contractNames = contractSurfaceNames(contract);
  const surfaceNames = surfaces.map((surface) => surface.contractName);
  if (contractNames.length === 0) {
    problems.push(`${CONTRACT_PATH}:1 required product surface list is missing`);
  } else if (JSON.stringify(surfaceNames) !== JSON.stringify(contractNames)) {
    problems.push(
      `${CONTRACT_PATH}:1 typed demo surface manifest does not exactly match the ordered §4 surface contract`,
    );
  }

  const expectedNumbers = surfaces.map((_, index) => index + 1);
  if (
    JSON.stringify(surfaces.map((surface) => surface.number)) !==
    JSON.stringify(expectedNumbers)
  ) {
    problems.push(
      "src/app/demo/surface-contract.ts:1 surface numbers must be complete, unique, and ordered",
    );
  }
  for (const key of ["station", "componentPath", "screenshotName"] as const) {
    const values = surfaces.map((surface) => surface[key]);
    if (new Set(values).size !== values.length) {
      problems.push(
        `src/app/demo/surface-contract.ts:1 surface ${key} values must be unique`,
      );
    }
  }
  for (const surface of surfaces) {
    if (!exists(surface.componentPath)) {
      problems.push(`${surface.componentPath}:1 required surface component is missing`);
    }
  }

  const stations = surfaces.map((surface) => surface.station);
  if (JSON.stringify(stations) !== JSON.stringify(DEMO_SEQUENCE)) {
    problems.push(
      "src/app/demo/model.ts:1 demo route sequence must exactly match the typed surface manifest",
    );
  }
  if (JSON.stringify(switchStations(route)) !== JSON.stringify(stations)) {
    problems.push(
      `${ROUTE_PATH}:1 dynamic demo route must render every typed surface exactly once`,
    );
  }

  const screenshots = surfaces.map((surface) => ({
    number: surface.number,
    name: surface.screenshotName,
  }));
  if (
    !hasRealScreenshotHelper(e2e) ||
    JSON.stringify(screenshotSequence(e2e)) !== JSON.stringify(screenshots)
  ) {
    problems.push(
      `${E2E_PATH}:1 canonical clickable journey must capture every typed surface in contract order`,
    );
  }
  return problems;
}

const contract = readFileSync(join(REPO_ROOT, CONTRACT_PATH), "utf8");
const route = readFileSync(join(REPO_ROOT, ROUTE_PATH), "utf8");
const e2e = readFileSync(join(REPO_ROOT, E2E_PATH), "utf8");
const exists = (path: string) => existsSync(join(REPO_ROOT, path));

describe("demo-surface-completeness fence", () => {
  it("enforces: every demo-contract §4 surface is typed, routed, clickable, and screenshotted", () => {
    const problems = surfaceCompletenessProblems(
      contract,
      DEMO_SURFACES,
      route,
      e2e,
      exists,
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  describe("detects (companion): incomplete surface contracts cannot pass", () => {
    it("rejects a dropped contract, manifest, route, component, or screenshot", () => {
      const missingContract = contract.replace(
        "12. Printable examiner-grade decision artifact",
        "Printable examiner-grade decision artifact",
      );
      expect(
        surfaceCompletenessProblems(
          missingContract,
          DEMO_SURFACES,
          route,
          e2e,
          exists,
        ),
      ).not.toEqual([]);

      const missingSurface = DEMO_SURFACES.slice(0, -1);
      expect(
        surfaceCompletenessProblems(contract, missingSurface, route, e2e, exists),
      ).not.toEqual([]);

      const missingRoute = route.replace('    case "record":', '    case "removed":');
      expect(
        surfaceCompletenessProblems(
          contract,
          DEMO_SURFACES,
          missingRoute,
          e2e,
          exists,
        ),
      ).not.toEqual([]);

      expect(
        surfaceCompletenessProblems(
          contract,
          DEMO_SURFACES,
          route,
          e2e,
          (path) => path !== DEMO_SURFACES[0]!.componentPath && exists(path),
        ),
      ).not.toEqual([]);

      const missingScreenshot = e2e.replace(
        '  await snap(page, 12, "record");',
        "",
      );
      expect(
        surfaceCompletenessProblems(
          contract,
          DEMO_SURFACES,
          route,
          missingScreenshot,
          exists,
        ),
      ).not.toEqual([]);

      for (const invalidCall of [
        e2e.replace(
          '  await snap(page, 12, "record");',
          '  snap(page, 12, "record");',
        ),
        e2e.replace(
          '  await snap(page, 12, "record");',
          '  if (false) { await snap(page, 12, "record"); }',
        ),
        e2e.replace(
          '  await snap(page, 12, "record");',
          '  return;\n  await snap(page, 12, "record");',
        ),
      ]) {
        expect(
          surfaceCompletenessProblems(
            contract,
            DEMO_SURFACES,
            route,
            invalidCall,
            exists,
          ),
          invalidCall,
        ).not.toEqual([]);
      }

      const screenshotLine =
        '  const screenshot = await page.screenshot({ path: `${SHOTS}/${String(index).padStart(2, "0")}-${name}.png`, fullPage: true });';
      for (const invalidHelper of [
        e2e.replace(
          screenshotLine,
          screenshotLine.replace(" = await ", " = "),
        ),
        e2e.replace(
          screenshotLine,
          screenshotLine.replace("page.screenshot", "other.screenshot"),
        ),
        e2e.replace(
          screenshotLine,
          `  let screenshot = Buffer.alloc(0);
  if (false) {
    screenshot = await page.screenshot({ path: \`\${SHOTS}/\${String(index).padStart(2, "0")}-\${name}.png\`, fullPage: true });
  }`,
        ),
        e2e.replace("  expect(screenshot.byteLength).toBeGreaterThan(0);", ""),
        e2e.replace('const SHOTS = "demo-screens";', 'const SHOTS = "other";'),
        e2e.replace(
          "  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));",
          "  return;",
        ),
      ]) {
        expect(
          surfaceCompletenessProblems(
            contract,
            DEMO_SURFACES,
            route,
            invalidHelper,
            exists,
          ),
          invalidHelper,
        ).not.toEqual([]);
      }
    });
  });
});
