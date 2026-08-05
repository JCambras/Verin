import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
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
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import { loadSpec, type LoadedSpec } from "../../../scripts/corpus/world";
import { committedBytesProblems, readCommittedCorpus } from "../../../scripts/corpus/validate";

/**
 * CORPUS-DETERMINISM FENCE (v3 prompt 11, ADR-0034; charter #1/#4).
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
  const record = (node: Node, api: string, sf: SourceFile): void => {
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
      if (bannedCalls.has(origin)) return apiName(origin);
      if (origin.startsWith("process.env")) return "process.env";
      if (origin.startsWith("process.hrtime")) return "process.hrtime";
      if (origin.startsWith("process.")) {
        return origin.split(".").slice(0, 2).join(".");
      }
      if (origin.startsWith("os.")) {
        return origin.split(".").slice(0, 2).join(".");
      }
      return undefined;
    };
    const moduleOrigin = (moduleName: string): string | undefined =>
      moduleName.replace(/^node:/, "") === "crypto" ? "crypto" :
        moduleName.replace(/^node:/, "") === "process" ? "process" :
          moduleName.replace(/^node:/, "") === "perf_hooks" ? "performance" :
            moduleName.replace(/^node:/, "") === "os" ? "os" :
              undefined;
    const ambientRoots = new Set([
      "Math",
      "Date",
      "performance",
      "process",
      "crypto",
      "Intl",
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
        const origin =
          normalizedModuleName === "crypto" &&
            (cryptoRandomMembers.has(imported) || imported === "webcrypto")
            ? `crypto.${imported}` :
            normalizedModuleName === "process" ?
              `process.${imported}` :
              normalizedModuleName === "os" ?
                `os.${imported}` :
              normalizedModuleName === "perf_hooks" && imported === "performance" ? "performance" :
                undefined;
        if (origin === undefined) continue;
        origins.set(local, new Set([origin]));
        const api = sensitiveOriginApi(origin);
        if (api !== undefined) record(specifier, api, sf);
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
        if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) {
          continue;
        }
        const value = originOf(assignment.getRight());
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
      if (originOf(call.getExpression())?.has("Date") === true && call.getArguments().length === 0) {
        record(call, "new Date() (argless)", sf);
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
      if (identifier.getText() !== "Intl") continue;
      const parent = identifier.getParent();
      if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) continue;
      record(identifier, "Intl", sf);
    }
  }
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
      const inProcess = corpusDigest(
        realSpec.world.corpusVersion,
        CORPUS_SEED,
        taxonomySemanticDigest(realTaxonomy),
        buildInventory(generateSyntheticCases(realSpec, CORPUS_SEED)),
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
