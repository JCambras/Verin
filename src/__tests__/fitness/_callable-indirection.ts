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
  return staticStringValue(node.getExpression());
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
  return {
    receiver: normalized.getExpression(),
    name: staticStringValue(normalized.getArgumentExpression()),
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
  const text = sourceFile.getFullText();
  const usesReflect =
    (text.includes("Reflect") ||
      (text.includes("Ref") && text.includes("lect"))) &&
    (sourceFile
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((identifier) => identifier.getText() === "Reflect") ||
      sourceFile
        .getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
        .some(
          (access) =>
            staticStringValue(access.getArgumentExpression()) ===
              "Reflect" && isGlobalObjectRoot(access.getExpression()),
        ));
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

function isUnshadowedGlobalName(node: Node, name: string): boolean {
  const normalized = unwrapExpression(node);
  if (!Node.isIdentifier(normalized) || normalized.getText() !== name) {
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

function isGlobalObjectRoot(node: Node): boolean {
  return (
    isUnshadowedGlobalName(node, "globalThis") ||
    isUnshadowedGlobalName(node, "global")
  );
}

export function isGlobalIntrinsicObject(
  node: Node,
  intrinsicName: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    return alternatives.some((alternative) =>
      isGlobalIntrinsicObject(alternative, intrinsicName, new Set(seen)),
    );
  }
  if (isUnshadowedGlobalName(normalized, intrinsicName)) return true;
  const access = staticMemberAccess(normalized);
  if (
    access?.name === intrinsicName &&
    isGlobalObjectRoot(access.receiver)
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (
    declarations.some((declaration) => {
      if (!Node.isBindingElement(declaration)) return false;
      const property =
        declaration.getPropertyNameNode() ?? declaration.getNameNode();
      if (staticPropertyName(property) !== intrinsicName) return false;
      const variable = declaration.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      const initializer = variable?.getInitializer();
      return initializer !== undefined && isGlobalObjectRoot(initializer);
    })
  ) {
    return true;
  }
  return identifierValueSources(normalized).some((source) =>
    isGlobalIntrinsicObject(source, intrinsicName, new Set(seen)),
  );
}

export function isGlobalIntrinsicCallable(
  node: Node,
  intrinsicName: string,
  memberName: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    return alternatives.some((alternative) =>
      isGlobalIntrinsicCallable(
        alternative,
        intrinsicName,
        memberName,
        new Set(seen),
      ),
    );
  }
  const access = staticMemberAccess(normalized);
  if (
    access?.name === memberName &&
    isGlobalIntrinsicObject(access.receiver, intrinsicName)
  ) {
    return true;
  }
  if (
    access !== undefined &&
    (access.name === "call" || access.name === "apply")
  ) {
    return isGlobalIntrinsicCallable(
      access.receiver,
      intrinsicName,
      memberName,
      new Set(seen),
    );
  }
  if (Node.isCallExpression(normalized)) {
    const bound = staticMemberAccess(normalized.getExpression());
    if (bound?.name === "bind") {
      return isGlobalIntrinsicCallable(
        bound.receiver,
        intrinsicName,
        memberName,
        new Set(seen),
      );
    }
  }
  if (!Node.isIdentifier(normalized)) return false;
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (
    declarations.some((declaration) => {
      if (!Node.isBindingElement(declaration)) return false;
      const property =
        declaration.getPropertyNameNode() ?? declaration.getNameNode();
      if (staticPropertyName(property) !== memberName) return false;
      const variable = declaration.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      const initializer = variable?.getInitializer();
      return (
        initializer !== undefined &&
        isGlobalIntrinsicObject(initializer, intrinsicName)
      );
    })
  ) {
    return true;
  }
  return identifierValueSources(normalized).some((source) =>
    isGlobalIntrinsicCallable(
      source,
      intrinsicName,
      memberName,
      new Set(seen),
    ),
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
    isGlobalIntrinsicObject(access.receiver, "Reflect")
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
          isGlobalIntrinsicObject(initializer, "Reflect")
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
  if (
    Node.isBinaryExpression(normalized) &&
    normalized.getOperatorToken().getKind() === SyntaxKind.PlusToken
  ) {
    const left = staticStringValue(normalized.getLeft(), new Set(seen));
    const right = staticStringValue(normalized.getRight(), new Set(seen));
    return left === undefined || right === undefined
      ? undefined
      : `${left}${right}`;
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
  if (
    access?.name === "get" &&
    isGlobalIntrinsicObject(access.receiver, "Reflect")
  ) {
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
        return (
          initializer !== undefined &&
          isGlobalIntrinsicObject(initializer, "Reflect")
        );
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

interface LocalInvocation {
  readonly target: Node;
  readonly arguments?: readonly Node[];
}

interface LocalCallableIdentityResolution {
  readonly keys: ReadonlySet<object>;
  readonly complete: boolean;
}

function localParameterOwner(node: Node): Node | undefined {
  const parent = node.getParent();
  return Node.isFunctionDeclaration(parent) ||
    Node.isFunctionExpression(parent) ||
    Node.isArrowFunction(parent) ||
    Node.isMethodDeclaration(parent)
    ? parent
    : undefined;
}

function localFunctionIdentityKeys(owner: Node): Set<object> {
  const keys = new Set<object>([owner]);
  if (
    Node.isFunctionDeclaration(owner) ||
    Node.isFunctionExpression(owner) ||
    Node.isMethodDeclaration(owner)
  ) {
    const symbol = owner.getNameNode()?.getSymbol()?.compilerSymbol;
    if (symbol !== undefined) keys.add(symbol);
  }
  const variable = owner.getFirstAncestorByKind(
    SyntaxKind.VariableDeclaration,
  );
  if (variable?.getInitializer() === owner) {
    const name = variable.getNameNode();
    const symbol = Node.isIdentifier(name)
      ? name.getSymbol()?.compilerSymbol
      : undefined;
    if (symbol !== undefined) keys.add(symbol);
  }
  return keys;
}

function localFunctionIdentityNames(owner: Node): Set<string> {
  const names = new Set<string>();
  if (
    Node.isFunctionDeclaration(owner) ||
    Node.isFunctionExpression(owner) ||
    Node.isMethodDeclaration(owner)
  ) {
    const name = owner.getName();
    if (name !== undefined) names.add(name);
  }
  const variable = owner.getFirstAncestorByKind(
    SyntaxKind.VariableDeclaration,
  );
  if (variable?.getInitializer() === owner) {
    const name = variable.getNameNode();
    if (Node.isIdentifier(name)) names.add(name.getText());
  }
  return names;
}

function localCallableIdentityResolution(
  node: Node,
  seen = new Set<Node>(),
): LocalCallableIdentityResolution {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return { keys: new Set(), complete: false };
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    const resolutions = alternatives.map((alternative) =>
      localCallableIdentityResolution(alternative, new Set(seen)),
    );
    return {
      keys: new Set(resolutions.flatMap((resolution) => [...resolution.keys])),
      complete: resolutions.every((resolution) => resolution.complete),
    };
  }
  if (
    Node.isFunctionDeclaration(normalized) ||
    Node.isFunctionExpression(normalized) ||
    Node.isArrowFunction(normalized) ||
    Node.isMethodDeclaration(normalized)
  ) {
    return { keys: localFunctionIdentityKeys(normalized), complete: true };
  }
  if (Node.isCallExpression(normalized)) {
    const bound = staticMemberAccess(normalized.getExpression());
    if (bound?.name === "bind") {
      return localCallableIdentityResolution(
        bound.receiver,
        new Set(seen),
      );
    }
    return { keys: new Set(), complete: false };
  }
  if (
    Node.isPropertyAccessExpression(normalized) ||
    Node.isElementAccessExpression(normalized)
  ) {
    const symbol = normalized.getSymbol()?.compilerSymbol;
    return {
      keys: symbol === undefined ? new Set() : new Set([symbol]),
      complete: symbol !== undefined,
    };
  }
  if (!Node.isIdentifier(normalized)) {
    return { keys: new Set(), complete: false };
  }
  const symbol = normalized.getSymbol()?.compilerSymbol;
  const sources = identifierValueSources(normalized);
  if (sources.length === 0) {
    return {
      keys: symbol === undefined ? new Set() : new Set([symbol]),
      complete: symbol !== undefined,
    };
  }
  const resolutions = sources.map((source) =>
    localCallableIdentityResolution(source, new Set(seen)),
  );
  return {
    keys: new Set([
      ...(symbol === undefined ? [] : [symbol]),
      ...resolutions.flatMap((resolution) => [...resolution.keys]),
    ]),
    complete: resolutions.every((resolution) => resolution.complete),
  };
}

function localInvocation(call: CallExpression): LocalInvocation {
  const callable = unwrapExpression(call.getExpression());
  const args = call.getArguments();
  if (isGlobalIntrinsicCallable(callable, "Reflect", "apply")) {
    return {
      target: args[0] ?? callable,
      arguments: staticArrayElements(args[2]),
    };
  }
  const access = staticMemberAccess(callable);
  if (access?.name === "call") {
    return { target: access.receiver, arguments: args.slice(1) };
  }
  if (
    access?.name === "apply" &&
    !isGlobalIntrinsicObject(access.receiver, "Reflect")
  ) {
    return {
      target: access.receiver,
      arguments: staticArrayElements(args[1]),
    };
  }
  return { target: callable, arguments: args };
}

const localParameterValueCache = new WeakMap<
  Node,
  CallableResolution<Node> | null
>();
const callIdentifierIndexCache = new WeakMap<
  SourceFile,
  ReadonlyMap<string, readonly CallExpression[]>
>();
const localAliasDependencyCache = new WeakMap<
  SourceFile,
  ReadonlyMap<string, ReadonlySet<string>>
>();

function callableReferenceNames(
  node: Node,
  seen = new Set<Node>(),
): Set<string> {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return new Set();
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    return new Set(
      alternatives.flatMap((alternative) => [
        ...callableReferenceNames(alternative, new Set(seen)),
      ]),
    );
  }
  if (Node.isIdentifier(normalized)) return new Set([normalized.getText()]);
  const member = staticMemberAccess(normalized);
  if (member !== undefined) {
    return new Set([
      ...callableReferenceNames(member.receiver, new Set(seen)),
      ...(member.name === undefined ? [] : [member.name]),
    ]);
  }
  if (Node.isCallExpression(normalized)) {
    const bound = staticMemberAccess(normalized.getExpression());
    if (bound?.name === "bind") {
      return callableReferenceNames(bound.receiver, new Set(seen));
    }
  }
  return new Set();
}

function callIdentifierIndex(
  sourceFile: SourceFile,
): ReadonlyMap<string, readonly CallExpression[]> {
  const cached = callIdentifierIndexCache.get(sourceFile);
  if (cached !== undefined) return cached;
  const index = new Map<string, CallExpression[]>();
  for (const identifier of sourceFile.getDescendantsOfKind(
    SyntaxKind.Identifier,
  )) {
    const call = identifier.getFirstAncestorByKind(
      SyntaxKind.CallExpression,
    );
    if (call === undefined) continue;
    const name = identifier.getText();
    const calls = index.get(name) ?? [];
    if (calls.at(-1) !== call) calls.push(call);
    index.set(name, calls);
  }
  callIdentifierIndexCache.set(sourceFile, index);
  return index;
}

function localAliasDependencies(
  sourceFile: SourceFile,
): ReadonlyMap<string, ReadonlySet<string>> {
  const cached = localAliasDependencyCache.get(sourceFile);
  if (cached !== undefined) return cached;
  const dependencies = new Map<string, Set<string>>();
  const add = (name: string, value: Node): void => {
    const names = dependencies.get(name) ?? new Set<string>();
    for (const dependency of callableReferenceNames(value)) {
      names.add(dependency);
    }
    dependencies.set(name, names);
  };
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (Node.isIdentifier(name) && initializer !== undefined) {
      add(name.getText(), initializer);
    }
  }
  for (const assignment of sourceFile.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  )) {
    if (
      assignment.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
      Node.isIdentifier(assignment.getLeft())
    ) {
      add(assignment.getLeft().getText(), assignment.getRight());
    }
  }
  localAliasDependencyCache.set(sourceFile, dependencies);
  return dependencies;
}

function localFunctionCandidateNames(owner: Node): Set<string> {
  const names = localFunctionIdentityNames(owner);
  const dependencies = localAliasDependencies(owner.getSourceFile());
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, sources] of dependencies) {
      if (names.has(name) || ![...sources].some((source) => names.has(source))) {
        continue;
      }
      names.add(name);
      changed = true;
    }
  }
  return names;
}

export function localFunctionParameterValues(
  node: Node,
): CallableResolution<Node> | undefined {
  if (!Node.isIdentifier(node)) return undefined;
  const parameter = node
    .getSymbol()
    ?.getDeclarations()
    .filter(Node.isParameterDeclaration)
    .find(
      (declaration) =>
        declaration.getSourceFile() === node.getSourceFile(),
    );
  if (parameter === undefined) return undefined;
  const cached = localParameterValueCache.get(parameter);
  if (cached !== undefined) return cached ?? undefined;
  const owner = localParameterOwner(parameter);
  if (owner === undefined) {
    localParameterValueCache.set(parameter, null);
    return undefined;
  }
  const parameters = owner.getChildrenOfKind(
    SyntaxKind.Parameter,
  );
  const parameterIndex = parameters.indexOf(parameter);
  if (parameterIndex < 0) {
    localParameterValueCache.set(parameter, null);
    return undefined;
  }
  const identityKeys = localFunctionIdentityKeys(owner);
  const candidateCalls = new Set<CallExpression>();
  const invocationIndex = callIdentifierIndex(owner.getSourceFile());
  for (const name of localFunctionCandidateNames(owner)) {
    for (const call of invocationIndex.get(name) ?? []) {
      candidateCalls.add(call);
    }
  }
  const values: Node[] = [];
  let complete = true;
  let matched = false;
  for (const call of candidateCalls) {
    const invocation = localInvocation(call);
    const target = localCallableIdentityResolution(invocation.target);
    if (![...target.keys].some((key) => identityKeys.has(key))) continue;
    matched = true;
    complete = complete && target.complete;
    const args = invocation.arguments;
    if (
      args === undefined ||
      args.slice(0, parameterIndex + 1).some(Node.isSpreadElement)
    ) {
      complete = false;
      continue;
    }
    const value = args[parameterIndex] ?? parameter.getInitializer();
    if (value === undefined) {
      complete = false;
    } else {
      values.push(value);
    }
  }
  const resolution = matched ? { values, complete } : undefined;
  localParameterValueCache.set(parameter, resolution ?? null);
  return resolution;
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
  if (
    access?.name === "apply" &&
    !isGlobalIntrinsicObject(access.receiver, "Reflect")
  ) {
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
    !isGlobalIntrinsicObject(access.receiver, "Reflect")
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
