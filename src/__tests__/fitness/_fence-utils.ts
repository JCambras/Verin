/**
 * Shared fence utilities. Fences prefer AST (ts-morph) and file-content scanning
 * over naive regex, and resolve relative + dynamic imports — the seams both prior
 * builds leaked through (retro-r7 don't-again #23, #35). Every fence that uses
 * these also ships a co-located "detects" companion that feeds a synthetic
 * violation and asserts it is caught (charter #4: detection is not verification).
 */
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type CallExpression,
  type BinaryExpression,
  type ClassDeclaration,
  type ClassExpression,
  type CompilerOptions,
  type NewExpression,
  type Signature,
  type SourceFile,
  type Symbol as MorphSymbol,
  type Type,
  type VariableDeclaration,
} from "ts-morph";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isPIIField } from "@contracts/pii";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SRC_ROOT = join(REPO_ROOT, "src");
const IN_MEMORY_SRC_ROOT = resolve("/src");

/**
 * The visited-set key every fence type walk uses: `${text}::${flags}`, MEMOIZED on
 * the interned compiler type.
 *
 * The key itself is unchanged — structural, so two distinct type objects that print
 * alike still collapse to one visit — but `getText()` PRINTS the whole type, which
 * is cheap for `string | null` and ruinous for a `z.infer<typeof …>` alias. Once the
 * decision-core contracts landed, the llm-pii-boundary walk re-rendered those
 * inferred types thousands of times just to ask "seen this?", and the fence took
 * eleven minutes — three assertions past their 20s timeout. The checker interns type
 * objects, so each one now prints at most once per process.
 */
const TYPE_KEYS = new WeakMap<object, string>();
export function typeKey(type: Type): string {
  const compilerType = type.compilerType as unknown as object;
  let key = TYPE_KEYS.get(compilerType);
  if (key === undefined) {
    key = `${type.getText()}::${type.getFlags()}`;
    TYPE_KEYS.set(compilerType, key);
  }
  return key;
}

export type Layer = "contracts" | "domain" | "infrastructure" | "app";
const RANK: Record<Layer, number> = { contracts: 0, domain: 1, infrastructure: 2, app: 3 };
const REPO_COMPILER_OPTIONS = new Project({
  tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
  skipAddingFilesFromTsConfig: true,
}).getCompilerOptions();

/** Recursively list files under `dir` whose name matches `filter`. */
export function walk(dir: string, filter: (f: string) => boolean): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      out.push(...walk(full, filter));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

export function isShippedSourceFilePath(filePath: string): boolean {
  if (!/\.(?:[cm]?ts|tsx)$/.test(filePath)) return false;
  const pathFromRootTests = relative(join(SRC_ROOT, "__tests__"), resolve(filePath));
  return (
    pathFromRootTests === ".." ||
    pathFromRootTests.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRootTests)
  );
}

/** Source files that ship (excludes only the root test tooling tree). */
export function shippedSourceFiles(): string[] {
  return walk(SRC_ROOT, isShippedSourceFilePath);
}

function layerWithinSourceRoot(absPath: string, sourceRoot: string): Layer | null {
  const pathFromRoot = relative(sourceRoot, resolve(absPath));
  if (
    pathFromRoot.length === 0 ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    return null;
  }
  const seg = pathFromRoot.split(/[/\\]/)[0];
  if (seg === "contracts" || seg === "domain" || seg === "infrastructure" || seg === "app") return seg;
  return null;
}

function sourceRootOf(absPath: string): string | null {
  if (layerWithinSourceRoot(absPath, SRC_ROOT) !== null) return SRC_ROOT;
  if (layerWithinSourceRoot(absPath, IN_MEMORY_SRC_ROOT) !== null) return IN_MEMORY_SRC_ROOT;
  return null;
}

/** Which layer does a path under the real or in-memory src/ root belong to? */
export function layerOfPath(absPath: string): Layer | null {
  return layerWithinSourceRoot(absPath, SRC_ROOT) ?? layerWithinSourceRoot(absPath, IN_MEMORY_SRC_ROOT);
}

/**
 * Resolve a module specifier (as written in `fromFile`) to a layer, or null if
 * it is an external/node module. Handles alias (@contracts, @/infrastructure, …),
 * bare "@/<layer>/…", and relative (./ ../) paths.
 */
type SpecifierClassification =
  | { kind: "layer"; layer: Layer }
  | { kind: "external" }
  | { kind: "local-unclassified" };

function matchPathPattern(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function configuredPathTargets(specifier: string, compilerOptions: CompilerOptions): string[] {
  const paths = compilerOptions.paths ?? {};
  const matches = Object.entries(paths)
    .flatMap(([pattern, targets]) => {
      const wildcard = matchPathPattern(pattern, specifier);
      return wildcard === null ? [] : [{ pattern, targets, wildcard }];
    })
    .sort((left, right) => right.pattern.replace("*", "").length - left.pattern.replace("*", "").length);
  const selected = matches[0];
  if (!selected) return [];
  const configuredBase =
    compilerOptions.pathsBasePath ??
    compilerOptions.baseUrl ??
    (compilerOptions.configFilePath ? dirname(String(compilerOptions.configFilePath)) : REPO_ROOT);
  const configBase = typeof configuredBase === "string" ? configuredBase : REPO_ROOT;
  return selected.targets.map((target) =>
    resolve(configBase, target.replace("*", selected.wildcard)),
  );
}

/**
 * Every file a specifier can name, through TypeScript resolution first and the
 * configured `paths` aliases second. ONE authority: a fence that instead tests
 * the specifier TEXT (`startsWith(".")`) calls every aliased spelling external,
 * and whatever it guards silently stops applying to `@contracts/…`.
 */
function specifierTargets(
  project: Project,
  fromFile: string,
  specifier: string,
): { targets: string[]; external: boolean } {
  const compilerOptions = project.getCompilerOptions();
  const resolvedModule = ts.resolveModuleName(
    specifier,
    fromFile,
    compilerOptions,
    project.getModuleResolutionHost(),
  ).resolvedModule;
  if (resolvedModule) {
    const target = resolve(resolvedModule.resolvedFileName);
    const segments = target.split(/[/\\]/);
    return {
      targets: [target],
      external:
        resolvedModule.isExternalLibraryImport === true ||
        segments.includes("node_modules"),
    };
  }
  const targets = specifier.startsWith(".") || isAbsolute(specifier)
    ? [resolve(dirname(fromFile), specifier)]
    : configuredPathTargets(specifier, compilerOptions);
  return { targets, external: targets.length === 0 };
}

/** The project-local files a specifier names; an external package names none. */
export function localSpecifierTargets(
  project: Project,
  fromFile: string,
  specifier: string,
): string[] {
  const { targets, external } = specifierTargets(project, fromFile, specifier);
  return external ? [] : targets;
}

function classifySpecifier(
  project: Project,
  fromFile: string,
  specifier: string,
): SpecifierClassification {
  const sourceRoot = sourceRootOf(fromFile);
  if (sourceRoot === null) return { kind: "external" };
  const { targets, external } = specifierTargets(project, fromFile, specifier);
  const layerOfTarget = (target: string): Layer | null =>
    layerWithinSourceRoot(target, sourceRoot) ??
    layerWithinSourceRoot(target, SRC_ROOT) ??
    layerWithinSourceRoot(target, IN_MEMORY_SRC_ROOT);
  const layers = new Set(
    targets.flatMap((target) => {
      const layer = layerOfTarget(target);
      return layer === null ? [] : [layer];
    }),
  );
  if (layers.size === 1 && targets.every((target) => layerOfTarget(target) !== null)) {
    return { kind: "layer", layer: [...layers][0]! };
  }
  return external ? { kind: "external" } : { kind: "local-unclassified" };
}

export interface ModuleReference {
  specifier: string | null;
  line: number;
  kind:
    | "import"
    | "export"
    | "dynamic-import"
    | "require"
    | "import-type"
    | "import-equals"
    | "reference-types"
    | "reference-path"
    | "reference-lib"
    | "require-reference"
    | "create-require"
    | "get-builtin-module"
    | "implicit-jsx-runtime";
}

const MODULE_REFERENCE_CACHE = new WeakMap<
  SourceFile,
  { readonly sourceText: string; readonly references: ModuleReference[] }
>();

const unwrapExpression = (node: Node | undefined): Node | undefined => {
  let expression = node;
  while (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isNonNullExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isAwaitExpression(expression)
  ) {
    expression = expression.getExpression();
  }
  return expression;
};

const expressionProvenanceIn = (
  sf: SourceFile,
  node: Node | undefined,
  seen: Set<Node> = new Set(),
): Node | undefined => {
  const expression = unwrapExpression(node);
  if (!Node.isIdentifier(expression) || seen.has(expression)) {
    return expression;
  }
  seen.add(expression);
  const declaration = expression
    .getSymbol()
    ?.getDeclarations()
    .find(Node.isVariableDeclaration);
  const assignment = sf
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter(
      (candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < expression.getStart() &&
        Node.isIdentifier(unwrapExpression(candidate.getLeft())) &&
        unwrapExpression(candidate.getLeft())?.getSymbol() ===
          expression.getSymbol(),
    )
    .sort((left, right) => right.getStart() - left.getStart())[0];
  const source = assignment?.getRight() ?? declaration?.getInitializer();
  return source === undefined
    ? expression
    : expressionProvenanceIn(sf, source, seen);
};

type PropertyKeyCandidates = {
  readonly names: ReadonlySet<string>;
  readonly unresolved: boolean;
};

const propertyKeyCandidatesIn = (
  sf: SourceFile,
  node: Node | undefined,
  seen: ReadonlySet<MorphSymbol> = new Set(),
): PropertyKeyCandidates => {
  const expression = unwrapExpression(node);
  if (
    Node.isStringLiteral(expression) ||
    Node.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return {
      names: new Set([expression.getLiteralText()]),
      unresolved: false,
    };
  }
  if (Node.isConditionalExpression(expression)) {
    const left = propertyKeyCandidatesIn(sf, expression.getWhenTrue(), seen);
    const right = propertyKeyCandidatesIn(sf, expression.getWhenFalse(), seen);
    return {
      names: new Set([...left.names, ...right.names]),
      unresolved: left.unresolved || right.unresolved,
    };
  }
  if (
    Node.isBinaryExpression(expression) &&
    PROVENANCE_CHOICE_OPERATORS.has(
      expression.getOperatorToken().getKind(),
    )
  ) {
    const left = propertyKeyCandidatesIn(sf, expression.getLeft(), seen);
    const right = propertyKeyCandidatesIn(sf, expression.getRight(), seen);
    return {
      names: new Set([...left.names, ...right.names]),
      unresolved: left.unresolved || right.unresolved,
    };
  }
  if (!Node.isIdentifier(expression)) {
    return { names: new Set(), unresolved: true };
  }
  const symbol = expression.getSymbol();
  if (symbol === undefined || seen.has(symbol)) {
    return { names: new Set(), unresolved: true };
  }
  const sources: Node[] = [];
  let unresolved = false;
  for (const declaration of symbol.getDeclarations()) {
    if (
      Node.isVariableDeclaration(declaration) ||
      Node.isParameterDeclaration(declaration)
    ) {
      const initializer = declaration.getInitializer();
      if (initializer === undefined) {
        unresolved = true;
      } else {
        sources.push(initializer);
      }
    } else {
      unresolved = true;
    }
  }
  for (const assignment of sf.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  )) {
    if (
      !PROVENANCE_ASSIGNMENT_OPERATORS.has(
        assignment.getOperatorToken().getKind(),
      )
    ) {
      continue;
    }
    const left = unwrapExpression(assignment.getLeft());
    if (Node.isIdentifier(left) && left.getSymbol() === symbol) {
      sources.push(assignment.getRight());
    }
  }
  if (sources.length === 0) {
    return { names: new Set(), unresolved: true };
  }
  const nextSeen = new Set(seen).add(symbol);
  const names = new Set<string>();
  for (const source of sources) {
    const candidates = propertyKeyCandidatesIn(sf, source, nextSeen);
    for (const name of candidates.names) names.add(name);
    unresolved ||= candidates.unresolved;
  }
  return { names, unresolved };
};

const literalPropertyKeyIn = (
  sf: SourceFile,
  node: Node | undefined,
): string | null => {
  const candidates = propertyKeyCandidatesIn(sf, node);
  return !candidates.unresolved && candidates.names.size === 1
    ? [...candidates.names][0]!
    : null;
};

const memberNameCandidatesIn = (
  sf: SourceFile,
  access: Node,
): PropertyKeyCandidates => {
  if (Node.isPropertyAccessExpression(access)) {
    return {
      names: new Set([access.getName()]),
      unresolved: false,
    };
  }
  return Node.isElementAccessExpression(access)
    ? propertyKeyCandidatesIn(sf, access.getArgumentExpression())
    : { names: new Set(), unresolved: true };
};

type AmbientAliasSource = {
  readonly at: number;
  readonly receiver: Node;
  readonly selectors: readonly ProvenanceSelector[];
  readonly uncertain?: boolean;
};

type ProvenanceSelector =
  | { readonly kind: "property"; readonly name: string | null }
  | { readonly kind: "index"; readonly index: number };

const UNKNOWN_AMBIENT_GLOBAL = "<unknown-ambient-global>";
const PROVENANCE_ASSIGNMENT_OPERATORS = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);
const PROVENANCE_CHOICE_OPERATORS = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);
const AMBIENT_ALIAS_SOURCE_CACHE = new WeakMap<
  SourceFile,
  Map<MorphSymbol, AmbientAliasSource[]>
>();

const classExtendsExpression = (node: Node | undefined): Node | undefined => {
  const expression = unwrapExpression(node);
  return Node.isClassDeclaration(expression) || Node.isClassExpression(expression)
    ? expression.getExtends()?.getExpression()
    : undefined;
};

const functionSymbolIn = (
  declaration: Node,
): MorphSymbol | undefined => {
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isMethodDeclaration(declaration) ||
    Node.isGetAccessorDeclaration(declaration) ||
    Node.isSetAccessorDeclaration(declaration)
  ) {
    return declaration.getNameNode()?.getSymbol();
  }
  if (
    Node.isArrowFunction(declaration) ||
    Node.isFunctionExpression(declaration)
  ) {
    const owner = declaration.getParent();
    if (Node.isVariableDeclaration(owner)) {
      return owner.getNameNode().getSymbol();
    }
  }
  return undefined;
};

const callableReturnSourcesIn = (
  declarations: readonly Node[],
): {
  readonly sources: readonly AmbientAliasSource[];
  readonly unresolved: boolean;
} => {
  if (declarations.length === 0) {
    return { sources: [], unresolved: true };
  }
  const sources: AmbientAliasSource[] = [];
  let unresolved = false;
  for (const declaration of declarations) {
    if (!Node.isFunctionLikeDeclaration(declaration)) {
      unresolved = true;
      continue;
    }
    const body = Node.isBodyable(declaration)
      ? declaration.getBody()
      : Node.isBodied(declaration)
        ? declaration.getBody()
        : undefined;
    if (body === undefined) {
      unresolved = true;
      continue;
    }
    if (!Node.isBlock(body)) {
      sources.push({
        at: body.getStart(),
        receiver: body,
        selectors: [],
      });
      continue;
    }
    const returns = body
      .getDescendantsOfKind(SyntaxKind.ReturnStatement)
      .filter(
        (statement) =>
          statement.getFirstAncestor(Node.isFunctionLikeDeclaration)
            ?.compilerNode === declaration.compilerNode,
      );
    for (const statement of returns) {
      const expression = statement.getExpression();
      if (expression === undefined) {
        unresolved = true;
      } else {
        sources.push({
          at: statement.getStart(),
          receiver: expression,
          selectors: [],
        });
      }
    }
    const statements = body.getStatements();
    unresolved ||=
      returns.length === 0 ||
      !Node.isReturnStatement(statements[statements.length - 1]);
  }
  return { sources, unresolved };
};

const parameterArgumentSourcesIn = (
  sf: SourceFile,
  parameter: Node,
): { readonly sources: AmbientAliasSource[]; readonly unresolved: boolean } => {
  if (!Node.isParameterDeclaration(parameter)) {
    return { sources: [], unresolved: true };
  }
  const declaration = parameter.getFirstAncestor(
    Node.isFunctionLikeDeclaration,
  );
  if (declaration === undefined) {
    return { sources: [], unresolved: true };
  }
  const parameters = declaration.getParameters();
  const index = parameters.findIndex(
    (candidate) => candidate.compilerNode === parameter.compilerNode,
  );
  if (index < 0 || parameter.isRestParameter()) {
    return { sources: [], unresolved: true };
  }
  const symbol = functionSymbolIn(declaration);
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression).filter(
    (call) => {
      const callee = unwrapExpression(call.getExpression());
      if (callee?.compilerNode === declaration.compilerNode) return true;
      return (
        symbol !== undefined &&
        Node.isIdentifier(callee) &&
        callee.getSymbol() === symbol
      );
    },
  );
  const directCallStarts = new Set(
    calls
      .map((call) => unwrapExpression(call.getExpression()))
      .filter(Node.isIdentifier)
      .map((callee) => callee.getStart()),
  );
  const declarationNameStarts = new Set<number>();
  for (const candidate of symbol?.getDeclarations() ?? []) {
    if (
      Node.isFunctionDeclaration(candidate) ||
      Node.isMethodDeclaration(candidate) ||
      Node.isGetAccessorDeclaration(candidate) ||
      Node.isSetAccessorDeclaration(candidate)
    ) {
      const name = candidate.getNameNode();
      if (name !== undefined) declarationNameStarts.add(name.getStart());
    } else if (Node.isVariableDeclaration(candidate)) {
      declarationNameStarts.add(candidate.getNameNode().getStart());
    }
  }
  const variableOwner = declaration.getFirstAncestorByKind(
    SyntaxKind.VariableStatement,
  );
  const externallyVisible =
    (Node.isFunctionDeclaration(declaration) &&
      declaration.isExported()) ||
    variableOwner?.isExported() === true;
  const escapes =
    externallyVisible ||
    symbol === undefined ||
    sf.getDescendantsOfKind(SyntaxKind.Identifier).some(
      (identifier) =>
        identifier.getSymbol() === symbol &&
        !directCallStarts.has(identifier.getStart()) &&
        !declarationNameStarts.has(identifier.getStart()),
    );
  let unresolved = escapes;
  const sources: AmbientAliasSource[] = [];
  for (const call of calls) {
    const argument = call.getArguments()[index];
    if (argument === undefined) {
      unresolved ||= parameter.getInitializer() === undefined;
      continue;
    }
    if (Node.isSpreadElement(argument)) {
      unresolved = true;
      continue;
    }
    sources.push({
      at: call.getStart(),
      receiver: argument,
      selectors: [],
    });
  }
  if (calls.length === 0) unresolved = true;
  return { sources, unresolved };
};

const bindingElementSourcesIn = (
  sf: SourceFile,
  declaration: Node,
  at: number,
): AmbientAliasSource[] => {
  const sources: AmbientAliasSource[] = [];
  let current = declaration;
  let selectors: ProvenanceSelector[] = [];
  let uncertain = false;
  while (Node.isBindingElement(current)) {
    const fallback = current.getInitializer();
    if (fallback !== undefined) {
      sources.push({
        at,
        receiver: fallback,
        selectors,
        uncertain,
      });
    }
    const pattern = current.getParent();
    let selector: ProvenanceSelector;
    if (Node.isObjectBindingPattern(pattern)) {
      const name = propertyNameIn(
        sf,
        current.getPropertyNameNode(),
        current.getName(),
      );
      selector = { kind: "property", name };
      uncertain ||= name === null || current.getDotDotDotToken() !== undefined;
    } else if (Node.isArrayBindingPattern(pattern)) {
      const index = pattern.getElements().findIndex(
        (element) => element.compilerNode === current.compilerNode,
      );
      selector = { kind: "index", index };
      uncertain ||= index < 0 || current.getDotDotDotToken() !== undefined;
    } else {
      return [
        ...sources,
        {
          at,
          receiver: current,
          selectors: [],
          uncertain: true,
        },
      ];
    }
    selectors = [selector, ...selectors];
    const owner = pattern.getParent();
    if (
      Node.isVariableDeclaration(owner) ||
      Node.isParameterDeclaration(owner)
    ) {
      const receiver = owner.getInitializer();
      if (receiver !== undefined) {
        sources.push({
          at,
          receiver,
          selectors,
          uncertain,
        });
      }
      if (Node.isParameterDeclaration(owner)) {
        const arguments_ = parameterArgumentSourcesIn(sf, owner);
        sources.push(
          ...arguments_.sources.map((source) => ({
            ...source,
            selectors: [...source.selectors, ...selectors],
            uncertain: source.uncertain === true || uncertain,
          })),
        );
        if (arguments_.unresolved) {
          sources.push({
            at,
            receiver: owner,
            selectors,
            uncertain: true,
          });
        }
      }
      return sources;
    }
    if (!Node.isBindingElement(owner)) {
      sources.push({
        at,
        receiver: current,
        selectors: [],
        uncertain: true,
      });
      return sources;
    }
    current = owner;
  }
  return sources;
};

const ambientAliasSourcesIn = (
  sf: SourceFile,
  symbol: MorphSymbol,
): AmbientAliasSource[] => {
  let sourceFileCache = AMBIENT_ALIAS_SOURCE_CACHE.get(sf);
  if (sourceFileCache === undefined) {
    sourceFileCache = new Map();
    AMBIENT_ALIAS_SOURCE_CACHE.set(sf, sourceFileCache);
  }
  const cached = sourceFileCache.get(symbol);
  if (cached !== undefined) return cached;
  const sources: AmbientAliasSource[] = [];
  for (const declaration of symbol.getDeclarations()) {
    if (
      Node.isVariableDeclaration(declaration) ||
      Node.isParameterDeclaration(declaration)
    ) {
      const receiver = declaration.getInitializer();
      if (receiver !== undefined) {
        sources.push({
          at: declaration.getStart(),
          receiver: classExtendsExpression(receiver) ?? receiver,
          selectors: [],
        });
      }
      if (Node.isParameterDeclaration(declaration)) {
        const arguments_ = parameterArgumentSourcesIn(sf, declaration);
        sources.push(...arguments_.sources);
        if (arguments_.unresolved) {
          sources.push({
            at: declaration.getStart(),
            receiver: declaration,
            selectors: [],
            uncertain: true,
          });
        }
      }
      continue;
    }
    if (Node.isClassDeclaration(declaration)) {
      const receiver = classExtendsExpression(declaration);
      if (receiver !== undefined) {
        sources.push({
          at: declaration.getStart(),
          receiver,
          selectors: [],
        });
      }
      continue;
    }
    if (Node.isExportAssignment(declaration)) {
      const expression = declaration.getExpression();
      sources.push({
        at: declaration.getStart(),
        receiver: classExtendsExpression(expression) ?? expression,
        selectors: [],
      });
      continue;
    }
    if (Node.isBindingElement(declaration)) {
      sources.push(
        ...bindingElementSourcesIn(
          sf,
          declaration,
          declaration.getStart(),
        ),
      );
    }
  }
  const collectAssignmentTarget = (
    targetNode: Node,
    source: AmbientAliasSource,
  ): void => {
    const target = unwrapExpression(targetNode);
    if (Node.isBinaryExpression(target)) {
      if (target.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) {
        collectAssignmentTarget(target.getLeft(), {
          ...source,
          uncertain: true,
        });
        return;
      }
      collectAssignmentTarget(target.getLeft(), source);
      collectAssignmentTarget(target.getLeft(), {
        at: source.at,
        receiver: target.getRight(),
        selectors: [],
      });
      return;
    }
    if (Node.isIdentifier(target)) {
      if (target.getSymbol() === symbol) sources.push(source);
      return;
    }
    if (Node.isObjectLiteralExpression(target)) {
      for (const property of target.getProperties()) {
        if (Node.isPropertyAssignment(property)) {
          const name = propertyNameIn(
            sf,
            property.getNameNode(),
            property.getName(),
          );
          const initializer = property.getInitializer();
          if (initializer === undefined) continue;
          collectAssignmentTarget(initializer, {
            ...source,
            selectors: [
              ...source.selectors,
              { kind: "property", name },
            ],
            uncertain: source.uncertain === true || name === null,
          });
        } else if (Node.isShorthandPropertyAssignment(property)) {
          const name = propertyNameIn(
            sf,
            property.getNameNode(),
            property.getName(),
          );
          if (property.getValueSymbol() === symbol) {
            sources.push({
              ...source,
              selectors: [
                ...source.selectors,
                { kind: "property", name },
              ],
              uncertain: source.uncertain === true || name === null,
            });
            const fallback = property.getObjectAssignmentInitializer();
            if (fallback !== undefined) {
              sources.push({
                at: source.at,
                receiver: fallback,
                selectors: [],
              });
            }
          }
        } else if (Node.isSpreadAssignment(property)) {
          collectAssignmentTarget(property.getExpression(), {
            ...source,
            uncertain: true,
          });
        }
      }
      return;
    }
    if (Node.isArrayLiteralExpression(target)) {
      for (const [index, element] of target.getElements().entries()) {
        if (Node.isOmittedExpression(element)) continue;
        if (Node.isSpreadElement(element)) {
          collectAssignmentTarget(element.getExpression(), {
            ...source,
            uncertain: true,
          });
          continue;
        }
        collectAssignmentTarget(element, {
          ...source,
          selectors: [
            ...source.selectors,
            { kind: "index", index },
          ],
        });
      }
    }
  };
  for (const assignment of sf.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  )) {
    const operator = assignment.getOperatorToken().getKind();
    if (!PROVENANCE_ASSIGNMENT_OPERATORS.has(operator)) continue;
    if (operator === SyntaxKind.EqualsToken) {
      collectAssignmentTarget(assignment.getLeft(), {
        at: assignment.getStart(),
        receiver: assignment.getRight(),
        selectors: [],
      });
      continue;
    }
    const left = unwrapExpression(assignment.getLeft());
    if (Node.isIdentifier(left) && left.getSymbol() === symbol) {
      sources.push({
        at: assignment.getStart(),
        receiver: assignment.getRight(),
        selectors: [],
      });
    }
  }
  const sorted = sources.sort((left, right) => left.at - right.at);
  sourceFileCache.set(symbol, sorted);
  return sorted;
};

const resolvedAliasedSymbol = (symbol: MorphSymbol): MorphSymbol => {
  const seen = new Set<MorphSymbol>();
  let current = symbol;
  while (!seen.has(current)) {
    seen.add(current);
    const aliased = current.getAliasedSymbol();
    if (aliased === undefined || aliased === current) break;
    current = aliased;
  }
  return current;
};

const moduleExportSymbolsAtPath = (
  symbol: MorphSymbol,
  path: readonly ProvenanceSelector[],
): readonly {
  readonly symbol: MorphSymbol;
  readonly remaining: readonly ProvenanceSelector[];
}[] => {
  const selector = path[0];
  if (selector?.kind !== "property") return [];
  const exports = [...new Set([
    ...symbol.getExports(),
    ...symbol.getDeclarations().flatMap((declaration) =>
      Node.isSourceFile(declaration) ? declaration.getExportSymbols() : []
    ),
  ])];
  return exports
    .filter((candidate) =>
      selector.name === null || candidate.getName() === selector.name
    )
    .map((candidate) => ({
      symbol: candidate,
      remaining: path.slice(1),
    }));
};

const ambientAliasSourcesAcrossModulesIn = (
  sf: SourceFile,
  symbol: MorphSymbol,
): {
  readonly symbol: MorphSymbol;
  readonly sources: readonly AmbientAliasSource[];
  readonly sourceFiles: readonly SourceFile[];
} => {
  const target = resolvedAliasedSymbol(symbol);
  const sourceFiles = [...new Set(
    target.getDeclarations()
      .map((declaration) => declaration.getSourceFile())
      .filter((sourceFile) => !sourceFile.isDeclarationFile()),
  )];
  if (sourceFiles.length === 0 && target === symbol) sourceFiles.push(sf);
  return {
    symbol: target,
    sources: sourceFiles.flatMap((sourceFile) =>
      ambientAliasSourcesIn(sourceFile, target)
    ),
    sourceFiles,
  };
};

const selectorCandidatesForAccessIn = (
  sf: SourceFile,
  access: Node,
): {
  readonly selectors: readonly ProvenanceSelector[];
  readonly unresolved: boolean;
} => {
  if (Node.isPropertyAccessExpression(access)) {
    return {
      selectors: [{ kind: "property", name: access.getName() }],
      unresolved: false,
    };
  }
  if (!Node.isElementAccessExpression(access)) {
    return { selectors: [], unresolved: true };
  }
  const argument = unwrapExpression(access.getArgumentExpression());
  if (Node.isNumericLiteral(argument)) {
    const index = Number(argument.getLiteralText());
    return Number.isSafeInteger(index) && index >= 0
      ? { selectors: [{ kind: "index", index }], unresolved: false }
      : { selectors: [], unresolved: true };
  }
  const names = propertyKeyCandidatesIn(sf, argument);
  return {
    selectors: [...names.names].map((name) => ({
      kind: "property" as const,
      name,
    })),
    unresolved: names.unresolved,
  };
};

const assignmentPathsForRootIn = (
  sf: SourceFile,
  targetNode: Node,
  isRoot: (target: Node) => boolean,
): {
  readonly paths: readonly (readonly ProvenanceSelector[])[];
  readonly unresolved: boolean;
} => {
  let target = unwrapExpression(targetNode);
  let paths: ProvenanceSelector[][] = [[]];
  let unresolved = false;
  while (
    Node.isPropertyAccessExpression(target) ||
    Node.isElementAccessExpression(target)
  ) {
    const candidates = selectorCandidatesForAccessIn(sf, target);
    if (candidates.selectors.length === 0) unresolved = true;
    paths = paths.flatMap((path) =>
      candidates.selectors.map((selector) => [selector, ...path]),
    );
    unresolved ||= candidates.unresolved;
    target = unwrapExpression(target.getExpression());
  }
  return target !== undefined && isRoot(target)
    ? { paths, unresolved }
    : { paths: [], unresolved: false };
};

const assignmentPathsForSymbolIn = (
  sf: SourceFile,
  targetNode: Node,
  symbol: MorphSymbol,
): {
  readonly paths: readonly (readonly ProvenanceSelector[])[];
  readonly unresolved: boolean;
} => assignmentPathsForRootIn(
  sf,
  targetNode,
  (target) => Node.isIdentifier(target) && target.getSymbol() === symbol,
);

const assignmentPathsForThisIn = (
  sf: SourceFile,
  targetNode: Node,
): {
  readonly paths: readonly (readonly ProvenanceSelector[])[];
  readonly unresolved: boolean;
} => assignmentPathsForRootIn(
  sf,
  targetNode,
  (target) => target.getKind() === SyntaxKind.ThisKeyword,
);

const CONTAINER_ASSIGNMENTS_CACHE = new WeakMap<
  SourceFile,
  {
    readonly sourceText: string;
    readonly bySymbol: ReadonlyMap<MorphSymbol, readonly BinaryExpression[]>;
  }
>();

const containerAssignmentsForSymbolIn = (
  sourceFile: SourceFile,
  symbol: MorphSymbol,
): readonly BinaryExpression[] => {
  const sourceText = sourceFile.getFullText();
  let cached = CONTAINER_ASSIGNMENTS_CACHE.get(sourceFile);
  if (cached === undefined || cached.sourceText !== sourceText) {
    const bySymbol = new Map<MorphSymbol, BinaryExpression[]>();
    for (const candidate of sourceFile.getDescendantsOfKind(
      SyntaxKind.BinaryExpression,
    )) {
      if (
        !PROVENANCE_ASSIGNMENT_OPERATORS.has(
          candidate.getOperatorToken().getKind(),
        )
      ) continue;
      let target = unwrapExpression(candidate.getLeft());
      while (
        Node.isPropertyAccessExpression(target) ||
        Node.isElementAccessExpression(target)
      ) target = unwrapExpression(target.getExpression());
      if (!Node.isIdentifier(target)) continue;
      const targetSymbol = target.getSymbol();
      if (targetSymbol === undefined) continue;
      const assignments = bySymbol.get(targetSymbol) ?? [];
      assignments.push(candidate);
      bySymbol.set(targetSymbol, assignments);
    }
    cached = { sourceText, bySymbol };
    CONTAINER_ASSIGNMENTS_CACHE.set(sourceFile, cached);
  }
  return cached.bySymbol.get(symbol) ?? [];
};

type IndexedContainerMutation =
  | {
      readonly kind: "array-values";
      readonly target: Node;
      readonly values: readonly Node[];
    }
  | {
      readonly kind: "copy-properties";
      readonly target: Node;
      readonly sources: readonly Node[];
    }
  | {
      readonly kind: "set-property";
      readonly target: Node;
      readonly keys: PropertyKeyCandidates;
      readonly source: Node;
      readonly sourceSelectors: readonly ProvenanceSelector[];
    };

const CONTAINER_MUTATIONS_CACHE = new WeakMap<
  SourceFile,
  {
    readonly sourceText: string;
    readonly bySymbol: ReadonlyMap<
      MorphSymbol,
      readonly IndexedContainerMutation[]
    >;
  }
>();

const rootSymbolOfContainerTarget = (
  node: Node | undefined,
): MorphSymbol | undefined => {
  let target = unwrapExpression(node);
  while (
    Node.isPropertyAccessExpression(target) ||
    Node.isElementAccessExpression(target)
  ) {
    target = unwrapExpression(target.getExpression());
  }
  return Node.isIdentifier(target) ? target.getSymbol() : undefined;
};

const nodeOrDeclarationMentionsAny = (
  node: Node,
  names: readonly string[],
  seenSymbols: ReadonlySet<MorphSymbol> = new Set(),
): boolean => {
  if (names.some((name) => node.getText().includes(name))) return true;
  const expression = unwrapExpression(node);
  if (Node.isIdentifier(expression)) {
    const symbol = expression.getSymbol();
    if (symbol === undefined || seenSymbols.has(symbol)) return false;
    const nextSeen = new Set(seenSymbols).add(symbol);
    return symbol.getDeclarations().some((declaration) =>
      names.some((name) => declaration.getText().includes(name)) ||
      (Node.isVariableDeclaration(declaration) &&
        declaration.getInitializer() !== undefined &&
        nodeOrDeclarationMentionsAny(
          declaration.getInitializerOrThrow(),
          names,
          nextSeen,
        ))
    );
  }
  if (
    Node.isPropertyAccessExpression(expression) ||
    Node.isElementAccessExpression(expression)
  ) {
    return nodeOrDeclarationMentionsAny(
      expression.getExpression(),
      names,
      seenSymbols,
    );
  }
  if (Node.isCallExpression(expression)) {
    return nodeOrDeclarationMentionsAny(
      expression.getExpression(),
      names,
      seenSymbols,
    );
  }
  return false;
};

const indexedContainerMutationsIn = (
  sourceFile: SourceFile,
): ReadonlyMap<MorphSymbol, readonly IndexedContainerMutation[]> => {
  const sourceText = sourceFile.getFullText();
  const cached = CONTAINER_MUTATIONS_CACHE.get(sourceFile);
  if (cached !== undefined && cached.sourceText === sourceText) {
    return cached.bySymbol;
  }
  const bySymbol = new Map<MorphSymbol, IndexedContainerMutation[]>();
  const add = (mutation: IndexedContainerMutation): void => {
    const symbol = rootSymbolOfContainerTarget(mutation.target);
    if (symbol === undefined) return;
    const mutations = bySymbol.get(symbol) ?? [];
    mutations.push(mutation);
    bySymbol.set(symbol, mutations);
  };
  for (const call of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    const called = call.getExpression();
    const callee = unwrapExpression(called);
    const directMembers = Node.isPropertyAccessExpression(callee)
      ? new Set([callee.getName()])
      : Node.isElementAccessExpression(callee)
        ? propertyKeyCandidatesIn(
          sourceFile,
          callee.getArgumentExpression(),
        ).names
        : new Set<string>();
    const mayBeAliasedAmbientMutation =
      Node.isIdentifier(callee) ||
      Node.isCallExpression(callee) ||
      directMembers.has("call") ||
      directMembers.has("apply") ||
      directMembers.has("bind");
    const mayBeObjectMutation =
      directMembers.has("assign") ||
      directMembers.has("defineProperty") ||
      mayBeAliasedAmbientMutation;
    const objectCall = mayBeObjectMutation &&
        nodeOrDeclarationMentionsAny(called, ["Object"])
      ? normalizedAmbientBuiltinCall(
        call,
        "Object",
        ["assign", "defineProperty"],
      )
      : null;
    if (objectCall !== null && objectCall.arguments !== null) {
      const [target, keyOrSource, descriptor] = objectCall.arguments;
      if (target !== undefined && objectCall.method === "assign") {
        add({
          kind: "copy-properties",
          target,
          sources: objectCall.arguments.slice(1),
        });
      } else if (
        target !== undefined &&
        keyOrSource !== undefined &&
        descriptor !== undefined
      ) {
        add({
          kind: "set-property",
          target,
          keys: propertyKeyCandidatesIn(sourceFile, keyOrSource),
          source: descriptor,
          sourceSelectors: [{ kind: "property", name: "value" }],
        });
      }
    }
    const mayBeReflectMutation = directMembers.has("set") ||
      mayBeAliasedAmbientMutation;
    const reflectCall = mayBeReflectMutation &&
        nodeOrDeclarationMentionsAny(called, ["Reflect"])
      ? normalizedAmbientBuiltinCall(call, "Reflect", ["set"])
      : null;
    if (reflectCall !== null && reflectCall.arguments !== null) {
      const [target, key, value] = reflectCall.arguments;
      if (target !== undefined && key !== undefined && value !== undefined) {
        add({
          kind: "set-property",
          target,
          keys: propertyKeyCandidatesIn(sourceFile, key),
          source: value,
          sourceSelectors: [],
        });
      }
    }
    if (
      !Node.isPropertyAccessExpression(callee) &&
      !Node.isElementAccessExpression(callee)
    ) continue;
    if (
      !["fill", "push", "splice", "unshift"].some((name) =>
        directMembers.has(name)
      )
    ) continue;
    const members = memberNameCandidatesIn(sourceFile, callee);
    const values = members.names.has("splice")
      ? call.getArguments().slice(2)
      : members.names.has("fill")
        ? call.getArguments().slice(0, 1)
        : members.names.has("push") || members.names.has("unshift")
          ? call.getArguments()
          : [];
    if (values.length === 0) continue;
    const receiver = callee.getExpression();
    const type = unwrapExpression(receiver)?.getType();
    if (type?.isArray() || type?.isTuple()) {
      add({ kind: "array-values", target: receiver, values });
    }
  }
  const next = { sourceText, bySymbol };
  CONTAINER_MUTATIONS_CACHE.set(sourceFile, next);
  return bySymbol;
};

const selectorsEqual = (
  left: ProvenanceSelector,
  right: ProvenanceSelector,
): boolean => {
  if (left.kind !== right.kind) return false;
  return left.kind === "property"
    ? left.name === (
        right as Extract<ProvenanceSelector, { kind: "property" }>
      ).name
    : left.index === (
        right as Extract<ProvenanceSelector, { kind: "index" }>
      ).index;
};

const selectorsMayMatch = (
  left: ProvenanceSelector,
  right: ProvenanceSelector,
): boolean =>
  left.kind === right.kind &&
  (left.kind === "property"
    ? left.name === null ||
      (right as Extract<ProvenanceSelector, { kind: "property" }>).name === null ||
      left.name === (
        right as Extract<ProvenanceSelector, { kind: "property" }>
      ).name
    : left.index === (
        right as Extract<ProvenanceSelector, { kind: "index" }>
      ).index);

type ContainerValueSource = {
  readonly receiver: Node;
  readonly remaining: readonly ProvenanceSelector[];
  readonly uncertain: boolean;
};

const containerValueSourcesAtPathIn = (
  sf: SourceFile,
  symbol: MorphSymbol,
  path: readonly ProvenanceSelector[],
): readonly ContainerValueSource[] => {
  const sources: ContainerValueSource[] = [];
  for (const assignment of containerAssignmentsForSymbolIn(sf, symbol)) {
    const targets = assignmentPathsForSymbolIn(sf, assignment.getLeft(), symbol);
    if (targets.unresolved) {
      sources.push({
        receiver: assignment.getRight(),
        remaining: [],
        uncertain: true,
      });
    }
    for (const targetPath of targets.paths) {
      if (
        targetPath.length > path.length ||
        !targetPath.every((selector, index) =>
          selectorsEqual(selector, path[index]!),
        )
      ) continue;
      sources.push({
        receiver: assignment.getRight(),
        remaining: path.slice(targetPath.length),
        uncertain: false,
      });
    }
  }
  const mutations = indexedContainerMutationsIn(sf).get(symbol) ?? [];
  for (const mutation of mutations) {
    const targets = assignmentPathsForSymbolIn(sf, mutation.target, symbol);
    for (const targetPath of targets.paths) {
      if (
        targetPath.length > path.length ||
        !targetPath.every((selector, index) =>
          selectorsEqual(selector, path[index]!),
        )
      ) continue;
      const remaining = path.slice(targetPath.length);
      if (mutation.kind === "copy-properties") {
        sources.push(...mutation.sources.map((source) => ({
          receiver: source,
          remaining,
          uncertain: targets.unresolved,
        })));
        continue;
      }
      if (mutation.kind === "array-values") {
        if (remaining[0]?.kind !== "index") continue;
        sources.push(...mutation.values.map((source) => ({
          receiver: source,
          remaining: remaining.slice(1),
          uncertain: targets.unresolved,
        })));
        continue;
      }
      const keySelectors: ProvenanceSelector[] = [
        ...mutation.keys.names,
      ].flatMap((name): ProvenanceSelector[] => {
        const property: ProvenanceSelector = { kind: "property", name };
        if (!/^(?:0|[1-9]\d*)$/.test(name)) return [property];
        const index = Number.parseInt(name, 10);
        return Number.isSafeInteger(index)
          ? [property, { kind: "index", index }]
          : [property];
      });
      if (mutation.keys.unresolved) {
        keySelectors.push({ kind: "property", name: null });
      }
      for (const keySelector of keySelectors) {
        if (
          remaining[0] === undefined ||
          !selectorsMayMatch(keySelector, remaining[0])
        ) continue;
        sources.push({
          receiver: mutation.source,
          remaining: [
            ...mutation.sourceSelectors,
            ...remaining.slice(1),
          ],
          uncertain: targets.unresolved || mutation.keys.unresolved,
        });
      }
    }
  }
  return sources;
};

const classStaticValueSourcesAtPathIn = (
  sf: SourceFile,
  symbol: MorphSymbol,
  path: readonly ProvenanceSelector[],
): readonly ContainerValueSource[] => {
  const selector = path[0];
  if (selector === undefined) return [];
  const sources: ContainerValueSource[] = [];
  for (const declaration of symbol.getDeclarations()) {
    if (declaration.getSourceFile() !== sf) continue;
    const classLike = Node.isClassDeclaration(declaration)
      ? declaration
      : Node.isVariableDeclaration(declaration)
        ? unwrapExpression(declaration.getInitializer())
        : undefined;
    if (
      !Node.isClassDeclaration(classLike) &&
      !Node.isClassExpression(classLike)
    ) {
      continue;
    }
    for (const property of classLike.getProperties()) {
      if (!property.isStatic()) continue;
      const initializer = property.getInitializer();
      if (initializer === undefined) continue;
      const name = propertyNameIn(
        sf,
        property.getNameNode(),
        property.getName(),
      );
      const matches = selector.kind === "property" &&
        (name === null || selector.name === null || name === selector.name);
      if (!matches) continue;
      sources.push({
        receiver: initializer,
        remaining: path.slice(1),
        uncertain: name === null || selector.name === null,
      });
    }
    for (const accessor of classLike.getGetAccessors()) {
      if (!accessor.isStatic()) continue;
      const name = propertyNameIn(
        sf,
        accessor.getNameNode(),
        accessor.getName(),
      );
      const matches = selector.kind === "property" &&
        (name === null || selector.name === null || name === selector.name);
      if (!matches) continue;
      const returned = callableReturnSourcesIn([accessor]);
      sources.push(
        ...returned.sources.map((source) => ({
          receiver: source.receiver,
          remaining: path.slice(1),
          uncertain:
            source.uncertain === true ||
            name === null ||
            selector.name === null,
        })),
      );
      if (returned.unresolved) {
        sources.push({
          receiver: accessor,
          remaining: path.slice(1),
          uncertain: true,
        });
      }
    }
    for (const block of classLike.getStaticBlocks()) {
      for (const assignment of block.getDescendantsOfKind(
        SyntaxKind.BinaryExpression,
      )) {
        if (
          !PROVENANCE_ASSIGNMENT_OPERATORS.has(
            assignment.getOperatorToken().getKind(),
          )
        ) continue;
        const ancestors = assignment.getAncestors();
        const blockIndex = ancestors.findIndex(
          (ancestor) => ancestor.compilerNode === block.compilerNode,
        );
        const nestedThisScope = (
          blockIndex < 0 ? ancestors : ancestors.slice(0, blockIndex)
        ).some((ancestor) =>
          (Node.isFunctionLikeDeclaration(ancestor) &&
            !Node.isArrowFunction(ancestor)) ||
          Node.isClassDeclaration(ancestor) ||
          Node.isClassExpression(ancestor)
        );
        if (nestedThisScope) continue;
        const targets = assignmentPathsForThisIn(sf, assignment.getLeft());
        if (targets.unresolved) {
          sources.push({
            receiver: assignment.getRight(),
            remaining: [],
            uncertain: true,
          });
        }
        for (const targetPath of targets.paths) {
          if (
            targetPath.length > path.length ||
            !targetPath.every((candidate, index) =>
              selectorsEqual(candidate, path[index]!),
            )
          ) continue;
          sources.push({
            receiver: assignment.getRight(),
            remaining: path.slice(targetPath.length),
            uncertain: false,
          });
        }
      }
    }
  }
  return sources;
};

const classInstanceValueSourcesAtPathIn = (
  constructor: Node | undefined,
  path: readonly ProvenanceSelector[],
  seenSymbols: ReadonlySet<MorphSymbol> = new Set(),
): readonly ContainerValueSource[] => {
  const selector = path[0];
  if (selector === undefined) return [];
  const construction = unwrapExpression(constructor);
  const newExpression = Node.isNewExpression(construction)
    ? construction
    : undefined;
  const expression = unwrapExpression(
    newExpression?.getExpression() ?? construction,
  );
  const classLikes: Array<ClassDeclaration | ClassExpression> = [];
  if (Node.isClassDeclaration(expression) || Node.isClassExpression(expression)) {
    classLikes.push(expression);
  } else {
    const symbol = expression?.getSymbol();
    if (symbol === undefined) return [];
    const target = resolvedAliasedSymbol(symbol);
    if (seenSymbols.has(target)) return [];
    for (const declaration of target.getDeclarations()) {
      if (Node.isClassDeclaration(declaration)) {
        classLikes.push(declaration);
      } else if (Node.isVariableDeclaration(declaration)) {
        const initializer = unwrapExpression(declaration.getInitializer());
        if (Node.isClassExpression(initializer)) classLikes.push(initializer);
      }
    }
  }
  const sources: ContainerValueSource[] = [];
  for (const classLike of classLikes) {
    const sourceFile = classLike.getSourceFile();
    for (const property of classLike.getProperties()) {
      if (property.isStatic()) continue;
      const initializer = property.getInitializer();
      if (initializer === undefined) continue;
      const name = propertyNameIn(
        sourceFile,
        property.getNameNode(),
        property.getName(),
      );
      if (
        selector.kind !== "property" ||
        !(
          name === null ||
          selector.name === null ||
          name === selector.name
        )
      ) continue;
      sources.push({
        receiver: initializer,
        remaining: path.slice(1),
        uncertain: name === null || selector.name === null,
      });
    }
    for (const accessor of classLike.getGetAccessors()) {
      if (accessor.isStatic()) continue;
      const name = propertyNameIn(
        sourceFile,
        accessor.getNameNode(),
        accessor.getName(),
      );
      if (
        selector.kind !== "property" ||
        !(
          name === null ||
          selector.name === null ||
          name === selector.name
        )
      ) continue;
      const returned = callableReturnSourcesIn([accessor]);
      sources.push(
        ...returned.sources.map((source) => ({
          receiver: source.receiver,
          remaining: path.slice(1),
          uncertain:
            source.uncertain === true ||
            name === null ||
            selector.name === null,
        })),
      );
      if (returned.unresolved) {
        sources.push({
          receiver: accessor,
          remaining: path.slice(1),
          uncertain: true,
        });
      }
    }
    for (const declaration of classLike.getConstructors()) {
      for (const [index, parameter] of declaration.getParameters().entries()) {
        if (!parameter.isParameterProperty()) continue;
        const nameNode = parameter.getNameNode();
        const name = Node.isIdentifier(nameNode) ? nameNode.getText() : null;
        if (
          selector.kind !== "property" ||
          !(
            name === null ||
            selector.name === null ||
            name === selector.name
          )
        ) continue;
        const argument = newExpression?.getArguments()[index];
        if (argument !== undefined) {
          sources.push({
            receiver: Node.isSpreadElement(argument)
              ? argument.getExpression()
              : argument,
            remaining: path.slice(1),
            uncertain:
              Node.isSpreadElement(argument) ||
              name === null ||
              selector.name === null,
          });
        }
        const initializer = parameter.getInitializer();
        if (initializer !== undefined) {
          sources.push({
            receiver: initializer,
            remaining: path.slice(1),
            uncertain: name === null || selector.name === null,
          });
        }
      }
      for (const assignment of declaration.getDescendantsOfKind(
        SyntaxKind.BinaryExpression,
      )) {
        if (
          !PROVENANCE_ASSIGNMENT_OPERATORS.has(
            assignment.getOperatorToken().getKind(),
          )
        ) continue;
        const ancestors = assignment.getAncestors();
        const declarationIndex = ancestors.findIndex(
          (ancestor) => ancestor.compilerNode === declaration.compilerNode,
        );
        const nestedThisScope = (
          declarationIndex < 0
            ? ancestors
            : ancestors.slice(0, declarationIndex)
        ).some((ancestor) =>
            (Node.isFunctionLikeDeclaration(ancestor) &&
              !Node.isArrowFunction(ancestor)) ||
            Node.isClassDeclaration(ancestor) ||
            Node.isClassExpression(ancestor)
          );
        if (nestedThisScope) continue;
        const targets = assignmentPathsForThisIn(
          sourceFile,
          assignment.getLeft(),
        );
        if (targets.paths.length === 0 && !targets.unresolved) continue;
        if (targets.unresolved) {
          sources.push({
            receiver: assignment.getRight(),
            remaining: [],
            uncertain: true,
          });
        }
        for (const targetPath of targets.paths) {
          if (
            targetPath.length > path.length ||
            !targetPath.every((candidate, index) =>
              selectorsEqual(candidate, path[index]!),
            )
          ) continue;
          sources.push({
            receiver: assignment.getRight(),
            remaining: path.slice(targetPath.length),
            uncertain: false,
          });
        }
      }
    }
    const heritage = classLike.getExtends()?.getExpression();
    if (heritage !== undefined) {
      const nextSeen = new Set(seenSymbols);
      const classSymbol = classLike.getSymbol();
      if (classSymbol !== undefined) {
        nextSeen.add(resolvedAliasedSymbol(classSymbol));
      }
      sources.push(
        ...classInstanceValueSourcesAtPathIn(
          heritage,
          path,
          nextSeen,
        ),
      );
    }
  }
  return sources;
};

const assignedContainerNamesAtPathIn = (
  sf: SourceFile,
  symbol: MorphSymbol,
  path: readonly ProvenanceSelector[],
  seen: Set<MorphSymbol>,
): ReadonlySet<string> => {
  if (path.length === 0) return new Set();
  const names = new Set<string>();
  for (const source of classStaticValueSourcesAtPathIn(sf, symbol, path)) {
    if (source.uncertain) {
      names.add(UNKNOWN_AMBIENT_GLOBAL);
      continue;
    }
    for (const name of ambientGlobalNamesAtPathIn(
      sf,
      source.receiver,
      source.remaining,
      seen,
    )) {
      names.add(name);
    }
  }
  for (const source of containerValueSourcesAtPathIn(sf, symbol, path)) {
    if (source.uncertain) {
      names.add(UNKNOWN_AMBIENT_GLOBAL);
      continue;
    }
    for (const name of ambientGlobalNamesAtPathIn(
      source.receiver.getSourceFile(),
      source.receiver,
      source.remaining,
      seen,
    )) {
      names.add(name);
    }
  }
  return names;
};

/**
 * The ambient global an expression denotes - a bare name this project never
 * declares (`process`, `Date`), or that SAME global reached through the
 * `globalThis` namespace (`globalThis.process`, `globalThis["Date"]`). One
 * authority for both spellings: two scanners that each resolve their own drift
 * apart, and the spelling one forgot is a capability it stops refusing.
 */
const ambientNamesForSymbolAtPathIn = (
  sf: SourceFile,
  symbol: MorphSymbol,
  path: readonly ProvenanceSelector[],
  seen: Set<MorphSymbol>,
): ReadonlySet<string> => {
  const provenance = ambientAliasSourcesAcrossModulesIn(sf, symbol);
  if (seen.has(provenance.symbol)) return new Set();
  const sources = provenance.sources;
  const nextSeen = new Set(seen).add(provenance.symbol);
  const names = new Set<string>();
  const moduleExports = moduleExportSymbolsAtPath(provenance.symbol, path);
  for (const exported of moduleExports) {
    for (const name of ambientNamesForSymbolAtPathIn(
      sf,
      exported.symbol,
      exported.remaining,
      nextSeen,
    )) {
      names.add(name);
    }
  }
  for (const source of sources) {
    for (const name of ambientGlobalNamesAtPathIn(
      source.receiver.getSourceFile(),
      source.receiver,
      [...source.selectors, ...path],
      nextSeen,
      source.uncertain === true,
    )) {
      names.add(name);
    }
  }
  for (const sourceFile of provenance.sourceFiles) {
    for (const name of assignedContainerNamesAtPathIn(
      sourceFile,
      provenance.symbol,
      path,
      nextSeen,
    )) {
      names.add(name);
    }
  }
  if (moduleExports.length > 0 || sources.length > 0 || names.size > 0) {
    return names;
  }
  const declarations = provenance.symbol.getDeclarations();
  const isAmbient = declarations.every((declaration) =>
    declaration.getSourceFile().isDeclarationFile()
  );
  if (!isAmbient) return new Set();
  if (path.length === 0) return new Set([provenance.symbol.getName()]);
  const selector = path[0];
  if (selector === undefined) return new Set([provenance.symbol.getName()]);
  const remaining = path.slice(1);
  return provenance.symbol.getName() === "globalThis" &&
      selector.kind === "property" &&
      remaining.length === 0
    ? new Set([selector.name ?? UNKNOWN_AMBIENT_GLOBAL])
    : new Set([UNKNOWN_AMBIENT_GLOBAL]);
};

const ambientGlobalNamesAtPathIn = (
  sf: SourceFile,
  node: Node | undefined,
  path: readonly ProvenanceSelector[],
  seen: Set<MorphSymbol>,
  uncertain = false,
): ReadonlySet<string> => {
  if (uncertain) return new Set([UNKNOWN_AMBIENT_GLOBAL]);
  if (path.length === 0) return ambientGlobalNamesIn(sf, node, seen);
  const expression = unwrapExpression(node);
  if (Node.isConditionalExpression(expression)) {
    return new Set([
      ...ambientGlobalNamesAtPathIn(
        sf,
        expression.getWhenTrue(),
        path,
        seen,
      ),
      ...ambientGlobalNamesAtPathIn(
        sf,
        expression.getWhenFalse(),
        path,
        seen,
      ),
    ]);
  }
  if (
    Node.isBinaryExpression(expression) &&
    PROVENANCE_CHOICE_OPERATORS.has(
      expression.getOperatorToken().getKind(),
    )
  ) {
    return new Set([
      ...ambientGlobalNamesAtPathIn(sf, expression.getLeft(), path, seen),
      ...ambientGlobalNamesAtPathIn(sf, expression.getRight(), path, seen),
    ]);
  }
  if (Node.isIdentifier(expression)) {
    const symbol = expression.getSymbol();
    if (symbol !== undefined) {
      return ambientNamesForSymbolAtPathIn(sf, symbol, path, seen);
    }
  }
  const selector = path[0];
  if (selector === undefined) return ambientGlobalNamesIn(sf, node, seen);
  const remaining = path.slice(1);
  if (
    selector.kind === "property" &&
    Node.isObjectLiteralExpression(expression)
  ) {
    if (selector.name === null) {
      return new Set([UNKNOWN_AMBIENT_GLOBAL]);
    }
    const names = new Set<string>();
    let uncertainProperty = false;
    for (const property of expression.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        uncertainProperty = true;
        continue;
      }
      const name = Node.isShorthandPropertyAssignment(property)
        ? property.getName()
        : Node.isPropertyNamed(property)
          ? propertyNameIn(
              sf,
              property.getNameNode(),
              property.getName(),
            )
          : null;
      if (name === null) {
        uncertainProperty = true;
        continue;
      }
      if (name !== selector.name) continue;
      if (Node.isShorthandPropertyAssignment(property)) {
        const valueSymbol =
          property.getValueSymbol() ??
          property.getNameNode().getSymbol();
        if (valueSymbol === undefined) {
          names.add(UNKNOWN_AMBIENT_GLOBAL);
        } else {
          for (const ambientName of ambientNamesForSymbolAtPathIn(
            sf,
            valueSymbol,
            remaining,
            seen,
          )) {
            names.add(ambientName);
          }
        }
      } else if (Node.isPropertyAssignment(property)) {
        for (const ambientName of ambientGlobalNamesAtPathIn(
          sf,
          property.getInitializer(),
          remaining,
          seen,
        )) {
          names.add(ambientName);
        }
      }
    }
    if (uncertainProperty) names.add(UNKNOWN_AMBIENT_GLOBAL);
    return names;
  }
  if (
    selector.kind === "index" &&
    Node.isArrayLiteralExpression(expression)
  ) {
    const elements = expression.getElements();
    if (
      selector.index < 0 ||
      elements
        .slice(0, selector.index + 1)
        .some(Node.isSpreadElement)
    ) {
      return new Set([UNKNOWN_AMBIENT_GLOBAL]);
    }
    const selected = elements[selector.index];
    return selected === undefined || Node.isOmittedExpression(selected)
      ? new Set()
      : ambientGlobalNamesAtPathIn(sf, selected, remaining, seen);
  }
  if (Node.isNewExpression(expression)) {
    const names = new Set<string>();
    for (const source of classInstanceValueSourcesAtPathIn(
      expression,
      path,
    )) {
      for (const name of ambientGlobalNamesAtPathIn(
        source.receiver.getSourceFile(),
        source.receiver,
        source.remaining,
        seen,
        source.uncertain,
      )) {
        names.add(name);
      }
    }
    if (names.size > 0) return names;
  }
  const receivers = ambientGlobalNamesIn(sf, expression, seen);
  if (selector.kind === "property") {
    if (
      receivers.has("globalThis") ||
      receivers.has(UNKNOWN_AMBIENT_GLOBAL)
    ) {
      return new Set([
        selector.name ?? UNKNOWN_AMBIENT_GLOBAL,
      ]);
    }
    const type = expression?.getType();
    if (type?.isAny() || type?.isUnknown()) {
      return new Set([UNKNOWN_AMBIENT_GLOBAL]);
    }
  }
  return new Set();
};

const functionReturnSourcesIn = (
  call: Node,
): {
  readonly sources: readonly AmbientAliasSource[];
  readonly unresolved: boolean;
} => {
  if (!Node.isCallExpression(call)) {
    return { sources: [], unresolved: true };
  }
  const callee = unwrapExpression(call.getExpression());
  const declarations: Node[] = [];
  const declarationKeys = new Set<object>();
  const addDeclaration = (declaration: Node): void => {
    const key = declaration.compilerNode as object;
    if (declarationKeys.has(key)) return;
    declarationKeys.add(key);
    if (Node.isFunctionLikeDeclaration(declaration)) {
      declarations.push(declaration);
      return;
    }
    if (
      Node.isVariableDeclaration(declaration) ||
      Node.isPropertyAssignment(declaration) ||
      Node.isPropertyDeclaration(declaration)
    ) {
      const initializer = unwrapExpression(declaration.getInitializer());
      if (Node.isFunctionLikeDeclaration(initializer)) {
        addDeclaration(initializer);
      }
      return;
    }
    if (Node.isShorthandPropertyAssignment(declaration)) {
      const valueSymbol = declaration.getValueSymbol();
      for (const nested of valueSymbol?.getDeclarations() ?? []) {
        addDeclaration(nested);
      }
    }
  };
  const addSymbolDeclarations = (symbol: MorphSymbol | undefined): void => {
    const target = symbol === undefined ? undefined : resolvedAliasedSymbol(symbol);
    for (const declaration of target?.getDeclarations() ?? []) {
      addDeclaration(declaration);
    }
  };
  if (Node.isFunctionLikeDeclaration(callee)) {
    addDeclaration(callee);
  } else {
    addSymbolDeclarations(callee?.getSymbol());
    if (declarations.length === 0) {
      for (const signature of callee?.getType().getCallSignatures() ?? []) {
        const declaration = signature.getDeclaration();
        if (declaration !== undefined) addDeclaration(declaration);
      }
    }
  }
  return callableReturnSourcesIn(declarations);
};

function ambientGlobalNamesIn(
  sf: SourceFile,
  node: Node | undefined,
  seen: Set<MorphSymbol> = new Set(),
): ReadonlySet<string> {
  const expression = unwrapExpression(node);
  const heritage = classExtendsExpression(expression);
  if (heritage !== undefined) {
    return ambientGlobalNamesIn(sf, heritage, seen);
  }
  if (Node.isConditionalExpression(expression)) {
    return new Set([
      ...ambientGlobalNamesIn(sf, expression.getWhenTrue(), seen),
      ...ambientGlobalNamesIn(sf, expression.getWhenFalse(), seen),
    ]);
  }
  if (
    Node.isBinaryExpression(expression) &&
    PROVENANCE_CHOICE_OPERATORS.has(
      expression.getOperatorToken().getKind(),
    )
  ) {
    return new Set([
      ...ambientGlobalNamesIn(sf, expression.getLeft(), seen),
      ...ambientGlobalNamesIn(sf, expression.getRight(), seen),
    ]);
  }
  if (
    Node.isPropertyAccessExpression(expression) ||
    Node.isElementAccessExpression(expression)
  ) {
    const candidates = selectorCandidatesForAccessIn(sf, expression);
    const names = new Set<string>();
    for (const selector of candidates.selectors) {
      for (const name of ambientGlobalNamesAtPathIn(
        sf,
        expression.getExpression(),
        [selector],
        seen,
      )) {
        names.add(name);
      }
    }
    if (candidates.unresolved) {
      for (const name of ambientGlobalNamesAtPathIn(
        sf,
        expression.getExpression(),
        [{ kind: "property", name: null }],
        seen,
      )) {
        names.add(name);
      }
    }
    return names;
  }
  if (Node.isCallExpression(expression)) {
    const callee = unwrapExpression(expression.getExpression());
    if (
      Node.isPropertyAccessExpression(callee) &&
      callee.getName() === "assign" &&
      ambientGlobalNamesIn(sf, callee.getExpression(), seen).has("Object")
    ) {
      return new Set(
        expression.getArguments().flatMap((argument) => [
          ...ambientGlobalNamesIn(sf, argument, seen),
        ]),
      );
    }
    const returns = functionReturnSourcesIn(expression);
    const names = new Set<string>();
    for (const source of returns.sources) {
      for (const name of ambientGlobalNamesAtPathIn(
        source.receiver.getSourceFile(),
        source.receiver,
        source.selectors,
        seen,
        source.uncertain === true,
      )) {
        names.add(name);
      }
    }
    if (returns.unresolved) names.add(UNKNOWN_AMBIENT_GLOBAL);
    return names;
  }
  if (!Node.isIdentifier(expression)) return new Set();
  const symbol = expression.getSymbol();
  return symbol === undefined
    ? new Set([expression.getText()])
    : ambientNamesForSymbolAtPathIn(sf, symbol, [], seen);
}

const propertyNameIn = (
  sf: SourceFile,
  node: Node | undefined,
  fallback: string,
): string | null => {
  if (node === undefined) return fallback;
  if (Node.isIdentifier(node)) return node.getText();
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.getLiteralText();
  }
  if (Node.isComputedPropertyName(node)) {
    return literalPropertyKeyIn(sf, node.getExpression());
  }
  return null;
};

interface DestructuredMember {
  readonly name: string | null;
  /**
   * The node declaring the member, for a "declared by project source?" test.
   * Resolved lazily - type resolution is the expensive half, and only a handful
   * of member names ever ask.
   */
  readonly member: () => Node | undefined;
  readonly ambientReceiverNames: ReadonlySet<string>;
  readonly receiver: Node;
  readonly line: number;
}

/**
 * The node that DECLARES a destructured member. A shorthand binding
 * (`const { constructor } = fn`) spells no property name at all: its only name
 * node declares the new LOCAL, which is by definition project source, so reading
 * it reports every ambient member as project-declared and suppresses the finding.
 * The source property comes from the receiver's type instead.
 */
const declaredMemberNode = (
  spelled: Node | undefined,
  receiver: Node,
  name: string,
): (() => Node | undefined) => () =>
  spelled ?? receiver.getType().getProperty(name)?.getDeclarations()[0];

const destructuredPropertyNamesIn = (
  sf: SourceFile,
  node: Node | undefined,
  fallback: string,
): PropertyKeyCandidates => {
  if (node === undefined) {
    return { names: new Set([fallback]), unresolved: false };
  }
  if (Node.isComputedPropertyName(node)) {
    return propertyKeyCandidatesIn(sf, node.getExpression());
  }
  const name = propertyNameIn(sf, node, fallback);
  return name === null
    ? { names: new Set(), unresolved: true }
    : { names: new Set([name]), unresolved: false };
};

const ambientNamesForSourcesIn = (
  sf: SourceFile,
  sources: readonly AmbientAliasSource[],
): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const source of sources) {
    const sourceNames = ambientGlobalNamesAtPathIn(
      sf,
      source.receiver,
      source.selectors,
      new Set(),
      source.uncertain === true,
    );
    for (const name of sourceNames) {
      names.add(name);
    }
  }
  return names;
};

/**
 * Every `{ member }` / `{ member: alias }` / `{ ["member"]: alias }` binding, from
 * BOTH declaration patterns and `=` assignment patterns. The member name resolves
 * through the same provenance authority a computed or aliased key needs - reading
 * the key node's TEXT would spell a computed key `[member]` and never match.
 */
const destructuredMembersIn = (sf: SourceFile): DestructuredMember[] => {
  const members: DestructuredMember[] = [];
  for (const binding of sf.getDescendantsOfKind(
    SyntaxKind.ObjectBindingPattern,
  )) {
    for (const element of binding.getElements()) {
      const propertyNameNode = element.getPropertyNameNode();
      const names = destructuredPropertyNamesIn(
        sf,
        propertyNameNode,
        element.getName(),
      );
      const valueSources = bindingElementSourcesIn(
        sf,
        element,
        element.getStart(),
      );
      const receiverSources = valueSources.flatMap((source) =>
        source.selectors.length === 0
          ? []
          : [{
              ...source,
              selectors: source.selectors.slice(0, -1),
            }],
      );
      const receiver = receiverSources[0]?.receiver;
      if (receiver === undefined) continue;
      const ambientReceiverNames = ambientNamesForSourcesIn(
        sf,
        receiverSources,
      );
      for (const name of names.names) {
        members.push({
          name,
          member: declaredMemberNode(propertyNameNode, receiver, name),
          ambientReceiverNames,
          receiver,
          line: element.getStartLineNumber(),
        });
      }
      if (names.unresolved) {
        members.push({
          name: null,
          member: () => undefined,
          ambientReceiverNames,
          receiver,
          line: element.getStartLineNumber(),
        });
      }
    }
  }
  for (const assignment of sf.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  )) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) {
      continue;
    }
    const binding = unwrapExpression(assignment.getLeft());
    if (!Node.isObjectLiteralExpression(binding)) continue;
    const collect = (
      pattern: Node,
      receiverSources: readonly AmbientAliasSource[],
    ): void => {
      const current = unwrapExpression(pattern);
      if (Node.isBinaryExpression(current)) {
        if (current.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
          collect(current.getLeft(), receiverSources);
          collect(current.getLeft(), [{
            at: current.getStart(),
            receiver: current.getRight(),
            selectors: [],
          }]);
        }
        return;
      }
      if (!Node.isObjectLiteralExpression(current)) return;
      const ambientReceiverNames = ambientNamesForSourcesIn(
        sf,
        receiverSources,
      );
      for (const property of current.getProperties()) {
        if (
          !Node.isPropertyAssignment(property) &&
          !Node.isShorthandPropertyAssignment(property)
        ) {
          continue;
        }
        const nameNode = property.getNameNode();
        const names = destructuredPropertyNamesIn(
          sf,
          nameNode,
          property.getName(),
        );
        const receiver = receiverSources[0]?.receiver;
        if (receiver === undefined) continue;
        for (const name of names.names) {
          members.push({
            name,
            member: declaredMemberNode(
              Node.isPropertyAssignment(property) ? nameNode : undefined,
              receiver,
              name,
            ),
            ambientReceiverNames,
            receiver,
            line: property.getStartLineNumber(),
          });
        }
        if (names.unresolved) {
          members.push({
            name: null,
            member: () => undefined,
            ambientReceiverNames,
            receiver,
            line: property.getStartLineNumber(),
          });
        }
        if (!Node.isPropertyAssignment(property)) continue;
        const selectedSources = receiverSources.flatMap((source) => [
          ...[...names.names].map((name) => ({
            ...source,
            selectors: [
              ...source.selectors,
              { kind: "property" as const, name },
            ],
          })),
          ...(names.unresolved
            ? [{
                ...source,
                selectors: [
                  ...source.selectors,
                  { kind: "property" as const, name: null },
                ],
                uncertain: true,
              }]
            : []),
        ]);
        collect(property.getInitializerOrThrow(), selectedSources);
      }
    };
    collect(binding, [{
      at: assignment.getStart(),
      receiver: assignment.getRight(),
      selectors: [],
    }]);
  }
  return members;
};

/** Every module reference, including non-literal dynamic import/require calls. */
export function moduleReferences(sf: SourceFile): ModuleReference[] {
  const sourceText = sf.getFullText();
  const cached = MODULE_REFERENCE_CACHE.get(sf);
  if (cached?.sourceText === sourceText) {
    return [...cached.references];
  }
  const refs: ModuleReference[] = [];
  const isDeclaredLocally = (node: Node): boolean =>
    node.getSymbol()?.getDeclarations().some(
      (declaration) => declaration.getSourceFile() === sf,
    ) ?? false;
  /**
   * An identifier spelled `require` only names a loader in VALUE position. A member
   * name (`cfg.require`), an object key, a declared member, or a destructuring
   * property name is an ordinary property that merely shares the spelling - and it
   * resolves into whichever module declares that property, so a "declared in THIS
   * file?" test reports every cross-module one as a CommonJS loader.
   */
  const isMemberNamePosition = (identifier: Node): boolean => {
    const parent = identifier.getParent();
    if (parent === undefined || Node.isShorthandPropertyAssignment(parent)) return false;
    if (Node.isQualifiedName(parent)) return parent.getRight() === identifier;
    if (Node.isBindingElement(parent)) {
      return parent.getPropertyNameNode() === identifier || parent.getNameNode() === identifier;
    }
    if (Node.isPropertyAccessExpression(parent)) return parent.getNameNode() === identifier;
    return Node.isPropertyNamed(parent) && parent.getNameNode() === identifier;
  };
  const destructuredMembers = (): DestructuredMember[] =>
    destructuredMembersIn(sf);
  const propertyKeyCandidates = (
    node: Node | undefined,
  ): PropertyKeyCandidates => propertyKeyCandidatesIn(sf, node);
  /**
   * A name this project never declares - `module`, `globalThis`, an ambient
   * global - reached as a bare name OR through the `globalThis` namespace. Shared
   * with the contracts capability scan so the two cannot disagree on a spelling.
   */
  const isAmbientGlobalReference = (node: Node | undefined): boolean =>
    ambientGlobalNamesIn(sf, node).size > 0;
  const hasAmbientGlobalName = (
    node: Node | undefined,
    name: string,
    knownNames?: ReadonlySet<string>,
  ): boolean => {
    const names = knownNames ?? ambientGlobalNamesIn(sf, node);
    return names.has(name) || names.has(UNKNOWN_AMBIENT_GLOBAL);
  };
  /**
   * A `require` MEMBER is the CommonJS loader only when it hangs off an ambient
   * global, or when the member itself is declared ambiently (`const m = module;
   * m.require(…)`). A member declared by project source - or none at all, which is
   * every access through a receiver typed `any` - is somebody's own property.
   */
  const isAmbientRequireMember = (
    receiver: Node | undefined,
    member: () => Node | undefined,
    ambientReceiverNames?: ReadonlySet<string>,
  ): boolean => {
    if (
      ambientReceiverNames?.size !== undefined
        ? ambientReceiverNames.size > 0
        : isAmbientGlobalReference(receiver)
    ) {
      return true;
    }
    const declarations = member()?.getSymbol()?.getDeclarations() ?? [];
    return (
      declarations.length > 0 &&
      declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile())
    );
  };
  const loaderSpecifier = (node: Node | undefined): string | null => {
    const expression = unwrapExpression(node);
    if (!Node.isCallExpression(expression)) return null;
    const callee = unwrapExpression(expression.getExpression());
    if (callee === undefined) return null;
    if (
      callee.getKind() !== SyntaxKind.ImportKeyword &&
      (callee.getText() !== "require" || isDeclaredLocally(callee))
    ) {
      return null;
    }
    const argument = expression.getArguments()[0];
    return argument &&
      (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
      ? argument.getLiteralText()
      : null;
  };
  const isNodeModuleSpecifier = (specifier: string | null): boolean =>
    specifier === "module" || specifier === "node:module";
  const isNodeModuleNamespaceSymbol = (symbol: MorphSymbol): boolean =>
    [...new Set([symbol, resolvedAliasedSymbol(symbol)])].some((candidate) =>
      candidate.getDeclarations().some((declaration) => {
        const importDeclaration = declaration.getFirstAncestorByKind(
          SyntaxKind.ImportDeclaration,
        );
        return importDeclaration !== undefined &&
          isNodeModuleSpecifier(importDeclaration.getModuleSpecifierValue()) &&
          (Node.isNamespaceImport(declaration) ||
            Node.isImportClause(declaration));
      })
    );
  for (const imp of sf.getImportDeclarations()) {
    refs.push({ specifier: imp.getModuleSpecifierValue(), line: imp.getStartLineNumber(), kind: "import" });
  }
  const createRequireNamespaces = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    if (!isNodeModuleSpecifier(imp.getModuleSpecifierValue())) continue;
    const namespace = imp.getNamespaceImport();
    const defaultImport = imp.getDefaultImport();
    if (namespace) createRequireNamespaces.add(namespace.getText());
    if (defaultImport) createRequireNamespaces.add(defaultImport.getText());
    for (const named of imp.getNamedImports()) {
      if (named.getName() !== "createRequire") continue;
      refs.push({
        specifier: null,
        line: named.getStartLineNumber(),
        kind: "create-require",
      });
    }
  }
  const expressionProvenance = (
    node: Node | undefined,
    seen: Set<Node> = new Set(),
  ): Node | undefined => expressionProvenanceIn(sf, node, seen);
  const literalPropertyKey = (node: Node | undefined): string | null =>
    literalPropertyKeyIn(sf, node);
  const mayBePropertyKey = (
    node: Node | undefined,
    expected: string,
  ): boolean => {
    const candidates = propertyKeyCandidatesIn(sf, node);
    return candidates.unresolved || candidates.names.has(expected);
  };
  const propertyName = (
    node: Node | undefined,
    fallback: string,
  ): string | null => propertyNameIn(sf, node, fallback);
  const expressionSources = (
    node: Node | undefined,
    seen: ReadonlySet<object> = new Set(),
  ): Node[] => {
    const expression = unwrapExpression(node);
    if (!expression) return [];
    if (Node.isConditionalExpression(expression)) {
      return [
        ...expressionSources(expression.getWhenTrue(), seen),
        ...expressionSources(expression.getWhenFalse(), seen),
      ];
    }
    if (Node.isBinaryExpression(expression)) {
      const operator = expression.getOperatorToken().getKind();
      if (operator === SyntaxKind.CommaToken) {
        return expressionSources(expression.getRight(), seen);
      }
      if (
        operator === SyntaxKind.BarBarToken ||
        operator === SyntaxKind.AmpersandAmpersandToken ||
        operator === SyntaxKind.QuestionQuestionToken
      ) {
        return [
          ...expressionSources(expression.getLeft(), seen),
          ...expressionSources(expression.getRight(), seen),
        ];
      }
    }
    if (!Node.isIdentifier(expression)) return [expression];
    const symbol = expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return [expression];
    const nested = new Set(seen).add(key);
    const bindingSources = (declaration: Node): Node[] => {
      if (!Node.isBindingElement(declaration)) return [];
      const pattern = declaration.getParent();
      const owner = pattern.getParent();
      const receiver =
        Node.isVariableDeclaration(owner) ||
        Node.isParameterDeclaration(owner)
          ? owner.getInitializer()
          : undefined;
      if (!receiver) return [];
      if (Node.isArrayBindingPattern(pattern)) {
        const index = pattern.getElements().findIndex((element) =>
          element === declaration
        );
        if (index < 0) return [];
        return expressionSources(receiver, nested).flatMap((source) => {
          const value = unwrapExpression(source);
          if (!Node.isArrayLiteralExpression(value)) return [];
          const element = value.getElements()[index];
          return element && !Node.isOmittedExpression(element) ? [element] : [];
        });
      }
      if (!Node.isObjectBindingPattern(pattern)) return [];
      const name = propertyName(
        declaration.getPropertyNameNode(),
        declaration.getName(),
      );
      return expressionSources(receiver, nested).flatMap((source) => {
        const value = unwrapExpression(source);
        if (!Node.isObjectLiteralExpression(value)) return [];
        return value.getProperties().flatMap((property) => {
          if (
            !Node.isPropertyAssignment(property) &&
            !Node.isShorthandPropertyAssignment(property)
          ) return [];
          const candidate = propertyName(
            property.getNameNode(),
            property.getName(),
          );
          if (name !== null && candidate !== null && name !== candidate) {
            return [];
          }
          return [
            Node.isPropertyAssignment(property)
              ? property.getInitializerOrThrow()
              : property.getNameNode(),
          ];
        });
      });
    };
    const assignmentSources = sf
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter((candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < expression.getStart()
      )
      .flatMap((candidate) => {
        const left = unwrapExpression(candidate.getLeft());
        if (
          Node.isIdentifier(left) &&
          left.getSymbol() === symbol
        ) return [candidate.getRight()];
        if (Node.isArrayLiteralExpression(left)) {
          const index = left.getElements().findIndex((element) =>
            Node.isIdentifier(element) && element.getSymbol() === symbol
          );
          if (index < 0) return [];
          return expressionSources(candidate.getRight(), nested).flatMap(
            (source) => {
              const value = unwrapExpression(source);
              if (!Node.isArrayLiteralExpression(value)) return [];
              const element = value.getElements()[index];
              return element && !Node.isOmittedExpression(element)
                ? [element]
                : [];
            },
          );
        }
        return [];
      });
    const sources = [
      ...(symbol?.getDeclarations() ?? []).flatMap((declaration) => {
        if (
          Node.isVariableDeclaration(declaration) &&
          declaration.getInitializer()
        ) return [declaration.getInitializerOrThrow()];
        return bindingSources(declaration);
      }),
      ...assignmentSources,
    ];
    return sources.length > 0
      ? sources.flatMap((source) => expressionSources(source, nested))
      : [expression];
  };
  const isCreateRequireNamespaceAtPath = (
    node: Node | undefined,
    path: readonly ProvenanceSelector[],
    seen: ReadonlySet<MorphSymbol> = new Set(),
    failOnUnknown = false,
  ): boolean => {
    const expression = unwrapExpression(node);
    if (isNodeModuleSpecifier(loaderSpecifier(expression))) {
      return path.length === 0;
    }
    if (Node.isConditionalExpression(expression)) {
      return (
        isCreateRequireNamespaceAtPath(
          expression.getWhenTrue(),
          path,
          seen,
          failOnUnknown,
        ) ||
        isCreateRequireNamespaceAtPath(
          expression.getWhenFalse(),
          path,
          seen,
          failOnUnknown,
        )
      );
    }
    if (
      Node.isBinaryExpression(expression) &&
      PROVENANCE_CHOICE_OPERATORS.has(
        expression.getOperatorToken().getKind(),
      )
    ) {
      return (
        isCreateRequireNamespaceAtPath(
          expression.getLeft(),
          path,
          seen,
          failOnUnknown,
        ) ||
        isCreateRequireNamespaceAtPath(
          expression.getRight(),
          path,
          seen,
          failOnUnknown,
        )
      );
    }
    if (
      Node.isPropertyAccessExpression(expression) ||
      Node.isElementAccessExpression(expression)
    ) {
      const candidates = selectorCandidatesForAccessIn(
        expression.getSourceFile(),
        expression,
      );
      return candidates.selectors.some((selector) =>
        isCreateRequireNamespaceAtPath(
          expression.getExpression(),
          [selector, ...path],
          seen,
          failOnUnknown,
        )
      ) ||
        (candidates.unresolved &&
          isCreateRequireNamespaceAtPath(
            expression.getExpression(),
            [{ kind: "property", name: null }, ...path],
            seen,
            failOnUnknown,
          ));
    }
    if (Node.isCallExpression(expression)) {
      const callee = unwrapExpression(expression.getExpression());
      const symbol = Node.isIdentifier(callee) ? callee.getSymbol() : undefined;
      if (symbol !== undefined && seen.has(symbol)) return failOnUnknown;
      const nextSeen = symbol === undefined ? seen : new Set(seen).add(symbol);
      const returns = functionReturnSourcesIn(expression);
      return (
        (failOnUnknown && returns.unresolved) ||
        returns.sources.some(
          (source) =>
            (failOnUnknown && source.uncertain === true) ||
            isCreateRequireNamespaceAtPath(
              source.receiver,
              [...source.selectors, ...path],
              nextSeen,
              failOnUnknown,
            ),
        )
      );
    }
    const selector = path[0];
    if (
      selector?.kind === "property" &&
      Node.isObjectLiteralExpression(expression)
    ) {
      if (selector.name === null) return failOnUnknown;
      return expression.getProperties().some((property) => {
        if (Node.isSpreadAssignment(property)) {
          return isCreateRequireNamespaceAtPath(
            property.getExpression(),
            path,
            seen,
            failOnUnknown,
          );
        }
        if (
          !Node.isPropertyAssignment(property) &&
          !Node.isShorthandPropertyAssignment(property)
        ) return false;
        const name = propertyNameIn(
          expression.getSourceFile(),
          property.getNameNode(),
          property.getName(),
        );
        if (name === null) return failOnUnknown;
        if (name !== selector.name) return false;
        return isCreateRequireNamespaceAtPath(
          Node.isPropertyAssignment(property)
            ? property.getInitializer()
            : property.getNameNode(),
          path.slice(1),
          seen,
          failOnUnknown,
        );
      });
    }
    if (
      selector?.kind === "index" &&
      Node.isArrayLiteralExpression(expression)
    ) {
      const element = expression.getElements()[selector.index];
      return element !== undefined &&
        !Node.isOmittedExpression(element) &&
        !Node.isSpreadElement(element) &&
        isCreateRequireNamespaceAtPath(
          element,
          path.slice(1),
          seen,
          failOnUnknown,
        );
    }
    if (Node.isNewExpression(expression) && path.length > 0) {
      return classInstanceValueSourcesAtPathIn(
        expression,
        path,
      ).some((source) =>
        (failOnUnknown && source.uncertain) ||
        isCreateRequireNamespaceAtPath(
          source.receiver,
          source.remaining,
          seen,
          failOnUnknown,
        )
      );
    }
    if (!Node.isIdentifier(expression)) return false;
    if (
      path.length === 0 &&
      createRequireNamespaces.has(expression.getText())
    ) return true;
    const symbol = expression.getSymbol();
    if (symbol === undefined || isNodeModuleNamespaceSymbol(symbol)) {
      return symbol !== undefined && path.length === 0;
    }
    const provenance = ambientAliasSourcesAcrossModulesIn(
      expression.getSourceFile(),
      symbol,
    );
    if (seen.has(provenance.symbol)) return false;
    const sources = provenance.sources;
    if (
      failOnUnknown &&
      sources.some((source) => source.uncertain === true)
    ) {
      return true;
    }
    const nextSeen = new Set(seen).add(provenance.symbol);
    if (sources.some(
      (source) =>
        isCreateRequireNamespaceAtPath(
          source.receiver,
          [...source.selectors, ...path],
          nextSeen,
          failOnUnknown,
        ),
    )) return true;
    for (const sourceFile of provenance.sourceFiles) {
      for (const source of classStaticValueSourcesAtPathIn(
        sourceFile,
        provenance.symbol,
        path,
      )) {
        if (
          (failOnUnknown && source.uncertain) ||
          isCreateRequireNamespaceAtPath(
            source.receiver,
            source.remaining,
            nextSeen,
            failOnUnknown,
          )
        ) return true;
      }
      for (const source of containerValueSourcesAtPathIn(
        sourceFile,
        provenance.symbol,
        path,
      )) {
        if (
          (failOnUnknown && source.uncertain) ||
          isCreateRequireNamespaceAtPath(
            source.receiver,
            source.remaining,
            nextSeen,
            failOnUnknown,
          )
        ) return true;
      }
    }
    return false;
  };
  const isCreateRequireNamespaceByProvenance = (
    node: Node | undefined,
    seen: ReadonlySet<MorphSymbol> = new Set(),
    failOnUnknown = false,
  ): boolean => isCreateRequireNamespaceAtPath(
    node,
    [],
    seen,
    failOnUnknown,
  );
  const upstreamCreateRequireNamespace = (
    node: Node | undefined,
    seen: ReadonlySet<Node> = new Set(),
  ): boolean => {
    return expressionSources(node).some((expression) => {
      if (seen.has(expression)) return false;
      const visited = new Set(seen).add(expression);
      if (
        (Node.isIdentifier(expression) &&
          createRequireNamespaces.has(expression.getText())) ||
        isNodeModuleSpecifier(loaderSpecifier(expression))
      ) return true;
      if (
        Node.isPropertyAccessExpression(expression) ||
        Node.isElementAccessExpression(expression)
      ) {
        const receiver = expression.getExpression();
        const member = Node.isPropertyAccessExpression(expression)
          ? expression.getName()
          : literalPropertyKey(expression.getArgumentExpression());
        const sameReceiver = (left: Node, right: Node): boolean => {
          const leftExpression = unwrapExpression(left);
          const rightExpression = unwrapExpression(right);
          if (
            Node.isIdentifier(leftExpression) &&
            Node.isIdentifier(rightExpression)
          ) {
            return leftExpression.getSymbol() === rightExpression.getSymbol();
          }
          return leftExpression?.getText() === rightExpression?.getText();
        };
        const memberSources = (
          owner: Node,
          requested: string | null,
        ): Node[] => {
          const sources: Node[] = [];
          for (const source of expressionSources(owner)) {
            if (
              Node.isPropertyAccessExpression(source) ||
              Node.isElementAccessExpression(source)
            ) {
              const nestedMember = Node.isPropertyAccessExpression(source)
                ? source.getName()
                : literalPropertyKey(source.getArgumentExpression());
              for (const nestedSource of memberSources(
                source.getExpression(),
                nestedMember,
              )) {
                sources.push(
                  ...memberSources(nestedSource, requested),
                );
              }
              continue;
            }
            if (Node.isArrayLiteralExpression(source)) {
              const index = requested === null
                ? null
                : Number.parseInt(requested, 10);
              if (
                index !== null &&
                String(index) === requested
              ) {
                const element = source.getElements()[index];
                if (element && !Node.isOmittedExpression(element)) {
                  sources.push(element);
                }
              } else if (requested === null) {
                sources.push(
                  ...source.getElements().filter((element) =>
                    !Node.isOmittedExpression(element)
                  ),
                );
              }
              continue;
            }
            if (!Node.isObjectLiteralExpression(source)) continue;
            for (const property of source.getProperties()) {
              if (
                !Node.isPropertyAssignment(property) &&
                !Node.isShorthandPropertyAssignment(property)
              ) continue;
              const name = propertyName(
                property.getNameNode(),
                property.getName(),
              );
              if (
                requested !== null &&
                name !== null &&
                name !== requested
              ) continue;
              sources.push(
                Node.isPropertyAssignment(property)
                  ? property.getInitializerOrThrow()
                  : property.getNameNode(),
              );
            }
          }
          for (const assignment of sf.getDescendantsOfKind(
            SyntaxKind.BinaryExpression,
          )) {
            if (
              assignment.getOperatorToken().getKind() !==
                SyntaxKind.EqualsToken ||
              assignment.getStart() >= expression.getStart()
            ) continue;
            const left = unwrapExpression(assignment.getLeft());
            if (
              !Node.isPropertyAccessExpression(left) &&
              !Node.isElementAccessExpression(left)
            ) continue;
            const name = Node.isPropertyAccessExpression(left)
              ? left.getName()
              : literalPropertyKey(left.getArgumentExpression());
            if (
              !sameReceiver(left.getExpression(), owner) ||
              (requested !== null && name !== null && name !== requested)
            ) continue;
            sources.push(assignment.getRight());
          }
          return sources;
        };
        const sources = memberSources(receiver, member);
        return sources.length > 0
          ? sources.some((source) =>
            upstreamCreateRequireNamespace(source, visited)
          )
          : member === null &&
            upstreamCreateRequireNamespace(receiver, visited);
      }
      if (Node.isObjectLiteralExpression(expression)) {
        return expression.getProperties().some((property) =>
          Node.isSpreadAssignment(property) &&
          upstreamCreateRequireNamespace(property.getExpression(), visited)
        );
      }
      if (Node.isArrayLiteralExpression(expression)) {
        return expression.getElements().some((element) =>
          !Node.isOmittedExpression(element) &&
          upstreamCreateRequireNamespace(element, visited)
        );
      }
      if (Node.isCallExpression(expression)) {
        const transparent = normalizedAmbientBuiltinCall(
          expression,
          "Object",
          ["freeze", "seal", "preventExtensions"],
        );
        if (transparent) {
          return transparent.arguments === null ||
            upstreamCreateRequireNamespace(transparent.arguments[0], visited);
        }
        if (isAmbientBuiltinMethod(expression.getExpression(), "Object", "assign")) {
          return expression.getArguments().slice(1).some((argument) =>
            upstreamCreateRequireNamespace(argument, visited)
          );
        }
        if (isAmbientBuiltinMethod(expression.getExpression(), "Object", "fromEntries")) {
          return expressionSources(expression.getArguments()[0]).some((entries) =>
            Node.isCallExpression(entries) &&
            isAmbientBuiltinMethod(entries.getExpression(), "Object", "entries") &&
            upstreamCreateRequireNamespace(entries.getArguments()[0], visited)
          );
        }
      }
      return false;
    });
  };
  const isCreateRequireNamespace = (
    node: Node | undefined,
    seen: ReadonlySet<MorphSymbol> = new Set(),
    failOnUnknown = false,
  ): boolean =>
    isCreateRequireNamespaceByProvenance(node, seen, failOnUnknown) ||
    upstreamCreateRequireNamespace(node);

  const isAmbientBuiltinReference = (
    node: Node | undefined,
    builtin: "Object" | "Reflect",
  ): boolean => {
    const expression = expressionProvenance(node);
    if (
      Node.isIdentifier(expression) &&
      expression.getText() === builtin &&
      isAmbientGlobalReference(expression)
    ) {
      return true;
    }
    if (
      Node.isPropertyAccessExpression(expression) &&
      expression.getName() === builtin
    ) {
      return isAmbientGlobalReference(expression.getExpression());
    }
    if (Node.isElementAccessExpression(expression)) {
      return mayBePropertyKey(expression.getArgumentExpression(), builtin) &&
        isAmbientGlobalReference(expression.getExpression());
    }
    return false;
  };
  const isAmbientBuiltinMethod = (
    node: Node | undefined,
    builtin: "Object" | "Reflect",
    method: string,
    seen: ReadonlySet<object> = new Set(),
  ): boolean => {
    const raw = unwrapExpression(node);
    if (
      raw &&
      (
        !Node.isIdentifier(raw) ||
        (raw.getSymbol()?.getDeclarations() ?? []).some((declaration) =>
          Node.isBindingElement(declaration) &&
          Node.isArrayBindingPattern(declaration.getParent())
        )
      ) &&
      ambientBuiltinMethodName(raw, builtin, [method]) === method
    ) return true;
    if (Node.isIdentifier(raw)) {
      const symbol = raw.getSymbol();
      const key = (symbol ?? raw) as unknown as object;
      if (seen.has(key)) return false;
      const nested = new Set(seen).add(key);
      const container = raw.getFirstAncestor((ancestor) =>
        Node.isBlock(ancestor) || Node.isSourceFile(ancestor)
      );
      const isGuaranteed = (write: Node): boolean => {
        const statement = write.getFirstAncestorByKind(
          SyntaxKind.ExpressionStatement,
        );
        if (statement) return statement.getParent() === container;
        const variable = write.getFirstAncestorByKind(
          SyntaxKind.VariableStatement,
        );
        return variable?.getParent() === container;
      };
      const writes: Array<{
        readonly start: number;
        readonly guaranteed: boolean;
        readonly source?: Node;
        readonly receiver?: Node;
        readonly member?: string | null;
      }> = [];
      for (const declaration of symbol?.getDeclarations() ?? []) {
        if (
          Node.isVariableDeclaration(declaration) &&
          declaration.getInitializer()
        ) {
          writes.push({
            start: declaration.getStart(),
            guaranteed: isGuaranteed(declaration),
            source: declaration.getInitializerOrThrow(),
          });
          continue;
        }
        if (!Node.isBindingElement(declaration)) continue;
        const pattern = declaration.getParent();
        const owner = pattern.getParent();
        const receiver =
          Node.isObjectBindingPattern(pattern) &&
          (Node.isVariableDeclaration(owner) ||
            Node.isParameterDeclaration(owner))
            ? owner.getInitializer()
            : undefined;
        if (!receiver) continue;
        writes.push({
          start: declaration.getStart(),
          guaranteed: isGuaranteed(declaration),
          receiver,
          member: propertyName(
            declaration.getPropertyNameNode(),
            declaration.getName(),
          ),
        });
      }
      const simpleAssignments = sf
        .getDescendantsOfKind(SyntaxKind.BinaryExpression)
        .filter((candidate) =>
          candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
          candidate.getStart() < raw.getStart() &&
          Node.isIdentifier(unwrapExpression(candidate.getLeft())) &&
          unwrapExpression(candidate.getLeft())?.getSymbol() === symbol
        );
      writes.push(...simpleAssignments.map((assignment) => ({
        start: assignment.getStart(),
        guaranteed: isGuaranteed(assignment),
        source: assignment.getRight(),
      })));
      const destructuredAssignments = sf
        .getDescendantsOfKind(SyntaxKind.BinaryExpression)
        .filter((candidate) =>
          candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
          candidate.getStart() < raw.getStart() &&
          Node.isObjectLiteralExpression(unwrapExpression(candidate.getLeft()))
        )
        .flatMap((assignment) => {
          const object = unwrapExpression(assignment.getLeft());
          if (!Node.isObjectLiteralExpression(object)) return [];
          const property = object.getProperties().find((candidate) => {
            const bindingTarget = Node.isPropertyAssignment(candidate)
              ? unwrapExpression(candidate.getInitializer())
              : Node.isShorthandPropertyAssignment(candidate)
              ? candidate.getNameNode()
              : undefined;
            return Node.isIdentifier(bindingTarget) &&
              bindingTarget.getSymbol() === symbol;
          });
          return property ? [{ assignment, property }] : [];
        });
      writes.push(...destructuredAssignments.flatMap(({ assignment, property }) =>
        Node.isPropertyAssignment(property) ||
          Node.isShorthandPropertyAssignment(property)
          ? [{
            start: assignment.getStart(),
            guaranteed: isGuaranteed(assignment),
            receiver: assignment.getRight(),
            member: propertyName(property.getNameNode(), property.getName()),
          }]
          : []
      ));
      const baseline = writes
        .filter((write) => write.guaranteed)
        .sort((left, right) => right.start - left.start)[0];
      const reaching = writes.filter((write) =>
        !baseline || write.start >= baseline.start
      );
      return reaching.some((write) =>
        write.source
          ? isAmbientBuiltinMethod(
            write.source,
            builtin,
            method,
            nested,
          )
          : (write.member === null || write.member === method) &&
            isAmbientBuiltinReference(write.receiver, builtin)
      );
    }
    let expression = expressionProvenance(node);
    if (
      Node.isBinaryExpression(expression) &&
      expression.getOperatorToken().getKind() === SyntaxKind.CommaToken
    ) {
      expression = expressionProvenance(expression.getRight());
    }
    if (Node.isPropertyAccessExpression(expression)) {
      return expression.getName() === method &&
        isAmbientBuiltinReference(expression.getExpression(), builtin);
    }
    if (Node.isElementAccessExpression(expression)) {
      return mayBePropertyKey(expression.getArgumentExpression(), method) &&
        isAmbientBuiltinReference(expression.getExpression(), builtin);
    }
    return false;
  };
  const isReflectGet = (node: Node | undefined): boolean =>
    isAmbientBuiltinMethod(node, "Reflect", "get");
  const isPropertyDescriptorRead = (node: Node | undefined): boolean =>
    isAmbientBuiltinMethod(node, "Object", "getOwnPropertyDescriptor") ||
    isAmbientBuiltinMethod(node, "Object", "getOwnPropertyDescriptors") ||
    isAmbientBuiltinMethod(node, "Reflect", "getOwnPropertyDescriptor");
  const accessorArguments = (
    call: CallExpression,
    isAccessor: (node: Node | undefined) => boolean,
  ): readonly [Node | undefined, Node | undefined, boolean] | null => {
    const direct = call.getArguments();
    if (isAccessor(call.getExpression())) return [direct[0], direct[1], false];
    if (
      isAmbientBuiltinMethod(call.getExpression(), "Reflect", "apply") &&
      isAccessor(direct[0])
    ) {
      const applied = expressionProvenance(direct[2]);
      if (!Node.isArrayLiteralExpression(applied)) {
        return [undefined, undefined, true];
      }
      return [applied.getElements()[0], applied.getElements()[1], false];
    }
    const callee = expressionProvenance(call.getExpression());
    if (
      Node.isPropertyAccessExpression(callee) ||
      Node.isElementAccessExpression(callee)
    ) {
      const member = Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : literalPropertyKey(callee.getArgumentExpression());
      const receiver = callee.getExpression();
      if ((member === null || member === "call") && isAccessor(receiver)) {
        return [direct[1], direct[2], false];
      }
      if ((member === null || member === "apply") && isAccessor(receiver)) {
        const applied = expressionProvenance(direct[1]);
        if (!Node.isArrayLiteralExpression(applied)) {
          return [undefined, undefined, true];
        }
        return [applied.getElements()[0], applied.getElements()[1], false];
      }
    }
    if (!Node.isCallExpression(callee)) return null;
    const binder = expressionProvenance(callee.getExpression());
    if (
      !Node.isPropertyAccessExpression(binder) &&
      !Node.isElementAccessExpression(binder)
    ) return null;
    const member = Node.isPropertyAccessExpression(binder)
      ? binder.getName()
      : literalPropertyKey(binder.getArgumentExpression());
    if (
      (member !== null && member !== "bind") ||
      !isAccessor(binder.getExpression())
    ) return null;
    const effective = [...callee.getArguments().slice(1), ...direct];
    return [effective[0], effective[1], false];
  };
  for (const declaration of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = declaration.getInitializer();
    const expression = unwrapExpression(initializer);
    const initializedFromNodeModule =
      isNodeModuleSpecifier(loaderSpecifier(initializer)) ||
      (Node.isIdentifier(expression) &&
        createRequireNamespaces.has(expression.getText()));
    if (!initializedFromNodeModule) continue;
    const name = declaration.getNameNode();
    if (Node.isIdentifier(name)) {
      createRequireNamespaces.add(name.getText());
    }
  }
  /**
   * ONE loader-member table, shared by property access, element access and
   * destructuring, so a loader cannot be acquired through whichever spelling a
   * single scan's own copy of the table forgot.
   */
  const loaderMemberKind = (
    name: string | null,
    receiver: Node | undefined,
    member: () => Node | undefined,
    ambientReceiverNames?: ReadonlySet<string>,
  ): ModuleReference["kind"] | null => {
    if (
      (name === "getBuiltinModule" || name === null) &&
      (name === null
        ? (ambientReceiverNames ?? ambientGlobalNamesIn(sf, receiver))
            .has("process")
        : hasAmbientGlobalName(receiver, "process", ambientReceiverNames))
    ) {
      return "get-builtin-module";
    }
    if (
      name === "createRequire" &&
      isCreateRequireNamespace(receiver, new Set(), true)
    ) {
      return "create-require";
    }
    if (
      name === "require" &&
      isAmbientRequireMember(receiver, member, ambientReceiverNames)
    ) {
      return "require-reference";
    }
    return null;
  };
  for (const member of destructuredMembers()) {
    const kind = loaderMemberKind(
      member.name,
      member.receiver,
      member.member,
      member.ambientReceiverNames,
    );
    if (kind !== null) {
      refs.push({ specifier: null, line: member.line, kind });
    }
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    for (const accessor of [isReflectGet, isPropertyDescriptorRead]) {
      const propertyRead = accessorArguments(call, accessor);
      if (!propertyRead) continue;
      const [receiver, key, unresolved] = propertyRead;
      const memberName = literalPropertyKey(key);
      if (
        unresolved ||
        (isCreateRequireNamespace(receiver) &&
          (memberName === null || memberName === "createRequire"))
      ) {
        refs.push({
          specifier: null,
          line: call.getStartLineNumber(),
          kind: "create-require",
        });
      }
    }
  }
  const containsCreateRequireNamespace = (node: Node): boolean =>
    isCreateRequireNamespace(node) ||
    node.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => {
      const symbol = identifier.getSymbol();
      return createRequireNamespaces.has(identifier.getText()) ||
        (symbol !== undefined && isNodeModuleNamespaceSymbol(symbol));
    });
  const canHoldCreateRequireNamespace =
    createRequireNamespaces.size > 0 ||
    sf.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) =>
      isNodeModuleSpecifier(loaderSpecifier(call))
    );
  if (canHoldCreateRequireNamespace) {
    for (const statement of sf.getVariableStatements()) {
      if (!statement.isExported()) continue;
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (
          initializer !== undefined &&
          containsCreateRequireNamespace(initializer)
        ) {
          refs.push({
            specifier: null,
            line: declaration.getStartLineNumber(),
            kind: "create-require",
          });
        }
      }
    }
    for (const assignment of sf.getExportAssignments()) {
      if (containsCreateRequireNamespace(assignment.getExpression())) {
        refs.push({
          specifier: null,
          line: assignment.getStartLineNumber(),
          kind: "create-require",
        });
      }
    }
  }
  for (const exp of sf.getExportDeclarations()) {
    const v = exp.getModuleSpecifierValue();
    if (v) refs.push({ specifier: v, line: exp.getStartLineNumber(), kind: "export" });
    if (
      isNodeModuleSpecifier(v ?? null) ||
      (canHoldCreateRequireNamespace && exp.getNamedExports().some((named) =>
        named.getLocalTargetSymbol()?.getDeclarations().some(
          containsCreateRequireNamespace,
        ) === true
      ))
    ) {
      refs.push({
        specifier: null,
        line: exp.getStartLineNumber(),
        kind: "create-require",
      });
    }
  }
  for (const ref of sf.getTypeReferenceDirectives()) {
    refs.push({
      specifier: ref.getFileName(),
      line: sf.getLineAndColumnAtPos(ref.getPos()).line,
      kind: "reference-types",
    });
  }
  for (const ref of sf.getPathReferenceDirectives()) {
    refs.push({
      specifier: ref.getFileName(),
      line: sf.getLineAndColumnAtPos(ref.getPos()).line,
      kind: "reference-path",
    });
  }
  for (const ref of sf.getLibReferenceDirectives()) {
    refs.push({
      specifier: ref.getFileName(),
      line: sf.getLineAndColumnAtPos(ref.getPos()).line,
      kind: "reference-lib",
    });
  }
  const jsx = sf.forEachDescendant((node) =>
    Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node) || Node.isJsxFragment(node)
      ? node
      : undefined,
  );
  if (jsx) {
    refs.push({
      specifier: "react/jsx-runtime",
      line: jsx.getStartLineNumber(),
      kind: "implicit-jsx-runtime",
    });
  }
  for (const imp of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    const moduleRef = imp.getModuleReference();
    if (!Node.isExternalModuleReference(moduleRef)) continue;
    const expression = moduleRef.getExpression();
    refs.push({
      specifier:
        Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)
          ? expression.getLiteralText()
          : null,
      line: imp.getStartLineNumber(),
      kind: "import-equals",
    });
  }
  for (const imp of sf.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const argument = imp.getArgument();
    const literal = Node.isLiteralTypeNode(argument) ? argument.getLiteral() : undefined;
    refs.push({
      specifier:
        literal && (Node.isStringLiteral(literal) || Node.isNoSubstitutionTemplateLiteral(literal))
          ? literal.getLiteralText()
          : null,
      line: imp.getStartLineNumber(),
      kind: "import-type",
    });
  }
  const directRequireStarts = new Set<number>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() === SyntaxKind.ImportKeyword) {
      const arg = call.getArguments()[0];
      refs.push({
        specifier: arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) ? arg.getLiteralText() : null,
        line: call.getStartLineNumber(),
        kind: "dynamic-import",
      });
    }
    if (expr.getText() === "require") {
      directRequireStarts.add(expr.getStart());
      if (isDeclaredLocally(expr)) continue;
      const arg = call.getArguments()[0];
      refs.push({
        specifier: arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) ? arg.getLiteralText() : null,
        line: call.getStartLineNumber(),
        kind: "require",
      });
    }
  }
  for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const kind = loaderMemberKind(
      access.getName(),
      access.getExpression(),
      () => access.getNameNode(),
    );
    if (kind !== null) {
      refs.push({ specifier: null, line: access.getStartLineNumber(), kind });
    }
  }
  for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (
      identifier.getText() === "require" &&
      !directRequireStarts.has(identifier.getStart()) &&
      !isMemberNamePosition(identifier) &&
      !isDeclaredLocally(identifier)
    ) {
      refs.push({
        specifier: null,
        line: identifier.getStartLineNumber(),
        kind: "require-reference",
      });
    }
  }
  for (const access of sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const argument = access.getArgumentExpression();
    const members = propertyKeyCandidates(argument);
    for (const memberName of members.names) {
      const kind = loaderMemberKind(
        memberName,
        access.getExpression(),
        () => argument,
      );
      if (kind !== null) {
        refs.push({ specifier: null, line: access.getStartLineNumber(), kind });
      }
    }
    if (members.unresolved) {
      const kind = loaderMemberKind(
        null,
        access.getExpression(),
        () => argument,
      );
      if (kind !== null) {
        refs.push({ specifier: null, line: access.getStartLineNumber(), kind });
      }
    }
    // An UNRESOLVABLE key on a node:module namespace is createRequire-or-worse.
    if (members.unresolved && isCreateRequireNamespace(access.getExpression())) {
      refs.push({
        specifier: null,
        line: access.getStartLineNumber(),
        kind: "create-require",
      });
    }
  }
  MODULE_REFERENCE_CACHE.set(sf, { sourceText, references: refs });
  return [...refs];
}

export interface LayerViolation {
  file: string;
  line: number;
  specifier: string;
  fromLayer: Layer;
  toLayer: Layer | "unresolved";
}

/**
 * Core dependency-rule detector. Runs over any ts-morph Project so the companion
 * can feed it a synthetic violating project. Rule: an importer at layer L may
 * only import layers with rank <= rank(L) (dependencies point inward).
 */
export function detectLayerViolations(project: Project): LayerViolation[] {
  const violations: LayerViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    const fromLayer = layerOfPath(filePath);
    if (!fromLayer) continue;
    for (const ref of moduleReferences(sf)) {
      if (ref.specifier === null) {
        if (fromLayer !== "app") {
          violations.push({
            file: relative(REPO_ROOT, filePath),
            line: ref.line,
            specifier: `<non-literal ${ref.kind}>`,
            fromLayer,
            toLayer: "unresolved",
          });
        }
        continue;
      }
      const classification = classifySpecifier(project, filePath, ref.specifier);
      if (classification.kind === "external") continue;
      if (classification.kind === "local-unclassified") {
        violations.push({
          file: relative(REPO_ROOT, filePath),
          line: ref.line,
          specifier: ref.specifier,
          fromLayer,
          toLayer: "unresolved",
        });
        continue;
      }
      const toLayer = classification.layer;
      if (RANK[toLayer] > RANK[fromLayer]) {
        violations.push({
          file: relative(REPO_ROOT, filePath),
          line: ref.line,
          specifier: ref.specifier,
          fromLayer,
          toLayer,
        });
      }
    }
  }
  return violations;
}

export interface ContractsExternalImportViolation {
  file: string;
  line: number;
  specifier: string;
}

/**
 * A `declare const Brand: unique symbol` referenced ONLY from type positions is the
 * nominal-brand idiom the sealed security types are built from — not a platform
 * dependency. It has no runtime value and nothing resolves it at run time; the thing
 * this rule exists to refuse is a `declare const fetch: …` the module then CALLS,
 * and that one is referenced in a VALUE position, so it still fails.
 */
function isTypeOnlyBrand(declaration: VariableDeclaration): boolean {
  if (declaration.getTypeNode()?.getText().replace(/\s+/g, " ").trim() !== "unique symbol") {
    return false;
  }
  const nameNode = declaration.getNameNode();
  return declaration.findReferencesAsNodes().every((reference) =>
    reference === nameNode ||
    reference.getAncestors().some((ancestor) =>
      Node.isInterfaceDeclaration(ancestor) ||
      Node.isTypeAliasDeclaration(ancestor) ||
      ts.isTypeNode(ancestor.compilerNode)
    )
  );
}

function ambientContractDeclarations(sf: SourceFile): Array<{ line: number; name: string }> {
  const declarations: Array<{ line: number; name: string }> = [];
  for (const statement of sf.getStatements()) {
    const modifiers = ts.canHaveModifiers(statement.compilerNode)
      ? ts.getModifiers(statement.compilerNode)
      : undefined;
    const ambient =
      sf.isDeclarationFile() ||
      modifiers?.some((modifier) => modifier.kind === SyntaxKind.DeclareKeyword) === true;
    if (!ambient) continue;
    if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) {
        if (isTypeOnlyBrand(declaration)) continue;
        declarations.push({
          line: declaration.getStartLineNumber(),
          name: declaration.getName(),
        });
      }
    } else if (
      Node.isFunctionDeclaration(statement) ||
      Node.isClassDeclaration(statement) ||
      Node.isEnumDeclaration(statement)
    ) {
      declarations.push({
        line: statement.getStartLineNumber(),
        name: statement.getName() ?? "<anonymous>",
      });
    } else if (Node.isModuleDeclaration(statement)) {
      declarations.push({
        line: statement.getStartLineNumber(),
        name: statement.getName(),
      });
    }
  }
  return declarations;
}

type ContractCapabilityReference = {
  readonly line: number;
  readonly specifier:
    | "<dynamic-code capability>"
    | "<nondeterministic platform-global>";
};

function contractCapabilityReferences(
  sf: SourceFile,
): ContractCapabilityReference[] {
  const dateTimeFormatMethodNames = new Set([
    "format",
    "formatRange",
    "formatRangeToParts",
    "formatToParts",
    "resolvedOptions",
  ]);
  const dateHostTimeMethodNames = new Set([
    "getDate",
    "getDay",
    "getFullYear",
    "getHours",
    "getMilliseconds",
    "getMinutes",
    "getMonth",
    "getSeconds",
    "getTimezoneOffset",
    "getYear",
    "setDate",
    "setFullYear",
    "setHours",
    "setMilliseconds",
    "setMinutes",
    "setMonth",
    "setSeconds",
    "setYear",
    "toDateString",
    "toLocaleDateString",
    "toLocaleString",
    "toLocaleTimeString",
    "toString",
    "toTimeString",
  ]);
  const intlInstanceNames = new Set([
    "Collator",
    "DateTimeFormat",
    "DisplayNames",
    "DurationFormat",
    "ListFormat",
    "Locale",
    "NumberFormat",
    "PluralRules",
    "RelativeTimeFormat",
    "Segmenter",
    "Segments",
  ]);
  type DateTimeFormatMethodCapability = {
    readonly boundArguments: readonly Node[] | null;
  };
  const dateTimeFormatMethodCache = new Map<
    MorphSymbol,
    Map<string, readonly DateTimeFormatMethodCapability[]>
  >();
  const expressionProvenance = (
    node: Node | undefined,
    seen: Set<Node> = new Set(),
  ): Node | undefined =>
    expressionProvenanceIn(node?.getSourceFile() ?? sf, node, seen);
  const memberNameCandidates = (
    access: Node,
  ): PropertyKeyCandidates =>
    memberNameCandidatesIn(access.getSourceFile(), access);
  /**
   * A platform global this project never declares, reached EITHER as a bare name
   * (`Date`) or through the `globalThis` namespace (`globalThis.Date`,
   * `globalThis["Date"]`) - the two spellings must not disagree, so both the
   * loader scan and this one ask the SAME authority.
   */
  const isAmbientGlobal = (node: Node | undefined, name: string): boolean =>
    ambientGlobalNamesIn(node?.getSourceFile() ?? sf, node).has(name) ||
    ambientGlobalNamesIn(node?.getSourceFile() ?? sf, node).has(
      UNKNOWN_AMBIENT_GLOBAL,
    );
  const isKnownAmbientGlobal = (
    node: Node | undefined,
    name: string,
  ): boolean => ambientGlobalNamesIn(
    node?.getSourceFile() ?? sf,
    node,
  ).has(name);
  const hasAmbientName = (
    node: Node | undefined,
    name: string,
    knownNames?: ReadonlySet<string>,
  ): boolean =>
    knownNames === undefined
      ? isAmbientGlobal(node, name)
      : knownNames.has(name) || knownNames.has(UNKNOWN_AMBIENT_GLOBAL);
  const hasKnownAmbientName = (
    node: Node | undefined,
    name: string,
    knownNames?: ReadonlySet<string>,
  ): boolean =>
    knownNames === undefined
      ? isKnownAmbientGlobal(node, name)
      : knownNames.has(name);
  /**
   * The member node, resolved through the SAME provenance authority that named it -
   * an aliased computed key (`obj[key]` where `const key = "constructor"`) otherwise
   * resolves to the project-declared alias and silently suppresses the record.
   */
  const memberNodeOf = (access: Node): Node | undefined =>
    Node.isPropertyAccessExpression(access)
      ? access.getNameNode()
      : Node.isElementAccessExpression(access)
        ? expressionProvenance(access.getArgumentExpression())
        : undefined;
  const isProjectDeclaredMember = (member: () => Node | undefined): boolean =>
    member()?.getSymbol()?.getDeclarations().some((declaration) =>
      !declaration.getSourceFile().isDeclarationFile(),
    ) ?? false;
  const isFunctionLike = (node: Node | undefined): boolean => {
    const expression = expressionProvenance(node);
    if (
      Node.isArrowFunction(expression) ||
      Node.isFunctionExpression(expression) ||
      Node.isClassExpression(expression)
    ) {
      return true;
    }
    const type = expression?.getType();
    return (
      (type?.getCallSignatures().length ?? 0) > 0 ||
      (type?.getConstructSignatures().length ?? 0) > 0
    );
  };
  const hasUnprovableReceiverType = (node: Node | undefined): boolean => {
    const expression = expressionProvenance(node);
    const type = expression?.getType();
    return type === undefined || type.isAny() || type.isUnknown();
  };
  const typeHasAmbientSymbol = (
    type: Type | undefined,
    names: ReadonlySet<string>,
    seen: ReadonlySet<string> = new Set(),
  ): boolean => {
    if (type === undefined) return false;
    const key = typeKey(type);
    if (seen.has(key)) return false;
    const nextSeen = new Set(seen).add(key);
    const alternatives = type.isUnion()
      ? type.getUnionTypes()
      : type.isIntersection()
        ? type.getIntersectionTypes()
        : [];
    if (
      alternatives.some((candidate) =>
        typeHasAmbientSymbol(candidate, names, nextSeen)
      )
    ) return true;
    const symbol = type.getSymbol();
    const declarations = symbol?.getDeclarations() ?? [];
    if (symbol !== undefined &&
      names.has(symbol.getName()) &&
      declarations.length > 0 &&
      declarations.every((declaration) =>
        declaration.getSourceFile().isDeclarationFile()
      )) return true;
    return [type.getConstraint(), ...type.getBaseTypes()].some((candidate) =>
      candidate !== undefined &&
      typeHasAmbientSymbol(candidate, names, nextSeen)
    );
  };
  const typeHasPrimitiveKind = (
    type: Type | undefined,
    flags: ts.TypeFlags,
    wrapperName: string,
    seen: ReadonlySet<string> = new Set(),
  ): boolean => {
    if (type === undefined || type.isAny() || type.isUnknown()) return true;
    const key = typeKey(type);
    if (seen.has(key)) return false;
    const nextSeen = new Set(seen).add(key);
    if ((type.getFlags() & flags) !== 0) return true;
    const alternatives = type.isUnion()
      ? type.getUnionTypes()
      : type.isIntersection()
        ? type.getIntersectionTypes()
        : [];
    if (alternatives.some((candidate) =>
      typeHasPrimitiveKind(candidate, flags, wrapperName, nextSeen)
    )) return true;
    const symbol = type.getSymbol();
    const declarations = symbol?.getDeclarations() ?? [];
    if (
      symbol?.getName() === wrapperName &&
      declarations.length > 0 &&
      declarations.every((declaration) =>
        declaration.getSourceFile().isDeclarationFile()
      )
    ) return true;
    return [type.getConstraint(), ...type.getBaseTypes()].some((candidate) =>
      candidate !== undefined &&
      typeHasPrimitiveKind(candidate, flags, wrapperName, nextSeen)
    );
  };
  const isLocaleSensitivePrimitiveMethod = (
    node: Node | undefined,
    name: string,
  ): boolean => {
    const type = unwrapExpression(node)?.getType();
    if (
      (name === "localeCompare" ||
        name === "toLocaleLowerCase" ||
        name === "toLocaleUpperCase") &&
      typeHasPrimitiveKind(type, ts.TypeFlags.StringLike, "String")
    ) return true;
    return name === "toLocaleString" &&
      (typeHasPrimitiveKind(type, ts.TypeFlags.NumberLike, "Number") ||
        typeHasPrimitiveKind(type, ts.TypeFlags.BigIntLike, "BigInt"));
  };
  const isAmbientDateInstance = (node: Node | undefined): boolean =>
    typeHasAmbientSymbol(unwrapExpression(node)?.getType(), new Set(["Date"]));
  const isAmbientIntlInstance = (node: Node | undefined): boolean =>
    typeHasAmbientSymbol(
      unwrapExpression(node)?.getType(),
      intlInstanceNames,
    );
  const isPinnedDateConstruction = (
    arguments_: readonly Node[],
  ): boolean => {
    const argument = arguments_[0];
    if (
      arguments_.length !== 1 ||
      argument === undefined ||
      Node.isSpreadElement(argument)
    ) {
      return false;
    }
    const type = argument.getType();
    const candidates = type.isUnion() ? type.getUnionTypes() : [type];
    return candidates.length > 0 && candidates.every((candidate) => {
      if (candidate.isNumber() || candidate.isNumberLiteral()) return true;
      if (!candidate.isStringLiteral()) return false;
      const literal = candidate.getLiteralValue();
      return typeof literal === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          literal,
        );
    });
  };
  const isAmbientDateCandidate = (node: Node | undefined): boolean => {
    const ambientNames = ambientGlobalNamesIn(sf, node);
    if (ambientNames.has("Date")) return true;
    if (!ambientNames.has(UNKNOWN_AMBIENT_GLOBAL)) return false;
    const type = unwrapExpression(node)?.getType();
    if (type === undefined) return false;
    const candidates = type.isUnion() ? type.getUnionTypes() : [type];
    return candidates.some(
      (candidate) =>
        candidate.getCallSignatures().length > 0 &&
        candidate.getConstructSignatures().some((signature) => {
          const result = signature.getReturnType();
          return (
            result.getSymbol()?.getName() === "Date" &&
            (result.getSymbol()?.getDeclarations() ?? []).every(
              (declaration) =>
                declaration.getSourceFile().isDeclarationFile(),
            )
          );
        }),
    );
  };
  type DateInvocationCapability = {
    readonly target: Node;
    readonly method: "call" | "apply" | "bind" | "bound";
    readonly boundArguments: readonly Node[];
  };
  const dateInvocationCapabilityCache = new Map<
    MorphSymbol,
    Map<string, readonly DateInvocationCapability[]>
  >();
  const dateInvocationCapabilitiesAtPath = (
    node: Node | undefined,
    path: readonly ProvenanceSelector[] = [],
    seenSymbols: ReadonlySet<MorphSymbol> = new Set(),
  ): readonly DateInvocationCapability[] => {
    const expression = unwrapExpression(node);
    if (Node.isVariableDeclaration(expression)) {
      return dateInvocationCapabilitiesAtPath(
        expression.getInitializer(),
        path,
        seenSymbols,
      );
    }
    if (Node.isConditionalExpression(expression)) {
      return [
        ...dateInvocationCapabilitiesAtPath(
          expression.getWhenTrue(),
          path,
          seenSymbols,
        ),
        ...dateInvocationCapabilitiesAtPath(
          expression.getWhenFalse(),
          path,
          seenSymbols,
        ),
      ];
    }
    if (
      Node.isBinaryExpression(expression) &&
      PROVENANCE_CHOICE_OPERATORS.has(
        expression.getOperatorToken().getKind(),
      )
    ) {
      return [
        ...dateInvocationCapabilitiesAtPath(
          expression.getLeft(),
          path,
          seenSymbols,
        ),
        ...dateInvocationCapabilitiesAtPath(
          expression.getRight(),
          path,
          seenSymbols,
        ),
      ];
    }
    if (
      Node.isPropertyAccessExpression(expression) ||
      Node.isElementAccessExpression(expression)
    ) {
      const candidates = selectorCandidatesForAccessIn(
        expression.getSourceFile(),
        expression,
      );
      return candidates.selectors.flatMap((selector) =>
        dateInvocationCapabilitiesAtPath(
          expression.getExpression(),
          [selector, ...path],
          seenSymbols,
        )
      );
    }
    if (Node.isCallExpression(expression) && path.length === 0) {
      return dateInvocationCapabilitiesAtPath(
        expression.getExpression(),
        [],
        seenSymbols,
      ).filter((capability) => capability.method === "bind").map(
        (capability) => ({
          ...capability,
          method: "bound",
          boundArguments: [
            ...capability.boundArguments,
            ...expression.getArguments().slice(1),
          ],
        }),
      );
    }
    const selector = path[0];
    if (
      expression !== undefined &&
      selector?.kind === "property" &&
      path.length === 1 &&
      selector.name !== null &&
      ["call", "apply", "bind"].includes(selector.name) &&
      ambientGlobalNamesIn(
        expression.getSourceFile(),
        expression,
      ).has("Date")
    ) {
      return [{
        target: expression,
        method: selector.name as "call" | "apply" | "bind",
        boundArguments: [],
      }];
    }
    if (Node.isIdentifier(expression)) {
      const symbol = expression.getSymbol();
      if (symbol !== undefined) {
        const target = resolvedAliasedSymbol(symbol);
        const pathKey = path.map((candidate) =>
          candidate.kind === "property"
            ? `property:${candidate.name ?? "*"}`
            : `index:${candidate.index}`
        ).join("/");
        let byPath = dateInvocationCapabilityCache.get(target);
        if (byPath === undefined) {
          byPath = new Map();
          dateInvocationCapabilityCache.set(target, byPath);
        }
        const cached = byPath.get(pathKey);
        if (cached !== undefined) return cached;
        byPath.set(pathKey, []);
        if (!seenSymbols.has(target)) {
          const nextSeen = new Set(seenSymbols).add(target);
          const sourceFiles = [...new Set(
            target.getDeclarations()
              .map((declaration) => declaration.getSourceFile())
              .filter((sourceFile) => !sourceFile.isDeclarationFile()),
          )];
          const declarationSources = target.getDeclarations().flatMap(
            (declaration): AmbientAliasSource[] => {
              if (
                Node.isVariableDeclaration(declaration) ||
                Node.isParameterDeclaration(declaration) ||
                Node.isPropertyDeclaration(declaration) ||
                Node.isPropertyAssignment(declaration)
              ) {
                const initializer = declaration.getInitializer();
                return initializer === undefined
                  ? []
                  : [{
                    at: declaration.getStart(),
                    receiver: initializer,
                    selectors: [],
                  }];
              }
              if (Node.isExportAssignment(declaration)) {
                return [{
                  at: declaration.getStart(),
                  receiver: declaration.getExpression(),
                  selectors: [],
                }];
              }
              if (Node.isBindingElement(declaration)) {
                return bindingElementSourcesIn(
                  declaration.getSourceFile(),
                  declaration,
                  declaration.getStart(),
                );
              }
              return [];
            },
          );
          const capabilities = [
            ...moduleExportSymbolsAtPath(target, path).flatMap(
              (source) =>
                dateInvocationCapabilitiesAtPath(
                  source.symbol.getValueDeclaration(),
                  source.remaining,
                  nextSeen,
                ),
            ),
            ...declarationSources.flatMap((source) =>
              source.uncertain === true
                ? []
                : dateInvocationCapabilitiesAtPath(
                  source.receiver,
                  [...source.selectors, ...path],
                  nextSeen,
                )
            ),
            ...sourceFiles.flatMap((sourceFile) =>
              classStaticValueSourcesAtPathIn(
                sourceFile,
                target,
                path,
              ).flatMap((source) =>
                source.uncertain
                  ? []
                  : dateInvocationCapabilitiesAtPath(
                    source.receiver,
                    source.remaining,
                    nextSeen,
                  )
              )
            ),
            ...sourceFiles.flatMap((sourceFile) =>
              containerValueSourcesAtPathIn(sourceFile, target, path).flatMap(
                (source) =>
                  source.uncertain
                    ? []
                    : dateInvocationCapabilitiesAtPath(
                      source.receiver,
                      source.remaining,
                      nextSeen,
                    ),
              )
            ),
          ];
          byPath.set(pathKey, capabilities);
          return capabilities;
        }
        return [];
      }
    }
    if (Node.isNewExpression(expression) && path.length > 0) {
      const capabilities = classInstanceValueSourcesAtPathIn(
        expression,
        path,
      ).flatMap((source) =>
        source.uncertain
          ? []
          : dateInvocationCapabilitiesAtPath(
            source.receiver,
            source.remaining,
            seenSymbols,
          )
      );
      if (capabilities.length > 0) return capabilities;
    }
    return [];
  };
  const isAmbientDateTimeFormatConstructor = (
    node: Node | undefined,
    seenSymbols: ReadonlySet<MorphSymbol> = new Set(),
  ): boolean => {
    const expression = unwrapExpression(node);
    const heritage = classExtendsExpression(expression);
    if (heritage !== undefined) {
      return isAmbientDateTimeFormatConstructor(heritage, seenSymbols);
    }
    if (
      Node.isPropertyAccessExpression(expression) ||
      Node.isElementAccessExpression(expression)
    ) {
      const members = memberNameCandidates(expression);
      return (
        members.names.has("DateTimeFormat") &&
        isAmbientGlobal(expression.getExpression(), "Intl")
      );
    }
    if (Node.isConditionalExpression(expression)) {
      return (
        isAmbientDateTimeFormatConstructor(
          expression.getWhenTrue(),
          seenSymbols,
        ) ||
        isAmbientDateTimeFormatConstructor(
          expression.getWhenFalse(),
          seenSymbols,
        )
      );
    }
    if (!Node.isIdentifier(expression)) return false;
    const symbol = expression.getSymbol();
    if (symbol === undefined) return false;
    const provenance = ambientAliasSourcesAcrossModulesIn(
      expression.getSourceFile(),
      symbol,
    );
    if (seenSymbols.has(provenance.symbol)) return false;
    const nextSeen = new Set(seenSymbols).add(provenance.symbol);
    return provenance.sources.some((source) => {
      if (source.uncertain === true) return true;
      if (
        source.selectors.length === 1 &&
        source.selectors[0]?.kind === "property" &&
        source.selectors[0].name === "DateTimeFormat" &&
        isAmbientGlobal(source.receiver, "Intl")
      ) {
        return true;
      }
      return (
        source.selectors.length === 0 &&
        isAmbientDateTimeFormatConstructor(source.receiver, nextSeen)
      );
    });
  };
  const isAmbientDateTimeFormatInstance = (
    node: Node | undefined,
    seenSymbols: ReadonlySet<MorphSymbol> = new Set(),
  ): boolean => {
    const expression = unwrapExpression(node);
    if (Node.isNewExpression(expression)) {
      return isAmbientDateTimeFormatConstructor(
        expression.getExpression(),
        seenSymbols,
      );
    }
    if (Node.isCallExpression(expression)) {
      if (
        isAmbientDateTimeFormatConstructor(
          expression.getExpression(),
          seenSymbols,
        )
      ) {
        return true;
      }
      const returns = functionReturnSourcesIn(expression);
      if (returns.sources.some((source) =>
        isAmbientDateTimeFormatInstance(source.receiver, seenSymbols)
      )) {
        return true;
      }
      if (!returns.unresolved) return false;
      const type = expression.getType();
      const candidates = type.isUnion() ? type.getUnionTypes() : [type];
      return candidates.some((candidate) => {
        const symbol = candidate.getSymbol();
        const declarations = symbol?.getDeclarations() ?? [];
        return symbol?.getName() === "DateTimeFormat" &&
          declarations.length > 0 &&
          declarations.every((declaration) =>
            declaration.getSourceFile().isDeclarationFile()
          );
      });
    }
    if (Node.isConditionalExpression(expression)) {
      return (
        isAmbientDateTimeFormatInstance(
          expression.getWhenTrue(),
          seenSymbols,
        ) ||
        isAmbientDateTimeFormatInstance(
          expression.getWhenFalse(),
          seenSymbols,
        )
      );
    }
    if (!Node.isIdentifier(expression)) return false;
    const symbol = expression.getSymbol();
    if (symbol === undefined) return false;
    const provenance = ambientAliasSourcesAcrossModulesIn(
      expression.getSourceFile(),
      symbol,
    );
    if (seenSymbols.has(provenance.symbol)) return false;
    const nextSeen = new Set(seenSymbols).add(provenance.symbol);
    return provenance.sources.some(
      (source) =>
        source.uncertain === true ||
        (source.selectors.length === 0 &&
          isAmbientDateTimeFormatInstance(source.receiver, nextSeen)),
    );
  };
  function dateTimeFormatMethodCapabilitiesForSymbolAtPath(
    sourceFile: SourceFile,
    symbol: MorphSymbol,
    path: readonly ProvenanceSelector[],
    seenSymbols: ReadonlySet<MorphSymbol>,
  ): readonly DateTimeFormatMethodCapability[] {
    const provenance = ambientAliasSourcesAcrossModulesIn(
      sourceFile,
      symbol,
    );
    const pathKey = path.map((selector) =>
      selector.kind === "property"
        ? `p:${selector.name ?? "?"}`
        : `i:${selector.index}`
    ).join("/");
    const cached = dateTimeFormatMethodCache.get(provenance.symbol)?.get(
      pathKey,
    );
    if (cached !== undefined) return cached;
    if (seenSymbols.has(provenance.symbol)) return [];
    const nextSeen = new Set(seenSymbols).add(provenance.symbol);
    const capabilities = provenance.sources.flatMap((source) =>
      dateTimeFormatMethodCapabilitiesAtPath(
        source.receiver,
        [...source.selectors, ...path],
        nextSeen,
      )
    );
    for (const exported of moduleExportSymbolsAtPath(
      provenance.symbol,
      path,
    )) {
      capabilities.push(
        ...dateTimeFormatMethodCapabilitiesForSymbolAtPath(
          sourceFile,
          exported.symbol,
          exported.remaining,
          nextSeen,
        ),
      );
    }
    for (const declarationSourceFile of provenance.sourceFiles) {
      for (const source of classStaticValueSourcesAtPathIn(
        declarationSourceFile,
        provenance.symbol,
        path,
      )) {
        capabilities.push(
          ...(source.uncertain
            ? [{ boundArguments: null }]
            : dateTimeFormatMethodCapabilitiesAtPath(
              source.receiver,
              source.remaining,
              nextSeen,
            )),
        );
      }
      for (const source of containerValueSourcesAtPathIn(
        declarationSourceFile,
        provenance.symbol,
        path,
      )) {
        capabilities.push(
          ...(source.uncertain
            ? [{ boundArguments: null }]
            : dateTimeFormatMethodCapabilitiesAtPath(
              source.receiver,
              source.remaining,
              nextSeen,
            )),
        );
      }
    }
    if (seenSymbols.size === 0 || capabilities.length > 0) {
      const symbolCache = dateTimeFormatMethodCache.get(provenance.symbol) ??
        new Map();
      symbolCache.set(pathKey, capabilities);
      dateTimeFormatMethodCache.set(provenance.symbol, symbolCache);
    }
    return capabilities;
  }
  function dateTimeFormatMethodCapabilitiesAtPath(
    node: Node | undefined,
    path: readonly ProvenanceSelector[] = [],
    seenSymbols: ReadonlySet<MorphSymbol> = new Set(),
  ): readonly DateTimeFormatMethodCapability[] {
    const expression = unwrapExpression(node);
    if (Node.isConditionalExpression(expression)) {
      return [
        ...dateTimeFormatMethodCapabilitiesAtPath(
          expression.getWhenTrue(),
          path,
          seenSymbols,
        ),
        ...dateTimeFormatMethodCapabilitiesAtPath(
          expression.getWhenFalse(),
          path,
          seenSymbols,
        ),
      ];
    }
    if (
      Node.isBinaryExpression(expression) &&
      PROVENANCE_CHOICE_OPERATORS.has(
        expression.getOperatorToken().getKind(),
      )
    ) {
      return [
        ...dateTimeFormatMethodCapabilitiesAtPath(
          expression.getLeft(),
          path,
          seenSymbols,
        ),
        ...dateTimeFormatMethodCapabilitiesAtPath(
          expression.getRight(),
          path,
          seenSymbols,
        ),
      ];
    }
    if (
      Node.isPropertyAccessExpression(expression) ||
      Node.isElementAccessExpression(expression)
    ) {
      const candidates = selectorCandidatesForAccessIn(
        expression.getSourceFile(),
        expression,
      );
      return [
        ...candidates.selectors.flatMap((selector) =>
          dateTimeFormatMethodCapabilitiesAtPath(
            expression.getExpression(),
            [selector, ...path],
            seenSymbols,
          )
        ),
        ...(candidates.unresolved
          ? dateTimeFormatMethodCapabilitiesAtPath(
            expression.getExpression(),
            [{ kind: "property", name: null }, ...path],
            seenSymbols,
          )
          : []),
      ];
    }
    if (Node.isCallExpression(expression)) {
      const transparent = normalizedAmbientBuiltinCall(
        expression,
        "Object",
        ["freeze", "seal", "preventExtensions"],
      );
      if (transparent !== null) {
        const wrapped = transparent.arguments?.[0];
        return wrapped === undefined
          ? [{ boundArguments: null }]
          : dateTimeFormatMethodCapabilitiesAtPath(
            wrapped,
            path,
            seenSymbols,
          );
      }
      const callee = unwrapExpression(expression.getExpression());
      if (
        Node.isPropertyAccessExpression(callee) ||
        Node.isElementAccessExpression(callee)
      ) {
        const members = memberNameCandidates(callee);
        if (members.names.has("bind")) {
          return dateTimeFormatMethodCapabilitiesAtPath(
            callee.getExpression(),
            path,
            seenSymbols,
          ).map((capability) => ({
            boundArguments: capability.boundArguments === null
              ? null
              : [
                ...capability.boundArguments,
                ...expression.getArguments().slice(1),
              ],
          }));
        }
      }
      const returns = functionReturnSourcesIn(expression);
      const capabilities = returns.sources.flatMap((source) =>
        dateTimeFormatMethodCapabilitiesAtPath(
          source.receiver,
          [...source.selectors, ...path],
          seenSymbols,
        )
      );
      if (
        capabilities.length === 0 &&
        returns.unresolved &&
        path.length === 1 &&
        path[0]?.kind === "property" &&
        (path[0].name === null ||
          dateTimeFormatMethodNames.has(path[0].name)) &&
        isAmbientDateTimeFormatInstance(expression, seenSymbols)
      ) {
        return [{ boundArguments: null }];
      }
      return capabilities;
    }
    if (Node.isIdentifier(expression)) {
      const symbol = expression.getSymbol();
      if (symbol === undefined) return [];
      return dateTimeFormatMethodCapabilitiesForSymbolAtPath(
        expression.getSourceFile(),
        symbol,
        path,
        seenSymbols,
      );
    }
    if (Node.isNewExpression(expression) && path.length > 0) {
      const capabilities = classInstanceValueSourcesAtPathIn(
        expression,
        path,
      ).flatMap((source) =>
        source.uncertain
          ? [{ boundArguments: null }]
          : dateTimeFormatMethodCapabilitiesAtPath(
            source.receiver,
            source.remaining,
            seenSymbols,
          )
      );
      if (capabilities.length > 0) return capabilities;
    }
    const selector = path[0];
    if (selector === undefined) return [];
    const remaining = path.slice(1);
    if (
      selector.kind === "property" &&
      remaining.length === 0 &&
      (selector.name === null || dateTimeFormatMethodNames.has(selector.name)) &&
      isAmbientDateTimeFormatInstance(expression, seenSymbols)
    ) {
      return [{ boundArguments: [] }];
    }
    if (
      selector.kind === "property" &&
      Node.isObjectLiteralExpression(expression)
    ) {
      return expression.getProperties().flatMap((property) => {
        if (Node.isSpreadAssignment(property)) {
          return dateTimeFormatMethodCapabilitiesAtPath(
            property.getExpression(),
            path,
            seenSymbols,
          );
        }
        if (Node.isGetAccessorDeclaration(property)) {
          const name = propertyNameIn(
            expression.getSourceFile(),
            property.getNameNode(),
            property.getName(),
          );
          if (selector.name !== null && name !== selector.name) return [];
          const returned = callableReturnSourcesIn([property]);
          return [
            ...returned.sources.flatMap((source) =>
              dateTimeFormatMethodCapabilitiesAtPath(
                source.receiver,
                remaining,
                seenSymbols,
              )
            ),
            ...(returned.unresolved ? [{ boundArguments: null }] : []),
          ];
        }
        if (
          !Node.isPropertyAssignment(property) &&
          !Node.isShorthandPropertyAssignment(property)
        ) return [];
        const name = propertyNameIn(
          expression.getSourceFile(),
          property.getNameNode(),
          property.getName(),
        );
        if (selector.name !== null && name !== selector.name) return [];
        return dateTimeFormatMethodCapabilitiesAtPath(
          Node.isPropertyAssignment(property)
            ? property.getInitializer()
            : property.getNameNode(),
          remaining,
          seenSymbols,
        );
      });
    }
    if (selector.kind === "index" && Node.isArrayLiteralExpression(expression)) {
      const element = expression.getElements()[selector.index];
      if (
        element === undefined ||
        Node.isOmittedExpression(element) ||
        Node.isSpreadElement(element)
      ) {
        return [];
      }
      return dateTimeFormatMethodCapabilitiesAtPath(
        element,
        remaining,
        seenSymbols,
      );
    }
    return [];
  }
  const appendDateTimeFormatArguments = (
    capabilities: readonly DateTimeFormatMethodCapability[],
    arguments_: readonly Node[] | null,
  ): readonly DateTimeFormatMethodCapability[] =>
    capabilities.map((capability) => ({
      boundArguments: capability.boundArguments === null || arguments_ === null
        ? null
        : [...capability.boundArguments, ...arguments_],
    }));
  const appendDateTimeFormatArgumentSources = (
    capabilities: readonly DateTimeFormatMethodCapability[],
    argumentList: Node | undefined,
  ): readonly DateTimeFormatMethodCapability[] => {
    const alternatives = staticArrayElementAlternatives(argumentList);
    return alternatives === null
      ? appendDateTimeFormatArguments(capabilities, null)
      : alternatives.flatMap((arguments_) =>
        appendDateTimeFormatArguments(capabilities, arguments_)
      );
  };
  const dateTimeFormatInvocations = (
    call: CallExpression,
  ): readonly DateTimeFormatMethodCapability[] => {
    const reflected = normalizedAmbientBuiltinCall(call, "Reflect", ["apply"]);
    if (reflected !== null && reflected.arguments !== null) {
      const [target, , argumentList] = reflected.arguments;
      const capabilities = dateTimeFormatMethodCapabilitiesAtPath(target);
      if (capabilities.length > 0) {
        return appendDateTimeFormatArgumentSources(
          capabilities,
          argumentList,
        );
      }
    }
    const callee = unwrapExpression(call.getExpression());
    if (
      Node.isPropertyAccessExpression(callee) ||
      Node.isElementAccessExpression(callee)
    ) {
      const members = memberNameCandidates(callee);
      const wrappers = ["call", "apply", "bind"].filter((name) =>
        members.names.has(name)
      );
      const capabilities = wrappers.length > 0
        ? dateTimeFormatMethodCapabilitiesAtPath(callee.getExpression())
        : [];
      if (capabilities.length > 0 && wrappers.includes("call")) {
        return appendDateTimeFormatArguments(
          capabilities,
          call.getArguments().slice(1),
        );
      }
      if (capabilities.length > 0 && wrappers.includes("apply")) {
        return appendDateTimeFormatArgumentSources(
          capabilities,
          call.getArguments()[1],
        );
      }
      if (capabilities.length > 0 && wrappers.includes("bind")) return [];
    }
    return appendDateTimeFormatArguments(
      dateTimeFormatMethodCapabilitiesAtPath(callee),
      call.getArguments(),
    );
  };
  const references: ContractCapabilityReference[] = [];
  const seen = new Set<string>();
  const record = (
    line: number,
    specifier: ContractCapabilityReference["specifier"],
  ): void => {
    const key = `${line}:${specifier}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ line, specifier });
  };
  /**
   * ONE rule table, shared by member access and destructuring, so a capability
   * cannot be acquired through whichever spelling a single scan forgot.
   */
  const capabilityOf = (
    name: string | null,
    receiver: Node | undefined,
    member: () => Node | undefined,
    ambientReceiverNames?: ReadonlySet<string>,
  ): ContractCapabilityReference["specifier"] | null => {
    if (name === null) {
      if (
        (ambientReceiverNames ?? ambientGlobalNamesIn(sf, receiver))
          .has("Date") ||
        (ambientReceiverNames ?? ambientGlobalNamesIn(sf, receiver))
          .has("Math") ||
        (ambientReceiverNames ?? ambientGlobalNamesIn(sf, receiver))
          .has("Intl") ||
        isAmbientDateInstance(receiver) ||
        isAmbientIntlInstance(receiver)
      ) {
        return "<nondeterministic platform-global>";
      }
      if (
        (ambientReceiverNames ?? ambientGlobalNamesIn(sf, receiver))
          .has("Reflect") ||
        (ambientReceiverNames ?? ambientGlobalNamesIn(sf, receiver))
          .has("globalThis")
      ) {
        return "<dynamic-code capability>";
      }
      return null;
    }
    if (
      (name === "now" &&
        hasAmbientName(receiver, "Date", ambientReceiverNames)) ||
      (name === "parse" &&
        hasKnownAmbientName(receiver, "Date", ambientReceiverNames)) ||
      (name === "random" &&
        hasAmbientName(receiver, "Math", ambientReceiverNames)) ||
      hasKnownAmbientName(receiver, "Intl", ambientReceiverNames) ||
      (dateHostTimeMethodNames.has(name) && isAmbientDateInstance(receiver)) ||
      isAmbientIntlInstance(receiver) ||
      isLocaleSensitivePrimitiveMethod(receiver, name)
    ) {
      return "<nondeterministic platform-global>";
    }
    if (
      name === "supportedLocalesOf" &&
      isAmbientDateTimeFormatConstructor(receiver)
    ) {
      return "<nondeterministic platform-global>";
    }
    if (
      name === "get" &&
      hasAmbientName(receiver, "Reflect", ambientReceiverNames)
    ) {
      return "<dynamic-code capability>";
    }
    if (
      (name === "Function" || name === "eval") &&
      hasAmbientName(receiver, "globalThis", ambientReceiverNames)
    ) {
      return "<dynamic-code capability>";
    }
    if (
      name === "constructor" &&
      !isProjectDeclaredMember(member) &&
      (isFunctionLike(receiver) || hasUnprovableReceiverType(receiver))
    ) {
      return "<dynamic-code capability>";
    }
    return null;
  };
  const inspectMember = (access: Node, receiver: Node): void => {
    const members = memberNameCandidates(access);
    for (const name of members.names) {
      const capability = capabilityOf(
        name,
        receiver,
        () => memberNodeOf(access),
      );
      if (capability !== null) {
        record(access.getStartLineNumber(), capability);
      }
    }
    if (members.unresolved) {
      const capability = capabilityOf(
        null,
        receiver,
        () => memberNodeOf(access),
      );
      if (capability !== null) {
        record(access.getStartLineNumber(), capability);
      }
    }
  };
  for (const access of sf.getDescendantsOfKind(
    SyntaxKind.PropertyAccessExpression,
  )) {
    inspectMember(access, access.getExpression());
  }
  for (const access of sf.getDescendantsOfKind(
    SyntaxKind.ElementAccessExpression,
  )) {
    inspectMember(access, access.getExpression());
  }
  for (const member of destructuredMembersIn(sf)) {
    const capability = capabilityOf(
      member.name,
      member.receiver,
      member.member,
      member.ambientReceiverNames,
    );
    if (capability !== null) record(member.line, capability);
  }
  const isValueIdentifier = (identifier: Node): boolean => {
    if (identifier.getAncestors().some(Node.isTypeNode)) return false;
    const parent = identifier.getParent();
    if (parent === undefined) return false;
    if (Node.isShorthandPropertyAssignment(parent)) return true;
    if (
      Node.isPropertyAccessExpression(parent) &&
      parent.getNameNode() === identifier
    ) {
      return false;
    }
    return !(
      (Node.isNamed(parent) ||
        Node.isBindingNamed(parent) ||
        Node.isPropertyNamed(parent) ||
        Node.isModuleNamed(parent)) &&
      parent.getNameNode() === identifier
    );
  };
  for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (
      isValueIdentifier(identifier) &&
      (isKnownAmbientGlobal(identifier, "Function") ||
        isKnownAmbientGlobal(identifier, "eval"))
    ) {
      record(identifier.getStartLineNumber(), "<dynamic-code capability>");
    }
  }
  const inspectCall = (
    callee: Node,
    arguments_: readonly Node[] | null,
    line: number,
    construction: boolean,
  ): void => {
    if (
      isKnownAmbientGlobal(callee, "Function") ||
      isKnownAmbientGlobal(callee, "eval")
    ) {
      record(line, "<dynamic-code capability>");
    }
    if (
      (!construction ||
        arguments_ === null ||
        !isPinnedDateConstruction(arguments_)) &&
      isAmbientDateCandidate(callee)
    ) {
      record(line, "<nondeterministic platform-global>");
    }
  };
  const dateInvocationCarrierKinds = new Set([
    SyntaxKind.BindingElement,
    SyntaxKind.ExportSpecifier,
    SyntaxKind.ImportClause,
    SyntaxKind.ImportSpecifier,
    SyntaxKind.NamespaceImport,
    SyntaxKind.Parameter,
    SyntaxKind.PropertyAssignment,
    SyntaxKind.PropertyDeclaration,
    SyntaxKind.ShorthandPropertyAssignment,
    SyntaxKind.VariableDeclaration,
  ]);
  const mayCarryDateInvocation = (
    node: Node | undefined,
    seen: ReadonlySet<Node> = new Set(),
  ): boolean => {
    const expression = expressionProvenance(node);
    if (expression === undefined || seen.has(expression)) return false;
    const nextSeen = new Set(seen).add(expression);
    if (
      Node.isPropertyAccessExpression(expression) ||
      Node.isElementAccessExpression(expression)
    ) {
      const members = memberNameCandidates(expression);
      if (["call", "apply", "bind"].some((name) => members.names.has(name))) {
        return true;
      }
    }
    if (Node.isCallExpression(expression)) {
      return mayCarryDateInvocation(expression.getExpression(), nextSeen);
    }
    return (expression.getSymbol()?.getDeclarations() ?? []).some(
      (declaration) => dateInvocationCarrierKinds.has(declaration.getKind()),
    );
  };
  const argumentListAlternatives = (
    node: Node | undefined,
  ): readonly (readonly Node[] | null)[] =>
    staticArrayElementAlternatives(node) ?? [null];
  const normalizedDateCallInvocations = (
    call: CallExpression,
  ): readonly {
    readonly callee: Node;
    readonly arguments: readonly Node[] | null;
    readonly construction: boolean;
  }[] => {
    const reflected = normalizedAmbientBuiltinCall(
      call,
      "Reflect",
      ["apply", "construct"],
    );
    if (reflected !== null && reflected.arguments !== null) {
      const target = reflected.arguments[0];
      const argumentList = reflected.arguments[
        reflected.method === "construct" ? 1 : 2
      ];
      if (target === undefined) return [];
      return argumentListAlternatives(argumentList).map((arguments_) => ({
        callee: target,
        arguments: arguments_,
        construction: reflected.method === "construct",
      }));
    }
    const capabilities = mayCarryDateInvocation(call.getExpression())
      ? dateInvocationCapabilitiesAtPath(call.getExpression())
      : [];
    if (capabilities.length > 0) {
      return capabilities.flatMap((capability) => {
        if (capability.method === "call") {
          return [{
            callee: capability.target,
            arguments: call.getArguments().slice(1),
            construction: false,
          }];
        }
        if (capability.method === "apply") {
          return argumentListAlternatives(call.getArguments()[1]).map(
            (arguments_) => ({
              callee: capability.target,
              arguments: arguments_,
              construction: false,
            }),
          );
        }
        if (capability.method === "bound") {
          return [{
            callee: capability.target,
            arguments: [
              ...capability.boundArguments,
              ...call.getArguments(),
            ],
            construction: false,
          }];
        }
        return [];
      });
    }
    return [{
      callee: call.getExpression(),
      arguments: call.getArguments(),
      construction: false,
    }];
  };
  const normalizedDateConstructions = (
    call: NewExpression,
  ): readonly {
    readonly callee: Node;
    readonly arguments: readonly Node[] | null;
  }[] => {
    const capabilities = mayCarryDateInvocation(call.getExpression())
      ? dateInvocationCapabilitiesAtPath(call.getExpression()).filter(
        (capability) => capability.method === "bound",
      )
      : [];
    if (capabilities.length > 0) {
      return capabilities.map((capability) => ({
        callee: capability.target,
        arguments: [
          ...capability.boundArguments,
          ...call.getArguments(),
        ],
      }));
    }
    return [{ callee: call.getExpression(), arguments: call.getArguments() }];
  };
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const descriptorInvocation = nodeOrDeclarationMentionsAny(
        call.getExpression(),
        ["getOwnPropertyDescriptor", "getOwnPropertyDescriptors"],
      )
      ? normalizedAmbientBuiltinCall(
        call,
        "Object",
        ["getOwnPropertyDescriptor", "getOwnPropertyDescriptors"],
      ) ??
        normalizedAmbientBuiltinCall(
          call,
          "Reflect",
          ["getOwnPropertyDescriptor"],
        )
      : null;
    if (descriptorInvocation !== null && descriptorInvocation.arguments !== null) {
      const target = descriptorInvocation.arguments[0];
      const descriptorKeys = propertyKeyCandidatesIn(
        sf,
        descriptorInvocation.arguments[1],
      );
      const targetHasPrimitiveLocaleCapability = target !== undefined && (
        isLocaleSensitivePrimitiveMethod(target, "localeCompare") ||
        isLocaleSensitivePrimitiveMethod(target, "toLocaleString")
      );
      const targetHasLocaleCapability = target !== undefined && (
        isAmbientIntlInstance(target) ||
        (descriptorInvocation.method === "getOwnPropertyDescriptors" &&
          (isAmbientDateInstance(target) ||
            targetHasPrimitiveLocaleCapability)) ||
        [...descriptorKeys.names].some((name) =>
          (dateHostTimeMethodNames.has(name) && isAmbientDateInstance(target)) ||
          isLocaleSensitivePrimitiveMethod(target, name)
        ) ||
        (descriptorKeys.unresolved &&
          (isAmbientDateInstance(target) || targetHasPrimitiveLocaleCapability))
      );
      if (targetHasLocaleCapability) {
        record(
          call.getStartLineNumber(),
          "<nondeterministic platform-global>",
        );
      }
    }
    const callee = unwrapExpression(call.getExpression());
    if (
      Node.isPropertyAccessExpression(callee) ||
      Node.isElementAccessExpression(callee)
    ) {
      const members = memberNameCandidates(callee);
      const receiver = callee.getExpression();
      const descriptorKey = propertyKeyCandidatesIn(
        sf,
        call.getArguments()[1],
      );
      if (
        (members.names.has("getOwnPropertyDescriptor") &&
          (isKnownAmbientGlobal(receiver, "Object") ||
            isKnownAmbientGlobal(receiver, "Reflect")) &&
          (descriptorKey.names.has("constructor") ||
            descriptorKey.unresolved)) ||
        (members.names.has("getOwnPropertyDescriptors") &&
          isKnownAmbientGlobal(receiver, "Object"))
      ) {
        record(
          call.getStartLineNumber(),
          "<dynamic-code capability>",
        );
      }
    }
    const dateTimeFormatCalls = dateTimeFormatInvocations(call);
    if (dateTimeFormatCalls.length > 0) {
      record(
        call.getStartLineNumber(),
        "<nondeterministic platform-global>",
      );
    }
    for (const invocation of normalizedDateCallInvocations(call)) {
      inspectCall(
        invocation.callee,
        invocation.arguments,
        call.getStartLineNumber(),
        invocation.construction,
      );
    }
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    for (const construction of normalizedDateConstructions(call)) {
      inspectCall(
        construction.callee,
        construction.arguments,
        call.getStartLineNumber(),
        true,
      );
    }
  }
  return references;
}

let esOnlyGlobalNamesCache: ReadonlySet<string> | undefined;
let platformGlobalNamesCache: ReadonlySet<string> | undefined;

const esOnlyGlobalNames = (): ReadonlySet<string> => {
  if (esOnlyGlobalNamesCache !== undefined) return esOnlyGlobalNamesCache;
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts"],
      types: [],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });
  const sourceFile = project.createSourceFile("/scope.ts", "export {};");
  const symbols = project
    .getTypeChecker()
    .compilerObject.getSymbolsInScope(
      sourceFile.compilerNode,
      ts.SymbolFlags.Value |
        ts.SymbolFlags.Type |
        ts.SymbolFlags.Namespace,
    );
  esOnlyGlobalNamesCache = new Set(symbols.map((symbol) => symbol.getName()));
  return esOnlyGlobalNamesCache;
};

const platformGlobalNames = (): ReadonlySet<string> => {
  if (platformGlobalNamesCache !== undefined) {
    return platformGlobalNamesCache;
  }
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFileAtPath(join(REPO_ROOT, "next-env.d.ts"));
  const sourceFile = project.createSourceFile(
    join(REPO_ROOT, ".platform-scope.ts"),
    "export {};",
  );
  const esNames = esOnlyGlobalNames();
  platformGlobalNamesCache = new Set(
    project
      .getTypeChecker()
      .compilerObject.getSymbolsInScope(
        sourceFile.compilerNode,
        ts.SymbolFlags.Value |
          ts.SymbolFlags.Type |
          ts.SymbolFlags.Namespace,
      )
      .filter((symbol) => {
        const declarations = symbol.getDeclarations() ?? [];
        return (
          !esNames.has(symbol.getName()) &&
          declarations.length > 0 &&
          declarations.every(
            (declaration) =>
              declaration.getSourceFile().isDeclarationFile,
          )
        );
      })
      .map((symbol) => symbol.getName()),
  );
  return platformGlobalNamesCache;
};

const nonEsPlatformGlobalReferences = (
  sf: SourceFile,
): Array<{ readonly line: number; readonly name: string }> => {
  const platformNames = platformGlobalNames();
  const references = new Map<string, { line: number; name: string }>();
  const inspect = (node: Node): void => {
    for (const name of ambientGlobalNamesIn(sf, node)) {
      if (
        name === UNKNOWN_AMBIENT_GLOBAL ||
        name === "globalThis" ||
        !platformNames.has(name)
      ) {
        continue;
      }
      references.set(`${node.getStartLineNumber()}:${name}`, {
        line: node.getStartLineNumber(),
        name,
      });
    }
  };
  for (const identifier of sf.getDescendantsOfKind(
    SyntaxKind.Identifier,
  )) {
    const parent = identifier.getParent();
    if (parent === undefined) continue;
    if (
      (Node.isPropertyAccessExpression(parent) &&
        parent.getNameNode() === identifier) ||
      (Node.isQualifiedName(parent) &&
        parent.getRight() === identifier) ||
      (!Node.isShorthandPropertyAssignment(parent) &&
        (Node.isNamed(parent) ||
          Node.isBindingNamed(parent) ||
          Node.isPropertyNamed(parent) ||
          Node.isModuleNamed(parent)) &&
        parent.getNameNode() === identifier)
    ) {
      continue;
    }
    inspect(identifier);
  }
  for (const access of [
    ...sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
    ...sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
  ]) {
    if (
      ambientGlobalNamesIn(sf, access.getExpression()).has(
        "globalThis",
      )
    ) {
      inspect(access);
    }
  }
  return [...references.values()];
};

/** ADR-0029 allows contracts to import only Zod among external packages. */
export function detectContractsExternalImportViolations(project: Project): ContractsExternalImportViolation[] {
  const violations: ContractsExternalImportViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    if (layerOfPath(filePath) !== "contracts") continue;
    for (const ref of moduleReferences(sf)) {
      const specifier = ref.specifier;
      if (
        specifier !== null &&
        classifySpecifier(project, filePath, specifier).kind === "layer"
      ) {
        continue;
      }
      if (specifier === "zod" || specifier?.startsWith("zod/")) continue;
      violations.push({
        file: relative(REPO_ROOT, filePath),
        line: ref.line,
        specifier: specifier ?? `<non-literal ${ref.kind}>`,
      });
    }
    for (const declaration of ambientContractDeclarations(sf)) {
      violations.push({
        file: relative(REPO_ROOT, filePath),
        line: declaration.line,
        specifier: `<ambient-declaration ${declaration.name}>`,
      });
    }
    for (const reference of contractCapabilityReferences(sf)) {
      violations.push({
        file: relative(REPO_ROOT, filePath),
        line: reference.line,
        specifier: reference.specifier,
      });
    }
    for (const reference of nonEsPlatformGlobalReferences(sf)) {
      violations.push({
        file: relative(REPO_ROOT, filePath),
        line: reference.line,
        specifier: `<platform-global ${reference.name}>`,
      });
    }
  }
  const isolated = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.es2022.d.ts"],
      types: [],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
    },
  });
  for (const sf of project.getSourceFiles()) {
    if (layerOfPath(sf.getFilePath()) !== "contracts") continue;
    isolated.createSourceFile(sf.getFilePath(), sf.getFullText(), { overwrite: true });
  }
  for (const diagnostic of isolated.getPreEmitDiagnostics()) {
    if (![2304, 2339, 2503, 2552, 2580, 2584, 2591, 7017].includes(diagnostic.getCode())) continue;
    const sf = diagnostic.getSourceFile();
    const start = diagnostic.getStart();
    if (!sf || start === undefined) continue;
    const name = sf.getFullText().slice(start, start + (diagnostic.getLength() ?? 0));
    violations.push({
      file: relative(REPO_ROOT, sf.getFilePath()),
      line: diagnostic.getLineNumber() ?? 1,
      specifier: `<platform-global ${name}>`,
    });
  }
  return [
    ...new Map(
      violations.map((violation) => [
        `${violation.file}:${violation.line}:${violation.specifier}`,
        violation,
      ]),
    ).values(),
  ];
}

/** A ts-morph Project loaded from the real src/ tree (no type-checking, fast). */
export function realProject(): Project {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const f of shippedSourceFiles()) project.addSourceFileAtPath(f);
  return project;
}

/**
 * A type-checked Project over the whole repo. MEMOIZED: tsconfig's
 * include pulls in every repo .ts/.tsx file, and the fitness suite asks for this
 * ten times, so building it per call type-checked the same program ten times.
 * Fences only READ this project, so sharing one instance is safe.
 */
let semanticProject: Project | null = null;
export function realSemanticProject(): Project {
  semanticProject ??= new Project({ tsConfigFilePath: join(REPO_ROOT, "tsconfig.json") });
  return semanticProject;
}

/** An in-memory Project for companion tests. */
export function inMemoryProject(files: Record<string, string>): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    // The repo's real compiler options (lib/target/strictness) rebased onto the
    // in-memory root, so companion fixtures resolve `@contracts/*` & co. against
    // the in-memory /src tree instead of the host repo path.
    compilerOptions: {
      ...REPO_COMPILER_OPTIONS,
      // Companion fixtures are tiny synthetic trees analysed for STRUCTURE, so they
      // need no DOM surface and no @types packages — and the fence suite builds
      // ~165 of them, each of which re-parsed lib.dom.d.ts and every ambient
      // declaration before answering a question about five lines of fixture.
      lib: ["lib.es2022.d.ts"],
      types: [],
      baseUrl: "/",
      paths: {
        "@contracts/*": ["src/contracts/*"],
        "@domain/*": ["src/domain/*"],
        "@infra/*": ["src/infrastructure/*"],
        "@app/*": ["src/app/*"],
        "@/*": ["src/*"],
      },
    },
  });
  for (const [path, content] of Object.entries(files)) project.createSourceFile(path, content);
  return project;
}


/** A repo-relative, forward-slashed path (in-memory companion paths keep their leading segment). */
export function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
}

interface StructuralPiiOptions {
  readonly path: string;
  readonly seen?: ReadonlySet<string>;
  readonly location?: Node;
  readonly includeMarked?: boolean;
  readonly checkParameterNames?: boolean;
  readonly opaqueIsExposure?: boolean;
  readonly inspectCallSignatures?: boolean;
  readonly isEscaped?: (path: string, declaration: Node) => boolean;
}

function typeIsExactDeclaration(type: Type, file: string, name: string): boolean {
  if (type.isUnion() || type.isIntersection()) return false;
  const candidates = [type, type.getTargetType()].filter(
    (candidate): candidate is Type => candidate !== undefined,
  );
  return candidates.some((candidate) =>
    [candidate.getAliasSymbol(), candidate.getSymbol()].some((symbol) =>
      symbol?.getName() === name &&
      symbol.getDeclarations().some((declaration) =>
        normalizedPath(declaration.getSourceFile().getFilePath()) === file
      )
    )
  );
}

function typeIsOnlySafePiiWrapper(type: Type): boolean {
  const members = type.getUnionTypes();
  if (members.length > 0) {
    return members.every((member) =>
      member.isNull() ||
      member.isUndefined() ||
      typeIsOnlySafePiiWrapper(member)
    );
  }
  return typeIsExactDeclaration(type, "src/contracts/tokenized.ts", "Tokenized") ||
    typeIsExactDeclaration(type, "src/contracts/secret.ts", "SecretValue");
}

function typeDeclaredAs(type: Type, file: string, name: string): boolean {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = typeKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const symbol of [current.getAliasSymbol(), current.getSymbol()]) {
      if (
        symbol?.getName() === name &&
        symbol.getDeclarations().some((declaration) =>
          normalizedPath(declaration.getSourceFile().getFilePath()) === file
        )
      ) return true;
    }
    queue.push(
      ...current.getUnionTypes(),
      ...current.getIntersectionTypes(),
      ...current.getBaseTypes(),
      ...current.getAliasTypeArguments(),
      ...current.getTypeArguments(),
    );
  }
  return false;
}

function isPiiLeaf(type: Type): boolean {
  return type.isAny() ||
    type.isUnknown() ||
    type.isNever() ||
    type.isString() ||
    type.isStringLiteral() ||
    type.isNumber() ||
    type.isNumberLiteral() ||
    type.isBoolean() ||
    type.isBooleanLiteral() ||
    type.isNull() ||
    type.isUndefined() ||
    type.isVoid();
}

export function structuralPiiSignatureExposures(
  signature: Signature,
  options: StructuralPiiOptions,
): string[] {
  const seen = options.seen ?? new Set<string>();
  const parameters = signature.getParameters().flatMap((parameter) => {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    if (!declaration) return [];
    const parameterType = parameter.getTypeAtLocation(declaration);
    const path = `${options.path}(${parameter.getName()})`;
    if (
      options.checkParameterNames !== false &&
      isPIIField(parameter.getName()) &&
      !typeIsOnlySafePiiWrapper(parameterType)
    ) return [path];
    return structuralPiiExposures(parameterType, {
      ...options,
      path,
      seen,
      location: declaration,
    });
  });
  return [
    ...parameters,
    ...structuralPiiExposures(signature.getReturnType(), {
      ...options,
      path: `${options.path}.return`,
      seen,
      location: signature.getDeclaration(),
    }),
  ];
}

export function structuralPiiExposures(
  type: Type,
  options: StructuralPiiOptions,
): string[] {
  if (
    options.opaqueIsExposure &&
    (type.isAny() || type.isUnknown())
  ) return [options.path];
  if (
    typeIsExactDeclaration(type, "src/contracts/tokenized.ts", "Tokenized") ||
    typeIsExactDeclaration(type, "src/contracts/secret.ts", "SecretValue")
  ) return [];
  if (typeDeclaredAs(type, "src/contracts/pii.ts", "PIIBearing")) {
    return options.includeMarked ? [options.path] : [];
  }
  if (isPiiLeaf(type)) return [];
  const key = typeKey(type);
  const seen = options.seen ?? new Set<string>();
  if (seen.has(key)) return [];
  const nextSeen = new Set(seen).add(key);
  const composite = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
  if (composite.length > 0) {
    return composite.flatMap((member) =>
      structuralPiiExposures(member, { ...options, seen: nextSeen })
    );
  }
  const nestedArguments = [
    ...type.getAliasTypeArguments(),
    ...type.getTypeArguments(),
    ...[type.getStringIndexType(), type.getNumberIndexType()].filter(
      (candidate): candidate is Type => candidate !== undefined,
    ),
  ].flatMap((argument) =>
    structuralPiiExposures(argument, { ...options, seen: nextSeen })
  );
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  const inspectNested = !symbol || symbol.getDeclarations().some((declaration) =>
    Node.isTypeLiteral(declaration) ||
    normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
  );
  const inspectResolved = inspectNested ||
    ["Record", "Pick", "Omit", "Partial", "Required", "Readonly"].includes(
      type.getAliasSymbol()?.getName() ?? "",
    );
  const properties = inspectResolved
    ? type.getProperties().flatMap((property) => {
      const declaration = property.getValueDeclaration() ??
        property.getDeclarations()[0] ??
        options.location;
      if (!declaration) return [];
      const propertyType = property.getTypeAtLocation(declaration);
      const path = `${options.path}.${property.getName()}`;
      if (
        isPIIField(property.getName()) &&
        !typeIsOnlySafePiiWrapper(propertyType) &&
        !options.isEscaped?.(path, declaration)
      ) return [path];
      return inspectNested
        ? structuralPiiExposures(propertyType, {
          ...options,
          path,
          seen: nextSeen,
          location: declaration,
        })
        : [];
    })
    : [];
  if (!inspectNested) return [...nestedArguments, ...properties];
  const calls = options.inspectCallSignatures === false
    ? []
    : type.getCallSignatures().flatMap((signature) =>
      structuralPiiSignatureExposures(signature, {
        ...options,
        path: `${options.path}.<call>`,
        seen: nextSeen,
      })
    );
  return [...nestedArguments, ...properties, ...calls];
}

export interface ReturnedCallableMember {
  readonly name: string;
  readonly declaration: Node;
  readonly signature: Signature | null;
}

export function returnedCallableMembers(
  declaration: Node,
  owner: string,
  options: { readonly failOpaqueReturn?: boolean } = {},
): ReturnedCallableMember[] {
  const body = Node.isFunctionDeclaration(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isArrowFunction(declaration) ||
      Node.isMethodDeclaration(declaration) ||
      Node.isGetAccessorDeclaration(declaration)
    ? declaration.getBody()
    : null;
  if (!body) return [];
  const signature = Node.isFunctionDeclaration(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isArrowFunction(declaration) ||
      Node.isMethodDeclaration(declaration) ||
      Node.isGetAccessorDeclaration(declaration)
    ? declaration.getSignature()
    : null;
  let returnType = signature?.getReturnType();
  while (
    returnType &&
    (returnType.getAliasSymbol() ?? returnType.getSymbol())?.getName() === "Promise"
  ) {
    returnType = returnType.getTypeArguments()[0];
  }
  if (
    returnType &&
    ["SqlDb", "SqlTx", "SqlQueryable"].some((name) =>
      typeIsExactDeclaration(returnType!, "src/infrastructure/store/db.ts", name)
    )
  ) {
    return [];
  }
  const returned: Node[] = [];
  if (!Node.isBlock(body)) returned.push(body);
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const enclosing = statement.getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isArrowFunction(ancestor) ||
      Node.isMethodDeclaration(ancestor) ||
      Node.isGetAccessorDeclaration(ancestor)
    );
    if (enclosing === declaration && statement.getExpression()) {
      returned.push(statement.getExpression()!);
    }
  }
  const resolveCallable = (identifier: Node): Node | undefined => {
    const symbol = identifier.getSymbol();
    const target = symbol?.getAliasedSymbol() ?? symbol;
    const candidates = [
      ...(Node.isIdentifier(identifier) ? identifier.getDefinitionNodes() : []),
      ...(target?.getDeclarations() ?? []),
    ];
    for (const candidate of candidates) {
      if (Node.isFunctionDeclaration(candidate)) return candidate;
      if (!Node.isVariableDeclaration(candidate)) continue;
      const initializer = candidate.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
      ) return initializer;
    }
    return undefined;
  };
  const members: ReturnedCallableMember[] = [];
  const memberKeys = new Set<string>();
  const addMember = (
    name: string,
    implementation: Node,
    signature: Signature,
  ): void => {
    const signatureDeclaration = signature.getDeclaration();
    const key = [
      name,
      implementation.getSourceFile().getFilePath(),
      implementation.getStart(),
      signatureDeclaration.getSourceFile().getFilePath(),
      signatureDeclaration.getStart(),
    ].join(":");
    if (memberKeys.has(key)) return;
    memberKeys.add(key);
    members.push({ name, declaration: implementation, signature });
  };
  const addUnresolvedMember = (name: string, expression: Node): void => {
    const key = `${name}:${expression.getSourceFile().getFilePath()}:${expression.getStart()}:unresolved`;
    if (memberKeys.has(key)) return;
    memberKeys.add(key);
    members.push({ name, declaration: expression, signature: null });
  };
  const callableProperties = (
    type: Type,
  ): Array<{ name: string; signature: Signature }> => {
    const found: Array<{ name: string; signature: Signature }> = [];
    for (const signature of type.getCallSignatures()) {
      found.push({ name: "<call>", signature });
    }
    for (const property of type.getProperties()) {
      const propertyDeclaration = property.getValueDeclaration() ??
        property.getDeclarations()[0];
      if (
        !propertyDeclaration ||
        !normalizedPath(propertyDeclaration.getSourceFile().getFilePath())
          .startsWith("src/")
      ) {
        continue;
      }
      for (const signature of property
        .getTypeAtLocation(propertyDeclaration)
        .getCallSignatures()) {
        found.push({ name: property.getName(), signature });
      }
    }
    return found;
  };
  const addUnresolved = (expression: Node): void => {
    const callables = callableProperties(expression.getType());
    for (const callable of callables) {
      addMember(
        `${owner}.${callable.name}`,
        expression,
        callable.signature,
      );
    }
    const type = expression.getType();
    const mayReturnCallable = returnType &&
      (
        returnType.isAny() ||
        returnType.isUnknown() ||
        callableProperties(returnType).length > 0
      );
    if (
      callables.length === 0 &&
      options.failOpaqueReturn === true &&
      (Node.isCallExpression(expression) || Node.isNewExpression(expression)) &&
      (type.isAny() || type.isUnknown()) &&
      mayReturnCallable
    ) {
      addUnresolvedMember(`${owner}.<unresolved>`, expression);
    }
  };
  const collectObject = (
    object: Node,
    visited: Set<string>,
    collectExpression: (expression: Node, seen: Set<string>) => void,
  ): void => {
    if (!Node.isObjectLiteralExpression(object)) {
      addUnresolved(object);
      return;
    }
    for (const property of object.getProperties()) {
      if (Node.isMethodDeclaration(property)) {
        addMember(
          `${owner}.${property.getName()}`,
          property,
          property.getSignature(),
        );
        continue;
      }
      if (Node.isGetAccessorDeclaration(property)) {
        const returnedMembers = returnedCallableMembers(
          property,
          `${owner}.${property.getName()}`,
        );
        for (const member of returnedMembers) {
          if (member.signature) {
            addMember(member.name, member.declaration, member.signature);
          } else {
            addUnresolvedMember(member.name, member.declaration);
          }
        }
        if (returnedMembers.length === 0) {
          for (const signature of property.getReturnType().getCallSignatures()) {
            addMember(
              `${owner}.${property.getName()}`,
              property,
              signature,
            );
          }
        }
        continue;
      }
      if (Node.isSpreadAssignment(property)) {
        collectExpression(property.getExpression(), visited);
        continue;
      }
      const callable = Node.isPropertyAssignment(property)
        ? property.getInitializer()
        : Node.isShorthandPropertyAssignment(property)
        ? resolveCallable(property.getNameNode())
        : undefined;
      if (
        callable &&
        (Node.isArrowFunction(callable) ||
          Node.isFunctionExpression(callable) ||
          Node.isFunctionDeclaration(callable))
      ) {
        addMember(
          `${owner}.${property.getName()}`,
          callable,
          callable.getSignature(),
        );
      } else if (
        Node.isPropertyAssignment(property) ||
        Node.isShorthandPropertyAssignment(property)
      ) {
        const signature = property.getType().getCallSignatures()[0];
        if (signature) {
          addMember(
            `${owner}.${property.getName()}`,
            property,
            signature,
          );
        }
      }
    }
  };
  const collectClass = (
    classDeclaration: Node,
    visited: Set<string>,
  ): void => {
    if (!Node.isClassDeclaration(classDeclaration) &&
        !Node.isClassExpression(classDeclaration)) {
      addUnresolved(classDeclaration);
      return;
    }
    const base = classDeclaration.getBaseClass();
    if (base) collectClass(base, visited);
    for (const method of classDeclaration.getMethods()) {
      if (method.getScope() === "private" || method.getScope() === "protected") {
        continue;
      }
      addMember(
        `${owner}.${method.getName()}`,
        method,
        method.getSignature(),
      );
    }
    for (const property of classDeclaration.getProperties()) {
      if (property.getScope() === "private" || property.getScope() === "protected") {
        continue;
      }
      const initializer = property.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer))
      ) {
        addMember(
          `${owner}.${property.getName()}`,
          initializer,
          initializer.getSignature(),
        );
        continue;
      }
      const signature = property.getType().getCallSignatures()[0];
      if (signature) {
        addMember(
          `${owner}.${property.getName()}`,
          property,
          signature,
        );
      }
    }
    for (const accessor of classDeclaration.getGetAccessors()) {
      if (accessor.getScope() === "private" || accessor.getScope() === "protected") {
        continue;
      }
      const returnedMembers = returnedCallableMembers(
        accessor,
        `${owner}.${accessor.getName()}`,
      );
      for (const member of returnedMembers) {
        if (member.signature) {
          addMember(member.name, member.declaration, member.signature);
        } else {
          addUnresolvedMember(member.name, member.declaration);
        }
      }
      if (returnedMembers.length === 0) {
        for (const signature of accessor.getReturnType().getCallSignatures()) {
          addMember(
            `${owner}.${accessor.getName()}`,
            accessor,
            signature,
          );
        }
      }
    }
  };
  const collectExpression = (
    source: Node,
    seen: Set<string>,
  ): void => {
    let expression = source;
    while (
      Node.isParenthesizedExpression(expression) ||
      Node.isAsExpression(expression) ||
      Node.isSatisfiesExpression(expression) ||
      Node.isTypeAssertion(expression) ||
      Node.isNonNullExpression(expression) ||
      Node.isAwaitExpression(expression)
    ) {
      expression = expression.getExpression();
    }
    const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
    if (seen.has(key)) {
      addUnresolved(expression);
      return;
    }
    const visited = new Set(seen).add(key);
    if (Node.isObjectLiteralExpression(expression)) {
      collectObject(expression, visited, collectExpression);
      return;
    }
    if (Node.isConditionalExpression(expression)) {
      collectExpression(expression.getWhenTrue(), visited);
      collectExpression(expression.getWhenFalse(), visited);
      return;
    }
    if (Node.isNewExpression(expression)) {
      const symbol = expression.getExpression().getSymbol();
      const target = symbol?.getAliasedSymbol() ?? symbol;
      const classDeclaration = target?.getDeclarations().find((candidate) =>
        Node.isClassDeclaration(candidate) || Node.isClassExpression(candidate)
      );
      if (classDeclaration) {
        collectClass(classDeclaration, visited);
      } else {
        addUnresolved(expression);
      }
      return;
    }
    if (Node.isCallExpression(expression)) {
      const callee = expression.getExpression();
      if (
        Node.isPropertyAccessExpression(callee) &&
        callee.getExpression().getText() === "Object" &&
        ["freeze", "seal"].includes(callee.getName()) &&
        expression.getArguments().length === 1
      ) {
        collectExpression(expression.getArguments()[0]!, visited);
      } else {
        addUnresolved(expression);
      }
      return;
    }
    if (Node.isArrowFunction(expression) ||
        Node.isFunctionExpression(expression) ||
        Node.isFunctionDeclaration(expression)) {
      addMember(`${owner}.<call>`, expression, expression.getSignature());
      return;
    }
    if (Node.isIdentifier(expression)) {
      const callable = resolveCallable(expression);
      if (
        Node.isArrowFunction(callable) ||
        Node.isFunctionExpression(callable) ||
        Node.isFunctionDeclaration(callable)
      ) {
        addMember(`${owner}.<call>`, callable, callable.getSignature());
        return;
      }
      const symbol = expression.getSymbol();
      const target = symbol?.getAliasedSymbol() ?? symbol;
      const variable = target?.getDeclarations().find(Node.isVariableDeclaration);
      const initializer = variable?.getInitializer();
      if (initializer) {
        collectExpression(initializer, visited);
        return;
      }
    }
    addUnresolved(expression);
  };
  for (const expression of returned) {
    collectExpression(expression, new Set());
  }
  return members;
}

/**
 * THE AUTHORITY PROLOGUE - one rule, two fences.
 *
 * The governed-actions fence and the tenant-context-required fence each demand a
 * runtime assertion on the authority they care about, and each USED to demand it be
 * literally statement #1. For a callable carrying both authorities as explicit
 * parameters - `f(db, tenant: TenantContext, grant: ActionGrant<"pii.view">)` - those
 * two rules are unsatisfiable at the same time, so a correct dual-authority signature
 * was simply unbuildable. It is latent only because the one governed repository today
 * derives its tenant from `grant.tenant` inside the body.
 *
 * The property that actually matters is not "first" but "before anything else": every
 * required assertion runs before any side effect, database call, branching business
 * logic, or use of the authority it guards. So the prologue is the maximal CONTIGUOUS
 * leading run of authority assertions, and a required assertion that is not in it is a
 * violation. Both fences derive it from this one implementation, so they cannot
 * disagree about what a valid prologue is.
 */
const AUTHORITY_ASSERTIONS: ReadonlyArray<{ readonly file: string; readonly functionName: string }> = [
  { file: "src/contracts/authz.ts", functionName: "assertActionGrant" },
  { file: "src/contracts/principal.ts", functionName: "assertPrincipal" },
  { file: "src/contracts/principal.ts", functionName: "assertWriteActor" },
  { file: "src/contracts/tenant.ts", functionName: "assertSameTenant" },
  { file: "src/contracts/tenant.ts", functionName: "assertTenantContext" },
];

function declaredAsType(type: Type, file: string, name: string): boolean {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = typeKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const symbol of [current.getAliasSymbol(), current.getSymbol()]) {
      if (
        symbol?.getName() === name &&
        symbol.getDeclarations().some((declaration) =>
          normalizedPath(declaration.getSourceFile().getFilePath()) === file
        )
      ) return true;
    }
    queue.push(...current.getUnionTypes(), ...current.getIntersectionTypes());
  }
  return false;
}

const SEALED_AUTHORITY_KINDS = [
  {
    kind: "grant",
    typeName: "ActionGrant",
    declaration: "src/contracts/authz.ts",
    assertion: "assertActionGrant",
    file: "src/contracts/authz.ts",
  },
  {
    kind: "writeActor",
    typeName: "WriteActor",
    declaration: "src/contracts/principal.ts",
    assertion: "assertWriteActor",
    file: "src/contracts/principal.ts",
  },
  {
    kind: "tenant",
    typeName: "TenantContext",
    declaration: "src/contracts/tenant.ts",
    assertion: "assertTenantContext",
    file: "src/contracts/tenant.ts",
  },
] as const;

const DYNAMIC_AUTHORITY_TYPES = [
  ...SEALED_AUTHORITY_KINDS.map(({ typeName, declaration }) => ({
    typeName,
    declaration,
  })),
  { typeName: "ActorRef", declaration: "src/contracts/authz.ts" },
  { typeName: "Principal", declaration: "src/contracts/principal.ts" },
  { typeName: "AuthenticatedUser", declaration: "src/contracts/principal.ts" },
] as const;

export interface SealedAuthorityParameter {
  readonly kind: (typeof SEALED_AUTHORITY_KINDS)[number]["kind"];
  /** The expression that NAMES the authority: `grant`, or `ctx.tenant` when wrapped. */
  readonly argument: string;
  readonly assertion: string;
  readonly file: string;
  readonly type: Type;
}

interface AuthorityInventory {
  readonly authorities: SealedAuthorityParameter[];
  readonly unfenceable: string[];
}

function authorityInventory(signature: Signature): AuthorityInventory {
  const memberExpression = (owner: string, name: string): string =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
      ? `${owner}.${name}`
      : `${owner}[${JSON.stringify(name)}]`;
  const authorityKey = (authority: SealedAuthorityParameter): string =>
    `${authority.kind}:${authority.argument}:${
      authority.kind === "grant" ? grantAction(authority) ?? "<dynamic>" : ""
    }`;
  const authorityMemo = new Map<object, boolean>();
  const authorityVisiting = new Set<object>();
  const containsAuthority = (type: Type): boolean => {
    const key = type.compilerType as unknown as object;
    const memoized = authorityMemo.get(key);
    if (memoized !== undefined) return memoized;
    if (authorityVisiting.has(key)) return false;
    authorityVisiting.add(key);
    const symbol = type.getAliasSymbol() ?? type.getSymbol();
    const projectOwned = !symbol ||
      symbol.getDeclarations().some((declaration) =>
        Node.isTypeLiteral(declaration) ||
        normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
      );
    const nested = [
      ...type.getUnionTypes(),
      ...type.getIntersectionTypes(),
      ...type.getBaseTypes(),
      ...type.getAliasTypeArguments(),
      ...type.getTypeArguments(),
      ...type.getTupleElements(),
      ...[type.getArrayElementType()].filter((item): item is Type => Boolean(item)),
      ...[type.getStringIndexType(), type.getNumberIndexType()]
        .filter((item): item is Type => Boolean(item)),
      ...(projectOwned
        ? [
          ...type.getProperties().flatMap((member) => {
            const declaration = member.getValueDeclaration() ??
              member.getDeclarations()[0];
            return declaration ? [member.getTypeAtLocation(declaration)] : [];
          }),
          ...[...type.getCallSignatures(), ...type.getConstructSignatures()]
            .map((candidate) => candidate.getReturnType()),
        ]
        : []),
    ];
    const found = DYNAMIC_AUTHORITY_TYPES.some((candidate) =>
      declaredAsType(type, candidate.declaration, candidate.typeName)
    ) || nested.some(containsAuthority);
    authorityVisiting.delete(key);
    authorityMemo.set(key, found);
    return found;
  };
  const callbackMemo = new Map<object, boolean>();
  const callbackVisiting = new Set<object>();
  const callbackCanSupplyAuthority = (type: Type): boolean => {
    const key = type.compilerType as unknown as object;
    const memoized = callbackMemo.get(key);
    if (memoized !== undefined) return memoized;
    if (callbackVisiting.has(key)) return false;
    callbackVisiting.add(key);
    const nested = [
      ...type.getUnionTypes(),
      ...type.getIntersectionTypes(),
      ...type.getAliasTypeArguments(),
      ...type.getTypeArguments(),
    ];
    const signatures = [
      ...type.getCallSignatures(),
      ...type.getConstructSignatures(),
    ];
    const found = nested.some(callbackCanSupplyAuthority) ||
      signatures.some((candidate) =>
        containsAuthority(candidate.getReturnType()) ||
        candidate.getParameters().some((parameter) => {
          const declaration = parameter.getValueDeclaration() ??
            parameter.getDeclarations()[0];
          if (!declaration) return false;
          const parameterType = parameter.getTypeAtLocation(declaration);
          return containsAuthority(parameterType) ||
            callbackCanSupplyAuthority(parameterType);
        })
      );
    callbackVisiting.delete(key);
    callbackMemo.set(key, found);
    return found;
  };
  const signatureContainsAuthority = (candidate: Signature): boolean =>
    containsAuthority(candidate.getReturnType()) ||
    candidate.getParameters().some((parameter) => {
      const declaration = parameter.getValueDeclaration() ??
        parameter.getDeclarations()[0];
      return Boolean(declaration &&
        callbackCanSupplyAuthority(parameter.getTypeAtLocation(declaration)));
    });
  const collect = (
    type: Type,
    argument: string,
    ancestors: ReadonlySet<object>,
  ): AuthorityInventory => {
    const key = type.compilerType as unknown as object;
    if (ancestors.has(key)) {
      return containsAuthority(type)
        ? {
          authorities: [],
          unfenceable: [
            `sealed authority carrier '${argument}' is recursive with runtime-dependent cardinality`,
          ],
        }
        : { authorities: [], unfenceable: [] };
    }
    const nested = new Set(ancestors).add(key);
    const unions = type.getUnionTypes();
    if (unions.length > 0) {
      const arms = unions.map((arm) => collect(arm, argument, nested));
      const keys = arms.map((arm) =>
        arm.authorities.map(authorityKey).sort().join("|")
      );
      if (
        arms.some((arm) => arm.unfenceable.length > 0) ||
        new Set(keys).size !== 1
      ) {
        return {
          authorities: [],
          unfenceable: [
            `sealed authority carrier '${argument}' is conditional; every closed union arm must expose one identical complete authority-path inventory`,
          ],
        };
      }
      return arms[0] ?? { authorities: [], unfenceable: [] };
    }
    const own = SEALED_AUTHORITY_KINDS.find((candidate) =>
      declaredAsType(type, candidate.declaration, candidate.typeName)
    );
    if (own) {
      return {
        authorities: [{ kind: own.kind, argument, assertion: own.assertion, file: own.file, type }],
        unfenceable: [],
      };
    }
    const dynamicSignatures = [
      ...type.getCallSignatures(),
      ...type.getConstructSignatures(),
    ];
    if (
      dynamicSignatures.some(signatureContainsAuthority)
    ) {
      return {
        authorities: [],
        unfenceable: [
          `sealed authority carrier '${argument}' can produce authority through a call or construction, so its runtime inventory is not statically fixed`,
        ],
      };
    }
    if (type.isTuple()) {
      return type.getTupleElements().reduce<AuthorityInventory>(
        (inventory, element, index) => {
          const found = collect(element, `${argument}[${index}]`, nested);
          return {
            authorities: [...inventory.authorities, ...found.authorities],
            unfenceable: [...inventory.unfenceable, ...found.unfenceable],
          };
        },
        { authorities: [], unfenceable: [] },
      );
    }
    if (type.isArray()) {
      const element = type.getArrayElementType();
      const found = element
        ? collect(element, `${argument}[*]`, nested)
        : { authorities: [], unfenceable: [] };
      return found.authorities.length > 0 || found.unfenceable.length > 0
        ? {
          authorities: [],
          unfenceable: [
            `sealed authority carrier '${argument}' is an array with runtime-dependent cardinality`,
          ],
        }
        : { authorities: [], unfenceable: [] };
    }
    for (const [indexKind, indexed] of [
      ["string", type.getStringIndexType()],
      ["number", type.getNumberIndexType()],
    ] as const) {
      if (!indexed) continue;
      const found = collect(indexed, `${argument}[${indexKind}]`, nested);
      if (found.authorities.length > 0 || found.unfenceable.length > 0) {
        return {
          authorities: [],
          unfenceable: [
            `sealed authority carrier '${argument}' has an open ${indexKind} index signature`,
          ],
        };
      }
    }
    return type.getProperties().reduce<AuthorityInventory>((inventory, member) => {
      const declaration = member.getValueDeclaration() ?? member.getDeclarations()[0];
      if (!declaration) return inventory;
      const memberType = member.getTypeAtLocation(declaration);
      const signatures = [
        ...memberType.getCallSignatures(),
        ...memberType.getConstructSignatures(),
      ];
      if (
        signatures.some(signatureContainsAuthority)
      ) {
        return {
          authorities: inventory.authorities,
          unfenceable: [
            ...inventory.unfenceable,
            `sealed authority carrier '${memberExpression(argument, member.getName())}' can produce authority through a call or construction, so its runtime inventory is not statically fixed`,
          ],
        };
      }
      if (signatures.length > 0) return inventory;
      const found = collect(
        memberType,
        memberExpression(argument, member.getName()),
        nested,
      );
      return {
        authorities: [...inventory.authorities, ...found.authorities],
        unfenceable: [...inventory.unfenceable, ...found.unfenceable],
      };
    }, { authorities: [], unfenceable: [] });
  };
  const authorities: SealedAuthorityParameter[] = [];
  const unfenceable: string[] = [];
  for (const parameter of signature.getParameters()) {
    const declaration = parameter.getValueDeclaration() ?? parameter.getDeclarations()[0];
    if (!declaration) continue;
    if (Node.isParameterDeclaration(declaration)) {
      const name = declaration.getNameNode();
      if (!Node.isIdentifier(name)) {
        for (const element of name.getDescendantsOfKind(SyntaxKind.BindingElement)) {
          const bound = element.getNameNode();
          if (!Node.isIdentifier(bound)) continue;
          const found = collect(bound.getType(), bound.getText(), new Set());
          authorities.push(...found.authorities);
          unfenceable.push(...found.unfenceable);
        }
        continue;
      }
    }
    const found = collect(
      parameter.getTypeAtLocation(declaration),
      Node.isParameterDeclaration(declaration)
        ? declaration.getNameNode().getText()
        : parameter.getName(),
      new Set(),
    );
    authorities.push(...found.authorities);
    unfenceable.push(...found.unfenceable);
  }
  return { authorities, unfenceable };
}

export function sealedAuthorityParameters(signature: Signature): SealedAuthorityParameter[] {
  return authorityInventory(signature).authorities;
}

/**
 * The single literal action an ActionGrant parameter is typed to. `null` means the
 * grant's action is a UNION or a type parameter: no single assertion can prove it, so
 * the callers below refuse the signature rather than silently dropping BOTH the
 * assertion and the same-tenant proof - widening one type argument would otherwise
 * remove the whole cross-authority requirement.
 */
export function grantAction(authority: SealedAuthorityParameter): string | null {
  const property = authority.type.getProperty("action");
  const declaration = property?.getValueDeclaration() ?? property?.getDeclarations()[0];
  if (!property || !declaration) return null;
  const action = property.getTypeAtLocation(declaration);
  return action.isStringLiteral() ? String(action.getLiteralValue()) : null;
}

/**
 * THE shared authority prologue for a signature: an exact assertion per sealed
 * authority it carries, tenant-to-grant comparisons, and every pairwise grant
 * comparison. One derivation keeps the governed-sink and tenant-scope fences aligned.
 */
export function requiredAuthorityPrologue(
  signature: Signature,
): {
  required: RequiredAuthorityAssertion[];
  captures: RequiredAuthorityCapture[];
  unfenceable: string[];
} {
  const inventory = authorityInventory(signature);
  const authorities = inventory.authorities;
  const grants = authorities.filter((authority) => authority.kind === "grant");
  const actions = new Map(grants.map((grant) => [grant, grantAction(grant)]));
  const unfenceable = [...inventory.unfenceable, ...grants.flatMap((grant) =>
    actions.get(grant) === null
      ? [
        `ActionGrant parameter '${grant.argument}' must be typed to ONE literal action; a union or generic action cannot be asserted or cross-checked against the tenant scope`,
      ]
      : []
  )];
  const required: RequiredAuthorityAssertion[] = authorities.map((authority) => ({
    functionName: authority.assertion,
    file: authority.file,
    args: authority.kind === "grant" && actions.get(authority) !== null
      ? [authority.argument, JSON.stringify(actions.get(authority))]
      : [authority.argument],
  }));
  const captures = [...new Map(
    authorities
      .filter((authority) =>
        !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(authority.argument)
      )
      .map((authority) => [
        authority.argument,
        { source: authority.argument },
      ]),
  ).values()];
  const scopes = authorities.map((authority) =>
    authority.kind === "tenant" ? authority.argument : `${authority.argument}.tenant`
  );
  for (let left = 0; left < scopes.length; left += 1) {
    for (let right = left + 1; right < scopes.length; right += 1) {
      required.push({
        functionName: "assertSameTenant",
        file: "src/contracts/tenant.ts",
        args: [scopes[left]!, scopes[right]!],
      });
    }
  }
  return { required, captures, unfenceable };
}

export interface RequiredAuthorityAssertion {
  readonly functionName: string;
  readonly file: string;
  /**
   * Expected arguments, positionally. A JSON-quoted element (built with
   * `JSON.stringify(action)`) is compared by string VALUE; anything else is compared
   * as written, which is what pins the guard to the actual parameter binding.
   */
  readonly args: readonly string[];
}

export interface RequiredAuthorityCapture {
  readonly source: string;
}

/**
 * Quote style is a formatting choice Prettier does not normalize in every context,
 * and this rule is fail-closed: comparing an action's SOURCE TEXT rejects a correct
 * `assertActionGrant(grant, 'pii.view')` as a missing prologue assertion. Identifiers
 * still compare as written - `assertActionGrant(other, …)` names a different value.
 */
function authorityArgumentMatches(argument: Node | undefined, expected: string): boolean {
  if (!argument) return false;
  if (!(expected.startsWith('"') && expected.endsWith('"'))) {
    return argument.getText() === expected;
  }
  if (!Node.isStringLiteral(argument) && !Node.isNoSubstitutionTemplateLiteral(argument)) {
    return false;
  }
  try {
    return argument.getLiteralValue() === (JSON.parse(expected) as unknown);
  } catch {
    return false;
  }
}

/** Resolved by SYMBOL, so an aliased import cannot pose as the assertion. */
export function callResolvesToDeclaration(call: Node, file: string, name: string): boolean {
  if (!Node.isCallExpression(call)) return false;
  const symbol = call.getExpression().getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return target?.getName() === name &&
    target.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) === file
    );
}

function functionBody(declaration: Node): Node | undefined {
  return Node.isFunctionDeclaration(declaration) ||
      Node.isMethodDeclaration(declaration) ||
      Node.isGetAccessorDeclaration(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isArrowFunction(declaration)
    ? declaration.getBody()
    : undefined;
}

interface ParsedAuthorityPrologue {
  readonly calls: CallExpression[];
  readonly captureBindings: ReadonlyMap<string, string>;
  readonly captureInitializers: ReadonlyMap<string, Node>;
}

function canonicalAuthorityText(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/\[(["'][^"'\\]*(?:\\.[^"'\\]*)*["'])\]/g, (match, quoted: string) => {
      try {
        const value = JSON.parse(
          quoted.startsWith("'")
            ? `"${quoted.slice(1, -1).replace(/"/g, '\\"')}"`
            : quoted,
        ) as unknown;
        return typeof value === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
          ? `.${value}`
          : match;
      } catch {
        return match;
      }
    });
}

function authorityPrologue(
  declaration: Node,
  captures: readonly RequiredAuthorityCapture[],
): ParsedAuthorityPrologue {
  const body = functionBody(declaration);
  if (!Node.isBlock(body)) {
    return {
      calls: [],
      captureBindings: new Map(),
      captureInitializers: new Map(),
    };
  }
  const requiredSources = new Set(captures.map((capture) =>
    canonicalAuthorityText(capture.source)
  ));
  const calls: CallExpression[] = [];
  const captureBindings = new Map<string, string>();
  const captureInitializers = new Map<string, Node>();
  let assertionsStarted = false;
  for (const statement of body.getStatements()) {
    if (Node.isVariableStatement(statement) && !assertionsStarted) {
      if (
        !statement.getDeclarationKindKeywords().some((keyword) =>
          keyword.getKind() === SyntaxKind.ConstKeyword
        )
      ) break;
      const pending: Array<{ source: string; binding: string; initializer: Node }> = [];
      let valid = true;
      for (const variable of statement.getDeclarations()) {
        const name = variable.getNameNode();
        const initializer = variable.getInitializer();
        const source = initializer
          ? canonicalAuthorityText(initializer.getText())
          : "";
        if (
          !Node.isIdentifier(name) ||
          !initializer ||
          !requiredSources.has(source) ||
          captureBindings.has(source)
        ) {
          valid = false;
          break;
        }
        pending.push({
          source,
          binding: name.getText(),
          initializer,
        });
      }
      if (!valid || pending.length === 0) break;
      for (const capture of pending) {
        captureBindings.set(capture.source, capture.binding);
        captureInitializers.set(capture.source, capture.initializer);
      }
      continue;
    }
    if (!Node.isExpressionStatement(statement)) break;
    const expression = statement.getExpression();
    if (!Node.isCallExpression(expression)) break;
    if (!AUTHORITY_ASSERTIONS.some((assertion) =>
      callResolvesToDeclaration(expression, assertion.file, assertion.functionName)
    )) break;
    assertionsStarted = true;
    calls.push(expression);
  }
  return { calls, captureBindings, captureInitializers };
}

function capturedAuthorityArgument(
  expected: string,
  captures: ReadonlyMap<string, string>,
): string {
  const canonical = canonicalAuthorityText(expected);
  for (const [source, binding] of [...captures.entries()].sort(
    ([left], [right]) => right.length - left.length,
  )) {
    if (canonical === source || canonical.startsWith(`${source}.`)) {
      return `${binding}${canonical.slice(source.length)}`;
    }
  }
  return expected;
}

function repeatedAuthorityEvaluations(
  declaration: Node,
  captures: readonly RequiredAuthorityCapture[],
  initializers: ReadonlyMap<string, Node>,
  stableBindings: ReadonlySet<string>,
): string[] {
  const body = functionBody(declaration);
  if (!Node.isBlock(body)) return [];
  const unwrap = (node: Node | undefined): Node | undefined => {
    let expression = node;
    while (
      Node.isParenthesizedExpression(expression) ||
      Node.isAsExpression(expression) ||
      Node.isSatisfiesExpression(expression) ||
      Node.isTypeAssertion(expression) ||
      Node.isNonNullExpression(expression) ||
      Node.isAwaitExpression(expression)
    ) {
      expression = expression.getExpression();
    }
    return expression;
  };
  const memberText = (owner: string, name: string): string =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
      ? `${owner}.${name}`
      : `${owner}[${JSON.stringify(name)}]`;
  const propertyText = (node: Node | undefined, fallback: string): string | null => {
    if (!node) return fallback;
    if (Node.isIdentifier(node)) return node.getText();
    if (
      Node.isStringLiteral(node) ||
      Node.isNoSubstitutionTemplateLiteral(node) ||
      Node.isNumericLiteral(node)
    ) return node.getLiteralText();
    if (Node.isComputedPropertyName(node)) {
      const expression = unwrap(node.getExpression());
      if (
        Node.isStringLiteral(expression) ||
        Node.isNoSubstitutionTemplateLiteral(expression) ||
        Node.isNumericLiteral(expression)
      ) return expression.getLiteralText();
    }
    return null;
  };
  const assignments = body.getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter((candidate) =>
      candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken
    );
  const fixedMemberValues = (
    node: Node | undefined,
    name: string | null,
    seen: ReadonlySet<object> = new Set(),
  ): Node[] => {
    const expression = unwrap(node);
    if (!expression) return [];
    if (Node.isConditionalExpression(expression)) {
      return [
        ...fixedMemberValues(expression.getWhenTrue(), name, seen),
        ...fixedMemberValues(expression.getWhenFalse(), name, seen),
      ];
    }
    if (Node.isBinaryExpression(expression)) {
      const operator = expression.getOperatorToken().getKind();
      if (operator === SyntaxKind.CommaToken) {
        return fixedMemberValues(expression.getRight(), name, seen);
      }
      if (
        operator === SyntaxKind.BarBarToken ||
        operator === SyntaxKind.AmpersandAmpersandToken ||
        operator === SyntaxKind.QuestionQuestionToken
      ) {
        return [
          ...fixedMemberValues(expression.getLeft(), name, seen),
          ...fixedMemberValues(expression.getRight(), name, seen),
        ];
      }
    }
    if (Node.isArrayLiteralExpression(expression)) {
      if (name === null) {
        return expression.getElements().filter((element) =>
          !Node.isOmittedExpression(element)
        );
      }
      const index = Number.parseInt(name, 10);
      const element = expression.getElements()[index];
      return String(index) === name && element && !Node.isOmittedExpression(element)
        ? [element]
        : [];
    }
    if (Node.isObjectLiteralExpression(expression)) {
      return expression.getProperties().flatMap((property) => {
        if (Node.isSpreadAssignment(property)) {
          return fixedMemberValues(property.getExpression(), name, seen);
        }
        const propertyName = propertyText(
          property.getNameNode(),
          property.getName(),
        );
        if (name !== null && propertyName !== name) return [];
        if (Node.isPropertyAssignment(property)) {
          const initializer = property.getInitializer();
          return initializer ? [initializer] : [];
        }
        if (Node.isShorthandPropertyAssignment(property)) {
          return [property.getNameNode()];
        }
        if (Node.isGetAccessorDeclaration(property)) {
          return property.getBody()
            ?.getDescendantsOfKind(SyntaxKind.ReturnStatement)
            .flatMap((statement) => {
              const value = statement.getExpression();
              return value ? [value] : [];
            }) ?? [];
        }
        return [];
      });
    }
    if (Node.isCallExpression(expression)) {
      const transparent = normalizedAmbientBuiltinCall(
        expression,
        "Object",
        ["freeze", "seal", "preventExtensions"],
      );
      if (transparent?.arguments) {
        return fixedMemberValues(transparent.arguments[0], name, seen);
      }
    }
    if (!Node.isIdentifier(expression) || stableBindings.has(expression.getText())) {
      return [];
    }
    const symbol = expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return [];
    const nested = new Set(seen).add(key);
    const declaration = symbol?.getDeclarations().find(Node.isVariableDeclaration);
    const initializer = declaration?.getInitializer();
    const sources = [
      ...(initializer ? [initializer] : []),
      ...assignments
        .filter((candidate) =>
          candidate.getStart() < expression.getStart() &&
          Node.isIdentifier(unwrap(candidate.getLeft())) &&
          unwrap(candidate.getLeft())?.getSymbol() === symbol
        )
        .map((candidate) => candidate.getRight()),
    ];
    return sources.flatMap((source) =>
      fixedMemberValues(source, name, nested)
    );
  };
  const resolvedTexts = (
    node: Node | undefined,
    seen: ReadonlySet<object> = new Set(),
  ): string[] => {
    const expression = unwrap(node);
    if (!expression) return [];
    if (Node.isPropertyAccessExpression(expression)) {
      const values = fixedMemberValues(
        expression.getExpression(),
        expression.getName(),
        seen,
      );
      if (values.length > 0) {
        return [...new Set(values.flatMap((value) =>
          resolvedTexts(value, seen)
        ))];
      }
      return resolvedTexts(expression.getExpression(), seen)
        .map((owner) => memberText(owner, expression.getName()));
    }
    if (Node.isElementAccessExpression(expression)) {
      const name = propertyText(expression.getArgumentExpression(), "");
      const receiver = unwrap(expression.getExpression());
      const values = fixedMemberValues(receiver, name, seen);
      if (values.length > 0) {
        return [...new Set(values.flatMap((value) =>
          resolvedTexts(value, seen)
        ))];
      }
      return name === null
        ? resolvedTexts(receiver, seen)
        : resolvedTexts(receiver, seen)
          .map((owner) => memberText(owner, name));
    }
    if (Node.isConditionalExpression(expression)) {
      return [...new Set([
        ...resolvedTexts(expression.getWhenTrue(), seen),
        ...resolvedTexts(expression.getWhenFalse(), seen),
      ])];
    }
    if (Node.isBinaryExpression(expression)) {
      const operator = expression.getOperatorToken().getKind();
      if (operator === SyntaxKind.CommaToken) {
        return resolvedTexts(expression.getRight(), seen);
      }
      if (
        operator === SyntaxKind.BarBarToken ||
        operator === SyntaxKind.AmpersandAmpersandToken ||
        operator === SyntaxKind.QuestionQuestionToken
      ) {
        return [...new Set([
          ...resolvedTexts(expression.getLeft(), seen),
          ...resolvedTexts(expression.getRight(), seen),
        ])];
      }
    }
    if (Node.isCallExpression(expression)) {
      const transparent = normalizedAmbientBuiltinCall(
        expression,
        "Object",
        ["freeze", "seal", "preventExtensions"],
      );
      if (transparent) {
        if (transparent.arguments === null) {
          return captures.map((capture) =>
            canonicalAuthorityText(capture.source)
          );
        }
        return resolvedTexts(transparent.arguments[0], seen);
      }
    }
    if (!Node.isIdentifier(expression)) {
      return [canonicalAuthorityText(expression.getText())];
    }
    if (stableBindings.has(expression.getText())) return [expression.getText()];
    const symbol = expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return [expression.getText()];
    const nested = new Set(seen).add(key);
    const reachingAssignments = assignments
      .filter((candidate) =>
        candidate.getStart() < expression.getStart() &&
        Node.isIdentifier(unwrap(candidate.getLeft())) &&
        unwrap(candidate.getLeft())?.getSymbol() === symbol
      );
    const declaration = symbol?.getDeclarations().find(Node.isVariableDeclaration);
    const initializer = declaration?.getInitializer();
    const sources: Node[] = [
      ...(initializer ? [initializer] : []),
      ...reachingAssignments.map((assignment) => assignment.getRight()),
    ];
    return sources.length > 0
      ? [...new Set(sources.flatMap((source) => resolvedTexts(source, nested)))]
      : [expression.getText()];
  };
  const bindingSourcesOf = (element: Node): string[] => {
    if (!Node.isBindingElement(element)) return [];
    const pattern = element.getParent();
    const owner = pattern.getParent();
    const bases = Node.isVariableDeclaration(owner) ||
        Node.isParameterDeclaration(owner)
      ? resolvedTexts(owner.getInitializer())
      : Node.isBindingElement(owner)
      ? bindingSourcesOf(owner)
      : [];
    if (element.getDotDotDotToken()) return bases;
    if (Node.isObjectBindingPattern(pattern)) {
      const name = propertyText(
        element.getPropertyNameNode(),
        element.getName(),
      );
      return name === null ? [] : bases.map((base) => memberText(base, name));
    }
    if (Node.isArrayBindingPattern(pattern)) {
      const index = pattern.getElements().indexOf(element);
      return index < 0 ? [] : bases.map((base) => `${base}[${index}]`);
    }
    return [];
  };
  const authorityRead = (
    node: Node,
    sources: readonly string[],
    expands = false,
  ): Array<{ readonly node: Node; readonly source: string; readonly expands: boolean }> =>
    sources.map((source) => ({ node, source, expands }));
  const ambientCopyMethod = (
    node: Node,
    builtin: "Object" | "structuredClone",
    methods: readonly string[],
    seen: ReadonlySet<object> = new Set(),
  ): string | null => {
    const expression = unwrap(node);
    if (!expression) return null;
    const symbol = expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return null;
    const visited = new Set(seen).add(key);
    if (Node.isIdentifier(expression)) {
      if (
        builtin === "structuredClone" &&
        expression.getText() === builtin &&
        (symbol?.getDeclarations() ?? []).every((declaration) =>
          declaration.getSourceFile().isDeclarationFile()
        )
      ) return builtin;
      for (const source of bindingSources(expression)) {
        const method = ambientCopyMethod(source, builtin, methods, visited);
        if (method) return method;
      }
      const binding = symbol?.getDeclarations().find(Node.isBindingElement);
      const pattern = binding?.getParent();
      const owner = pattern?.getParent();
      if (
        binding &&
        Node.isObjectBindingPattern(pattern) &&
        Node.isVariableDeclaration(owner)
      ) {
        const method = propertyText(
          binding.getPropertyNameNode(),
          binding.getName(),
        );
        const receiver = unwrap(owner.getInitializer());
        if (
          method &&
          methods.includes(method) &&
          Node.isIdentifier(receiver) &&
          receiver.getText() === builtin &&
          (receiver.getSymbol()?.getDeclarations() ?? []).every((declaration) =>
            declaration.getSourceFile().isDeclarationFile()
          )
        ) return method;
      }
      return null;
    }
    if (!Node.isPropertyAccessExpression(expression)) return null;
    const receiver = unwrap(expression.getExpression());
    return methods.includes(expression.getName()) &&
      Node.isIdentifier(receiver) &&
      receiver.getText() === builtin &&
      (receiver.getSymbol()?.getDeclarations() ?? []).every((declaration) =>
        declaration.getSourceFile().isDeclarationFile()
      )
      ? expression.getName()
      : null;
  };
  const copyCallSources = (call: CallExpression): Node[] => {
    const method = ambientCopyMethod(
      call.getExpression(),
      "Object",
      ["assign", "entries", "values"],
    );
    if (method === "assign") return call.getArguments().slice(1);
    if (method === "entries" || method === "values") {
      return call.getArguments().slice(0, 1);
    }
    if (ambientCopyMethod(
      call.getExpression(),
      "structuredClone",
      ["structuredClone"],
    )) return call.getArguments().slice(0, 1);
    return [];
  };
  const literalKeys = (
    node: Node | undefined,
    seen: ReadonlySet<object> = new Set(),
  ): string[] | null => {
    const expression = unwrap(node);
    if (!expression) return null;
    if (
      Node.isStringLiteral(expression) ||
      Node.isNoSubstitutionTemplateLiteral(expression) ||
      Node.isNumericLiteral(expression)
    ) return [expression.getLiteralText()];
    if (Node.isConditionalExpression(expression)) {
      const left = literalKeys(expression.getWhenTrue(), seen);
      const right = literalKeys(expression.getWhenFalse(), seen);
      return left && right ? [...new Set([...left, ...right])] : null;
    }
    if (Node.isBinaryExpression(expression)) {
      const operator = expression.getOperatorToken().getKind();
      if (operator === SyntaxKind.CommaToken) {
        return literalKeys(expression.getRight(), seen);
      }
      if (
        operator === SyntaxKind.BarBarToken ||
        operator === SyntaxKind.AmpersandAmpersandToken ||
        operator === SyntaxKind.QuestionQuestionToken
      ) {
        const left = literalKeys(expression.getLeft(), seen);
        const right = literalKeys(expression.getRight(), seen);
        return left && right ? [...new Set([...left, ...right])] : null;
      }
    }
    if (!Node.isIdentifier(expression)) return null;
    const symbol = expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return null;
    const nested = new Set(seen).add(key);
    const sources = [
      ...(symbol?.getDeclarations() ?? []).flatMap((candidate) =>
        Node.isVariableDeclaration(candidate) && candidate.getInitializer()
          ? [candidate.getInitializerOrThrow()]
          : []
      ),
      ...assignments
        .filter((candidate) =>
          candidate.getStart() < expression.getStart() &&
          Node.isIdentifier(unwrap(candidate.getLeft())) &&
          unwrap(candidate.getLeft())?.getSymbol() === symbol
        )
        .map((candidate) => candidate.getRight()),
    ];
    if (sources.length === 0) return null;
    const keys = sources.map((source) => literalKeys(source, nested));
    return keys.every((candidate): candidate is string[] => candidate !== null)
      ? [...new Set(keys.flat())]
      : null;
  };
  const reflectedAuthoritySources = (call: CallExpression): Array<{
    readonly node: Node;
    readonly source: string;
    readonly expands: boolean;
  }> => {
    const reflected = normalizedAmbientBuiltinCall(
      call,
      "Reflect",
      ["get", "getOwnPropertyDescriptor"],
    );
    const described = normalizedAmbientBuiltinCall(
      call,
      "Object",
      ["getOwnPropertyDescriptor", "getOwnPropertyDescriptors"],
    );
    const invocation = reflected ?? described;
    if (!invocation) return [];
    if (invocation.arguments === null) {
      return captures.map((capture) => ({
        node: call,
        source: canonicalAuthorityText(capture.source),
        expands: true,
      }));
    }
    const [receiver, key] = invocation.arguments;
    if (!receiver) return [];
    const bases = resolvedTexts(receiver);
    if (invocation.method === "getOwnPropertyDescriptors") {
      return authorityRead(call, bases, true);
    }
    const keys = literalKeys(key);
    return keys === null
      ? authorityRead(call, bases, true)
      : keys.flatMap((name) =>
        authorityRead(
          call,
          bases.map((base) => memberText(base, name)),
        )
      );
  };
  const reads: Array<{
    readonly node: Node;
    readonly source: string;
    readonly expands: boolean;
  }> = [
    ...body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .flatMap((node) => authorityRead(node, resolvedTexts(node))),
    ...body.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
      .flatMap((node) => authorityRead(node, resolvedTexts(node))),
    ...body.getDescendantsOfKind(SyntaxKind.BindingElement)
      .flatMap((node) =>
        authorityRead(node, bindingSourcesOf(node), node.getDotDotDotToken() !== undefined)
      ),
    ...body.getDescendantsOfKind(SyntaxKind.SpreadAssignment)
      .flatMap((node) =>
        authorityRead(node, resolvedTexts(node.getExpression()), true)
      ),
    ...body.getDescendantsOfKind(SyntaxKind.CallExpression)
      .flatMap((call) =>
        [
          ...copyCallSources(call).flatMap((source) =>
            authorityRead(call, resolvedTexts(source), true)
          ),
          ...reflectedAuthoritySources(call),
        ]
      ),
  ];
  const collectAssignmentReads = (pattern: Node, base: string): void => {
    const target = unwrap(pattern);
    if (Node.isObjectLiteralExpression(target)) {
      for (const property of target.getProperties()) {
        if (Node.isSpreadAssignment(property)) {
          reads.push({ node: property, source: base, expands: true });
          continue;
        }
        if (
          !Node.isPropertyAssignment(property) &&
          !Node.isShorthandPropertyAssignment(property)
        ) continue;
        const name = propertyText(property.getNameNode(), property.getName());
        if (name === null) continue;
        const source = memberText(base, name);
        const value = Node.isPropertyAssignment(property)
          ? property.getInitializer()
          : property.getNameNode();
        const unwrappedValue = unwrap(value);
        if (
          Node.isObjectLiteralExpression(unwrappedValue) ||
          Node.isArrayLiteralExpression(unwrappedValue)
        ) {
          collectAssignmentReads(unwrappedValue, source);
        } else {
          reads.push({ node: property, source, expands: false });
        }
      }
      return;
    }
    if (Node.isArrayLiteralExpression(target)) {
      target.getElements().forEach((element, index) => {
        const source = `${base}[${index}]`;
        const value = unwrap(element);
        if (
          Node.isObjectLiteralExpression(value) ||
          Node.isArrayLiteralExpression(value)
        ) {
          collectAssignmentReads(value, source);
        } else {
          reads.push({ node: element, source, expands: false });
        }
      });
    }
  };
  for (const assignment of assignments) {
    const left = unwrap(assignment.getLeft());
    if (
      !Node.isObjectLiteralExpression(left) &&
      !Node.isArrayLiteralExpression(left)
    ) continue;
    for (const base of resolvedTexts(assignment.getRight())) {
      collectAssignmentReads(left, base);
    }
  }
  const stableSymbols = new Map<object, string>();
  const stableDeclarations = [
    ...declaration.getDescendantsOfKind(SyntaxKind.Parameter)
      .filter((parameter) =>
        parameter.getFirstAncestor((ancestor) =>
          Node.isFunctionLikeDeclaration(ancestor)
        ) === declaration
      ),
    ...body.getStatements().flatMap((statement) =>
      Node.isVariableStatement(statement) ? statement.getDeclarations() : []
    ),
  ];
  for (const stableDeclaration of stableDeclarations) {
    const root = stableDeclaration.getNameNode();
    const names = Node.isIdentifier(root)
      ? [root]
      : root.getDescendantsOfKind(SyntaxKind.BindingElement).flatMap((element) => {
        const name = element.getNameNode();
        return Node.isIdentifier(name) ? [name] : [];
      });
    for (const name of names) {
      if (!stableBindings.has(name.getText())) continue;
      const symbol = name.getSymbol();
      if (symbol) stableSymbols.set(symbol as unknown as object, name.getText());
    }
  }
  const writes: string[] = [];
  const recordWrites = (target: Node): void => {
    for (const identifier of [
      ...(Node.isIdentifier(target) ? [target] : []),
      ...target.getDescendantsOfKind(SyntaxKind.Identifier),
    ]) {
      const parent = identifier.getParent();
      const bindings = [
        identifier.getSymbol(),
        Node.isShorthandPropertyAssignment(parent)
          ? parent.getValueSymbol()
          : undefined,
      ];
      const name = bindings.flatMap((binding) =>
        binding ? [stableSymbols.get(binding as unknown as object)] : []
      ).find((candidate) => candidate !== undefined);
      if (name) writes.push(name);
    }
  };
  for (const assignment of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = assignment.getOperatorToken().getKind();
    if (
      operator < ts.SyntaxKind.FirstAssignment ||
      operator > ts.SyntaxKind.LastAssignment
    ) continue;
    recordWrites(assignment.getLeft());
  }
  for (const update of [
    ...body.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
    ...body.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
  ]) {
    if (
      update.getOperatorToken() !== SyntaxKind.PlusPlusToken &&
      update.getOperatorToken() !== SyntaxKind.MinusMinusToken
    ) continue;
    recordWrites(update.getOperand());
  }
  for (const loop of [
    ...body.getDescendantsOfKind(SyntaxKind.ForInStatement),
    ...body.getDescendantsOfKind(SyntaxKind.ForOfStatement),
  ]) {
    const initializer = loop.getInitializer();
    if (!Node.isVariableDeclarationList(initializer)) recordWrites(initializer);
  }
  return captures.flatMap((capture) => {
    const source = canonicalAuthorityText(capture.source);
    const initializer = initializers.get(source);
    const repeated = reads.some((read) =>
      read.node.getStart() !== initializer?.getStart() &&
      (
        read.source === source ||
        read.source.startsWith(`${source}.`) ||
        read.source.startsWith(`${source}[`) ||
        (read.expands && source.startsWith(`${read.source}.`)) ||
        (read.expands && source.startsWith(`${read.source}[`))
      )
    );
    return repeated
      ? [
        `wrapped authority '${capture.source}' must be evaluated exactly once into its const prologue binding`,
      ]
      : [];
  }).concat(
    [...new Set(writes)].map((binding) =>
      `sealed authority binding '${binding}' must not be reassigned after its prologue assertion`
    ),
  );
}

/** One message per required assertion that is missing from the prologue. */
export function authorityPrologueViolations(
  declaration: Node,
  required: readonly RequiredAuthorityAssertion[],
  captures: readonly RequiredAuthorityCapture[] = [],
): string[] {
  if (required.length === 0 && captures.length === 0) return [];
  if (!Node.isBlock(functionBody(declaration))) {
    return [
      ...captures.map((capture) =>
        `const capture of ${capture.source} cannot run: the boundary has no statement body`
      ),
      ...required.map((requirement) =>
        `${requirement.functionName}(${requirement.args.join(", ")}) cannot run: the boundary has no statement body`,
      ),
    ];
  }
  const prologue = authorityPrologue(declaration, captures);
  const missingCaptures = captures
    .filter((capture) =>
      !prologue.captureBindings.has(canonicalAuthorityText(capture.source))
    )
    .map((capture) =>
      `wrapped authority '${capture.source}' must be captured exactly once in a const binding at the start of the authority prologue`,
    );
  const missingAssertions = required
    .filter((requirement) =>
      !prologue.calls.some((call) =>
        callResolvesToDeclaration(call, requirement.file, requirement.functionName) &&
        (
          requirement.args.every((expected, index) =>
            authorityArgumentMatches(
              call.getArguments()[index],
              capturedAuthorityArgument(expected, prologue.captureBindings),
            )
          ) ||
          (
            requirement.functionName === "assertSameTenant" &&
            requirement.args.length === 2 &&
            requirement.args.every((expected, index) =>
              authorityArgumentMatches(
                call.getArguments()[1 - index],
                capturedAuthorityArgument(expected, prologue.captureBindings),
              )
            )
          )
        )
      )
    )
    .map((requirement) =>
      `${requirement.functionName}(${requirement.args.join(", ")}) must appear in the contiguous authority prologue, before any side effect, database call, or branching logic`,
    );
  const stableBindings = new Set([
    ...prologue.captureBindings.values(),
    ...required
      .filter((requirement) => requirement.functionName !== "assertSameTenant")
      .map((requirement) =>
        capturedAuthorityArgument(
          requirement.args[0] ?? "",
          prologue.captureBindings,
        )
      )
      .filter((argument) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(argument)),
  ]);
  return [
    ...missingCaptures,
    ...missingAssertions,
    ...repeatedAuthorityEvaluations(
      declaration,
      captures,
      prologue.captureInitializers,
      stableBindings,
    ),
  ];
}

const SQL_EXECUTOR_METHODS = new Set(["exec", "execute", "query"]);

/**
 * A RESOLVED SQL-executor call: `db.query(sql, …)` / `tx.exec(sql)`.
 *
 * Keyed on the CALLEE'S SIGNATURE — the name it is DECLARED under and the SQL string
 * it takes — never on how the call is written at the site. Requiring a
 * PropertyAccessExpression made the whole app-layer-persistence rule a one-line
 * evasion: `const { query } = db; query("SELECT … FROM users …")`, `db["query"](…)`,
 * and even `const { query: run } = db; run(…)` issue exactly the same SQL from
 * exactly the same place, with no repository signature to carry an ActionGrant or a
 * sealed TenantContext. Reading the DECLARED name (not the local binding) is what
 * makes all three resolve alike; an unrelated `.query()` that takes no SQL string is
 * still not mistaken for persistence.
 */
/** Does this type's own signature declare it an executor (`query(sql: string, …)`)? */
function declaresExecutorSignature(type: Type): boolean {
  return type.getCallSignatures().some((signature) => {
    const method = signature.getDeclaration().getSymbol()?.getName();
    if (!method || !SQL_EXECUTOR_METHODS.has(method)) return false;
    const parameter = signature.getParameters()[0];
    const declaration = parameter?.getValueDeclaration() ??
      parameter?.getDeclarations()[0];
    return Boolean(parameter && declaration &&
      parameter.getTypeAtLocation(declaration).isString());
  });
}

/**
 * An anonymous signature (`__type`/`__call`, what a cast to a function type or an
 * inline function type yields) resolves to no DECLARED name, so it proves nothing
 * about what is being called and must not count as "the checker answered".
 */
function declaredCalleeNames(type: Type): string[] {
  return type.getCallSignatures()
    .map((signature) => signature.getDeclaration().getSymbol()?.getName())
    .filter((name): name is string => Boolean(name) && !name!.startsWith("__"));
}

/** The expression a widened local was BOUND from: `const run: Function = db.query`. */
function bindingSources(
  expression: Node,
  seen: ReadonlySet<object> = new Set(),
): Node[] {
  if (!Node.isIdentifier(expression)) return [];
  const symbol = expression.getSymbol();
  const key = (symbol ?? expression) as unknown as object;
  if (seen.has(key)) return [];
  const nested = new Set(seen).add(key);
  const direct: Node[] = [];
  for (const declaration of symbol?.getDeclarations() ?? []) {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (initializer) direct.push(initializer);
      continue;
    }
    if (!Node.isBindingElement(declaration)) continue;
    const pattern = declaration.getParent();
    const owner = pattern.getParent();
    if (!Node.isArrayBindingPattern(pattern) ||
      !Node.isVariableDeclaration(owner)) continue;
    const initializer = owner.getInitializer();
    const elements = staticArrayElements(initializer, nested);
    const index = pattern.getElements().findIndex((element) =>
      element === declaration
    );
    if (!elements || index < 0) continue;
    const element = elements[index];
    if (element && !Node.isOmittedExpression(element)) direct.push(element);
  }
  direct.push(
    ...expression.getSourceFile()
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter((candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < expression.getStart() &&
        Node.isIdentifier(unwrapSqlExpression(candidate.getLeft())) &&
        unwrapSqlExpression(candidate.getLeft()).getSymbol() === symbol
      )
      .map((candidate) => candidate.getRight()),
  );
  for (const assignment of expression.getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (
      assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken ||
      assignment.getStart() >= expression.getStart()
    ) continue;
    const left = unwrapSqlExpression(assignment.getLeft());
    if (!Node.isArrayLiteralExpression(left)) continue;
    const index = left.getElements().findIndex((element) =>
      Node.isIdentifier(element) && element.getSymbol() === symbol
    );
    const elements = staticArrayElements(assignment.getRight(), nested);
    if (!elements || index < 0) continue;
    const element = elements[index];
    if (element && !Node.isOmittedExpression(element)) direct.push(element);
  }
  const expand = (node: Node): Node[] => {
    const source = unwrapSqlExpression(node);
    if (Node.isConditionalExpression(source)) {
      return [
        ...expand(source.getWhenTrue()),
        ...expand(source.getWhenFalse()),
      ];
    }
    if (Node.isBinaryExpression(source)) {
      const operator = source.getOperatorToken().getKind();
      if (operator === SyntaxKind.CommaToken) return expand(source.getRight());
      if (
        operator === SyntaxKind.BarBarToken ||
        operator === SyntaxKind.AmpersandAmpersandToken ||
        operator === SyntaxKind.QuestionQuestionToken
      ) return [...expand(source.getLeft()), ...expand(source.getRight())];
    }
    return [source, ...bindingSources(source, nested)];
  };
  return direct.flatMap(expand);
}

function bindingMemberSources(
  expression: Node,
): Array<{ readonly receiver: Node; readonly member: string }> {
  if (!Node.isIdentifier(expression)) return [];
  const symbol = expression.getSymbol();
  const out: Array<{ receiver: Node; member: string }> = [];
  const memberName = (node: Node | undefined, fallback: string): string | null => {
    if (!node) return fallback;
    if (Node.isIdentifier(node)) return node.getText();
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      return node.getLiteralText();
    }
    return null;
  };
  for (const declaration of symbol?.getDeclarations() ?? []) {
    if (!Node.isBindingElement(declaration)) continue;
    const pattern = declaration.getParent();
    const owner = pattern.getParent();
    const receiver = Node.isObjectBindingPattern(pattern) &&
        Node.isVariableDeclaration(owner)
      ? owner.getInitializer()
      : undefined;
    const member = memberName(
      declaration.getPropertyNameNode(),
      declaration.getName(),
    );
    if (receiver && member) out.push({ receiver, member });
  }
  for (const assignment of expression.getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (
      assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken ||
      assignment.getStart() >= expression.getStart()
    ) continue;
    const left = unwrapSqlExpression(assignment.getLeft());
    if (!Node.isObjectLiteralExpression(left)) continue;
    for (const property of left.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const initializer = property.getInitializer();
      if (!initializer) continue;
      const target = unwrapSqlExpression(initializer);
      const member = memberName(property.getNameNode(), property.getName());
      if (Node.isIdentifier(target) && target.getSymbol() === symbol && member) {
        out.push({ receiver: assignment.getRight(), member });
      }
    }
  }
  return out;
}

/** The name an expression NAMES, if it names one: `db.query` → "query". */
function accessedName(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isElementAccessExpression(node)) {
    const argument = node.getArgumentExpression();
    return argument && Node.isStringLiteral(argument) ? argument.getLiteralValue() : undefined;
  }
  return undefined;
}

/**
 * A statement string, by its leading command word. A SQL string handed to a callee
 * nobody can resolve is persistence whatever the local happens to be called.
 */
const SQL_STATEMENT_RE =
  /^\s*\(?\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|GRANT|REVOKE|LOCK|COMMENT|REFRESH|EXPLAIN|VACUUM|ANALYZE|DO|BEGIN|COMMIT|ROLLBACK|SAVEPOINT)\b/i;

function issuesSqlLiteral(arguments_: readonly Node[]): boolean {
  const [first] = arguments_;
  if (!first) return false;
  const text = Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)
    ? first.getLiteralValue()
    : Node.isTemplateExpression(first)
    ? first.getText()
    : undefined;
  return Boolean(text && SQL_STATEMENT_RE.test(text));
}

function unwrapSqlExpression(node: Node): Node {
  let expression = node;
  while (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isNonNullExpression(expression)
  ) expression = expression.getExpression();
  return expression;
}

function isSqlExecutorExpression(
  source: Node,
  arguments_: readonly Node[],
): boolean {
  const expression = unwrapSqlExpression(source);
  if (
    Node.isIdentifier(expression) &&
    bindingMemberSources(expression).some(({ member }) =>
      SQL_EXECUTOR_METHODS.has(member)
    )
  ) return true;
  const calleeType = expression.getType();
  if (declaresExecutorSignature(calleeType)) return true;
  if (declaredCalleeNames(calleeType).length > 0) return false;
  const written = accessedName(expression);
  if (written && SQL_EXECUTOR_METHODS.has(written)) return true;
  if (issuesSqlLiteral(arguments_)) return true;
  const [argument] = arguments_;
  if (!argument || !Node.isExpression(argument)) return false;
  const argumentType = argument.getType();
  if (!argumentType.isString() && !argumentType.isStringLiteral()) return false;
  return bindingSources(expression).some((source) =>
    declaresExecutorSignature(source.getType()) ||
    SQL_EXECUTOR_METHODS.has(accessedName(source) ?? "")
  );
}

function sqlMember(node: Node): string | undefined {
  const expression = unwrapSqlExpression(node);
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  if (Node.isElementAccessExpression(expression)) {
    const argument = unwrapSqlExpression(expression.getArgumentExpression() ?? expression);
    return Node.isStringLiteral(argument) ||
      Node.isNoSubstitutionTemplateLiteral(argument)
      ? argument.getLiteralValue()
      : undefined;
  }
  return undefined;
}

function staticArrayElements(
  node: Node | undefined,
  seen: ReadonlySet<object> = new Set(),
): readonly Node[] | null {
  if (!node) return null;
  const expression = unwrapSqlExpression(node);
  if (Node.isArrayLiteralExpression(expression)) {
    return expression.getElements().some(Node.isSpreadElement)
      ? null
      : expression.getElements();
  }
  if (Node.isIdentifier(expression)) {
    const symbol = expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return null;
    const nested = new Set(seen).add(key);
    for (const source of bindingSources(expression, seen)) {
      const elements = staticArrayElements(source, nested);
      if (elements) return elements;
    }
  }
  return null;
}

function staticArrayElementAlternatives(
  node: Node | undefined,
  seen: ReadonlySet<object> = new Set(),
): readonly (readonly Node[])[] | null {
  if (!node) return null;
  const expression = unwrapSqlExpression(node);
  if (Node.isArrayLiteralExpression(expression)) {
    return expression.getElements().some(Node.isSpreadElement)
      ? null
      : [expression.getElements()];
  }
  if (Node.isConditionalExpression(expression)) {
    const whenTrue = staticArrayElementAlternatives(
      expression.getWhenTrue(),
      seen,
    );
    const whenFalse = staticArrayElementAlternatives(
      expression.getWhenFalse(),
      seen,
    );
    return whenTrue === null || whenFalse === null
      ? null
      : [...whenTrue, ...whenFalse];
  }
  if (
    Node.isBinaryExpression(expression) &&
    PROVENANCE_CHOICE_OPERATORS.has(expression.getOperatorToken().getKind())
  ) {
    const left = staticArrayElementAlternatives(expression.getLeft(), seen);
    const right = staticArrayElementAlternatives(expression.getRight(), seen);
    return left === null || right === null ? null : [...left, ...right];
  }
  if (!Node.isIdentifier(expression)) return null;
  const symbol = expression.getSymbol();
  const key = (symbol ?? expression) as unknown as object;
  if (seen.has(key)) return null;
  const nested = new Set(seen).add(key);
  const sources = bindingSources(expression, seen);
  if (sources.length === 0) return null;
  const alternatives: (readonly Node[])[] = [];
  for (const source of sources) {
    const resolved = staticArrayElementAlternatives(source, nested);
    if (resolved === null) return null;
    alternatives.push(...resolved);
  }
  return alternatives;
}

function isAmbientBuiltinObject(
  node: Node,
  builtin: "Object" | "Reflect",
  seen: ReadonlySet<object> = new Set(),
): boolean {
  const expression = unwrapSqlExpression(node);
  const symbol = expression.getSymbol();
  const key = (symbol ?? expression) as unknown as object;
  if (seen.has(key)) return false;
  const nested = new Set(seen).add(key);
  if (Node.isIdentifier(expression)) {
    if (
      expression.getText() === builtin &&
      (symbol?.getDeclarations() ?? []).every((declaration) =>
        declaration.getSourceFile().isDeclarationFile()
      )
    ) return true;
    return bindingSources(expression).some((source) =>
      isAmbientBuiltinObject(source, builtin, nested)
    );
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return expression.getName() === builtin &&
      Node.isIdentifier(unwrapSqlExpression(expression.getExpression())) &&
      unwrapSqlExpression(expression.getExpression()).getText() ===
        "globalThis";
  }
  return false;
}

function ambientBuiltinMethodName(
  node: Node,
  builtin: "Object" | "Reflect",
  methods: readonly string[],
  seen: ReadonlySet<object> = new Set(),
): string | null {
  const expression = unwrapSqlExpression(node);
  const symbol = expression.getSymbol();
  const key = (symbol ?? expression) as unknown as object;
  if (seen.has(key)) return null;
  const nested = new Set(seen).add(key);
  if (Node.isIdentifier(expression)) {
    for (const source of bindingSources(expression)) {
      const method = ambientBuiltinMethodName(
        source,
        builtin,
        methods,
        nested,
      );
      if (method) return method;
    }
    for (const source of bindingMemberSources(expression)) {
      if (
        methods.includes(source.member) &&
        isAmbientBuiltinObject(source.receiver, builtin)
      ) return source.member;
    }
    return null;
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return methods.includes(expression.getName()) &&
      isAmbientBuiltinObject(expression.getExpression(), builtin)
      ? expression.getName()
      : null;
  }
  if (Node.isElementAccessExpression(expression)) {
    const argument = unwrapSqlExpression(
      expression.getArgumentExpression() ?? expression,
    );
    if (Node.isNumericLiteral(argument)) {
      const elements = staticArrayElements(expression.getExpression());
      const element = elements?.[Number.parseInt(argument.getLiteralText(), 10)];
      if (element) {
        return ambientBuiltinMethodName(
          element,
          builtin,
          methods,
          nested,
        );
      }
    }
    const member = sqlMember(expression);
    return member &&
      methods.includes(member) &&
      isAmbientBuiltinObject(expression.getExpression(), builtin)
      ? member
      : null;
  }
  return null;
}

function normalizedAmbientBuiltinCall(
  call: CallExpression,
  builtin: "Object" | "Reflect",
  methods: readonly string[],
): { readonly method: string; readonly arguments: readonly Node[] | null } | null {
  const callee = unwrapSqlExpression(call.getExpression());
  const direct = ambientBuiltinMethodName(callee, builtin, methods);
  if (direct) return { method: direct, arguments: call.getArguments() };
  if (
    Node.isPropertyAccessExpression(callee) ||
    Node.isElementAccessExpression(callee)
  ) {
    const wrapper = sqlMember(callee);
    const target = callee.getExpression();
    const method = ambientBuiltinMethodName(target, builtin, methods);
    if (method && wrapper === "call") {
      return { method, arguments: call.getArguments().slice(1) };
    }
    if (method && wrapper === "apply") {
      return {
        method,
        arguments: staticArrayElements(call.getArguments()[1]),
      };
    }
  }
  if (Node.isCallExpression(callee)) {
    const binder = unwrapSqlExpression(callee.getExpression());
    if (
      (
        Node.isPropertyAccessExpression(binder) ||
        Node.isElementAccessExpression(binder)
      ) &&
      sqlMember(binder) === "bind"
    ) {
      const method = ambientBuiltinMethodName(
        binder.getExpression(),
        builtin,
        methods,
      );
      if (method) {
        return {
          method,
          arguments: [
            ...callee.getArguments().slice(1),
            ...call.getArguments(),
          ],
        };
      }
    }
  }
  if (isAmbientReflectApply(callee)) {
    const method = ambientBuiltinMethodName(
      call.getArguments()[0] ?? callee,
      builtin,
      methods,
    );
    if (method) {
      return {
        method,
        arguments: staticArrayElements(call.getArguments()[2]),
      };
    }
  }
  return null;
}

function isAmbientReflectApply(node: Node): boolean {
  return ambientBuiltinMethodName(node, "Reflect", ["apply"]) === "apply";
}

export interface NormalizedSqlExecutorCall {
  readonly executor: Node;
  readonly receiver: Node | undefined;
  readonly arguments: readonly Node[];
  readonly argumentsResolved: boolean;
}

function boundSqlExecutor(node: Node): Omit<NormalizedSqlExecutorCall, "argumentsResolved"> | null {
  const expression = unwrapSqlExpression(node);
  if (Node.isIdentifier(expression)) {
    for (const source of bindingSources(expression)) {
      const bound = boundSqlExecutor(source);
      if (bound) return bound;
    }
    return null;
  }
  if (!Node.isCallExpression(expression)) return null;
  const binder = unwrapSqlExpression(expression.getExpression());
  if (
    (!Node.isPropertyAccessExpression(binder) &&
      !Node.isElementAccessExpression(binder)) ||
    sqlMember(binder) !== "bind"
  ) return null;
  const executor = binder.getExpression();
  const arguments_ = expression.getArguments().slice(1);
  if (!isSqlExecutorExpression(executor, arguments_)) return null;
  return {
    executor,
    receiver: expression.getArguments()[0],
    arguments: arguments_,
  };
}

export function normalizeSqlExecutorCall(
  call: CallExpression,
): NormalizedSqlExecutorCall | null {
  const callee = unwrapSqlExpression(call.getExpression());
  const direct = call.getArguments();
  if (
    Node.isPropertyAccessExpression(callee) ||
    Node.isElementAccessExpression(callee)
  ) {
    const member = sqlMember(callee);
    const executor = callee.getExpression();
    if (member === "call" && isSqlExecutorExpression(executor, direct.slice(1))) {
      return {
        executor,
        receiver: direct[0],
        arguments: direct.slice(1),
        argumentsResolved: true,
      };
    }
    if (member === "apply" && isSqlExecutorExpression(executor, [])) {
      const arguments_ = staticArrayElements(direct[1]);
      return {
        executor,
        receiver: direct[0],
        arguments: arguments_ ?? [],
        argumentsResolved: arguments_ !== null,
      };
    }
  }
  if (
    isAmbientReflectApply(callee) &&
    direct[0] &&
    isSqlExecutorExpression(direct[0], [])
  ) {
    const arguments_ = staticArrayElements(direct[2]);
    return {
      executor: direct[0]!,
      receiver: direct[1],
      arguments: arguments_ ?? [],
      argumentsResolved: arguments_ !== null,
    };
  }
  const bound = boundSqlExecutor(callee);
  if (bound) {
    return {
      ...bound,
      arguments: [...bound.arguments, ...direct],
      argumentsResolved: true,
    };
  }
  if (!isSqlExecutorExpression(callee, direct)) return null;
  const receiver = Node.isPropertyAccessExpression(callee) ||
      Node.isElementAccessExpression(callee)
    ? callee.getExpression()
    : undefined;
  return {
    executor: callee,
    receiver,
    arguments: direct,
    argumentsResolved: true,
  };
}

export function isSqlExecutorCall(call: CallExpression): boolean {
  return normalizeSqlExecutorCall(call) !== null;
}

/**
 * Raw SQL issued from the APP layer. Both security derivations that stand behind
 * a persistence read — governed-sink derivation (does this PII read owe an
 * ActionGrant?) and tenant-scope derivation (does this query carry a sealed
 * TenantContext?) — scan src/infrastructure/ only, because a repository is where
 * a boundary can be declared. So an inline `db.query("SELECT … FROM users …")` in
 * a route is not a smaller version of a repository call: it is outside both
 * fences entirely. Shared by the governed-actions and tenant-context fences so
 * the two halves of the rule can never drift apart.
 */
export function detectAppLayerSqlAccess(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!file.startsWith("src/app/") || file.includes("/__tests__/")) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isSqlExecutorCall(call)) {
        out.push(
          `${file}:${call.getStartLineNumber()} - raw SQL in the app layer bypasses governed-sink and tenant-scope derivation; move it behind an infrastructure repository`,
        );
      }
    }
  }
  return out;
}

/** Read a shipped source file's contents (for content-scan fences). */
export function readShipped(): Array<{ path: string; rel: string; text: string }> {
  return shippedSourceFiles().map((path) => ({
    path,
    rel: relative(REPO_ROOT, path),
    text: readFileSync(path, "utf8"),
  }));
}

/**
 * Strip line comments and block-comment lines so prose does not trip content
 * scans. String-aware: a `//` INSIDE a string literal (e.g. "http://x") is code,
 * not a comment — truncating there would let everything after it evade the fence.
 */
export function stripComments(line: string): string {
  if (/^\s*\*/.test(line) || /^\s*\/\*/.test(line)) return "";
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += line[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") break;
    out += ch;
  }
  return out;
}
