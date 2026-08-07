import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { REPO_ROOT } from "./_fence-utils";

/**
 * The approved repository-input boundaries and the walk that holds them: the one
 * place the corpus tooling may read the filesystem, and the detector proving no
 * other call site widens that permission. Shared by the corpus-determinism fence
 * files.
 */
export const CORPUS_SRC = join(REPO_ROOT, "scripts", "corpus");

// ── (d) the non-determinism ban ────────────────────────────────────────────────

export interface BannedUse {
  file: string;
  line: number;
  api: string;
}

export const REPOSITORY_INPUT_BOUNDARIES = [
  { file: "/scripts/golden-cases.lib.ts", owner: "loadScenarioRefs", inputs: {} },
  { file: "/scripts/golden-cases.lib.ts", owner: "loadGoldenCases", rootParameters: [0], inputs: { "fs.existsSync": ["dir"], "fs.readdirSync": ["dir"] } },
  { file: "/scripts/corpus/scrub-contract.ts", owner: "schemaFromSpec", inputs: {} },
  { file: "/scripts/corpus/world.ts", owner: "readSpecFile", rootParameters: [1], inputs: {} },
  { file: "/scripts/corpus/tree.ts", owner: "readTree", rootParameters: [0], inputs: { "fs.existsSync": ["dir"], "fs.lstatSync": ["dir"] } },
  { file: "/scripts/corpus/tree.ts", owner: "walkTree", rootParameters: [0], inputs: { "fs.readdirSync": ["dir"], "fs.readFileSync": ["fullPath"] } },
  // The ONE subprocess the corpus tooling may run, and only this argument: git
  // deciding which working-tree entries the committed tree actually holds. It
  // selects nothing that is generated, digested or inventoried - the drop set is
  // a subset of `UNTRACKABLE_ENTRY_NAMES`, which no corpus path can be named -
  // so no emitted byte can vary with the answer.
  { file: "/scripts/corpus/tree.ts", owner: "trackedRelPaths", rootParameters: [0], inputs: { "child_process.spawnSync": ["\"git\""] } },
  { file: "/scripts/corpus/tree.ts", owner: "resolveRepositoryFile", rootParameters: [1], inputs: { "fs.statSync": ["canonicalTarget"], "fs.realpathSync": ["repoRoot", "path"] } },
  { file: "/scripts/corpus/tree.ts", owner: "readRepositoryFile", rootParameters: [1], inputs: { "fs.readFileSync": ["resolved.target"] } },
  { file: "/scripts/corpus/tree.ts", owner: "isRepositoryContainedFile", rootParameters: [1], inputs: {} },
  { file: "/scripts/corpus/manifest.ts", owner: "realDerivedSchemaBindings", inputs: {} },
  { file: "/scripts/corpus/semantic-contract.ts", owner: "loadRealDerivedSemanticContract", inputs: {} },
  { file: "/scripts/corpus/semantic-contract.ts", owner: "realDerivedSemanticContractBinding", inputs: {} },
  { file: "/scripts/corpus/defects.ts", owner: "taxonomyProblems", rootParameters: [1], inputs: {} },
  { file: "/scripts/corpus/defects.ts", owner: "loadTaxonomy", rootParameters: [0], inputs: {} },
  { file: "/scripts/corpus/signoff.ts", owner: "loadSignoff", rootParameters: [0], inputs: {} },
] as const;

export const repositoryInputRootUses = (
  project: Project,
  root: string,
): BannedUse[] => {
  type TrackedSymbol = NonNullable<ReturnType<Node["getSymbol"]>>;
  type ParameterOwner = { readonly key: string; readonly index: number };
  const resolvedSymbol = (symbol: TrackedSymbol): TrackedSymbol => {
    try {
      return symbol.getAliasedSymbol() ?? symbol;
    } catch {
      return symbol;
    }
  };
  const callableName = (node: Node): string | undefined => {
    if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
      return node.getName();
    }
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const declaration = node.getParentIfKind(SyntaxKind.VariableDeclaration);
      return declaration !== undefined && Node.isIdentifier(declaration.getNameNode())
        ? declaration.getName()
        : undefined;
    }
    return undefined;
  };
  const callableParameters = (node: Node): Node[] =>
    Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node)
      ? node.getParameters()
      : [];
  const callableKey = (node: Node): string | undefined => {
    const name = callableName(node);
    return name === undefined
      ? undefined
      : `${node.getSourceFile().getFilePath().replace(/\\/g, "/")}:${name}`;
  };
  const callables = project.getSourceFiles().flatMap((source) =>
    source.getDescendants().filter((node) =>
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node)
    )
  );
  const callableByKey = new Map<string, Node>();
  const parameterOwners = new Map<TrackedSymbol, ParameterOwner>();
  for (const callable of callables) {
    const key = callableKey(callable);
    if (key === undefined) continue;
    callableByKey.set(key, callable);
    for (const [index, parameter] of callableParameters(callable).entries()) {
      const name = parameter.getFirstChildByKind(SyntaxKind.Identifier);
      const symbol = name?.getSymbol();
      if (symbol !== undefined) {
        parameterOwners.set(resolvedSymbol(symbol), { key, index });
      }
    }
  }
  const required = new Map<string, Set<number>>();
  for (const boundary of REPOSITORY_INPUT_BOUNDARIES) {
    if (!("rootParameters" in boundary)) continue;
    for (const [key, callable] of callableByKey) {
      if (
        key.endsWith(`${boundary.file}:${boundary.owner}`) &&
        callableName(callable) === boundary.owner
      ) {
        required.set(key, new Set(boundary.rootParameters));
      }
    }
  }
  const nodeKey = (node: Node): string =>
    `${node.getSourceFile().getFilePath()}:${node.getKind()}:${node.getStart()}`;
  const callableKeysFrom = (
    input: Node,
    trail: ReadonlySet<string> = new Set(),
  ): Set<string> => {
    const key = nodeKey(input);
    if (trail.has(key)) return new Set();
    const next = new Set(trail);
    next.add(key);
    const keys = new Set<string>();
    const direct = callableKey(input);
    if (direct !== undefined) keys.add(direct);
    const symbol = input.getSymbol();
    for (const declaration of symbol === undefined
      ? []
      : resolvedSymbol(symbol).getDeclarations()) {
      const declarationKey = callableKey(declaration);
      if (declarationKey !== undefined) keys.add(declarationKey);
      if (Node.isVariableDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer !== undefined) {
          for (const nested of callableKeysFrom(initializer, next)) keys.add(nested);
        }
      }
    }
    return keys;
  };
  const referencedParameters = (
    input: Node,
    trail: ReadonlySet<string> = new Set(),
  ): ParameterOwner[] => {
    const key = nodeKey(input);
    if (trail.has(key)) return [];
    const next = new Set(trail);
    next.add(key);
    const owners = new Map<string, ParameterOwner>();
    const identifiers = Node.isIdentifier(input)
      ? [input]
      : input.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const identifier of identifiers) {
      const symbol = identifier.getSymbol();
      if (symbol === undefined) continue;
      const resolved = resolvedSymbol(symbol);
      const owner = parameterOwners.get(resolved);
      if (owner !== undefined) {
        owners.set(`${owner.key}:${owner.index}`, owner);
        continue;
      }
      for (const declaration of resolved.getDeclarations()) {
        if (!Node.isVariableDeclaration(declaration)) continue;
        const initializer = declaration.getInitializer();
        if (
          initializer === undefined ||
          Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer)
        ) {
          continue;
        }
        for (const nested of referencedParameters(initializer, next)) {
          owners.set(`${nested.key}:${nested.index}`, nested);
        }
      }
    }
    return [...owners.values()];
  };
  const pathIsInsideRoot = (path: string): boolean => {
    const pathFromRoot = relative(resolve(REPO_ROOT), resolve(path));
    return pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot);
  };
  type PathTransform = "dirname" | "join" | "resolve";
  const nodePathTransform = (input: Node): PathTransform | undefined => {
    const importedNames = new Set<PathTransform>(["dirname", "join", "resolve"]);
    const importModule = (declaration: Node): string | undefined =>
      declaration.getFirstAncestorByKind(
        SyntaxKind.ImportDeclaration,
      )?.getModuleSpecifierValue();
    if (Node.isIdentifier(input)) {
      const declaration = input.getSymbol()?.getDeclarations().find(
        (declaration) =>
          Node.isImportSpecifier(declaration) &&
          ["node:path", "path"].includes(
            importModule(declaration) ?? "",
          ) &&
          importedNames.has(declaration.getName() as PathTransform),
      );
      return declaration !== undefined && Node.isImportSpecifier(declaration)
        ? declaration.getName() as PathTransform
        : undefined;
    }
    if (!Node.isPropertyAccessExpression(input)) return undefined;
    const owner = input.getExpression();
    return importedNames.has(input.getName() as PathTransform) &&
      Node.isIdentifier(owner) &&
      owner.getSymbol()?.getDeclarations().some(
        (declaration) =>
          Node.isNamespaceImport(declaration) &&
          ["node:path", "path"].includes(
            importModule(declaration) ?? "",
          ),
      ) === true
      ? input.getName() as PathTransform
      : undefined;
  };
  const staticRepositoryPath = (
    input: Node,
    trail: ReadonlySet<string> = new Set(),
  ): string | undefined => {
    const key = nodeKey(input);
    if (trail.has(key)) return undefined;
    const next = new Set(trail);
    next.add(key);
    if (Node.isStringLiteral(input) || Node.isNoSubstitutionTemplateLiteral(input)) {
      const value = input.getLiteralText();
      return isAbsolute(value) && pathIsInsideRoot(value)
        ? resolve(value)
        : undefined;
    }
    if (
      Node.isPropertyAccessExpression(input) &&
      input.getText() === "import.meta.dirname"
    ) {
      return dirname(input.getSourceFile().getFilePath());
    }
    if (Node.isIdentifier(input)) {
      const symbol = input.getSymbol();
      if (symbol === undefined) return undefined;
      for (const declaration of resolvedSymbol(symbol).getDeclarations()) {
        if (!Node.isVariableDeclaration(declaration)) continue;
        if (
          declaration.getParentIfKind(SyntaxKind.VariableDeclarationList)
              ?.getDeclarationKind() !== "const"
        ) {
          continue;
        }
        const initializer = declaration.getInitializer();
        if (initializer === undefined) continue;
        const value = staticRepositoryPath(initializer, next);
        if (value !== undefined) return value;
      }
      return undefined;
    }
    if (Node.isCallExpression(input)) {
      const transform = nodePathTransform(input.getExpression());
      const [first, ...rest] = input.getArguments();
      if (transform === undefined || first === undefined) return undefined;
      const base = staticRepositoryPath(first, next);
      if (base === undefined) return undefined;
      if (transform === "dirname") {
        const value = dirname(base);
        return pathIsInsideRoot(value) ? value : undefined;
      }
      const parts = rest.map((part) =>
        Node.isStringLiteral(part) || Node.isNoSubstitutionTemplateLiteral(part)
          ? part.getLiteralText()
          : undefined
      );
      if (parts.some((part) => part === undefined)) return undefined;
      const value = transform === "join"
        ? join(base, ...parts as string[])
        : resolve(base, ...parts as string[]);
      return pathIsInsideRoot(value) ? value : undefined;
    }
    return undefined;
  };
  const isRepositoryPath = (input: Node): boolean => {
    if (Node.isConditionalExpression(input)) {
      return isRepositoryPath(input.getWhenTrue()) &&
        isRepositoryPath(input.getWhenFalse());
    }
    return staticRepositoryPath(input) !== undefined;
  };
  const effectiveArgument = (
    call: Node,
    callable: Node,
    index: number,
  ): Node | undefined => {
    if (!Node.isCallExpression(call)) return undefined;
    const supplied = call.getArguments()[index];
    if (supplied !== undefined) return supplied;
    const parameter = callableParameters(callable)[index];
    return parameter !== undefined && Node.isParameterDeclaration(parameter)
      ? parameter.getInitializer()
      : undefined;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const source of project.getSourceFiles()) {
      for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        for (const calleeKey of callableKeysFrom(call.getExpression())) {
          const callee = callableByKey.get(calleeKey);
          if (callee === undefined) continue;
          for (const index of required.get(calleeKey) ?? []) {
            const argument = effectiveArgument(call, callee, index);
            if (argument === undefined) continue;
            for (const owner of referencedParameters(argument)) {
              const current = required.get(owner.key) ?? new Set<number>();
              if (!current.has(owner.index)) {
                current.add(owner.index);
                required.set(owner.key, current);
                changed = true;
              }
            }
          }
        }
      }
    }
  }
  const uses: BannedUse[] = [];
  const seen = new Set<string>();
  const record = (node: Node): void => {
    const file = node.getSourceFile().getFilePath().replace(root, "");
    const line = node.getStartLineNumber();
    const key = `${file}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    uses.push({ file, line, api: "repository input outside REPO_ROOT" });
  };
  for (const source of project.getSourceFiles()) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      for (const calleeKey of callableKeysFrom(call.getExpression())) {
        const callee = callableByKey.get(calleeKey);
        if (callee === undefined) continue;
        for (const index of required.get(calleeKey) ?? []) {
          const argument = effectiveArgument(call, callee, index);
          if (
            argument !== undefined &&
            referencedParameters(argument).length === 0 &&
            !isRepositoryPath(argument)
          ) {
            record(call);
          }
        }
      }
    }
  }
  return uses;
};
