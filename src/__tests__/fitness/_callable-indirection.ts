import {
  Node,
  SyntaxKind,
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

export function callableExpressionAlternatives(node: Node): Node[] {
  const normalized = unwrapExpression(node);
  if (Node.isConditionalExpression(normalized)) {
    return [normalized.getWhenTrue(), normalized.getWhenFalse()];
  }
  if (Node.isCommaListExpression(normalized)) {
    const elements = normalized.getElements();
    const last = elements.at(-1);
    return last === undefined ? [] : [last];
  }
  if (Node.isBinaryExpression(normalized)) {
    const operator = normalized.getOperatorToken().getKind();
    if (operator === SyntaxKind.CommaToken) {
      return [normalized.getRight()];
    }
    if (
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return [normalized.getLeft(), normalized.getRight()];
    }
  }
  return [normalized];
}

function expandsCallableExpression(
  normalized: Node,
  alternatives: readonly Node[],
): boolean {
  return alternatives.length !== 1 || alternatives[0] !== normalized;
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

interface AssignmentValue {
  readonly start: number;
  readonly value: Node;
}

const assignmentCache = new WeakMap<
  SourceFile,
  ReadonlyMap<object, readonly AssignmentValue[]>
>();
const precedingAssignmentCache = new WeakMap<Node, readonly Node[]>();
const identifierSourceCache = new WeakMap<Node, readonly Node[]>();
const sourceUsesReflectCache = new WeakMap<SourceFile, boolean>();

function sourceUsesReflect(sourceFile: SourceFile): boolean {
  const cached = sourceUsesReflectCache.get(sourceFile);
  if (cached !== undefined) return cached;
  const usesReflect =
    sourceFile.getFullText().includes("Reflect") &&
    sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((identifier) => identifier.getText() === "Reflect");
  sourceUsesReflectCache.set(sourceFile, usesReflect);
  return usesReflect;
}

function simpleAssignments(
  sourceFile: SourceFile,
): ReadonlyMap<object, readonly AssignmentValue[]> {
  const cached = assignmentCache.get(sourceFile);
  if (cached !== undefined) return cached;
  const assignments = new Map<object, AssignmentValue[]>();
  for (const candidate of sourceFile.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  )) {
    if (
      candidate.getOperatorToken().getKind() !== SyntaxKind.EqualsToken ||
      !Node.isIdentifier(candidate.getLeft())
    ) {
      continue;
    }
    const symbol = candidate.getLeft().getSymbol()?.compilerSymbol;
    if (symbol === undefined) continue;
    const values = assignments.get(symbol) ?? [];
    values.push({
      start: candidate.getStart(),
      value: candidate.getRight(),
    });
    assignments.set(symbol, values);
  }
  assignmentCache.set(sourceFile, assignments);
  return assignments;
}

export function precedingCallableAssignmentValues(
  identifier: Node,
): Node[] {
  if (!Node.isIdentifier(identifier)) return [];
  const cached = precedingAssignmentCache.get(identifier);
  if (cached !== undefined) return [...cached];
  const symbol = identifier.getSymbol()?.compilerSymbol;
  if (symbol === undefined) return [];
  const values = (
    simpleAssignments(identifier.getSourceFile()).get(symbol) ?? []
  )
    .filter((candidate) => candidate.start < identifier.getStart())
    .map((candidate) => candidate.value);
  precedingAssignmentCache.set(identifier, values);
  return [...values];
}

function identifierValueSources(identifier: Node): Node[] {
  if (!Node.isIdentifier(identifier)) return [];
  const cached = identifierSourceCache.get(identifier);
  if (cached !== undefined) return [...cached];
  const sources = [
    ...(identifier
      .getSymbol()
      ?.getDeclarations()
      .flatMap((declaration) => {
        if (!Node.isVariableDeclaration(declaration)) return [];
        const initializer = declaration.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }) ?? []),
    ...precedingCallableAssignmentValues(identifier),
  ];
  identifierSourceCache.set(identifier, sources);
  return [...sources];
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

const reflectApplyValueCache = new WeakMap<Node, boolean>();

function isReflectApplyValue(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  const cached = reflectApplyValueCache.get(normalized);
  if (cached !== undefined) return cached;
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const access = staticMemberAccess(normalized);
  if (
    access?.name === "apply" &&
    isGlobalReflect(access.receiver)
  ) {
    reflectApplyValueCache.set(normalized, true);
    return true;
  }
  if (!Node.isIdentifier(normalized)) {
    reflectApplyValueCache.set(normalized, false);
    return false;
  }
  if (
    precedingCallableAssignmentValues(normalized).some((source) =>
      isReflectApplyValue(source, new Set(seen)),
    )
  ) {
    reflectApplyValueCache.set(normalized, true);
    return true;
  }
  const result =
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
      }) ?? false;
  reflectApplyValueCache.set(normalized, result);
  return result;
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
  if (
    values.length === 0 ||
    values.length !== sources.length ||
    new Set(
      values.map((elements) =>
        elements.map((element) => element.getText()).join("\u0000"),
      ),
    ).size !== 1
  ) {
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

const reflectGetValueCache = new WeakMap<Node, boolean>();

function isReflectGetValue(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  const cached = reflectGetValueCache.get(normalized);
  if (cached !== undefined) return cached;
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const access = staticMemberAccess(normalized);
  if (access?.name === "get" && isGlobalReflect(access.receiver)) {
    reflectGetValueCache.set(normalized, true);
    return true;
  }
  if (!Node.isIdentifier(normalized)) {
    reflectGetValueCache.set(normalized, false);
    return false;
  }
  if (
    precedingCallableAssignmentValues(normalized).some((source) =>
      isReflectGetValue(source, new Set(seen)),
    )
  ) {
    reflectGetValueCache.set(normalized, true);
    return true;
  }
  const result =
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
      }) ?? false;
  reflectGetValueCache.set(normalized, result);
  return result;
}

export interface ReflectedPropertyAccess {
  readonly receiver: Node;
  readonly name?: string;
}

export interface CallableResolution<T> {
  readonly values: readonly T[];
  readonly complete: boolean;
}

function combineResolutions<T>(
  resolutions: readonly (CallableResolution<T> | undefined)[],
): CallableResolution<T> | undefined {
  const resolved = resolutions.filter(
    (resolution): resolution is CallableResolution<T> =>
      resolution !== undefined,
  );
  if (resolved.length === 0) return undefined;
  return {
    values: resolved.flatMap((resolution) => resolution.values),
    complete:
      resolved.length === resolutions.length &&
      resolved.every((resolution) => resolution.complete),
  };
}

function compositionalReflectGetResolution(
  callable: Node,
  args: readonly Node[],
  seen = new Set<Node>(),
): CallableResolution<ReflectedPropertyAccess> | undefined {
  const normalized = unwrapExpression(callable);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    return combineResolutions(
      alternatives.map((alternative) =>
        compositionalReflectGetResolution(
          alternative,
          args,
          new Set(seen),
        ),
      ),
    );
  }
  if (Node.isCallExpression(normalized)) {
    const bound = staticMemberAccess(normalized.getExpression());
    if (bound?.name === "bind") {
      return compositionalReflectGetResolution(
        bound.receiver,
        [...normalized.getArguments().slice(1), ...args],
        new Set(seen),
      );
    }
  }
  if (Node.isIdentifier(normalized)) {
    const sources = identifierValueSources(normalized);
    if (sources.length > 0) {
      const resolution = combineResolutions(
        sources.map((source) =>
          compositionalReflectGetResolution(
            source,
            args,
            new Set(seen),
          ),
        ),
      );
      if (resolution !== undefined) return resolution;
    }
  }
  const access = staticMemberAccess(normalized);
  if (access?.name === "call") {
    return compositionalReflectGetResolution(
      access.receiver,
      args.slice(1),
      new Set(seen),
    );
  }
  if (access?.name === "apply" && !isGlobalReflect(access.receiver)) {
    const applied = staticArrayElements(args[1]);
    if (applied !== undefined) {
      return compositionalReflectGetResolution(
        access.receiver,
        applied,
        new Set(seen),
      );
    }
    return compositionalReflectGetResolution(
      access.receiver,
      [],
      new Set(seen),
    ) === undefined
      ? undefined
      : { values: [], complete: false };
  }
  if (isReflectApplyValue(normalized)) {
    const target = args[0];
    const reflectedArguments = staticArrayElements(args[2]);
    if (target === undefined || reflectedArguments === undefined) {
      return { values: [], complete: false };
    }
    const nested = compositionalReflectGetResolution(
      target,
      reflectedArguments,
      new Set(seen),
    );
    return nested ?? { values: [], complete: false };
  }
  if (!isReflectGetValue(normalized)) return undefined;
  const receiver = args[0];
  return receiver === undefined
    ? { values: [], complete: false }
    : {
        values: [
          {
            receiver,
            name: staticStringValue(args[1]),
          },
        ],
        complete: true,
      };
}

export function reflectGetResolution(
  node: Node,
): CallableResolution<ReflectedPropertyAccess> | undefined {
  if (!sourceUsesReflect(node.getSourceFile())) return undefined;
  const normalized = unwrapExpression(node);
  return Node.isCallExpression(normalized)
    ? compositionalReflectGetResolution(
        normalized.getExpression(),
        normalized.getArguments(),
      )
    : undefined;
}

function compositionalReflectApplyResolution(
  callable: Node,
  args: readonly Node[],
  seen = new Set<Node>(),
): CallableResolution<Node> | undefined {
  const normalized = unwrapExpression(callable);
  if (seen.has(normalized)) return undefined;
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    return combineResolutions(
      alternatives.map((alternative) =>
        compositionalReflectApplyResolution(
          alternative,
          args,
          new Set(seen),
        ),
      ),
    );
  }
  if (Node.isCallExpression(normalized)) {
    const bound = staticMemberAccess(normalized.getExpression());
    if (bound?.name === "bind") {
      return compositionalReflectApplyResolution(
        bound.receiver,
        [...normalized.getArguments().slice(1), ...args],
        new Set(seen),
      );
    }
  }
  if (Node.isIdentifier(normalized)) {
    const sources = identifierValueSources(normalized);
    if (sources.length > 0) {
      const resolution = combineResolutions(
        sources.map((source) =>
          compositionalReflectApplyResolution(
            source,
            args,
            new Set(seen),
          ),
        ),
      );
      if (resolution !== undefined) return resolution;
    }
  }
  const access = staticMemberAccess(normalized);
  if (access?.name === "call") {
    return compositionalReflectApplyResolution(
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
    if (applied !== undefined) {
      return compositionalReflectApplyResolution(
        access.receiver,
        applied,
        new Set(seen),
      );
    }
    return compositionalReflectApplyResolution(
      access.receiver,
      [],
      new Set(seen),
    ) === undefined
      ? undefined
      : { values: [], complete: false };
  }
  if (!isReflectApplyValue(normalized)) return undefined;
  const target = args[0];
  if (target === undefined) return { values: [], complete: false };
  const reflectedArguments = staticArrayElements(args[2]);
  if (reflectedArguments !== undefined) {
    return (
      compositionalReflectApplyResolution(
        target,
        reflectedArguments,
        new Set(seen),
      ) ?? { values: [target], complete: true }
    );
  }
  const nested = compositionalReflectApplyResolution(
    target,
    [],
    new Set(seen),
  );
  return nested === undefined
    ? { values: [target], complete: true }
    : { values: nested.values, complete: false };
}

export function reflectApplyResolution(
  call: CallExpression,
): CallableResolution<Node> | undefined {
  if (!sourceUsesReflect(call.getSourceFile())) return undefined;
  return compositionalReflectApplyResolution(
    call.getExpression(),
    call.getArguments(),
  );
}
