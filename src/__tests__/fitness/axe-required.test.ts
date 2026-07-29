import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Node,
  Project,
  SyntaxKind,
  VariableDeclarationKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type SourceFile,
  type Symbol as MorphSymbol,
} from "ts-morph";
import {
  AUTHENTICATED_AXE_ROUTES,
  DEMO_AXE_ROUTES,
  LOGIN_AXE_ROUTES,
  PUBLIC_AXE_ROUTES,
} from "../../../e2e/axe-routes";
import { DEMO_SURFACES } from "../../app/demo/surface-contract";
import { isProvablyReachable } from "./_ast-control-flow";
import { reflectApplyTarget } from "./_callable-indirection";
import { REPO_ROOT } from "./_fence-utils";

const AXE_HELPER_PATH = "e2e/axe.ts";
const E2E_HELPERS_PATH = "e2e/helpers.ts";
const PLAYWRIGHT_CONFIG_PATH = "playwright.config.ts";
const AXE_HELPER_EXPORT = "assertNoAxeViolations";
const REQUIRED_AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;
const REQUIRED_AXE_SPECS = [
  "e2e/smoke.spec.ts",
  "e2e/walkthrough.spec.ts",
  "e2e/demo-journey.spec.ts",
] as const;
const REQUIRED_ROUTE_GROUPS: Record<
  (typeof REQUIRED_AXE_SPECS)[number],
  readonly { readonly imported: string; readonly requiresLogin: boolean }[]
> = {
  "e2e/smoke.spec.ts": [
    { imported: "PUBLIC_AXE_ROUTES", requiresLogin: false },
  ],
  "e2e/walkthrough.spec.ts": [
    { imported: "LOGIN_AXE_ROUTES", requiresLogin: false },
    { imported: "AUTHENTICATED_AXE_ROUTES", requiresLogin: true },
  ],
  "e2e/demo-journey.spec.ts": [
    { imported: "DEMO_AXE_ROUTES", requiresLogin: true },
  ],
};

function routeCollectionImmutabilityProblems(
  collections: Record<
    string,
    readonly { readonly path: string; readonly readySelector: string }[]
  >,
): string[] {
  const problems: string[] = [];
  for (const [name, routes] of Object.entries(collections)) {
    if (!Object.isFrozen(routes)) {
      problems.push(`${name} route collection must be frozen`);
    }
    if (routes.some((route) => !Object.isFrozen(route))) {
      problems.push(`${name} route entries must be frozen`);
    }
  }
  return problems;
}

type RouteCollectionName =
  | "PUBLIC_AXE_ROUTES"
  | "LOGIN_AXE_ROUTES"
  | "AUTHENTICATED_AXE_ROUTES"
  | "DEMO_AXE_ROUTES";

type RouteCollection = readonly {
  readonly path: string;
  readonly readySelector: string;
}[];

function nextRoutePattern(pageFile: string): string | undefined {
  const normalized = pageFile.replace(/\\/g, "/");
  const prefix = "src/app/";
  const suffix = "/page.tsx";
  if (!normalized.startsWith(prefix)) return undefined;
  const relative =
    normalized === "src/app/page.tsx"
      ? ""
      : normalized.slice(prefix.length, -suffix.length);
  if (
    normalized !== "src/app/page.tsx" &&
    (!normalized.endsWith(suffix) || relative.length === 0)
  ) {
    return undefined;
  }
  const segments = relative
    .split("/")
    .filter((segment) => segment.length > 0)
    .filter(
      (segment) =>
        !(segment.startsWith("(") && segment.endsWith(")")),
    );
  if (segments.some((segment) => segment.startsWith("@"))) {
    return undefined;
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function routeCollectionFor(
  pattern: string,
): RouteCollectionName {
  if (pattern === "/login") return "LOGIN_AXE_ROUTES";
  if (pattern === "/app/demo" || pattern.startsWith("/app/demo/")) {
    return "DEMO_AXE_ROUTES";
  }
  if (pattern === "/app" || pattern.startsWith("/app/")) {
    return "AUTHENTICATED_AXE_ROUTES";
  }
  return "PUBLIC_AXE_ROUTES";
}

function routeMatchesPattern(pattern: string, route: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean);
  const routeParts = route.split("/").filter(Boolean);
  let routeIndex = 0;
  for (const part of patternParts) {
    if (part.startsWith("[[...") && part.endsWith("]]")) return true;
    if (part.startsWith("[...") && part.endsWith("]")) {
      return routeIndex < routeParts.length;
    }
    const actual = routeParts[routeIndex];
    if (actual === undefined) return false;
    if (!(part.startsWith("[") && part.endsWith("]")) && part !== actual) {
      return false;
    }
    routeIndex += 1;
  }
  return routeIndex === routeParts.length;
}

export function pageRouteInventoryProblems(
  pageFiles: readonly string[],
  collections: Readonly<Record<RouteCollectionName, RouteCollection>>,
): string[] {
  const problems: string[] = [];
  const classified = new Map<
    RouteCollectionName,
    Array<{ file: string; pattern: string }>
  >([
    ["PUBLIC_AXE_ROUTES", []],
    ["LOGIN_AXE_ROUTES", []],
    ["AUTHENTICATED_AXE_ROUTES", []],
    ["DEMO_AXE_ROUTES", []],
  ]);
  for (const file of pageFiles) {
    const pattern = nextRoutePattern(file);
    if (pattern === undefined) {
      problems.push(`${file}: Next page route cannot be classified for Axe`);
      continue;
    }
    classified.get(routeCollectionFor(pattern))!.push({ file, pattern });
  }
  for (const [name, pages] of classified) {
    const paths = collections[name].map((route) =>
      route.path.split("?")[0]!,
    );
    for (const page of pages) {
      if (!paths.some((path) => routeMatchesPattern(page.pattern, path))) {
        problems.push(
          `${page.file}: route ${page.pattern} is absent from ${name}`,
        );
      }
    }
    for (const path of paths) {
      if (!pages.some((page) => routeMatchesPattern(page.pattern, path))) {
        problems.push(
          `${name}: route ${path} has no classified Next page.tsx owner`,
        );
      }
    }
  }
  return problems;
}

function nextPageFiles(
  directory = join(REPO_ROOT, "src/app"),
  prefix = "src/app",
): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return nextPageFiles(path, relative);
    return entry.isFile() && entry.name === "page.tsx" ? [relative] : [];
  });
}

type Callback = ArrowFunction | FunctionExpression;
type FunctionNode = Callback | FunctionDeclaration;

function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function importModuleOf(node: Node): string | undefined {
  return node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue();
}

function isDirectNamedImportIdentifier(node: Node, moduleName: string, imported: string): boolean {
  const normalized = unwrapExpression(node);
  if (!Node.isIdentifier(normalized)) return false;
  return (
    normalized
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

function isDirectNamespaceImportIdentifier(node: Node, moduleName: string): boolean {
  const normalized = unwrapExpression(node);
  if (!Node.isIdentifier(normalized)) return false;
  return (
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some(
        (declaration) =>
          Node.isNamespaceImport(declaration) &&
          declaration.getName() === normalized.getText() &&
          importModuleOf(declaration) === moduleName,
      ) ?? false
  );
}

function latestPrecedingAssignment(node: Node): Node | undefined {
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (symbol === undefined) return undefined;
  return node
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter(
      (candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < node.getStart() &&
        Node.isIdentifier(candidate.getLeft()) &&
        candidate.getLeft().getSymbol() === symbol,
    )
    .sort((left, right) => right.getStart() - left.getStart())[0]
    ?.getRight();
}

function precedingAssignmentValues(node: Node): Node[] {
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (symbol === undefined) return [];
  return node
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter(
      (candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < node.getStart() &&
        Node.isIdentifier(candidate.getLeft()) &&
        candidate.getLeft().getSymbol() === symbol,
    )
    .map((candidate) => candidate.getRight());
}

function isNamespaceImportIdentifier(
  node: Node,
  moduleName: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  if (isDirectNamespaceImportIdentifier(normalized, moduleName)) return true;
  if (!Node.isIdentifier(normalized)) return false;
  const assigned = latestPrecedingAssignment(normalized);
  if (
    assigned !== undefined &&
    isNamespaceImportIdentifier(assigned, moduleName, new Set(seen))
  ) {
    return true;
  }
  return (
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => {
        if (!Node.isVariableDeclaration(declaration)) return false;
        const initializer = declaration.getInitializer();
        return (
          initializer !== undefined &&
          isNamespaceImportIdentifier(initializer, moduleName, new Set(seen))
        );
      }) ?? false
  );
}

function isNamedImportIdentifier(
  node: Node,
  moduleName: string,
  imported: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  if (isDirectNamedImportIdentifier(normalized, moduleName, imported)) return true;
  const access = memberAccess(normalized);
  if (
    access?.name === imported &&
    isNamespaceImportIdentifier(access.receiver, moduleName)
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  const assigned = latestPrecedingAssignment(normalized);
  if (
    assigned !== undefined &&
    isNamedImportIdentifier(
      assigned,
      moduleName,
      imported,
      new Set(seen),
    )
  ) {
    return true;
  }
  return (
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => {
        if (Node.isVariableDeclaration(declaration)) {
          const initializer = declaration.getInitializer();
          return (
            initializer !== undefined &&
            isNamedImportIdentifier(
              initializer,
              moduleName,
              imported,
              new Set(seen),
            )
          );
        }
        if (!Node.isBindingElement(declaration)) return false;
        const property = declaration.getPropertyNameNode() ?? declaration.getNameNode();
        if (staticPropertyName(property) !== imported) {
          return false;
        }
        const variable = declaration.getFirstAncestorByKind(
          SyntaxKind.VariableDeclaration,
        );
        const initializer = variable?.getInitializer();
        return (
          initializer !== undefined &&
          (isNamespaceImportIdentifier(initializer, moduleName) ||
            isNamedImportIdentifier(
              initializer,
              moduleName,
              imported,
              new Set(seen),
            ))
        );
      }) ?? false
  );
}

function isDefaultImportIdentifier(node: Node, moduleName: string): boolean {
  const normalized = unwrapExpression(node);
  if (!Node.isIdentifier(normalized)) return false;
  return (
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => {
        const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
        return (
          importDeclaration?.getModuleSpecifierValue() === moduleName &&
          importDeclaration.getDefaultImport()?.getText() ===
            normalized.getText()
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
  return isNamedImportMemberExpression(
    expression,
    moduleName,
    imported,
    member,
  );
}

function memberAccess(
  node: Node,
): { receiver: Node; name: string } | undefined {
  const normalized = unwrapExpression(node);
  if (Node.isPropertyAccessExpression(normalized)) {
    return {
      receiver: normalized.getExpression(),
      name: normalized.getName(),
    };
  }
  if (Node.isElementAccessExpression(normalized)) {
    const argument = normalized.getArgumentExpression();
    if (Node.isStringLiteral(argument)) {
      return {
        receiver: normalized.getExpression(),
        name: argument.getLiteralText(),
      };
    }
  }
  return undefined;
}

function indirectCallableTarget(node: Node): Node | undefined {
  const normalized = unwrapExpression(node);
  if (Node.isCallExpression(normalized)) {
    const access = memberAccess(normalized.getExpression());
    return access?.name === "bind" ? access.receiver : undefined;
  }
  const access = memberAccess(normalized);
  return access !== undefined && ["call", "apply"].includes(access.name)
    ? access.receiver
    : undefined;
}

function staticPropertyName(node: Node): string | undefined {
  if (Node.isIdentifier(node) || Node.isStringLiteral(node)) {
    return Node.isIdentifier(node) ? node.getText() : node.getLiteralText();
  }
  if (Node.isComputedPropertyName(node)) {
    const expression = node.getExpression();
    return Node.isStringLiteral(expression)
      ? expression.getLiteralText()
      : undefined;
  }
  return undefined;
}

function normalizedObjectProperties(
  object: Node,
): Map<string, Node> | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;
  const properties = new Map<string, Node>();
  for (const property of object.getProperties()) {
    if (
      !Node.isPropertyAssignment(property) &&
      !Node.isShorthandPropertyAssignment(property) &&
      !Node.isMethodDeclaration(property) &&
      !Node.isGetAccessorDeclaration(property) &&
      !Node.isSetAccessorDeclaration(property)
    ) {
      return undefined;
    }
    const name = staticPropertyName(property.getNameNode());
    if (name === undefined || properties.has(name)) return undefined;
    properties.set(name, property);
  }
  return properties;
}

function isNamedImportMemberExpression(
  node: Node,
  moduleName: string,
  imported: string,
  member: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const access = memberAccess(normalized);
  if (
    access?.name === member &&
    isNamedImportIdentifier(access.receiver, moduleName, imported)
  ) {
    return true;
  }
  const boundTarget = indirectCallableTarget(normalized);
  if (
    boundTarget !== undefined &&
    isNamedImportMemberExpression(
      boundTarget,
      moduleName,
      imported,
      member,
      new Set(seen),
    )
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  const assigned = latestPrecedingAssignment(normalized);
  if (
    assigned !== undefined &&
    isNamedImportMemberExpression(
      assigned,
      moduleName,
      imported,
      member,
      new Set(seen),
    )
  ) {
    return true;
  }
  return (
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => {
        if (Node.isVariableDeclaration(declaration)) {
          const initializer = declaration.getInitializer();
          return (
            initializer !== undefined &&
            isNamedImportMemberExpression(
              initializer,
              moduleName,
              imported,
              member,
              new Set(seen),
            )
          );
        }
        if (!Node.isBindingElement(declaration)) return false;
        const property = declaration.getPropertyNameNode() ?? declaration.getNameNode();
        if (staticPropertyName(property) !== member) {
          return false;
        }
        const variable = declaration.getFirstAncestorByKind(
          SyntaxKind.VariableDeclaration,
        );
        const initializer = variable?.getInitializer();
        return (
          initializer !== undefined &&
          isNamedImportIdentifier(
            initializer,
            moduleName,
            imported,
            new Set(seen),
          )
        );
      }) ?? false
  );
}

function couldBeNamespaceImportIdentifier(
  node: Node,
  moduleName: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  if (isNamespaceImportIdentifier(normalized, moduleName)) return true;
  if (!Node.isIdentifier(normalized)) return false;
  return precedingAssignmentValues(normalized).some((assigned) =>
    couldBeNamespaceImportIdentifier(
      assigned,
      moduleName,
      new Set(seen),
    ),
  );
}

function couldBeNamedImportIdentifier(
  node: Node,
  moduleName: string,
  imported: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  if (isNamedImportIdentifier(normalized, moduleName, imported)) return true;
  const access = memberAccess(normalized);
  if (
    access?.name === imported &&
    couldBeNamespaceImportIdentifier(access.receiver, moduleName)
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  return precedingAssignmentValues(normalized).some((assigned) =>
    couldBeNamedImportIdentifier(
      assigned,
      moduleName,
      imported,
      new Set(seen),
    ),
  );
}

function couldBeNamedImportMemberExpression(
  node: Node,
  moduleName: string,
  imported: string,
  member: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  if (
    isNamedImportMemberExpression(
      normalized,
      moduleName,
      imported,
      member,
    )
  ) {
    return true;
  }
  const access = memberAccess(normalized);
  if (
    access?.name === member &&
    couldBeNamedImportIdentifier(access.receiver, moduleName, imported)
  ) {
    return true;
  }
  const boundTarget = indirectCallableTarget(normalized);
  if (
    boundTarget !== undefined &&
    couldBeNamedImportMemberExpression(
      boundTarget,
      moduleName,
      imported,
      member,
      new Set(seen),
    )
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  return precedingAssignmentValues(normalized).some((assigned) =>
    couldBeNamedImportMemberExpression(
      assigned,
      moduleName,
      imported,
      member,
      new Set(seen),
    ),
  );
}

const PLAYWRIGHT_HOOK_MEMBERS = [
  "beforeAll",
  "beforeEach",
  "afterAll",
  "afterEach",
] as const;

function hasRegisteredPlaywrightHook(
  sourceFile: SourceFile,
): boolean {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) =>
      PLAYWRIGHT_HOOK_MEMBERS.some((member) =>
        couldBeNamedImportMemberExpression(
          reflectApplyTarget(call) ?? call.getExpression(),
          "@playwright/test",
          "test",
          member,
        ),
      ),
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
    couldBeNamedImportMemberExpression(
      reflectApplyTarget(call) ?? call.getExpression(),
      "@playwright/test",
      "test",
      member,
    ),
  );
}

function derivesFromSymbol(
  node: Node,
  origin: MorphSymbol,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  if (!Node.isIdentifier(normalized)) return false;
  if (normalized.getSymbol() === origin) return true;
  if (
    precedingAssignmentValues(normalized).some((assigned) =>
      derivesFromSymbol(assigned, origin, new Set(seen)),
    )
  ) {
    return true;
  }
  return (
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => {
        if (!Node.isVariableDeclaration(declaration)) return false;
        const initializer = declaration.getInitializer();
        return (
          initializer !== undefined &&
          derivesFromSymbol(initializer, origin, new Set(seen))
        );
      }) ?? false
  );
}

function isTestInfoFactoryCall(node: Node): boolean {
  const normalized = unwrapExpression(node);
  return (
    Node.isCallExpression(normalized) &&
    normalized.getArguments().length === 0 &&
    couldBeNamedImportMemberExpression(
      normalized.getExpression(),
      "@playwright/test",
      "test",
      "info",
    )
  );
}

function derivesFromTestInfo(
  node: Node,
  origins: ReadonlySet<MorphSymbol>,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  if (isTestInfoFactoryCall(normalized)) return true;
  if (!Node.isIdentifier(normalized)) return false;
  const symbol = normalized.getSymbol();
  if (symbol !== undefined && origins.has(symbol)) return true;
  if (
    precedingAssignmentValues(normalized).some((assigned) =>
      derivesFromTestInfo(assigned, origins, new Set(seen)),
    )
  ) {
    return true;
  }
  return (
    symbol?.getDeclarations().some((declaration) => {
      if (!Node.isVariableDeclaration(declaration)) return false;
      const initializer = declaration.getInitializer();
      return (
        initializer !== undefined &&
        derivesFromTestInfo(initializer, origins, new Set(seen))
      );
    }) ?? false
  );
}

function couldBeTestInfoMember(
  node: Node,
  origins: ReadonlySet<MorphSymbol>,
  member: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const access = memberAccess(normalized);
  if (
    access?.name === member &&
    derivesFromTestInfo(access.receiver, origins)
  ) {
    return true;
  }
  const boundTarget = indirectCallableTarget(normalized);
  if (
    boundTarget !== undefined &&
    couldBeTestInfoMember(
      boundTarget,
      origins,
      member,
      new Set(seen),
    )
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  if (
    precedingAssignmentValues(normalized).some((assigned) =>
      couldBeTestInfoMember(assigned, origins, member, new Set(seen)),
    )
  ) {
    return true;
  }
  return (
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => {
        if (Node.isVariableDeclaration(declaration)) {
          const initializer = declaration.getInitializer();
          return (
            initializer !== undefined &&
            couldBeTestInfoMember(
              initializer,
              origins,
              member,
              new Set(seen),
            )
          );
        }
        if (!Node.isBindingElement(declaration)) return false;
        const property =
          declaration.getPropertyNameNode() ?? declaration.getNameNode();
        if (staticPropertyName(property) !== member) return false;
        const variable = declaration.getFirstAncestorByKind(
          SyntaxKind.VariableDeclaration,
        );
        const initializer = variable?.getInitializer();
        return (
          initializer !== undefined &&
          derivesFromTestInfo(initializer, origins)
        );
      }) ?? false
  );
}

function testInfoOrigins(
  fn: FunctionNode,
): {
  origins: ReadonlySet<MorphSymbol>;
  destructuredMembers: ReadonlyMap<MorphSymbol, string>;
} {
  const parameter = fn.getParameters()[1]?.getNameNode();
  const origins = new Set<MorphSymbol>();
  const destructuredMembers = new Map<MorphSymbol, string>();
  if (Node.isIdentifier(parameter)) {
    const symbol = parameter.getSymbol();
    if (symbol !== undefined) origins.add(symbol);
  } else if (Node.isObjectBindingPattern(parameter)) {
    for (const element of parameter.getElements()) {
      const member = staticPropertyName(
        element.getPropertyNameNode() ?? element.getNameNode(),
      );
      const name = element.getNameNode();
      const symbol = Node.isIdentifier(name) ? name.getSymbol() : undefined;
      if (
        symbol !== undefined &&
        member !== undefined &&
        ["skip", "fixme", "fail"].includes(member)
      ) {
        destructuredMembers.set(symbol, member);
      }
    }
  }
  return { origins, destructuredMembers };
}

function localCallableFunctions(
  node: Node,
  seen = new Set<Node>(),
): FunctionNode[] {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return [];
  seen.add(normalized);
  if (isFunctionNode(normalized)) return [normalized];
  const boundTarget = indirectCallableTarget(normalized);
  if (boundTarget !== undefined) {
    return localCallableFunctions(boundTarget, new Set(seen));
  }
  if (!Node.isIdentifier(normalized)) return [];
  return [
    ...(normalized
      .getSymbol()
      ?.getDeclarations()
      .flatMap((declaration): FunctionNode[] => {
        if (Node.isFunctionDeclaration(declaration)) return [declaration];
        if (!Node.isVariableDeclaration(declaration)) return [];
        const initializer = declaration.getInitializer();
        return initializer === undefined
          ? []
          : localCallableFunctions(initializer, new Set(seen));
      }) ?? []),
    ...precedingAssignmentValues(normalized).flatMap((assigned) =>
      localCallableFunctions(assigned, new Set(seen)),
    ),
  ];
}

function localCallableIsUnresolved(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  if (isFunctionNode(normalized)) return false;
  if (indirectCallableTarget(normalized) !== undefined) return false;
  if (!Node.isIdentifier(normalized)) return false;
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (
    declarations.some(
      (declaration) =>
        Node.isImportSpecifier(declaration) ||
        Node.isNamespaceImport(declaration) ||
        Node.isFunctionDeclaration(declaration),
    )
  ) {
    return false;
  }
  const variables = declarations.filter(Node.isVariableDeclaration);
  if (variables.length === 0) return false;
  const sources = [
    ...variables.flatMap((declaration) => {
      const initializer = declaration.getInitializer();
      return initializer === undefined ? [] : [initializer];
    }),
    ...precedingAssignmentValues(normalized),
  ];
  if (sources.length === 0) return true;
  return sources.some((source) => {
    const value = unwrapExpression(source);
    if (isFunctionNode(value) || indirectCallableTarget(value) !== undefined) {
      return false;
    }
    if (Node.isIdentifier(value)) {
      return localCallableIsUnresolved(value, new Set(seen));
    }
    return true;
  });
}

function callbackArgumentHasNeutralizer(
  node: Node,
  seen: ReadonlySet<FunctionNode>,
): boolean {
  const targets = localCallableFunctions(node);
  if (
    targets.some((target) =>
      functionHasNeutralizer(target, new Set(seen)),
    )
  ) {
    return true;
  }
  return (
    targets.length === 0 &&
    unwrapExpression(node).getType().getCallSignatures().length > 0 &&
    localCallableIsUnresolved(node)
  );
}

function functionHasNeutralizer(
  fn: FunctionNode,
  seen = new Set<FunctionNode>(),
): boolean {
  if (seen.has(fn)) return false;
  seen.add(fn);
  const { origins, destructuredMembers } = testInfoOrigins(fn);
  return ownedCalls(fn).some((call) => {
    const callable = reflectApplyTarget(call) ?? call.getExpression();
    const neutralizesDirectly = ["skip", "fixme", "fail"].some(
      (member) =>
        isNeutralizingAnnotation(call) ||
        couldBeTestInfoMember(
          callable,
          origins,
          member,
        ) ||
        [...destructuredMembers].some(
          ([symbol, destructuredMember]) =>
            destructuredMember === member &&
            derivesFromSymbol(call.getExpression(), symbol),
        ),
    );
    const neutralizesThroughCallee =
      localCallableFunctions(callable).some((target) =>
        functionHasNeutralizer(target, new Set(seen)),
      ) || localCallableIsUnresolved(callable);
    const neutralizesThroughCallback = call
      .getArguments()
      .some((argument) =>
        callbackArgumentHasNeutralizer(argument, seen),
      );
    return (
      neutralizesDirectly ||
      neutralizesThroughCallee ||
      neutralizesThroughCallback
    );
  });
}

function callbackHasTestInfoNeutralizer(callback: Callback): boolean {
  return functionHasNeutralizer(callback);
}

function scopeHasTestInfoNeutralizer(scope: SourceFile | Callback): boolean {
  const container = Node.isSourceFile(scope) ? scope : scope.getBody();
  if (!Node.isSourceFile(container) && !Node.isBlock(container)) return true;
  return container
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => {
      if (directCallContainer(call) !== container) return false;
      if (
        !["beforeAll", "beforeEach", "afterAll", "afterEach"].some(
          (member) =>
            isNamedImportMemberCall(
              call,
              "@playwright/test",
              "test",
              member,
            ),
        )
      ) {
        return false;
      }
      const callback = callbackOf(call);
      return (
        callback !== undefined &&
        callbackHasTestInfoNeutralizer(callback)
      );
    });
}

function scopeHasNeutralizingAnnotation(scope: SourceFile | Callback): boolean {
  if (Node.isSourceFile(scope)) {
    return (
      scope
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .some(isNeutralizingAnnotation) ||
      scopeHasTestInfoNeutralizer(scope)
    );
  }
  const container = scope.getBody();
  if (!Node.isBlock(container)) return true;
  return (
    container
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .some(
        (call) =>
          directCallContainer(call) === container &&
          isNeutralizingAnnotation(call),
      ) || scopeHasTestInfoNeutralizer(scope)
  );
}

function testIsDisabled(callback: Callback): boolean {
  return (
    ownedCalls(callback).some(isNeutralizingAnnotation) ||
    callbackHasTestInfoNeutralizer(callback)
  );
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
        isStableNamedImportCall(
          nested,
          "./axe",
          AXE_HELPER_EXPORT,
        ) &&
        Node.isAwaitExpression(nested.getParent()) &&
        isProvablyReachable(nested, callback) &&
        !isInsideTry(nested, callback),
    );
  });
}

function pageParameterName(callback: Callback): string | undefined {
  const parameter = callback.getParameters()[0]?.getNameNode();
  if (!Node.isObjectBindingPattern(parameter)) return undefined;
  const page = parameter
    .getElements()
    .find((element) => {
      const property = element.getPropertyNameNode() ?? element.getNameNode();
      return Node.isIdentifier(property) && property.getText() === "page";
    });
  const name = page?.getNameNode();
  return Node.isIdentifier(name) ? name.getText() : undefined;
}

function enabledTestCallbacks(sourceFile: SourceFile): Callback[] {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .flatMap((call): Callback[] => {
      if (!isNamedImportCall(call, "@playwright/test", "test")) return [];
      const scope = registrationScopeOf(call, sourceFile);
      if (
        scope === undefined ||
        scopeHasNeutralizingAnnotation(sourceFile) ||
        (scope !== sourceFile && scopeHasNeutralizingAnnotation(scope))
      ) {
        return [];
      }
      const callback = callbackOf(call);
      return callback === undefined || testIsDisabled(callback) ? [] : [callback];
    });
}

function awaitedCall(
  statement: Node,
  predicate: (call: CallExpression) => boolean,
): boolean {
  if (!Node.isExpressionStatement(statement)) return false;
  const awaited = statement.getExpression();
  if (!Node.isAwaitExpression(awaited)) return false;
  const call = awaited.getExpression();
  return Node.isCallExpression(call) && predicate(call);
}

function routeLoopIsSanctioned(
  loop: Node,
  callback: Callback,
  requiresLogin: boolean,
): boolean {
  if (!Node.isForOfStatement(loop)) return false;
  const callbackBody = callback.getBody();
  if (
    !Node.isBlock(callbackBody) ||
    loop.getParent() !== callbackBody ||
    !isProvablyReachable(loop, callback) ||
    isInsideTry(loop, callback)
  ) {
    return false;
  }
  const initializer = loop.getInitializer();
  if (!Node.isVariableDeclarationList(initializer)) return false;
  const routeName = initializer.getDeclarations()[0]?.getNameNode();
  const pageName = pageParameterName(callback);
  const body = loop.getStatement();
  if (
    !Node.isIdentifier(routeName) ||
    pageName === undefined ||
    !Node.isBlock(body) ||
    body.getStatements().length !== 3
  ) {
    return false;
  }
  const route = routeName.getText();
  const [navigate, ready, scan] = body.getStatements();
  const navigates = awaitedCall(navigate!, (call) => {
    const expression = call.getExpression();
    return (
      Node.isPropertyAccessExpression(expression) &&
      expression.getExpression().getText() === pageName &&
      expression.getName() === "goto" &&
      call.getArguments()[0]?.getText() === `${route}.path`
    );
  });
  const waitsUntilLoaded = awaitedCall(ready!, (call) => {
    const matcher = call.getExpression();
    if (
      !Node.isPropertyAccessExpression(matcher) ||
      matcher.getName() !== "toBeVisible"
    ) {
      return false;
    }
    const expectation = matcher.getExpression();
    if (
      !Node.isCallExpression(expectation) ||
      !isNamedImportCall(expectation, "@playwright/test", "expect")
    ) {
      return false;
    }
    const locator = expectation.getArguments()[0];
    if (!Node.isCallExpression(locator)) return false;
    const locatorExpression = locator.getExpression();
    return (
      Node.isPropertyAccessExpression(locatorExpression) &&
      locatorExpression.getExpression().getText() === pageName &&
      locatorExpression.getName() === "locator" &&
      locator.getArguments()[0]?.getText() === `${route}.readySelector`
    );
  });
  const scans = awaitedCall(scan!, (call) => {
    return (
      isStableNamedImportCall(call, "./axe", AXE_HELPER_EXPORT) &&
      call.getArguments()[0]?.getText() === pageName &&
      call.getArguments()[1]?.getText() === `${route}.path`
    );
  });
  if (!navigates || !waitsUntilLoaded || !scans) return false;
  if (!requiresLogin) return true;
  const loopIndex = callbackBody.getStatements().indexOf(loop);
  return callbackBody.getStatements().slice(0, loopIndex).some(
    (statement) =>
      awaitedCall(statement, (call) =>
        isNamedImportCall(call, "./helpers", "login") &&
        call.getArguments()[0]?.getText() === pageName,
      ),
  );
}

function routeScanCallbackIsSanctioned(callback: Callback): boolean {
  const body = callback.getBody();
  const pageName = pageParameterName(callback);
  if (!Node.isBlock(body) || pageName === undefined) return false;
  const routeGroups = Object.values(REQUIRED_ROUTE_GROUPS).flat();
  return body.getStatements().every((statement) => {
    if (Node.isForOfStatement(statement)) {
      return routeGroups.some(
        (group) =>
          isStableNamedImportIdentifier(
            statement.getExpression(),
            "./axe-routes",
            group.imported,
          ) &&
          routeLoopIsSanctioned(
            statement,
            callback,
            group.requiresLogin,
          ),
      );
    }
    return awaitedCall(statement, (call) => {
      if (
        !isStableNamedImportCall(call, "./helpers", "login") ||
        call.getArguments()[0]?.getText() !== pageName
      ) {
        return false;
      }
      const principal = call.getArguments()[1];
      return (
        call.getArguments().length === 1 ||
        (call.getArguments().length === 2 &&
          principal !== undefined &&
          isStableNamedImportIdentifier(
            principal,
            "./helpers",
            "PRINCIPAL",
          ))
      );
    });
  });
}

function specCoversRouteGroup(
  sourceFile: SourceFile,
  imported: string,
  requiresLogin: boolean,
): boolean {
  if (hasRegisteredPlaywrightHook(sourceFile)) return false;
  return enabledTestCallbacks(sourceFile).some((callback) => {
    const body = callback.getBody();
    if (
      !Node.isBlock(body) ||
      !routeScanCallbackIsSanctioned(callback)
    ) {
      return false;
    }
    return body
      .getStatements()
      .filter(Node.isForOfStatement)
      .some(
        (loop) =>
          isStableNamedImportIdentifier(
            loop.getExpression(),
            "./axe-routes",
            imported,
          ) && routeLoopIsSanctioned(loop, callback, requiresLogin),
      );
  });
}

const ASSIGNMENT_OPERATORS = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

const ARRAY_MUTATORS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

function mutationRootIdentifier(node: Node): Node | undefined {
  let current = node;
  while (true) {
    if (Node.isIdentifier(current)) return current;
    if (
      Node.isPropertyAccessExpression(current) ||
      Node.isElementAccessExpression(current)
    ) {
      current = current.getExpression();
      continue;
    }
    if (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isTypeAssertion(current) ||
      Node.isNonNullExpression(current) ||
      Node.isSatisfiesExpression(current)
    ) {
      current = current.getExpression();
      continue;
    }
    return undefined;
  }
}

function identifierIsMutatedBefore(node: Node): boolean {
  if (!Node.isIdentifier(node)) return true;
  const symbol = node.getSymbol();
  if (symbol === undefined) return true;
  const sourceFile = node.getSourceFile();
  const before = (candidate: Node) => candidate.getStart() < node.getStart();
  const assigned = sourceFile
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some((candidate) => {
      if (
        !before(candidate) ||
        !ASSIGNMENT_OPERATORS.has(candidate.getOperatorToken().getKind())
      ) {
        return false;
      }
      return mutationRootIdentifier(candidate.getLeft())?.getSymbol() === symbol;
    });
  if (assigned) return true;
  const updated = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
  ].some((candidate) => {
    if (!before(candidate)) return false;
    const operator = candidate.getOperatorToken();
    if (
      operator !== SyntaxKind.PlusPlusToken &&
      operator !== SyntaxKind.MinusMinusToken
    ) {
      return false;
    }
    return mutationRootIdentifier(candidate.getOperand())?.getSymbol() === symbol;
  });
  if (updated) return true;
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => {
      if (!before(call)) return false;
      const access = memberAccess(call.getExpression());
      return (
        access !== undefined &&
        ARRAY_MUTATORS.has(access.name) &&
        mutationRootIdentifier(access.receiver)?.getSymbol() === symbol
      );
    });
}

function isStableNamedImportIdentifier(
  node: Node,
  moduleName: string,
  imported: string,
  seen = new Set<Node>(),
): boolean {
  if (!Node.isIdentifier(node) || seen.has(node)) return false;
  seen.add(node);
  const symbol = node.getSymbol();
  if (symbol === undefined) return false;
  if (identifierIsMutatedBefore(node)) return false;
  if (isDirectNamedImportIdentifier(node, moduleName, imported)) return true;
  return (
    symbol.getDeclarations().some((declaration) => {
      if (!Node.isVariableDeclaration(declaration)) return false;
      const statement = declaration.getVariableStatement();
      const initializer = declaration.getInitializer();
      return (
        statement?.getDeclarationKind() === VariableDeclarationKind.Const &&
        initializer !== undefined &&
        isStableNamedImportIdentifier(
          initializer,
          moduleName,
          imported,
          new Set(seen),
        )
      );
    })
  );
}

function isStableNamedImportCall(
  call: CallExpression,
  moduleName: string,
  imported: string,
): boolean {
  return isStableNamedImportIdentifier(
    unwrapExpression(call.getExpression()),
    moduleName,
    imported,
  );
}

function playwrightConfigSelectsRequiredSpecs(sourceFile: SourceFile): boolean {
  const exported = sourceFile.getExportAssignments()[0]?.getExpression();
  if (!Node.isCallExpression(exported)) return false;
  if (!isNamedImportCall(exported, "@playwright/test", "defineConfig")) {
    return false;
  }
  if (exported.getArguments().length !== 1) return false;
  const config = exported.getArguments()[0];
  if (config === undefined) return false;
  const configProperties = normalizedObjectProperties(config);
  if (configProperties === undefined) return false;
  const testDir = configProperties.get("testDir");
  const testDirInitializer = Node.isPropertyAssignment(testDir)
    ? testDir.getInitializer()
    : undefined;
  if (
    !Node.isStringLiteral(testDirInitializer) ||
    !["e2e", "./e2e"].includes(testDirInitializer.getLiteralText())
  ) {
    return false;
  }
  const forbidOnly = configProperties.get("forbidOnly");
  if (
    !Node.isPropertyAssignment(forbidOnly) ||
    forbidOnly.getInitializer()?.getKind() !== SyntaxKind.TrueKeyword
  ) {
    return false;
  }
  const banned = ["testIgnore", "testMatch", "grep", "grepInvert"];
  if (banned.some((name) => configProperties.has(name))) return false;
  const projects = configProperties.get("projects");
  if (projects === undefined) return true;
  if (!Node.isPropertyAssignment(projects)) return false;
  const initializer = projects.getInitializer();
  if (
    !Node.isArrayLiteralExpression(initializer) ||
    initializer.getElements().length === 0
  ) {
    return false;
  }
  return initializer.getElements().every(
    (element) => {
      const properties = normalizedObjectProperties(element);
      return (
        properties !== undefined &&
        [...banned, "testDir"].every((name) => !properties.has(name))
      );
    },
  );
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
  if (
    !Node.isCallExpression(matcherCall) ||
    matcherCall.getArguments().length !== 1
  ) {
    return false;
  }
  const matcher = matcherCall.getExpression();
  if (!Node.isPropertyAccessExpression(matcher) || matcher.getName() !== "toEqual") return false;
  const expectation = matcher.getExpression();
  if (
    !Node.isCallExpression(expectation) ||
    !isStableNamedImportCall(
      expectation,
      "@playwright/test",
      "expect",
    )
  ) {
    return false;
  }
  const expectationArguments = expectation.getArguments();
  if (
    expectationArguments.length < 1 ||
    expectationArguments.length > 2 ||
    (expectationArguments[1] !== undefined &&
      !isSideEffectFreeMessage(expectationArguments[1], resultName))
  ) {
    return false;
  }
  const subject = expectationArguments[0];
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

function isSideEffectFreeMessage(node: Node, resultName: string): boolean {
  if (
    Node.isIdentifier(node) ||
    Node.isStringLiteral(node) ||
    Node.isNumericLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node) ||
    [
      SyntaxKind.TrueKeyword,
      SyntaxKind.FalseKeyword,
      SyntaxKind.NullKeyword,
    ].includes(node.getKind())
  ) {
    return true;
  }
  if (Node.isTemplateExpression(node)) {
    return node
      .getTemplateSpans()
      .every((span) =>
        isSideEffectFreeMessage(span.getExpression(), resultName),
      );
  }
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isTypeAssertion(node) ||
    Node.isNonNullExpression(node) ||
    Node.isSatisfiesExpression(node)
  ) {
    return isSideEffectFreeMessage(node.getExpression(), resultName);
  }
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  if (
    !Node.isPropertyAccessExpression(expression) ||
    expression.getName() !== "stringify" ||
    !isUnshadowedGlobal(expression.getExpression(), "JSON")
  ) {
    return false;
  }
  const args = node.getArguments();
  return (
    args.length === 3 &&
    args[0]?.getText() === `${resultName}.violations` &&
    args[1]?.getKind() === SyntaxKind.NullKeyword &&
    Node.isNumericLiteral(args[2]) &&
    args[2].getLiteralText() === "2"
  );
}

function helperIsSanctioned(sourceFile: SourceFile): boolean {
  const helpers = sourceFile
    .getFunctions()
    .filter((fn) => fn.getName() === AXE_HELPER_EXPORT && fn.isExported() && fn.isAsync());
  if (helpers.length !== 1) return false;
  const helper = helpers[0]!;
  const topLevelStatements = sourceFile.getStatements();
  if (
    topLevelStatements.length !== 3 ||
    topLevelStatements.filter(Node.isImportDeclaration).length !== 2 ||
    !topLevelStatements.includes(helper)
  ) {
    return false;
  }
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

function specHasAxeRuntimeAccess(sourceFile: SourceFile): boolean {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.StringLiteral)
    .some((literal) =>
      literal.getLiteralText().startsWith("@axe-core/playwright"),
    );
}

function loginHelperIsSanctioned(sourceFile: SourceFile): boolean {
  const helpers = sourceFile
    .getFunctions()
    .filter(
      (fn) =>
        fn.getName() === "login" &&
        fn.isExported() &&
        fn.isAsync(),
    );
  if (helpers.length !== 1) return false;
  const helper = helpers[0]!;
  const body = helper.getBody();
  if (
    !Node.isBlock(body) ||
    helper
      .getParameters()
      .map((parameter) => parameter.getName())
      .join(",") !== "page,creds"
  ) {
    return false;
  }
  return JSON.stringify(
    body.getStatements().map((statement) => statement.getText()),
  ) ===
    JSON.stringify([
      'await page.goto("/login");',
      'await page.getByLabel("Email").fill(creds.email);',
      'await page.getByLabel("Password").fill(creds.password);',
      'await page.getByRole("button", { name: "Sign in" }).click();',
      "await page.waitForURL(/\\/app$/, { timeout: 15_000 });",
      'await expect(page.getByRole("heading", { name: "What do you want to do?" })).toBeVisible();',
    ]);
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
  const loginHelper = sourceFiles.get(E2E_HELPERS_PATH);
  if (
    loginHelper === undefined ||
    !loginHelperIsSanctioned(loginHelper)
  ) {
    problems.push(
      `${E2E_HELPERS_PATH}:1 required Axe login setup must use the uninstrumented canonical browser flow`,
    );
  }
  const config = sourceFiles.get(PLAYWRIGHT_CONFIG_PATH);
  if (config === undefined || !playwrightConfigSelectsRequiredSpecs(config)) {
    problems.push(
      `${PLAYWRIGHT_CONFIG_PATH}:1 must select every required Axe specification without testIgnore, testMatch, grep, or grepInvert filters`,
    );
  }
  for (const path of REQUIRED_AXE_SPECS) {
    const sourceFile = sourceFiles.get(path);
    if (sourceFile === undefined) {
      problems.push(`${path}:1 required Axe E2E specification is missing`);
    } else if (
      specHasAxeRuntimeAccess(sourceFile) ||
      !specAwaitsSanctionedHelper(sourceFile)
    ) {
      problems.push(`${path}:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe`);
    } else {
      for (const group of REQUIRED_ROUTE_GROUPS[path]) {
        if (
          !specCoversRouteGroup(
            sourceFile,
            group.imported,
            group.requiresLogin,
          )
        ) {
          const label =
            path === "e2e/smoke.spec.ts"
              ? "public"
              : path === "e2e/walkthrough.spec.ts"
                ? "authenticated"
                : "demo";
          problems.push(
            `${path}:1 must scan every required ${label} route after its loaded-state assertion`,
          );
          break;
        }
      }
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

const VALID_CONFIG = `import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", forbidOnly: true });`;

const VALID_LOGIN_HELPER = `import { expect, type Page } from "@playwright/test";
export async function login(page: Page, creds: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\\/app$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "What do you want to do?" })).toBeVisible();
}`;

const VALID_SPECS: Record<(typeof REQUIRED_AXE_SPECS)[number], string> = {
  "e2e/smoke.spec.ts": `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  for (const route of PUBLIC_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`,
  "e2e/walkthrough.spec.ts": `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { AUTHENTICATED_AXE_ROUTES, LOGIN_AXE_ROUTES } from "./axe-routes";
import { login } from "./helpers";
test("axe", async ({ page }) => {
  for (const route of LOGIN_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
  await login(page);
  for (const route of AUTHENTICATED_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`,
  "e2e/demo-journey.spec.ts": `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { DEMO_AXE_ROUTES } from "./axe-routes";
import { login } from "./helpers";
test("axe", async ({ page }) => {
  await login(page);
  for (const route of DEMO_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`,
};

function completeSources(
  overrides: Partial<Record<(typeof REQUIRED_AXE_SPECS)[number], string>> = {},
  helper = VALID_HELPER,
): Record<string, string> {
  return {
    [AXE_HELPER_PATH]: helper,
    [E2E_HELPERS_PATH]: VALID_LOGIN_HELPER,
    [PLAYWRIGHT_CONFIG_PATH]: VALID_CONFIG,
    ...VALID_SPECS,
    ...overrides,
  };
}

describe("axe-required fence", () => {
  it("enforces: public, authenticated, and demo E2E surfaces execute the sanctioned Axe assertion", () => {
    const paths = [
      PLAYWRIGHT_CONFIG_PATH,
      AXE_HELPER_PATH,
      E2E_HELPERS_PATH,
      ...REQUIRED_AXE_SPECS,
    ];
    const sources = Object.fromEntries(paths.map((path) => [path, readFileSync(join(REPO_ROOT, path), "utf8")]));
    const problems = axeCoverageProblems(sources);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("enforces: required route groups cover every loaded public, authenticated, and demo surface", () => {
    const inventoryProblems = pageRouteInventoryProblems(
      nextPageFiles(),
      {
        PUBLIC_AXE_ROUTES,
        LOGIN_AXE_ROUTES,
        AUTHENTICATED_AXE_ROUTES,
        DEMO_AXE_ROUTES,
      },
    );
    expect(
      inventoryProblems,
      inventoryProblems.join("\n"),
    ).toEqual([]);
    const immutabilityProblems = routeCollectionImmutabilityProblems({
      PUBLIC_AXE_ROUTES,
      LOGIN_AXE_ROUTES,
      AUTHENTICATED_AXE_ROUTES,
      DEMO_AXE_ROUTES,
    });
    expect(
      immutabilityProblems,
      immutabilityProblems.join("\n"),
    ).toEqual([]);
    expect(PUBLIC_AXE_ROUTES).toEqual([
      { path: "/", readySelector: "h1" },
    ]);
    expect(LOGIN_AXE_ROUTES).toEqual([
      { path: "/login", readySelector: "#email" },
    ]);
    expect(AUTHENTICATED_AXE_ROUTES).toEqual([
      { path: "/app", readySelector: "main h1" },
      {
        path: "/app/account-opening",
        readySelector: 'input[name="householdName"]',
      },
      {
        path: "/app/console",
        readySelector: '[data-testid="household-list"]',
      },
      {
        path: "/app/audit",
        readySelector: '[data-testid="audit-verdict"]',
      },
    ]);
    expect(DEMO_AXE_ROUTES).toEqual([
      {
        path: "/app/demo",
        readySelector: "[data-demo-launcher]",
      },
      ...DEMO_SURFACES.map((surface) => ({
        path: `/app/demo/${surface.station}?scenario=recent-bank-change-block&firm=firm-a`,
        readySelector: `[data-demo-surface="${surface.station}"]`,
      })),
    ]);
  });

  describe("detects (companion): accessibility enforcement cannot become false-green", () => {
    it("rejects an unclassified or unscanned Next page route", () => {
      const collections = {
        PUBLIC_AXE_ROUTES: [
          { path: "/", readySelector: "h1" },
        ],
        LOGIN_AXE_ROUTES: [
          { path: "/login", readySelector: "#email" },
        ],
        AUTHENTICATED_AXE_ROUTES: [
          { path: "/app", readySelector: "main" },
        ],
        DEMO_AXE_ROUTES: [
          { path: "/app/demo", readySelector: "main" },
          {
            path: "/app/demo/workspace",
            readySelector: "main",
          },
        ],
      } as const;
      const covered = [
        "src/app/page.tsx",
        "src/app/login/page.tsx",
        "src/app/app/page.tsx",
        "src/app/app/demo/page.tsx",
        "src/app/app/demo/[station]/page.tsx",
      ];
      expect(
        pageRouteInventoryProblems(covered, collections),
      ).toEqual([]);
      expect(
        pageRouteInventoryProblems(
          [...covered, "src/app/privacy/page.tsx"],
          collections,
        ),
      ).toContain(
        "src/app/privacy/page.tsx: route /privacy is absent from PUBLIC_AXE_ROUTES",
      );
      expect(
        pageRouteInventoryProblems(
          [...covered, "src/app/@modal/page.tsx"],
          collections,
        ),
      ).toContain(
        "src/app/@modal/page.tsx: Next page route cannot be classified for Axe",
      );
    });

    it("rejects a required spec without an awaited sanctioned scan", () => {
      const sources = completeSources({
        "e2e/walkthrough.spec.ts":
          `import { test } from "@playwright/test"; test("page works", async ({ page }) => page.goto("/"));`,
      });
      expect(axeCoverageProblems(sources)).toEqual([
        "e2e/walkthrough.spec.ts:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe",
      ]);
    });

    it("accepts aliases at module scope and directly inside enabled test.describe", () => {
      const moduleSpec = `import { expect as verify, test as check } from "@playwright/test";
import { assertNoAxeViolations as scan } from "./axe";
import { PUBLIC_AXE_ROUTES as routes } from "./axe-routes";
check("axe", async ({ page }) => {
  for (const route of routes) {
    await page.goto(route.path);
    await verify(page.locator(route.readySelector)).toBeVisible();
    await scan(page, route.path);
  }
});`;
      expect(
        axeCoverageProblems(
          completeSources({ "e2e/smoke.spec.ts": moduleSpec }),
        ),
      ).toEqual([]);
      const describeSpec = `import { expect as verify, test as check } from "@playwright/test";
import { assertNoAxeViolations as scan } from "./axe";
import { PUBLIC_AXE_ROUTES as routes } from "./axe-routes";
check.describe("group", () => {
  check("axe", async ({ page }) => {
    for (const route of routes) {
      await page.goto(route.path);
      await verify(page.locator(route.readySelector)).toBeVisible();
      await scan(page, route.path);
    }
  });
});`;
      expect(
        axeCoverageProblems(
          completeSources({ "e2e/smoke.spec.ts": describeSpec }),
        ),
      ).toEqual([]);
      const namespaceSpec = `import * as pw from "@playwright/test";
import { assertNoAxeViolations as scan } from "./axe";
import { PUBLIC_AXE_ROUTES as routes } from "./axe-routes";
pw.test("axe", async ({ page }) => {
  for (const route of routes) {
    await page.goto(route.path);
    await pw.expect(page.locator(route.readySelector)).toBeVisible();
    await scan(page, route.path);
  }
});`;
      expect(
        axeCoverageProblems(
          completeSources({ "e2e/smoke.spec.ts": namespaceSpec }),
        ),
      ).toEqual([]);
    });

    it("rejects sanctioned-helper aliases assigned only in unreachable control flow", () => {
      const spec = `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  let scan = async () => {};
  if (false) scan = assertNoAxeViolations;
  for (const route of PUBLIC_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await scan(page, route.path);
  }
});`;
      expect(
        axeCoverageProblems(
          completeSources({ "e2e/smoke.spec.ts": spec }),
        ),
      ).toContain(
        "e2e/smoke.spec.ts:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe",
      );
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
        wrap(`test("axe", async ({ page }) => { let disable: typeof test.${"fail"}; disable = test.${"fail"}; disable(); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`(test.${"skip"} as typeof test.${"skip"})(true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`(<typeof test.${"fixme"}>test.${"fixme"})(true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }, testInfo) => { testInfo.${"skip"}(true, "disabled"); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }, testInfo) => { const disable = testInfo.${"fixme"}; disable(true, "disabled"); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }) => { test.info().${"skip"}(true, "disabled"); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }) => { const info = test.info(); const disable = info.${"fixme"}; disable(true, "disabled"); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }) => { const { ${"fail"}: disable } = test.info(); disable(true, "expected failure"); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }, { ${"skip"}: disable }) => { disable(true, "disabled"); await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test.beforeEach(async ({}, testInfo) => { testInfo.${"fixme"}(true, "disabled"); }); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test.describe("group", () => { test.beforeEach(async ({}, testInfo) => { testInfo.${"fail"}(true, "expected failure"); }); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); }); });`),
        wrap(`test.beforeEach(() => { test.info().${"fixme"}(true, "disabled"); }); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }) => { assertNoAxeViolations(page, "surface"); });`),
        wrap(`test("axe", async ({ page }) => { try { await assertNoAxeViolations(page, "surface"); } catch {} });`),
        wrap(`test("axe", async () => { const assertNoAxeViolations = async () => {}; await assertNoAxeViolations(); });`),
        wrap(`test.describe("group", () => { const test = (...args: unknown[]) => args; test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); }); });`),
        wrap(`test["skip"](() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`const skip = test.${"skip"}; skip(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`const { fixme: disable } = test; disable(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`const disable = test["skip"]; disable(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`const { ["fixme"]: disable } = test; disable(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
      ];
      for (const spec of invalid) {
        const overrides = Object.fromEntries(
          REQUIRED_AXE_SPECS.map((path) => [path, spec]),
        );
        expect(
          axeCoverageProblems(completeSources(overrides)),
          spec,
        ).toHaveLength(REQUIRED_AXE_SPECS.length);
      }
    });

    it("rejects Playwright configuration that excludes required accessibility tests", () => {
      for (const selector of [
        'testIgnore: ["**/smoke.spec.ts"]',
        '["testIgnore"]: ["**/smoke.spec.ts"]',
        'testMatch: ["**/console.spec.ts"]',
        'grep: /unrelated/',
        'grepInvert: /Axe/',
        'projects: []',
        'projects: [{ name: "filtered", testDir: "./other" }]',
        'projects: [{ name: "filtered", ["testDir"]: "./other" }]',
      ]) {
        const sources = completeSources();
        sources[PLAYWRIGHT_CONFIG_PATH] =
          `import { defineConfig } from "@playwright/test"; export default defineConfig({ testDir: "./e2e", forbidOnly: true, ${selector} });`;
        expect(axeCoverageProblems(sources), selector).toContain(
          "playwright.config.ts:1 must select every required Axe specification without testIgnore, testMatch, grep, or grepInvert filters",
        );
      }
      const focused = completeSources();
      focused[PLAYWRIGHT_CONFIG_PATH] =
        `import { defineConfig } from "@playwright/test"; export default defineConfig({ testDir: "./e2e", forbidOnly: false });`;
      expect(axeCoverageProblems(focused)).toContain(
        "playwright.config.ts:1 must select every required Axe specification without testIgnore, testMatch, grep, or grepInvert filters",
      );
      const merged = completeSources();
      merged[PLAYWRIGHT_CONFIG_PATH] =
        `import { defineConfig } from "@playwright/test"; export default defineConfig({ testDir: "./e2e", forbidOnly: true }, { testIgnore: ["**/smoke.spec.ts"] });`;
      expect(axeCoverageProblems(merged)).toContain(
        "playwright.config.ts:1 must select every required Axe specification without testIgnore, testMatch, grep, or grepInvert filters",
      );
      const unresolved = completeSources();
      unresolved[PLAYWRIGHT_CONFIG_PATH] =
        `import { defineConfig } from "@playwright/test"; const selection = "testIgnore"; export default defineConfig({ testDir: "./e2e", forbidOnly: true, [selection]: ["**/smoke.spec.ts"] });`;
      expect(axeCoverageProblems(unresolved)).toContain(
        "playwright.config.ts:1 must select every required Axe specification without testIgnore, testMatch, grep, or grepInvert filters",
      );
    });

    it("rejects a required specification that scans the wrong route or an unloaded state", () => {
      const sources = completeSources({
        "e2e/walkthrough.spec.ts": `import { test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
test("axe", async ({ page }) => {
  await page.goto("/");
  await assertNoAxeViolations(page, "wrong route");
});`,
      });
      expect(axeCoverageProblems(sources)).toContain(
        "e2e/walkthrough.spec.ts:1 must scan every required authenticated route after its loaded-state assertion",
      );
    });

    it("rejects route loops hidden in uncalled functions or caught branches", () => {
      const hiddenLoops = [
        `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  await assertNoAxeViolations(page, "decoy");
  async function neverCalled() {
    for (const route of PUBLIC_AXE_ROUTES) {
      await page.goto(route.path);
      await expect(page.locator(route.readySelector)).toBeVisible();
      await assertNoAxeViolations(page, route.path);
    }
  }
});`,
        `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  await assertNoAxeViolations(page, "decoy");
  try {
    for (const route of PUBLIC_AXE_ROUTES) {
      await page.goto(route.path);
      await expect(page.locator(route.readySelector)).toBeVisible();
      await assertNoAxeViolations(page, route.path);
    }
  } catch {}
});`,
      ];
      for (const spec of hiddenLoops) {
        expect(
          axeCoverageProblems(
            completeSources({ "e2e/smoke.spec.ts": spec }),
          ),
          spec,
        ).toContain(
          "e2e/smoke.spec.ts:1 must scan every required public route after its loaded-state assertion",
        );
      }
    });

    it("rejects route aliases assigned only in unreachable control flow", () => {
      const spec = `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  let routes: typeof PUBLIC_AXE_ROUTES = [];
  if (false) routes = PUBLIC_AXE_ROUTES;
  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`;
      expect(
        axeCoverageProblems(
          completeSources({ "e2e/smoke.spec.ts": spec }),
        ),
      ).toContain(
        "e2e/smoke.spec.ts:1 must scan every required public route after its loaded-state assertion",
      );
    });

    it("rejects mutable route collections and mutation before a required loop", () => {
      const mutableCollection = [
        Object.freeze({ path: "/", readySelector: "h1" }),
      ];
      expect(
        routeCollectionImmutabilityProblems({
          MUTABLE: mutableCollection,
        }),
      ).toContain("MUTABLE route collection must be frozen");
      expect(
        routeCollectionImmutabilityProblems({
          MUTABLE_ENTRY: Object.freeze([
            { path: "/", readySelector: "h1" },
          ]),
        }),
      ).toContain("MUTABLE_ENTRY route entries must be frozen");

      const spec = `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  (PUBLIC_AXE_ROUTES as unknown as { length: number }).length = 0;
  for (const route of PUBLIC_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`;
      expect(
        axeCoverageProblems(
          completeSources({ "e2e/smoke.spec.ts": spec }),
        ),
      ).toContain(
        "e2e/smoke.spec.ts:1 must scan every required public route after its loaded-state assertion",
      );
    });

    it("rejects route loops after conditional callback exits", () => {
      const spec = `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  if (true) return;
  for (const route of PUBLIC_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`;
      expect(
        axeCoverageProblems(
          completeSources({ "e2e/smoke.spec.ts": spec }),
        ),
      ).toContain(
        "e2e/smoke.spec.ts:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe",
      );
    });

    it("rejects namespace-imported Playwright neutralizers", () => {
      const neutralizers = [
        'pw.test["skip"](() => true, "file disabled");',
        'const check = pw.test; const disable = check.fixme; disable(() => true, "file disabled");',
        'const { test: check } = pw; const { ["fail"]: disable } = check; disable(() => true, "expected failure");',
      ];
      for (const neutralizer of neutralizers) {
        const spec = `import { expect, test } from "@playwright/test";
import * as pw from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
${neutralizer}
test("axe", async ({ page }) => {
  for (const route of PUBLIC_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`;
        expect(
          axeCoverageProblems(
            completeSources({ "e2e/smoke.spec.ts": spec }),
          ),
          spec,
        ).toContain(
          "e2e/smoke.spec.ts:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe",
        );
      }
    });

    it("rejects Playwright neutralizer aliases introduced by later assignments", () => {
      const neutralizers = [
        `let disable: typeof test.${"skip"};
disable = test.${"skip"};
disable(true, "file disabled");`,
        `let disable: typeof test.${"fixme"};
disable = test["${"fixme"}"];
disable(true, "file disabled");`,
        `let check: typeof pw.test;
check = pw.test;
let disable: typeof check.fail;
disable = check.fail;
disable(true, "expected failure");`,
        `let disable: typeof test.${"skip"};
disable = test.${"skip"};
if (false) disable = (() => {}) as typeof test.${"skip"};
disable(true, "file disabled");`,
      ];
      for (const neutralizer of neutralizers) {
        const spec = `import { expect, test } from "@playwright/test";
import * as pw from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
${neutralizer}
test("axe", async ({ page }) => {
  for (const route of PUBLIC_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`;
        expect(
          axeCoverageProblems(
            completeSources({ "e2e/smoke.spec.ts": spec }),
          ),
          spec,
        ).toContain(
          "e2e/smoke.spec.ts:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe",
        );
      }
    });

    it("rejects bound and transitively invoked Playwright neutralizers", () => {
      const neutralizers = [
        `const disable = test.${"skip"}.bind(test);
disable(true, "file disabled");`,
        `test.${"skip"}.call(test, true, "file disabled");`,
        `test.${"fixme"}.apply(test, [true, "file disabled"]);`,
        `Reflect.apply(test.${"skip"}, test, [true, "file disabled"]);`,
        `const invoke = Reflect.apply;
invoke(test.${"fixme"}, test, [true, "file disabled"]);`,
        `Reflect.apply.call(
  Reflect,
  test.${"skip"},
  test,
  [true, "file disabled"],
);`,
        `Reflect.apply.apply(Reflect, [
  test.${"fixme"},
  test,
  [true, "file disabled"],
]);`,
        `Reflect.apply(
  Reflect.apply,
  Reflect,
  [test.${"fail"}, test, [true, "expected failure"]],
);`,
        `function disable() {
  test.info().${"fixme"}(true, "file disabled");
}
disable();`,
        `function neutralize() {
  test.info().${"fixme"}(true, "file disabled");
}
const disable = neutralize;
disable();`,
        `await test.step("disable", async () => {
  test.info().${"skip"}(true, "file disabled");
});`,
        `const disable = async () => {
  test.info().${"fixme"}(true, "file disabled");
};
await test.step("disable", disable);`,
        `const disable = Math.random() > 2
  ? () => test.info().${"fail"}(true, "expected failure")
  : () => {};
disable();`,
      ];
      for (const neutralizer of neutralizers) {
        const spec = `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  ${neutralizer}
  for (const route of PUBLIC_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`;
        expect(
          axeCoverageProblems(
            completeSources({ "e2e/smoke.spec.ts": spec }),
          ),
          spec,
        ).toContain(
          "e2e/smoke.spec.ts:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe",
        );
      }
    });

    it("rejects page instrumentation before required route scans", () => {
      for (const setup of [
        `await page.addInitScript(() => {
  document.documentElement.dataset.hideInaccessible = "true";
});`,
        `await page.route("**/*", async (route) => {
  await route.fulfill({ body: "<main><h1>Accessible replacement</h1></main>" });
});`,
      ]) {
        const spec = `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { PUBLIC_AXE_ROUTES } from "./axe-routes";
test("axe", async ({ page }) => {
  ${setup}
  for (const route of PUBLIC_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`;
        expect(
          axeCoverageProblems(
            completeSources({ "e2e/smoke.spec.ts": spec }),
          ),
          spec,
        ).toContain(
          "e2e/smoke.spec.ts:1 must scan every required public route after its loaded-state assertion",
        );
      }
      const hooked = VALID_SPECS["e2e/smoke.spec.ts"].replace(
        'test("axe"',
        `test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.documentElement.dataset.hideInaccessible = "true";
  });
});
test("axe"`,
      );
      expect(
        axeCoverageProblems(
          completeSources({ "e2e/smoke.spec.ts": hooked }),
        ),
        hooked,
      ).toContain(
        "e2e/smoke.spec.ts:1 must scan every required public route after its loaded-state assertion",
      );
      const sources = completeSources();
      sources[E2E_HELPERS_PATH] = VALID_LOGIN_HELPER.replace(
        '  await page.goto("/login");',
        `  await page.addInitScript(() => {
    document.documentElement.dataset.hideInaccessible = "true";
  });
  await page.goto("/login");`,
      );
      expect(axeCoverageProblems(sources)).toContain(
        "e2e/helpers.ts:1 required Axe login setup must use the uninstrumented canonical browser flow",
      );
    });

    it("rejects caught, transformed, incomplete, or masked helper assertions", () => {
      const invalid = [
        VALID_HELPER.replace("expect(results.violations, context).toEqual([]);", "try { expect(results.violations, context).toEqual([]); } catch {}"),
        VALID_HELPER.replace("results.violations, context", "results.violations.filter(() => false), context"),
        VALID_HELPER.replace("expect(results.violations, context)", "results.violations.length = 0;\n  expect(results.violations, context)"),
        VALID_HELPER.replace("expect(results.violations, context)", "expect(results.violations, (results.violations.length = 0, context))"),
        VALID_HELPER.replace(
          'import { expect, type Page } from "@playwright/test";',
          'import { expect as playwrightExpect, type Page } from "@playwright/test";\nlet expect = () => ({ toEqual: () => undefined });\nif (false) expect = playwrightExpect;',
        ),
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
        expect(axeCoverageProblems(completeSources({}, helper)), helper).toContain(
          "e2e/axe.ts:1 must settle document animations without mutating the DOM, directly await the complete WCAG Axe scan, and assert its unmodified violations",
        );
      }
    });

    it("rejects module-scope Axe runtime instrumentation in the helper and required specs", () => {
      const instrumentedHelper = VALID_HELPER.replace(
        'import { expect, type Page } from "@playwright/test";',
        `import { expect, type Page } from "@playwright/test";
Axe.prototype.analyze = async () => ({ violations: [] }) as never;`,
      );
      expect(
        axeCoverageProblems(completeSources({}, instrumentedHelper)),
      ).toContain(
        "e2e/axe.ts:1 must settle document animations without mutating the DOM, directly await the complete WCAG Axe scan, and assert its unmodified violations",
      );

      const instrumentedSpec = VALID_SPECS["e2e/smoke.spec.ts"].replace(
        'import { expect, test } from "@playwright/test";',
        `import { expect, test } from "@playwright/test";
import Axe from "@axe-core/playwright";
Axe.prototype.analyze = async () => ({ violations: [] }) as never;`,
      );
      expect(
        axeCoverageProblems(
          completeSources({
            "e2e/smoke.spec.ts": instrumentedSpec,
          }),
        ),
      ).toContain(
        "e2e/smoke.spec.ts:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe",
      );
    });
  });
});
