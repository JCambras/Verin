/**
 * Shared fence utilities. Fences prefer AST (ts-morph) and file-content scanning
 * over naive regex, and resolve relative + dynamic imports — the seams both prior
 * builds leaked through (retro-r7 don't-again #23, #35). Every fence that uses
 * these also ships a co-located "detects" companion that feeds a synthetic
 * violation and asserts it is caught (charter #4: detection is not verification).
 */
import { Node, Project, SyntaxKind, ts, type CallExpression, type CompilerOptions, type SourceFile } from "ts-morph";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SRC_ROOT = join(REPO_ROOT, "src");
const IN_MEMORY_SRC_ROOT = resolve("/src");

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
  if (!/\.(ts|tsx)$/.test(filePath)) return false;
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

function classifySpecifier(
  project: Project,
  fromFile: string,
  specifier: string,
): SpecifierClassification {
  const sourceRoot = sourceRootOf(fromFile);
  if (sourceRoot === null) return { kind: "external" };
  const compilerOptions = project.getCompilerOptions();
  const resolvedModule = ts.resolveModuleName(
    specifier,
    fromFile,
    compilerOptions,
    project.getModuleResolutionHost(),
  ).resolvedModule;
  if (resolvedModule) {
    const target = resolve(resolvedModule.resolvedFileName);
    const layer =
      layerWithinSourceRoot(target, sourceRoot) ??
      layerWithinSourceRoot(target, SRC_ROOT) ??
      layerWithinSourceRoot(target, IN_MEMORY_SRC_ROOT);
    if (layer !== null) return { kind: "layer", layer };
    const segments = target.split(/[/\\]/);
    if (resolvedModule.isExternalLibraryImport || segments.includes("node_modules")) {
      return { kind: "external" };
    }
    return { kind: "local-unclassified" };
  }
  const targets = specifier.startsWith(".") || isAbsolute(specifier)
    ? [resolve(dirname(fromFile), specifier)]
    : configuredPathTargets(specifier, compilerOptions);
  if (targets.length === 0) return { kind: "external" };
  const layers = new Set(
    targets.flatMap((target) => {
      const layer =
        layerWithinSourceRoot(target, sourceRoot) ??
        layerWithinSourceRoot(target, SRC_ROOT) ??
        layerWithinSourceRoot(target, IN_MEMORY_SRC_ROOT);
      return layer === null ? [] : [layer];
    }),
  );
  if (layers.size === 1 && targets.every((target) =>
    layerWithinSourceRoot(target, sourceRoot) !== null ||
    layerWithinSourceRoot(target, SRC_ROOT) !== null ||
    layerWithinSourceRoot(target, IN_MEMORY_SRC_ROOT) !== null
  )) {
    return { kind: "layer", layer: [...layers][0]! };
  }
  return { kind: "local-unclassified" };
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
    | "implicit-jsx-runtime";
}

/** Every module reference, including non-literal dynamic import/require calls. */
export function moduleReferences(sf: SourceFile): ModuleReference[] {
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
  const propertyName = (
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
      return literalPropertyKey(node.getExpression());
    }
    return null;
  };
  const destructuredMembers = (): Array<{
    readonly name: string;
    readonly receiver: Node;
    readonly line: number;
  }> => {
    const members: Array<{
      readonly name: string;
      readonly receiver: Node;
      readonly line: number;
    }> = [];
    for (const binding of sf.getDescendantsOfKind(
      SyntaxKind.ObjectBindingPattern,
    )) {
      const declaration = binding.getParent();
      const receiver =
        Node.isVariableDeclaration(declaration) ||
        Node.isParameterDeclaration(declaration)
          ? declaration.getInitializer()
          : undefined;
      if (receiver === undefined) continue;
      for (const element of binding.getElements()) {
        const name = propertyName(
          element.getPropertyNameNode(),
          element.getName(),
        );
        if (name !== null) {
          members.push({
            name,
            receiver,
            line: element.getStartLineNumber(),
          });
        }
      }
    }
    for (const assignment of sf.getDescendantsOfKind(
      SyntaxKind.BinaryExpression,
    )) {
      if (
        assignment.getOperatorToken().getKind() !==
        SyntaxKind.EqualsToken
      ) {
        continue;
      }
      const binding = unwrapExpression(assignment.getLeft());
      if (!Node.isObjectLiteralExpression(binding)) continue;
      for (const property of binding.getProperties()) {
        if (
          !Node.isPropertyAssignment(property) &&
          !Node.isShorthandPropertyAssignment(property)
        ) {
          continue;
        }
        const name = propertyName(
          property.getNameNode(),
          property.getName(),
        );
        if (name !== null) {
          members.push({
            name,
            receiver: assignment.getRight(),
            line: property.getStartLineNumber(),
          });
        }
      }
    }
    return members;
  };
  const expressionProvenance = (
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
          candidate.getOperatorToken().getKind() ===
            SyntaxKind.EqualsToken &&
          candidate.getStart() < expression.getStart() &&
          Node.isIdentifier(unwrapExpression(candidate.getLeft())) &&
          unwrapExpression(candidate.getLeft())?.getSymbol() ===
            expression.getSymbol(),
      )
      .sort((left, right) => right.getStart() - left.getStart())[0];
    const source = assignment?.getRight() ?? declaration?.getInitializer();
    return source === undefined
      ? expression
      : expressionProvenance(source, seen);
  };
  const literalPropertyKey = (node: Node | undefined): string | null => {
    const expression = expressionProvenance(node);
    return Node.isStringLiteral(expression) ||
      Node.isNoSubstitutionTemplateLiteral(expression)
      ? expression.getLiteralText()
      : null;
  };
  /** A bare name this project never declares - `module`, `globalThis`, an ambient global. */
  const isAmbientGlobalReference = (node: Node | undefined): boolean => {
    const expression = expressionProvenance(node);
    if (!Node.isIdentifier(expression)) return false;
    return (expression.getSymbol()?.getDeclarations() ?? []).every((declaration) =>
      declaration.getSourceFile().isDeclarationFile(),
    );
  };
  /**
   * A `require` MEMBER is the CommonJS loader only when it hangs off an ambient
   * global, or when the member itself is declared ambiently (`const m = module;
   * m.require(…)`). A member declared by project source - or none at all, which is
   * every access through a receiver typed `any` - is somebody's own property.
   */
  const isAmbientRequireMember = (receiver: Node | undefined, member: Node | undefined): boolean => {
    if (isAmbientGlobalReference(receiver)) return true;
    const declarations = member?.getSymbol()?.getDeclarations() ?? [];
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
  const isCreateRequireNamespace = (node: Node | undefined): boolean => {
    const expression = expressionProvenance(node);
    return (
      (Node.isIdentifier(expression) &&
        createRequireNamespaces.has(expression.getText())) ||
      isNodeModuleSpecifier(loaderSpecifier(expression))
    );
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
  for (const member of destructuredMembers()) {
    if (
      member.name === "createRequire" &&
      isCreateRequireNamespace(member.receiver)
    ) {
      refs.push({
        specifier: null,
        line: member.line,
        kind: "create-require",
      });
    }
    if (
      member.name === "require" &&
      isAmbientGlobalReference(member.receiver)
    ) {
      refs.push({
        specifier: null,
        line: member.line,
        kind: "require-reference",
      });
    }
  }
  for (const exp of sf.getExportDeclarations()) {
    const v = exp.getModuleSpecifierValue();
    if (v) refs.push({ specifier: v, line: exp.getStartLineNumber(), kind: "export" });
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
    const expression = access.getExpression();
    if (
      access.getName() === "createRequire" &&
      isCreateRequireNamespace(expression)
    ) {
      refs.push({
        specifier: null,
        line: access.getStartLineNumber(),
        kind: "create-require",
      });
    }
    if (access.getName() === "require" && isAmbientRequireMember(expression, access.getNameNode())) {
      refs.push({
        specifier: null,
        line: access.getStartLineNumber(),
        kind: "require-reference",
      });
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
    const memberName = literalPropertyKey(argument);
    if (
      isCreateRequireNamespace(access.getExpression()) &&
      (memberName === null || memberName === "createRequire")
    ) {
      refs.push({
        specifier: null,
        line: access.getStartLineNumber(),
        kind: "create-require",
      });
    }
    if (
      memberName === "require" &&
      isAmbientRequireMember(access.getExpression(), argument)
    ) {
      refs.push({
        specifier: null,
        line: access.getStartLineNumber(),
        kind: "require-reference",
      });
    }
  }
  return refs;
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
  return violations;
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

const SQL_EXECUTOR_METHODS = new Set(["exec", "execute", "query"]);

/**
 * A RESOLVED SQL-executor call: `db.query(sql, …)` / `tx.exec(sql)`, where the
 * receiver's method really does take a SQL string. Resolved semantically so an
 * unrelated `.query()` on some other object is not mistaken for persistence.
 */
export function isSqlExecutorCall(call: CallExpression): boolean {
  const expression = call.getExpression();
  if (
    !Node.isPropertyAccessExpression(expression) ||
    !SQL_EXECUTOR_METHODS.has(expression.getName())
  ) {
    return false;
  }
  return expression.getType().getCallSignatures().some((signature) => {
    const parameter = signature.getParameters()[0];
    const declaration = parameter?.getValueDeclaration() ??
      parameter?.getDeclarations()[0];
    return Boolean(parameter && declaration &&
      parameter.getTypeAtLocation(declaration).isString());
  });
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
