import { Node, SyntaxKind } from "ts-morph";

/**
 * Pure AST readers shared by the partition-blending detector. Moved verbatim out
 * of `blendingViolations` when corpus-provenance-split.test.ts was split into
 * per-topic files: these close over nothing but their arguments, so the detector's
 * mutable taint state stays in _corpus-blending.ts beside the walk that owns it.
 */
export const PARTITION_ACCESSORS = ["synthetic", "realDerived"] as const;

export type TrackedSymbol = NonNullable<ReturnType<Node["getSymbol"]>>;

export const directReads = (text: string): Set<string> =>
  new Set(
    PARTITION_ACCESSORS.filter(
      (accessor) =>
        new RegExp(`\\.${accessor}\\b`).test(text) ||
        new RegExp(`\\[\\s*["'\`]${accessor}["'\`]\\s*\\]`).test(text) ||
        new RegExp(`\\b${accessor}(?:Outcomes|PartitionReport)\\b`).test(text),
    ),
  );

export const staticStringValues = (node: Node | undefined): Set<string> => {
  if (node === undefined) return new Set();
  const type = node.getType();
  const alternatives = type.isUnion() ? type.getUnionTypes() : [type];
  return new Set(
    alternatives.flatMap((alternative) => {
      if (!alternative.isStringLiteral()) return [];
      const value = alternative.getLiteralValue();
      return typeof value === "string" ? [value] : [];
    }),
  );
};

export const staticPartitionAccessors = (node: Node | undefined): Set<string> =>
  new Set(
    [...staticStringValues(node)].filter((value) =>
      PARTITION_ACCESSORS.includes(
        value as typeof PARTITION_ACCESSORS[number],
      )
    ),
  );

export const resolvedSymbol = (symbol: TrackedSymbol): TrackedSymbol => {
  try {
    return symbol.getAliasedSymbol() ?? symbol;
  } catch {
    return symbol;
  }
};

export const symbolReads = (symbol: TrackedSymbol): Set<string> => {
  try {
    const resolved = resolvedSymbol(symbol);
    const reads = directReads(
      resolved.getDeclarations().map((declaration) => declaration.getText()).join("\n"),
    );
    for (const declaration of resolved.getDeclarations()) {
      if (!Node.isBindingElement(declaration)) continue;
      const name = declaration.getPropertyNameNode()?.getText() ??
        declaration.getNameNode().getText();
      if (PARTITION_ACCESSORS.includes(name as typeof PARTITION_ACCESSORS[number])) {
        reads.add(name);
      }
    }
    return reads;
  } catch {
    return new Set();
  }
};

export const isReportBoundaryCall = (node: Node): boolean => {
  if (!Node.isCallExpression(node)) return false;
  const symbol = node.getExpression().getSymbol();
  if (symbol === undefined) return false;
  let resolved: TrackedSymbol;
  try {
    resolved = resolvedSymbol(symbol);
  } catch {
    return false;
  }
  return ["buildCorpusReport", "renderCorpusReport"].includes(
    resolved.getName(),
  ) && resolved.getDeclarations().every((declaration) =>
    declaration.getSourceFile().getFilePath().replace(/\\/g, "/")
      .endsWith("/scripts/corpus/report.ts")
  );
};

export const unwrap = (input: Node): Node => {
  let node = input;
  while (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isTypeAssertion(node) ||
    Node.isNonNullExpression(node)
  ) {
    node = node.getExpression();
  }
  return node;
};

export type TaintTarget = {
  readonly symbol: TrackedSymbol;
  readonly path: readonly string[] | null;
};

export const taintTargets = (input: Node): TaintTarget[] => {
  const node = unwrap(input);
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    return symbol === undefined
      ? []
      : [{ symbol: resolvedSymbol(symbol), path: [] }];
  }
  if (Node.isPropertyAccessExpression(node)) {
    return taintTargets(node.getExpression()).map((target) => ({
      symbol: target.symbol,
      path: target.path === null
        ? null
        : [...target.path, node.getName()],
    }));
  }
  if (Node.isElementAccessExpression(node)) {
    const targets = taintTargets(node.getExpression());
    const members = staticStringValues(node.getArgumentExpression());
    return members.size === 0
      ? targets.map((target) => ({ ...target, path: null }))
      : targets.flatMap((target) => [...members].map((member) => ({
          symbol: target.symbol,
          path: target.path === null
            ? null
            : [...target.path, member],
        })));
  }
  return [];
};

export const pathsOverlap = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  const length = Math.min(left.length, right.length);
  return left.slice(0, length).every((part, index) => part === right[index]);
};

export const propertyName = (node: Node | undefined): string | undefined => {
  if (node === undefined) return undefined;
  if (Node.isIdentifier(node) || Node.isStringLiteral(node) || Node.isNumericLiteral(node)) {
    return Node.isIdentifier(node) ? node.getText() : node.getLiteralText();
  }
  const values = staticStringValues(node);
  return values.size === 1 ? [...values][0] : undefined;
};

export const literalValueAtPath = (
  input: Node,
  path: readonly string[],
): Node | undefined => {
  let current = unwrap(input);
  for (const part of path) {
    if (Node.isArrayLiteralExpression(current)) {
      const index = Number(part);
      if (!Number.isSafeInteger(index)) return undefined;
      const element = current.getElements()[index];
      if (element === undefined || Node.isOmittedExpression(element)) return undefined;
      current = unwrap(element);
      continue;
    }
    if (Node.isObjectLiteralExpression(current)) {
      const property = current.getProperties().find((candidate) =>
        (Node.isPropertyAssignment(candidate) ||
            Node.isShorthandPropertyAssignment(candidate) ||
            Node.isMethodDeclaration(candidate)) &&
          propertyName(candidate.getNameNode()) === part
      );
      if (property === undefined) return undefined;
      if (Node.isPropertyAssignment(property)) {
        current = unwrap(property.getInitializerOrThrow());
        continue;
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        current = property.getNameNode();
        continue;
      }
      return undefined;
    }
    return undefined;
  }
  return current;
};

export const objectAssignCall = (node: Node): boolean => {
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  if (
    !Node.isPropertyAccessExpression(expression) ||
    expression.getName() !== "assign" ||
    expression.getExpression().getText() !== "Object"
  ) {
    return false;
  }
  const symbol = expression.getExpression().getSymbol();
  return symbol === undefined || symbol.getDeclarations().every((declaration) =>
    declaration.getSourceFile().isDeclarationFile()
  );
};

export const assignmentOperators = new Set([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);
