import {
  Node,
  SyntaxKind,
  type BinaryExpression,
  type SourceFile,
} from "ts-morph";
import {
  callableExpressionAlternatives,
  reflectApplyResolution,
  reflectGetResolution,
} from "./_callable-indirection";

const PLAYWRIGHT_HOOK_MEMBERS = new Set([
  "beforeAll",
  "beforeEach",
  "afterAll",
  "afterEach",
]);

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

const BINARY_EXPRESSION_CACHE = new WeakMap<
  SourceFile,
  BinaryExpression[]
>();

function binaryExpressions(sourceFile: SourceFile): BinaryExpression[] {
  const cached = BINARY_EXPRESSION_CACHE.get(sourceFile);
  if (cached !== undefined) return cached;
  const expressions = sourceFile.getDescendantsOfKind(
    SyntaxKind.BinaryExpression,
  );
  BINARY_EXPRESSION_CACHE.set(sourceFile, expressions);
  return expressions;
}

function precedingAssignmentValues(node: Node): Node[] {
  if (!Node.isIdentifier(node)) return [];
  const symbol = node.getSymbol();
  if (symbol === undefined) return [];
  return binaryExpressions(node.getSourceFile())
    .filter(
      (candidate) =>
        candidate.getOperatorToken().getKind() ===
          SyntaxKind.EqualsToken &&
        candidate.getStart() < node.getStart() &&
        Node.isIdentifier(candidate.getLeft()) &&
        candidate.getLeft().getSymbol() === symbol,
    )
    .map((candidate) => candidate.getRight());
}

function importModuleOf(node: Node): string | undefined {
  return node
    .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
    ?.getModuleSpecifierValue();
}

function directNamespaceImport(
  node: Node,
): boolean {
  const normalized = unwrapExpression(node);
  return (
    Node.isIdentifier(normalized) &&
    (normalized
      .getSymbol()
      ?.getDeclarations()
      .some(
        (declaration) =>
          Node.isNamespaceImport(declaration) &&
          importModuleOf(declaration) === "@playwright/test",
      ) ??
      false)
  );
}

function directTestImport(
  node: Node,
): boolean {
  const normalized = unwrapExpression(node);
  return (
    Node.isIdentifier(normalized) &&
    (normalized
      .getSymbol()
      ?.getDeclarations()
      .some(
        (declaration) =>
          Node.isImportSpecifier(declaration) &&
          declaration.getName() === "test" &&
          importModuleOf(declaration) === "@playwright/test",
      ) ??
      false)
  );
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
    const right = staticStringValue(
      normalized.getRight(),
      new Set(seen),
    );
    return left === undefined || right === undefined
      ? undefined
      : `${left}${right}`;
  }
  if (!Node.isIdentifier(normalized)) return undefined;
  const sources = [
    ...(normalized
      .getSymbol()
      ?.getDeclarations()
      .flatMap((declaration) => {
        if (!Node.isVariableDeclaration(declaration)) return [];
        const initializer = declaration.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }) ?? []),
    ...precedingAssignmentValues(normalized),
  ];
  const values = sources.map((source) =>
    staticStringValue(source, new Set(seen)),
  );
  return values.length > 0 &&
    values.every(
      (value) => value !== undefined && value === values[0],
    )
    ? values[0]
    : undefined;
}

function memberAccess(
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

function staticPropertyName(node: Node): string | undefined {
  if (Node.isIdentifier(node)) return node.getText();
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.getLiteralText();
  }
  return Node.isComputedPropertyName(node)
    ? staticStringValue(node.getExpression())
    : undefined;
}

function indirectCallableTarget(node: Node): Node | undefined {
  const normalized = unwrapExpression(node);
  if (Node.isCallExpression(normalized)) {
    const access = memberAccess(normalized.getExpression());
    return access?.name === "bind" ? access.receiver : undefined;
  }
  const access = memberAccess(normalized);
  return access !== undefined &&
    (access.name === "call" || access.name === "apply")
    ? access.receiver
    : undefined;
}

function isUnshadowedGlobal(node: Node, name: string): boolean {
  const normalized = unwrapExpression(node);
  return (
    Node.isIdentifier(normalized) &&
    normalized.getText() === name &&
    !(normalized
      .getSymbol()
      ?.getDeclarations()
      .some(
        (declaration) =>
          declaration.getSourceFile() === normalized.getSourceFile(),
      ) ??
      false)
  );
}

function namespaceImportValue(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (
    alternatives.length !== 1 ||
    alternatives[0] !== normalized
  ) {
    return alternatives.some((alternative) =>
      namespaceImportValue(alternative, new Set(seen)),
    );
  }
  if (directNamespaceImport(normalized)) return true;
  if (!Node.isIdentifier(normalized)) return false;
  return [
    ...precedingAssignmentValues(normalized),
    ...(normalized
      .getSymbol()
      ?.getDeclarations()
      .flatMap((declaration) => {
        if (!Node.isVariableDeclaration(declaration)) return [];
        const initializer = declaration.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }) ?? []),
  ].some((source) => namespaceImportValue(source, new Set(seen)));
}

function playwrightTestValue(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (
    alternatives.length !== 1 ||
    alternatives[0] !== normalized
  ) {
    return alternatives.some((alternative) =>
      playwrightTestValue(alternative, new Set(seen)),
    );
  }
  if (directTestImport(normalized)) return true;
  const reflected = reflectGetResolution(normalized);
  if (
    reflected !== undefined &&
    (!reflected.complete ||
      reflected.values.some(
        (access) =>
          (access.name === undefined || access.name === "test") &&
          namespaceImportValue(access.receiver, new Set(seen)),
      ))
  ) {
    return true;
  }
  const access = memberAccess(normalized);
  if (
    access?.name === "test" &&
    namespaceImportValue(access.receiver, new Set(seen))
  ) {
    return true;
  }
  if (
    access?.name !== undefined &&
    objectPropertySources(access.receiver, access.name).some(
      (source) => playwrightTestValue(source, new Set(seen)),
    )
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  return [
    ...precedingAssignmentValues(normalized),
    ...declarations.flatMap((declaration) => {
      if (Node.isVariableDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }
      if (!Node.isBindingElement(declaration)) return [];
      const property =
        declaration.getPropertyNameNode() ??
        declaration.getNameNode();
      const name = staticPropertyName(property);
      const variable = declaration.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      const initializer = variable?.getInitializer();
      if (name === undefined || initializer === undefined) return [];
      return name === "test" &&
        namespaceImportValue(initializer, new Set(seen))
        ? [initializer]
        : objectPropertySources(initializer, name);
    }),
  ].some((source) => playwrightTestValue(source, new Set(seen)));
}

function objectAliasSources(node: Node): Node[] {
  const normalized = unwrapExpression(node);
  if (Node.isIdentifier(normalized)) {
    return [
      ...(normalized
        .getSymbol()
        ?.getDeclarations()
        .flatMap((declaration) => {
          if (Node.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer();
            return initializer === undefined ? [] : [initializer];
          }
          if (!Node.isBindingElement(declaration)) return [];
          const property =
            declaration.getPropertyNameNode() ??
            declaration.getNameNode();
          const name = staticPropertyName(property);
          const variable = declaration.getFirstAncestorByKind(
            SyntaxKind.VariableDeclaration,
          );
          const initializer = variable?.getInitializer();
          return name === undefined || initializer === undefined
            ? []
            : objectPropertySources(initializer, name);
        }) ?? []),
      ...precedingAssignmentValues(normalized),
    ];
  }
  if (
    Node.isCallExpression(normalized) &&
    isGlobalStaticCallable(
      normalized.getExpression(),
      "Object",
      "assign",
    )
  ) {
    const target = normalized.getArguments()[0];
    return target === undefined ? [] : [target];
  }
  return [];
}

function objectReferenceKeys(
  node: Node,
  seen = new Set<Node>(),
): Set<string> {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return new Set();
  seen.add(normalized);
  if (Node.isIdentifier(normalized)) {
    const keys = new Set<string>();
    const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
    if (declarations.length > 0) {
      keys.add(
        `symbol:${declarations
          .map(
            (declaration) =>
              `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`,
          )
          .sort()
          .join("|")}`,
      );
    }
    for (const source of objectAliasSources(normalized)) {
      for (const key of objectReferenceKeys(source, new Set(seen))) {
        keys.add(key);
      }
    }
    return keys;
  }
  const access = memberAccess(normalized);
  if (access?.name !== undefined) {
    const keys = new Set(
      [...objectReferenceKeys(access.receiver, new Set(seen))].map(
        (key) => `member:${key}:${access.name}`,
      ),
    );
    for (const source of objectPropertySources(
      access.receiver,
      access.name,
    )) {
      for (const key of objectReferenceKeys(source, new Set(seen))) {
        keys.add(key);
      }
    }
    return keys;
  }
  if (
    Node.isCallExpression(normalized) &&
    isGlobalStaticCallable(
      normalized.getExpression(),
      "Object",
      "assign",
    )
  ) {
    const target = normalized.getArguments()[0];
    return target === undefined
      ? new Set()
      : objectReferenceKeys(target, new Set(seen));
  }
  return new Set([
    `node:${normalized.getSourceFile().getFilePath()}:${normalized.getStart()}`,
  ]);
}

function sameObjectReference(left: Node, right: Node): boolean {
  const leftKeys = objectReferenceKeys(left);
  return [...objectReferenceKeys(right)].some((key) =>
    leftKeys.has(key),
  );
}

function isGlobalStaticCallable(
  node: Node,
  globalName: string,
  memberName: string,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const access = memberAccess(normalized);
  if (
    access?.name === memberName &&
    isUnshadowedGlobal(access.receiver, globalName)
  ) {
    return true;
  }
  const indirect = indirectCallableTarget(normalized);
  if (
    indirect !== undefined &&
    isGlobalStaticCallable(
      indirect,
      globalName,
      memberName,
      new Set(seen),
    )
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (
    declarations.some((declaration) => {
      if (!Node.isBindingElement(declaration)) return false;
      const property =
        declaration.getPropertyNameNode() ??
        declaration.getNameNode();
      if (staticPropertyName(property) !== memberName) return false;
      const variable = declaration.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      const initializer = variable?.getInitializer();
      return (
        initializer !== undefined &&
        isUnshadowedGlobal(initializer, globalName)
      );
    })
  ) {
    return true;
  }
  return objectAliasSources(normalized).some((source) =>
    isGlobalStaticCallable(
      source,
      globalName,
      memberName,
      new Set(seen),
    ),
  );
}

function staticNodeArray(
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
  const sources = objectAliasSources(normalized);
  return sources.length === 1
    ? staticNodeArray(sources[0], new Set(seen))
    : undefined;
}

function invokedCallable(
  call: Node & { getExpression(): Node; getArguments(): Node[] },
): { callable: Node; arguments?: Node[] } {
  const direct = unwrapExpression(call.getExpression());
  const args = call.getArguments();
  if (isGlobalStaticCallable(direct, "Reflect", "apply")) {
    return {
      callable: args[0] ?? direct,
      arguments: staticNodeArray(args[2]),
    };
  }
  const access = memberAccess(direct);
  if (access?.name === "call") {
    return {
      callable: access.receiver,
      arguments: args.slice(1),
    };
  }
  if (access?.name === "apply") {
    return {
      callable: access.receiver,
      arguments: staticNodeArray(args[1]),
    };
  }
  return { callable: direct, arguments: args };
}

function normalizedObjectProperties(
  node: Node,
): Map<string, Node> | undefined {
  const normalized = unwrapExpression(node);
  if (!Node.isObjectLiteralExpression(normalized)) return undefined;
  const properties = new Map<string, Node>();
  for (const property of normalized.getProperties()) {
    if (
      !Node.isPropertyAssignment(property) &&
      !Node.isShorthandPropertyAssignment(property) &&
      !Node.isMethodDeclaration(property) &&
      !Node.isGetAccessorDeclaration(property) &&
      !Node.isSetAccessorDeclaration(property)
    ) {
      return undefined;
    }
    const name = staticPropertyName(property.getNameNode());
    if (name === undefined || properties.has(name)) return undefined;
    properties.set(name, property);
  }
  return properties;
}

function descriptorValue(node: Node | undefined): Node | undefined {
  if (node === undefined) return undefined;
  const value = normalizedObjectProperties(node)?.get("value");
  if (Node.isPropertyAssignment(value)) return value.getInitializer();
  return Node.isShorthandPropertyAssignment(value)
    ? value.getNameNode()
    : undefined;
}

function dependsOnFunctionParameter(node: Node): boolean {
  return [
    ...(Node.isIdentifier(node) ? [node] : []),
    ...node.getDescendantsOfKind(SyntaxKind.Identifier),
  ].some((identifier) =>
    identifier
      .getSymbol()
      ?.getDeclarations()
      .some(Node.isParameterDeclaration),
  );
}

interface ObjectPropertyMutationIndex {
  readonly assignments: Array<{
    before: number;
    receiver: Node;
    name: string;
    value: Node;
  }>;
  readonly merges: Array<{
    before: number;
    target: Node;
    sources: Node[];
  }>;
  unresolvedReflectiveWrite: boolean;
}

const MUTATION_CACHE = new WeakMap<
  SourceFile,
  ObjectPropertyMutationIndex
>();

function objectPropertyMutationIndex(
  sourceFile: SourceFile,
): ObjectPropertyMutationIndex {
  const cached = MUTATION_CACHE.get(sourceFile);
  if (cached !== undefined) return cached;
  const index: ObjectPropertyMutationIndex = {
    assignments: [],
    merges: [],
    unresolvedReflectiveWrite: false,
  };
  MUTATION_CACHE.set(sourceFile, index);
  for (const candidate of binaryExpressions(sourceFile)) {
    if (
      candidate.getOperatorToken().getKind() !==
      SyntaxKind.EqualsToken
    ) {
      continue;
    }
    const target = memberAccess(candidate.getLeft());
    if (target?.name === undefined) continue;
    index.assignments.push({
      before: candidate.getStart(),
      receiver: target.receiver,
      name: target.name,
      value: candidate.getRight(),
    });
  }
  for (const call of sourceFile.getDescendantsOfKind(
    SyntaxKind.CallExpression,
  )) {
    if (
      isGlobalStaticCallable(
        call.getExpression(),
        "Object",
        "assign",
      )
    ) {
      const [target, ...sources] = call.getArguments();
      if (target !== undefined) {
        index.merges.push({
          before: call.getStart(),
          target,
          sources,
        });
      }
    }
    const invocation = invokedCallable(call);
    const defines = isGlobalStaticCallable(
      invocation.callable,
      "Object",
      "defineProperty",
    );
    const sets = isGlobalStaticCallable(
      invocation.callable,
      "Reflect",
      "set",
    );
    if (!defines && !sets) continue;
    const receiver = invocation.arguments?.[0];
    const name = staticStringValue(invocation.arguments?.[1]);
    const value = sets
      ? invocation.arguments?.[2]
      : descriptorValue(invocation.arguments?.[2]);
    if (
      receiver === undefined ||
      name === undefined ||
      value === undefined ||
      dependsOnFunctionParameter(receiver) ||
      dependsOnFunctionParameter(value)
    ) {
      index.unresolvedReflectiveWrite = true;
      continue;
    }
    index.assignments.push({
      before: call.getStart(),
      receiver,
      name,
      value,
    });
  }
  return index;
}

function precedingObjectPropertyValues(
  receiver: Node,
  name: string,
): Node[] {
  const before = receiver.getStart();
  const index = objectPropertyMutationIndex(receiver.getSourceFile());
  return [
    ...index.assignments
      .filter(
        (candidate) =>
          candidate.before < before &&
          candidate.name === name &&
          sameObjectReference(candidate.receiver, receiver),
      )
      .map((candidate) => candidate.value),
    ...index.merges
      .filter(
        (merge) =>
          merge.before < before &&
          sameObjectReference(merge.target, receiver),
      )
      .flatMap((merge) =>
        merge.sources.flatMap((source) =>
          objectPropertySources(source, name),
        ),
      ),
  ];
}

function objectPropertySources(
  receiver: Node,
  name: string,
  seen = new Set<Node>(),
): Node[] {
  const value = unwrapExpression(receiver);
  if (seen.has(value)) return [];
  seen.add(value);
  const assigned = precedingObjectPropertyValues(value, name);
  if (Node.isIdentifier(value)) {
    const sources = [
      ...(value
        .getSymbol()
        ?.getDeclarations()
        .flatMap((declaration) => {
          if (!Node.isVariableDeclaration(declaration)) return [];
          const initializer = declaration.getInitializer();
          return initializer === undefined ? [] : [initializer];
        }) ?? []),
      ...precedingAssignmentValues(value),
    ];
    return [
      ...assigned,
      ...sources.flatMap((source) =>
        objectPropertySources(source, name, new Set(seen)),
      ),
    ];
  }
  if (
    Node.isCallExpression(value) &&
    isGlobalStaticCallable(
      value.getExpression(),
      "Object",
      "assign",
    )
  ) {
    return [
      ...assigned,
      ...value.getArguments().flatMap((source) =>
        objectPropertySources(source, name, new Set(seen)),
      ),
    ];
  }
  const access = memberAccess(value);
  if (access?.name !== undefined) {
    return [
      ...assigned,
      ...objectPropertySources(
        access.receiver,
        access.name,
        new Set(seen),
      ).flatMap((source) =>
        objectPropertySources(source, name, new Set(seen)),
      ),
    ];
  }
  if (!Node.isObjectLiteralExpression(value)) return assigned;
  return [
    ...assigned,
    ...value.getProperties().flatMap((property) => {
      if (Node.isSpreadAssignment(property)) {
        return objectPropertySources(
          property.getExpression(),
          name,
          new Set(seen),
        );
      }
      if (staticPropertyName(property.getNameNode()) !== name) {
        return [];
      }
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return initializer === undefined ? [] : [initializer];
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        return [property.getNameNode()];
      }
      if (Node.isGetAccessorDeclaration(property)) {
        return property
          .getDescendantsOfKind(SyntaxKind.ReturnStatement)
          .flatMap((statement) => {
            const expression = statement.getExpression();
            return expression === undefined ? [] : [expression];
          });
      }
      return [];
    }),
  ];
}

function playwrightHookValue(
  node: Node,
  seen = new Set<Node>(),
): boolean {
  const normalized = unwrapExpression(node);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const alternatives = callableExpressionAlternatives(normalized);
  if (
    alternatives.length !== 1 ||
    alternatives[0] !== normalized
  ) {
    return alternatives.some((alternative) =>
      playwrightHookValue(alternative, new Set(seen)),
    );
  }
  const reflected = reflectGetResolution(normalized);
  if (
    reflected !== undefined &&
    (!reflected.complete ||
      reflected.values.some(
        (access) =>
          playwrightTestValue(access.receiver, new Set(seen)) &&
          (access.name === undefined ||
            PLAYWRIGHT_HOOK_MEMBERS.has(access.name)),
      ))
  ) {
    return true;
  }
  if (Node.isElementAccessExpression(normalized)) {
    const name = staticStringValue(normalized.getArgumentExpression());
    if (
      name === undefined &&
      playwrightTestValue(normalized.getExpression())
    ) {
      return true;
    }
  }
  const access = memberAccess(normalized);
  if (
    access !== undefined &&
    playwrightTestValue(access.receiver, new Set(seen)) &&
    (access.name === undefined ||
      PLAYWRIGHT_HOOK_MEMBERS.has(access.name))
  ) {
    return true;
  }
  if (
    access?.name !== undefined &&
    objectPropertySources(access.receiver, access.name).some(
      (source) => playwrightHookValue(source, new Set(seen)),
    )
  ) {
    return true;
  }
  const indirect = indirectCallableTarget(normalized);
  if (
    indirect !== undefined &&
    playwrightHookValue(indirect, new Set(seen))
  ) {
    return true;
  }
  if (!Node.isIdentifier(normalized)) return false;
  const declarations = normalized.getSymbol()?.getDeclarations() ?? [];
  if (
    declarations.some((declaration) => {
      if (!Node.isBindingElement(declaration)) return false;
      const property =
        declaration.getPropertyNameNode() ??
        declaration.getNameNode();
      const name = staticPropertyName(property);
      const variable = declaration.getFirstAncestorByKind(
        SyntaxKind.VariableDeclaration,
      );
      const initializer = variable?.getInitializer();
      return (
        name !== undefined &&
        PLAYWRIGHT_HOOK_MEMBERS.has(name) &&
        initializer !== undefined &&
        playwrightTestValue(initializer, new Set(seen))
      );
    })
  ) {
    return true;
  }
  return [
    ...precedingAssignmentValues(normalized),
    ...declarations.flatMap((declaration) => {
        if (Node.isVariableDeclaration(declaration)) {
          const initializer = declaration.getInitializer();
          return initializer === undefined ? [] : [initializer];
        }
        if (!Node.isBindingElement(declaration)) return [];
        const property =
          declaration.getPropertyNameNode() ??
          declaration.getNameNode();
        const name = staticPropertyName(property);
        const variable = declaration.getFirstAncestorByKind(
          SyntaxKind.VariableDeclaration,
        );
        const initializer = variable?.getInitializer();
        if (name === undefined || initializer === undefined) return [];
        return PLAYWRIGHT_HOOK_MEMBERS.has(name) &&
          playwrightTestValue(initializer, new Set(seen))
          ? [initializer]
          : objectPropertySources(initializer, name);
      }),
  ].some((source) => playwrightHookValue(source, new Set(seen)));
}

export function hasRegisteredPlaywrightHook(
  sourceFile: SourceFile,
): boolean {
  if (
    objectPropertyMutationIndex(sourceFile)
      .unresolvedReflectiveWrite
  ) {
    return true;
  }
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => {
      const reflected = reflectApplyResolution(call);
      return reflected === undefined
        ? playwrightHookValue(call.getExpression())
        : !reflected.complete ||
            reflected.values.some((target) =>
              playwrightHookValue(target),
            );
    });
}
