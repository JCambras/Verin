import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Node,
  Project,
  SyntaxKind,
  VariableDeclarationKind,
  type SourceFile,
} from "ts-morph";
import { parse as parseYaml } from "yaml";
import {
  ciJobRuns,
  parseCiJobs,
} from "../../../scripts/v3-gates.lib";
import {
  demoScreenArtifactProblems,
  EXPECTED_DEMO_SCREEN_ARTIFACTS,
} from "../../../scripts/demo-screen-artifacts.lib";
import {
  DEMO_SURFACES,
  type DemoSurfaceDefinition,
} from "../../app/demo/surface-contract";
import { DEMO_SEQUENCE } from "../../app/demo/model";
import { isProvablyReachable } from "./_ast-control-flow";
import { REPO_ROOT } from "./_fence-utils";

const CONTRACT_PATH = "docs/demo-contract.md";
const ROUTE_PATH = "src/app/app/demo/[station]/page.tsx";
const E2E_PATH = "e2e/demo-journey.spec.ts";
const CI_PATH = ".github/workflows/ci.yml";
const ARTIFACT_COMMAND =
  "pnpm exec tsx scripts/demo-screen-artifacts.ts";
const JOURNEY_TEST = "the seven-minute journey is clickable end-to-end on labeled fakes";
const parsedSourceFiles = new Map<string, SourceFile>();

function parsedSourceFile(path: string, source: string): SourceFile {
  const key = `${path}\0${source}`;
  const existing = parsedSourceFiles.get(key);
  if (existing !== undefined) return existing;
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile(path, source);
  parsedSourceFiles.set(key, file);
  return file;
}

function contractSurfaceNames(markdown: string): string[] {
  const section = markdown.match(
    /^## 4\. Required product surfaces\s*$([\s\S]*?)^## 5\./m,
  )?.[1];
  if (section === undefined) return [];
  return [...section.matchAll(/^(\d+)\.\s+([^\n]+)/gm)]
    .sort((left, right) => Number(left[1]) - Number(right[1]))
    .map((match) => match[2]!.replace(/\s+\(.*$/, "").trim());
}

function routeSurfaceBindings(
  source: string,
): Array<{ station: string; componentPath: string }> {
  const file = parsedSourceFile("/route.tsx", source);
  const renderer = file.getFunction("renderStation");
  const body = renderer?.getBody();
  const parameter = renderer?.getParameters()[0];
  if (
    renderer === undefined ||
    !Node.isBlock(body) ||
    parameter === undefined ||
    body.getStatements().length !== 1
  ) {
    return [];
  }
  const statement = body.getStatements()[0];
  if (!Node.isSwitchStatement(statement)) return [];
  const selector = statement.getExpression();
  if (
    !Node.isIdentifier(selector) ||
    !selector
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => declaration === parameter)
  ) {
    return [];
  }
  const clauses = statement.getCaseBlock().getClauses();
  if (!clauses.every(Node.isCaseClause)) return [];
  return clauses.flatMap((clause) => {
    const station = clause.getExpression();
    const statements = clause.getStatements();
    if (
      !Node.isStringLiteral(station) ||
      statements.length !== 1 ||
      !Node.isReturnStatement(statements[0])
    ) {
      return [];
    }
    const returned = statements[0].getExpression();
    if (!Node.isJsxSelfClosingElement(returned)) return [];
    const tag = returned.getTagNameNode();
    if (!Node.isIdentifier(tag)) return [];
    const imported = tag
      .getSymbol()
      ?.getDeclarations()
      .find(Node.isImportSpecifier);
    const moduleName = imported === undefined ? undefined : importModuleOf(imported);
    if (moduleName === undefined || !moduleName.startsWith("@app/")) return [];
    return [
      {
        station: station.getLiteralText(),
        componentPath: `src/app/${moduleName.slice("@app/".length)}.tsx`,
      },
    ];
  });
}

function importModuleOf(node: Node): string | undefined {
  return node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue();
}

function unwrapParentheses(node: Node | undefined): Node | undefined {
  let current = node;
  while (current !== undefined && Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

function routePageUsesResolvedStation(source: string): boolean {
  const file = parsedSourceFile("/route.tsx", source);
  const renderer = file.getFunction("renderStation");
  const page = file.getFunction("DemoStationPage");
  const body = page?.getBody();
  if (
    renderer === undefined ||
    page === undefined ||
    !page.isDefaultExport() ||
    !Node.isBlock(body)
  ) {
    return false;
  }
  const resolved = body
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .find((declaration) => declaration.getName() === "resolvedStation");
  const statement = resolved?.getVariableStatement();
  const initializer = resolved?.getInitializer();
  if (
    resolved === undefined ||
    statement?.getDeclarationKind() !== VariableDeclarationKind.Const ||
    statement.getParent() !== body ||
    !Node.isAsExpression(initializer) ||
    initializer.getTypeNode()?.getText() !== "DemoStation"
  ) {
    return false;
  }
  const station = initializer.getExpression();
  if (
    !Node.isIdentifier(station) ||
    station.getText() !== "station" ||
    !station
      .getSymbol()
      ?.getDeclarations()
      .some(
        (declaration) =>
          Node.isBindingElement(declaration) &&
          declaration.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ===
            page,
      )
  ) {
    return false;
  }
  const returned = unwrapParentheses(
    body.getStatements().find(Node.isReturnStatement)?.getExpression(),
  );
  if (!Node.isJsxElement(returned)) return false;
  const opening = returned.getOpeningElement();
  if (opening.getTagNameNode().getText() !== "div") return false;
  const surfaceAttribute = opening
    .getAttributes()
    .find(
      (attribute) =>
        Node.isJsxAttribute(attribute) &&
        attribute.getNameNode().getText() === "data-demo-surface",
    );
  const attributeInitializer = Node.isJsxAttribute(surfaceAttribute)
    ? surfaceAttribute.getInitializer()
    : undefined;
  const attributeExpression = Node.isJsxExpression(attributeInitializer)
    ? attributeInitializer.getExpression()
    : undefined;
  const childExpressions = returned
    .getJsxChildren()
    .filter(Node.isJsxExpression)
    .flatMap((child) => {
      const expression = child.getExpression();
      return expression === undefined ? [] : [expression];
    });
  if (
    !Node.isIdentifier(attributeExpression) ||
    attributeExpression.getSymbol() !== resolved.getSymbol() ||
    childExpressions.length !== 1 ||
    !Node.isCallExpression(childExpressions[0])
  ) {
    return false;
  }
  const call = childExpressions[0];
  const expression = call.getExpression();
  const [stationArgument, journey, ids, approved] = call.getArguments();
  return (
    Node.isIdentifier(expression) &&
    expression
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => declaration === renderer) === true &&
    call.getArguments().length === 4 &&
    Node.isIdentifier(stationArgument) &&
    stationArgument.getSymbol() === resolved.getSymbol() &&
    journey?.getText() === "journey" &&
    ids?.getText() === "ids" &&
    approved?.getText() === "approved"
  );
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

function screenshotSequence(
  source: string,
): Array<{ number: number; name: string; station: string }> {
  const file = parsedSourceFile("/demo.spec.ts", source);
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
  return statements.flatMap((statement) => {
    if (!isProvablyReachable(statement, callback)) return [];
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
    const [page, number, name, station] = call.getArguments();
    if (
      call.getArguments().length !== 4 ||
      page?.getText() !== "page" ||
      !Node.isNumericLiteral(number) ||
      !Node.isStringLiteral(name) ||
      !Node.isStringLiteral(station)
    ) {
      return [];
    }
    const value = Number(number.getLiteralText());
    return value >= 1
      ? [
          {
            number: value,
            name: name.getLiteralText(),
            station: station.getLiteralText(),
          },
        ]
      : [];
  });
}

function isRealScreenshotDeclaration(
  declarationStatement: Node | undefined,
  expectedPath: string,
): boolean {
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
    path.getInitializer()?.getText() !== expectedPath ||
    !Node.isPropertyAssignment(fullPage) ||
    fullPage.getInitializer()?.getKind() !== SyntaxKind.TrueKeyword
  ) {
    return false;
  }
  return true;
}

function isNonEmptyScreenshotAssertion(
  assertionStatement: Node | undefined,
): boolean {
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

function hasRealScreenshotHelper(source: string): boolean {
  const file = parsedSourceFile("/demo.spec.ts", source);
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
      "page,index,name,station" ||
    body.getStatements().length !== 5
  ) {
    return false;
  }
  const statements = body.getStatements();
  return (
    statements[0]?.getText() ===
      'await expect(page).toHaveURL(new RegExp(`/app/demo/${station}(?:\\\\?|$)`));' &&
    statements[1]?.getText() ===
      'await expect(page.locator(`[data-demo-surface="${station}"]`)).toBeVisible();' &&
    statements[2]?.getText() ===
      "await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));" &&
    isRealScreenshotDeclaration(
      statements[3],
      '`${SHOTS}/${String(index).padStart(2, "0")}-${name}.png`',
    ) &&
    isNonEmptyScreenshotAssertion(statements[4])
  );
}

function hasRealLauncherScreenshotHelper(source: string): boolean {
  const file = parsedSourceFile("/demo.spec.ts", source);
  const helper = file.getFunction("snapLauncher");
  const body = helper?.getBody();
  if (
    helper === undefined ||
    !helper.isAsync() ||
    !Node.isBlock(body) ||
    helper.getParameters().map((parameter) => parameter.getName()).join(",") !==
      "page" ||
    body.getStatements().length !== 5
  ) {
    return false;
  }
  const statements = body.getStatements();
  return (
    statements[0]?.getText() ===
      "await expect(page).toHaveURL(/\\/app\\/demo(?:\\?|$)/);" &&
    statements[1]?.getText() ===
      'await expect(page.locator("[data-demo-launcher]")).toBeVisible();' &&
    statements[2]?.getText() ===
      "await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));" &&
    isRealScreenshotDeclaration(
      statements[3],
      "`${SHOTS}/00-launcher.png`",
    ) &&
    isNonEmptyScreenshotAssertion(statements[4])
  );
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
  const routeBindings = surfaces.map((surface) => ({
    station: surface.station,
    componentPath: surface.componentPath,
  }));
  if (
    JSON.stringify(routeSurfaceBindings(route)) !==
    JSON.stringify(routeBindings)
  ) {
    problems.push(
      `${ROUTE_PATH}:1 dynamic demo route must render every typed surface exactly once`,
    );
  }
  if (!routePageUsesResolvedStation(route)) {
    problems.push(
      `${ROUTE_PATH}:1 dynamic demo page must pass its resolved station to the validated renderer and loaded marker`,
    );
  }

  const screenshots = surfaces.map((surface) => ({
    number: surface.number,
    name: surface.screenshotName,
    station: surface.station,
  }));
  if (
    !hasRealScreenshotHelper(e2e) ||
    JSON.stringify(screenshotSequence(e2e)) !== JSON.stringify(screenshots)
  ) {
    problems.push(
      `${E2E_PATH}:1 canonical clickable journey must capture every typed surface in contract order`,
    );
  }
  if (!hasRealLauncherScreenshotHelper(e2e)) {
    problems.push(
      `${E2E_PATH}:1 canonical launcher capture must screenshot the loaded launcher route into 00-launcher.png`,
    );
  }
  return problems;
}

export function demoArtifactCiProblems(ci: string): string[] {
  const problems: string[] = [];
  if (!ciJobRuns(parseCiJobs(ci), "e2e", ARTIFACT_COMMAND)) {
    problems.push(
      `${CI_PATH}:1 e2e must run the demo screenshot artifact validator in a dedicated blocking step`,
    );
  }
  let document: unknown;
  try {
    document = parseYaml(ci);
  } catch {
    document = undefined;
  }
  const jobs = (document as { jobs?: unknown } | undefined)?.jobs;
  const e2eJob =
    jobs !== null && typeof jobs === "object" && !Array.isArray(jobs)
      ? (jobs as Record<string, unknown>).e2e
      : undefined;
  const steps = (e2eJob as { steps?: unknown } | undefined)?.steps;
  const hasFailClosedUpload =
    Array.isArray(steps) &&
    steps.some((step) => {
      const candidate = step as
        | { uses?: unknown; with?: unknown }
        | null;
      const settings = candidate?.with;
      if (
        typeof candidate?.uses !== "string" ||
        !candidate.uses.startsWith("actions/upload-artifact@") ||
        settings === null ||
        typeof settings !== "object" ||
        Array.isArray(settings)
      ) {
        return false;
      }
      const values = settings as Record<string, unknown>;
      return (
        values.name === "demo-screens" &&
        values.path === "demo-screens/" &&
        values["if-no-files-found"] === "error"
      );
    });
  if (!hasFailClosedUpload) {
    problems.push(
      `${CI_PATH}:1 demo-screens upload must fail when the expected artifact directory is missing`,
    );
  }
  return problems;
}

const contract = readFileSync(join(REPO_ROOT, CONTRACT_PATH), "utf8");
const route = readFileSync(join(REPO_ROOT, ROUTE_PATH), "utf8");
const e2e = readFileSync(join(REPO_ROOT, E2E_PATH), "utf8");
const ci = readFileSync(join(REPO_ROOT, CI_PATH), "utf8");
const exists = (path: string) => existsSync(join(REPO_ROOT, path));

describe("demo-surface-completeness fence", () => {
  it("enforces: every demo-contract §4 surface is typed, routed, clickable, and screenshotted", () => {
    const problems = [
      ...surfaceCompletenessProblems(
        contract,
        DEMO_SURFACES,
        route,
        e2e,
        exists,
      ),
      ...demoArtifactCiProblems(ci),
    ];
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

      const wrongRouteBinding = route.replace(
        "return <RecordSurface vm={journey.record} {...ids} />;",
        "return <WorkspaceSurface vm={journey.workspace} {...ids} />;",
      );
      expect(
        surfaceCompletenessProblems(
          contract,
          DEMO_SURFACES,
          wrongRouteBinding,
          e2e,
          exists,
        ),
      ).not.toEqual([]);

      for (const disconnectedPage of [
        route.replace(
          "renderStation(resolvedStation, journey, ids, approved)",
          'renderStation("workspace", journey, ids, approved)',
        ),
        route.replace(
          "data-demo-surface={resolvedStation}",
          'data-demo-surface="workspace"',
        ),
      ]) {
        expect(
          surfaceCompletenessProblems(
            contract,
            DEMO_SURFACES,
            disconnectedPage,
            e2e,
            exists,
          ),
          disconnectedPage,
        ).not.toEqual([]);
      }

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
        '  await snap(page, 12, "record", "record");',
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
          '  await snap(page, 12, "record", "record");',
          '  snap(page, 12, "record", "record");',
        ),
        e2e.replace(
          '  await snap(page, 12, "record", "record");',
          '  if (false) { await snap(page, 12, "record", "record"); }',
        ),
        e2e.replace(
          '  await snap(page, 12, "record", "record");',
          '  return;\n  await snap(page, 12, "record", "record");',
        ),
        e2e.replace(
          '  await snap(page, 12, "record", "record");',
          '  if (true) return;\n  await snap(page, 12, "record", "record");',
        ),
        e2e.replace(
          '  await snap(page, 12, "record", "record");',
          '  await snap(page, 12, "record", "workspace");',
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

      const launcherScreenshotLine =
        '  const screenshot = await page.screenshot({ path: `${SHOTS}/00-launcher.png`, fullPage: true });';
      for (const invalidLauncher of [
        e2e.replace(
          launcherScreenshotLine,
          '  const screenshot = Buffer.from("not a screenshot");',
        ),
        e2e.replace(
          launcherScreenshotLine,
          launcherScreenshotLine.replace(" = await ", " = "),
        ),
        e2e.replace(
          launcherScreenshotLine,
          launcherScreenshotLine.replace(
            "`${SHOTS}/00-launcher.png`",
            '"other.png"',
          ),
        ),
        e2e.replace(
          '  await expect(page).toHaveURL(/\\/app\\/demo(?:\\?|$)/);',
          "  await expect(page).toHaveURL(/.*/);",
        ),
        e2e.replace(
          '  await expect(page.locator("[data-demo-launcher]")).toBeVisible();',
          '  await expect(page.locator("body")).toBeVisible();',
        ),
      ]) {
        expect(
          surfaceCompletenessProblems(
            contract,
            DEMO_SURFACES,
            route,
            invalidLauncher,
            exists,
          ),
          invalidLauncher,
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
        e2e.replace(
          '  await expect(page).toHaveURL(new RegExp(`/app/demo/${station}(?:\\\\?|$)`));',
          '  await expect(page).toHaveURL(/.*/);',
        ),
        e2e.replace(
          '  await expect(page.locator(`[data-demo-surface="${station}"]`)).toBeVisible();',
          '  await expect(page.locator("body")).toBeVisible();',
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

    it("rejects missing, empty, or non-blocking screenshot artifacts", () => {
      const complete = EXPECTED_DEMO_SCREEN_ARTIFACTS.map((name) => ({
        name,
        size: 1,
      }));
      expect(demoScreenArtifactProblems(complete)).toEqual([]);
      expect(demoScreenArtifactProblems(complete.slice(1))).toContain(
        "missing screenshot artifact '00-launcher.png'",
      );
      expect(
        demoScreenArtifactProblems([
          ...complete.slice(0, -1),
          { name: complete.at(-1)!.name, size: 0 },
        ]),
      ).toContain(
        `empty screenshot artifact '${complete.at(-1)!.name}'`,
      );
      expect(
        demoArtifactCiProblems(
          ci.replace(
            `        run: ${ARTIFACT_COMMAND}`,
            "        run: echo skipped",
          ),
        ),
      ).toContain(
        `${CI_PATH}:1 e2e must run the demo screenshot artifact validator in a dedicated blocking step`,
      );
      expect(
        demoArtifactCiProblems(
          ci.replace("          if-no-files-found: error\n", ""),
        ),
      ).toContain(
        `${CI_PATH}:1 demo-screens upload must fail when the expected artifact directory is missing`,
      );
    });
  });
});
