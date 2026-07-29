import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Node,
  Project,
  SyntaxKind,
  VariableDeclarationKind,
  type ArrowFunction,
  type FunctionExpression,
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
import {
  dispositionFor,
  FIRMS,
  SCENARIOS,
} from "../../app/demo/data";
import { getJourney } from "../../app/demo/journey";
import { DEMO_SEQUENCE } from "../../app/demo/model";
import { isProvablyReachable } from "./_ast-control-flow";
import { REPO_ROOT } from "./_fence-utils";

const CONTRACT_PATH = "docs/demo-contract.md";
const RATIFIED_CONTRACT_PATH = "docs/v3/verin-demo-contract-v1.md";
const ROUTE_PATH = "src/app/app/demo/[station]/page.tsx";
const E2E_PATH = "e2e/demo-journey.spec.ts";
const CI_PATH = ".github/workflows/ci.yml";
const ARTIFACT_COMMAND =
  "pnpm exec tsx scripts/demo-screen-artifacts.ts";
const JOURNEY_TEST = "the seven-minute journey is clickable end-to-end on labeled fakes";
const CANONICAL_JOURNEY_CONTROLS = [
  "link:Demo",
  "link:Run the seven-minute journey",
  "link:Ask Verin about this household",
  "link:Gather evidence",
  "link:View the recommendation",
  "link:View the policy trace",
  "link:Continue to authority",
  "link:Approve this movement",
  "button:Verify source",
  "link:Execute the movement",
  "link:View verification",
  "link:Compare Firm A and Firm B",
  "link:Author a policy change",
  "link:Approve and activate FA-4.3",
  "link:View the printable decision record",
] as const;
const RATIFIED_SURFACE_RATCHET = [
  "Household workspace",
  "Contextual intent panel",
  "Evidence and conflict view",
  "Recommendation and alternatives",
  "Policy and precedence trace",
  "Approval stages and actor status",
  "Pre-execution safety check",
  "Execution timeline",
  "Verification state",
  "Firm A / Firm B comparison",
  "Policy draft and simulation impact",
  "Printable examiner-grade decision artifact",
] as const;
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

type Callback = ArrowFunction | FunctionExpression;

function canonicalJourneyCallback(file: SourceFile): Callback | undefined {
  const registration = file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .find((call) => {
      const [title] = call.getArguments();
      const statement = call.getFirstAncestorByKind(
        SyntaxKind.ExpressionStatement,
      );
      return (
        isNamedImportIdentifier(
          call.getExpression(),
          "@playwright/test",
          "test",
        ) &&
        statement?.getExpression() === call &&
        statement.getParent() === file &&
        Node.isStringLiteral(title) &&
        title.getLiteralText() === JOURNEY_TEST
      );
    });
  return registration
    ?.getArguments()
    .find(
      (argument): argument is Callback =>
        Node.isArrowFunction(argument) || Node.isFunctionExpression(argument),
    );
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
  const directConst = (name: string) =>
    body
      .getStatements()
      .filter(Node.isVariableStatement)
      .filter(
        (variable) =>
          variable.getDeclarationKind() ===
          VariableDeclarationKind.Const,
      )
      .flatMap((variable) => variable.getDeclarations())
      .find((declaration) => declaration.getName() === name);
  const scenarioId = directConst("scenarioId");
  const firmId = directConst("firmId");
  const journeyDeclaration = directConst("journey");
  const idsDeclaration = directConst("ids");
  const isResolvedInput = (
    declaration: typeof scenarioId,
    resolver: string,
    query: string,
  ) => {
    const resolution = declaration?.getInitializer();
    return (
      resolution !== undefined &&
      Node.isCallExpression(resolution) &&
      isNamedImportIdentifier(
        resolution.getExpression(),
        "@app/demo/data",
        resolver,
      ) &&
      resolution.getArguments().length === 1 &&
      resolution.getArguments()[0]?.getText() === `first(sp.${query})`
    );
  };
  const journeyInitializer = journeyDeclaration?.getInitializer();
  if (
    !isResolvedInput(scenarioId, "resolveScenarioId", "scenario") ||
    !isResolvedInput(firmId, "resolveFirmId", "firm") ||
    !Node.isCallExpression(journeyInitializer) ||
    !isNamedImportIdentifier(
      journeyInitializer.getExpression(),
      "@app/demo/journey",
      "getJourney",
    ) ||
    journeyInitializer.getArguments().length !== 2
  ) {
    return false;
  }
  const [scenarioArgument, firmArgument] =
    journeyInitializer.getArguments();
  if (
    !Node.isIdentifier(scenarioArgument) ||
    scenarioArgument.getSymbol() !== scenarioId?.getSymbol() ||
    !Node.isIdentifier(firmArgument) ||
    firmArgument.getSymbol() !== firmId?.getSymbol()
  ) {
    return false;
  }
  const idsInitializer = idsDeclaration?.getInitializer();
  if (
    !Node.isObjectLiteralExpression(idsInitializer) ||
    idsInitializer.getProperties().length !== 2
  ) {
    return false;
  }
  const idFieldIsBound = (
    field: "scenarioId" | "firmId",
    resolved: typeof scenarioId,
  ) => {
    const property = idsInitializer.getProperty(field);
    const value = Node.isPropertyAssignment(property)
      ? property.getInitializer()
      : Node.isShorthandPropertyAssignment(property)
        ? property.getNameNode()
        : undefined;
    if (Node.isIdentifier(value)) {
      return value.getSymbol() === resolved?.getSymbol();
    }
    return (
      Node.isPropertyAccessExpression(value) &&
      value.getName() === field &&
      Node.isIdentifier(value.getExpression()) &&
      value.getExpression().getSymbol() ===
        journeyDeclaration?.getSymbol()
    );
  };
  if (
    !idFieldIsBound("scenarioId", scenarioId) ||
    !idFieldIsBound("firmId", firmId)
  ) {
    return false;
  }
  const returnStatement = body.getStatements().find(Node.isReturnStatement);
  if (
    returnStatement === undefined ||
    !isProvablyReachable(returnStatement, page)
  ) {
    return false;
  }
  const returned = unwrapParentheses(returnStatement.getExpression());
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
    Node.isIdentifier(journey) &&
    journey.getSymbol() === journeyDeclaration?.getSymbol() &&
    Node.isIdentifier(ids) &&
    ids.getSymbol() === idsDeclaration?.getSymbol() &&
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
  const callback = canonicalJourneyCallback(file);
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

function nearestFunction(node: Node): Node | undefined {
  return node
    .getAncestors()
    .find(
      (ancestor) =>
        Node.isArrowFunction(ancestor) ||
        Node.isFunctionExpression(ancestor) ||
        Node.isFunctionDeclaration(ancestor),
    );
}

function controlClickKey(statement: Node): string | undefined {
  if (!Node.isExpressionStatement(statement)) return undefined;
  const awaited = statement.getExpression();
  if (!Node.isAwaitExpression(awaited)) return undefined;
  const click = awaited.getExpression();
  if (!Node.isCallExpression(click) || click.getArguments().length !== 0) {
    return undefined;
  }
  const clickExpression = click.getExpression();
  if (
    !Node.isPropertyAccessExpression(clickExpression) ||
    clickExpression.getName() !== "click"
  ) {
    return undefined;
  }
  const getByRole = clickExpression.getExpression();
  if (!Node.isCallExpression(getByRole)) return undefined;
  const roleExpression = getByRole.getExpression();
  if (
    !Node.isPropertyAccessExpression(roleExpression) ||
    roleExpression.getExpression().getText() !== "page" ||
    roleExpression.getName() !== "getByRole"
  ) {
    return undefined;
  }
  const [role, options] = getByRole.getArguments();
  if (
    !Node.isStringLiteral(role) ||
    !Node.isObjectLiteralExpression(options) ||
    options.getProperties().some(
      (property) =>
        !Node.isPropertyAssignment(property) ||
        !["name", "exact"].includes(property.getName()),
    )
  ) {
    return undefined;
  }
  const name = options.getProperty("name");
  const initializer = Node.isPropertyAssignment(name)
    ? name.getInitializer()
    : undefined;
  const exact = options.getProperty("exact");
  if (
    exact !== undefined &&
    (!Node.isPropertyAssignment(exact) ||
      exact.getInitializer()?.getKind() !== SyntaxKind.TrueKeyword)
  ) {
    return undefined;
  }
  return Node.isStringLiteral(initializer)
    ? `${role.getLiteralText()}:${initializer.getLiteralText()}`
    : undefined;
}

function canonicalJourneyControlKeys(source: string): string[] {
  const file = parsedSourceFile("/demo.spec.ts", source);
  const callback = canonicalJourneyCallback(file);
  const body = callback?.getBody();
  if (
    callback === undefined ||
    !callback.isAsync() ||
    !Node.isBlock(body)
  ) {
    return [];
  }
  return body.getStatements().flatMap((statement) => {
    if (!isProvablyReachable(statement, callback)) return [];
    const key = controlClickKey(statement);
    return key === undefined ? [] : [key];
  });
}

function isLocalFunctionCall(
  call: Node,
  file: SourceFile,
  name: string,
): boolean {
  if (!Node.isCallExpression(call)) return false;
  const expression = call.getExpression();
  const fn = file.getFunction(name);
  return (
    fn !== undefined &&
    Node.isIdentifier(expression) &&
    expression
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => declaration === fn) === true
  );
}

function isSideEffectFreeLiteralStructure(node: Node): boolean {
  if (
    Node.isStringLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isRegularExpressionLiteral(node)
  ) {
    return true;
  }
  if (
    node.getKind() === SyntaxKind.TrueKeyword ||
    node.getKind() === SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  if (!Node.isObjectLiteralExpression(node)) return false;
  return node.getProperties().every((property) => {
    if (!Node.isPropertyAssignment(property)) return false;
    const name = property.getNameNode();
    if (!Node.isIdentifier(name) && !Node.isStringLiteral(name)) {
      return false;
    }
    const initializer = property.getInitializer();
    return (
      initializer !== undefined &&
      isSideEffectFreeLiteralStructure(initializer)
    );
  });
}

function isSanctionedPageRead(node: Node | undefined): boolean {
  if (node === undefined) return false;
  const expression = Node.isAwaitExpression(node)
    ? node.getExpression()
    : node;
  if (!Node.isCallExpression(expression)) return false;
  const access = expression.getExpression();
  if (!Node.isPropertyAccessExpression(access)) return false;
  const receiver = access.getExpression();
  if (
    Node.isIdentifier(receiver) &&
    receiver.getText() === "page" &&
    ["getByRole", "getByText", "getByTestId"].includes(
      access.getName(),
    )
  ) {
    return expression
      .getArguments()
      .every(isSideEffectFreeLiteralStructure);
  }
  return (
    ["first", "count"].includes(access.getName()) &&
    expression.getArguments().length === 0 &&
    isSanctionedPageRead(receiver)
  );
}

function isSanctionedAssertion(statement: Node): boolean {
  if (!Node.isExpressionStatement(statement)) return false;
  const outer = statement.getExpression();
  const matcherCall = Node.isAwaitExpression(outer)
    ? outer.getExpression()
    : outer;
  if (!Node.isCallExpression(matcherCall)) return false;
  const matcher = matcherCall.getExpression();
  if (!Node.isPropertyAccessExpression(matcher)) return false;
  const expectation = matcher.getExpression();
  if (
    !Node.isCallExpression(expectation) ||
    !isNamedImportIdentifier(
      expectation.getExpression(),
      "@playwright/test",
      "expect",
    ) ||
    expectation.getArguments().length !== 1 ||
    !isSanctionedPageRead(expectation.getArguments()[0])
  ) {
    return false;
  }
  const args = matcherCall.getArguments();
  switch (matcher.getName()) {
    case "toBeVisible":
      return args.length === 0;
    case "toHaveCount":
    case "toBeGreaterThan":
      return (
        args.length === 1 &&
        Node.isNumericLiteral(args[0])
      );
    case "toContainText":
      return (
        args.length === 1 &&
        Node.isStringLiteral(args[0])
      );
    default:
      return false;
  }
}

function isSanctionedHelperCall(
  statement: Node,
  file: SourceFile,
): boolean {
  if (!Node.isExpressionStatement(statement)) return false;
  const awaited = statement.getExpression();
  if (!Node.isAwaitExpression(awaited)) return false;
  const call = awaited.getExpression();
  if (!Node.isCallExpression(call)) return false;
  const args = call.getArguments();
  if (
    isNamedImportIdentifier(
      call.getExpression(),
      "./helpers",
      "login",
    )
  ) {
    return (
      args.length === 2 &&
      args[0]?.getText() === "page" &&
      args[1]?.getText() === "PRINCIPAL"
    );
  }
  if (
    isNamedImportIdentifier(
      call.getExpression(),
      "./axe",
      "assertNoAxeViolations",
    )
  ) {
    return (
      args.length === 2 &&
      args[0]?.getText() === "page" &&
      Node.isStringLiteral(args[1])
    );
  }
  if (isLocalFunctionCall(call, file, "snapLauncher")) {
    return args.length === 1 && args[0]?.getText() === "page";
  }
  if (isLocalFunctionCall(call, file, "expectDevBadge")) {
    return args.length === 1 && args[0]?.getText() === "page";
  }
  return (
    isLocalFunctionCall(call, file, "snap") &&
    args.length === 4 &&
    args[0]?.getText() === "page" &&
    Node.isNumericLiteral(args[1]) &&
    Node.isStringLiteral(args[2]) &&
    Node.isStringLiteral(args[3])
  );
}

function hasSanctionedDevBadgeHelper(file: SourceFile): boolean {
  const helper = file.getFunction("expectDevBadge");
  const body = helper?.getBody();
  return (
    helper !== undefined &&
    helper.isAsync() &&
    helper.getParameters().map((parameter) => parameter.getName()).join(",") ===
      "page" &&
    Node.isBlock(body) &&
    body.getStatements().length === 1 &&
    body.getStatements()[0]?.getText() ===
      'expect(await page.getByTestId("dev-provenance-badge").count()).toBeGreaterThan(0);'
  );
}

function canonicalJourneyStatementGraphIsSanctioned(
  source: string,
): boolean {
  const file = parsedSourceFile("/demo.spec.ts", source);
  const callback = canonicalJourneyCallback(file);
  const body = callback?.getBody();
  if (
    callback === undefined ||
    !Node.isBlock(body) ||
    !hasSanctionedDevBadgeHelper(file)
  ) {
    return false;
  }
  return body.getStatements().every(
    (statement) =>
      isProvablyReachable(statement, callback) &&
      (controlClickKey(statement) !== undefined ||
        isSanctionedAssertion(statement) ||
        isSanctionedHelperCall(statement, file)),
  );
}

function canonicalJourneyUsesProgrammaticNavigation(source: string): boolean {
  const file = parsedSourceFile("/demo.spec.ts", source);
  const callback = canonicalJourneyCallback(file);
  if (callback === undefined) return true;
  return callback
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => {
      if (nearestFunction(call) !== callback) return false;
      const expression = call.getExpression();
      return (
        Node.isPropertyAccessExpression(expression) &&
        expression.getExpression().getText() === "page" &&
        expression.getName() === "goto"
      );
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
  if (
    JSON.stringify(contractNames) !==
    JSON.stringify(RATIFIED_SURFACE_RATCHET)
  ) {
    problems.push(
      `${RATIFIED_CONTRACT_PATH}:1 mutable demo contract must preserve the exact ratified §4 surface identities`,
    );
  }
  if (
    JSON.stringify(surfaceNames) !==
    JSON.stringify(RATIFIED_SURFACE_RATCHET)
  ) {
    problems.push(
      `${RATIFIED_CONTRACT_PATH}:1 typed demo surface manifest must preserve the exact ratified §4 surface identities`,
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
      `${ROUTE_PATH}:1 dynamic demo page must bind resolved scenario and firm inputs to the journey service and pass its resolved station to the validated renderer and loaded marker`,
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
  if (
    canonicalJourneyUsesProgrammaticNavigation(e2e) ||
    !canonicalJourneyStatementGraphIsSanctioned(e2e) ||
    JSON.stringify(canonicalJourneyControlKeys(e2e)) !==
      JSON.stringify(CANONICAL_JOURNEY_CONTROLS)
  ) {
    problems.push(
      `${E2E_PATH}:1 canonical journey must traverse the complete product route graph through its expected clickable controls`,
    );
  }
  return problems;
}

function allowsBlockingFailure(node: unknown): boolean {
  const candidate = node as
    | { "continue-on-error"?: unknown }
    | null;
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    (candidate["continue-on-error"] === undefined ||
      candidate["continue-on-error"] === false)
  );
}

function uploadConditionRuns(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" &&
      value.replace(/\s/g, "") === "${{!cancelled()}}")
  );
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
        | {
            uses?: unknown;
            with?: unknown;
            if?: unknown;
            "continue-on-error"?: unknown;
          }
        | null;
      const settings = candidate?.with;
      if (
        typeof candidate?.uses !== "string" ||
        !candidate.uses.startsWith("actions/upload-artifact@") ||
        !allowsBlockingFailure(candidate) ||
        !uploadConditionRuns(candidate.if) ||
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

      const renamedContract = contract.replace(
        "11. Policy draft and simulation impact",
        "11. Policy workshop",
      );
      const renamedSurfaces = DEMO_SURFACES.map((surface) =>
        surface.number === 11
          ? { ...surface, contractName: "Policy workshop" }
          : surface,
      );
      expect(
        surfaceCompletenessProblems(
          renamedContract,
          renamedSurfaces,
          route,
          e2e,
          exists,
        ),
      ).toEqual([
        `${RATIFIED_CONTRACT_PATH}:1 mutable demo contract must preserve the exact ratified §4 surface identities`,
        `${RATIFIED_CONTRACT_PATH}:1 typed demo surface manifest must preserve the exact ratified §4 surface identities`,
      ]);

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
        route.replace(
          "  return (\n    <div data-demo-surface={resolvedStation}>",
          '  if (true) return <div data-demo-surface="workspace"><WorkspaceSurface vm={journey.workspace} {...ids} /></div>;\n  return (\n    <div data-demo-surface={resolvedStation}>',
        ),
        route.replace(
          "getJourney(scenarioId, firmId)",
          'getJourney("safe-proceed", firmId)',
        ),
        route.replace(
          "getJourney(scenarioId, firmId)",
          'getJourney(scenarioId, "firm-a")',
        ),
        route.replace(
          "const ids = { scenarioId: journey.scenarioId, firmId: journey.firmId };",
          'const ids = { scenarioId: "safe-proceed", firmId: "firm-a" };',
        ),
        route.replace(
          "const ids = { scenarioId: journey.scenarioId, firmId: journey.firmId };",
          "const ids = { scenarioId: journey.firmId, firmId: journey.scenarioId };",
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

      const workspaceControl =
        '  await page.getByRole("link", { name: "Ask Verin about this household" }).click();';
      for (const bypassedJourney of [
        e2e.replace(
          workspaceControl,
          '  await page.goto("/app/demo/intent?scenario=recent-bank-change-block&firm=firm-a");',
        ),
        e2e.replace(
          workspaceControl,
          `${workspaceControl}
  await page.goto("/app/demo/intent?scenario=recent-bank-change-block&firm=firm-a");`,
        ),
        e2e.replace(
          workspaceControl,
          '  await page.getByRole("link", { name: "Different control" }).click();',
        ),
        e2e.replace(
          workspaceControl,
          `  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/app/demo/intent?scenario=recent-bank-change-block&firm=firm-a";
    link.textContent = "Ask Verin about this household";
    document.body.append(link);
  });
${workspaceControl}`,
        ),
        e2e.replace(
          workspaceControl,
          '  await page.getByRole("link", { name: "Ask Verin about this household", ...(await page.evaluate(() => ({ exact: false }))) }).click();',
        ),
        e2e.replace(
          workspaceControl,
          `${workspaceControl}
  await page.goBack();
  await page.goForward();`,
        ),
      ]) {
        expect(
          surfaceCompletenessProblems(
            contract,
            DEMO_SURFACES,
            route,
            bypassedJourney,
            exists,
          ),
          bypassedJourney,
        ).toContain(
          `${E2E_PATH}:1 canonical journey must traverse the complete product route graph through its expected clickable controls`,
        );
      }

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

    it("preserves every supported scenario and firm outcome through the journey service", () => {
      for (const scenario of SCENARIOS) {
        for (const firm of Object.values(FIRMS)) {
          const journey = getJourney(scenario.id, firm.id);
          expect(journey.scenarioId).toBe(scenario.id);
          expect(journey.firmId).toBe(firm.id);
          expect(journey.scenarioTitle).toBe(scenario.title);
          expect(journey.firmName).toBe(firm.name);
          expect(journey.outcomeClass).toBe(scenario.outcomeClass);
          expect(journey.recommendation.disposition.kind).toBe(
            dispositionFor(scenario, firm.id),
          );
        }
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
      const demoUpload = `      - uses: actions/upload-artifact@v7
        if: \${{ !cancelled() }}
        with:
          name: demo-screens`;
      for (const neutralizedUpload of [
        ci.replace(
          demoUpload,
          `      - uses: actions/upload-artifact@v7
        if: false
        with:
          name: demo-screens`,
        ),
        ci.replace(
          demoUpload,
          `      - uses: actions/upload-artifact@v7
        if: \${{ !cancelled() }}
        continue-on-error: true
        with:
          name: demo-screens`,
        ),
      ]) {
        expect(demoArtifactCiProblems(neutralizedUpload)).toContain(
          `${CI_PATH}:1 demo-screens upload must fail when the expected artifact directory is missing`,
        );
      }
      expect(
        demoArtifactCiProblems(
          ci.replace(
            "  e2e:\n    name: e2e (Playwright + axe)",
            "  e2e:\n    continue-on-error: true\n    name: e2e (Playwright + axe)",
          ),
        ),
      ).toContain(
        `${CI_PATH}:1 e2e must run the demo screenshot artifact validator in a dedicated blocking step`,
      );
    });
  });
});
