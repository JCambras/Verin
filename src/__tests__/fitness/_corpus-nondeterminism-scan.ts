import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { unwrap, type OriginResolver } from "./_corpus-nondeterminism-ast";
import { createOriginResolver } from "./_corpus-nondeterminism-origins";
import {
  CRYPTO_RANDOM_MEMBERS,
  hostIoApi,
  memberOrigins,
  mergeOrigins,
  moduleOrigin,
  sensitiveOriginApi,
  type OriginSet,
} from "./_corpus-nondeterminism-vocabulary";
import {
  REPOSITORY_INPUT_BOUNDARIES,
  repositoryInputRootUses,
  type BannedUse,
} from "./_corpus-repository-inputs";

/**
 * AST, not grep: `Date.now`, an ARGLESS `new Date()`, `Math.random`,
 * `crypto.randomUUID`, `performance.now`, `process.hrtime`, `process.env`, every
 * `toLocale*`/`localeCompare` and every `Intl` reference. `new Date(iso)` with an
 * explicit argument is deterministic and stays legal - that distinction is
 * exactly why this is an AST rule and not a text scan.
 *
 * The walk itself is split across `_corpus-nondeterminism-{vocabulary,ast,
 * callables,members,origins}.ts`; this file owns the RECORDER (which findings
 * are kept, and the one repository-input escape) and the per-file passes that
 * drive the walk.
 */
interface UseRecorder {
  record(node: Node, api: string, sf: SourceFile): void;
  importIsAllowedRepositoryInput(api: string, sf: SourceFile): boolean;
  readonly uses: BannedUse[];
}

const enclosingFunctionName = (node: Node): string | undefined => {
  for (const candidate of [node, ...node.getAncestors()]) {
    if (Node.isFunctionDeclaration(candidate) || Node.isMethodDeclaration(candidate)) {
      const name = candidate.getName();
      if (name !== undefined) return name;
    }
    if (Node.isArrowFunction(candidate) || Node.isFunctionExpression(candidate)) {
      const declaration = candidate.getParentIfKind(SyntaxKind.VariableDeclaration);
      if (declaration !== undefined && Node.isIdentifier(declaration.getNameNode())) {
        return declaration.getName();
      }
    }
  }
  return undefined;
};

/** The one place a host-I/O use is FORGIVEN, and only there: an approved
 * repository-input boundary reading its own declared argument. */
const createRecorder = (root: string): UseRecorder => {
  const uses: BannedUse[] = [];
  const seen = new Set<string>();
  const allowedRepositoryInput = (
    node: Node,
    api: string,
    sf: SourceFile,
  ): boolean => {
    const file = sf.getFilePath().replace(/\\/g, "/");
    const owner = enclosingFunctionName(node);
    const boundary = owner === undefined
      ? undefined
      : REPOSITORY_INPUT_BOUNDARIES.find(
          (candidate) =>
            file.endsWith(candidate.file) && owner === candidate.owner,
        );
    const call = Node.isCallExpression(node)
      ? node
      : node.getFirstAncestorByKind(SyntaxKind.CallExpression);
    const argument = call?.getArguments()[0]?.getText().replace(/\s/g, "");
    const inputs = boundary?.inputs as
      | Readonly<Record<string, readonly string[]>>
      | undefined;
    return argument !== undefined && inputs?.[api]?.includes(argument) === true;
  };
  return {
    uses,
    importIsAllowedRepositoryInput: (api: string, sf: SourceFile): boolean => {
      const file = sf.getFilePath().replace(/\\/g, "/");
      return REPOSITORY_INPUT_BOUNDARIES.some(
        (boundary) =>
          file.endsWith(boundary.file) &&
          Object.keys(boundary.inputs).includes(api),
      );
    },
    record: (node: Node, api: string, sf: SourceFile): void => {
      if (hostIoApi(api) && allowedRepositoryInput(node, api, sf)) return;
      const file = sf.getFilePath().replace(root, "");
      const line = node.getStartLineNumber();
      const key = `${file}:${line}:${api}`;
      if (!seen.has(key)) uses.push({ file, line, api });
      seen.add(key);
    },
  };
};

/** Learn a binding AND report it: a name that now carries a banned origin is
 * recorded at the site that gave it that origin, not only where it is called. */
const bindOrigins = (
  resolver: OriginResolver,
  recorder: UseRecorder,
  sf: SourceFile,
  name: Node,
  value: OriginSet,
  source: Node = name,
): boolean => {
  const bind = (nested: Node, nestedValue: OriginSet, nestedSource: Node): boolean =>
    bindOrigins(resolver, recorder, sf, nested, nestedValue, nestedSource);
  if (
    Node.isIdentifier(name) ||
    Node.isPropertyAccessExpression(name) ||
    Node.isElementAccessExpression(name)
  ) {
    const changed = resolver.setOrigins(name.getText(), value);
    for (const origin of value) {
      const api = sensitiveOriginApi(origin);
      if (api !== undefined) recorder.record(source, api, sf);
    }
    return changed;
  }
  if (Node.isObjectBindingPattern(name)) {
    return name.getElements().map((element) => {
      const local = element.getNameNode();
      const property =
        element.getPropertyNameNode()?.getText() ?? local.getText();
      const bound = memberOrigins(value, property);
      return bound === undefined
        ? false
        : bind(local, bound, element);
    }).some(Boolean);
  }
  if (Node.isArrayBindingPattern(name)) {
    return name.getElements().map((element, index) => {
      if (!Node.isBindingElement(element)) return false;
      const bound = memberOrigins(value, String(index));
      return bound === undefined
        ? false
        : bind(element.getNameNode(), bound, element);
    }).some(Boolean);
  }
  if (Node.isObjectLiteralExpression(name)) {
    return name.getProperties().map((property) => {
      if (Node.isPropertyAssignment(property)) {
        const bound = memberOrigins(value, property.getName());
        if (bound === undefined) return false;
        return bind(
          property.getInitializer()!,
          bound,
          property,
        );
      }
      if (!Node.isShorthandPropertyAssignment(property)) return false;
      const bound = memberOrigins(value, property.getName());
      return bound === undefined
        ? false
        : bind(property.getNameNode(), bound, property);
    }).some(Boolean);
  }
  return false;
};

/** Imports are their own evidence: a banned module reached by name is reported
 * at the specifier, before any call site exists to blame. */
const scanImports = (
  resolver: OriginResolver,
  recorder: UseRecorder,
  sf: SourceFile,
): void => {
  for (const declaration of sf.getImportDeclarations()) {
    const moduleName = declaration.getModuleSpecifierValue();
    const normalizedModuleName = moduleName.replace(/^node:/, "");
    const namespace = declaration.getNamespaceImport()?.getText();
    const defaultImport = declaration.getDefaultImport()?.getText();
    const base = moduleOrigin(moduleName);
    if (base !== undefined && namespace !== undefined) {
      resolver.origins.set(namespace, new Set([base]));
    }
    if (base !== undefined && defaultImport !== undefined) {
      resolver.origins.set(defaultImport, new Set([base]));
    }
    for (const specifier of declaration.getNamedImports()) {
      const imported = specifier.getName();
      const local = specifier.getAliasNode()?.getText() ?? imported;
      const importedModuleOrigin = moduleOrigin(moduleName);
      const origin =
        normalizedModuleName === "crypto" &&
          (CRYPTO_RANDOM_MEMBERS.has(imported) || imported === "webcrypto")
          ? `crypto.${imported}` :
          normalizedModuleName === "process" ?
            `process.${imported}` :
            normalizedModuleName === "os" ?
              `os.${imported}` :
            normalizedModuleName === "perf_hooks" && imported === "performance" ? "performance" :
              importedModuleOrigin !== undefined ? `${importedModuleOrigin}.${imported}` :
                undefined;
      if (origin === undefined) continue;
      resolver.origins.set(local, new Set([origin]));
      const api = sensitiveOriginApi(origin);
      if (
        api !== undefined &&
        (!hostIoApi(api) || !recorder.importIsAllowedRepositoryInput(api, sf))
      ) {
        recorder.record(specifier, api, sf);
      }
    }
  }
  for (const declaration of sf.getDescendantsOfKind(
    SyntaxKind.ImportEqualsDeclaration,
  )) {
    const moduleReference = declaration.getModuleReference();
    if (!Node.isExternalModuleReference(moduleReference)) continue;
    const expression = moduleReference.getExpression();
    if (
      !Node.isStringLiteral(expression) &&
      !Node.isNoSubstitutionTemplateLiteral(expression)
    ) {
      continue;
    }
    const base = moduleOrigin(expression.getLiteralText());
    if (base !== undefined) {
      resolver.origins.set(declaration.getNameNode().getText(), new Set([base]));
    }
  }
};

/** Assignments feed the walk and the walk feeds assignments, so bindings are
 * widened to a FIXPOINT - one pass would miss `const now = clock; clock = Date.now`. */
const propagateBindings = (
  resolver: OriginResolver,
  recorder: UseRecorder,
  sf: SourceFile,
): void => {
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of sf.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    )) {
      const initializerOrigins = resolver.originOf(declaration.getInitializer());
      if (initializerOrigins !== undefined) {
        changed =
          bindOrigins(
            resolver,
            recorder,
            sf,
            declaration.getNameNode(),
            initializerOrigins,
          ) || changed;
      }
    }
    for (const assignment of sf.getDescendantsOfKind(
      SyntaxKind.BinaryExpression,
    )) {
      const operator = assignment.getOperatorToken().getKind();
      if (![
        SyntaxKind.EqualsToken,
        SyntaxKind.BarBarEqualsToken,
        SyntaxKind.AmpersandAmpersandEqualsToken,
        SyntaxKind.QuestionQuestionEqualsToken,
      ].includes(operator)) {
        continue;
      }
      const value = mergeOrigins(
        operator === SyntaxKind.EqualsToken
          ? undefined
          : resolver.originOf(assignment.getLeft()),
        resolver.originOf(assignment.getRight()),
      );
      if (value !== undefined) {
        changed =
          bindOrigins(
            resolver,
            recorder,
            sf,
            unwrap(assignment.getLeft()),
            value,
            assignment,
          ) || changed;
      }
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const target = unwrap(call.getExpression());
      const callable = Node.isIdentifier(target)
        ? resolver.localFunctions.get(target.getText())
        : undefined;
      if (callable === undefined) continue;
      const parameterBindings = resolver.callBindings(
        callable,
        call,
        new Set(),
        new Map(),
      );
      for (const [name, value] of parameterBindings) {
        changed = resolver.setOrigins(name, value) || changed;
      }
    }
  }
};

/** The reporting passes: every construction, call, member read and bare
 * identifier that resolves to a banned origin. */
const scanExpressions = (
  resolver: OriginResolver,
  recorder: UseRecorder,
  sf: SourceFile,
): void => {
  for (const call of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    for (const origin of resolver.originOf(call.getExpression()) ?? []) {
      if (origin === "Date" && call.getArguments().length === 0) {
        recorder.record(call, "new Date() (argless)", sf);
        continue;
      }
      const api = sensitiveOriginApi(origin);
      if (api !== undefined) recorder.record(call, api, sf);
    }
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (
      call.getExpression().getKind() === SyntaxKind.ImportKeyword &&
      !call.getArguments().some(
        (argument) =>
          Node.isStringLiteral(argument) ||
          Node.isNoSubstitutionTemplateLiteral(argument),
      )
    ) {
      recorder.record(call, "non-literal dynamic import", sf);
    }
    for (const origin of resolver.originOf(call.getExpression()) ?? []) {
      if (origin === "Date") {
        recorder.record(call, "Date() (callable)", sf);
      } else {
        const api = sensitiveOriginApi(origin);
        if (api !== undefined) recorder.record(call, api, sf);
      }
    }
  }
  const accesses = [
    ...sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
    ...sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
  ];
  for (const access of accesses) {
    const argument = Node.isElementAccessExpression(access)
      ? access.getArgumentExpression()
      : undefined;
    const name = Node.isPropertyAccessExpression(access)
      ? access.getName()
      : argument !== undefined &&
          (Node.isStringLiteral(argument) ||
            Node.isNoSubstitutionTemplateLiteral(argument))
        ? argument.getLiteralText()
        : "";
    for (const origin of resolver.originOf(access) ?? []) {
      const api = sensitiveOriginApi(origin);
      if (api !== undefined) recorder.record(access, api, sf);
      if (origin === "Intl" || origin.startsWith("Intl.")) {
        recorder.record(access, "Intl", sf);
      }
    }
    if (/^toLocale(String|DateString|TimeString)$/.test(name) || name === "localeCompare") {
      recorder.record(access, name, sf);
    }
  }
  for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const importDeclaration = identifier.getFirstAncestor((ancestor) =>
      Node.isImportDeclaration(ancestor) ||
      Node.isImportEqualsDeclaration(ancestor)
    );
    if (importDeclaration === undefined) {
      for (const origin of resolver.originOf(identifier) ?? []) {
        const api = sensitiveOriginApi(origin);
        if (api !== undefined && hostIoApi(api)) recorder.record(identifier, api, sf);
      }
    }
    if (identifier.getText() !== "Intl") continue;
    const parent = identifier.getParent();
    if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) continue;
    recorder.record(identifier, "Intl", sf);
  }
};

export function bannedNondeterminismUses(project: Project, root = ""): BannedUse[] {
  const recorder = createRecorder(root);
  for (const sf of project.getSourceFiles()) {
    const resolver = createOriginResolver(sf);
    scanImports(resolver, recorder, sf);
    propagateBindings(resolver, recorder, sf);
    scanExpressions(resolver, recorder, sf);
  }
  recorder.uses.push(...repositoryInputRootUses(project, root));
  return recorder.uses;
}
