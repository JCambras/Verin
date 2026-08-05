import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { getSortedRoutes } from "next/dist/shared/lib/router/utils/sorted-routes";
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  VariableDeclarationKind,
  type ArrowFunction,
  type BinaryExpression,
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
import {
  reflectApplyTarget,
  reflectGetAccess,
} from "./_callable-indirection";
import { hasRegisteredPlaywrightHook } from "./_playwright-hook-analysis";
import {
  moduleReferences,
  REPO_ROOT,
} from "./_fence-utils";

const AXE_HELPER_PATH = "e2e/axe.ts";
const E2E_HELPERS_PATH = "e2e/helpers.ts";
const AXE_ROUTES_PATH = "e2e/axe-routes.ts";
const PLAYWRIGHT_CONFIG_PATH = "playwright.config.ts";
const TSCONFIG_PATH = "tsconfig.json";
const AXE_HELPER_EXPORT = "assertNoAxeViolations";
const REQUIRED_AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;
const REQUIRED_AXE_SPECS = [
  "e2e/smoke.spec.ts",
  "e2e/walkthrough.spec.ts",
  "e2e/demo-journey.spec.ts",
] as const;
const AXE_IMPORT_GRAPH_ROOTS = [
  AXE_HELPER_PATH,
  E2E_HELPERS_PATH,
  ...REQUIRED_AXE_SPECS,
] as const;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;
const ALLOWED_AXE_EXTERNAL_MODULES = new Set([
  "@axe-core/playwright",
  "@playwright/test",
]);

interface LocalModuleConfig {
  readonly baseUrl: string;
  readonly paths: Readonly<Record<string, readonly string[]>>;
}

interface RuntimeModuleReference {
  readonly specifier?: string;
  readonly display: string;
}

function parseLocalModuleConfig(
  source: string | undefined,
): LocalModuleConfig | undefined {
  if (source === undefined) return undefined;
  const parsed = ts.parseConfigFileTextToJson(TSCONFIG_PATH, source);
  if (
    parsed.error !== undefined ||
    parsed.config === null ||
    typeof parsed.config !== "object" ||
    parsed.config.extends !== undefined
  ) {
    return undefined;
  }
  const compilerOptions = parsed.config.compilerOptions as
    | {
        baseUrl?: unknown;
        paths?: unknown;
      }
    | undefined;
  const baseUrl =
    typeof compilerOptions?.baseUrl === "string"
      ? compilerOptions.baseUrl
      : ".";
  const rawPaths = compilerOptions?.paths;
  const paths =
    rawPaths !== null && typeof rawPaths === "object"
      ? Object.fromEntries(
          Object.entries(rawPaths).flatMap(([pattern, targets]) =>
            Array.isArray(targets) &&
            targets.every((target) => typeof target === "string")
              ? [[pattern, targets]]
              : [],
          ),
        )
      : {};
  return { baseUrl, paths };
}

function normalizedRepoPath(path: string): string | undefined {
  const normalized = posix.normalize(path).replace(/^\.\//, "");
  return normalized === ".." ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized)
    ? undefined
    : normalized;
}

function pathPatternCapture(pattern: string, specifier: string): string | undefined {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : undefined;
  if (pattern.indexOf("*", star + 1) !== -1) return undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return specifier.startsWith(prefix) && specifier.endsWith(suffix)
    ? specifier.slice(prefix.length, specifier.length - suffix.length)
    : undefined;
}

function localModuleBases(
  importer: string,
  specifier: string,
  config: LocalModuleConfig,
): string[] | undefined {
  if (specifier.startsWith(".")) {
    const resolved = normalizedRepoPath(
      posix.join(posix.dirname(importer), specifier),
    );
    return resolved === undefined ? [] : [resolved];
  }
  const bases = Object.entries(config.paths).flatMap(
    ([pattern, targets]) => {
      const capture = pathPatternCapture(pattern, specifier);
      if (capture === undefined) return [];
      return targets.flatMap((target) => {
        const star = target.indexOf("*");
        const substituted =
          star === -1
            ? target
            : `${target.slice(0, star)}${capture}${target.slice(star + 1)}`;
        const resolved = normalizedRepoPath(
          posix.join(config.baseUrl, substituted),
        );
        return resolved === undefined ? [] : [resolved];
      });
    },
  );
  return bases.length === 0 ? undefined : bases;
}

function sourcePathCandidates(base: string): string[] {
  const extension = posix.extname(base);
  if (SOURCE_EXTENSIONS.includes(extension as (typeof SOURCE_EXTENSIONS)[number])) {
    return [base];
  }
  const sourceBase = [".js", ".jsx", ".mjs", ".cjs"].includes(extension)
    ? base.slice(0, -extension.length)
    : base;
  return [
    ...SOURCE_EXTENSIONS.map((candidate) => `${sourceBase}${candidate}`),
    ...SOURCE_EXTENSIONS.map((candidate) =>
      posix.join(sourceBase, `index${candidate}`),
    ),
  ];
}

function runtimeModuleReferences(sourceFile: SourceFile): RuntimeModuleReference[] {
  const references: RuntimeModuleReference[] = [];
  for (const declaration of sourceFile.getImportDeclarations()) {
    const clause = declaration.getImportClause();
    const namedImports = declaration.getNamedImports();
    const runtime =
      clause === undefined ||
      (!declaration.isTypeOnly() &&
        (declaration.getDefaultImport() !== undefined ||
          declaration.getNamespaceImport() !== undefined ||
          namedImports.length === 0 ||
          namedImports.some((specifier) => !specifier.isTypeOnly())));
    if (runtime) {
      const specifier = declaration.getModuleSpecifierValue();
      references.push({ specifier, display: specifier });
    }
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = declaration.getModuleSpecifierValue();
    if (moduleSpecifier === undefined || declaration.isTypeOnly()) continue;
    const namedExports = declaration.getNamedExports();
    if (
      namedExports.length > 0 &&
      namedExports.every((specifier) => specifier.isTypeOnly())
    ) {
      continue;
    }
    references.push({ specifier: moduleSpecifier, display: moduleSpecifier });
  }
  for (const declaration of sourceFile.getDescendantsOfKind(
    SyntaxKind.ImportEqualsDeclaration,
  )) {
    if (declaration.isTypeOnly()) continue;
    const moduleReference = declaration.getModuleReference();
    if (!Node.isExternalModuleReference(moduleReference)) continue;
    const expression = moduleReference.getExpression();
    references.push(
      Node.isStringLiteral(expression)
        ? {
            specifier: expression.getLiteralText(),
            display: expression.getLiteralText(),
          }
        : { display: expression?.getText() ?? "<non-literal>" },
    );
  }
  for (const call of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    const expression = call.getExpression();
    if (
      isGlobalStaticCallable(
        expression,
        "process",
        "getBuiltinModule",
      )
    ) {
      const builtin = staticStringValue(call.getArguments()[0]);
      if (
        builtin === undefined ||
        builtin === "module" ||
        builtin === "node:module"
      ) {
        references.push({ display: "<process.getBuiltinModule>" });
      }
      continue;
    }
    const isDynamicImport =
      expression.getKind() === SyntaxKind.ImportKeyword;
    const isRequire =
      Node.isIdentifier(expression) &&
      expression.getText() === "require" &&
      (expression
        .getSymbol()
        ?.getDeclarations()
        .every(
          (declaration) =>
            declaration.getSourceFile() !== sourceFile,
        ) ??
        true);
    if (!isDynamicImport && !isRequire) continue;
    const argument = call.getArguments()[0];
    references.push(
      Node.isStringLiteral(argument) ||
        Node.isNoSubstitutionTemplateLiteral(argument)
        ? {
            specifier: argument.getLiteralText(),
            display: argument.getLiteralText(),
          }
        : { display: argument?.getText() ?? "<missing>" },
    );
  }
  for (const reference of moduleReferences(sourceFile)) {
    if (
      reference.kind !== "require-reference" &&
      reference.kind !== "create-require"
    ) {
      continue;
    }
    references.push({
      display: `<${reference.kind}>`,
    });
  }
  return references;
}

function resolveLocalModulePath(
  importer: string,
  specifier: string,
  config: LocalModuleConfig,
  exists: (path: string) => boolean,
): string | undefined | null {
  const bases = localModuleBases(importer, specifier, config);
  if (bases === undefined) return undefined;
  return (
    bases
      .flatMap(sourcePathCandidates)
      .find(exists) ?? null
  );
}

function readAxeAnalysisSources(): Record<string, string> {
  const sources: Record<string, string> = {
    [TSCONFIG_PATH]: readFileSync(join(REPO_ROOT, TSCONFIG_PATH), "utf8"),
    [PLAYWRIGHT_CONFIG_PATH]: readFileSync(
      join(REPO_ROOT, PLAYWRIGHT_CONFIG_PATH),
      "utf8",
    ),
  };
  const config = parseLocalModuleConfig(sources[TSCONFIG_PATH]) ?? {
    baseUrl: ".",
    paths: {},
  };
  const project = new Project({ useInMemoryFileSystem: true });
  const pending: string[] = [...AXE_IMPORT_GRAPH_ROOTS];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (sources[path] !== undefined) continue;
    const source = readFileSync(join(REPO_ROOT, path), "utf8");
    sources[path] = source;
    const sourceFile = project.createSourceFile(`/${path}`, source);
    for (const reference of runtimeModuleReferences(sourceFile)) {
      if (reference.specifier === undefined) continue;
      const resolved = resolveLocalModulePath(
        path,
        reference.specifier,
        config,
        (candidate) => existsSync(join(REPO_ROOT, candidate)),
      );
      if (resolved !== undefined && resolved !== null) pending.push(resolved);
    }
  }
  return sources;
}
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
    const byPattern = new Map<string, { file: string; pattern: string }>();
    for (const page of pages) {
      if (byPattern.has(page.pattern)) {
        problems.push(
          `${page.file}: route ${page.pattern} duplicates another Next page pattern`,
        );
      } else {
        byPattern.set(page.pattern, page);
      }
    }
    let sortedPatterns: string[];
    try {
      sortedPatterns = getSortedRoutes([...byPattern.keys()]);
    } catch {
      problems.push(`${name}: Next page patterns cannot be precedence-sorted`);
      continue;
    }
    const ownedPages = new Set<string>();
    for (const path of paths) {
      const winningPattern = sortedPatterns.find((pattern) =>
        routeMatchesPattern(pattern, path),
      );
      const winner =
        winningPattern === undefined
          ? undefined
          : byPattern.get(winningPattern);
      if (winner === undefined) {
        problems.push(
          `${name}: route ${path} has no classified Next page.tsx owner`,
        );
      } else {
        ownedPages.add(winner.file);
      }
    }
    for (const page of pages) {
      if (!ownedPages.has(page.file)) {
        problems.push(
          `${page.file}: route ${page.pattern} has no scanned URL that resolves to it in ${name}`,
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

function declarativeAxeRouteCollections(
  sourceFile: SourceFile,
): Readonly<Record<RouteCollectionName, RouteCollection>> | undefined {
  const helper = sourceFile
    .getFunctions()
    .filter((fn) => fn.getName() === "axeRoute");
  if (helper.length !== 1) return undefined;
  const helperBody = helper[0]!.getBody();
  const helperReturn =
    Node.isBlock(helperBody) && helperBody.getStatements().length === 1
      ? helperBody.getStatements()[0]
      : undefined;
  if (
    helper[0]!.isExported() ||
    helper[0]!.getParameters().map((parameter) => parameter.getName()).join(
      ",",
    ) !== "path,readySelector" ||
    !Node.isReturnStatement(helperReturn)
  ) {
    return undefined;
  }
  const freeze = helperReturn.getExpression();
  if (!Node.isCallExpression(freeze) || freeze.getArguments().length !== 1) {
    return undefined;
  }
  const freezeMember = memberAccess(freeze.getExpression());
  const frozenObject = freeze.getArguments()[0];
  if (
    freezeMember?.name !== "freeze" ||
    !isUnshadowedGlobal(freezeMember.receiver, "Object") ||
    !Node.isObjectLiteralExpression(frozenObject) ||
    frozenObject.getProperties().length !== 2 ||
    !frozenObject
      .getProperties()
      .every(
        (property) =>
          Node.isShorthandPropertyAssignment(property) &&
          ["path", "readySelector"].includes(property.getName()),
      )
  ) {
    return undefined;
  }
  const names: readonly RouteCollectionName[] = [
    "PUBLIC_AXE_ROUTES",
    "LOGIN_AXE_ROUTES",
    "AUTHENTICATED_AXE_ROUTES",
    "DEMO_AXE_ROUTES",
  ];
  const collections = new Map<RouteCollectionName, RouteCollection>();
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();
    if (!names.includes(name as RouteCollectionName)) continue;
    const statement = declaration.getVariableStatement();
    const initializer = declaration.getInitializer();
    const frozen = initializer && unwrapExpression(initializer);
    if (
      statement === undefined ||
      !statement.isExported() ||
      statement.getDeclarationKind() !== VariableDeclarationKind.Const ||
      statement.getDeclarations().length !== 1 ||
      !Node.isCallExpression(frozen) ||
      frozen.getArguments().length !== 1
    ) {
      return undefined;
    }
    const member = memberAccess(frozen.getExpression());
    const routes = unwrapExpression(frozen.getArguments()[0]!);
    if (
      member?.name !== "freeze" ||
      !isUnshadowedGlobal(member.receiver, "Object") ||
      !Node.isArrayLiteralExpression(routes) ||
      routes.getElements().length === 0
    ) {
      return undefined;
    }
    const parsed: Array<{ path: string; readySelector: string }> = [];
    for (const element of routes.getElements()) {
      if (
        !Node.isCallExpression(element) ||
        element.getExpression().getText() !== "axeRoute" ||
        element.getArguments().length !== 2
      ) {
        return undefined;
      }
      const [path, readySelector] = element.getArguments();
      if (
        !Node.isStringLiteral(path) ||
        !Node.isStringLiteral(readySelector)
      ) {
        return undefined;
      }
      parsed.push({
        path: path.getLiteralText(),
        readySelector: readySelector.getLiteralText(),
      });
    }
    collections.set(name as RouteCollectionName, parsed);
  }
  if (
    collections.size !== names.length ||
    sourceFile.getStatements().some((statement) => {
      if (Node.isInterfaceDeclaration(statement)) return false;
      if (statement === helper[0]) return false;
      if (!Node.isVariableStatement(statement)) return true;
      return !statement
        .getDeclarations()
        .every((declaration) =>
          names.includes(declaration.getName() as RouteCollectionName),
        );
    })
  ) {
    return undefined;
  }
  return Object.fromEntries(collections) as Record<
    RouteCollectionName,
    RouteCollection
  >;
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

const BINARY_EXPRESSION_CACHE = new WeakMap<
  SourceFile,
  BinaryExpression[]
>();

function binaryExpressions(sourceFile: SourceFile): BinaryExpression[] {
  const cached = BINARY_EXPRESSION_CACHE.get(sourceFile);
  if (cached !== undefined) return cached;
  const expressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  );
  BINARY_EXPRESSION_CACHE.set(sourceFile, expressions);
  return expressions;
}

function latestPrecedingAssignment(node: Node): Node | undefined {
  if (!Node.isIdentifier(node)) return undefined;
  const symbol = node.getSymbol();
  if (symbol === undefined) return undefined;
  return binaryExpressions(node.getSourceFile())
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
  return binaryExpressions(node.getSourceFile())
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
    const name = staticStringValue(argument);
    if (name !== undefined) {
      return {
        receiver: normalized.getExpression(),
        name,
      };
    }
  }
  return undefined;
}

function staticStringValue(
  node: Node | undefined,
  seen = new Set<Node>(),
): string | undefined {
  if (node === undefined) return undefined;
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (
    Node.isStringLiteral(normalized) ||
    Node.isNoSubstitutionTemplateLiteral(normalized)
  ) {
    return normalized.getLiteralText();
  }
  if (
    Node.isBinaryExpression(normalized) &&
    normalized.getOperatorToken().getKind() === SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(normalized.getLeft(), new Set(seen));
    const right = staticStringValue(
      normalized.getRight(),
      new Set(seen),
    );
    return left === undefined || right === undefined
      ? undefined
      : `${left}${right}`;
  }
  if (!Node.isIdentifier(normalized)) return undefined;
  const sources = [
    ...(normalized
      .getSymbol()
      ?.getDeclarations()
      .flatMap((declaration) => {
        if (!Node.isVariableDeclaration(declaration)) return [];
        const initializer = declaration.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }) ?? []),
    ...precedingAssignmentValues(normalized),
  ];
  const values = sources.map((source) =>
    staticStringValue(source, new Set(seen)),
  );
  return values.length > 0 &&
    values.every(
      (value) => value !== undefined && value === values[0],
    )
    ? values[0]
    : undefined;
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
    return staticStringValue(node.getExpression());
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

function objectAliasSources(node: Node): Node[] {
  const normalized = unwrapExpression(node);
  if (Node.isIdentifier(normalized)) {
    return [
      ...(normalized
        .getSymbol()
        ?.getDeclarations()
        .flatMap((declaration) => {
          if (Node.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer();
            return initializer === undefined ? [] : [initializer];
          }
          if (!Node.isBindingElement(declaration)) return [];
          const property =
            declaration.getPropertyNameNode() ?? declaration.getNameNode();
          const name = staticPropertyName(property);
          const variable = declaration.getFirstAncestorByKind(
            SyntaxKind.VariableDeclaration,
          );
          const initializer = variable?.getInitializer();
          return name === undefined || initializer === undefined
            ? []
            : objectPropertySources(initializer, name);
        }) ?? []),
      ...precedingAssignmentValues(normalized),
    ];
  }
  if (
    Node.isCallExpression(normalized) &&
    isObjectAssignCallable(normalized.getExpression())
  ) {
    const target = normalized.getArguments()[0];
    return target === undefined ? [] : [target];
  }
  return [];
}

function sameObjectReference(
  left: Node,
  right: Node,
): boolean {
  const leftKeys = objectReferenceKeys(left);
  return [...objectReferenceKeys(right)].some((key) =>
    leftKeys.has(key),
  );
}

function objectReferenceKeys(
  node: Node,
  seen = new Set<Node>(),
): Set<string> {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return new Set();
  seen.add(normalized);
  if (Node.isIdentifier(normalized)) {
    const keys = new Set<string>();
    const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
    if (declarations.length > 0) {
      keys.add(
        `symbol:${declarations
          .map(
            (declaration) =>
              `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`,
          )
          .sort()
          .join("|")}`,
      );
    }
    for (const source of objectAliasSources(normalized)) {
      for (const key of objectReferenceKeys(source, new Set(seen))) {
        keys.add(key);
      }
    }
    return keys;
  }
  const access = memberAccess(normalized);
  if (access !== undefined) {
    const keys = new Set(
      [...objectReferenceKeys(access.receiver, new Set(seen))].map(
        (key) => `member:${key}:${access.name}`,
      ),
    );
    for (const source of objectPropertySources(
      access.receiver,
      access.name,
    )) {
      for (const key of objectReferenceKeys(source, new Set(seen))) {
        keys.add(key);
      }
    }
    return keys;
  }
  if (
    Node.isCallExpression(normalized) &&
    isObjectAssignCallable(normalized.getExpression())
  ) {
    const target = normalized.getArguments()[0];
    return target === undefined
      ? new Set()
      : objectReferenceKeys(target, new Set(seen));
  }
  return new Set([
    `node:${normalized.getSourceFile().getFilePath()}:${normalized.getStart()}`,
  ]);
}

function isObjectAssignCallable(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  return isGlobalStaticCallable(node, "Object", "assign", seen);
}

function isGlobalStaticCallable(
  node: Node,
  globalName: string,
  memberName: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const access = memberAccess(normalized);
  if (
    access?.name === memberName &&
    isUnshadowedGlobal(access.receiver, globalName)
  ) {
    return true;
  }
  const boundTarget = indirectCallableTarget(normalized);
  if (
    boundTarget !== undefined &&
    isGlobalStaticCallable(
      boundTarget,
      globalName,
      memberName,
      new Set(seen),
    )
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (
    declarations.some((declaration) => {
      if (!Node.isBindingElement(declaration)) return false;
      const property =
        declaration.getPropertyNameNode() ?? declaration.getNameNode();
      if (staticPropertyName(property) !== memberName) return false;
      const variable = declaration.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      const initializer = variable?.getInitializer();
      return (
        initializer !== undefined &&
        isUnshadowedGlobal(initializer, globalName)
      );
    })
  ) {
    return true;
  }
  return objectAliasSources(normalized).some((source) =>
    isGlobalStaticCallable(
      source,
      globalName,
      memberName,
      new Set(seen),
    ),
  );
}

function staticNodeArray(
  node: Node | undefined,
  seen = new Set<Node>(),
): Node[] | undefined {
  if (node === undefined) return undefined;
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (Node.isArrayLiteralExpression(normalized)) {
    const elements = normalized.getElements();
    return elements.every(Node.isExpression) ? elements : undefined;
  }
  if (!Node.isIdentifier(normalized)) return undefined;
  const sources = objectAliasSources(normalized);
  if (sources.length !== 1) return undefined;
  return staticNodeArray(sources[0], new Set(seen));
}

function invokedCallable(
  call: CallExpression,
): { callable: Node; arguments?: Node[] } {
  const direct = unwrapExpression(call.getExpression());
  const directArguments = call.getArguments();
  if (isGlobalStaticCallable(direct, "Reflect", "apply")) {
    return {
      callable: directArguments[0] ?? direct,
      arguments: staticNodeArray(directArguments[2]),
    };
  }
  const access = memberAccess(direct);
  if (access?.name === "call") {
    return {
      callable: access.receiver,
      arguments: directArguments.slice(1),
    };
  }
  if (access?.name === "apply") {
    return {
      callable: access.receiver,
      arguments: staticNodeArray(directArguments[1]),
    };
  }
  return { callable: direct, arguments: directArguments };
}

function staticMutationPropertyName(
  node: Node | undefined,
  seen = new Set<Node>(),
): string | undefined {
  if (node === undefined) return undefined;
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (
    Node.isStringLiteral(normalized) ||
    Node.isNoSubstitutionTemplateLiteral(normalized)
  ) {
    return normalized.getLiteralText();
  }
  if (!Node.isIdentifier(normalized)) return undefined;
  const sources = objectAliasSources(normalized);
  const values = sources.map((source) =>
    staticMutationPropertyName(source, new Set(seen)),
  );
  return values.length > 0 &&
    values.every((value) => value === values[0])
    ? values[0]
    : undefined;
}

function descriptorValue(
  node: Node | undefined,
): Node | undefined {
  if (node === undefined) return undefined;
  const properties = normalizedObjectProperties(unwrapExpression(node));
  const value = properties?.get("value");
  if (Node.isPropertyAssignment(value)) {
    return value.getInitializer();
  }
  return Node.isShorthandPropertyAssignment(value)
    ? value.getNameNode()
    : undefined;
}

function dependsOnFunctionParameter(node: Node): boolean {
  const identifiers = [
    ...(Node.isIdentifier(node) ? [node] : []),
    ...node.getDescendantsOfKind(SyntaxKind.Identifier),
  ];
  return identifiers.some((identifier) =>
    identifier
      .getSymbol()
      ?.getDeclarations()
      .some(Node.isParameterDeclaration),
  );
}

interface ObjectPropertyMutationIndex {
  assignments: Array<{
    before: number;
    receiver: Node;
    name: string;
    value: Node;
  }>;
  merges: Array<{
    before: number;
    target: Node;
    sources: Node[];
  }>;
  unresolvedReflectiveWrite: boolean;
}

const OBJECT_PROPERTY_MUTATION_CACHE = new WeakMap<
  SourceFile,
  ObjectPropertyMutationIndex
>();

function objectPropertyMutationIndex(
  sourceFile: SourceFile,
): ObjectPropertyMutationIndex {
  const cached = OBJECT_PROPERTY_MUTATION_CACHE.get(sourceFile);
  if (cached !== undefined) return cached;
  const assignments = binaryExpressions(sourceFile)
    .flatMap((candidate) => {
      if (
        candidate.getOperatorToken().getKind() !== SyntaxKind.EqualsToken
      ) {
        return [];
      }
      const target = memberAccess(candidate.getLeft());
      return target === undefined
        ? []
        : [{
            before: candidate.getStart(),
            receiver: target.receiver,
            name: target.name,
            value: candidate.getRight(),
          }];
    });
  const index: ObjectPropertyMutationIndex = {
    assignments,
    merges: [],
    unresolvedReflectiveWrite: false,
  };
  OBJECT_PROPERTY_MUTATION_CACHE.set(sourceFile, index);
  index.merges.push(...sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .flatMap((call) => {
      if (!isObjectAssignCallable(call.getExpression())) return [];
      const [target, ...sources] = call.getArguments();
      return target === undefined
        ? []
        : [{
            before: call.getStart(),
            target,
            sources,
          }];
    }));
  for (const call of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    const invocation = invokedCallable(call);
    const definesProperty = isGlobalStaticCallable(
      invocation.callable,
      "Object",
      "defineProperty",
    );
    const setsProperty = isGlobalStaticCallable(
      invocation.callable,
      "Reflect",
      "set",
    );
    if (!definesProperty && !setsProperty) continue;
    const args = invocation.arguments;
    const receiver = args?.[0];
    const name = staticMutationPropertyName(args?.[1]);
    const value = setsProperty
      ? args?.[2]
      : descriptorValue(args?.[2]);
    if (
      receiver === undefined ||
      name === undefined ||
      value === undefined ||
      dependsOnFunctionParameter(receiver) ||
      dependsOnFunctionParameter(value)
    ) {
      index.unresolvedReflectiveWrite = true;
      continue;
    }
    index.assignments.push({
      before: call.getStart(),
      receiver,
      name,
      value,
    });
  }
  return index;
}

function precedingObjectPropertyValues(
  receiver: Node,
  name: string,
): Node[] {
  const before = receiver.getStart();
  const index = objectPropertyMutationIndex(receiver.getSourceFile());
  const assigned = index.assignments
    .filter(
      (candidate) =>
        candidate.before < before &&
        candidate.name === name &&
        sameObjectReference(candidate.receiver, receiver),
    )
    .map((candidate) => candidate.value);
  const merged = index.merges
    .filter(
      (merge) =>
        merge.before < before &&
        sameObjectReference(merge.target, receiver),
    )
    .flatMap((merge) =>
      merge.sources.flatMap((source) =>
        objectPropertySources(source, name),
      ),
    );
  return [...assigned, ...merged];
}

function objectPropertySources(
  receiver: Node,
  name: string,
  seen = new Set<Node>(),
): Node[] {
  const value = unwrapExpression(receiver);
  if (seen.has(value)) return [];
  seen.add(value);
  const assigned = precedingObjectPropertyValues(value, name);
  if (Node.isIdentifier(value)) {
    const sources = [
      ...(value
        .getSymbol()
        ?.getDeclarations()
        .flatMap((declaration) => {
          if (!Node.isVariableDeclaration(declaration)) return [];
          const initializer = declaration.getInitializer();
          return initializer === undefined ? [] : [initializer];
        }) ?? []),
      ...precedingAssignmentValues(value),
    ];
    return [
      ...assigned,
      ...sources.flatMap((source) =>
        objectPropertySources(source, name, new Set(seen)),
      ),
    ];
  }
  if (
    Node.isCallExpression(value) &&
    isObjectAssignCallable(value.getExpression())
  ) {
    return [
      ...assigned,
      ...value.getArguments().flatMap((source) =>
        objectPropertySources(source, name, new Set(seen)),
      ),
    ];
  }
  const access = memberAccess(value);
  if (access !== undefined) {
    return [
      ...assigned,
      ...objectPropertySources(
        access.receiver,
        access.name,
        new Set(seen),
      ).flatMap((source) =>
        objectPropertySources(source, name, new Set(seen)),
      ),
    ];
  }
  if (!Node.isObjectLiteralExpression(value)) return assigned;
  return [...assigned, ...value.getProperties().flatMap((property) => {
    if (Node.isSpreadAssignment(property)) {
      return objectPropertySources(
        property.getExpression(),
        name,
        new Set(seen),
      );
    }
    const propertyName = staticPropertyName(property.getNameNode());
    if (propertyName !== name) return [];
    if (Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      return initializer === undefined ? [] : [initializer];
    }
    if (Node.isShorthandPropertyAssignment(property)) {
      return [property.getNameNode()];
    }
    if (Node.isGetAccessorDeclaration(property)) {
      return property
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .flatMap((statement) => {
          const expression = statement.getExpression();
          return expression === undefined ? [] : [expression];
        });
    }
    return [];
  })];
}

function objectPropertyValueSources(
  node: Node,
): Node[] {
  const normalized = unwrapExpression(node);
  const access = memberAccess(normalized);
  return access === undefined
    ? []
    : objectPropertySources(access.receiver, access.name);
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
  const reflected = reflectGetAccess(normalized);
  if (
    reflected !== undefined &&
    (reflected.name === undefined || reflected.name === member) &&
    couldBeNamedImportIdentifier(
      reflected.receiver,
      moduleName,
      imported,
      new Set(seen),
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
  if (
    objectPropertyValueSources(normalized).some((source) =>
      couldBeNamedImportMemberExpression(
        source,
        moduleName,
        imported,
        member,
        new Set(seen),
      ),
    )
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  const declarationSources =
    normalized
      .getSymbol()
      ?.getDeclarations()
      .flatMap((declaration) => {
        if (Node.isVariableDeclaration(declaration)) {
          const initializer = declaration.getInitializer();
          return initializer === undefined ? [] : [initializer];
        }
        if (!Node.isBindingElement(declaration)) return [];
        const property =
          declaration.getPropertyNameNode() ?? declaration.getNameNode();
        const name = staticPropertyName(property);
        const variable = declaration.getFirstAncestorByKind(
          SyntaxKind.VariableDeclaration,
        );
        const initializer = variable?.getInitializer();
        if (name === undefined || initializer === undefined) return [];
        return objectPropertySources(initializer, name);
      }) ?? [];
  return [
    ...declarationSources,
    ...precedingAssignmentValues(normalized),
  ].some((assigned) =>
    couldBeNamedImportMemberExpression(
      assigned,
      moduleName,
      imported,
      member,
      new Set(seen),
    ),
  );
}

function hasUnresolvedComputedPlaywrightMember(
  sourceFile: SourceFile,
): boolean {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
    .some(
      (access) =>
        staticStringValue(access.getArgumentExpression()) ===
          undefined &&
        (couldBeNamedImportIdentifier(
          access.getExpression(),
          "@playwright/test",
          "test",
        ) ||
          couldBeNamespaceImportIdentifier(
            access.getExpression(),
            "@playwright/test",
          )),
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

function isSanctionedLoginCall(
  call: CallExpression,
  pageName: string,
): boolean {
  const [page, principal] = call.getArguments();
  return (
    call.getArguments().length === 2 &&
    isStableNamedImportCall(call, "./helpers", "login") &&
    page?.getText() === pageName &&
    principal !== undefined &&
    isStableNamedImportIdentifier(
      principal,
      "./helpers",
      "PRINCIPAL",
    )
  );
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
        isSanctionedLoginCall(call, pageName),
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
    return awaitedCall(statement, (call) =>
      isSanctionedLoginCall(call, pageName),
    );
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
  const assigned = binaryExpressions(sourceFile)
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
  const properties = config.getProperties();
  return (
    properties.length === 1 &&
    Node.isShorthandPropertyAssignment(properties[0]) &&
    properties[0].getName() === pageName
  );
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
  const parameters = helper.getParameters();
  if (
    parameters.length !== 2 ||
    parameters.some(
      (parameter) =>
        !Node.isIdentifier(parameter.getNameNode()) ||
        parameter.getInitializer() !== undefined ||
        parameter.isRestParameter() ||
        parameter.hasQuestionToken(),
    )
  ) {
    return false;
  }
  const pageName = parameters[0]!.getName();
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
  const parameters = helper.getParameters();
  if (
    !Node.isBlock(body) ||
    parameters.length !== 2 ||
    parameters
      .map((parameter) => parameter.getName())
      .join(",") !== "page,creds" ||
    parameters.some(
      (parameter) =>
        !Node.isIdentifier(parameter.getNameNode()) ||
        parameter.getInitializer() !== undefined ||
        parameter.isRestParameter() ||
        parameter.hasQuestionToken(),
    )
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

function importedAxeGraphProblems(
  sourceFiles: ReadonlyMap<string, SourceFile>,
  config: LocalModuleConfig | undefined,
): string[] {
  const problems: string[] = [];
  if (config === undefined) {
    problems.push(
      `${TSCONFIG_PATH}:1 must be a directly parseable local module-resolution configuration for Axe evidence`,
    );
  }
  const localConfig = config ?? { baseUrl: ".", paths: {} };
  const reachable = new Set<string>();
  const pending: string[] = [...AXE_IMPORT_GRAPH_ROOTS];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (reachable.has(path)) continue;
    const sourceFile = sourceFiles.get(path);
    if (sourceFile === undefined) continue;
    reachable.add(path);
    for (const reference of runtimeModuleReferences(sourceFile)) {
      if (reference.specifier === undefined) {
        problems.push(
          `${path}:1 reachable Axe evidence modules require literal runtime module references`,
        );
        continue;
      }
      const resolved = resolveLocalModulePath(
        path,
        reference.specifier,
        localConfig,
        (candidate) => sourceFiles.has(candidate),
      );
      if (resolved === null) {
        problems.push(
          `${path}:1 local runtime import '${reference.display}' cannot be resolved inside the Axe evidence graph`,
        );
      } else if (
        resolved === undefined &&
        !ALLOWED_AXE_EXTERNAL_MODULES.has(reference.specifier)
      ) {
        problems.push(
          `${path}:1 runtime import '${reference.display}' is neither a configured local module nor an allowed Axe evidence dependency`,
        );
      } else if (resolved !== undefined) {
        pending.push(resolved);
      }
    }
  }
  for (const path of reachable) {
    const sourceFile = sourceFiles.get(path)!;
    if (
      path !== AXE_HELPER_PATH &&
      runtimeModuleReferences(sourceFile).some((reference) =>
        reference.specifier?.startsWith("@axe-core/playwright"),
      )
    ) {
      problems.push(
        `${path}:1 reachable local Axe evidence module must not import the Axe runtime outside ${AXE_HELPER_PATH}`,
      );
    }
    if (hasUnresolvedComputedPlaywrightMember(sourceFile)) {
      problems.push(
        `${path}:1 reachable local Axe evidence module must not use unresolved computed Playwright members`,
      );
    }
    if (hasRegisteredPlaywrightHook(sourceFile)) {
      problems.push(
        `${path}:1 reachable local Axe evidence module must not register Playwright hooks`,
      );
    }
    if (scopeHasNeutralizingAnnotation(sourceFile)) {
      problems.push(
        `${path}:1 reachable local Axe evidence module must not invoke Playwright neutralizers`,
      );
    }
  }
  return problems;
}

export function axeCoverageProblems(sources: Readonly<Record<string, string>>): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const problems: string[] = [];
  const sourceFiles = new Map<string, SourceFile>();
  for (const [path, source] of Object.entries(sources)) {
    sourceFiles.set(path, project.createSourceFile(`/${path}`, source));
  }
  const routeSource = sourceFiles.get(AXE_ROUTES_PATH);
  if (
    routeSource === undefined ||
    declarativeAxeRouteCollections(routeSource) === undefined
  ) {
    problems.push(
      `${AXE_ROUTES_PATH}:1 route collections must be non-empty declarative frozen literals`,
    );
  }
  problems.push(
    ...importedAxeGraphProblems(
      sourceFiles,
      parseLocalModuleConfig(sources[TSCONFIG_PATH]),
    ),
  );
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

const VALID_TSCONFIG = `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@app/*": ["./src/app/*"]
    }
  }
}`;

const VALID_AXE_ROUTES = `interface AxeRoute {
  readonly path: string;
  readonly readySelector: string;
}
function axeRoute(path: string, readySelector: string): AxeRoute {
  return Object.freeze({ path, readySelector });
}
export const PUBLIC_AXE_ROUTES = Object.freeze([
  axeRoute("/", "h1"),
] satisfies readonly AxeRoute[]);
export const LOGIN_AXE_ROUTES = Object.freeze([
  axeRoute("/login", "#email"),
] satisfies readonly AxeRoute[]);
export const AUTHENTICATED_AXE_ROUTES = Object.freeze([
  axeRoute("/app", "main"),
] satisfies readonly AxeRoute[]);
export const DEMO_AXE_ROUTES = Object.freeze([
  axeRoute("/app/demo", "main"),
] satisfies readonly AxeRoute[]);`;

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
import { login, PRINCIPAL } from "./helpers";
test("axe", async ({ page }) => {
  for (const route of LOGIN_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
  await login(page, PRINCIPAL);
  for (const route of AUTHENTICATED_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});`,
  "e2e/demo-journey.spec.ts": `import { expect, test } from "@playwright/test";
import { assertNoAxeViolations } from "./axe";
import { DEMO_AXE_ROUTES } from "./axe-routes";
import { login, PRINCIPAL } from "./helpers";
test("axe", async ({ page }) => {
  await login(page, PRINCIPAL);
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
    [TSCONFIG_PATH]: VALID_TSCONFIG,
    [AXE_ROUTES_PATH]: VALID_AXE_ROUTES,
    ...VALID_SPECS,
    ...overrides,
  };
}

describe("axe-required fence", () => {
  it("enforces: public, authenticated, and demo E2E surfaces execute the sanctioned Axe assertion", () => {
    const sources = readAxeAnalysisSources();
    const problems = axeCoverageProblems(sources);
    expect(problems, problems.join("\n")).toEqual([]);
  }, 60_000);

  it("enforces: required route groups cover every loaded public, authenticated, and demo surface", () => {
    const routeProject = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const declaredCollections = declarativeAxeRouteCollections(
      routeProject.createSourceFile(
        `/${AXE_ROUTES_PATH}`,
        readFileSync(join(REPO_ROOT, AXE_ROUTES_PATH), "utf8"),
      ),
    );
    expect(declaredCollections).toEqual({
      PUBLIC_AXE_ROUTES,
      LOGIN_AXE_ROUTES,
      AUTHENTICATED_AXE_ROUTES,
      DEMO_AXE_ROUTES,
    });
    const inventoryProblems = pageRouteInventoryProblems(
      nextPageFiles(),
      declaredCollections!,
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
    it("rejects Axe instrumentation and Playwright hooks in transitive side-effect imports", () => {
      const sources = completeSources();
      sources["e2e/axe-routes.ts"] =
        `import "./axe-bridge";\nimport "@app/demo/axe-hook";\n${VALID_AXE_ROUTES}`;
      sources["e2e/axe-bridge.ts"] = `import "./axe-poison";`;
      sources["e2e/axe-poison.ts"] =
        `import AxeBuilder from "@axe-core/playwright";\nAxeBuilder.prototype.analyze = async () => ({ violations: [] } as never);`;
      sources["src/app/demo/axe-hook.ts"] =
        `import { test } from "@playwright/test";\ntest.beforeEach(() => undefined);`;
      const problems = axeCoverageProblems(sources);
      expect(problems).toContain(
        `e2e/axe-poison.ts:1 reachable local Axe evidence module must not import the Axe runtime outside ${AXE_HELPER_PATH}`,
      );
      expect(problems).toContain(
        "src/app/demo/axe-hook.ts:1 reachable local Axe evidence module must not register Playwright hooks",
      );
    });

    it("rejects Playwright neutralizers in transitive side-effect imports", () => {
      const sources = completeSources();
      sources[AXE_ROUTES_PATH] =
        `import "./axe-neutralizer";\n${VALID_AXE_ROUTES}`;
      sources["e2e/axe-neutralizer.ts"] =
        `import { test } from "@playwright/test";\ntest.skip(true, "skip required Axe evidence");`;
      expect(axeCoverageProblems(sources)).toContain(
        "e2e/axe-neutralizer.ts:1 reachable local Axe evidence module must not invoke Playwright neutralizers",
      );
    });

    it("rejects Axe instrumentation and Playwright hooks in graph roots", () => {
      const helperHook = completeSources();
      helperHook[E2E_HELPERS_PATH] = VALID_LOGIN_HELPER.replace(
        'import { expect, type Page } from "@playwright/test";',
        `import { expect, test, type Page } from "@playwright/test";
test.beforeEach(() => undefined);`,
      );
      expect(axeCoverageProblems(helperHook)).toContain(
        `${E2E_HELPERS_PATH}:1 reachable local Axe evidence module must not register Playwright hooks`,
      );

      const helperRuntime = completeSources();
      helperRuntime[E2E_HELPERS_PATH] =
        VALID_LOGIN_HELPER.replace(
          'import { expect, type Page } from "@playwright/test";',
          `import Axe from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
void Axe;`,
        );
      expect(axeCoverageProblems(helperRuntime)).toContain(
        `${E2E_HELPERS_PATH}:1 reachable local Axe evidence module must not import the Axe runtime outside ${AXE_HELPER_PATH}`,
      );

      const axeHook = completeSources(
        {},
        VALID_HELPER.replace(
          'import { expect, type Page } from "@playwright/test";',
          `import { expect, test, type Page } from "@playwright/test";
test.beforeAll(() => undefined);`,
        ),
      );
      expect(axeCoverageProblems(axeHook)).toContain(
        `${AXE_HELPER_PATH}:1 reachable local Axe evidence module must not register Playwright hooks`,
      );

      const specHook = completeSources({
        "e2e/smoke.spec.ts": VALID_SPECS[
          "e2e/smoke.spec.ts"
        ].replace(
          'test("axe"',
          `test.beforeEach(() => undefined);
test("axe"`,
        ),
      });
      expect(axeCoverageProblems(specHook)).toContain(
        "e2e/smoke.spec.ts:1 reachable local Axe evidence module must not register Playwright hooks",
      );

      const specRuntime = completeSources({
        "e2e/smoke.spec.ts": VALID_SPECS[
          "e2e/smoke.spec.ts"
        ].replace(
          'import { expect, test } from "@playwright/test";',
          `import { expect, test } from "@playwright/test";
import Axe from "@axe-core/playwright";
void Axe;`,
        ),
      });
      expect(axeCoverageProblems(specRuntime)).toContain(
        `e2e/smoke.spec.ts:1 reachable local Axe evidence module must not import the Axe runtime outside ${AXE_HELPER_PATH}`,
      );
    });

    it("fails closed on unresolved or non-literal runtime imports in the Axe evidence graph", () => {
      const unresolved = completeSources();
      unresolved["e2e/axe-routes.ts"] =
        `import "./missing-side-effect";\n${VALID_AXE_ROUTES}`;
      expect(axeCoverageProblems(unresolved)).toContain(
        "e2e/axe-routes.ts:1 local runtime import './missing-side-effect' cannot be resolved inside the Axe evidence graph",
      );
      const dynamic = completeSources();
      dynamic["e2e/axe-routes.ts"] =
        `const target = "./runtime-module";\nvoid import(target);\n${VALID_AXE_ROUTES}`;
      expect(axeCoverageProblems(dynamic)).toContain(
        "e2e/axe-routes.ts:1 reachable Axe evidence modules require literal runtime module references",
      );
      const unclassified = completeSources();
      unclassified["e2e/axe-routes.ts"] =
        `import "local-evidence-poison";\n${VALID_AXE_ROUTES}`;
      expect(axeCoverageProblems(unclassified)).toContain(
        "e2e/axe-routes.ts:1 runtime import 'local-evidence-poison' is neither a configured local module nor an allowed Axe evidence dependency",
      );
      const malformedConfig = completeSources();
      malformedConfig[TSCONFIG_PATH] = "{";
      expect(axeCoverageProblems(malformedConfig)).toContain(
        `${TSCONFIG_PATH}:1 must be a directly parseable local module-resolution configuration for Axe evidence`,
      );
    });

    it("fails closed on CommonJS loader aliases and member forms", () => {
      const loaders = [
        `const load = require;
load("./axe-poison");`,
        `module.require("./axe-poison");`,
        `(module as any)["requ" + "ire"]("./axe-poison");`,
        `const runtime = module;
runtime["require"]("./axe-poison");`,
        `const { require: load } = module;
load("./axe-poison");`,
        `let load: typeof require;
load = require;
load("./axe-poison");`,
        `const nodeModule = process.getBuiltinModule("module");
const load = nodeModule.createRequire(import.meta.url);
load("./axe-poison");`,
        `const getBuiltinModule = process.getBuiltinModule;
const nodeModule = getBuiltinModule("module");
const load = nodeModule.createRequire(import.meta.url);
load("./axe-poison");`,
      ];
      for (const loader of loaders) {
        const fixture = completeSources();
        fixture["e2e/axe-routes.ts"] =
          `${loader}\n${VALID_AXE_ROUTES}`;
        fixture["e2e/axe-poison.ts"] =
          `import Axe from "@axe-core/playwright";
Axe.prototype.analyze = async () => ({ violations: [] } as never);`;
        expect(
          axeCoverageProblems(fixture),
          loader,
        ).toContain(
          "e2e/axe-routes.ts:1 reachable Axe evidence modules require literal runtime module references",
        );
      }

      const applicationSource =
        `const module = { require: (_specifier: string) => undefined };
module.require("./application-operation");
`;
      const applicationProject = new Project({
        useInMemoryFileSystem: true,
        skipAddingFilesFromTsConfig: true,
      });
      expect(
        runtimeModuleReferences(
          applicationProject.createSourceFile(
            "/e2e/application.ts",
            applicationSource,
          ),
        ),
      ).toEqual([]);

      const localProcessProject = new Project({
        useInMemoryFileSystem: true,
        skipAddingFilesFromTsConfig: true,
      });
      expect(
        runtimeModuleReferences(
          localProcessProject.createSourceFile(
            "/e2e/local-process.ts",
            `const process = {
  getBuiltinModule: (_name: string) => ({ createRequire: () => () => undefined }),
};
const getBuiltinModule = process.getBuiltinModule;
getBuiltinModule("module").createRequire()("./application-operation");`,
          ),
        ),
      ).toEqual([]);
    });

    it("rejects process-dependent or empty route collections", () => {
      const processDependent = completeSources();
      processDependent[AXE_ROUTES_PATH] =
        `const routes = process.env.VITEST ? Object.freeze([]) : Object.freeze([]);
export const PUBLIC_AXE_ROUTES = routes;
export const LOGIN_AXE_ROUTES = routes;
export const AUTHENTICATED_AXE_ROUTES = routes;
export const DEMO_AXE_ROUTES = routes;`;
      expect(axeCoverageProblems(processDependent)).toContain(
        `${AXE_ROUTES_PATH}:1 route collections must be non-empty declarative frozen literals`,
      );

      const empty = completeSources();
      empty[AXE_ROUTES_PATH] = VALID_AXE_ROUTES.replace(
        '  axeRoute("/", "h1"),',
        "",
      );
      expect(axeCoverageProblems(empty)).toContain(
        `${AXE_ROUTES_PATH}:1 route collections must be non-empty declarative frozen literals`,
      );
    });

    it("rejects Playwright hook callables stored in object properties", () => {
      const wrappers = [
        `const hooks = { install: test.beforeEach };
hooks.install(() => undefined);`,
        `Reflect.get(test, "beforeEach")(() => undefined);`,
        `const hook = Math.random() > 0.5 ? "beforeEach" : "noop";
Reflect.get(test, hook)(() => undefined);`,
        `test["before" + "Each"](() => undefined);`,
        `const base = { install: test.beforeEach };
const hooks = { ...base };
const alias = hooks;
alias.install(() => undefined);`,
        `const hooks = { install: test.beforeEach };
const { install } = hooks;
install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
hooks.install = test.beforeEach;
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
const alias = hooks;
alias.install = test.beforeEach;
hooks.install(() => undefined);`,
        `const wrapper = { hooks: {} as Record<string, unknown> };
const { hooks } = wrapper;
wrapper.hooks.install = test.beforeEach;
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
Object.assign(hooks, { install: test.beforeEach });
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
const assign = Object.assign;
assign(hooks, { install: test.beforeEach });
const alias = hooks;
alias.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
Object.defineProperty(hooks, "install", { value: test.beforeEach });
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
const define = Object.defineProperty.bind(Object);
define(hooks, "install", { value: test.beforeEach });
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
const define = Object.defineProperty;
define.call(Object, hooks, "install", { value: test.beforeEach });
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
const { defineProperty: define } = Object;
define(hooks, "install", { value: test.beforeEach });
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
Reflect.set(hooks, "install", test.beforeEach);
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
Reflect.set.apply(Reflect, [hooks, "install", test.beforeEach]);
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
Reflect.apply(Reflect.set, Reflect, [hooks, "install", test.beforeEach]);
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
const { set } = Reflect;
set(hooks, "install", test.beforeEach);
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
const property = Math.random() > 0.5 ? "install" : "other";
Object.defineProperty(hooks, property, { value: test.beforeEach });
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
function install(
  target: Record<string, unknown>,
  value: unknown,
) {
  Object.defineProperty(target, "install", { value });
}
install(hooks, test.beforeEach);
hooks.install(() => undefined);`,
        `const hooks: Record<string, unknown> = {};
const install = (
  target: Record<string, unknown>,
  value: unknown,
) => Reflect.set(target, "install", value);
install(hooks, test.beforeEach);
hooks.install(() => undefined);`,
      ];
      for (const wrapper of wrappers) {
        const wrappedHook = completeSources();
        wrappedHook["e2e/axe-routes.ts"] =
          `import { test } from "@playwright/test";
${wrapper}
${VALID_AXE_ROUTES}`;
        expect(axeCoverageProblems(wrappedHook), wrapper).toContain(
          "e2e/axe-routes.ts:1 reachable local Axe evidence module must not register Playwright hooks",
        );
      }
    });

    it("fails closed on unresolved computed Playwright members", () => {
      const fixture = completeSources();
      fixture["e2e/axe-routes.ts"] =
        `import { test } from "@playwright/test";
const member = Math.random() > 0.5 ? "beforeEach" : "noop";
test[member](() => undefined);
${VALID_AXE_ROUTES}`;
      expect(axeCoverageProblems(fixture)).toContain(
        "e2e/axe-routes.ts:1 reachable local Axe evidence module must not use unresolved computed Playwright members",
      );
      const namespaceFixture = completeSources();
      namespaceFixture["e2e/axe-routes.ts"] =
        `import * as playwright from "@playwright/test";
const member = Math.random() > 0.5 ? "test" : "expect";
playwright[member];
${VALID_AXE_ROUTES}`;
      expect(axeCoverageProblems(namespaceFixture)).toContain(
        "e2e/axe-routes.ts:1 reachable local Axe evidence module must not use unresolved computed Playwright members",
      );
      const project = new Project({
        useInMemoryFileSystem: true,
        skipAddingFilesFromTsConfig: true,
      });
      expect(
        hasUnresolvedComputedPlaywrightMember(
          project.createSourceFile(
            "/e2e/application.ts",
            `const test = { beforeEach: () => undefined };
const member = Math.random() > 0.5 ? "beforeEach" : "noop";
void test[member];`,
          ),
        ),
      ).toBe(false);
    });

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
        "src/app/privacy/page.tsx: route /privacy has no scanned URL that resolves to it in PUBLIC_AXE_ROUTES",
      );
      expect(
        pageRouteInventoryProblems(
          [...covered, "src/app/@modal/page.tsx"],
          collections,
        ),
      ).toContain(
        "src/app/@modal/page.tsx: Next page route cannot be classified for Axe",
      );

      expect(
        pageRouteInventoryProblems(
          [
            "src/app/app/foo/page.tsx",
            "src/app/app/[slug]/page.tsx",
          ],
          {
            PUBLIC_AXE_ROUTES: [],
            LOGIN_AXE_ROUTES: [],
            AUTHENTICATED_AXE_ROUTES: [
              { path: "/app/foo", readySelector: "main" },
            ],
            DEMO_AXE_ROUTES: [],
          },
        ),
      ).toContain(
        "src/app/app/[slug]/page.tsx: route /app/[slug] has no scanned URL that resolves to it in AUTHENTICATED_AXE_ROUTES",
      );
      expect(
        pageRouteInventoryProblems(
          [
            "src/app/app/foo/page.tsx",
            "src/app/app/[slug]/page.tsx",
          ],
          {
            PUBLIC_AXE_ROUTES: [],
            LOGIN_AXE_ROUTES: [],
            AUTHENTICATED_AXE_ROUTES: [
              { path: "/app/foo", readySelector: "main" },
              { path: "/app/bar", readySelector: "main" },
            ],
            DEMO_AXE_ROUTES: [],
          },
        ),
      ).toEqual([]);
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
        wrap(`test["sk" + "ip"](() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`const skip = test.${"skip"}; skip(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`const { fixme: disable } = test; disable(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`const disable = test["skip"]; disable(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
        wrap(`const { ["fixme"]: disable } = test; disable(() => true, "file disabled"); test("axe", async ({ page }) => { await assertNoAxeViolations(page, "surface"); });`),
      ];
      for (const spec of invalid) {
        const overrides = Object.fromEntries(
          REQUIRED_AXE_SPECS.map((path) => [path, spec]),
        );
        const problems = axeCoverageProblems(
          completeSources(overrides),
        );
        for (const path of REQUIRED_AXE_SPECS) {
          expect(problems, spec).toContain(
            `${path}:1 must await the sanctioned Axe helper from a module-scope test or enabled module-scope test.describe`,
          );
        }
        expect(
          problems.filter(
            (problem) =>
              !problem.includes(
                "must await the sanctioned Axe helper",
              ) &&
              !problem.includes(
                "must not register Playwright hooks",
              ) &&
              !problem.includes(
                "must not invoke Playwright neutralizers",
              ),
          ),
          spec,
        ).toEqual([]);
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
        `Reflect.get(test, "${"skip"}")(true, "file disabled");`,
        `const member = Math.random() > 0.5 ? "${"fixme"}" : "noop";
Reflect.get(test, member)(true, "file disabled");`,
        `(Reflect.apply.bind(Reflect) as typeof Reflect.apply)(
  test.${"skip"},
  test,
  [true, "file disabled"],
);`,
        `const invokeBound = Reflect.apply.bind(Reflect);
invokeBound(test.${"fixme"}, test, [true, "file disabled"]);`,
        `(Reflect.apply.bind(Reflect) as typeof Reflect.apply).call(
  undefined,
  test.${"skip"},
  test,
  [true, "file disabled"],
);`,
        `(Reflect.apply.bind(Reflect) as typeof Reflect.apply).apply(
  undefined,
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

      const defaulted = completeSources();
      defaulted[E2E_HELPERS_PATH] = VALID_LOGIN_HELPER
        .replace(
          'import { expect, type Page } from "@playwright/test";',
          `import { expect, test, type Page } from "@playwright/test";
const PRINCIPAL = { email: "principal@verin.test", password: "secret" };`,
        )
        .replace(
          "creds: { email: string; password: string }",
          "creds: { email: string; password: string } = (test.skip(), PRINCIPAL)",
        );
      expect(axeCoverageProblems(defaulted)).toContain(
        "e2e/helpers.ts:1 required Axe login setup must use the uninstrumented canonical browser flow",
      );

      const implicitCredentials = completeSources({
        "e2e/walkthrough.spec.ts":
          VALID_SPECS["e2e/walkthrough.spec.ts"].replace(
            "await login(page, PRINCIPAL);",
            "await login(page);",
          ),
      });
      expect(axeCoverageProblems(implicitCredentials)).toContain(
        "e2e/walkthrough.spec.ts:1 must scan every required authenticated route after its loaded-state assertion",
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
        VALID_HELPER.replace(
          "(page: Page, context: string)",
          "(page: Page, context: string, poison = (() => { throw new Error('poison'); })())",
        ),
        VALID_HELPER.replace(
          "new Axe({ page })",
          "new Axe({ page, ...(() => ({ page: undefined }))() })",
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
