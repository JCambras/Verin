import { Node, SyntaxKind } from "ts-morph";
import type { OriginSet } from "./_corpus-nondeterminism-vocabulary";

/**
 * STATELESS AST READS shared by the origin walk: unwrapping, identity keys,
 * symbol resolution, and the two literal readers (`staticMemberNames`,
 * `commonJsModule`) that decide whether a dynamic-looking access is really
 * static. Nothing here holds scan state, so every one of them is safe to call
 * from any point in the walk.
 */

/** A callable reduced to what the walk needs: where arguments land, and what
 * flows back out. */
export interface CallableShape {
  parameters: Node[];
  returns: Node[];
}

/**
 * THE SCANNER STATE OBJECT. The origin walk is mutually recursive
 * (`originOf` ⇄ `memberValueOrigins` ⇄ `callBindings` ⇄ `callableShapes`) and
 * carries per-file state (`origins`, `localFunctions`). Passing that state
 * explicitly - instead of closing over it in one function body - is what lets
 * each step of the walk live in a module a reader can hold in their head, with
 * the recursion routed back through this one object.
 */
export interface OriginResolver {
  readonly origins: Map<string, OriginSet>;
  readonly localFunctions: Map<string, CallableShape>;
  originOf(
    input: Node | undefined,
    trail?: ReadonlySet<string>,
    bindings?: ReadonlyMap<string, OriginSet>,
  ): OriginSet | undefined;
  memberValueOrigins(
    input: Node | undefined,
    path: readonly string[],
    trail: ReadonlySet<string>,
    bindings: ReadonlyMap<string, OriginSet>,
  ): OriginSet | undefined;
  callableShapes(target: Node, trail?: ReadonlySet<string>): CallableShape[];
  callBindings(
    callable: CallableShape,
    call: Node,
    trail: ReadonlySet<string>,
    bindings: ReadonlyMap<string, OriginSet>,
  ): ReadonlyMap<string, OriginSet>;
  declarationOrigins(
    declaration: Node,
    trail: ReadonlySet<string>,
    bindings: ReadonlyMap<string, OriginSet>,
  ): OriginSet | undefined;
  setOrigins(name: string, value: OriginSet): boolean;
}

export const unwrap = (input: Node): Node => {
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

export const nodeKey = (node: Node): string =>
  `${node.getSourceFile().getFilePath()}:${node.getKind()}:${node.getStart()}:${node.getEnd()}`;

export const symbolDeclarations = (node: Node): Node[] => {
  const symbol = node.getSymbol();
  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
};

export const returnedExpressions = (declaration: {
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

export const staticMemberNames = (
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

export const commonJsModule = (node: Node): string | undefined => {
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
