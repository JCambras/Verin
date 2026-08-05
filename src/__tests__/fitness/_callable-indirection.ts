import {
  Node,
  SyntaxKind,
  type BinaryExpression,
  type CallExpression,
  type SourceFile,
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

const assignmentCache = new WeakMap<SourceFile, BinaryExpression[]>();

function simpleAssignments(sourceFile: SourceFile): BinaryExpression[] {
  const cached = assignmentCache.get(sourceFile);
  if (cached !== undefined) return cached;
  const assignments = sourceFile
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .filter(
      (candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        Node.isIdentifier(candidate.getLeft()),
    );
  assignmentCache.set(sourceFile, assignments);
  return assignments;
}

function precedingAssignmentValues(identifier: Node): Node[] {
  if (!Node.isIdentifier(identifier)) return [];
  const symbol = identifier.getSymbol();
  if (symbol === undefined) return [];
  return simpleAssignments(identifier.getSourceFile())
    .filter(
      (candidate) =>
        candidate.getStart() < identifier.getStart() &&
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

function staticStringValue(
  node: Node | undefined,
  seen = new Set<Node>(),
): string | undefined {
  if (node === undefined) return undefined;
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (
    Node.isStringLiteral(normalized) ||
    Node.isNoSubstitutionTemplateLiteral(normalized)
  ) {
    return normalized.getLiteralText();
  }
  if (!Node.isIdentifier(normalized)) return undefined;
  const sources = identifierValueSources(normalized);
  const values = sources.map((source) =>
    staticStringValue(source, new Set(seen)),
  );
  if (
    values.length === 0 ||
    values.some((value) => value === undefined) ||
    new Set(values).size !== 1
  ) {
    return undefined;
  }
  return values[0];
}

function isReflectGetValue(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const access = staticMemberAccess(normalized);
  if (access?.name === "get" && isGlobalReflect(access.receiver)) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  if (
    precedingAssignmentValues(normalized).some((source) =>
      isReflectGetValue(source, new Set(seen)),
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
            isReflectGetValue(initializer, new Set(seen))
          );
        }
        if (!Node.isBindingElement(declaration)) return false;
        const property =
          declaration.getPropertyNameNode() ?? declaration.getNameNode();
        if (staticPropertyName(property) !== "get") return false;
        const variable = declaration.getFirstAncestorByKind(
          SyntaxKind.VariableDeclaration,
        );
        const initializer = variable?.getInitializer();
        return initializer !== undefined && isGlobalReflect(initializer);
      }) ?? false
  );
}

export interface ReflectedPropertyAccess {
  readonly receiver: Node;
  readonly name?: string;
}

function compositionalReflectGetAccess(
  callable: Node,
  args: readonly Node[],
  seen = new Set<Node>(),
): ReflectedPropertyAccess | undefined {
  const normalized = unwrapExpression(callable);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  if (Node.isCallExpression(normalized)) {
    const bound = staticMemberAccess(normalized.getExpression());
    if (bound?.name === "bind") {
      return compositionalReflectGetAccess(
        bound.receiver,
        [...normalized.getArguments().slice(1), ...args],
        new Set(seen),
      );
    }
  }
  if (Node.isIdentifier(normalized)) {
    const accesses = identifierValueSources(normalized)
      .map((source) =>
        compositionalReflectGetAccess(source, args, new Set(seen)),
      )
      .filter(
        (access): access is ReflectedPropertyAccess => access !== undefined,
      );
    if (accesses.length > 0) return accesses[0];
  }
  const access = staticMemberAccess(normalized);
  if (access?.name === "call") {
    return compositionalReflectGetAccess(
      access.receiver,
      args.slice(1),
      new Set(seen),
    );
  }
  if (access?.name === "apply" && !isGlobalReflect(access.receiver)) {
    const applied = staticArrayElements(args[1]);
    return applied === undefined
      ? undefined
      : compositionalReflectGetAccess(
          access.receiver,
          applied,
          new Set(seen),
        );
  }
  if (isReflectApplyValue(normalized)) {
    const target = args[0];
    const reflectedArguments = staticArrayElements(args[2]);
    return target === undefined || reflectedArguments === undefined
      ? undefined
      : compositionalReflectGetAccess(
          target,
          reflectedArguments,
          new Set(seen),
        );
  }
  if (!isReflectGetValue(normalized)) return undefined;
  const receiver = args[0];
  return receiver === undefined
    ? undefined
    : {
        receiver,
        name: staticStringValue(args[1]),
      };
}

export function reflectGetAccess(
  node: Node,
): ReflectedPropertyAccess | undefined {
  const normalized = unwrapExpression(node);
  return Node.isCallExpression(normalized)
    ? compositionalReflectGetAccess(
        normalized.getExpression(),
        normalized.getArguments(),
      )
    : undefined;
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
