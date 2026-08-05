import {
  Node,
  SyntaxKind,
  type CallExpression,
  type NewExpression,
  type Project,
  type SourceFile,
  type Symbol as MorphSymbol,
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
const sourceUsesDescriptorReadCache = new WeakMap<SourceFile, boolean>();

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

function sourceUsesDescriptorRead(sourceFile: SourceFile): boolean {
  const cached = sourceUsesDescriptorReadCache.get(sourceFile);
  if (cached !== undefined) return cached;
  const descriptorMembers = new Set([
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
  ]);
  const usesDescriptorRead =
    sourceFile.getFullText().includes("getOwnPropertyDescriptor") ||
    sourceFile
      .getDescendantsOfKind(SyntaxKind.ElementAccessExpression)
      .some((access) =>
        descriptorMembers.has(
          staticStringValue(access.getArgumentExpression()) ?? "",
        ),
      );
  sourceUsesDescriptorReadCache.set(sourceFile, usesDescriptorRead);
  return usesDescriptorRead;
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

function symbolIdentityKeys(
  symbol: MorphSymbol | undefined,
  seen = new Set<object>(),
): Set<object> {
  const keys = new Set<object>();
  if (symbol === undefined || seen.has(symbol.compilerSymbol)) return keys;
  seen.add(symbol.compilerSymbol);
  keys.add(symbol.compilerSymbol);
  const aliased = symbol.getAliasedSymbol();
  if (aliased !== undefined) {
    for (const key of symbolIdentityKeys(aliased, seen)) keys.add(key);
  }
  return keys;
}

function objectIdentityKeys(
  node: Node,
  seen = new Set<Node>(),
): Set<object> {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return new Set();
  seen.add(normalized);
  if (Node.isObjectLiteralExpression(normalized)) return new Set([normalized]);
  if (!Node.isIdentifier(normalized)) return new Set();
  const keys = symbolIdentityKeys(normalized.getSymbol());
  for (const source of identifierValueSources(normalized)) {
    for (const key of objectIdentityKeys(source, new Set(seen))) keys.add(key);
  }
  return keys;
}

function sameObjectIdentity(left: Node, right: Node): boolean {
  const leftKeys = objectIdentityKeys(left);
  return [...objectIdentityKeys(right)].some((key) => leftKeys.has(key));
}

function precedingObjectPropertyResolution(
  receiver: Node,
  name: string,
): CallableResolution<Node> {
  const values: Node[] = [];
  let complete = true;
  for (const assignment of receiver
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (
      assignment.getStart() >= receiver.getStart() ||
      assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken
    ) {
      continue;
    }
    const target = staticMemberAccess(assignment.getLeft());
    if (target === undefined || !sameObjectIdentity(target.receiver, receiver)) {
      continue;
    }
    if (target.name === undefined) {
      complete = false;
    } else if (target.name === name) {
      values.push(assignment.getRight());
    }
  }
  return { values, complete };
}

function stableObjectPropertyResolution(
  receiver: Node,
  name: string,
  seen = new Set<Node>(),
): CallableResolution<Node> | undefined {
  const normalized = unwrapExpression(receiver);
  if (seen.has(normalized)) return { values: [], complete: false };
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    return combineResolutions(
      alternatives.map((alternative) =>
        stableObjectPropertyResolution(alternative, name, new Set(seen)),
      ),
    );
  }
  const assigned = precedingObjectPropertyResolution(normalized, name);
  if (Node.isIdentifier(normalized)) {
    const sources = identifierValueSources(normalized);
    if (sources.length === 0) return undefined;
    const sourceResolution = combineResolutions(
      sources.map((source) =>
        stableObjectPropertyResolution(source, name, new Set(seen)),
      ),
    );
    return {
      values: [...assigned.values, ...(sourceResolution?.values ?? [])],
      complete:
        assigned.complete &&
        sourceResolution !== undefined &&
        sourceResolution.complete,
    };
  }
  const access = staticMemberAccess(normalized);
  if (access?.name !== undefined) {
    const parent = stableObjectPropertyResolution(
      access.receiver,
      access.name,
      new Set(seen),
    );
    if (parent === undefined) return undefined;
    const nested = parent.values.map((source) =>
      stableObjectPropertyResolution(source, name, new Set(seen)),
    );
    return {
      values: [
        ...assigned.values,
        ...nested.flatMap((resolution) => resolution?.values ?? []),
      ],
      complete:
        assigned.complete &&
        parent.complete &&
        nested.every(
          (resolution) => resolution !== undefined && resolution.complete,
        ),
    };
  }
  if (!Node.isObjectLiteralExpression(normalized)) return undefined;
  const values = [...assigned.values];
  let complete = assigned.complete;
  for (const property of normalized.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const spread = stableObjectPropertyResolution(
        property.getExpression(),
        name,
        new Set(seen),
      );
      if (spread === undefined) {
        complete = false;
      } else {
        values.push(...spread.values);
        complete = complete && spread.complete;
      }
      continue;
    }
    const propertyName = staticPropertyName(property.getNameNode());
    if (propertyName === undefined) {
      complete = false;
      continue;
    }
    if (propertyName !== name) continue;
    if (Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      if (initializer === undefined) complete = false;
      else values.push(initializer);
    } else if (Node.isShorthandPropertyAssignment(property)) {
      values.push(property.getNameNode());
    } else {
      complete = false;
    }
  }
  return { values, complete };
}

function bindingElementValueResolution(
  declaration: Node,
  seen = new Set<Node>(),
): CallableResolution<Node> | undefined {
  if (!Node.isBindingElement(declaration)) return undefined;
  const property =
    declaration.getPropertyNameNode() ?? declaration.getNameNode();
  const name = staticPropertyName(property);
  const variable = declaration.getFirstAncestorByKind(
    SyntaxKind.VariableDeclaration,
  );
  const initializer = variable?.getInitializer();
  if (name === undefined || initializer === undefined) {
    return { values: [], complete: false };
  }
  const propertyResolution = stableObjectPropertyResolution(
    initializer,
    name,
    seen,
  );
  const defaultValue = declaration.getInitializer();
  if (propertyResolution === undefined) {
    return defaultValue === undefined
      ? undefined
      : { values: [defaultValue], complete: false };
  }
  return {
    values: [
      ...propertyResolution.values,
      ...(defaultValue === undefined ? [] : [defaultValue]),
    ],
    complete: propertyResolution.complete,
  };
}

interface IntrinsicObjectResolution {
  readonly matches: boolean;
  readonly complete: boolean;
  readonly resolved: boolean;
}

function globalIntrinsicObjectResolution(
  node: Node,
  intrinsicName: string,
  seen = new Set<Node>(),
): IntrinsicObjectResolution {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) {
    return { matches: false, complete: false, resolved: true };
  }
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    const resolutions = alternatives.map((alternative) =>
      globalIntrinsicObjectResolution(
        alternative,
        intrinsicName,
        new Set(seen),
      ),
    );
    return {
      matches: resolutions.some((resolution) => resolution.matches),
      complete: resolutions.every(
        (resolution) => resolution.resolved && resolution.complete,
      ),
      resolved: true,
    };
  }
  if (isUnshadowedGlobalName(normalized, intrinsicName)) {
    return { matches: true, complete: true, resolved: true };
  }
  const access = staticMemberAccess(normalized);
  if (
    access?.name === intrinsicName &&
    isGlobalObjectRoot(access.receiver)
  ) {
    return { matches: true, complete: true, resolved: true };
  }
  if (access?.name !== undefined) {
    const property = stableObjectPropertyResolution(
      access.receiver,
      access.name,
    );
    if (property !== undefined) {
      const resolutions = property.values.map((source) =>
        globalIntrinsicObjectResolution(
          source,
          intrinsicName,
          new Set(seen),
        ),
      );
      return {
        matches: resolutions.some((resolution) => resolution.matches),
        complete:
          property.complete &&
          resolutions.every(
            (resolution) => resolution.resolved && resolution.complete,
          ),
        resolved: true,
      };
    }
  }
  if (access !== undefined && access.name === undefined) {
    return { matches: false, complete: false, resolved: true };
  }
  if (Node.isObjectLiteralExpression(normalized)) {
    return { matches: false, complete: true, resolved: true };
  }
  if (!Node.isIdentifier(normalized)) {
    return { matches: false, complete: true, resolved: false };
  }
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
    return { matches: true, complete: true, resolved: true };
  }
  const bindingResolutions = declarations
    .map((declaration) =>
      bindingElementValueResolution(declaration, new Set(seen)),
    )
    .filter(
      (resolution): resolution is CallableResolution<Node> =>
        resolution !== undefined,
    );
  if (bindingResolutions.length > 0) {
    const resolutions = bindingResolutions.flatMap((binding) =>
      binding.values.map((source) =>
        globalIntrinsicObjectResolution(
          source,
          intrinsicName,
          new Set(seen),
        ),
      ),
    );
    return {
      matches: resolutions.some((resolution) => resolution.matches),
      complete:
        bindingResolutions.every((resolution) => resolution.complete) &&
        resolutions.length > 0 &&
        resolutions.every(
          (resolution) => resolution.resolved && resolution.complete,
        ),
      resolved: true,
    };
  }
  const sources = identifierValueSources(normalized);
  if (sources.length === 0) {
    return { matches: false, complete: true, resolved: false };
  }
  const resolutions = sources.map((source) =>
    globalIntrinsicObjectResolution(source, intrinsicName, new Set(seen)),
  );
  return {
    matches: resolutions.some((resolution) => resolution.matches),
    complete: resolutions.every(
      (resolution) => resolution.resolved && resolution.complete,
    ),
    resolved: true,
  };
}

export function isGlobalIntrinsicObject(
  node: Node,
  intrinsicName: string,
  seen = new Set<Node>(),
): boolean {
  const resolution = globalIntrinsicObjectResolution(
    node,
    intrinsicName,
    seen,
  );
  return resolution.matches || (resolution.resolved && !resolution.complete);
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

type LocalInvocationExpression = CallExpression | NewExpression;

interface LocalCallableIdentityResolution {
  readonly keys: ReadonlySet<object>;
  readonly complete: boolean;
}

function localParameterOwner(node: Node): Node | undefined {
  const parent = node.getParent();
  return Node.isFunctionDeclaration(parent) ||
    Node.isFunctionExpression(parent) ||
    Node.isArrowFunction(parent) ||
    Node.isMethodDeclaration(parent) ||
    Node.isConstructorDeclaration(parent)
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
    for (const key of symbolIdentityKeys(owner.getNameNode()?.getSymbol())) {
      keys.add(key);
    }
  }
  if (Node.isConstructorDeclaration(owner)) {
    const classLike = owner.getParent();
    if (
      Node.isClassDeclaration(classLike) ||
      Node.isClassExpression(classLike)
    ) {
      for (const key of symbolIdentityKeys(classLike.getNameNode()?.getSymbol())) {
        keys.add(key);
      }
      const variable = classLike.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      if (variable?.getInitializer() === classLike) {
        for (const key of symbolIdentityKeys(variable.getNameNode().getSymbol())) {
          keys.add(key);
        }
      }
    }
  }
  const variable = owner.getFirstAncestorByKind(
    SyntaxKind.VariableDeclaration,
  );
  if (variable?.getInitializer() === owner) {
    const name = variable.getNameNode();
    if (Node.isIdentifier(name)) {
      for (const key of symbolIdentityKeys(name.getSymbol())) keys.add(key);
    }
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
  if (Node.isConstructorDeclaration(owner)) {
    const classLike = owner.getParent();
    if (
      Node.isClassDeclaration(classLike) ||
      Node.isClassExpression(classLike)
    ) {
      const name = classLike.getName();
      if (name !== undefined) names.add(name);
      const variable = classLike.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      if (variable?.getInitializer() === classLike) {
        const variableName = variable.getNameNode();
        if (Node.isIdentifier(variableName)) names.add(variableName.getText());
      }
    }
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
    const keys = symbolIdentityKeys(normalized.getSymbol());
    return {
      keys,
      complete: keys.size > 0,
    };
  }
  if (!Node.isIdentifier(normalized)) {
    return { keys: new Set(), complete: false };
  }
  const symbolKeys = symbolIdentityKeys(normalized.getSymbol());
  const sources = identifierValueSources(normalized);
  if (sources.length === 0) {
    return {
      keys: symbolKeys,
      complete: symbolKeys.size > 0,
    };
  }
  const resolutions = sources.map((source) =>
    localCallableIdentityResolution(source, new Set(seen)),
  );
  return {
    keys: new Set([
      ...symbolKeys,
      ...resolutions.flatMap((resolution) => [...resolution.keys]),
    ]),
    complete: resolutions.every((resolution) => resolution.complete),
  };
}

function localInvocation(
  invocation: LocalInvocationExpression,
): LocalInvocation {
  const callable = unwrapExpression(invocation.getExpression());
  const args = invocation.getArguments();
  if (Node.isNewExpression(invocation)) {
    return { target: callable, arguments: args };
  }
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

interface ProjectInvocationIndex {
  readonly sourceFiles: readonly SourceFile[];
  readonly callsByIdentity: Map<object, LocalInvocationExpression[]>;
}

const projectInvocationIndexCache = new WeakMap<
  Project,
  ProjectInvocationIndex
>();

function sameSourceFiles(
  left: readonly SourceFile[],
  right: readonly SourceFile[],
): boolean {
  return (
    left.length === right.length &&
    left.every((sourceFile, index) => sourceFile === right[index])
  );
}

function projectInvocationIndex(project: Project): ProjectInvocationIndex {
  const sourceFiles = project.getSourceFiles();
  const cached = projectInvocationIndexCache.get(project);
  if (
    cached !== undefined &&
    sameSourceFiles(cached.sourceFiles, sourceFiles)
  ) {
    return cached;
  }
  const canExtend =
    cached !== undefined &&
    cached.sourceFiles.every((sourceFile) => sourceFiles.includes(sourceFile));
  const callsByIdentity = canExtend
    ? cached.callsByIdentity
    : new Map<object, LocalInvocationExpression[]>();
  const indexedFiles = canExtend ? new Set(cached.sourceFiles) : new Set();
  const newSourceFiles = sourceFiles.filter(
    (sourceFile) => !indexedFiles.has(sourceFile),
  );
  for (const call of newSourceFiles.flatMap((sourceFile) => [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression),
  ])) {
    const invocation = localInvocation(call);
    const identity = localCallableIdentityResolution(invocation.target);
    for (const key of identity.keys) {
      const calls = callsByIdentity.get(key) ?? [];
      calls.push(call);
      callsByIdentity.set(key, calls);
    }
  }
  const index = { sourceFiles, callsByIdentity };
  projectInvocationIndexCache.set(project, index);
  return index;
}

interface LocalParameterValueCacheEntry {
  readonly sourceFiles: readonly SourceFile[];
  readonly resolution: CallableResolution<Node> | null;
}

const localParameterValueCache = new WeakMap<
  Node,
  LocalParameterValueCacheEntry
>();
const callIdentifierIndexCache = new WeakMap<
  SourceFile,
  ReadonlyMap<string, readonly LocalInvocationExpression[]>
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
): ReadonlyMap<string, readonly LocalInvocationExpression[]> {
  const cached = callIdentifierIndexCache.get(sourceFile);
  if (cached !== undefined) return cached;
  const index = new Map<string, LocalInvocationExpression[]>();
  for (const identifier of sourceFile.getDescendantsOfKind(
    SyntaxKind.Identifier,
  )) {
    const call = identifier.getAncestors().find(
      (ancestor): ancestor is LocalInvocationExpression =>
        Node.isCallExpression(ancestor) || Node.isNewExpression(ancestor),
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
  const owner = localParameterOwner(parameter);
  const sourceFiles = owner?.getProject().getSourceFiles() ?? [];
  const cached = localParameterValueCache.get(parameter);
  if (
    cached !== undefined &&
    sameSourceFiles(cached.sourceFiles, sourceFiles)
  ) {
    return cached.resolution ?? undefined;
  }
  if (owner === undefined) {
    localParameterValueCache.set(parameter, {
      sourceFiles,
      resolution: null,
    });
    return undefined;
  }
  const parameters = owner.getChildrenOfKind(
    SyntaxKind.Parameter,
  );
  const parameterIndex = parameters.indexOf(parameter);
  if (parameterIndex < 0) {
    localParameterValueCache.set(parameter, {
      sourceFiles,
      resolution: null,
    });
    return undefined;
  }
  const identityKeys = localFunctionIdentityKeys(owner);
  const candidateCalls = new Set<LocalInvocationExpression>();
  const invocationIndex = callIdentifierIndex(owner.getSourceFile());
  for (const name of localFunctionCandidateNames(owner)) {
    for (const call of invocationIndex.get(name) ?? []) {
      candidateCalls.add(call);
    }
  }
  const projectIndex = projectInvocationIndex(owner.getProject());
  for (const key of identityKeys) {
    for (const call of projectIndex.callsByIdentity.get(key) ?? []) {
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
  localParameterValueCache.set(parameter, {
    sourceFiles,
    resolution: resolution ?? null,
  });
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

const DESCRIPTOR_CALLABLE_MEMBERS = new Set(["get", "set", "value"]);

function descriptorSourceResolution(
  node: Node,
  seen = new Set<Node>(),
): CallableResolution<ReflectedPropertyAccess> | undefined {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return { values: [], complete: false };
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    return combineResolutions(
      alternatives.map((alternative) =>
        descriptorSourceResolution(alternative, new Set(seen)),
      ),
    );
  }
  if (Node.isIdentifier(normalized)) {
    const sources = identifierValueSources(normalized);
    if (sources.length > 0) {
      return combineResolutions(
        sources.map((source) =>
          descriptorSourceResolution(source, new Set(seen)),
        ),
      );
    }
  }
  if (!Node.isCallExpression(normalized)) return undefined;
  const invocation = localInvocation(normalized);
  if (
    !isGlobalIntrinsicCallable(
      invocation.target,
      "Object",
      "getOwnPropertyDescriptor",
    ) &&
    !isGlobalIntrinsicCallable(
      invocation.target,
      "Reflect",
      "getOwnPropertyDescriptor",
    )
  ) {
    return undefined;
  }
  const receiver = invocation.arguments?.[0];
  const name = staticStringValue(invocation.arguments?.[1]);
  return receiver === undefined
    ? { values: [], complete: false }
    : {
        values: [{ receiver, name }],
        complete: true,
      };
}

function descriptorMapPropertyResolution(
  node: Node,
  name: string | undefined,
  seen = new Set<Node>(),
): CallableResolution<ReflectedPropertyAccess> | undefined {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return { values: [], complete: false };
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    const resolution = combineResolutions(
      alternatives.map((alternative) =>
        descriptorMapPropertyResolution(
          alternative,
          name,
          new Set(seen),
        ),
      ),
    );
    return resolution;
  }
  if (Node.isIdentifier(normalized)) {
    const sources = identifierValueSources(normalized);
    if (sources.length > 0) {
      const resolution = combineResolutions(
        sources.map((source) =>
          descriptorMapPropertyResolution(source, name, new Set(seen)),
        ),
      );
      return resolution;
    }
  }
  const member = staticMemberAccess(normalized);
  if (member?.name !== undefined) {
    const property = stableObjectPropertyResolution(
      member.receiver,
      member.name,
    );
    if (property !== undefined) {
      const resolution = combineResolutions(
        property.values.map((source) =>
          descriptorMapPropertyResolution(source, name, new Set(seen)),
        ),
      );
      if (resolution !== undefined) {
        return {
          values: resolution.values,
          complete: property.complete && resolution.complete,
        };
      }
    }
  }
  if (!Node.isCallExpression(normalized)) return undefined;
  const invocation = localInvocation(normalized);
  if (
    !isGlobalIntrinsicCallable(
      invocation.target,
      "Object",
      "getOwnPropertyDescriptors",
    )
  ) {
    return undefined;
  }
  const receiver = invocation.arguments?.[0];
  return receiver === undefined
    ? { values: [], complete: false }
    : {
        values: [{ receiver, name }],
        complete: true,
      };
}

function descriptorCallableResolution(
  node: Node,
  seen = new Set<Node>(),
): CallableResolution<ReflectedPropertyAccess> | undefined {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return { values: [], complete: false };
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (expandsCallableExpression(normalized, alternatives)) {
    return combineResolutions(
      alternatives.map((alternative) =>
        descriptorCallableResolution(alternative, new Set(seen)),
      ),
    );
  }
  const callableMember = staticMemberAccess(normalized);
  if (
    callableMember === undefined ||
    (callableMember.name !== undefined &&
      !DESCRIPTOR_CALLABLE_MEMBERS.has(callableMember.name))
  ) {
    return undefined;
  }
  const direct = descriptorSourceResolution(
    callableMember.receiver,
    new Set(seen),
  );
  const selected = staticMemberAccess(callableMember.receiver);
  const mapped = selected === undefined
    ? undefined
    : descriptorMapPropertyResolution(
        selected.receiver,
        selected.name,
        new Set(seen),
      );
  const resolution = direct === undefined
    ? mapped
    : mapped === undefined
      ? direct
      : combineResolutions([direct, mapped]);
  if (resolution === undefined) return undefined;
  return resolution;
}

export function reflectGetResolution(
  node: Node,
): CallableResolution<ReflectedPropertyAccess> | undefined {
  if (
    !sourceUsesReflect(node.getSourceFile()) &&
    !sourceUsesDescriptorRead(node.getSourceFile())
  ) {
    return undefined;
  }
  const normalized = unwrapExpression(node);
  const reflected = Node.isCallExpression(normalized)
    ? compositionalReflectGetResolution(
        normalized.getExpression(),
        normalized.getArguments(),
      )
    : undefined;
  return reflected ?? descriptorCallableResolution(normalized);
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
