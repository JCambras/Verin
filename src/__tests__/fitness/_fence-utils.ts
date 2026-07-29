/**
 * Shared fence utilities. Fences prefer AST (ts-morph) and file-content scanning
 * over naive regex, and resolve relative + dynamic imports — the seams both prior
 * builds leaked through (retro-r7 don't-again #23, #35). Every fence that uses
 * these also ships a co-located "detects" companion that feeds a synthetic
 * violation and asserts it is caught (charter #4: detection is not verification).
 */
import { Node, Project, SyntaxKind, ts, type CallExpression, type CompilerOptions, type Signature, type SourceFile, type Type, type VariableDeclaration } from "ts-morph";
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
      return literalPropertyKey(expression.getArgumentExpression()) === builtin &&
        isAmbientGlobalReference(expression.getExpression());
    }
    return false;
  };
  const isAmbientBuiltinMethod = (
    node: Node | undefined,
    builtin: "Object" | "Reflect",
    method: string,
  ): boolean => {
    const raw = unwrapExpression(node);
    if (Node.isIdentifier(raw)) {
      const symbol = raw.getSymbol();
      const latestSimpleAssignment = sf
        .getDescendantsOfKind(SyntaxKind.BinaryExpression)
        .filter((candidate) =>
          candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
          candidate.getStart() < raw.getStart() &&
          Node.isIdentifier(unwrapExpression(candidate.getLeft())) &&
          unwrapExpression(candidate.getLeft())?.getSymbol() === symbol
        )
        .sort((left, right) => right.getStart() - left.getStart())[0];
      const destructuredAssignments = sf
        .getDescendantsOfKind(SyntaxKind.BinaryExpression)
        .filter((candidate) =>
          candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
          candidate.getStart() < raw.getStart() &&
          Node.isObjectLiteralExpression(unwrapExpression(candidate.getLeft()))
        )
        .sort((left, right) => right.getStart() - left.getStart())
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
      const latestDestructured = destructuredAssignments[0];
      if (
        latestDestructured &&
        latestDestructured.assignment.getStart() >
          (latestSimpleAssignment?.getStart() ?? -1)
      ) {
        const { assignment, property } = latestDestructured;
        return (
          (Node.isPropertyAssignment(property) ||
            Node.isShorthandPropertyAssignment(property)) &&
          (propertyName(property.getNameNode(), property.getName()) === null ||
            propertyName(property.getNameNode(), property.getName()) === method) &&
          isAmbientBuiltinReference(assignment.getRight(), builtin)
        );
      }
      if (!latestSimpleAssignment) {
        const target = symbol?.getAliasedSymbol() ?? symbol;
        const binding = target?.getDeclarations().find(Node.isBindingElement);
        if (binding) {
          const pattern = binding.getParent();
          const owner = pattern.getParent();
          const receiver =
            Node.isObjectBindingPattern(pattern) &&
            (Node.isVariableDeclaration(owner) || Node.isParameterDeclaration(owner))
              ? owner.getInitializer()
              : undefined;
          const name = propertyName(
            binding.getPropertyNameNode(),
            binding.getName(),
          );
          if (
            receiver &&
            (name === null || name === method) &&
            isAmbientBuiltinReference(receiver, builtin)
          ) {
            return true;
          }
        }
      }
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
      const name = literalPropertyKey(expression.getArgumentExpression());
      return (name === null || name === method) &&
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
    const callee = expressionProvenance(call.getExpression());
    if (
      Node.isPropertyAccessExpression(callee) ||
      Node.isElementAccessExpression(callee)
    ) {
      const member = Node.isPropertyAccessExpression(callee)
        ? callee.getName()
        : literalPropertyKey(callee.getArgumentExpression());
      const receiver = callee.getExpression();
      if (member === "call" && isAccessor(receiver)) {
        return [direct[1], direct[2], false];
      }
      if (member === "apply" && isAccessor(receiver)) {
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
    if (member !== "bind" || !isAccessor(binder.getExpression())) return null;
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
  readonly signature: Signature;
}

export function returnedCallableMembers(
  declaration: Node,
  owner: string,
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
    for (const callable of callableProperties(expression.getType())) {
      addMember(
        `${owner}.${callable.name}`,
        expression,
        callable.signature,
      );
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
          addMember(member.name, member.declaration, member.signature);
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
        addMember(member.name, member.declaration, member.signature);
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
  const resolvedText = (
    node: Node | undefined,
    seen: ReadonlySet<object> = new Set(),
  ): string | null => {
    const expression = unwrap(node);
    if (!expression) return null;
    if (Node.isPropertyAccessExpression(expression)) {
      const owner = resolvedText(expression.getExpression(), seen);
      return owner ? memberText(owner, expression.getName()) : null;
    }
    if (Node.isElementAccessExpression(expression)) {
      const owner = resolvedText(expression.getExpression(), seen);
      const name = propertyText(expression.getArgumentExpression(), "");
      return owner && name !== null ? memberText(owner, name) : null;
    }
    if (!Node.isIdentifier(expression)) {
      return canonicalAuthorityText(expression.getText());
    }
    if (stableBindings.has(expression.getText())) return expression.getText();
    const symbol = expression.getSymbol();
    const key = (symbol ?? expression) as unknown as object;
    if (seen.has(key)) return expression.getText();
    const nested = new Set(seen).add(key);
    const latestAssignment = assignments
      .filter((candidate) =>
        candidate.getStart() < expression.getStart() &&
        Node.isIdentifier(unwrap(candidate.getLeft())) &&
        unwrap(candidate.getLeft())?.getSymbol() === symbol
      )
      .sort((left, right) => right.getStart() - left.getStart())[0];
    const declaration = symbol?.getDeclarations().find(Node.isVariableDeclaration);
    const source = latestAssignment?.getRight() ?? declaration?.getInitializer();
    return source ? resolvedText(source, nested) : expression.getText();
  };
  const bindingSource = (element: Node): string | null => {
    if (!Node.isBindingElement(element)) return null;
    const pattern = element.getParent();
    const owner = pattern.getParent();
    const base = Node.isVariableDeclaration(owner) ||
        Node.isParameterDeclaration(owner)
      ? resolvedText(owner.getInitializer())
      : Node.isBindingElement(owner)
      ? bindingSource(owner)
      : null;
    if (!base) return null;
    if (Node.isObjectBindingPattern(pattern)) {
      const name = propertyText(
        element.getPropertyNameNode(),
        element.getName(),
      );
      return name === null ? null : memberText(base, name);
    }
    if (Node.isArrayBindingPattern(pattern)) {
      const index = pattern.getElements().indexOf(element);
      return index < 0 ? null : `${base}[${index}]`;
    }
    return null;
  };
  const authorityRead = (
    node: Node,
    source: string | null,
  ): Array<{ readonly node: Node; readonly source: string }> =>
    source === null ? [] : [{ node, source }];
  const reads: Array<{ readonly node: Node; readonly source: string }> = [
    ...body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .flatMap((node) => authorityRead(node, resolvedText(node))),
    ...body.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
      .flatMap((node) => authorityRead(node, resolvedText(node))),
    ...body.getDescendantsOfKind(SyntaxKind.BindingElement)
      .flatMap((node) => authorityRead(node, bindingSource(node))),
  ];
  const collectAssignmentReads = (pattern: Node, base: string): void => {
    const target = unwrap(pattern);
    if (Node.isObjectLiteralExpression(target)) {
      for (const property of target.getProperties()) {
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
          reads.push({ node: property, source });
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
          reads.push({ node: element, source });
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
    const base = resolvedText(assignment.getRight());
    if (base) collectAssignmentReads(left, base);
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
        read.source.startsWith(`${source}[`)
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
/**
 * The name a call is WRITTEN under, for the fail-closed arm below only. `db.query(…)`,
 * `db["query"](…)`, and a bare `query(…)` all answer "query".
 */
function syntacticCalleeName(call: CallExpression): string | undefined {
  // `(query as (sql: string) => unknown)(…)` is the same call as `query(…)`: the cast
  // supplies an anonymous signature, so the wrapper has to come off first or the
  // fail-closed arm never sees a name at all.
  let expression: Node = call.getExpression();
  while (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isSatisfiesExpression(expression)
  ) {
    expression = expression.getExpression();
  }
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isElementAccessExpression(expression)) {
    const argument = expression.getArgumentExpression();
    return argument && Node.isStringLiteral(argument)
      ? argument.getLiteralValue()
      : undefined;
  }
  return undefined;
}

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
function bindingSources(expression: Node, depth = 0): Node[] {
  if (depth > 4 || !Node.isIdentifier(expression)) return [];
  const out: Node[] = [];
  for (const declaration of expression.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    let source: Node = initializer;
    while (
      Node.isParenthesizedExpression(source) || Node.isAsExpression(source) ||
      Node.isTypeAssertion(source) || Node.isSatisfiesExpression(source)
    ) source = source.getExpression();
    out.push(source, ...bindingSources(source, depth + 1));
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

function issuesSqlLiteral(call: CallExpression): boolean {
  const [first] = call.getArguments();
  if (!first) return false;
  const text = Node.isStringLiteral(first) || Node.isNoSubstitutionTemplateLiteral(first)
    ? first.getLiteralValue()
    : Node.isTemplateExpression(first)
    ? first.getText()
    : undefined;
  return Boolean(text && SQL_STATEMENT_RE.test(text));
}

export function isSqlExecutorCall(call: CallExpression): boolean {
  const calleeType = call.getExpression().getType();
  if (declaresExecutorSignature(calleeType)) return true;
  // A callee whose signatures DID resolve but name something other than an executor
  // is a genuine non-SQL call and stays clean, so an unrelated `.query()` taking no
  // SQL string is still not mistaken for persistence.
  if (declaredCalleeNames(calleeType).length > 0) return false;
  // FAIL CLOSED on a callee the checker cannot narrow. Resolving the executor through
  // its SIGNATURE is what makes destructured and computed callsites resolve alike, but
  // a callee widened past SqlDb - a `Function`-typed local, a `(sql: string) => …`
  // alias, a value behind an `any` - yields ZERO declared signatures, and returning
  // false there made this whole rule a one-line evasion: `const run: Function =
  // db.query; run("SELECT … FROM users …")` issues exactly the same SQL from exactly
  // the same place. Both fences that stand behind this derivation (governed-sink and
  // tenant-scope) treat an unresolvable type as a violation everywhere else.
  const written = syntacticCalleeName(call);
  if (written && SQL_EXECUTOR_METHODS.has(written)) return true;
  // A SQL statement handed to a callee nobody can resolve is persistence under any
  // name, so the identifier text is never the last word.
  if (issuesSqlLiteral(call)) return true;
  // ...and when the statement arrives in a variable, the callee is resolved by VALUE:
  // the widened local is followed back to what it was BOUND from, so renaming it
  // changes nothing. Gated on the call actually taking SQL-shaped TEXT, because
  // following bindings is the one expensive step here and an executor always does.
  const [argument] = call.getArguments();
  if (!argument || !Node.isExpression(argument)) return false;
  const argumentType = argument.getType();
  if (!argumentType.isString() && !argumentType.isStringLiteral()) return false;
  let expression: Node = call.getExpression();
  while (
    Node.isParenthesizedExpression(expression) || Node.isAsExpression(expression) ||
    Node.isTypeAssertion(expression) || Node.isSatisfiesExpression(expression)
  ) expression = expression.getExpression();
  return bindingSources(expression).some((source) =>
    declaresExecutorSignature(source.getType()) ||
    SQL_EXECUTOR_METHODS.has(accessedName(source) ?? "")
  );
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
