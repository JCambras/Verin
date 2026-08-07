import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
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
 */
export function bannedNondeterminismUses(project: Project, root = ""): BannedUse[] {
  const uses: BannedUse[] = [];
  const seen = new Set<string>();
  const hostIoApi = (api: string): boolean =>
    ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"].includes(api) || [
      "fs.",
      "fs/promises.",
      "child_process.",
      "net.",
      "http.",
      "https.",
      "http2.",
      "dns.",
      "dns/promises.",
      "dgram.",
      "tls.",
    ].some((prefix) => api.startsWith(prefix));
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
  const allowedRepositoryInputImport = (
    api: string,
    sf: SourceFile,
  ): boolean => {
    const file = sf.getFilePath().replace(/\\/g, "/");
    return REPOSITORY_INPUT_BOUNDARIES.some(
      (boundary) =>
        file.endsWith(boundary.file) &&
        Object.keys(boundary.inputs).includes(api),
    );
  };
  const record = (node: Node, api: string, sf: SourceFile): void => {
    if (hostIoApi(api) && allowedRepositoryInput(node, api, sf)) return;
    const file = sf.getFilePath().replace(root, "");
    const line = node.getStartLineNumber();
    const key = `${file}:${line}:${api}`;
    if (!seen.has(key)) uses.push({ file, line, api });
    seen.add(key);
  };
  for (const sf of project.getSourceFiles()) {
    type OriginSet = ReadonlySet<string>;
    const originSet = (...values: Array<string | undefined>): OriginSet | undefined => {
      const result = new Set(values.filter((value): value is string => value !== undefined));
      return result.size === 0 ? undefined : result;
    };
    const mergeOrigins = (
      ...values: Array<OriginSet | undefined>
    ): OriginSet | undefined => {
      const result = new Set(values.flatMap((value) => [...(value ?? [])]));
      return result.size === 0 ? undefined : result;
    };
    const origins = new Map<string, OriginSet>([
      ["Math", new Set(["Math"])],
      ["Date", new Set(["Date"])],
      ["performance", new Set(["performance"])],
      ["process", new Set(["process"])],
      ["crypto", new Set(["crypto"])],
      ["Intl", new Set(["Intl"])],
      ["globalThis", new Set(["globalThis"])],
      ["global", new Set(["global"])],
      ["eval", new Set(["eval"])],
      ["Function", new Set(["Function"])],
      ["fetch", new Set(["fetch"])],
      ["WebSocket", new Set(["WebSocket"])],
      ["EventSource", new Set(["EventSource"])],
      ["XMLHttpRequest", new Set(["XMLHttpRequest"])],
    ]);
    const cryptoRandomMembers = new Set([
      "randomUUID",
      "randomBytes",
      "randomFill",
      "randomFillSync",
      "randomInt",
      "getRandomValues",
      "generateKey",
      "generateKeySync",
      "generateKeyPair",
      "generateKeyPairSync",
      "generatePrime",
      "generatePrimeSync",
    ]);
    const bannedCalls = new Set([
      "Math.random",
      "Date.now",
      "performance.now",
      ...[...cryptoRandomMembers].flatMap((name) => [
        `crypto.${name}`,
        `crypto.webcrypto.${name}`,
        `crypto.subtle.${name}`,
        `crypto.webcrypto.subtle.${name}`,
      ]),
    ]);
    const apiName = (origin: string): string =>
      origin.startsWith("crypto.") ? origin.split(".").at(-1)! : origin;
    const sensitiveOriginApi = (origin: string): string | undefined => {
      if (origin.endsWith(".[computed]")) return origin;
      if (origin === "eval" || origin === "Function") return origin;
      if (bannedCalls.has(origin)) return apiName(origin);
      if (origin.startsWith("process.env")) return "process.env";
      if (origin.startsWith("process.hrtime")) return "process.hrtime";
      if (origin.startsWith("process.")) {
        return origin.split(".").slice(0, 2).join(".");
      }
      if (origin.startsWith("os.")) {
        return origin.split(".").slice(0, 2).join(".");
      }
      if (["fetch", "WebSocket", "EventSource", "XMLHttpRequest"].includes(origin)) {
        return origin;
      }
      const hostModule = [
        "fs",
        "fs/promises",
        "child_process",
        "net",
        "http",
        "https",
        "http2",
        "dns",
        "dns/promises",
        "dgram",
        "tls",
      ].find((candidate) => origin.startsWith(`${candidate}.`));
      if (hostModule !== undefined) {
        return origin.split(".").slice(0, 2).join(".");
      }
      return undefined;
    };
    const moduleOrigin = (moduleName: string): string | undefined => {
      const normalized = moduleName.replace(/^node:/, "");
      if (normalized === "crypto") return "crypto";
      if (normalized === "process") return "process";
      if (normalized === "perf_hooks") return "performance";
      if (normalized === "os") return "os";
      return [
        "fs",
        "fs/promises",
        "child_process",
        "net",
        "http",
        "https",
        "http2",
        "dns",
        "dns/promises",
        "dgram",
        "tls",
      ].includes(normalized)
        ? normalized
        : undefined;
    };
    const ambientRoots = new Set([
      "Math",
      "Date",
      "performance",
      "process",
      "crypto",
      "Intl",
      "eval",
      "Function",
      "fetch",
      "WebSocket",
      "EventSource",
      "XMLHttpRequest",
    ]);
    const memberOrigin = (
      base: string,
      member: string,
    ): string | undefined =>
      base === "globalThis" || base === "global"
        ? ambientRoots.has(member) ? member : undefined
        : `${base}.${member}`;
    const memberOrigins = (
      bases: OriginSet | undefined,
      member: string,
    ): OriginSet | undefined => mergeOrigins(
      ...[...(bases ?? [])].map((base) => originSet(memberOrigin(base, member))),
    );
    const unwrap = (input: Node): Node => {
      let node = input;
      while (
        Node.isParenthesizedExpression(node) ||
        Node.isAsExpression(node) ||
        Node.isTypeAssertion(node) ||
        Node.isNonNullExpression(node) ||
        Node.isAwaitExpression(node)
      ) {
        node = node.getExpression();
      }
      return node;
    };
    const localFunctions = new Map<
      string,
      { parameters: Node[]; returns: Node[] }
    >();
    const registerFunction = (
      name: string,
      callable: {
        getParameters(): Node[];
        getDescendantsOfKind(kind: SyntaxKind.ReturnStatement): Array<{
          getExpression(): Node | undefined;
        }>;
        getBody(): Node | undefined;
      },
    ): void => {
      const body = callable.getBody();
      const returns = callable
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .flatMap((statement) => statement.getExpression() ?? []);
      if (
        body !== undefined &&
        !Node.isBlock(body)
      ) {
        returns.push(body);
      }
      localFunctions.set(name, {
        parameters: callable.getParameters(),
        returns,
      });
    };
    for (const declaration of sf.getDescendantsOfKind(
      SyntaxKind.FunctionDeclaration,
    )) {
      const name = declaration.getName();
      if (name !== undefined) registerFunction(name, declaration);
    }
    for (const declaration of sf.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    )) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (
        Node.isIdentifier(name) &&
        initializer !== undefined &&
        (Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer))
      ) {
        registerFunction(name.getText(), initializer);
      }
    }
    type CallableShape = { parameters: Node[]; returns: Node[] };
    const returnedExpressions = (declaration: {
      getDescendantsOfKind(kind: SyntaxKind.ReturnStatement): Array<{
        getExpression(): Node | undefined;
      }>;
      getBody(): Node | undefined;
    }): Node[] => {
      const body = declaration.getBody();
      const returns = declaration
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .flatMap((statement) => statement.getExpression() ?? []);
      if (body !== undefined && !Node.isBlock(body)) returns.push(body);
      return returns;
    };
    const symbolDeclarations = (node: Node): Node[] => {
      const symbol = node.getSymbol();
      return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
    };
    const nodeKey = (node: Node): string =>
      `${node.getSourceFile().getFilePath()}:${node.getKind()}:${node.getStart()}:${node.getEnd()}`;
    const callableShapes = (
      target: Node,
      trail: ReadonlySet<string> = new Set(),
    ): CallableShape[] => {
      const key = nodeKey(target);
      if (trail.has(key)) return [];
      const next = new Set(trail);
      next.add(key);
      const direct = Node.isIdentifier(target)
        ? localFunctions.get(target.getText())
        : undefined;
      const resolved = symbolDeclarations(target).flatMap((declaration) => {
        if (
          Node.isFunctionDeclaration(declaration) ||
          Node.isMethodDeclaration(declaration)
        ) {
          return [{
            parameters: declaration.getParameters(),
            returns: returnedExpressions(declaration),
          }];
        }
        const value =
          Node.isVariableDeclaration(declaration)
            ? declaration.getInitializer()
            : Node.isPropertyAssignment(declaration)
              ? declaration.getInitializer()
              : Node.isPropertyDeclaration(declaration)
                ? declaration.getInitializer()
                : undefined;
        if (value === undefined) return [];
        if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) {
          const body = value.getBody();
          const returns: Node[] = value
            .getDescendantsOfKind(SyntaxKind.ReturnStatement)
            .flatMap((statement) => statement.getExpression() ?? []);
          if (!Node.isBlock(body)) returns.push(body);
          return [{ parameters: value.getParameters(), returns }];
        }
        return callableShapes(unwrap(value), next);
      });
      return direct === undefined ? resolved : [direct, ...resolved];
    };
    const callBindings = (
      callable: CallableShape,
      call: Node,
      trail: ReadonlySet<string>,
      bindings: ReadonlyMap<string, OriginSet>,
    ): ReadonlyMap<string, OriginSet> => {
      const next = new Map(bindings);
      const arguments_ = Node.isCallExpression(call) ? call.getArguments() : [];
      type BindingSource = {
        readonly value: Node | undefined;
        readonly path: readonly string[];
      };
      const bindParameter = (
        pattern: Node,
        sources: readonly BindingSource[],
      ): void => {
        if (Node.isIdentifier(pattern)) {
          const value = mergeOrigins(
            ...sources.map((source) =>
              memberValueOrigins(source.value, source.path, trail, bindings)
            ),
          );
          const merged = mergeOrigins(next.get(pattern.getText()), value);
          if (merged !== undefined) next.set(pattern.getText(), merged);
          return;
        }
        if (Node.isObjectBindingPattern(pattern)) {
          for (const element of pattern.getElements()) {
            const property =
              element.getPropertyNameNode()?.getText() ??
              element.getNameNode().getText();
            const nested = sources.map((source) => ({
              value: source.value,
              path: [...source.path, property],
            }));
            if (element.getInitializer() !== undefined) {
              nested.push({ value: element.getInitializer(), path: [] });
            }
            bindParameter(
              element.getNameNode(),
              nested,
            );
          }
          return;
        }
        if (Node.isArrayBindingPattern(pattern)) {
          for (const [index, element] of pattern.getElements().entries()) {
            if (Node.isBindingElement(element)) {
              const nested = sources.map((source) => ({
                value: source.value,
                path: [...source.path, String(index)],
              }));
              if (element.getInitializer() !== undefined) {
                nested.push({ value: element.getInitializer(), path: [] });
              }
              bindParameter(element.getNameNode(), nested);
            }
          }
        }
      };
      for (const [index, parameter] of callable.parameters.entries()) {
        const name = Node.isParameterDeclaration(parameter)
          ? parameter.getNameNode()
          : parameter.getFirstChild((child) =>
            Node.isIdentifier(child) ||
            Node.isObjectBindingPattern(child) ||
            Node.isArrayBindingPattern(child)
          );
        const sources: BindingSource[] = [
          { value: arguments_[index], path: [] },
        ];
        if (
          Node.isParameterDeclaration(parameter) &&
          parameter.getInitializer() !== undefined
        ) {
          sources.push({ value: parameter.getInitializer(), path: [] });
        }
        if (name !== undefined) bindParameter(name, sources);
      }
      return next;
    };
    const memberValueOrigins = (
      input: Node | undefined,
      path: readonly string[],
      trail: ReadonlySet<string>,
      bindings: ReadonlyMap<string, OriginSet>,
    ): OriginSet | undefined => {
      if (input === undefined) return undefined;
      const node = unwrap(input);
      if (path.length === 0) return originOf(node, trail, bindings);
      const member = path[0]!;
      const rest = path.slice(1);
      const key = `${nodeKey(node)}:${path.join(".")}`;
      if (trail.has(key)) return undefined;
      const next = new Set(trail);
      next.add(key);
      const directTrail = new Set(next);
      directTrail.add(nodeKey(node));
      const direct = rest.reduce<OriginSet | undefined>(
        (value, part) => memberOrigins(value, part),
        memberOrigins(originOf(node, directTrail, bindings), member),
      );
      const candidates: Array<OriginSet | undefined> = [direct];
      if (Node.isObjectLiteralExpression(node)) {
        for (const property of [...node.getProperties()].reverse()) {
          if (
            Node.isPropertyAssignment(property) &&
            property.getName() === member
          ) {
            candidates.push(memberValueOrigins(
              property.getInitializer(),
              rest,
              next,
              bindings,
            ));
          }
          if (
            Node.isShorthandPropertyAssignment(property) &&
            property.getName() === member
          ) {
            candidates.push(memberValueOrigins(
              property.getNameNode(),
              rest,
              next,
              bindings,
            ));
          }
          if (Node.isSpreadAssignment(property)) {
            candidates.push(memberValueOrigins(
              property.getExpression(),
              path,
              next,
              bindings,
            ));
          }
        }
      }
      if (Node.isArrayLiteralExpression(node) && /^\d+$/.test(member)) {
        candidates.push(memberValueOrigins(
          node.getElements()[Number(member)],
          rest,
          next,
          bindings,
        ));
      }
      if (Node.isConditionalExpression(node)) {
        candidates.push(memberValueOrigins(
          node.getWhenTrue(),
          path,
          next,
          bindings,
        ), memberValueOrigins(
          node.getWhenFalse(),
          path,
          next,
          bindings,
        ));
      }
      if (
        Node.isBinaryExpression(node) &&
        [
          SyntaxKind.BarBarToken,
          SyntaxKind.AmpersandAmpersandToken,
          SyntaxKind.QuestionQuestionToken,
        ].includes(node.getOperatorToken().getKind())
      ) {
        candidates.push(
          memberValueOrigins(node.getLeft(), path, next, bindings),
          memberValueOrigins(node.getRight(), path, next, bindings),
        );
      }
      if (Node.isCallExpression(node)) {
        const target = unwrap(node.getExpression());
        for (const callable of callableShapes(target)) {
          const nested = callBindings(callable, node, next, bindings);
          for (const returned of callable.returns) {
            candidates.push(memberValueOrigins(
              returned,
              path,
              next,
              nested,
            ));
          }
        }
      }
      for (const declaration of symbolDeclarations(node)) {
        const value =
          Node.isVariableDeclaration(declaration) ||
            Node.isPropertyAssignment(declaration)
            ? declaration.getInitializer()
            : Node.isExportAssignment(declaration)
              ? declaration.getExpression()
              : undefined;
        if (value === undefined) continue;
        candidates.push(memberValueOrigins(
          value,
          path,
          next,
          bindings,
        ));
      }
      return mergeOrigins(...candidates);
    };
    const declarationOrigins = (
      declaration: Node,
      trail: ReadonlySet<string>,
      bindings: ReadonlyMap<string, OriginSet>,
    ): OriginSet | undefined => {
      if (
        Node.isVariableDeclaration(declaration) ||
        Node.isPropertyAssignment(declaration) ||
        Node.isPropertyDeclaration(declaration)
      ) {
        return originOf(declaration.getInitializer(), trail, bindings);
      }
      if (Node.isGetAccessorDeclaration(declaration)) {
        return mergeOrigins(
          ...returnedExpressions(declaration).map((expression) =>
            originOf(expression, trail, bindings)
          ),
        );
      }
      if (Node.isShorthandPropertyAssignment(declaration)) {
        return originOf(declaration.getNameNode(), trail, bindings);
      }
      if (Node.isExportAssignment(declaration)) {
        return originOf(declaration.getExpression(), trail, bindings);
      }
      if (Node.isBindingElement(declaration)) {
        const pattern = declaration.getParent();
        const variable = pattern.getParentIfKind(
          SyntaxKind.VariableDeclaration,
        );
        const initializer = variable?.getInitializer();
        if (initializer === undefined) return undefined;
        if (Node.isObjectBindingPattern(pattern)) {
          const property =
            declaration.getPropertyNameNode()?.getText() ??
            declaration.getNameNode().getText();
          return memberValueOrigins(
            initializer,
            [property],
            trail,
            bindings,
          );
        }
        if (Node.isArrayBindingPattern(pattern)) {
          const index = pattern.getElements().indexOf(declaration);
          return index < 0
            ? undefined
            : memberValueOrigins(
                initializer,
                [String(index)],
                trail,
                bindings,
              );
        }
      }
      return undefined;
    };
    const staticMemberNames = (
      input: Node | undefined,
      trail: ReadonlySet<string> = new Set(),
    ): ReadonlySet<string> | undefined => {
      if (input === undefined) return undefined;
      const node = unwrap(input);
      if (
        Node.isStringLiteral(node) ||
        Node.isNoSubstitutionTemplateLiteral(node) ||
        Node.isNumericLiteral(node)
      ) {
        return new Set([node.getLiteralText()]);
      }
      const type = node.getType();
      if (type.isStringLiteral() || type.isNumberLiteral()) {
        return new Set([String(type.getLiteralValue())]);
      }
      const key = nodeKey(node);
      if (trail.has(key)) return undefined;
      const next = new Set(trail);
      next.add(key);
      if (Node.isIdentifier(node)) {
        const names = symbolDeclarations(node).flatMap((declaration) => {
          if (
            Node.isVariableDeclaration(declaration) &&
            declaration.getParentIfKind(SyntaxKind.VariableDeclarationList)
                ?.getDeclarationKind() === "const"
          ) {
            return [...(staticMemberNames(declaration.getInitializer(), next) ?? [])];
          }
          return [];
        });
        return names.length === 0 ? undefined : new Set(names);
      }
      if (Node.isConditionalExpression(node)) {
        const names = [
          ...(staticMemberNames(node.getWhenTrue(), next) ?? []),
          ...(staticMemberNames(node.getWhenFalse(), next) ?? []),
        ];
        return names.length === 0 ? undefined : new Set(names);
      }
      return undefined;
    };
    const commonJsModule = (node: Node): string | undefined => {
      if (!Node.isCallExpression(node)) return undefined;
      const target = unwrap(node.getExpression());
      const isAmbient = (candidate: Node): boolean => {
        const symbol = candidate.getSymbol();
        if (symbol === undefined) return true;
        const declarations = (symbol.getAliasedSymbol() ?? symbol).getDeclarations();
        return declarations.length > 0 && declarations.every((declaration) =>
          declaration.getSourceFile().isDeclarationFile()
        );
      };
      const isRequire =
        (Node.isIdentifier(target) &&
          target.getText() === "require" &&
          isAmbient(target)) ||
        (Node.isPropertyAccessExpression(target) &&
          target.getName() === "require" &&
          ["module", "globalThis", "global"].includes(
            unwrap(target.getExpression()).getText(),
          ) &&
          isAmbient(unwrap(target.getExpression()))) ||
        (Node.isElementAccessExpression(target) &&
          staticMemberNames(target.getArgumentExpression())?.has("require") === true &&
          ["module", "globalThis", "global"].includes(
            unwrap(target.getExpression()).getText(),
          ) &&
          isAmbient(unwrap(target.getExpression())));
      const specifier = node.getArguments()[0];
      return isRequire &&
          specifier !== undefined &&
          (Node.isStringLiteral(specifier) ||
            Node.isNoSubstitutionTemplateLiteral(specifier))
        ? specifier.getLiteralText()
        : undefined;
    };
    function originOf(
      input: Node | undefined,
      trail: ReadonlySet<string> = new Set(),
      bindings: ReadonlyMap<string, OriginSet> = new Map(),
    ): OriginSet | undefined {
      if (input === undefined) return undefined;
      const node = unwrap(input);
      if (Node.isIdentifier(node)) {
        const binding = bindings.get(node.getText());
        if (binding !== undefined) return binding;
      }
      const direct = origins.get(node.getText());
      if (direct !== undefined) return direct;
      const key = nodeKey(node);
      if (trail.has(key)) return undefined;
      const next = new Set(trail);
      next.add(key);
      if (
        Node.isCallExpression(node) &&
        node.getExpression().getKind() === SyntaxKind.ImportKeyword
      ) {
        const specifier = node.getArguments()[0];
        return specifier !== undefined &&
            (Node.isStringLiteral(specifier) ||
              Node.isNoSubstitutionTemplateLiteral(specifier))
          ? originSet(moduleOrigin(specifier.getLiteralText()))
          : undefined;
      }
      const requiredModule = commonJsModule(node);
      if (requiredModule !== undefined) {
        return originSet(moduleOrigin(requiredModule));
      }
      if (Node.isCallExpression(node)) {
        const target = unwrap(node.getExpression());
        return mergeOrigins(...callableShapes(target).flatMap((callable) => {
          const nested = callBindings(callable, node, next, bindings);
          return callable.returns.map((expression) =>
            originOf(expression, next, nested)
          );
        }));
      }
      if (Node.isIdentifier(node)) {
        return mergeOrigins(...symbolDeclarations(node).map((declaration) =>
          declarationOrigins(declaration, next, bindings)
        ));
      }
      if (Node.isPropertyAccessExpression(node)) {
        const base = originOf(node.getExpression(), next, bindings);
        return mergeOrigins(
          memberOrigins(base, node.getName()),
          memberValueOrigins(node.getExpression(), [node.getName()], next, bindings),
          ...symbolDeclarations(node.getNameNode()).map((declaration) =>
            declarationOrigins(declaration, next, bindings)
          ),
        );
      }
      if (Node.isElementAccessExpression(node)) {
        const base = originOf(node.getExpression(), next, bindings);
        const argument = node.getArgumentExpression();
        const members = staticMemberNames(argument);
        if (members !== undefined) {
          return mergeOrigins(...[...members].map((member) =>
            mergeOrigins(
              memberOrigins(base, member),
              memberValueOrigins(
                node.getExpression(),
                [member],
                next,
                bindings,
              ),
            )
          ));
        }
        if (base !== undefined) {
          return originSet(...[...base].map((origin) => `${origin}.[computed]`));
        }
      }
      if (Node.isConditionalExpression(node)) {
        return mergeOrigins(
          originOf(node.getWhenTrue(), next, bindings),
          originOf(node.getWhenFalse(), next, bindings),
        );
      }
      if (
        Node.isBinaryExpression(node) &&
        [
          SyntaxKind.BarBarToken,
          SyntaxKind.AmpersandAmpersandToken,
          SyntaxKind.QuestionQuestionToken,
        ].includes(node.getOperatorToken().getKind())
      ) {
        return mergeOrigins(
          originOf(node.getLeft(), next, bindings),
          originOf(node.getRight(), next, bindings),
        );
      }
      return undefined;
    }
    const setOrigins = (name: string, value: OriginSet): boolean => {
      const current = origins.get(name);
      const merged = mergeOrigins(current, value)!;
      if (current !== undefined && merged.size === current.size) return false;
      origins.set(name, merged);
      return true;
    };
    const bindOrigins = (
      name: Node,
      value: OriginSet,
      source: Node = name,
    ): boolean => {
      if (
        Node.isIdentifier(name) ||
        Node.isPropertyAccessExpression(name) ||
        Node.isElementAccessExpression(name)
      ) {
        const changed = setOrigins(name.getText(), value);
        for (const origin of value) {
          const api = sensitiveOriginApi(origin);
          if (api !== undefined) record(source, api, sf);
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
            : bindOrigins(local, bound, element);
        }).some(Boolean);
      }
      if (Node.isArrayBindingPattern(name)) {
        return name.getElements().map((element, index) => {
          if (!Node.isBindingElement(element)) return false;
          const bound = memberOrigins(value, String(index));
          return bound === undefined
            ? false
            : bindOrigins(element.getNameNode(), bound, element);
        }).some(Boolean);
      }
      if (Node.isObjectLiteralExpression(name)) {
        return name.getProperties().map((property) => {
          if (Node.isPropertyAssignment(property)) {
            const bound = memberOrigins(value, property.getName());
            if (bound === undefined) return false;
            return bindOrigins(
              property.getInitializer()!,
              bound,
              property,
            );
          }
          if (!Node.isShorthandPropertyAssignment(property)) return false;
          const bound = memberOrigins(value, property.getName());
          return bound === undefined
            ? false
            : bindOrigins(property.getNameNode(), bound, property);
        }).some(Boolean);
      }
      return false;
    };
    for (const declaration of sf.getImportDeclarations()) {
      const moduleName = declaration.getModuleSpecifierValue();
      const normalizedModuleName = moduleName.replace(/^node:/, "");
      const namespace = declaration.getNamespaceImport()?.getText();
      const defaultImport = declaration.getDefaultImport()?.getText();
      const base = moduleOrigin(moduleName);
      if (base !== undefined && namespace !== undefined) {
        origins.set(namespace, new Set([base]));
      }
      if (base !== undefined && defaultImport !== undefined) {
        origins.set(defaultImport, new Set([base]));
      }
      for (const specifier of declaration.getNamedImports()) {
        const imported = specifier.getName();
        const local = specifier.getAliasNode()?.getText() ?? imported;
        const importedModuleOrigin = moduleOrigin(moduleName);
        const origin =
          normalizedModuleName === "crypto" &&
            (cryptoRandomMembers.has(imported) || imported === "webcrypto")
            ? `crypto.${imported}` :
            normalizedModuleName === "process" ?
              `process.${imported}` :
              normalizedModuleName === "os" ?
                `os.${imported}` :
              normalizedModuleName === "perf_hooks" && imported === "performance" ? "performance" :
                importedModuleOrigin !== undefined ? `${importedModuleOrigin}.${imported}` :
                  undefined;
        if (origin === undefined) continue;
        origins.set(local, new Set([origin]));
        const api = sensitiveOriginApi(origin);
        if (
          api !== undefined &&
          (!hostIoApi(api) || !allowedRepositoryInputImport(api, sf))
        ) {
          record(specifier, api, sf);
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
        origins.set(declaration.getNameNode().getText(), new Set([base]));
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const declaration of sf.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration,
      )) {
        const initializerOrigins = originOf(declaration.getInitializer());
        if (initializerOrigins !== undefined) {
          changed =
            bindOrigins(
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
            : originOf(assignment.getLeft()),
          originOf(assignment.getRight()),
        );
        if (value !== undefined) {
          changed =
            bindOrigins(
              unwrap(assignment.getLeft()),
              value,
              assignment,
            ) || changed;
        }
      }
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const target = unwrap(call.getExpression());
        const callable = Node.isIdentifier(target)
          ? localFunctions.get(target.getText())
          : undefined;
        if (callable === undefined) continue;
        const parameterBindings = callBindings(
          callable,
          call,
          new Set(),
          new Map(),
        );
        for (const [name, value] of parameterBindings) {
          changed = setOrigins(name, value) || changed;
        }
      }
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      for (const origin of originOf(call.getExpression()) ?? []) {
        if (origin === "Date" && call.getArguments().length === 0) {
          record(call, "new Date() (argless)", sf);
          continue;
        }
        const api = sensitiveOriginApi(origin);
        if (api !== undefined) record(call, api, sf);
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
        record(call, "non-literal dynamic import", sf);
      }
      for (const origin of originOf(call.getExpression()) ?? []) {
        if (origin === "Date") {
          record(call, "Date() (callable)", sf);
        } else {
          const api = sensitiveOriginApi(origin);
          if (api !== undefined) record(call, api, sf);
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
      for (const origin of originOf(access) ?? []) {
        const api = sensitiveOriginApi(origin);
        if (api !== undefined) record(access, api, sf);
        if (origin === "Intl" || origin.startsWith("Intl.")) {
          record(access, "Intl", sf);
        }
      }
      if (/^toLocale(String|DateString|TimeString)$/.test(name) || name === "localeCompare") {
        record(access, name, sf);
      }
    }
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const importDeclaration = identifier.getFirstAncestor((ancestor) =>
        Node.isImportDeclaration(ancestor) ||
        Node.isImportEqualsDeclaration(ancestor)
      );
      if (importDeclaration === undefined) {
        for (const origin of originOf(identifier) ?? []) {
          const api = sensitiveOriginApi(origin);
          if (api !== undefined && hostIoApi(api)) record(identifier, api, sf);
        }
      }
      if (identifier.getText() !== "Intl") continue;
      const parent = identifier.getParent();
      if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) continue;
      record(identifier, "Intl", sf);
    }
  }
  uses.push(...repositoryInputRootUses(project, root));
  return uses;
}
