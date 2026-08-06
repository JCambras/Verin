import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { Node, Project, SyntaxKind, ts, type SourceFile } from "ts-morph";
import {
  isExecutableSourceFilePath,
  moduleReferences,
  REPO_ROOT,
  toolingSourceFiles,
} from "./_fence-utils";
import { inMemoryProject } from "./_fence-utils";
import { loadTaxonomy } from "../../../scripts/corpus/defects";
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import { buildInventory, corpusDigest, taxonomySemanticDigest } from "../../../scripts/corpus/manifest";
import { inspectRealDerivedPartition } from "../../../scripts/corpus/real-derived";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import { loadSignoff } from "../../../scripts/corpus/signoff";
import { readRepositoryFile } from "../../../scripts/corpus/tree";
import { loadSpec, type LoadedSpec } from "../../../scripts/corpus/world";
import { committedBytesProblems, readCommittedCorpus } from "../../../scripts/corpus/validate";

/**
 * CORPUS-DETERMINISM FENCE (v3 prompt 11, ADR-0039; charter #1/#4).
 *
 * The corpus is only usable as replay input if the same spec and seed produce
 * the same bytes forever. Five properties, each of which a plausible generator
 * fails:
 *
 *  (a) BYTE IDENTITY - two generations agree byte for byte, and the COMMITTED
 *      tree equals a fresh regeneration (so a hand edit to a generated file
 *      fails the build - this is what generated-file ownership actually means);
 *  (b) SEED SENSITIVITY - a different seed produces a different corpus. Without
 *      this, a generator that ignores the seed entirely passes (a);
 *  (c) ORDER INDEPENDENCE - inserting a household in the MIDDLE of the spec
 *      changes only that household's cases. A stream PRNG fails this; the
 *      path-keyed derivation in scripts/corpus/seed.ts is what makes it hold;
 *  (d) NO NON-DETERMINISM AT THE SOURCE - an AST ban on clocks, randomness,
 *      locale APIs and environment reads anywhere under `scripts/corpus/`;
 *  (e) ENVIRONMENT INDEPENDENCE - generating under TZ=UTC and TZ=Asia/Kolkata
 *      yields the identical corpusDigest.
 *
 * The detectors are pure functions over injected input, so the companion can
 * feed violating generators and corpora and prove they CANNOT pass (charter #4).
 */
const CORPUS_SRC = join(REPO_ROOT, "scripts", "corpus");

// ── (d) the non-determinism ban ────────────────────────────────────────────────

interface BannedUse {
  file: string;
  line: number;
  api: string;
}

const REPOSITORY_INPUT_BOUNDARIES = [
  { file: "/scripts/golden-cases.lib.ts", owner: "loadScenarioRefs", inputs: {} },
  { file: "/scripts/golden-cases.lib.ts", owner: "loadGoldenCases", rootParameters: [0], inputs: { "fs.existsSync": ["dir"], "fs.readdirSync": ["dir"] } },
  { file: "/scripts/corpus/scrub-contract.ts", owner: "schemaFromSpec", inputs: {} },
  { file: "/scripts/corpus/world.ts", owner: "readSpecFile", rootParameters: [1], inputs: {} },
  { file: "/scripts/corpus/tree.ts", owner: "readTree", rootParameters: [0], inputs: { "fs.existsSync": ["dir"], "fs.lstatSync": ["dir"], "fs.readdirSync": ["dir"], "fs.readFileSync": ["fullPath"] } },
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

const repositoryInputRootUses = (
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

const generatorProject = (root: string = CORPUS_SRC): Project => {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of toolingSourceFiles(root)) {
    project.addSourceFileAtPath(file);
  }
  for (let index = 0; index < project.getSourceFiles().length; index += 1) {
    const source = project.getSourceFiles()[index]!;
    for (const reference of moduleReferences(source)) {
      if (reference.specifier === null) continue;
      const resolved = ts.resolveModuleName(
        reference.specifier,
        source.getFilePath(),
        project.getCompilerOptions(),
        project.getModuleResolutionHost(),
      ).resolvedModule;
      if (
        resolved === undefined ||
        resolved.isExternalLibraryImport ||
        !isExecutableSourceFilePath(resolved.resolvedFileName) ||
        resolved.resolvedFileName.split(/[/\\]/).includes("node_modules") ||
        project.getSourceFile(resolved.resolvedFileName) !== undefined
      ) {
        continue;
      }
      project.addSourceFileAtPath(resolved.resolvedFileName);
    }
  }
  return project;
};

// ── (b) + (c) comparison helpers ───────────────────────────────────────────────

const bytesByPath = (spec: LoadedSpec, seed: string): Map<string, string> =>
  new Map(generateSyntheticCases(spec, seed).map((file) => [file.relPath, file.bytes]));

/** Files whose bytes differ between two generations (plus added/removed paths). */
export function changedPaths(left: Map<string, string>, right: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [path, bytes] of left) if (right.get(path) !== bytes) changed.add(path);
  for (const [path, bytes] of right) if (left.get(path) !== bytes) changed.add(path);
  return [...changed].sort();
}

/** The seed-sensitivity check itself, as a detector: two DISTINCT seeds that
 * produce identical bytes mean the seed is decorative. */
export function seedSensitivityProblems(underA: Map<string, string>, underB: Map<string, string>): string[] {
  return changedPaths(underA, underB).length === 0
    ? ["generator output is identical under two distinct seeds - the seed is not being used"]
    : [];
}

/**
 * A NEW household inserted in the MIDDLE of every spec collection, so a
 * position-sensitive generator reshuffles and a path-keyed one does not.
 *
 * Its key is `smiths-west`: a deliberate PREFIX COLLISION with the existing
 * `smiths` household, carrying its own position-scoped legal hold. A subgraph
 * that resolved holds by substring (`subjectRef.includes(":smiths")`) would leak
 * this hold into `smiths` and change a foreign household's committed bytes - the
 * exact break a neutrally-keyed `inserted` household cannot detect.
 */
function specWithInsertedHousehold(spec: LoadedSpec): LoadedSpec {
  const middle = <T>(rows: readonly T[], row: T): T[] => {
    const at = Math.floor(rows.length / 2);
    return [...rows.slice(0, at), row, ...rows.slice(at)];
  };
  const world = spec.world;
  const observedAt = world.accounts[0]!.balanceObservedAt;
  return {
    ...spec,
    world: {
      ...world,
      parties: middle(world.parties, {
        key: "smiths-west-party",
        kind: "natural-person",
        rosterName: "Inserted Fixture Person",
        roles: ["client"],
      }),
      households: middle(world.households, {
        key: "smiths-west",
        scopeSlug: "smiths-west",
        displayName: "Inserted Fixture Household",
        memberRefs: ["smiths-west-party"],
        advisorRef: world.households[0]!.advisorRef,
      }),
      accounts: middle(world.accounts, {
        key: "smiths-west-taxable",
        householdRef: "smiths-west",
        registration: "individual",
        ownerRefs: ["smiths-west-party"],
        custodian: world.accounts[0]!.custodian,
        balanceMinor: 1_000_000,
        balanceObservedAt: observedAt,
        taxClass: "taxable",
      }),
      bankInstructions: middle(world.bankInstructions, {
        key: "smiths-west-primary",
        householdRef: "smiths-west",
        titledTo: "smiths-west-party",
        bank: "Inserted Bank",
        lastFour: "0000",
        verifiedAt: world.bankInstructions[0]!.verifiedAt,
        changedAt: null,
        accountRefs: ["smiths-west-taxable"],
        observedAt,
      }),
      legalHolds: middle(world.legalHolds, {
        key: "smiths-west-position-hold",
        subjectRef: "position:smiths-west-taxable:NBRD-2031",
        scope: "position",
        recordedAt: observedAt,
        observedAt,
        releasedAt: null,
      }),
    },
    cases: {
      ...spec.cases,
      cases: middle(spec.cases.cases, {
        key: "smiths-west-control",
        title: "Inserted clean control",
        firmId: "firm-a",
        householdRef: "smiths-west",
        assumptionIds: [],
        label: { kind: "clean-control", controlRationale: "Inserted to prove order independence." },
        request: {
          action: "distribution",
          sourceAccountRef: "smiths-west-taxable",
          selectedFundingRefs: ["smiths-west-taxable"],
          destinationRef: "smiths-west-primary",
          amountMinor: 100_000,
          discriminator: "1000-2026-09-10",
          deadline: "2026-09-10T13:00:00.000Z",
        },
        outcomes: [{
          defectClassId: "destination-integrity-defect",
          expectedTreatment: "accept-verified-unique-destination",
          observedTreatment: "accept-verified-unique-destination",
        }],
        evidence: ["balance/smiths-west-taxable", "bank-instruction/smiths-west-primary"],
        conflictFamilies: ["liquidity"],
      }),
    },
  };
}

const realSpec = loadSpec();
const realTaxonomy = loadTaxonomy();

describe("corpus-determinism fence", () => {
  it("(a) enforces: two generations of the same spec + seed are byte-identical", () => {
    expect(changedPaths(bytesByPath(realSpec, CORPUS_SEED), bytesByPath(realSpec, CORPUS_SEED))).toEqual([]);
  });

  it("(a) enforces: the COMMITTED corpus equals a fresh regeneration (no hand edits)", () => {
    const generated = generateSyntheticCases(realSpec, CORPUS_SEED);
    const problems = committedBytesProblems(generated, readCommittedCorpus().filter((f) => f.relPath !== "manifest.json"));
    expect(problems, `committed corpus drifted:\n${problems.join("\n")}`).toEqual([]);
    expect(generated.length).toBeGreaterThan(0);
  });

  it("(b) enforces: a DIFFERENT seed produces a different corpus", () => {
    const problems = seedSensitivityProblems(
      bytesByPath(realSpec, CORPUS_SEED),
      bytesByPath(realSpec, "verin-corpus/other-seed"),
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("(c) enforces: inserting a PREFIX-COLLIDING household mid-spec changes ONLY that household's cases", () => {
    const before = bytesByPath(realSpec, CORPUS_SEED);
    const after = bytesByPath(specWithInsertedHousehold(realSpec), CORPUS_SEED);
    expect(changedPaths(before, after)).toEqual(["synthetic/CS-smiths-west-control.json"]);
  });

  it("(c) enforces: reordering assumptions does not change emitted bytes", () => {
    const reordered: LoadedSpec = {
      ...realSpec,
      cases: {
        ...realSpec.cases,
        assumptions: [...realSpec.cases.assumptions].reverse(),
      },
    };
    expect(
      changedPaths(
        bytesByPath(realSpec, CORPUS_SEED),
        bytesByPath(reordered, CORPUS_SEED),
      ),
    ).toEqual([]);
  });

  it("(d) enforces: no clock, randomness, locale API, or env read under scripts/corpus/", () => {
    const uses = bannedNondeterminismUses(generatorProject(), REPO_ROOT);
    expect(
      uses,
      `non-deterministic APIs in the generator:\n${uses.map((u) => `${u.file}:${u.line} ${u.api}`).join("\n")}`,
    ).toEqual([]);
  });

  it("(d) enforces: the ban scans a non-empty generator tree (never vacuously green)", () => {
    expect(generatorProject().getSourceFiles().length).toBeGreaterThanOrEqual(8);
  });

  it(
    "(e) enforces: generation under TZ=UTC and TZ=Asia/Kolkata yields the same corpusDigest",
    () => {
      const tsx = join(REPO_ROOT, "node_modules", ".bin", "tsx");
      if (!existsSync(tsx)) throw new Error("tsx binary missing - install dependencies before running this fence");
      const digestUnder = (TZ: string): string => {
        const run = spawnSync(tsx, [join(REPO_ROOT, "scripts", "corpus-generate.ts"), "--print-digest"], {
          cwd: REPO_ROOT,
          env: { ...process.env, TZ },
          encoding: "utf8",
        });
        if (run.status !== 0) throw new Error(`generation under TZ=${TZ} failed: ${run.stderr}`);
        return run.stdout.trim();
      };
      // The expectation must be over the SAME inventory the runner builds -
      // both partitions. Building it from the synthetic partition alone agrees
      // only while real-derived is empty, and the day it is populated this
      // fence would report a time-zone failure for an inventory mismatch.
      const realDerived = inspectRealDerivedPartition(
        realTaxonomy,
        realSpec.world.corpusVersion,
      );
      expect(realDerived.problems).toEqual([]);
      const inProcess = corpusDigest(
        realSpec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(realTaxonomy),
        [
          ...buildInventory(generateSyntheticCases(realSpec, CORPUS_SEED)),
          ...buildInventory(realDerived.inventoryFiles, "real-derived"),
        ],
      );
      expect(digestUnder("UTC")).toBe(inProcess);
      expect(digestUnder("Asia/Kolkata")).toBe(inProcess);
    },
    120_000,
  );
});

describe("detects (companion): a non-deterministic generator or a drifted corpus CANNOT pass", () => {
  const file = (body: string) => ({ "/src/contracts/gen.ts": body });

  it("flags Math.random, Date.now, an argless new Date(), and randomUUID", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "export const a = Math.random();\nexport const b = Date.now();\nexport const c = new Date();\nexport const d = crypto.randomUUID();\n",
        ),
      ),
    );
    expect(uses.map((u) => u.api).sort()).toEqual(["Date.now", "Math.random", "new Date() (argless)", "randomUUID"]);
  });

  it("flags locale APIs and Intl but ALLOWS new Date(<explicit iso>)", () => {
    const banned = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'export const a = new Date(0).toLocaleDateString();\nexport const b = "x".localeCompare("y");\nexport const c = new Intl.DateTimeFormat("en-US");\n',
        ),
      ),
    );
    expect(banned.map((u) => u.api).sort()).toEqual(["Intl", "localeCompare", "toLocaleDateString"]);
    expect(
      bannedNondeterminismUses(inMemoryProject(file('export const t = new Date("2026-07-26T13:30:00.000Z").getTime();\n'))),
    ).toEqual([]);
  });

  it("flags a process.env read inside the generator", () => {
    const uses = bannedNondeterminismUses(inMemoryProject(file('export const s = process.env.SEED ?? "x";\n')));
    expect(uses.some((u) => u.api === "process.env")).toBe(true);
  });

  it("flags dynamic code construction", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'const run = eval; void run("Date.now()");\nconst build = globalThis.Function; void new build("return process.env.SEED");\n',
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["eval", "Function"]),
    );
  });

  it("flags nondeterministic APIs through globalThis and global roots", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "export const a = globalThis.Date.now();\nconst root = globalThis;\nconst { crypto: rng, process: runtime } = root;\nvoid rng.randomUUID();\nvoid runtime.env.SEED;\nvoid global.performance.now();\nvoid global['Math'].random();\n",
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set([
        "Date.now",
        "randomUUID",
        "process.env",
        "performance.now",
        "Math.random",
      ]),
    );
  });

  it("flags Intl and process.env through bracketed ambient-global access", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'void globalThis.Intl.DateTimeFormat("en-US");\nvoid globalThis["process"]["env"]["SEED"];\n',
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["Intl", "process.env"]),
    );
  });

  it("flags destructured, aliased, and named-import nondeterministic APIs", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/globals.ts":
          "const { random: sample } = Math;\nconst alias = sample;\nconst { now: clock } = Date;\nconst { hrtime: highResolution } = process;\nvoid [alias, clock, highResolution];\n",
        "/src/contracts/imported.ts":
          'import { randomUUID as uuid } from "node:crypto";\nvoid uuid;\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["Math.random", "Date.now", "process.hrtime", "randomUUID"]),
    );
  });

  it("flags callable Date and every supported crypto randomness form", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/direct.ts":
          "void Date();\nvoid crypto.randomBytes(8);\nvoid crypto.randomFill(new Uint8Array(8), () => undefined);\nvoid crypto.randomInt(10);\nvoid crypto.getRandomValues(new Uint8Array(8));\nvoid crypto.subtle.generateKey({ name: \"AES-GCM\", length: 256 }, true, [\"encrypt\"]);\n",
        "/src/contracts/aliases.ts":
          "const clock = Date;\nconst { randomBytes: bytes, randomInt: integer } = crypto;\nvoid clock();\nvoid bytes(8);\nvoid integer(10);\n",
        "/src/contracts/imported.ts":
          'import { randomFillSync as fill } from "node:crypto";\nvoid fill(new Uint8Array(8));\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["Date() (callable)", "randomBytes", "randomFill", "randomInt", "getRandomValues", "generateKey", "randomFillSync"]),
    );
  });

  it("flags nondeterministic APIs through assignments, parameters, returns, and dynamic imports", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/assigned.ts":
          "let clock;\nclock = Date;\nvoid clock();\n",
        "/src/contracts/parameter.ts":
          "function invoke(value: unknown) { return value; }\nconst clock = invoke(Date);\nvoid clock();\n",
        "/src/contracts/dynamic.ts":
          "async function sample() { const api = await import(\"node:crypto\"); return api.randomBytes(8); }\nvoid sample;\n",
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["Date() (callable)", "randomBytes"]),
    );
  });

  it("flags nondeterministic origins through logical compound assignments", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "let runtime;\nruntime ??= process;\nvoid runtime.env.SEED;\n",
        ),
      ),
    );
    expect(uses.some((use) => use.api === "process.env")).toBe(true);
  });

  it("rejects approved repository loaders called with external roots", () => {
    const project = generatorProject();
    project.createSourceFile(
      join(CORPUS_SRC, "external-root-probe.ts"),
      'import { loadSpec } from "./world";\nexport const external = loadSpec("/tmp/external-corpus");\n',
    );
    project.createSourceFile(
      join(CORPUS_SRC, "shadowed-path-probe.ts"),
      'import { loadSpec, REPO_ROOT } from "./world";\nconst join = (_root: string) => "/tmp/external-corpus";\nexport const external = loadSpec(join(REPO_ROOT));\n',
    );
    project.createSourceFile(
      join(CORPUS_SRC, "traversal-root-probe.ts"),
      'import { resolve } from "node:path";\nimport { loadSpec, REPO_ROOT } from "./world";\nexport const external = loadSpec(resolve(REPO_ROOT, ".."));\n',
    );
    project.createSourceFile(
      join(CORPUS_SRC, "forwarded-root-probe.ts"),
      'import { loadSpec } from "./world";\nconst load = (root: string) => loadSpec(root);\nexport const external = load("/tmp/external-corpus");\n',
    );
    expect(
      bannedNondeterminismUses(project, REPO_ROOT).filter(
        (use) => use.api === "repository input outside REPO_ROOT",
      ),
    ).toHaveLength(4);
  });

  it("rejects a mutable alias that can redirect an approved repository loader", () => {
    const project = generatorProject();
    project.createSourceFile(
      join(CORPUS_SRC, "mutable-root-probe.ts"),
      'import { loadSpec, REPO_ROOT } from "./world";\nlet dir = REPO_ROOT;\ndir = "/tmp/external-corpus";\nexport const external = loadSpec(dir);\n',
    );
    expect(
      bannedNondeterminismUses(project, REPO_ROOT).some(
        (use) => use.api === "repository input outside REPO_ROOT",
      ),
    ).toBe(true);
  });

  const PENDING_SIGNOFF_BYTES =
    "```yaml\ncorpusVersion: 2026.07.0\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null\n```\n";

  // The proof roots live in the OS temp tree, never inside this repository.
  // Containment is a property of the root a read is made against, so planting
  // the fixtures here would buy nothing - and a transient directory under
  // REPO_ROOT races every fence that walks the repository (`no-secret-fallback`
  // reads every committed text file), which is a flake this suite would then
  // have to hide behind serial execution.
  const proofRepository = (): { root: string; spec: string } => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-input-proof-"));
    const spec = join(root, "spec");
    mkdirSync(spec);
    return { root, spec };
  };

  it("repository readers reject symlinked files whose target leaves the repository root", () => {
    const externalDir = mkdtempSync(join(tmpdir(), "verin-corpus-external-"));
    const { root, spec } = proofRepository();
    try {
      const externalSignoff = join(externalDir, "SIGNOFF.md");
      writeFileSync(externalSignoff, PENDING_SIGNOFF_BYTES);
      symlinkSync(externalSignoff, join(spec, "SIGNOFF.md"));
      expect(() => loadSignoff(spec, root)).toThrow(
        /"[^"]*SIGNOFF\.md" resolves outside this repository/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  // A refusal that names neither the input nor the reason is unusable in the
  // blocking `corpus` job, and "reject every symlink" is not the containment
  // rule - the canonical target is what is checked and what is read.
  it("repository readers name the missing input and accept an in-repository symlink", () => {
    const { root, spec } = proofRepository();
    try {
      expect(() => loadSignoff(spec, root)).toThrow(
        /"[^"]*SIGNOFF\.md" does not exist/,
      );
      const target = join(spec, "signoff-source.md");
      writeFileSync(target, PENDING_SIGNOFF_BYTES);
      symlinkSync(target, join(spec, "SIGNOFF.md"));
      expect(loadSignoff(spec, root).status).toBe("pending-captain");
      rmSync(join(spec, "SIGNOFF.md"));
      mkdirSync(join(spec, "SIGNOFF.md"));
      expect(() => loadSignoff(spec, root)).toThrow(
        /"[^"]*SIGNOFF\.md" is not a regular file/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The ROOT is an input too. An unresolvable one used to escape the reader's
  // naming rule entirely, and a repository reached through a symlinked root
  // named every file by absolute path - the exact case naming exists to fix.
  it("repository readers name an unresolvable root and stay repo-relative under a symlinked one", () => {
    const externalDir = mkdtempSync(join(tmpdir(), "verin-corpus-root-proof-"));
    const localDir = proofRepository().root;
    try {
      expect(() => loadTaxonomy(localDir, join(externalDir, "absent-root"))).toThrow(
        /repository root "[^"]*absent-root" does not exist/,
      );
      const linkedRoot = join(externalDir, "linked-root");
      symlinkSync(realpathSync(localDir), linkedRoot);
      expect(() =>
        readRepositoryFile(join(realpathSync(localDir), "absent-input.md"), linkedRoot),
      ).toThrow(/repository input "absent-input\.md" does not exist/);
    } finally {
      rmSync(localDir, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it("flags local-module and container-member nondeterministic origins", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/helper.ts":
          "export const runtime = process;\nexport const box = { runtime: process };\nexport const list = [process] as const;\n",
        "/src/contracts/consumer.ts":
          'import { runtime, box, list } from "./helper";\nvoid runtime.env.SEED;\nvoid box.runtime.env.SEED;\nvoid list[0].env.SEED;\nvoid ({ runtime: process }).runtime.env.SEED;\n',
      }),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(4);
  });

  it("flags every sensitive conditional, logical, and callable-return origin", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "declare const flag: boolean;\nconst conditional = flag ? Math : process;\nvoid conditional.env.SEED;\nconst logical = Math || process;\nvoid logical.env.SEED;\nfunction runtime() { return flag ? Math : process; }\nvoid runtime().env.SEED;\n",
        ),
      ),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(3);
  });

  it("flags origins passed through nested object and array parameter patterns", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/helper.ts":
          "export const pickObject = ({ runtime }: { runtime: any }) => runtime;\nexport const pickNested = ({ box: { runtime } }: { box: { runtime: any } }) => runtime;\nexport const pickArray = ([runtime]: [any]) => runtime;\n",
        "/src/contracts/consumer.ts":
          'import { pickArray, pickNested, pickObject } from "./helper";\nvoid pickObject({ runtime: process }).env.SEED;\nvoid pickNested({ box: { runtime: process } }).env.SEED;\nvoid pickArray([process]).env.SEED;\n',
      }),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(3);
  });

  it("flags process runtime clocks and crypto prime generation", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/direct.ts":
          "void process.uptime();\nvoid crypto.generatePrime(8, () => undefined);\nvoid crypto.generatePrimeSync(8);\n",
        "/src/contracts/imported.ts":
          'import { generatePrime as prime } from "node:crypto";\nimport { uptime } from "node:process";\nvoid prime(8, () => undefined);\nvoid uptime();\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["process.uptime", "generatePrime", "generatePrimeSync"]),
    );
  });

  it("flags method, accessor, and default-parameter host origins", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "class Helper { runtime() { return process; } get ambient() { return process; } }\nconst helper = new Helper();\nvoid helper.runtime().env.SEED;\nvoid helper.ambient.env.SEED;\nfunction read(runtime = process) { return runtime; }\nvoid read().env.SEED;\n",
        ),
      ),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(3);
  });

  it("flags parameter defaults for explicit undefined and nested binding defaults", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "function direct(runtime = process) { return runtime; }\nvoid direct(undefined).env.SEED;\nfunction nested({ runtime = process } = {}) { return runtime; }\nvoid nested({}).env.SEED;\nfunction tuple([runtime = process] = []) { return runtime; }\nvoid tuple([]).env.SEED;\n",
        ),
      ),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(3);
  });

  it("flags a nondeterministic method invoked through a callable alias", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          "class Helper { runtime() { return process; } }\nconst helper = new Helper();\nconst read = helper.runtime;\nvoid read().env.SEED;\n",
        ),
      ),
    );
    expect(uses.filter((use) => use.api === "process.env")).toHaveLength(1);
  });

  it("flags builtins loaded through import-equals and CommonJS require", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'import os = require("node:os");\nvoid os.hostname();\nconst runtime = require("node:process");\nvoid runtime.env.SEED;\nconst { release } = require("node:os");\nvoid release();\n',
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["os.hostname", "process.env", "os.release"]),
    );
    expect(
      bannedNondeterminismUses(
        inMemoryProject(
          file(
            'const helper = { require: (_name: string) => ({ hostname: () => "fixed" }) };\nvoid helper.require("node:os").hostname();\n',
          ),
        ),
      ),
    ).toEqual([]);
  });

  it("flags constant and runtime-computed access on sensitive origins", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'const envKey = "env";\nvoid process[envKey].SEED;\nconst randomKey = "random";\nvoid Math[randomKey]();\ndeclare const runtimeKey: string;\nvoid process[runtimeKey];\n',
        ),
      ),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["process.env", "Math.random", "process.[computed]"]),
    );
  });

  it("flags mutable computed member keys on sensitive origins", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject(
        file(
          'let key = "fixed";\nkey = "random";\nvoid Math[key]();\n',
        ),
      ),
    );
    expect(uses.map((use) => use.api)).toEqual(["Math.[computed]"]);
  });

  it("flags process properties and operating-system APIs", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/direct.ts":
          "void process.platform;\nvoid process.argv;\n",
        "/src/contracts/imported.ts":
          'import { hostname } from "node:os";\nimport * as os from "node:os";\nvoid hostname();\nvoid os.release();\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set(["process.platform", "process.argv", "os.hostname", "os.release"]),
    );
  });

  it("flags filesystem, subprocess, and network host inputs", () => {
    const uses = bannedNondeterminismUses(
      inMemoryProject({
        "/src/contracts/io.ts":
          'import { readFileSync } from "node:fs";\nimport { execFileSync } from "node:child_process";\nvoid readFileSync("/etc/hostname", "utf8");\nvoid Reflect.apply(readFileSync, null, ["/etc/hostname", "utf8"]);\nvoid execFileSync("hostname");\nvoid fetch("https://example.com/input");\nvoid new WebSocket("wss://example.com/input");\n',
      }),
    );
    expect(new Set(uses.map((use) => use.api))).toEqual(
      new Set([
        "fs.readFileSync",
        "child_process.execFileSync",
        "fetch",
        "WebSocket",
      ]),
    );
    expect(
      new Set(
        bannedNondeterminismUses(
          inMemoryProject({
            "/scripts/corpus/world.ts":
              'import { readFileSync } from "node:fs";\nexport function unboundInput() { return readFileSync("/etc/hostname", "utf8"); }\n',
          }),
        ).map((use) => use.api),
      ),
    ).toEqual(new Set(["fs.readFileSync"]));
  });

  it("scans every supported executable source extension", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-determinism-"));
    try {
      const extensions = [
        "ts",
        "tsx",
        "mts",
        "cts",
        "js",
        "jsx",
        "mjs",
        "cjs",
      ];
      for (const extension of extensions) {
        writeFileSync(
          join(root, `proof.${extension}`),
          "Math.random();\n",
          "utf8",
        );
      }
      const project = generatorProject(root);
      expect(project.getSourceFiles()).toHaveLength(extensions.length);
      expect(
        bannedNondeterminismUses(project, root)
          .filter((use) => use.api === "Math.random"),
      ).toHaveLength(extensions.length);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans executable dependencies outside the corpus source root", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-closure-"));
    const corpusRoot = join(root, "corpus");
    try {
      mkdirSync(corpusRoot);
      writeFileSync(
        join(corpusRoot, "entry.ts"),
        'import { runtime } from "../shared";\nvoid runtime.env.SEED;\n',
        "utf8",
      );
      writeFileSync(
        join(root, "shared.ts"),
        "export const runtime = process;\n",
        "utf8",
      );
      const project = generatorProject(corpusRoot);
      expect(project.getSourceFiles()).toHaveLength(2);
      expect(
        bannedNondeterminismUses(project, root)
          .filter((use) => use.api === "process.env"),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a hand edit to a generated file is caught by the byte comparison", () => {
    const generated = generateSyntheticCases(realSpec, CORPUS_SEED);
    const tampered = generated.map((f, index) => ({
      relPath: f.relPath,
      // A version relabel - the smallest edit that changes what a case claims.
      bytes: index === 0 ? f.bytes.replace('"corpusVersion":"2026.07.0"', '"corpusVersion":"9999.99.9"') : f.bytes,
    }));
    expect(tampered[0]!.bytes).not.toBe(generated[0]!.bytes);
    const problems = committedBytesProblems(generated, tampered);
    expect(problems.some((p) => p.includes("committed bytes differ from regeneration"))).toBe(true);
  });

  it("beneficiary ordering is total across every emitted field", () => {
    const before = structuredClone(realSpec);
    before.world.beneficiaries.push({
      accountRef: "smiths-joint-taxable",
      partyRef: "mira-smith",
      sharePercentBps: 2500,
      tier: "contingent",
    });
    const after = structuredClone(before);
    const matching = after.world.beneficiaries
      .map((beneficiary, index) => ({ beneficiary, index }))
      .filter(({ beneficiary }) =>
        beneficiary.accountRef === "smiths-joint-taxable" &&
        beneficiary.partyRef === "mira-smith"
      );
    const left = matching[0]!.index;
    const right = matching[1]!.index;
    [after.world.beneficiaries[left], after.world.beneficiaries[right]] = [
      after.world.beneficiaries[right]!,
      after.world.beneficiaries[left]!,
    ];
    expect(
      changedPaths(
        bytesByPath(before, CORPUS_SEED),
        bytesByPath(after, CORPUS_SEED),
      ),
    ).toEqual([]);
  });

  it("a missing and an orphaned generated file are both caught", () => {
    const generated = generateSyntheticCases(realSpec, CORPUS_SEED);
    const committed = generated.slice(1).map((f) => ({ relPath: f.relPath, bytes: f.bytes }));
    const problems = committedBytesProblems(generated, [
      ...committed,
      { relPath: "synthetic/CS-ghost.json", bytes: "{}\n" },
    ]);
    expect(problems.some((p) => p.includes("generated but not committed"))).toBe(true);
    expect(problems.some((p) => p.includes("committed but no longer generated"))).toBe(true);
  });

  it("a seed-IGNORING generator is caught: identical output under two seeds is a violation", () => {
    // Exactly what a constant-output generator produces: the same bytes for two
    // distinct seeds. The real check above runs the same detector.
    const constant = bytesByPath(realSpec, CORPUS_SEED);
    const problems = seedSensitivityProblems(constant, new Map(constant));
    expect(problems.some((p) => p.includes("the seed is not being used"))).toBe(true);
  });

  it("an ORDER-SENSITIVE generator is caught: a mid-spec insertion touching other cases fails", () => {
    // Simulates a stream PRNG: every case's bytes shift when one household is
    // inserted. The real check above asserts exactly one path changes.
    const before = bytesByPath(realSpec, CORPUS_SEED);
    const reshuffled = new Map([...before].map(([path, bytes]) => [path, `${bytes} `]));
    expect(changedPaths(before, reshuffled).length).toBeGreaterThan(1);
  });
});
