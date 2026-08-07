import { Node, SyntaxKind } from "ts-morph";
import {
  nodeKey,
  returnedExpressions,
  symbolDeclarations,
  unwrap,
  type CallableShape,
  type OriginResolver,
} from "./_corpus-nondeterminism-ast";
import {
  mergeOrigins,
  type OriginSet,
} from "./_corpus-nondeterminism-vocabulary";

/**
 * CALLS, both ways: what a name RESOLVES to when it is called
 * (`callableShapes`), and what its parameters BECOME once the arguments are
 * substituted (`callBindings`). A generator that hides `Date.now` behind a
 * helper, a destructured options bag, or a default parameter is caught here -
 * the walk follows the value across the call boundary instead of stopping at
 * the callee's name.
 */
export function callableShapes(
  resolver: OriginResolver,
  target: Node,
  trail: ReadonlySet<string> = new Set(),
): CallableShape[] {
  const key = nodeKey(target);
  if (trail.has(key)) return [];
  const next = new Set(trail);
  next.add(key);
  const direct = Node.isIdentifier(target)
    ? resolver.localFunctions.get(target.getText())
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
    return resolver.callableShapes(unwrap(value), next);
  });
  return direct === undefined ? resolved : [direct, ...resolved];
}

export function callBindings(
  resolver: OriginResolver,
  callable: CallableShape,
  call: Node,
  trail: ReadonlySet<string>,
  bindings: ReadonlyMap<string, OriginSet>,
): ReadonlyMap<string, OriginSet> {
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
          resolver.memberValueOrigins(source.value, source.path, trail, bindings)
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
}
