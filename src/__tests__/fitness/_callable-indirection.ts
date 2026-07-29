import {
  Node,
  SyntaxKind,
  type CallExpression,
} from "ts-morph";

function unwrapExpression(node: Node): Node {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current) ||
    Node.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

function staticPropertyName(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node)) return node.getLiteralText();
  if (!Node.isComputedPropertyName(node)) return undefined;
  const expression = unwrapExpression(node.getExpression());
  return Node.isStringLiteral(expression)
    ? expression.getLiteralText()
    : undefined;
}

function staticMemberAccess(
  node: Node,
): { receiver: Node; name?: string } | undefined {
  const normalized = unwrapExpression(node);
  if (Node.isPropertyAccessExpression(normalized)) {
    return {
      receiver: normalized.getExpression(),
      name: normalized.getName(),
    };
  }
  if (!Node.isElementAccessExpression(normalized)) return undefined;
  const argument = normalized.getArgumentExpression();
  const value =
    argument === undefined ? undefined : unwrapExpression(argument);
  return {
    receiver: normalized.getExpression(),
    name: Node.isStringLiteral(value) ? value.getLiteralText() : undefined,
  };
}

function precedingAssignmentValues(identifier: Node): Node[] {
  if (!Node.isIdentifier(identifier)) return [];
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return [];
  return identifier
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter(
      (candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < identifier.getStart() &&
        Node.isIdentifier(candidate.getLeft()) &&
        candidate.getLeft().getSymbol() === symbol,
    )
    .map((candidate) => candidate.getRight());
}

function identifierValueSources(identifier: Node): Node[] {
  if (!Node.isIdentifier(identifier)) return [];
  return [
    ...(identifier
      .getSymbol()
      ?.getDeclarations()
      .flatMap((declaration) => {
        if (!Node.isVariableDeclaration(declaration)) return [];
        const initializer = declaration.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }) ?? []),
    ...precedingAssignmentValues(identifier),
  ];
}

function isGlobalReflect(node: Node): boolean {
  const normalized = unwrapExpression(node);
  if (!Node.isIdentifier(normalized) || normalized.getText() !== "Reflect") {
    return false;
  }
  return !(
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some(
        (declaration) =>
          declaration.getSourceFile() === normalized.getSourceFile(),
      ) ?? false
  );
}

function isReflectApplyValue(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const access = staticMemberAccess(normalized);
  if (
    access?.name === "apply" &&
    isGlobalReflect(access.receiver)
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  if (
    precedingAssignmentValues(normalized).some((source) =>
      isReflectApplyValue(source, new Set(seen)),
    )
  ) {
    return true;
  }
  return (
    normalized
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => {
        if (Node.isVariableDeclaration(declaration)) {
          const initializer = declaration.getInitializer();
          return (
            initializer !== undefined &&
            isReflectApplyValue(initializer, new Set(seen))
          );
        }
        if (!Node.isBindingElement(declaration)) return false;
        const property =
          declaration.getPropertyNameNode() ?? declaration.getNameNode();
        if (staticPropertyName(property) !== "apply") return false;
        const variable = declaration.getFirstAncestorByKind(
          SyntaxKind.VariableDeclaration,
        );
        const initializer = variable?.getInitializer();
        return (
          initializer !== undefined &&
          isGlobalReflect(initializer)
        );
      }) ?? false
  );
}

function staticArrayElements(
  node: Node | undefined,
  seen = new Set<Node>(),
): Node[] | undefined {
  if (node === undefined) return undefined;
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (Node.isArrayLiteralExpression(normalized)) {
    const elements = normalized.getElements();
    return elements.every(Node.isExpression) ? elements : undefined;
  }
  if (!Node.isIdentifier(normalized)) return undefined;
  const sources = identifierValueSources(normalized);
  const values = sources
    .map((source) => staticArrayElements(source, new Set(seen)))
    .filter((value): value is Node[] => value !== undefined);
  if (values.length !== 1 || values.length !== sources.length) {
    return undefined;
  }
  return values[0];
}

function compositionalReflectApplyTarget(
  callable: Node,
  args: readonly Node[],
  seen = new Set<Node>(),
): Node | undefined {
  const normalized = unwrapExpression(callable);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (Node.isCallExpression(normalized)) {
    const bound = staticMemberAccess(normalized.getExpression());
    if (bound?.name === "bind") {
      return compositionalReflectApplyTarget(
        bound.receiver,
        [...normalized.getArguments().slice(1), ...args],
        new Set(seen),
      );
    }
  }
  if (Node.isIdentifier(normalized)) {
    for (const source of identifierValueSources(normalized)) {
      const target = compositionalReflectApplyTarget(
        source,
        args,
        new Set(seen),
      );
      if (target !== undefined) return target;
    }
  }
  const access = staticMemberAccess(normalized);
  if (access?.name === "call") {
    return compositionalReflectApplyTarget(
      access.receiver,
      args.slice(1),
      new Set(seen),
    );
  }
  if (
    access?.name === "apply" &&
    !isGlobalReflect(access.receiver)
  ) {
    const applied = staticArrayElements(args[1]);
    return applied === undefined
      ? undefined
      : compositionalReflectApplyTarget(
          access.receiver,
          applied,
          new Set(seen),
        );
  }
  if (!isReflectApplyValue(normalized)) return undefined;
  const target = args[0];
  if (target === undefined) return undefined;
  const reflectedArguments = staticArrayElements(args[2]);
  if (reflectedArguments === undefined) return target;
  return (
    compositionalReflectApplyTarget(
      target,
      reflectedArguments,
      new Set(seen),
    ) ?? target
  );
}

export function reflectApplyTarget(
  call: CallExpression,
): Node | undefined {
  return compositionalReflectApplyTarget(
    call.getExpression(),
    call.getArguments(),
  );
}
