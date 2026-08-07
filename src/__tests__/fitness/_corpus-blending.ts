import { join } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import {
  assignmentOperators,
  directReads,
  isReportBoundaryCall,
  literalValueAtPath,
  objectAssignCall,
  PARTITION_ACCESSORS,
  pathsOverlap,
  propertyName,
  resolvedSymbol,
  staticPartitionAccessors,
  symbolReads,
  type TaintTarget,
  taintTargets,
  type TrackedSymbol,
  unwrap,
} from "./_corpus-blending-ast";
import {
  REPO_ROOT,
  shippedSourceFiles,
  toolingSourceFiles,
} from "./_fence-utils";

export function blendingViolations(project: Project, root = ""): string[] {
  const violations: string[] = [];
  const taints = new Map<TrackedSymbol, Set<string>>();
  const memberTaints = new Map<TrackedSymbol, Map<string, Set<string>>>();
  const addTaints = (
    target: TaintTarget,
    reads: ReadonlySet<string>,
  ): boolean => {
    if (reads.size === 0) return false;
    if (target.path === null || target.path.length === 0) {
      const before = taints.get(target.symbol);
      if (before !== undefined && [...reads].every((entry) => before.has(entry))) {
        return false;
      }
      taints.set(target.symbol, new Set([...(before ?? []), ...reads]));
      return true;
    }
    const members = memberTaints.get(target.symbol) ?? new Map();
    memberTaints.set(target.symbol, members);
    const key = JSON.stringify(target.path);
    const before = members.get(key);
    if (before !== undefined && [...reads].every((entry) => before.has(entry))) {
      return false;
    }
    members.set(key, new Set([...(before ?? []), ...reads]));
    return true;
  };
  const memberReads = (target: TaintTarget): Set<string> => {
    const reads = new Set<string>();
    const members = memberTaints.get(target.symbol);
    if (members === undefined) return reads;
    for (const [key, values] of members) {
      const assignedPath = JSON.parse(key) as string[];
      if (
        target.path === null ||
        target.path.length === 0 ||
        pathsOverlap(assignedPath, target.path)
      ) {
        for (const value of values) reads.add(value);
      }
    }
    return reads;
  };
  const readsOf = (node: Node): Set<string> => {
    if (isReportBoundaryCall(node)) return new Set();
    const reads = directReads(node.getText());
    const elementAccesses = Node.isElementAccessExpression(node)
      ? [node]
      : node.getDescendantsOfKind(SyntaxKind.ElementAccessExpression);
    for (const access of elementAccesses) {
      for (const accessor of staticPartitionAccessors(
        access.getArgumentExpression(),
      )) {
        reads.add(accessor);
      }
    }
    const memberAccesses = [
      ...(Node.isPropertyAccessExpression(node) ||
          Node.isElementAccessExpression(node) ? [node] : []),
      ...node.getDescendants().filter((descendant) =>
        Node.isPropertyAccessExpression(descendant) ||
        Node.isElementAccessExpression(descendant)
      ),
    ];
    for (const access of memberAccesses) {
      for (const target of taintTargets(access)) {
        for (const accessor of memberReads(target)) reads.add(accessor);
      }
    }
    for (const identifier of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
      const symbol = identifier.getSymbol();
      if (symbol === undefined) continue;
      for (const accessor of symbolReads(symbol)) reads.add(accessor);
      for (const accessor of taints.get(resolvedSymbol(symbol)) ?? []) {
        reads.add(accessor);
      }
    }
    if (Node.isIdentifier(node)) {
      const symbol = node.getSymbol();
      if (symbol !== undefined) {
        for (const accessor of symbolReads(symbol)) reads.add(accessor);
        const target = { symbol: resolvedSymbol(symbol), path: [] };
        for (const accessor of taints.get(target.symbol) ?? []) reads.add(accessor);
        for (const accessor of memberReads(target)) reads.add(accessor);
      }
    }
    return reads;
  };
  const readsAtPath = (
    source: Node,
    path: readonly string[],
  ): Set<string> => {
    const literal = literalValueAtPath(source, path);
    if (literal !== undefined && (literal !== source || path.length === 0)) {
      return readsOf(literal);
    }
    const reads = readsOf(source);
    for (const target of taintTargets(source)) {
      const nested = {
        symbol: target.symbol,
        path: target.path === null ? null : [...target.path, ...path],
      };
      for (const accessor of memberReads(nested)) reads.add(accessor);
      for (const accessor of taints.get(target.symbol) ?? []) reads.add(accessor);
    }
    for (const part of path) {
      if (PARTITION_ACCESSORS.includes(part as typeof PARTITION_ACCESSORS[number])) {
        reads.add(part);
      }
    }
    return reads;
  };
  const bindPatternTaints = (
    pattern: Node,
    source: Node,
    path: readonly string[] = [],
    defaults: readonly Node[] = [],
  ): boolean => {
    if (Node.isIdentifier(pattern)) {
      const target = taintTargets(pattern)[0];
      if (target === undefined) return false;
      const reads = readsAtPath(source, path);
      for (const fallback of defaults) {
        for (const accessor of readsOf(fallback)) reads.add(accessor);
      }
      return addTaints(target, reads);
    }
    if (Node.isObjectBindingPattern(pattern)) {
      let changed = false;
      for (const element of pattern.getElements()) {
        const member = propertyName(element.getPropertyNameNode()) ??
          propertyName(element.getNameNode());
        if (member === undefined) continue;
        const fallback = element.getInitializer();
        changed = bindPatternTaints(
          element.getNameNode(),
          source,
          [...path, member],
          fallback === undefined ? defaults : [...defaults, fallback],
        ) || changed;
      }
      return changed;
    }
    if (Node.isArrayBindingPattern(pattern)) {
      let changed = false;
      for (const [index, element] of pattern.getElements().entries()) {
        if (!Node.isBindingElement(element)) continue;
        const fallback = element.getInitializer();
        changed = bindPatternTaints(
          element.getNameNode(),
          source,
          [...path, String(index)],
          fallback === undefined ? defaults : [...defaults, fallback],
        ) || changed;
      }
      return changed;
    }
    if (Node.isObjectLiteralExpression(pattern)) {
      let changed = false;
      for (const property of pattern.getProperties()) {
        if (Node.isPropertyAssignment(property)) {
          const member = propertyName(property.getNameNode());
          if (member !== undefined) {
            changed = bindPatternTaints(
              property.getInitializerOrThrow(),
              source,
              [...path, member],
              defaults,
            ) || changed;
          }
        } else if (Node.isShorthandPropertyAssignment(property)) {
          changed = bindPatternTaints(
            property.getNameNode(),
            source,
            [...path, property.getName()],
            defaults,
          ) || changed;
        } else if (Node.isSpreadAssignment(property)) {
          changed = bindPatternTaints(
            property.getExpression(),
            source,
            path,
            defaults,
          ) || changed;
        }
      }
      return changed;
    }
    if (Node.isArrayLiteralExpression(pattern)) {
      let changed = false;
      for (const [index, element] of pattern.getElements().entries()) {
        if (Node.isOmittedExpression(element)) continue;
        changed = bindPatternTaints(
          Node.isSpreadElement(element) ? element.getExpression() : element,
          source,
          Node.isSpreadElement(element) ? path : [...path, String(index)],
          defaults,
        ) || changed;
      }
      return changed;
    }
    return false;
  };
  const addObjectMutationTaints = (call: Node): boolean => {
    if (!Node.isCallExpression(call) || !objectAssignCall(call)) return false;
    const [targetNode, ...sources] = call.getArguments();
    if (targetNode === undefined) return false;
    const targets = taintTargets(targetNode);
    let changed = false;
    for (const source of sources) {
      if (!Node.isObjectLiteralExpression(source)) {
        for (const target of targets) {
          changed = addTaints(target, readsOf(source)) || changed;
        }
        continue;
      }
      for (const property of source.getProperties()) {
        if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) {
          const member = propertyName(property.getNameNode());
          const value = Node.isPropertyAssignment(property)
            ? property.getInitializerOrThrow()
            : property.getNameNode();
          for (const target of targets) {
            changed = addTaints({
              symbol: target.symbol,
              path: target.path === null || member === undefined
                ? null
                : [...target.path, member],
            }, readsOf(value)) || changed;
          }
          continue;
        }
        for (const target of targets) {
          changed = addTaints(target, readsOf(property)) || changed;
        }
      }
    }
    return changed;
  };
  const addContainerMutationTaints = (call: Node): boolean => {
    if (!Node.isCallExpression(call)) return false;
    const expression = unwrap(call.getExpression());
    const method = Node.isPropertyAccessExpression(expression)
      ? expression.getName()
      : Node.isElementAccessExpression(expression)
        ? propertyName(expression.getArgumentExpression())
        : undefined;
    const target = Node.isPropertyAccessExpression(expression) ||
        Node.isElementAccessExpression(expression)
      ? expression.getExpression()
      : undefined;
    if (method === undefined || target === undefined) return false;
    const arguments_ = call.getArguments();
    const sources =
      method === "splice" ? arguments_.slice(2) :
      ["push", "unshift", "add", "fill", "set"].includes(method)
        ? arguments_
        : [];
    if (sources.length === 0) return false;
    const reads = new Set(
      sources.flatMap((source) => [...readsOf(source)]),
    );
    return taintTargets(target).map((entry) =>
      addTaints(entry, reads)
    ).some(Boolean);
  };
  for (;;) {
    let changed = false;
    for (const sf of project.getSourceFiles()) {
      for (const declaration of sf.getDescendantsOfKind(
        SyntaxKind.VariableDeclaration,
      )) {
        const initializer = declaration.getInitializer();
        if (initializer === undefined || isReportBoundaryCall(initializer)) {
          continue;
        }
        changed = bindPatternTaints(
          declaration.getNameNode(),
          initializer,
        ) || changed;
      }
      for (const assignment of sf.getDescendantsOfKind(
        SyntaxKind.BinaryExpression,
      )) {
        const operator = assignment.getOperatorToken().getKind();
        if (!assignmentOperators.has(operator)) continue;
        const reads = readsOf(assignment.getRight());
        if (operator !== SyntaxKind.EqualsToken) {
          for (const accessor of readsOf(assignment.getLeft())) {
            reads.add(accessor);
          }
        }
        if (
          operator === SyntaxKind.EqualsToken &&
          (Node.isObjectLiteralExpression(assignment.getLeft()) ||
            Node.isArrayLiteralExpression(assignment.getLeft()))
        ) {
          changed = bindPatternTaints(
            assignment.getLeft(),
            assignment.getRight(),
          ) || changed;
        }
        for (const target of taintTargets(assignment.getLeft())) {
          changed = addTaints(target, reads) || changed;
        }
      }
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        changed = addObjectMutationTaints(call) ||
          addContainerMutationTaints(call) || changed;
      }
    }
    if (!changed) break;
  }
  for (const sf of project.getSourceFiles()) {
    const record = (expression: Node): void => {
      violations.push(
        `${sf.getFilePath().replace(root, "")}:${expression.getStartLineNumber()}: combines the synthetic and real-derived partitions into one figure`,
      );
    };
    for (const expression of sf.getDescendantsOfKind(
      SyntaxKind.BinaryExpression,
    )) {
      if (
        [
          SyntaxKind.PlusToken,
          SyntaxKind.MinusToken,
          SyntaxKind.AsteriskToken,
          SyntaxKind.SlashToken,
          SyntaxKind.PercentToken,
          SyntaxKind.AsteriskAsteriskToken,
        ].includes(expression.getOperatorToken().getKind()) &&
        PARTITION_ACCESSORS.every((accessor) => readsOf(expression).has(accessor))
      ) {
        record(expression);
      }
    }
    for (const expression of sf.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      if (isReportBoundaryCall(expression)) continue;
      const argumentsRead = new Set(
        expression.getArguments().flatMap((argument) => [...readsOf(argument)]),
      );
      const target = expression.getExpression();
      if (
        Node.isPropertyAccessExpression(target) &&
        ["reduce", "reduceRight", "concat"].includes(target.getName())
      ) {
        for (const accessor of readsOf(target.getExpression())) {
          argumentsRead.add(accessor);
        }
      }
      if (
        PARTITION_ACCESSORS.every((accessor) => argumentsRead.has(accessor))
      ) {
        record(expression);
      }
    }
    for (const expression of sf.getDescendantsOfKind(
      SyntaxKind.NewExpression,
    )) {
      const reads = new Set(
        expression.getArguments().flatMap((argument) => [...readsOf(argument)]),
      );
      if (PARTITION_ACCESSORS.every((accessor) => reads.has(accessor))) {
        record(expression);
      }
    }
    for (const expression of [
      ...sf.getDescendantsOfKind(SyntaxKind.TemplateExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression),
    ]) {
      if (PARTITION_ACCESSORS.every((accessor) => readsOf(expression).has(accessor))) {
        record(expression);
      }
    }
  }
  return violations;
}

export const measuredCodeProject = (): Project => {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of [...shippedSourceFiles(), ...toolingSourceFiles()]) {
    project.addSourceFileAtPath(file);
  }
  return project;
};
