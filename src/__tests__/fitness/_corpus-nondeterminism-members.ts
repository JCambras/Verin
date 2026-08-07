import { Node, SyntaxKind } from "ts-morph";
import {
  nodeKey,
  returnedExpressions,
  symbolDeclarations,
  unwrap,
  type OriginResolver,
} from "./_corpus-nondeterminism-ast";
import {
  memberOrigins,
  mergeOrigins,
  type OriginSet,
} from "./_corpus-nondeterminism-vocabulary";

/**
 * MEMBER READS AND DECLARATIONS: what `value.a.b` actually holds, and what a
 * declaration binds. This is the half of the walk that follows a banned origin
 * through object literals, spreads, array indices, conditionals, `??`/`||`
 * chains, call returns and destructuring - so parking `Date.now` on a property
 * and reading it back through a bag of options is still reported at the read.
 */
export function memberValueOrigins(
  resolver: OriginResolver,
  input: Node | undefined,
  path: readonly string[],
  trail: ReadonlySet<string>,
  bindings: ReadonlyMap<string, OriginSet>,
): OriginSet | undefined {
  if (input === undefined) return undefined;
  const node = unwrap(input);
  if (path.length === 0) return resolver.originOf(node, trail, bindings);
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
    memberOrigins(resolver.originOf(node, directTrail, bindings), member),
  );
  const candidates: Array<OriginSet | undefined> = [direct];
  if (Node.isObjectLiteralExpression(node)) {
    for (const property of [...node.getProperties()].reverse()) {
      if (
        Node.isPropertyAssignment(property) &&
        property.getName() === member
      ) {
        candidates.push(resolver.memberValueOrigins(
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
        candidates.push(resolver.memberValueOrigins(
          property.getNameNode(),
          rest,
          next,
          bindings,
        ));
      }
      if (Node.isSpreadAssignment(property)) {
        candidates.push(resolver.memberValueOrigins(
          property.getExpression(),
          path,
          next,
          bindings,
        ));
      }
    }
  }
  if (Node.isArrayLiteralExpression(node) && /^\d+$/.test(member)) {
    candidates.push(resolver.memberValueOrigins(
      node.getElements()[Number(member)],
      rest,
      next,
      bindings,
    ));
  }
  if (Node.isConditionalExpression(node)) {
    candidates.push(resolver.memberValueOrigins(
      node.getWhenTrue(),
      path,
      next,
      bindings,
    ), resolver.memberValueOrigins(
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
      resolver.memberValueOrigins(node.getLeft(), path, next, bindings),
      resolver.memberValueOrigins(node.getRight(), path, next, bindings),
    );
  }
  if (Node.isCallExpression(node)) {
    const target = unwrap(node.getExpression());
    for (const callable of resolver.callableShapes(target)) {
      const nested = resolver.callBindings(callable, node, next, bindings);
      for (const returned of callable.returns) {
        candidates.push(resolver.memberValueOrigins(
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
    candidates.push(resolver.memberValueOrigins(
      value,
      path,
      next,
      bindings,
    ));
  }
  return mergeOrigins(...candidates);
}

export function declarationOrigins(
  resolver: OriginResolver,
  declaration: Node,
  trail: ReadonlySet<string>,
  bindings: ReadonlyMap<string, OriginSet>,
): OriginSet | undefined {
  if (
    Node.isVariableDeclaration(declaration) ||
    Node.isPropertyAssignment(declaration) ||
    Node.isPropertyDeclaration(declaration)
  ) {
    return resolver.originOf(declaration.getInitializer(), trail, bindings);
  }
  if (Node.isGetAccessorDeclaration(declaration)) {
    return mergeOrigins(
      ...returnedExpressions(declaration).map((expression) =>
        resolver.originOf(expression, trail, bindings)
      ),
    );
  }
  if (Node.isShorthandPropertyAssignment(declaration)) {
    return resolver.originOf(declaration.getNameNode(), trail, bindings);
  }
  if (Node.isExportAssignment(declaration)) {
    return resolver.originOf(declaration.getExpression(), trail, bindings);
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
      return resolver.memberValueOrigins(
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
        : resolver.memberValueOrigins(
            initializer,
            [String(index)],
            trail,
            bindings,
          );
    }
  }
  return undefined;
}
