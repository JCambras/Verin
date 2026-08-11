import { describe, it, expect } from "vitest";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type Project,
  type Signature,
  type Statement,
  type SourceFile,
  type Type,
} from "ts-morph";
import {
  authorityPrologueViolations,
  realSemanticProject,
  inMemoryProject,
  detectAppLayerSqlAccess,
  isSqlExecutorCall,
  normalizeSqlExecutorCall,
  normalizedPath,
  REPO_ROOT,
  grantAction,
  requiredAuthorityPrologue,
  returnedCallableMembers,
  sealedAuthorityParameters,
  structuralPiiExposures,
  typeKey,
} from "./_fence-utils";
import { GOVERNED_ACTIONS } from "@contracts/authz";
import { isPIIField } from "@contracts/pii";
import { ROLES } from "@contracts/roles";

/**
 * GOVERNED-ACTIONS FENCE (v3 §15.3; extends charter #12's route-level RBAC).
 * Three structural guarantees:
 *  1. The registry covers EXACTLY the seven permission points v3 §15.3 names,
 *     as eight actions (policy drafting and approval are distinct) — an action
 *     cannot be dropped (or renamed away) silently.
 *  2. Separation of duties holds in the registry itself: compliance authority
 *     (policy.approve, decision.override) never includes the IT-admin role or
 *     the requesting advisor role (D-036) — a quiet allowlist widening fails
 *     the build, not review.
 *  3. Every SURFACED governed action's route file calls
 *     requireActionGrant(..., "<that action>") — the hook cannot be unwired.
 */
const V3_15_3_ACTIONS = [
  "pii.view", // viewing PII
  "evidence.supply", // supplying evidence
  "policy.draft", // drafting policy
  "policy.approve", // approving policy
  "decision.approve", // approving decisions
  "decision.override", // overriding policy
  "execution.initiate", // initiating execution
  "audit.export", // viewing audit exports
] as const;

interface GovernedSink {
  readonly file: string;
  readonly name: string;
  readonly action: string;
  readonly declaration: Node;
  readonly signature: Signature;
  readonly anchors: readonly Node[];
}

interface GovernedRouteEntry {
  readonly file: string;
  readonly handler: string;
  readonly action: string;
  readonly sink: string;
  readonly sinkFile?: string;
  /**
   * Which parameter of the sink is its ActionGrant. THAT argument must carry the
   * authorized value — "some argument mentions auth.value" would let a route pass
   * `listHouseholds(scopedDb(auth.value.tenant), body.value.grant)`, where the
   * grant itself is client-supplied.
   */
  readonly grantIndex?: number | null;
}

function callResolvesTo(
  call: CallExpression,
  file: string,
  name: string,
): boolean {
  const symbol = call.getExpression().getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return target?.getName() === name &&
    target.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) === file
    );
}

function nodeKey(node: Node): string {
  return [
    node.getSourceFile().getFilePath(),
    node.getKind(),
    node.getStart(),
    node.getEnd(),
  ].join(":");
}

function assignedValueSources(expression: Node): Node[] {
  const symbol = expression.getSymbol();
  const sources = Node.isIdentifier(expression)
    ? (symbol?.getDeclarations() ?? []).flatMap((declaration) =>
      Node.isVariableDeclaration(declaration) && declaration.getInitializer()
        ? [declaration.getInitializerOrThrow()]
        : []
    )
    : [];
  const member = (node: Node): { receiver: Node; name: string | null } | null => {
    if (Node.isPropertyAccessExpression(node)) {
      return { receiver: node.getExpression(), name: node.getName() };
    }
    if (!Node.isElementAccessExpression(node)) return null;
    const argument = node.getArgumentExpression();
    return {
      receiver: node.getExpression(),
      name: argument &&
          (Node.isStringLiteral(argument) ||
            Node.isNoSubstitutionTemplateLiteral(argument) ||
            Node.isNumericLiteral(argument))
        ? argument.getLiteralText()
        : null,
    };
  };
  const sameTarget = (left: Node): boolean => {
    if (
      Node.isIdentifier(left) &&
      Node.isIdentifier(expression)
    ) return left.getSymbol() === symbol;
    const leftMember = member(left);
    const expected = member(expression);
    if (!leftMember || !expected) return false;
    const sameReceiver =
      leftMember.receiver.getSymbol() &&
        expected.receiver.getSymbol()
        ? leftMember.receiver.getSymbol() === expected.receiver.getSymbol()
        : leftMember.receiver.getText() === expected.receiver.getText();
    return sameReceiver &&
      (leftMember.name === null ||
        expected.name === null ||
        leftMember.name === expected.name);
  };
  sources.push(
    ...expression.getSourceFile()
      .getDescendantsOfKind(SyntaxKind.BinaryExpression)
      .filter((candidate) =>
        candidate.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        candidate.getStart() < expression.getStart() &&
        sameTarget(candidate.getLeft())
      )
      .map((candidate) => candidate.getRight()),
  );
  return sources;
}

function returnedValues(declaration: Node): Node[] {
  const callable =
    Node.isFunctionDeclaration(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isArrowFunction(declaration) ||
      Node.isMethodDeclaration(declaration) ||
      Node.isGetAccessorDeclaration(declaration)
      ? declaration
      : null;
  if (!callable) return [];
  const body = callable.getBody();
  if (!body) return [];
  if (!Node.isBlock(body)) return [body];
  return body.getDescendantsOfKind(SyntaxKind.ReturnStatement)
    .filter((statement) =>
      statement.getFirstAncestor((ancestor) =>
        Node.isFunctionDeclaration(ancestor) ||
        Node.isFunctionExpression(ancestor) ||
        Node.isArrowFunction(ancestor) ||
        Node.isMethodDeclaration(ancestor) ||
        Node.isGetAccessorDeclaration(ancestor)
      ) === callable
    )
    .flatMap((statement) => {
      const value = statement.getExpression();
      return value ? [value] : [];
    });
}

function invocationMember(node: Node): string | null {
  const expression =
    Node.isParenthesizedExpression(node) ||
      Node.isAsExpression(node) ||
      Node.isSatisfiesExpression(node) ||
      Node.isTypeAssertion(node) ||
      Node.isNonNullExpression(node)
      ? node.getExpression()
      : node;
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  if (!Node.isElementAccessExpression(expression)) return null;
  const argument = expression.getArgumentExpression();
  return argument &&
      (Node.isStringLiteral(argument) ||
        Node.isNoSubstitutionTemplateLiteral(argument))
    ? argument.getLiteralText()
    : null;
}

function invocationReceiver(node: Node): Node | null {
  const expression =
    Node.isParenthesizedExpression(node) ||
      Node.isAsExpression(node) ||
      Node.isSatisfiesExpression(node) ||
      Node.isTypeAssertion(node) ||
      Node.isNonNullExpression(node)
      ? node.getExpression()
      : node;
  return Node.isPropertyAccessExpression(expression) ||
      Node.isElementAccessExpression(expression)
    ? expression.getExpression()
    : null;
}

function isAmbientReflectApply(node: Node): boolean {
  if (invocationMember(node) !== "apply") return false;
  const receiver = invocationReceiver(node);
  return Boolean(
    receiver &&
    Node.isIdentifier(receiver) &&
    receiver.getText() === "Reflect" &&
    (receiver.getSymbol()?.getDeclarations() ?? []).every((declaration) =>
      declaration.getSourceFile().isDeclarationFile()
    ),
  );
}

function fixedInvocationArguments(node: Node | undefined): readonly Node[] | null {
  if (!node) return null;
  let expression = node;
  while (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isNonNullExpression(expression)
  ) expression = expression.getExpression();
  return Node.isArrayLiteralExpression(expression) &&
      !expression.getElements().some(Node.isSpreadElement)
    ? expression.getElements()
    : null;
}

function invocationTargetExpressions(call: CallExpression): readonly Node[] {
  const callee = call.getExpression();
  if (isAmbientReflectApply(callee)) {
    const target = call.getArguments()[0];
    return target ? [target] : [];
  }
  const member = invocationMember(callee);
  const receiver = invocationReceiver(callee);
  if ((member === "call" || member === "apply") && receiver) {
    return [receiver];
  }
  if (Node.isCallExpression(callee) && invocationMember(callee.getExpression()) === "bind") {
    const target = invocationReceiver(callee.getExpression());
    return target ? [target] : [];
  }
  return [callee];
}

function directInvocationArguments(call: CallExpression): readonly Node[] | null {
  const callee = call.getExpression();
  if (isAmbientReflectApply(callee)) {
    return fixedInvocationArguments(call.getArguments()[2]);
  }
  const member = invocationMember(callee);
  if (member === "call") return call.getArguments().slice(1);
  if (member === "apply") {
    return fixedInvocationArguments(call.getArguments()[1]);
  }
  if (Node.isCallExpression(callee) && invocationMember(callee.getExpression()) === "bind") {
    return [
      ...callee.getArguments().slice(1),
      ...call.getArguments(),
    ];
  }
  return call.getArguments();
}

function fixedContainerValueSources(
  node: Node,
  name: string | null,
  seen = new Set<string>(),
): Node[] {
  const key = nodeKey(node);
  if (seen.has(key)) return [];
  seen.add(key);
  const expression =
    Node.isParenthesizedExpression(node) ||
      Node.isAsExpression(node) ||
      Node.isSatisfiesExpression(node) ||
      Node.isTypeAssertion(node) ||
      Node.isNonNullExpression(node)
      ? node.getExpression()
      : node;
  if (Node.isConditionalExpression(expression)) {
    return [
      ...fixedContainerValueSources(expression.getWhenTrue(), name, seen),
      ...fixedContainerValueSources(expression.getWhenFalse(), name, seen),
    ];
  }
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (operator === SyntaxKind.CommaToken) {
      return fixedContainerValueSources(expression.getRight(), name, seen);
    }
    if (
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...fixedContainerValueSources(expression.getLeft(), name, seen),
        ...fixedContainerValueSources(expression.getRight(), name, seen),
      ];
    }
  }
  if (Node.isArrayLiteralExpression(expression)) {
    if (name === null) {
      return expression.getElements().filter((element) =>
        !Node.isOmittedExpression(element)
      );
    }
    const index = Number.parseInt(name, 10);
    const element = expression.getElements()[index];
    return String(index) === name && element && !Node.isOmittedExpression(element)
      ? [element]
      : [];
  }
  if (Node.isObjectLiteralExpression(expression)) {
    return expression.getProperties().flatMap((property) => {
      if (Node.isSpreadAssignment(property)) {
        return fixedContainerValueSources(property.getExpression(), name, seen);
      }
      if (
        !Node.isPropertyAssignment(property) &&
        !Node.isShorthandPropertyAssignment(property) &&
        !Node.isGetAccessorDeclaration(property)
      ) return [];
      if (name !== null && property.getName() !== name) return [];
      if (Node.isPropertyAssignment(property)) {
        const initializer = property.getInitializer();
        return initializer ? [initializer] : [];
      }
      if (Node.isShorthandPropertyAssignment(property)) {
        return [property.getNameNode()];
      }
      return returnedValues(property);
    });
  }
  if (Node.isCallExpression(expression)) {
    const member = invocationMember(expression.getExpression());
    const receiver = invocationReceiver(expression.getExpression());
    if (
      member === "freeze" &&
      receiver?.getText() === "Object"
    ) {
      const argument = expression.getArguments()[0];
      return argument
        ? fixedContainerValueSources(argument, name, seen)
        : [];
    }
    const providers = resolveCallTargets(expression.getExpression());
    const values = providers.flatMap(returnedValues);
    if (values.length > 0) {
      return values.flatMap((value) =>
        fixedContainerValueSources(value, name, seen)
      );
    }
  }
  const sources = assignedValueSources(expression);
  if (sources.length > 0) {
    return sources.flatMap((source) =>
      fixedContainerValueSources(source, name, seen)
    );
  }
  return [];
}

/**
 * Every declaration a callee expression can reach. getAliasedSymbol() unwraps
 * import/export aliases only, so a governed sink held as a VALUE would otherwise
 * hide from discovery — and a route that is never discovered is never checked.
 * The value forms followed here are the ones whose call site is still visible:
 * a local alias (`const listChain = verifyAndListOrgChain`), a property of a
 * literal bag (`const readers = { households: listHouseholds }`), a conditional,
 * and an array element. A sink handed to ANOTHER function has no visible call
 * site at all and is refused outright (detectEscapedGovernedSinks).
 */
function resolveCallTargets(expression: Node, seen = new Set<string>()): Node[] {
  const key = nodeKey(expression);
  if (seen.has(key)) return [];
  seen.add(key);
  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return resolveCallTargets(expression.getExpression(), seen);
  }
  // `(0, listHouseholds)(…)` — the comma operator's value is its right operand.
  if (
    Node.isBinaryExpression(expression) &&
    expression.getOperatorToken().getKind() === SyntaxKind.CommaToken
  ) {
    return resolveCallTargets(expression.getRight(), seen);
  }
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...resolveCallTargets(expression.getLeft(), seen),
        ...resolveCallTargets(expression.getRight(), seen),
      ];
    }
  }
  if (Node.isConditionalExpression(expression)) {
    return [
      ...resolveCallTargets(expression.getWhenTrue(), seen),
      ...resolveCallTargets(expression.getWhenFalse(), seen),
    ];
  }
  if (
    Node.isPropertyAccessExpression(expression) ||
    Node.isElementAccessExpression(expression)
  ) {
    const member = Node.isPropertyAccessExpression(expression)
      ? expression.getName()
      : invocationMember(expression);
    const values = fixedContainerValueSources(
      expression.getExpression(),
      member,
    );
    if (values.length > 0) {
      return values.flatMap((value) => resolveCallTargets(value, seen));
    }
  }
  if (Node.isCallExpression(expression)) {
    if (invocationMember(expression.getExpression()) === "bind") {
      const target = invocationReceiver(expression.getExpression());
      return target ? resolveCallTargets(target, seen) : [];
    }
    const invocationTargets = invocationTargetExpressions(expression);
    if (
      invocationTargets.length !== 1 ||
      invocationTargets[0] !== expression.getExpression()
    ) {
      return invocationTargets.flatMap((target) =>
        resolveCallTargets(target, seen)
      );
    }
    const providers = resolveCallTargets(expression.getExpression(), seen);
    const values = providers.flatMap(returnedValues);
    if (values.length > 0) {
      return values.flatMap((value) => resolveCallTargets(value, seen));
    }
  }
  const symbol = expression.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  const declarations = target?.getDeclarations() ?? [];
  const out = [...declarations];
  out.push(
    ...assignedValueSources(expression)
      .flatMap((source) => resolveCallTargets(source, seen)),
  );
  for (const declaration of declarations) {
    if (Node.isGetAccessorDeclaration(declaration)) {
      out.push(
        ...returnedValues(declaration).flatMap((value) =>
          resolveCallTargets(value, seen)
        ),
      );
    } else if (
      Node.isVariableDeclaration(declaration) ||
      Node.isPropertyAssignment(declaration)
    ) {
      const initializer = declaration.getInitializer();
      if (initializer) out.push(...resolveCallTargets(initializer, seen));
    } else if (Node.isShorthandPropertyAssignment(declaration)) {
      out.push(...resolveCallTargets(declaration.getNameNode(), seen));
    }
  }
  return out;
}

function callTargetResolutionComplete(
  expression: Node,
  seen = new Set<string>(),
): boolean {
  const key = nodeKey(expression);
  if (seen.has(key)) return false;
  seen.add(key);
  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return callTargetResolutionComplete(expression.getExpression(), seen);
  }
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (operator === SyntaxKind.CommaToken) {
      return callTargetResolutionComplete(expression.getRight(), seen);
    }
    if (
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      return callTargetResolutionComplete(expression.getLeft(), seen) &&
        callTargetResolutionComplete(expression.getRight(), seen);
    }
  }
  if (Node.isConditionalExpression(expression)) {
    return callTargetResolutionComplete(expression.getWhenTrue(), seen) &&
      callTargetResolutionComplete(expression.getWhenFalse(), seen);
  }
  if (
    Node.isPropertyAccessExpression(expression) ||
    Node.isElementAccessExpression(expression)
  ) {
    const member = Node.isPropertyAccessExpression(expression)
      ? expression.getName()
      : invocationMember(expression);
    const values = fixedContainerValueSources(
      expression.getExpression(),
      member,
    );
    if (values.length > 0) {
      return values.every((value) =>
        callTargetResolutionComplete(value, seen)
      );
    }
  }
  if (Node.isCallExpression(expression)) {
    if (invocationMember(expression.getExpression()) === "bind") {
      const target = invocationReceiver(expression.getExpression());
      return Boolean(
        target && callTargetResolutionComplete(target, seen),
      );
    }
    const invocationTargets = invocationTargetExpressions(expression);
    if (
      invocationTargets.length !== 1 ||
      invocationTargets[0] !== expression.getExpression()
    ) {
      return invocationTargets.length > 0 &&
        invocationTargets.every((target) =>
          callTargetResolutionComplete(target, seen)
        );
    }
    const providers = resolveCallTargets(expression.getExpression());
    const values = providers.flatMap(returnedValues);
    return providers.length > 0 && values.length > 0 &&
      values.every((value) => callTargetResolutionComplete(value, seen));
  }
  if (
    Node.isFunctionExpression(expression) ||
    Node.isArrowFunction(expression)
  ) return true;
  const symbol = expression.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  const declarations = target?.getDeclarations() ?? [];
  if (declarations.length === 0) return false;
  return declarations.every((declaration) => {
    if (
      Node.isFunctionDeclaration(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isArrowFunction(declaration) ||
      Node.isMethodDeclaration(declaration)
    ) return true;
    if (Node.isGetAccessorDeclaration(declaration)) {
      const values = returnedValues(declaration);
      return values.length > 0 &&
        values.every((value) => callTargetResolutionComplete(value, seen));
    }
    if (
      Node.isVariableDeclaration(declaration) ||
      Node.isPropertyAssignment(declaration) ||
      Node.isPropertySignature(declaration)
    ) {
      const assigned = assignedValueSources(expression);
      const sources = assigned.length > 0
        ? assigned
        : "getInitializer" in declaration && declaration.getInitializer()
        ? [declaration.getInitializerOrThrow()]
        : [];
      return sources.length > 0 &&
        sources.every((source) => callTargetResolutionComplete(source, seen));
    }
    if (Node.isShorthandPropertyAssignment(declaration)) {
      return callTargetResolutionComplete(declaration.getNameNode(), seen);
    }
    return false;
  });
}

function boundArgumentPrefixes(
  expression: Node,
  seen = new Set<string>(),
): readonly (readonly Node[])[] | null {
  const key = nodeKey(expression);
  if (seen.has(key)) return null;
  seen.add(key);
  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isSatisfiesExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return boundArgumentPrefixes(expression.getExpression(), seen);
  }
  if (
    Node.isFunctionDeclaration(expression) ||
    Node.isFunctionExpression(expression) ||
    Node.isArrowFunction(expression) ||
    Node.isMethodDeclaration(expression)
  ) return [[]];
  if (Node.isConditionalExpression(expression)) {
    const left = boundArgumentPrefixes(expression.getWhenTrue(), seen);
    const right = boundArgumentPrefixes(expression.getWhenFalse(), seen);
    return left && right ? [...left, ...right] : null;
  }
  if (Node.isBinaryExpression(expression)) {
    const operator = expression.getOperatorToken().getKind();
    if (operator === SyntaxKind.CommaToken) {
      return boundArgumentPrefixes(expression.getRight(), seen);
    }
    if (
      operator === SyntaxKind.AmpersandAmpersandToken ||
      operator === SyntaxKind.BarBarToken ||
      operator === SyntaxKind.QuestionQuestionToken
    ) {
      const left = boundArgumentPrefixes(expression.getLeft(), seen);
      const right = boundArgumentPrefixes(expression.getRight(), seen);
      return left && right ? [...left, ...right] : null;
    }
  }
  if (
    Node.isPropertyAccessExpression(expression) ||
    Node.isElementAccessExpression(expression)
  ) {
    const member = Node.isPropertyAccessExpression(expression)
      ? expression.getName()
      : invocationMember(expression);
    const values = fixedContainerValueSources(
      expression.getExpression(),
      member,
    );
    if (values.length > 0) {
      const prefixes = values.map((value) =>
        boundArgumentPrefixes(value, seen)
      );
      return prefixes.every(
        (candidate): candidate is readonly (readonly Node[])[] =>
          candidate !== null,
      )
        ? prefixes.flat()
        : null;
    }
  }
  if (Node.isCallExpression(expression)) {
    if (invocationMember(expression.getExpression()) === "bind") {
      const target = invocationReceiver(expression.getExpression());
      if (!target || !callTargetResolutionComplete(target)) return null;
      const targetPrefixes = boundArgumentPrefixes(target, seen);
      return targetPrefixes?.map((prefix) => [
        ...prefix,
        ...expression.getArguments().slice(1),
      ]) ?? null;
    }
    const providers = resolveCallTargets(expression.getExpression());
    const values = providers.flatMap(returnedValues);
    if (providers.length === 0 || values.length === 0) return null;
    const prefixes = values.map((value) =>
      boundArgumentPrefixes(value, seen)
    );
    return prefixes.every(
      (candidate): candidate is readonly (readonly Node[])[] =>
        candidate !== null,
    )
      ? prefixes.flat()
      : null;
  }
  const sources = assignedValueSources(expression);
  if (sources.length > 0) {
    const prefixes = sources.map((source) =>
      boundArgumentPrefixes(source, seen)
    );
    return prefixes.every(
      (candidate): candidate is readonly (readonly Node[])[] =>
        candidate !== null,
    )
      ? prefixes.flat()
      : null;
  }
  return resolveCallTargets(expression).length > 0 ? [[]] : null;
}

function invocationArgumentSets(
  call: CallExpression,
): readonly (readonly Node[])[] | null {
  const direct = directInvocationArguments(call);
  if (!direct) return null;
  const targets = invocationTargetExpressions(call);
  const prefixes = targets.map((target) =>
    boundArgumentPrefixes(target)
  );
  const effectivePrefixes = prefixes.map((prefix, index) => {
    if (prefix) return prefix;
    const target = targets[index];
    return target === call.getExpression() &&
        assignedValueSources(target).length === 0
      ? [[]]
      : null;
  });
  if (
    effectivePrefixes.length === 0 ||
    effectivePrefixes.some((prefix) => prefix === null)
  ) {
    return null;
  }
  return effectivePrefixes.flatMap((prefix) =>
    prefix!.map((bound) => [...bound, ...direct])
  );
}

function resolveCallTargetsForCall(call: CallExpression): Node[] {
  return invocationTargetExpressions(call).flatMap((target) =>
    resolveCallTargets(target)
  );
}

function callTargetResolutionCompleteForCall(call: CallExpression): boolean {
  const targets = invocationTargetExpressions(call);
  return targets.length > 0 &&
    targets.every((target) => callTargetResolutionComplete(target));
}

function governedSinksForCall(
  call: CallExpression,
  sinks: readonly GovernedSink[],
): GovernedSink[] {
  const targets = resolveCallTargetsForCall(call);
  return sinks.filter((sink) =>
    targets.some((declaration) =>
      sink.anchors.some((anchor) => nodeKey(declaration) === nodeKey(anchor))
    )
  );
}

/**
 * Does this call reach the entry's governed sink? Symbol-anchored, never text:
 * sink names are built as `owner.property`, which never equals the callee text
 * of `store.load(…)` or an aliased `repo.listClients(…)`, so a text comparison
 * fails permanently on CORRECTLY wired code and forces the first escape.
 */
function callMatchesSink(call: CallExpression, entry: GovernedRouteEntry): boolean {
  const expected = entry.sink.split(".").pop()!;
  const targets = resolveCallTargetsForCall(call);
  if (targets.length > 0) {
    return targets.some((declaration) =>
      declaration.getSymbol()?.getName() === expected &&
      (!entry.sinkFile ||
        normalizedPath(declaration.getSourceFile().getFilePath()) === entry.sinkFile)
    );
  }
  // An unresolvable callee (a fixture helper with no declaration) can only be
  // matched by name, and only when the entry pins no declaring file.
  const expression = call.getExpression();
  const text = Node.isPropertyAccessExpression(expression)
    ? expression.getName()
    : expression.getText();
  return !entry.sinkFile && text === expected;
}

function declaredAs(
  type: Type,
  file: string,
  name: string,
): boolean {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = typeKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const symbol of [current.getAliasSymbol(), current.getSymbol()]) {
      if (
        symbol?.getName() === name &&
        symbol.getDeclarations().some((declaration) =>
          normalizedPath(declaration.getSourceFile().getFilePath()) === file
        )
      ) {
        return true;
      }
    }
    queue.push(...current.getUnionTypes(), ...current.getIntersectionTypes());
  }
  return false;
}

function actionGrantParameter(
  type: Type,
  action: string,
): boolean {
  if (!declaredAs(type, "src/contracts/authz.ts", "ActionGrant")) return false;
  const actionProperty = type.getProperty("action");
  const declaration = actionProperty?.getValueDeclaration() ??
    actionProperty?.getDeclarations()[0];
  const actionType = declaration && actionProperty
    ? actionProperty.getTypeAtLocation(declaration)
    : null;
  return Boolean(actionType?.isStringLiteral() &&
    actionType.getLiteralValue() === action);
}

function governedOutputActions(type: Type): string[] {
  const actions = new Set<string>();
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = typeKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    if (declaredAs(current, "src/contracts/authz.ts", "GovernedOutput")) {
      const action = current.getTypeArguments()[0];
      if (action?.isStringLiteral()) {
        const value = action.getLiteralValue();
        if (typeof value === "string") actions.add(value);
      }
    }
    queue.push(
      ...current.getTypeArguments(),
      ...current.getUnionTypes(),
      ...current.getIntersectionTypes(),
      ...current.getBaseTypes(),
    );
    const symbol = current.getAliasSymbol() ?? current.getSymbol();
    const projectType = symbol?.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
    );
    if (!projectType) continue;
    for (const property of current.getProperties()) {
      const declaration = property.getValueDeclaration() ??
        property.getDeclarations()[0];
      if (declaration) queue.push(property.getTypeAtLocation(declaration));
    }
  }
  return [...actions];
}

/** The parameter POSITION of the sink's `ActionGrant<action>`, or null if it has none. */
function actionGrantParameterIndex(
  signature: Signature,
  action: string,
): number | null {
  const parameters = signature.getParameters();
  for (const [index, parameter] of parameters.entries()) {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    if (!declaration) continue;
    if (actionGrantParameter(parameter.getTypeAtLocation(declaration), action)) {
      return index;
    }
    const name = Node.isParameterDeclaration(declaration)
      ? declaration.getNameNode().getText()
      : parameter.getName();
    const nested = sealedAuthorityParameters(signature).some((authority) =>
      authority.kind === "grant" &&
      grantAction(authority) === action &&
      (authority.argument === name ||
        authority.argument.startsWith(`${name}.`) ||
        authority.argument.startsWith(`${name}[`))
    );
    if (nested) return index;
  }
  return null;
}

function actionGrantActions(signature: Signature): string[] {
  return [...new Set(sealedAuthorityParameters(signature)
    .filter((authority) => authority.kind === "grant")
    .map(grantAction)
    .filter((action): action is string =>
      action !== null && V3_15_3_ACTIONS.includes(action as never)
    ))];
}

function hasTenantBoundaryParameter(signature: Signature): boolean {
  return sealedAuthorityParameters(signature).length > 0 ||
    requiredAuthorityPrologue(signature).unfenceable.length > 0;
}

// A DML head, matched against a statement whose row-LOCK clause has been removed
// first. `SELECT … FOR UPDATE` — the idiom already live in house-crm.ts — is a
// read, and treating it as a write would silently drop that PII read out of
// governed-sink derivation. Anchoring at the statement start instead is not the
// answer either: `WITH d AS (DELETE FROM …) INSERT INTO …` is a genuine write
// whose first token is WITH, and a `/* … */`-prefixed statement is a write whose
// first token is a comment. So: strip comments and the lock clause, then look for
// a DML head anywhere in what remains.
const SQL_ROW_LOCK_SOURCE = /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b|\bFOR\s+(?:KEY\s+)?SHARE\b/
  .source;
const SQL_ROW_LOCK_RE = new RegExp(SQL_ROW_LOCK_SOURCE, "gi");
const SQL_ROW_LOCK_TEST = new RegExp(SQL_ROW_LOCK_SOURCE, "i");
const SQL_MUTATION_RE =
  /\b(?:INSERT\s+INTO|UPDATE\s+(?:ONLY\s+)?["\w]|DELETE\s+FROM|TRUNCATE\b)/i;
const SQL_READ_RE = /\bSELECT\b/i;

/**
 * The statements a SQL string issues, with comments and QUOTED VALUES removed. A
 * quoted value is data, not syntax: `WHERE detail = 'update household name'` is a
 * read, and matching a DML head inside it would hand that read a write exemption.
 */
function sqlStatements(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, " ? ")
    .split(";")
    .filter((statement) => statement.trim().length > 0);
}

type SqlKind = "mutation" | "locking-read" | "read" | "other";

const SQL_TOP_KEYWORD_RE = /^(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|MERGE|VALUES|TABLE)\b/i;

/**
 * What a statement RESULTS in, looking past any CTE list — the operation that
 * produces the caller's rows. Walks `name [(cols)] AS [NOT] [MATERIALIZED] ( … )`
 * groups by balancing parentheses (quoted values are already placeholders, so no
 * paren inside a literal is counted) until a top-level keyword is reached.
 */
function afterCteList(statement: string): string {
  let rest = statement.trim();
  if (!/^WITH\b/i.test(rest)) return rest;
  rest = rest.replace(/^WITH\s+(?:RECURSIVE\s+)?/i, "").trim();
  while (!SQL_TOP_KEYWORD_RE.test(rest)) {
    const open = rest.indexOf("(");
    if (open < 0) return rest;
    let depth = 0;
    let i = open;
    for (; i < rest.length; i += 1) {
      if (rest[i] === "(") depth += 1;
      else if (rest[i] === ")" && --depth === 0) break;
    }
    if (depth !== 0) return rest; // unbalanced (interpolated SQL) — stop walking
    rest = rest.slice(i + 1).replace(/^\s*,?\s*/, "");
  }
  return rest;
}

/**
 * A LOCKING read (`SELECT … FOR UPDATE`) belongs to the write that follows it —
 * that is the pre-image house-crm reads inside its update transaction. A PLAIN
 * read alongside a write is a second boundary, not part of the first.
 *
 * A statement can be BOTH: `WITH x AS (INSERT INTO pii_access_log …) SELECT … FROM
 * contacts` writes and RETURNS PII, so classifying it as "mutation" alone would let
 * a repository merge its audit INSERT into its PII read and collect the write-
 * boundary exemption for free. A read counts as its own boundary only when it is
 * what the statement returns: a subquery feeding DML (`INSERT … SELECT`, `DELETE …
 * WHERE id IN (SELECT …)`, `WITH d AS (DELETE …) INSERT …`) is the write's own input.
 */
function classifySql(statement: string): SqlKind[] {
  const kinds: SqlKind[] = [];
  if (SQL_MUTATION_RE.test(statement.replace(SQL_ROW_LOCK_RE, " "))) kinds.push("mutation");
  if (SQL_READ_RE.test(statement) && /^SELECT\b/i.test(afterCteList(statement))) {
    kinds.push(SQL_ROW_LOCK_TEST.test(statement) ? "locking-read" : "read");
  }
  return kinds.length > 0 ? kinds : ["other"];
}

/**
 * SQL text in the STATEMENT SLOT of a resolved SQL executor. Classifying from
 * the AST (not from declaration.getText(), and not from every string argument of
 * every call) is what keeps the write exemption from being one word wide: an
 * identifier named `update`, a `.update()` method call, prose saying "nothing to
 * update", and a `FOR UPDATE` row lock are all reads. A template's DELIMITERS are
 * stripped (getText() would hand the matcher a leading backtick) and its
 * interpolations become a placeholder, so an interpolated writer keeps its write
 * exemption instead of being demanded to hold a READ grant. A hoisted SQL
 * constant is read through its literal type, like any other statically-known text.
 */
function sqlStatementTexts(declaration: Node): string[] {
  return declaration.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(isSqlExecutorCall)
    .flatMap((call) => {
      const argument = normalizeSqlExecutorCall(call)?.arguments[0];
      if (!argument) return [];
      if (
        Node.isStringLiteral(argument) ||
        Node.isNoSubstitutionTemplateLiteral(argument)
      ) {
        return [argument.getLiteralValue()];
      }
      if (Node.isTemplateExpression(argument)) {
        return [
          argument.getHead().getLiteralText() +
          argument.getTemplateSpans()
            .map((span) => ` ? ${span.getLiteral().getLiteralText()}`)
            .join(""),
        ];
      }
      const type = argument.getType();
      return type.isStringLiteral() ? [String(type.getLiteralValue())] : [];
    });
}

/**
 * A callable is exempt from `pii.view` only when it is a WRITE boundary and
 * nothing else: it issues real DML, and every read it issues is the locking
 * pre-image read that write takes. "The body contains DML somewhere" was the
 * wrong question — it let a PII read buy its own exemption by writing an access
 * record first (`INSERT INTO pii_access_log …` then `SELECT … FROM households`),
 * so the more auditable the read, the less authorized it had to be. Calling
 * auditedWrite is deliberately NOT a mutation signal either, for the same reason;
 * genuine writers reach a DML statement anyway (house-CRM writers pass
 * INSERT/UPDATE to tx.query inside auditedWrite's `perform`).
 */
function mutatesPersistence(declaration: Node): boolean {
  const kinds = sqlStatementTexts(declaration)
    .flatMap(sqlStatements)
    .flatMap(classifySql);
  return kinds.includes("mutation") && !kinds.includes("read");
}

interface ExportedCallable {
  readonly name: string;
  readonly declaration: Node;
  readonly signature: Signature;
  readonly anchors: readonly Node[];
}

function semanticCallables(
  type: Type,
  owner: string,
  rootAnchors: readonly Node[],
): ExportedCallable[] {
  const callables: ExportedCallable[] = [];
  for (const signature of type.getCallSignatures()) {
    const declaration = signature.getDeclaration();
    callables.push({
      name: owner,
      declaration,
      signature,
      anchors: [...rootAnchors, declaration],
    });
  }
  for (const property of type.getProperties()) {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0];
    if (
      !declaration ||
      !normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
    ) continue;
    for (const signature of property.getTypeAtLocation(declaration).getCallSignatures()) {
      const signatureDeclaration = signature.getDeclaration();
      callables.push({
        name: `${owner}.${property.getName()}`,
        declaration: signatureDeclaration,
        signature,
        anchors: [...rootAnchors, declaration, signatureDeclaration],
      });
    }
  }
  return callables;
}

const GOVERNED_NON_PII_FIELDS = new Set([
  "src/infrastructure/observability/tracer.ts :: RecordedSpan.name",
]);

/**
 * An escape names ONE exact structural position. getFirstAncestorByKind reaches
 * THROUGH an inline nested type literal, so keying on it let the single reviewed
 * escape for a top-level machine-named field silently cover a same-named field
 * nested anywhere inside that declaration: adding `attributes: { name: string }` to
 * RecordedSpan would key to the identical string, report no exposure, and let an
 * exported callable returning it derive no pii.view sink at all. The property must
 * therefore be a DIRECT member of the named declaration, and the dotted path the
 * caller computed must actually end at it. The sibling rule in
 * llm-pii-boundary.test.ts is STRICTER still - it keys on the whole dotted path, so
 * it reaches through type literals a direct-member test simply never matches - and
 * both refuse the ancestor-keyed form this one used to have.
 */
function isGovernedNonPiiField(path: string, declaration: Node): boolean {
  if (!Node.isPropertyNamed(declaration)) return false;
  const owner = declaration.getParent();
  if (!owner || !Node.isInterfaceDeclaration(owner)) return false;
  const name = declaration.getName();
  if (!path.endsWith(`.${name}`)) return false;
  return GOVERNED_NON_PII_FIELDS.has(
    `${normalizedPath(declaration.getSourceFile().getFilePath())} :: ${owner.getName()}.${name}`,
  );
}

/**
 * An escape registry nobody checks is a registry that silently outlives what it
 * described. Each entry must still resolve to a real direct interface member AND
 * still be one this fence would otherwise flag - a key that stops matching stops
 * being reviewed, and one whose field is renamed to something PII-shaped would carry
 * the review forward onto a field nobody looked at.
 */
export function detectStaleGovernedNonPiiFields(project: Project): string[] {
  const out: string[] = [];
  for (const entry of GOVERNED_NON_PII_FIELDS) {
    const [file, member = ""] = entry.split(" :: ");
    const [owner = "", property = ""] = member.split(".");
    const sf = project.getSourceFiles().find((candidate) =>
      normalizedPath(candidate.getFilePath()) === file
    );
    const declared = sf?.getInterface(owner)?.getProperty(property);
    if (!declared) {
      out.push(`${entry}: reviewed non-PII escape no longer resolves to a direct interface member`);
      continue;
    }
    if (!isPIIField(property)) {
      out.push(`${entry}: reviewed non-PII escape is no longer needed - the field name is not PII-shaped`);
    }
  }
  return out;
}

function exportedCallables(sf: SourceFile): ExportedCallable[] {
  const callables: ExportedCallable[] = [];
  for (const fn of sf.getFunctions().filter((candidate) => candidate.isExported())) {
    const name = fn.getName();
    if (!name) continue;
    callables.push({
      name,
      declaration: fn,
      signature: fn.getSignature(),
      anchors: [fn],
    });
  }
  for (const variable of sf.getVariableDeclarations().filter((candidate) =>
    candidate.isExported()
  )) {
    // A repository annotated with its domain PORT (`export const repo:
    // ClientRepository = {…}`, the ports/adapters shape) resolves its members to
    // the port's MethodSignatures — which have no body, so the boundary check
    // would demand a grant assertion of a declaration that cannot hold one, and
    // the call-site match would compare the port path against the adapter's.
    // The initializer is where the implementation lives, so read that first.
    const initializer = variable.getInitializer();
    const type = initializer && Node.isObjectLiteralExpression(initializer)
      ? initializer.getType()
      : variable.getType();
    callables.push(
      ...semanticCallables(type, variable.getName(), [variable]),
    );
  }
  for (const cls of sf.getClasses().filter((candidate) => candidate.isExported())) {
    const owner = cls.getName() ?? "<anonymous>";
    for (const method of cls.getMethods()) {
      if (method.getScope() === "private" || method.getScope() === "protected") continue;
      callables.push({
        name: `${owner}.${method.getName()}`,
        declaration: method,
        signature: method.getSignature(),
        anchors: [method],
      });
    }
    // A class FIELD holding an arrow (`load = (grant) => …`) is a callable member
    // too; getMethods() returns only MethodDeclarations, so the arrow form would
    // yield no callable at all and the PII read behind it no sink.
    for (const property of cls.getProperties()) {
      if (property.getScope() === "private" || property.getScope() === "protected") continue;
      callables.push(
        ...semanticCallables(property.getType(), `${owner}.${property.getName()}`, [property]),
      );
    }
  }
  for (const assignment of sf.getExportAssignments()) {
    callables.push(
      ...semanticCallables(
        assignment.getExpression().getType(),
        "default",
        [assignment],
      ),
    );
  }
  const returned = callables.flatMap((callable) =>
    returnedCallableMembers(callable.declaration, callable.name).flatMap((member) =>
      member.signature
        ? [{
          name: member.name,
          declaration: member.declaration,
          signature: member.signature,
          anchors: [...callable.anchors, member.declaration],
        }]
        : []
    )
  );
  return [...callables, ...returned];
}

function unresolvedReturnedCallableViolations(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!file.startsWith("src/infrastructure/")) continue;
    for (const callable of exportedCallables(sf)) {
      for (const member of returnedCallableMembers(
        callable.declaration,
        callable.name,
        { failOpaqueReturn: true },
      )) {
        if (member.signature === null) {
          out.push(
            `${file} :: ${member.name}: returned callable implementation cannot be proven`,
          );
        }
      }
    }
  }
  return out;
}

/**
 * Both derivations below are a full type-checker pass over src/infrastructure/**,
 * and each is asked for several times per run (three sink derivations, two
 * unbounded-read passes in one assertion block). MEMOIZED per Project, the same
 * WeakMap shape the llm-pii-boundary fence uses for its file index: these fences only
 * READ the project, so one answer per project is the same answer every time.
 */
const GOVERNED_SINKS = new WeakMap<Project, GovernedSink[]>();
const UNBOUNDED_PII_READS = new WeakMap<Project, string[]>();

export function deriveGovernedSinks(project: Project): GovernedSink[] {
  const cached = GOVERNED_SINKS.get(project);
  if (cached) return cached;
  const sinks: GovernedSink[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!file.startsWith("src/infrastructure/")) continue;
    for (const callable of exportedCallables(sf)) {
      const grantActions = actionGrantActions(callable.signature);
      const outputActions = governedOutputActions(callable.signature.getReturnType());
      const returnsCallableMembers =
        returnedCallableMembers(callable.declaration, callable.name).length > 0;
      const returnsPii = structuralPiiExposures(
        callable.signature.getReturnType(),
        {
          path: `${callable.name}.return`,
          includeMarked: !returnsCallableMembers,
          opaqueIsExposure: grantActions.length === 0 && outputActions.length === 0,
          inspectCallSignatures: !returnsCallableMembers,
          isEscaped: isGovernedNonPiiField,
        },
      ).length > 0;
      const inferredAction = returnsPii &&
          hasTenantBoundaryParameter(callable.signature) &&
          !mutatesPersistence(callable.declaration)
          ? "pii.view"
          : null;
      for (const action of new Set([
        ...grantActions,
        ...outputActions,
        ...(inferredAction ? [inferredAction] : []),
      ])) {
        sinks.push({ file, action, ...callable });
      }
    }
  }
  GOVERNED_SINKS.set(project, sinks);
  return sinks;
}

/**
 * The `pii.view` inference above requires a TENANT BOUNDARY parameter, so an
 * exported repository that returns raw PII with neither a boundary nor a grant
 * derives NO sink at all — it needs no grant AND is invisible to the Server-Action /
 * unsupported-surface rule. That exemption is real (the identity boundary produces
 * the very Principal a grant is minted from; requiring a grant there is circular),
 * but it used to be IMPLICIT and carried no reason, unlike tenant-context-required's
 * REVIEWED_ESCAPES. It is now an exact-match `file :: name` registry with a required
 * `why`, DERIVED-complete both ways: a new unbounded PII read fails the build until
 * a human writes down why it cannot hold a grant, and an entry that stops matching
 * fails as stale.
 */
export const REVIEWED_PRE_AUTH_PII_READS: ReadonlyArray<{ callable: string; why: string }> = [
  {
    callable: "src/infrastructure/pii/scrub.ts :: scrub",
    why: "PII scrub boundary returns an opaque structural clone only after recursively redacting every sensitive field and value.",
  },
  {
    callable: "src/infrastructure/store/db.ts :: createDbFromDump",
    why: "global database capability factory; the opaque return is a SQL executor, not a tenant record, and repositories govern every data-returning method.",
  },
  {
    callable: "src/infrastructure/store/db.ts :: createDb",
    why: "global database capability factory; the opaque return is a SQL executor, not a tenant record, and repositories govern every data-returning method.",
  },
  {
    callable: "src/infrastructure/store/db.ts :: getDb",
    why: "global database capability factory; the opaque return is a SQL executor, not a tenant record, and repositories govern every data-returning method.",
  },
  {
    callable: "src/infrastructure/store/db.ts :: createMemoryDb",
    why: "test database capability factory; the opaque return is a SQL executor, not a tenant record, and repositories govern every data-returning method.",
  },
  {
    callable: "src/infrastructure/identity/identity-store.ts :: findUserByEmail",
    why: "pre-authentication: this lookup PRODUCES the row a Principal is minted from, and a pii.view grant is minted FROM a Principal — requiring one here is circular. Org-qualified login is a recorded deferral (Sable F3).",
  },
  {
    callable: "src/infrastructure/identity/identity-store.ts :: authenticate",
    why: "pre-authentication: the credential check itself. There is no authenticated identity to authorize until it returns.",
  },
  {
    callable: "src/infrastructure/identity/session.ts :: resolveSession",
    why: "pre-authorization: turns a session cookie into the Principal every grant derives from (read-only path, ADR-0008/D-030).",
  },
  {
    callable: "src/infrastructure/identity/session.ts :: resolveAndRenewSession",
    why: "pre-authorization: the renewing arm of the same session resolution — same circularity as resolveSession.",
  },
  {
    callable: "src/infrastructure/identity/session.ts :: requireRole",
    why: "not a read at all: a pure predicate over an ALREADY-authenticated Principal that touches no store and returns its own argument.",
  },
  {
    callable: "src/infrastructure/wire.ts :: resumeAccountOpeningByToken",
    why: "capability-keyed webhook resume: the unguessable e-sign token is the authority and the caller is a reserved system actor, not a human whose role could be checked.",
  },
  {
    callable: "src/infrastructure/wire.ts :: esignCallback",
    why: "the HMAC-verified wrapper around the same capability-keyed resume — it holds no human identity to authorize.",
  },
  {
    callable: "src/infrastructure/store/execution-store.ts :: makeExecutionStore.loadByToken",
    why: "capability-keyed webhook resume: the unguessable token selects one continuation before its tenant is known; resumeFlow rechecks the loaded tenant against the sealed system tenant.",
  },
  {
    callable: "src/infrastructure/ledger/ledger-schema-registry.ts :: parseRecordedLedgerEvent",
    why: "pure recorded-version parser over already-loaded immutable bytes; every repository that loads those bytes enforces its own tenant and action authority.",
  },
  {
    callable: "src/infrastructure/ledger/ledger-source-registry.ts :: parseRecordedReplaySource",
    why: "pure recorded-version parser over already-loaded immutable source bytes; every repository that loads those bytes enforces its own tenant and action authority.",
  },
];

/** `file :: name` for every exported infrastructure callable returning PII with no tenant boundary. */
export function unboundedPiiReads(project: Project): string[] {
  const cached = UNBOUNDED_PII_READS.get(project);
  if (cached) return cached;
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!file.startsWith("src/infrastructure/")) continue;
    for (const callable of exportedCallables(sf)) {
      const returnsCallableMembers =
        returnedCallableMembers(callable.declaration, callable.name).length > 0;
      if (
        actionGrantActions(callable.signature).length > 0 ||
        governedOutputActions(callable.signature.getReturnType()).length > 0 ||
        hasTenantBoundaryParameter(callable.signature) ||
        mutatesPersistence(callable.declaration) ||
        structuralPiiExposures(
          callable.signature.getReturnType(),
          {
            path: `${callable.name}.return`,
            includeMarked: !returnsCallableMembers,
            opaqueIsExposure: true,
            inspectCallSignatures: !returnsCallableMembers,
            isEscaped: isGovernedNonPiiField,
          },
        ).length === 0
      ) continue;
      out.push(`${file} :: ${callable.name}`);
    }
  }
  UNBOUNDED_PII_READS.set(project, out);
  return out;
}

export function detectUnreviewedPreAuthPiiReads(
  project: Project,
  reviewed: ReadonlyArray<{ callable: string; why: string }>,
): string[] {
  const found = new Set(unboundedPiiReads(project));
  const registered = new Set(reviewed.map((entry) => entry.callable));
  return [
    ...[...found].filter((callable) => !registered.has(callable)).map((callable) =>
      `${callable}: returns PII with no tenant boundary and no grant, so it derives NO governed sink — review it into REVIEWED_PRE_AUTH_PII_READS with the reason it cannot hold one`
    ),
    ...reviewed.filter((entry) => !found.has(entry.callable)).map((entry) =>
      `${entry.callable}: stale pre-auth PII escape — this callable is no longer an unbounded PII read`
    ),
    ...reviewed.filter((entry) => entry.why.trim().length === 0).map((entry) =>
      `${entry.callable}: pre-auth PII escape must carry a reason`
    ),
  ];
}

export function detectUnguardedGovernedSinks(project: Project): string[] {
  const out = unresolvedReturnedCallableViolations(project);
  const groups = new Map<string, GovernedSink[]>();
  for (const sink of deriveGovernedSinks(project)) {
    const key = `${sink.file}:${nodeKey(sink.declaration)}`;
    groups.set(key, [...(groups.get(key) ?? []), sink]);
  }
  for (const sinks of groups.values()) {
    const [sink] = sinks;
    if (!sink) continue;
    let missingGrant = false;
    for (const action of new Set(sinks.map((candidate) => candidate.action))) {
      const grant = sealedAuthorityParameters(sink.signature).find((authority) =>
        authority.kind === "grant" && grantAction(authority) === action
      );
      if (!grant) {
        missingGrant = true;
        out.push(
          `${sink.file} :: ${sink.name}: boundary must require ActionGrant<"${action}">`,
        );
      }
    }
    if (missingGrant) continue;
    const { required, captures, unfenceable } = requiredAuthorityPrologue(sink.signature);
    out.push(
      ...[
        ...unfenceable,
        ...authorityPrologueViolations(sink.declaration, required, captures),
      ].map((message) => `${sink.file} :: ${sink.name}: ${message}`),
    );
  }
  return out;
}

const APP_SURFACE_RE = /^src\/app\/.*\.tsx?$/;
// A root-level `src/app/route.ts` is a valid route handler; the previous form
// required a directory segment and silently excluded it.
const ROUTE_HANDLER_RE = /^src\/app\/(?:.*\/)?route\.tsx?$/;
// The App Router's reserved component file names. These render, they do not handle.
const RESERVED_COMPONENT_RE =
  /^(?:page|layout|template|default|error|global-error|loading|not-found)\.tsx?$/;

/**
 * THE UNSUPPORTED-SURFACE RULE. Per-action authorization runs through
 * requireActionGrant, which needs the NextRequest the framework handed the
 * surface (and calls requirePrincipal, which CANNOT run in a server component —
 * it writes a rotated session cookie). A Server Action is `(prevState, formData)`
 * and a page/layout has no request at all, so those surfaces can never satisfy
 * the hook. Rather than leave them silently unfenced OR demand a shape that does
 * not exist, reaching a governed sink from one is its own FAIL-CLOSED build
 * failure: move the sink behind a route handler. A request-less authorization
 * entry point is later architecture (ADR-0031 scope note), not a prompt-6 escape.
 *
 * The rule keys on what the surface IS — a "use server" module, a reserved
 * component file name, a default-exported component — never on "not named
 * route.ts". src/app/_server/context.ts is the standing proof that ordinary
 * (non-surface) modules live under src/app; one that takes the framework request
 * and wires the hook correctly satisfies this fence exactly like a route file.
 */
const UNSUPPORTED_SURFACE_RULE =
  "governed sinks are reachable only from a request-handling surface (src/app/**/route.ts " +
  "or a handler it delegates to): requireActionGrant needs the framework's NextRequest, " +
  "which a Server Action or server component never has";

function hasUseServerDirective(statements: readonly Statement[]): boolean {
  return statements.some((statement) => {
    if (!Node.isExpressionStatement(statement)) return false;
    const expression = statement.getExpression();
    return Node.isStringLiteral(expression) &&
      expression.getLiteralValue() === "use server";
  });
}

/** Why this surface can never satisfy requireActionGrant, or null if it can. */
function unsupportedSurfaceKind(sf: SourceFile, file: string): string | null {
  if (ROUTE_HANDLER_RE.test(file)) return null;
  if (
    hasUseServerDirective(sf.getStatements()) ||
    sf.getDescendantsOfKind(SyntaxKind.Block).some((block) =>
      hasUseServerDirective(block.getStatements())
    )
  ) {
    return "a Server Action";
  }
  const base = file.split("/").pop() ?? "";
  if (RESERVED_COMPONENT_RE.test(base)) return "an App Router component file";
  if (sf.getDefaultExportSymbol()) return "a default-exported component";
  return null;
}

interface AppHandler {
  readonly name: string;
  readonly body: Node;
  readonly parameters: ReadonlySet<string>;
}

/**
 * The exported handler a call sits inside — `export function GET` or
 * `export const GET = async (req) => …`.
 *
 * A route-local helper is NOT a different surface: `async function loadChain(db,
 * grant) { … }` called from GET is ordinary decomposition, and stopping the walk
 * at the first non-exported function rejected it with a remedy the author had
 * already followed. So an unexported enclosing function is resolved through the
 * exported handler that CALLS it, in this same file.
 */
function enclosingHandlerNames(call: CallExpression): string[] {
  let local: Node | null = null;
  for (const ancestor of call.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) {
      if (ancestor.isExported()) {
        const name = ancestor.getName();
        return name ? [name] : [];
      }
      local ??= ancestor;
      continue;
    }
    if (Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) {
      const declaration = ancestor.getParent();
      // A nested arrow (a withSpan callback) is still INSIDE its handler: keep
      // walking unless this arrow is itself the exported handler.
      if (Node.isVariableDeclaration(declaration)) {
        if (declaration.isExported()) return [declaration.getName()];
        local ??= declaration;
      }
    }
  }
  return local ? exportedHandlersCalling(local) : [];
}

/** True when `body` contains a call that resolves to the callable keyed `targetKey`. */
function invokesCallable(body: Node, targetKey: string): boolean {
  return body.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) =>
    resolveCallTargetsForCall(call).some((declaration) =>
      nodeKey(declaration) === targetKey || nodeKey(ownerOfCallable(declaration)) === targetKey
    )
  );
}

function ownerOfCallable(declaration: Node): Node {
  return Node.isFunctionDeclaration(declaration)
    ? declaration
    : declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration) ?? declaration;
}

/**
 * EVERY exported handler in this file that reaches `helper`, directly or through
 * another route-local helper — not the first one found. A helper shared by GET and
 * POST used to yield a single entry, so the second verb's authorization prologue
 * was never checked at all: the surface with the weaker prologue was the one that
 * silently dropped out.
 */
function exportedHandlersCalling(helper: Node, seen = new Set<string>()): string[] {
  const key = nodeKey(helper);
  if (seen.has(key)) return [];
  seen.add(key);
  const sf = helper.getSourceFile();
  const direct = exportedAppHandlers(sf)
    .filter((candidate) => invokesCallable(candidate.body, key))
    .map((candidate) => candidate.name);
  const indirect = routeLocalHelpers(sf)
    .filter((local) => nodeKey(local.declaration) !== key && invokesCallable(local.body, key))
    .flatMap((local) => exportedHandlersCalling(local.declaration, seen));
  return [...new Set([...direct, ...indirect])];
}

interface RouteLocalHelper {
  readonly declaration: Node;
  readonly body: Node;
  readonly parameters: readonly Node[];
}

/** The UNEXPORTED same-file callables a handler decomposes its route work into. */
function routeLocalHelpers(sf: SourceFile): RouteLocalHelper[] {
  const out: RouteLocalHelper[] = [];
  for (const fn of sf.getFunctions()) {
    const body = fn.getBody();
    if (!fn.isExported() && body) out.push({ declaration: fn, body, parameters: fn.getParameters() });
  }
  for (const variable of sf.getVariableDeclarations()) {
    const initializer = variable.getInitializer();
    if (
      !variable.isExported() && initializer &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ) {
      out.push({ declaration: variable, body: initializer.getBody(), parameters: initializer.getParameters() });
    }
  }
  return out;
}

function exportedAppHandlers(sf: SourceFile): Array<{ name: string; body: Node }> {
  const handlers: Array<{ name: string; body: Node }> = [];
  for (const fn of sf.getFunctions()) {
    const body = fn.getBody();
    const name = fn.getName();
    if (fn.isExported() && body && name) handlers.push({ name, body });
  }
  for (const variable of sf.getVariableDeclarations()) {
    const initializer = variable.getInitializer();
    if (
      variable.isExported() && initializer &&
      (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
    ) {
      handlers.push({ name: variable.getName(), body: initializer.getBody() });
    }
  }
  return handlers;
}

function appHandler(sf: SourceFile, name: string): AppHandler | null {
  const fn = sf.getFunction(name);
  const fnBody = fn?.getBody();
  if (fn && fnBody) {
    return fn.isExported()
      ? { name, body: fnBody, parameters: new Set(fn.getParameters().map((p) => p.getName())) }
      : null;
  }
  const variable = sf.getVariableDeclaration(name);
  const initializer = variable?.getInitializer();
  if (
    variable?.isExported() && initializer &&
    (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
  ) {
    return {
      name,
      body: initializer.getBody(),
      parameters: new Set(initializer.getParameters().map((p) => p.getName())),
    };
  }
  return null;
}

/**
 * A governed sink handed to ANOTHER function as a value —
 * `runReport(store, { load: listHouseholds })`. resolveCallTargets can follow a
 * sink through a local binding because the call site is still in this file; once
 * the sink crosses an argument boundary there is no call site to check, so the
 * whole authorization chain would apply to nothing. Refused outright.
 */
function detectEscapedGovernedSinks(
  sf: SourceFile,
  file: string,
  sinks: readonly GovernedSink[],
): string[] {
  const out: string[] = [];
  const valueTargets = (
    value: Node,
    seen = new Set<string>(),
  ): Node[] => {
    const direct = resolveCallTargets(value);
    return direct.flatMap((declaration) => {
      const key = nodeKey(declaration);
      if (seen.has(key)) return [];
      const nested = new Set(seen).add(key);
      return [
        declaration,
        ...returnedValues(declaration).flatMap((returned) =>
          valueTargets(returned, nested)
        ),
      ];
    });
  };
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const invokedArguments = new Set(
      invocationTargetExpressions(call).filter((target) =>
        call.getArguments().includes(target)
      ),
    );
    for (const argument of call.getArguments()) {
      if (invokedArguments.has(argument)) continue;
      const supplied = sinks.find((candidate) =>
        valueTargets(argument).some((declaration) =>
          candidate.anchors.some((anchor) =>
            nodeKey(declaration) === nodeKey(anchor)
          )
        )
      );
      if (supplied) {
        out.push(
          `${file}:${argument.getStartLineNumber()}: governed sink '${supplied.name}' is passed as a VALUE — it has no call site this fence can authorize`,
        );
        continue;
      }
      for (const node of [argument, ...argument.getDescendants()]) {
        if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node)) continue;
        const parent = node.getParent();
        // Invoked right here (`f(() => sink(…))`, `f(sink(…))`), or the `.name`
        // half of a property access whose whole expression is checked separately.
        if (Node.isCallExpression(parent) && parent.getExpression() === node) continue;
        if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) continue;
        // The RECEIVER of a method that is invoked right here: `withSpan("…", () =>
        // repo.listClients(grant))` calls the sink at this very site, so it has a
        // call site to authorize — it has not escaped. Without this, the object-bag
        // repository shape could not be called from inside ANY callback argument.
        if (
          Node.isPropertyAccessExpression(parent) &&
          parent.getExpression() === node
        ) {
          const invocation = parent.getParent();
          if (
            Node.isCallExpression(invocation) &&
            invocation.getExpression() === parent
          ) continue;
        }
        const targets = resolveCallTargets(node);
        const sink = sinks.find((candidate) =>
          targets.some((declaration) =>
            candidate.anchors.some((anchor) => nodeKey(declaration) === nodeKey(anchor))
          )
        );
        if (sink) {
          out.push(
            `${file}:${node.getStartLineNumber()}: governed sink '${sink.name}' is passed as a VALUE — it has no call site this fence can authorize`,
          );
        }
      }
    }
  }
  return [...new Set(out)];
}

export function discoverGovernedRoutes(
  project: Project,
): { entries: GovernedRouteEntry[]; violations: string[] } {
  const entries: GovernedRouteEntry[] = [];
  const violations: string[] = [];
  const sinks = deriveGovernedSinks(project);
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    // EVERY app-layer surface, not just route.ts: Server Actions
    // (src/app/login/actions.ts) and server components are App Router surfaces
    // that can call a governed sink, and an unscanned surface class is an
    // unfenced one.
    if (!APP_SURFACE_RE.test(file) || file.includes("/__tests__/")) continue;
    const unsupported = unsupportedSurfaceKind(sf, file);
    violations.push(...detectEscapedGovernedSinks(sf, file, sinks));
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callSinks = governedSinksForCall(call, sinks);
      if (
        callSinks.length > 0 &&
        !callTargetResolutionCompleteForCall(call)
      ) {
        violations.push(
          `${file}:${call.getStartLineNumber()}: governed callee has an unresolved value-producing arm`,
        );
      }
      for (const sink of callSinks) {
        if (unsupported) {
          violations.push(
            `${file}:${call.getStartLineNumber()}: governed sink '${sink.name}' on an unsupported surface (${unsupported}) - ${UNSUPPORTED_SURFACE_RULE}`,
          );
          continue;
        }
        const handlers = enclosingHandlerNames(call);
        if (handlers.length === 0) {
          violations.push(
            `${file}:${call.getStartLineNumber()}: governed sink '${sink.name}' must be called inside an exported app-surface handler`,
          );
          continue;
        }
        for (const handler of handlers) {
          entries.push({
            file,
            handler,
            action: sink.action,
            sink: sink.name,
            sinkFile: sink.file,
            grantIndex: actionGrantParameterIndex(sink.signature, sink.action),
          });
        }
      }
    }
  }
  return {
    entries: entries.filter((entry, index) =>
      entries.findIndex((candidate) =>
        candidate.file === entry.file &&
        candidate.handler === entry.handler &&
        candidate.action === entry.action &&
        candidate.sink === entry.sink &&
        candidate.sinkFile === entry.sinkFile
      ) === index
    ),
    violations,
  };
}

function governedTestProject(route: string): Project {
  return inMemoryProject({
    "/src/app/_server/context.ts": `
      export async function requireActionGrant(req: Request, action: string): Promise<any> {
        return { ok: true };
      }
      export function errorResponse(error: unknown): Response {
        return new Response();
      }
    `,
    "/src/app/api/audit/route.ts": `
      import { requireActionGrant, errorResponse } from "@app/_server/context";
      ${route}
    `,
  });
}

function governedDiscoveryProject(route: string): Project {
  return inMemoryProject({
    "/src/app/_server/context.ts": `
      export async function requireActionGrant(req: Request, action: string): Promise<any> {
        return { ok: true };
      }
      export function errorResponse(error: unknown): Response {
        return new Response();
      }
    `,
    "/src/contracts/authz.ts": `
      export interface ActionGrant<A extends string> { action: A }
      export function assertActionGrant<A extends string>(
        value: unknown,
        action: A,
      ): asserts value is ActionGrant<A> {
        void value;
        void action;
      }
    `,
    "/src/infrastructure/audit/audit-store.ts": `
      import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
      export function verifyAndListOrgChain(
        db: unknown,
        grant: ActionGrant<"audit.export">,
      ): unknown {
        assertActionGrant(grant, "audit.export");
        return { db, grant };
      }
    `,
    "/src/app/api/other/route.ts": route,
  });
}

interface AuthBinding {
  readonly action: string;
  readonly variable: string;
  readonly declaration: Node;
}

function authDeclaration(
  statement: Statement,
  handlerParameters: ReadonlySet<string>,
): AuthBinding | null {
  if (!Node.isVariableStatement(statement)) return null;
  const declarations = statement.getDeclarations();
  if (declarations.length !== 1) return null;
  const declaration = declarations[0]!;
  let initializer = declaration.getInitializer();
  if (initializer && Node.isAwaitExpression(initializer)) {
    initializer = initializer.getExpression();
  }
  if (
    !initializer ||
    !Node.isCallExpression(initializer) ||
    !callResolvesTo(
      initializer,
      "src/app/_server/context.ts",
      "requireActionGrant",
    )
  ) {
    return null;
  }
  const args = initializer.getArguments();
  // The request must be the one the FRAMEWORK handed this surface (a parameter
  // of the handler), not a name that merely reads "req" — a Server Action with
  // no request parameter therefore cannot satisfy the hook by inventing one.
  const request = args[0];
  const action = args[1];
  if (
    !request ||
    !Node.isIdentifier(request) ||
    !handlerParameters.has(request.getText()) ||
    !action ||
    !Node.isStringLiteral(action)
  ) {
    return null;
  }
  return {
    action: action.getLiteralValue(),
    variable: declaration.getName(),
    declaration,
  };
}

/**
 * The handler's authorization PROLOGUE: consecutive (bind, fail-closed guard)
 * pairs at the very top of the body, before any route work. A surface may need
 * more than one authority — the audit export reads the chain under
 * `audit.export` AND resolves actor emails under `pii.view` — so the shape is a
 * sequence, not a single pair; the "before any route work" property is what the
 * prologue preserves, since the first non-authorization statement ends it.
 */
function readAuthorizationPrologue(
  statements: readonly Statement[],
  handlerParameters: ReadonlySet<string>,
): { bindings: AuthBinding[]; unguarded: AuthBinding | null; length: number } {
  const bindings: AuthBinding[] = [];
  let index = 0;
  while (index < statements.length) {
    const bound = authDeclaration(statements[index]!, handlerParameters);
    if (!bound) break;
    const guard = statements[index + 1];
    if (!guard || !isFailClosedGuard(guard, bound.variable)) {
      return { bindings, unguarded: bound, length: index };
    }
    bindings.push(bound);
    index += 2;
  }
  return { bindings, unguarded: null, length: index };
}

function isFailClosedGuard(statement: Statement, variable: string): boolean {
  if (!Node.isIfStatement(statement)) return false;
  const condition = statement.getExpression().getText().replace(/[\s()]/g, "");
  if (condition !== `!${variable}.ok`) return false;
  const thenStatement = statement.getThenStatement();
  // A DIRECT statement of the then-branch only. A return buried in a nested
  // function never executes, so accepting one would report an unauthorized
  // request's route as fail-closed while it proceeds.
  const returns = Node.isReturnStatement(thenStatement)
    ? [thenStatement]
    : Node.isBlock(thenStatement)
    ? thenStatement.getStatements().filter(Node.isReturnStatement)
    : [];
  return returns.some((node) => {
    const expression = node.getExpression();
    return Node.isCallExpression(expression) &&
      callResolvesTo(
        expression,
        "src/app/_server/context.ts",
        "errorResponse",
      ) &&
      expression.getArguments()[0]?.getText() === `${variable}.error`;
  });
}

export function detectUnwiredGovernedRoutes(
  project: Project,
  entries: ReadonlyArray<GovernedRouteEntry>,
): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const sf = project.getSourceFiles().find((f) =>
      normalizedPath(f.getFilePath()) === entry.file
    );
    if (!sf) {
      out.push(`${entry.file}: file missing (surfaced action '${entry.action}' has no route)`);
      continue;
    }
    const handler = appHandler(sf, entry.handler);
    if (!handler) {
      out.push(`${entry.file}: exported ${entry.handler} handler missing`);
      continue;
    }
    const body = handler.body;
    if (!Node.isBlock(body)) {
      out.push(`${entry.file} :: ${entry.handler}: handler body must be a block`);
      continue;
    }
    const statements = body.getStatements();
    const prologue = readAuthorizationPrologue(statements, handler.parameters);
    const auth = prologue.bindings.find((binding) => binding.action === entry.action);
    if (!auth) {
      out.push(
        prologue.unguarded?.action === entry.action
          ? `${entry.file} :: ${entry.handler}: authorization result must be fail-closed before route work`
          : `${entry.file} :: ${entry.handler}: authorization prologue must bind requireActionGrant(req, "${entry.action}") before any route work`,
      );
      continue;
    }
    // Authorization is tracked by SYMBOL, never by identifier text: a
    // client-supplied `body.value.grant` contains an identifier spelled "grant",
    // and a text match would report the route as wired while that value reaches
    // the sink. The grant declaration itself counts only THROUGH `.value` — a
    // bare `auth`, `auth.error`, or `auth.valueOf()` is not the authorized payload.
    const authKey = nodeKey(auth.declaration);
    const derivedKeys = new Set<string>();
    const declarationKeys = (node: Node): string[] => {
      const symbol = node.getSymbol();
      const target = symbol?.getAliasedSymbol() ?? symbol;
      return (target?.getDeclarations() ?? []).map(nodeKey);
    };
    const unwrap = (node: Node): Node =>
      Node.isParenthesizedExpression(node) || Node.isAsExpression(node) ||
        Node.isNonNullExpression(node) || Node.isAwaitExpression(node) ||
        Node.isSatisfiesExpression(node) || Node.isTypeAssertion(node)
        ? unwrap(node.getExpression())
        : node;
    /**
     * The value IS the authorized payload — never merely mentions it. "Contains a
     * reference to auth.value somewhere in the subtree" launders a client-supplied
     * grant by putting the two side by side: `pickGrant(auth.value,
     * body.value.grant)` and `{ ...body.value.grant, tag: auth.value }` both
     * mention the authorization while handing the sink the client's value.
     */
    const isAuthorizedValue = (node: Node): boolean => {
      const value = unwrap(node);
      if (Node.isIdentifier(value)) {
        return declarationKeys(value).some((key) => derivedKeys.has(key));
      }
      if (
        !Node.isPropertyAccessExpression(value) &&
        !Node.isElementAccessExpression(value)
      ) {
        return false;
      }
      const receiver = unwrap(value.getExpression());
      // `auth.value` is the authorized payload; a further PROJECTION of it
      // (`auth.value.grant.tenant`) is still server-derived. A bare `auth`,
      // `auth.error`, or `auth.valueOf()` is not.
      if (
        Node.isPropertyAccessExpression(value) && value.getName() === "value" &&
        Node.isIdentifier(receiver) && declarationKeys(receiver).includes(authKey)
      ) {
        return true;
      }
      return isAuthorizedValue(receiver);
    };
    // A destructured name resolves to its BindingElement, a different node from
    // the VariableDeclaration, so both must be marked — otherwise the ordinary
    // `const { tenant, writeActor } = auth.value;` refactor is reported as never
    // reaching the sink. Descendants, not just top-level statements, so a binding
    // made inside a block or a `try` is tracked too.
    const markDerived = (declaration: Node): void => {
      derivedKeys.add(nodeKey(declaration));
      for (const element of declaration.getDescendantsOfKind(SyntaxKind.BindingElement)) {
        derivedKeys.add(nodeKey(element));
      }
    };
    const routeWork = statements.slice(prologue.length);
    for (const statement of routeWork) {
      for (const declaration of statement.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        const initializer = declaration.getInitializer();
        if (!initializer) continue;
        if (isAuthorizedValue(initializer)) {
          markDerived(declaration);
          continue;
        }
        // `const { value: grant } = auth;` — the authorized payload reached
        // through destructuring rather than through a `.value` access.
        const name = declaration.getNameNode();
        if (
          !Node.isObjectBindingPattern(name) ||
          !declarationKeys(initializer).includes(authKey)
        ) continue;
        for (const element of name.getElements()) {
          const property = element.getPropertyNameNode()?.getText() ?? element.getName();
          if (property === "value") markDerived(element);
        }
      }
    }
    /**
     * Route work may be DECOMPOSED into same-file helpers, and enclosingHandlerNames
     * deliberately attributes a sink called inside one to this handler — so the
     * wiring check has to follow it there. Searching only the handler's own
     * statements reported the shape the fence documents as SUPPORTED as "authorized
     * value does not reach the ActionGrant parameter", i.e. it failed correct code.
     *
     * Authorization travels by ARGUMENT POSITION, and a parameter counts as
     * authorized only when EVERY call site THIS handler reaches passes an authorized
     * value there — one unauthorized call site cannot launder the parameter for the
     * others. Scoping to this handler's reachable work is what keeps a second verb
     * sharing the helper from either excusing or contaminating this one: that verb
     * is its own entry, checked against its own prologue.
     */
    const helpers = routeLocalHelpers(sf);
    const helperOfCall = (call: CallExpression): RouteLocalHelper | undefined =>
      resolveCallTargetsForCall(call)
        .flatMap((target) =>
          helpers.filter((candidate) =>
            nodeKey(candidate.declaration) === nodeKey(target) ||
            nodeKey(candidate.declaration) === nodeKey(ownerOfCallable(target))
          )
        )[0];
    const reachable: Node[] = [...routeWork];
    const reached: RouteLocalHelper[] = [];
    for (let index = 0; index < reachable.length; index += 1) {
      for (const call of reachable[index]!.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const helper = helperOfCall(call);
        if (!helper || reached.includes(helper)) continue;
        reached.push(helper);
        reachable.push(helper.body);
      }
    }
    const reachableCalls = reachable.flatMap((node) =>
      node.getDescendantsOfKind(SyntaxKind.CallExpression)
    );
    // Fixpoint: authorization chains through nested helpers (handler → A(grant) → B(a)).
    for (let pass = 0; pass <= reached.length; pass += 1) {
      let changed = false;
      for (const helper of reached) {
        const sites = reachableCalls.filter((call) => helperOfCall(call) === helper);
        helper.parameters.forEach((parameter, position) => {
          if (derivedKeys.has(nodeKey(parameter))) return;
          const authorizedEverywhere = sites.length > 0 && sites.every((site) => {
            const argumentSets = invocationArgumentSets(site);
            return Boolean(
              argumentSets &&
              argumentSets.length > 0 &&
              argumentSets.every((arguments_) => {
                const argument = arguments_[position];
                return Boolean(argument && isAuthorizedValue(argument));
              }),
            );
          });
          if (authorizedEverywhere) {
            markDerived(parameter);
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    const sinkCalls = reachableCalls.filter((call) => callMatchesSink(call, entry));
    const carriesGrant = (call: CallExpression): boolean => {
      const argumentSets = invocationArgumentSets(call);
      if (!argumentSets || argumentSets.length === 0) return false;
      return argumentSets.every((args) => {
        if (entry.grantIndex === undefined || entry.grantIndex === null) {
          return args.some(isAuthorizedValue);
        }
        const grantArgument = args[entry.grantIndex];
        return Boolean(grantArgument && isAuthorizedValue(grantArgument));
      });
    };
    // EVERY call site, not one of them. Entries are deduped per (file, handler,
    // sink), so N calls to the same sink collapse to one entry — an existential
    // check let a single conforming call clear an unauthorized second one.
    const unauthorized = sinkCalls.filter((call) => !carriesGrant(call));
    if (sinkCalls.length === 0 || unauthorized.length > 0) {
      const where = unauthorized[0]
        ? ` (line ${unauthorized[0].getStartLineNumber()})`
        : "";
      out.push(
        `${entry.file} :: ${entry.handler}: authorized value does not reach the ActionGrant parameter of '${entry.sink}'${where}`,
      );
    }
  }
  return out;
}

describe("governed-actions fence (v3 §15.3)", () => {
  it("enforces: the registry covers exactly the eight actions of the seven v3 §15.3 permission points", () => {
    expect(Object.keys(GOVERNED_ACTIONS).sort()).toEqual([...V3_15_3_ACTIONS].sort());
  });

  it("enforces: every allowlist is non-empty and made of real roles", () => {
    for (const [action, allowed] of Object.entries(GOVERNED_ACTIONS)) {
      expect(allowed.length, `${action} has an empty allowlist`).toBeGreaterThan(0);
      for (const role of allowed) expect(ROLES, `${action} names unknown role '${role}'`).toContain(role);
    }
  });

  it("enforces: separation of duties — compliance authority excludes admin and advisor (D-036)", () => {
    for (const action of ["policy.approve", "decision.override"] as const) {
      expect(GOVERNED_ACTIONS[action], `${action} must not include the IT-admin role`).not.toContain("admin");
      expect(GOVERNED_ACTIONS[action], `${action} must not include the requesting advisor role`).not.toContain("advisor");
    }
    expect(GOVERNED_ACTIONS["decision.approve"], "decision.approve must not include the requesting advisor role").not.toContain("advisor");
  });

  it("enforces: every PII read outside a tenant boundary is REVIEWED, with the reason it cannot hold a grant", () => {
    const project = realSemanticProject();
    const violations = detectUnreviewedPreAuthPiiReads(project, REVIEWED_PRE_AUTH_PII_READS);
    expect(violations, violations.join("\n")).toEqual([]);
    // Non-vacuity: the registry has to be SUPPRESSING something, and exactly the
    // shipped set — an empty registry checked against an empty derivation proves
    // nothing (charter #4).
    expect(unboundedPiiReads(project).length).toBeGreaterThan(0);
    expect([...REVIEWED_PRE_AUTH_PII_READS].map((e) => e.callable).sort())
      .toEqual(unboundedPiiReads(project).sort());
  });

  it("enforces: every reviewed non-PII field escape still resolves and is still needed", () => {
    const stale = detectStaleGovernedNonPiiFields(realSemanticProject());
    expect(stale, stale.join("\n")).toEqual([]);
    expect(GOVERNED_NON_PII_FIELDS.size, "an empty registry proves nothing").toBeGreaterThan(0);
  });

  it("enforces: structural non-PII field escapes are exact and load-bearing", () => {
    const project = realSemanticProject();
    const recordedSpan = project.getSourceFileOrThrow(
      `${REPO_ROOT}src/infrastructure/observability/tracer.ts`,
    ).getInterfaceOrThrow("RecordedSpan");
    expect(structuralPiiExposures(recordedSpan.getType(), {
      path: "RecordedSpan",
    })).toContain("RecordedSpan.name");
    expect(structuralPiiExposures(recordedSpan.getType(), {
      path: "RecordedSpan",
      isEscaped: isGovernedNonPiiField,
    })).not.toContain("RecordedSpan.name");
  });

  it("enforces: governed sinks validate action-scoped grants at their execution boundaries", () => {
    const violations = detectUnguardedGovernedSinks(realSemanticProject());
    expect(
      violations,
      `unguarded governed sinks:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("enforces: no app-layer module issues raw SQL (it would escape sink derivation entirely)", () => {
    const violations = detectAppLayerSqlAccess(realSemanticProject());
    expect(
      violations,
      `app-layer persistence access:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("enforces: the derived sink set is real (a collapsed derivation would pass vacuously — charter #4)", () => {
    const sinks = deriveGovernedSinks(realSemanticProject());
    expect(sinks.length, "governed-sink derivation found nothing").toBeGreaterThanOrEqual(3);
    // The two PII reads that must never lose their grant: the household listing
    // and the audit export's actor-email resolution.
    for (const name of ["listHouseholds", "listOrgUserEmails"]) {
      expect(sinks.some((sink) => sink.name === name), name).toBe(true);
    }
    expect(
      sinks
        .filter((sink) => sink.name === "startAccountOpening")
        .map((sink) => sink.action)
        .sort(),
    ).toEqual(["execution.initiate", "pii.view"]);
  });

  it("enforces: every surfaced governed action is wired through requireActionGrant in its route", () => {
    const project = realSemanticProject();
    const discovered = discoverGovernedRoutes(project);
    expect(
      discovered.violations,
      `invalid governed sink call sites:\n${discovered.violations.join("\n")}`,
    ).toEqual([]);
    expect(discovered.entries.length).toBeGreaterThanOrEqual(3);
    expect(
      discovered.entries.every((entry) =>
        V3_15_3_ACTIONS.includes(entry.action as never)
      ),
    ).toBe(true);
    expect(
      discovered.entries
        .filter((entry) => entry.sink === "startAccountOpening")
        .map((entry) => entry.action)
        .sort(),
    ).toEqual(["execution.initiate", "pii.view"]);
    const unwired = detectUnwiredGovernedRoutes(project, discovered.entries);
    expect(unwired, `unwired governed routes:\n${unwired.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): an unwired or miswired route is caught", () => {
    it("flags a route that never calls requireActionGrant", () => {
      const project = governedTestProject(
        `export async function GET(req: Request) { return listEverything(); }`,
      );
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v.length).toBe(1);
    });
    it("flags a route wired to the WRONG action literal", () => {
      // A COMPLETE, fail-closed prologue that binds the wrong action, and a sink
      // call carrying its grant: everything except the action matches, so only the
      // action comparison can produce the violation. Without the guard the route
      // would fail for a different reason and the test would pass vacuously.
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "pii.view");
          if (!auth.ok) return errorResponse(auth.error);
          return listEverything(db, auth.value);
        }`);
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything", grantIndex: 1 }]);
      expect(v).toEqual([
        `src/app/api/audit/route.ts :: GET: authorization prologue must bind requireActionGrant(req, "audit.export") before any route work`,
      ]);
    });
    it("accepts route work DECOMPOSED into a same-file helper the grant is passed to", () => {
      const project = governedTestProject(`
          async function loadChain(db: unknown, grant: unknown) {
            return listEverything(db, grant);
          }
          export async function GET(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return loadChain(await getDb(), auth.value.grant);
          }
        `);
      // The documented-supported shape: the sink lives in the helper, the authorized
      // value reaches it through the helper's parameter. Searching only the handler's
      // own statements reported this correct wiring as unauthorized.
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything", grantIndex: 1 },
      ])).toEqual([]);
    });

    it("flags a same-file helper whose grant argument is CLIENT-supplied, not the authorized value", () => {
      const project = governedTestProject(`
          async function loadChain(db: unknown, grant: unknown) {
            return listEverything(db, grant);
          }
          export async function GET(req: Request) {
            const body: any = await req.json();
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return loadChain(await getDb(), body.grant);
          }
        `);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything", grantIndex: 1 },
      ])).toHaveLength(1);
    });

    it("checks EVERY verb that reaches a shared helper, not just the first", () => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        import { requireActionGrant, errorResponse } from "@app/_server/context";
        async function loadChain(db: unknown, grant: any) {
          return verifyAndListOrgChain(db, grant);
        }
        export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return loadChain({}, auth.value.grant);
        }
        export async function POST(req: Request) {
          return loadChain({}, req);
        }
      `);
      // Discovery must attribute the shared helper's sink to BOTH verbs — returning
      // only the first left POST's prologue entirely unchecked.
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.entries.map((entry) => entry.handler).sort()).toEqual(["GET", "POST"]);
      const violations = detectUnwiredGovernedRoutes(project, discovered.entries);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain(":: POST:");
    });

    it("follows a helper called by another helper (nested decomposition)", () => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        import { requireActionGrant, errorResponse } from "@app/_server/context";
        async function readChain(db: unknown, grant: any) {
          return verifyAndListOrgChain(db, grant);
        }
        async function loadChain(db: unknown, grant: any) {
          return readChain(db, grant);
        }
        export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return loadChain({}, auth.value.grant);
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries.map((entry) => entry.handler)).toEqual(["GET"]);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toEqual([]);
    });

    it("flags a DELETED route file for a surfaced action", () => {
      const project = inMemoryProject({});
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v[0]).toContain("file missing");
    });
    it("flags authorization placed after data access", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const db = await getDb();
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return list(db, auth.value.grant.tenant);
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "list" },
      ])).toHaveLength(1);
    });
    it("flags a call in another HTTP verb", () => {
      const project = governedTestProject(`
          export async function POST(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return use(auth.value);
          }
          export async function GET(req: Request) { return listEverything(); }
        `);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("flags an ignored authorization result", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return listEverything();
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("flags a superficial authorization reference that does not reach the governed sink", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          void auth.value;
          return listEverything();
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("discovers a new route calling a governed sink without a manual surface entry", () => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        export async function GET(req: Request) {
          return verifyAndListOrgChain({}, {});
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.entries).toEqual([
        {
          file: "src/app/api/other/route.ts",
          handler: "GET",
          action: "audit.export",
          sink: "verifyAndListOrgChain",
          sinkFile: "src/infrastructure/audit/audit-store.ts",
          grantIndex: 1,
        },
      ]);
      expect(
        detectUnwiredGovernedRoutes(project, discovered.entries),
      ).toHaveLength(1);
    });
    it("rejects a governed sink that accepts only tenant scope", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `
          export interface PIIBearing { readonly pii?: "bearing" }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/contracts/authz.ts": `
          export interface ActionGrant<A extends string> { action: A }
          export function assertActionGrant<A extends string>(
            value: unknown,
            action: A,
          ): asserts value is ActionGrant<A> {
            void value;
            void action;
          }
        `,
        "/src/infrastructure/crm/house-crm.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Household extends PIIBearing { name: string }
          export function listHouseholds(
            db: unknown,
            tenant: TenantContext,
          ): Household[] {
            return [{ name: tenant.orgId }];
          }
        `,
        "/src/infrastructure/wire.ts": `
          import { assertActionGrant, type ActionGrant } from "../contracts/authz";
          export function startAccountOpening(
            db: unknown,
            grant: ActionGrant<"execution.initiate">,
          ): unknown {
            assertActionGrant(grant, "execution.initiate");
            return db;
          }
        `,
        "/src/infrastructure/audit/audit-store.ts": `
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          export function listOrgChain(
            db: unknown,
            grant: ActionGrant<"audit.export">,
          ): unknown {
            assertActionGrant(grant, "audit.export");
            return db;
          }
          export function verifyAndListOrgChain(
            db: unknown,
            grant: ActionGrant<"audit.export">,
          ): unknown {
            assertActionGrant(grant, "audit.export");
            return db;
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/crm/house-crm.ts :: listHouseholds: boundary must require ActionGrant<"pii.view">`,
      ]);
    });
    it("derives PII read sinks from semantic return types", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `
          export interface PIIBearing { readonly pii?: "bearing" }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface ClientRecord extends PIIBearing { fullName: string }
          export async function loadClients(
            tenant: TenantContext,
          ): Promise<ClientRecord[]> {
            return [{ fullName: tenant.orgId }];
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/new-adapter/repository.ts :: loadClients: boundary must require ActionGrant<"pii.view">`,
      ]);
    });
    it("requires the same-tenant proof when the tenant arrives WRAPPED in an object", () => {
      // `tenantParameterName` used to match only a parameter whose OWN type is a
      // TenantContext, so wrapping it dropped both the tenant assertion and the
      // same-tenant proof from a pii.view sink - the two authorities could then name
      // different scopes with nothing noticing. The prologue is now derived by the
      // SHARED rule the tenant-scope fence uses, so the two cannot disagree.
      const sink = (body: string): string[] =>
        detectUnguardedGovernedSinks(inMemoryProject({
          "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
          "/src/contracts/tenant.ts": `
            export interface TenantContext { orgId: string }
            export function assertTenantContext(v: unknown): asserts v is TenantContext { void v; }
            export function assertSameTenant(a: unknown, b: unknown): void { void a; void b; }
          `,
          "/src/contracts/authz.ts": `
            import type { TenantContext } from "./tenant";
            export interface ActionGrant<A extends string> { action: A; tenant: TenantContext }
            export function assertActionGrant<A extends string>(v: unknown, a: A): asserts v is ActionGrant<A> {
              void v; void a;
            }
          `,
          "/src/infrastructure/new-adapter/repository.ts": `
            import type { PIIBearing } from "../../contracts/pii";
            import { assertSameTenant, assertTenantContext, type TenantContext } from "../../contracts/tenant";
            import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
            interface ClientRecord extends PIIBearing { fullName: string }
            export function loadClients(
              ctx: { tenant: TenantContext },
              grant: ActionGrant<"pii.view">,
            ): ClientRecord[] {
${body}
              return [{ fullName: tenant.orgId }];
            }
          `,
        }));
      expect(sink(`
              const tenant = ctx.tenant;
              assertTenantContext(tenant);
              assertActionGrant(grant, "pii.view");`).length).toBeGreaterThan(0);
      expect(sink(`
              const tenant = ctx.tenant;
              assertTenantContext(tenant);
              assertActionGrant(grant, "pii.view");
              assertSameTenant(tenant, grant.tenant);`)).toEqual([]);
      // ...and the action compares as a VALUE, so the other quote style is fine.
      expect(sink(`
              const tenant = ctx.tenant;
              assertTenantContext(tenant);
              assertActionGrant(grant, 'pii.view');
              assertSameTenant(tenant, grant.tenant);`)).toEqual([]);
    });
    it("derives PII read sinks from arrow, object, and class callables", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `
          export interface PIIBearing { readonly pii?: "bearing" }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface ClientRecord extends PIIBearing { fullName: string }
          export const loadClients = async (
            tenant: TenantContext,
          ): Promise<ClientRecord[]> => [{ fullName: tenant.orgId }];
          export const clientRepo = {
            listClients(tenant: TenantContext): ClientRecord[] {
              return [{ fullName: tenant.orgId }];
            },
          };
          export class ClientStore {
            load(tenant: TenantContext): ClientRecord[] {
              return [{ fullName: tenant.orgId }];
            }
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/new-adapter/repository.ts :: loadClients: boundary must require ActionGrant<"pii.view">`,
        `src/infrastructure/new-adapter/repository.ts :: clientRepo.listClients: boundary must require ActionGrant<"pii.view">`,
        `src/infrastructure/new-adapter/repository.ts :: ClientStore.load: boundary must require ActionGrant<"pii.view">`,
      ]);
    });
    it("derives PII read sinks from objects wrapped in Object.freeze", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `
          export interface PIIBearing { readonly pii?: "bearing" }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface ClientRecord extends PIIBearing { fullName: string }
          export const clientRepo = Object.freeze({
            listClients(tenant: TenantContext): ClientRecord[] {
              return [{ fullName: tenant.orgId }];
            },
          });
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/new-adapter/repository.ts :: clientRepo.listClients: boundary must require ActionGrant<"pii.view">`,
      ]);
    });
    it("derives PII sinks from inline return shapes", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { TenantContext } from "../../contracts/tenant";
          export async function listClients(
            tenant: TenantContext,
          ): Promise<Array<{ email: string }>> {
            return [{ email: tenant.orgId }];
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/new-adapter/repository.ts :: listClients: boundary must require ActionGrant<"pii.view">`,
      ]);
    });
    it("traverses unsafe union siblings beside exact sealed wrappers", () => {
      const project = inMemoryProject({
        "/src/contracts/tokenized.ts": `export interface Tokenized<T> { readonly value: T; readonly piiFree: true }`,
        "/src/contracts/secret.ts": `export interface SecretValue { readonly redacted: true }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { Tokenized } from "../../contracts/tokenized";
          import type { SecretValue } from "../../contracts/secret";
          import type { TenantContext } from "../../contracts/tenant";
          export function tokenizedOrRaw(tenant: TenantContext): Tokenized<string> | { email: string } {
            return { email: tenant.orgId };
          }
          export function secretOrRaw(tenant: TenantContext): SecretValue | { email: string } {
            return { email: tenant.orgId };
          }
        `,
      });
      const hits = detectUnguardedGovernedSinks(project);
      expect(hits.some((hit) => hit.includes(":: tokenizedOrRaw:"))).toBe(true);
      expect(hits.some((hit) => hit.includes(":: secretOrRaw:"))).toBe(true);
    });
    it("fails closed on opaque governed outputs", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { TenantContext } from "../../contracts/tenant";
          export async function loadOpaque(tenant: TenantContext): Promise<unknown> {
            return tenant.orgId;
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/new-adapter/repository.ts :: loadOpaque: boundary must require ActionGrant<"pii.view">`,
      ]);
    });
    it("derives PII sinks from methods returned by every exported factory form", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Client extends PIIBearing { email: string }
          export const factories = {
            make() {
              return { list(tenant: TenantContext): Client[] { return [{ email: tenant.orgId }]; } };
            },
          };
          export class Factory {
            make() {
              return { load(tenant: TenantContext): Client[] { return [{ email: tenant.orgId }]; } };
            }
          }
        `,
      });
      const hits = detectUnguardedGovernedSinks(project);
      expect(hits.some((hit) => hit.includes(":: factories.make.list:"))).toBe(true);
      expect(hits.some((hit) => hit.includes(":: Factory.make.load:"))).toBe(true);
    });
    it("derives PII sinks from private class and conditional factory returns", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Client extends PIIBearing { email: string }
          interface Repo { list(tenant: TenantContext): Client[] }
          class PrivateRepo implements Repo {
            list(tenant: TenantContext): Client[] { return [{ email: tenant.orgId }]; }
          }
          export function makeRepo(useClass: boolean): Repo {
            return useClass
              ? new PrivateRepo()
              : { list(tenant) { return [{ email: tenant.orgId }]; } };
          }
        `,
      });
      const hits = detectUnguardedGovernedSinks(project);
      expect(hits.filter((hit) => hit.includes(":: makeRepo.list:"))).toHaveLength(2);
    });
    it("fails closed when an exported factory returns an opaque helper result", () => {
      const project = inMemoryProject({
        "/src/infrastructure/new-adapter/repository.ts": `
          declare function buildRepo(): any;
          export function makeRepo(): any {
            return buildRepo();
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        "src/infrastructure/new-adapter/repository.ts :: makeRepo.<unresolved>: returned callable implementation cannot be proven",
      ]);
    });
    it("derives PII sinks from callable object-literal getters", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Client extends PIIBearing { email: string }
          interface Repo {
            readonly list: (tenant: TenantContext) => Client[];
          }
          export function makeRepo(): Repo {
            return {
              get list() {
                return (tenant: TenantContext): Client[] =>
                  [{ email: tenant.orgId }];
              },
            };
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project).some((hit) =>
        hit.includes(":: makeRepo.list.<call>:")
      )).toBe(true);
    });
    it("derives audit-export sinks from governed output markers", () => {
      const project = inMemoryProject({
        "/src/contracts/authz.ts": `
          export interface GovernedOutput<A extends string> {
            readonly governed?: A;
          }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          import type { GovernedOutput } from "../../contracts/authz";
          import type { TenantContext } from "../../contracts/tenant";
          interface AuditRows extends GovernedOutput<"audit.export"> {
            rows: readonly string[];
          }
          export async function exportRows(
            tenant: TenantContext,
          ): Promise<AuditRows> {
            return { rows: [tenant.orgId] };
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/new-adapter/repository.ts :: exportRows: boundary must require ActionGrant<"audit.export">`,
      ]);
    });
    it("rejects a conditional grant assertion at a governed sink", () => {
      const project = inMemoryProject({
        "/src/contracts/authz.ts": `
          export interface ActionGrant<A extends string> { action: A }
          export function assertActionGrant<A extends string>(
            value: unknown,
            action: A,
          ): asserts value is ActionGrant<A> {
            void value;
            void action;
          }
        `,
        "/src/infrastructure/crm/house-crm.ts": `
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          export function listHouseholds(
            db: unknown,
            grant: ActionGrant<"pii.view">,
          ): unknown {
            if (db) assertActionGrant(grant, "pii.view");
            return db;
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project).some((violation) =>
        violation ===
          `src/infrastructure/crm/house-crm.ts :: listHouseholds: assertActionGrant(grant, "pii.view") must appear in the contiguous authority prologue, before any side effect, database call, or branching logic`
      )).toBe(true);
    });
    it("rejects a route-local helper shadowing requireActionGrant", () => {
      const project = inMemoryProject({
        "/src/app/_server/context.ts": `
          export function errorResponse(error: unknown): Response {
            return new Response();
          }
        `,
        "/src/app/api/audit/route.ts": `
          import { errorResponse } from "@app/_server/context";
          function requireActionGrant() {
            return { ok: true, value: { grant: { tenant: {} } } };
          }
          export async function GET(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return listEverything(auth.value.grant.tenant);
          }
        `,
      });
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("rejects a route-local helper shadowing errorResponse", () => {
      const project = inMemoryProject({
        "/src/app/_server/context.ts": `
          export async function requireActionGrant(req: Request, action: string): Promise<any> {
            return { ok: true };
          }
        `,
        "/src/app/api/audit/route.ts": `
          import { requireActionGrant } from "@app/_server/context";
          function errorResponse(): Response {
            return new Response();
          }
          export async function GET(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return listEverything(auth.value.grant.tenant);
          }
        `,
      });
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });
    it("catches a NEW unbounded PII read that no one reviewed", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/infrastructure/identity/directory.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          interface UserRow extends PIIBearing { email: string; displayName: string }
          declare const db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
          export async function findUserByPhone(phone: string): Promise<UserRow | null> {
            const res = await db.query<UserRow>("SELECT email, display_name FROM users WHERE phone = $1", [phone]);
            return res.rows[0] ?? null;
          }
        `,
      });
      // No tenant boundary, no grant: it derives no sink, so WITHOUT this registry it
      // would be invisible to every rule in this fence.
      expect(unboundedPiiReads(project)).toEqual([
        "src/infrastructure/identity/directory.ts :: findUserByPhone",
      ]);
      expect(detectUnreviewedPreAuthPiiReads(project, [])).toEqual([
        `src/infrastructure/identity/directory.ts :: findUserByPhone: returns PII with no tenant boundary and no grant, so it derives NO governed sink — review it into REVIEWED_PRE_AUTH_PII_READS with the reason it cannot hold one`,
      ]);
      // Reviewed WITH a reason, it is suppressed; reviewed with an empty one, it is not.
      expect(detectUnreviewedPreAuthPiiReads(project, [
        { callable: "src/infrastructure/identity/directory.ts :: findUserByPhone", why: "pre-authentication lookup" },
      ])).toEqual([]);
      expect(detectUnreviewedPreAuthPiiReads(project, [
        { callable: "src/infrastructure/identity/directory.ts :: findUserByPhone", why: "  " },
      ])).toEqual([
        `src/infrastructure/identity/directory.ts :: findUserByPhone: pre-auth PII escape must carry a reason`,
      ]);
    });

    it("does not let nested tenant or grant authority retain a pre-auth PII escape", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
          export function assertTenantContext(value: unknown): asserts value is TenantContext { void value; }
        `,
        "/src/contracts/authz.ts": `
          import type { TenantContext } from "./tenant";
          export interface ActionGrant<A extends string> { action: A; tenant: TenantContext }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> { void value; void action; }
        `,
        "/src/infrastructure/identity/directory.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          import type { ActionGrant } from "../../contracts/authz";
          interface UserRow extends PIIBearing { email: string; displayName: string }
          export function byTenant(scope: { tenant: TenantContext }): UserRow[] { void scope; return []; }
          export function byGrant(scope: { grant: ActionGrant<"pii.view"> }): UserRow[] { void scope; return []; }
        `,
      });
      const reviewed = [
        { callable: "src/infrastructure/identity/directory.ts :: byTenant", why: "pretend escape" },
        { callable: "src/infrastructure/identity/directory.ts :: byGrant", why: "pretend escape" },
      ];
      expect(unboundedPiiReads(project)).toEqual([]);
      const stale = detectUnreviewedPreAuthPiiReads(project, reviewed);
      expect(stale).toHaveLength(2);
      expect(stale.every((hit) => hit.includes("stale pre-auth PII escape"))).toBe(true);
      expect(deriveGovernedSinks(project).map((sink) => `${sink.name}:${sink.action}`).sort())
        .toEqual(["byGrant:pii.view", "byTenant:pii.view"]);
    });

    it("catches a STALE pre-auth escape, and never swallows a tenant-scoped read", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Contact extends PIIBearing { fullName: string }
          export function listContacts(tenant: TenantContext): Contact[] {
            return [{ fullName: tenant.orgId }];
          }
        `,
      });
      // A tenant-scoped read is NOT an escape candidate: it stays a governed sink and
      // owes its grant, so the registry can never be used to excuse one.
      expect(unboundedPiiReads(project)).toEqual([]);
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/crm/contacts.ts :: listContacts: boundary must require ActionGrant<"pii.view">`,
      ]);
      expect(detectUnreviewedPreAuthPiiReads(project, [
        { callable: "src/infrastructure/crm/contacts.ts :: listContacts", why: "no longer true" },
      ])).toEqual([
        `src/infrastructure/crm/contacts.ts :: listContacts: stale pre-auth PII escape — this callable is no longer an unbounded PII read`,
      ]);
    });

    it("does not let the word 'update' outside SQL exempt a PII read sink", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `
          export interface PIIBearing { readonly pii?: "bearing" }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Contact extends PIIBearing { fullName: string }
          export function listContacts(tenant: TenantContext): Contact[] {
            // nothing to update here
            const update = false;
            void update;
            return [{ fullName: tenant.orgId }];
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/crm/contacts.ts :: listContacts: boundary must require ActionGrant<"pii.view">`,
      ]);
    });
    it("does not let a `FOR UPDATE` row lock exempt a PII read sink", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `
          export interface PIIBearing { readonly pii?: "bearing" }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Household extends PIIBearing { name: string }
          declare const db: { query(sql: string, params: unknown[]): Promise<{ rows: Household[] }> };
          export async function loadHouseholdsForEdit(tenant: TenantContext): Promise<Household[]> {
            const res = await db.query("SELECT * FROM households WHERE org_id = $1 FOR UPDATE", [tenant.orgId]);
            return res.rows;
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/crm/contacts.ts :: loadHouseholdsForEdit: boundary must require ActionGrant<"pii.view">`,
      ]);
    });

    it("does not let an audit record buy a PII read out of its grant", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `
          export interface PIIBearing { readonly pii?: "bearing" }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/audit/audited-write.ts": `
          export async function auditedWrite(opts: unknown): Promise<void> { void opts; }
        `,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          import { auditedWrite } from "../audit/audited-write";
          interface Contact extends PIIBearing { fullName: string }
          export async function listContacts(tenant: TenantContext): Promise<Contact[]> {
            await auditedWrite({ action: "pii.read" });
            return [{ fullName: tenant.orgId }];
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/crm/contacts.ts :: listContacts: boundary must require ActionGrant<"pii.view">`,
      ]);
    });

    it("still exempts a real SQL mutation passed to the driver", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `
          export interface PIIBearing { readonly pii?: "bearing" }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
        `,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Contact extends PIIBearing { fullName: string }
          declare const db: { query(sql: string, params: unknown[]): Promise<void> };
          export async function renameContact(tenant: TenantContext): Promise<Contact> {
            await db.query("UPDATE contacts SET full_name = $1 WHERE org_id = $2", [tenant.orgId]);
            return { fullName: tenant.orgId };
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([]);
    });

    it("keeps mutation classification through destructured builtins and later executor aliases", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Contact extends PIIBearing { fullName: string }
          declare const db: { query(sql: string, params?: unknown[]): Promise<void> };
          export async function renameContact(tenant: TenantContext): Promise<Contact> {
            const { apply } = Reflect;
            let run: typeof db.query;
            run = db.query;
            await apply(run, db, ["UPDATE contacts SET full_name = $1"]);
            return { fullName: tenant.orgId };
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([]);
    });

    it("keeps mutation classification through fixed-array builtin aliases", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Contact extends PIIBearing { fullName: string }
          declare const db: { query(sql: string, params?: unknown[]): Promise<void> };
          export async function renameContact(tenant: TenantContext): Promise<Contact> {
            const methods = [Reflect.apply] as const;
            const selected = methods;
            const [apply] = selected;
            await apply(db.query, db, ["UPDATE contacts SET full_name = $1"]);
            await selected[0](db.query, db, ["UPDATE contacts SET full_name = $1"]);
            return { fullName: tenant.orgId };
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([]);
    });

    it.each([
      `db.query.call(db, "UPDATE contacts SET full_name = $1")`,
      `db.query.apply(db, ["UPDATE contacts SET full_name = $1"])`,
      `db.query.bind(db)("UPDATE contacts SET full_name = $1")`,
      `Reflect.apply(db.query, db, ["UPDATE contacts SET full_name = $1"])`,
    ])("classifies wrapped SQL mutation arguments: %s", (statement) => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Contact extends PIIBearing { fullName: string }
          declare const db: { query(sql: string): Promise<void> };
          export async function renameContact(tenant: TenantContext): Promise<Contact> {
            await ${statement};
            return { fullName: tenant.orgId };
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([]);
    });
    it("discovers a governed sink called from a Server Action, not just route.ts", () => {
      const project = inMemoryProject({
        "/src/contracts/authz.ts": `
          export interface ActionGrant<A extends string> { action: A }
          export function assertActionGrant<A extends string>(
            value: unknown,
            action: A,
          ): asserts value is ActionGrant<A> {
            void value;
            void action;
          }
        `,
        "/src/infrastructure/audit/audit-store.ts": `
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          export function verifyAndListOrgChain(
            db: unknown,
            grant: ActionGrant<"audit.export">,
          ): unknown {
            assertActionGrant(grant, "audit.export");
            return { db, grant };
          }
        `,
        "/src/app/exports/actions.ts": `
          "use server";
          import { verifyAndListOrgChain } from "@infra/audit/audit-store";
          export async function exportChainAction() {
            return verifyAndListOrgChain({}, {} as never);
          }
        `,
        "/src/app/exports/page.tsx": `
          import { verifyAndListOrgChain } from "@infra/audit/audit-store";
          export default async function Page() {
            return verifyAndListOrgChain({}, {} as never);
          }
        `,
      });
      const discovered = discoverGovernedRoutes(project);
      // No entry: the surface can never satisfy requireActionGrant, so it is a
      // fail-closed violation naming the rule, not a silently-unfenced surface.
      expect(discovered.entries).toEqual([]);
      expect(discovered.violations).toHaveLength(2);
      for (const surface of ["src/app/exports/actions.ts", "src/app/exports/page.tsx"]) {
        expect(discovered.violations.some((violation) =>
          violation.startsWith(surface) &&
          violation.includes("unsupported surface") &&
          violation.includes("src/app/**/route.ts")
        ), surface).toBe(true);
      }
    });

    it("does NOT flag a governed sink reached from a route handler", () => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        export async function GET(req: Request) {
          return verifyAndListOrgChain({}, {} as never);
        }
      `);
      expect(discoverGovernedRoutes(project).violations).toEqual([]);
    });
    it("rejects an authorization bound to a forged request instead of the handler's own", () => {
      const project = governedTestProject(`
          const req = new Request("http://local/forged");
          export async function GET(request: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return list(auth.value.grant.tenant);
          }
        `);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "list" },
      ])).toHaveLength(1);
    });
    it("discovers a governed sink reached through a LOCAL alias", () => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        const listChain = verifyAndListOrgChain;
        export async function GET(req: Request) {
          return listChain({}, {} as never);
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.entries).toEqual([
        {
          file: "src/app/api/other/route.ts",
          handler: "GET",
          action: "audit.export",
          sink: "verifyAndListOrgChain",
          sinkFile: "src/infrastructure/audit/audit-store.ts",
          grantIndex: 1,
        },
      ]);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toHaveLength(1);
    });

    it("rejects a client-supplied value whose identifier merely SPELLS the authorized name", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          const grant = auth.value;
          const body = await readBody(req);
          void grant;
          return listEverything(body.value.grant);
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });

    it("rejects a `valueOf()` reference standing in for the authorized value", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return listEverything(auth.valueOf());
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });

    it("rejects a fail-closed return buried in a nested function", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) {
            function report() { return errorResponse(auth.error); }
            void report;
          }
          return listEverything(auth.value);
        }`);
      expect(detectUnwiredGovernedRoutes(project, [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" },
      ])).toHaveLength(1);
    });

    it("passes a correctly wired route", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return list(auth.value.grant.tenant);
        }`);
      expect(detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "list" }])).toEqual([]);
    });

    it("catches raw SQL in an app-layer surface", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        "/src/app/api/audit/route.ts": `
          import { getDb } from "@infra/store/db";
          export async function GET() {
            const db = await getDb();
            return db.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE org_id = $1", ["org"]);
          }
        `,
      });
      expect(detectAppLayerSqlAccess(project)).toHaveLength(1);
      expect(detectAppLayerSqlAccess(project)[0]).toContain(
        "src/app/api/audit/route.ts:5",
      );
    });

    it("catches app-layer SQL issued through a DESTRUCTURED or indexed executor", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        "/src/app/api/audit/route.ts": `
          import { getDb } from "@infra/store/db";
          export async function GET() {
            const db = await getDb();
            const { query } = db;
            const { query: run } = db;
            await query<{ email: string }>("SELECT id, email FROM users WHERE org_id = $1", ["org"]);
            await run<{ email: string }>("SELECT id, email FROM users WHERE org_id = $1", ["org"]);
            return db["query"]<{ email: string }>("SELECT id, email FROM users WHERE org_id = $1", ["org"]);
          }
        `,
      });
      // All three issue the same SQL from the same place, with no repository
      // signature to carry an ActionGrant or a sealed TenantContext.
      const hits = detectAppLayerSqlAccess(project);
      expect(hits).toHaveLength(3);
      for (const line of [7, 8, 9]) {
        expect(hits.some((hit) => hit.includes(`route.ts:${line}`)), `line ${line}`).toBe(true);
      }
    });

    it("catches app-layer SQL issued through call, apply, bind, and Reflect.apply", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        "/src/app/api/audit/route.ts": `
          import { getDb } from "@infra/store/db";
          export async function GET() {
            const db = await getDb();
            await db.query.call(db, "SELECT email FROM users");
            await db.query.apply(db, ["SELECT email FROM users"]);
            await db.query.bind(db)("SELECT email FROM users");
            await Reflect.apply(db.query, db, ["SELECT email FROM users"]);
            const { apply } = Reflect;
            let run: typeof db.query;
            run = db.query;
            await apply(run, db, ["SELECT email FROM users"]);
            let later: typeof db.query;
            ({ query: later } = db);
            await later("SELECT email FROM users");
            return null;
          }
        `,
      });
      const hits = detectAppLayerSqlAccess(project);
      expect(hits, hits.join("\n")).toHaveLength(6);
      for (const line of [5, 6, 7, 8, 12, 15]) {
        expect(hits.some((hit) => hit.includes(`route.ts:${line}`)), `line ${line}`).toBe(true);
      }
    });

    it("catches Reflect.apply through ambient receiver aliases and reaching assignments", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        "/src/app/api/audit/route.ts": `
          import { getDb } from "@infra/store/db";
          export async function GET() {
            const db = await getDb();
            const R = Reflect;
            await R.apply(db.query, db, ["SELECT email FROM users"]);
            let later: typeof Reflect;
            later = Reflect;
            await later.apply(db.query, db, ["SELECT email FROM users"]);
            const R1 = Reflect;
            const R2 = R1;
            const R3 = R2;
            const R4 = R3;
            const R5 = R4;
            const R6 = R5;
            await R6.apply(db.query, db, ["SELECT email FROM users"]);
            let branch: unknown = Reflect;
            if (Math.random()) branch = { apply() { return null; } };
            await (branch as typeof Reflect).apply(
              db.query,
              db,
              ["SELECT email FROM users"],
            );
            return null;
          }
        `,
      });
      const hits = detectAppLayerSqlAccess(project);
      expect(hits, hits.join("\n")).toHaveLength(4);
      for (const line of [6, 9, 16, 19]) {
        expect(hits.some((hit) => hit.includes(`route.ts:${line}`)), `line ${line}`).toBe(true);
      }
    });

    it("catches SQL through fixed-array builtin aliases and element access", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        "/src/app/api/audit/route.ts": `
          import { getDb } from "@infra/store/db";
          export async function GET() {
            const db = await getDb();
            const methods = [Reflect.apply] as const;
            const selected = methods;
            const [apply] = selected;
            await apply(db.query, db, ["SELECT email FROM users"]);
            await selected[0](db.query, db, ["SELECT email FROM users"]);
            return null;
          }
        `,
      });
      const hits = detectAppLayerSqlAccess(project);
      expect(hits, hits.join("\n")).toHaveLength(2);
    });

    it("does not mistake a same-named non-SQL method for persistence", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `
          const cache = { query(spec: { id: string }): string { return spec.id; } };
          export async function GET() { return cache.query({ id: "x" }); }
        `,
      });
      expect(detectAppLayerSqlAccess(project)).toEqual([]);
    });

    it("FAILS CLOSED on an executor the checker cannot narrow, whatever it is NAMED", () => {
      // Resolving through the callee's SIGNATURE is what makes destructured and
      // computed callsites resolve alike, but a callee widened past SqlDb yields
      // ZERO call signatures. Returning "clean" there made the whole rule a
      // one-line evasion: every form below issues the same SQL from the same place.
      // None of them is WRITTEN as query/exec/execute, so a name-keyed fallback let
      // all of them through - the executor has to be resolved by VALUE.
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        "/src/app/api/audit/route.ts": `
          type Runner = (sql: string) => Promise<unknown>;
          import { getDb } from "@infra/store/db";
          export async function GET() {
            const db = await getDb();
            const run: Function = db.query;
            const aliased: Runner = db.query as unknown as Runner;
            const anyDb = db as any;
            const reflected = anyDb.query;
            const opaque = db as unknown as { exec: unknown };
            await (run as (sql: string) => unknown)("SELECT id, email FROM users");
            await aliased("SELECT id, email FROM users");
            await reflected("SELECT id, email FROM users");
            await (opaque.exec as Function)("SELECT id, email FROM users");
            return null;
          }
        `,
      });
      const hits = detectAppLayerSqlAccess(project);
      // One assertion PER planted shape, and an exact total: asserting "at least
      // one" cannot tell a working detector from a half-gutted one.
      for (const line of [11, 12, 13, 14]) {
        expect(hits.some((hit) => hit.includes(`route.ts:${line}`)), `line ${line}: ${hits.join(" | ")}`)
          .toBe(true);
      }
      expect(hits, hits.join("\n")).toHaveLength(4);
    });

    it("catches an opaque executor reached by ELEMENT access, and spares a non-SQL call", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `
          declare const opaque: any;
          declare const cache: { lookup(spec: { id: string }): string };
          export async function GET() {
            await opaque["query"]("SELECT id, email FROM users");
            return cache.lookup({ id: "x" });
          }
        `,
      });
      const hits = detectAppLayerSqlAccess(project);
      expect(hits, hits.join("\n")).toHaveLength(1);
      expect(hits[0]).toContain("route.ts:5");
    });

    it("keys a governed non-PII escape to the EXACT reviewed structural path", () => {
      // The reviewed escape names one top-level machine-named field. Keying on the
      // nearest ancestor interface let it silently cover a same-named field nested
      // anywhere inside that interface, so a real PII exposure would derive no sink.
      const withNested = inMemoryProject({
        "/src/infrastructure/observability/tracer.ts": `
          export interface RecordedSpan {
            readonly name: string;
            readonly attributes: { readonly name: string };
          }
          export function recorded(): RecordedSpan { throw new Error(); }
        `,
      });
      const exposures = structuralPiiExposures(
        withNested.getSourceFileOrThrow("/src/infrastructure/observability/tracer.ts")
          .getInterfaceOrThrow("RecordedSpan").getType(),
        { path: "RecordedSpan", isEscaped: isGovernedNonPiiField },
      );
      expect(exposures).toEqual(["RecordedSpan.attributes.name"]);

      // A registry entry that stops resolving, or stops describing a PII-shaped
      // field, is reported rather than silently carried forward.
      expect(detectStaleGovernedNonPiiFields(inMemoryProject({
        "/src/infrastructure/observability/tracer.ts":
          `export interface RecordedSpan { readonly label: string }`,
      }))).toEqual([
        "src/infrastructure/observability/tracer.ts :: RecordedSpan.name: reviewed non-PII escape no longer resolves to a direct interface member",
      ]);

      // ...and the reviewed top-level field itself is still escaped (the safe lookalike).
      const reviewedOnly = inMemoryProject({
        "/src/infrastructure/observability/tracer.ts": `
          export interface RecordedSpan { readonly name: string }
        `,
      });
      expect(structuralPiiExposures(
        reviewedOnly.getSourceFileOrThrow("/src/infrastructure/observability/tracer.ts")
          .getInterfaceOrThrow("RecordedSpan").getType(),
        { path: "RecordedSpan", isEscaped: isGovernedNonPiiField },
      )).toEqual([]);
    });

    it("rejects a client-supplied grant even when another argument carries the authorized value", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          const body = await readBody(req);
          return listEverything(auth.value.tenant, body.value.grant);
        }`);
      const entry = {
        file: "src/app/api/audit/route.ts",
        handler: "GET",
        action: "audit.export",
        sink: "listEverything",
      };
      expect(detectUnwiredGovernedRoutes(project, [{ ...entry, grantIndex: 1 }])).toHaveLength(1);
      // Non-vacuity: WITHOUT the parameter position — the pre-fix "some argument
      // mentions auth.value" rule — this same route reads as correctly wired.
      expect(detectUnwiredGovernedRoutes(project, [entry])).toEqual([]);
    });

    it("rejects a SECOND, unauthorized call to the same sink in one handler", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          const mine = await listEverything(db, auth.value);
          const body = await readBody(req);
          const theirs = await listEverything(db, body.value.grant);
          return [mine, theirs];
        }`);
      // Entries dedupe per (file, handler, sink), so both calls live under ONE
      // entry: an existential check would let the first clear the second.
      const violations = detectUnwiredGovernedRoutes(project, [{
        file: "src/app/api/audit/route.ts",
        handler: "GET",
        action: "audit.export",
        sink: "listEverything",
        grantIndex: 1,
      }]);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("line 8");
    });

    it("rejects a grant argument that merely MENTIONS the authorized value", () => {
      for (const call of [
        "listEverything(db, pickGrant(auth.value, body.value.grant))",
        "listEverything(db, { ...body.value.grant, tag: auth.value })",
      ]) {
        const project = governedTestProject(`export async function GET(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            const body = await readBody(req);
            return ${call};
          }`);
        expect(
          detectUnwiredGovernedRoutes(project, [{
            file: "src/app/api/audit/route.ts",
            handler: "GET",
            action: "audit.export",
            sink: "listEverything",
            grantIndex: 1,
          }]),
          call,
        ).toHaveLength(1);
      }
    });

    it("rejects a grant LAUNDERED through a local binding that mixes in client data", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          const body = await readBody(req);
          const grant = pickGrant(auth.value, body.value.grant);
          return listEverything(db, grant);
        }`);
      expect(detectUnwiredGovernedRoutes(project, [{
        file: "src/app/api/audit/route.ts",
        handler: "GET",
        action: "audit.export",
        sink: "listEverything",
        grantIndex: 1,
      }])).toHaveLength(1);
    });

    it("passes a route whose GRANT argument carries the authorized value", () => {
      const project = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          const db = await getDb();
          return listEverything(db, auth.value);
        }`);
      expect(detectUnwiredGovernedRoutes(project, [{
        file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export",
        sink: "listEverything", grantIndex: 1,
      }])).toEqual([]);
    });

    it("accepts an authorized payload reached through destructuring", () => {
      for (const binding of ["const { grant } = auth.value;", "const { value: grant } = auth;"]) {
        const project = governedTestProject(`export async function GET(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            ${binding}
            return listEverything(grant);
          }`);
        expect(detectUnwiredGovernedRoutes(project, [{
          file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export",
          sink: "listEverything", grantIndex: 0,
        }]), binding).toEqual([]);
      }
    });

    it("accepts a handler that binds TWO grants before any route work, and rejects one bound after", () => {
      const wired = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          const pii = await requireActionGrant(req, "pii.view");
          if (!pii.ok) return errorResponse(pii.error);
          const chain = await listEverything(auth.value);
          return listEmails(pii.value);
        }`);
      const entries = [
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything", grantIndex: 0 },
        { file: "src/app/api/audit/route.ts", handler: "GET", action: "pii.view", sink: "listEmails", grantIndex: 0 },
      ];
      expect(detectUnwiredGovernedRoutes(wired, entries)).toEqual([]);

      const late = governedTestProject(`export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          const chain = await listEverything(auth.value);
          const pii = await requireActionGrant(req, "pii.view");
          if (!pii.ok) return errorResponse(pii.error);
          return listEmails(pii.value);
        }`);
      // The second authority is bound AFTER a governed read has already run.
      expect(detectUnwiredGovernedRoutes(late, entries)).toHaveLength(1);
    });

    it("discovers a governed sink held in a literal bag, and refuses one passed as a value", () => {
      const bagged = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        const readers = { chain: verifyAndListOrgChain };
        export async function GET(req: Request) {
          return readers.chain({}, {} as never);
        }
      `);
      const discovered = discoverGovernedRoutes(bagged);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries).toHaveLength(1);
      expect(detectUnwiredGovernedRoutes(bagged, discovered.entries)).toHaveLength(1);

      const escaped = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        declare function runReport(load: unknown): unknown;
        export async function GET(req: Request) {
          return runReport({ load: verifyAndListOrgChain });
        }
      `);
      const leak = discoverGovernedRoutes(escaped);
      expect(leak.entries).toEqual([]);
      expect(leak.violations).toHaveLength(1);
      expect(leak.violations[0]).toContain("passed as a VALUE");
    });

    it.each([
      "verifyAndListOrgChain && fallback",
      "fallback || verifyAndListOrgChain",
      "fallback ?? verifyAndListOrgChain",
    ])("discovers governed sinks in every logical callee arm", (callee) => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        const fallback = () => null;
        export async function GET(req: Request) {
          return (${callee})({}, {} as never);
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries).toHaveLength(1);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toHaveLength(1);
    });

    it.each([
      `const holder = {
          get run() {
            return verifyAndListOrgChain;
          },
        };
        return holder.run({}, {} as never);`,
      `return verifyAndListOrgChain.bind(null)({}, {} as never);`,
      `return verifyAndListOrgChain.call(null, {}, {} as never);`,
      `return verifyAndListOrgChain.apply(null, [{}, {} as never]);`,
      `return Reflect.apply(
          verifyAndListOrgChain,
          null,
          [{}, {} as never],
        );`,
    ])("discovers governed sinks through getters and invocation wrappers", (work) => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        export async function GET(req: Request) {
          void req;
          ${work}
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries).toHaveLength(1);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toHaveLength(1);
    });

    it.each([
      `const run = verifyAndListOrgChain.bind(null);
        return run({}, {} as never);`,
      `let run: typeof verifyAndListOrgChain;
        run = verifyAndListOrgChain.bind(null);
        return run({}, {} as never);`,
      `function select() {
          return verifyAndListOrgChain.bind(null);
        }
        const run = select();
        return run({}, {} as never);`,
      `const run = verifyAndListOrgChain.bind(null);
        const box = [run] as const;
        return box[0]({}, {} as never);`,
    ])("preserves governed sink provenance through bound callable values", (work) => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        export async function GET(req: Request) {
          void req;
          ${work}
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries).toEqual([
        expect.objectContaining({
          action: "audit.export",
          sink: "verifyAndListOrgChain",
        }),
      ]);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toHaveLength(1);
    });

    it.each([
      `const run = verifyAndListOrgChain.bind(null, {});
        return run(auth.value);`,
      `const run = verifyAndListOrgChain.bind(null, {}, auth.value);
        return run();`,
      `const withDb = verifyAndListOrgChain.bind(null, {});
        const run = withDb.bind(null, auth.value);
        return run();`,
      `const withDb = verifyAndListOrgChain.bind(null, {});
        return withDb.call(null, auth.value);`,
    ])("preserves effective arguments through bound governed sink values", (work) => {
      const project = governedDiscoveryProject(`
        import { requireActionGrant, errorResponse } from "@app/_server/context";
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          ${work}
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries).toHaveLength(1);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toEqual([]);
    });

    it("fails closed when a governed logical callee has an unresolved arm", () => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        declare const maybe: typeof verifyAndListOrgChain | undefined;
        export async function GET(req: Request) {
          return (maybe ?? verifyAndListOrgChain)({}, {} as never);
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.entries).toHaveLength(1);
      expect(discovered.violations).toEqual([
        expect.stringContaining("unresolved value-producing arm"),
      ]);
    });

    it("discovers an arrow-function handler and a root-level src/app/route.ts", () => {
      const project = inMemoryProject({
        "/src/app/_server/context.ts": `
          export async function requireActionGrant(req: Request, action: string): Promise<any> { return { ok: true }; }
          export function errorResponse(error: unknown): Response { return new Response(); }
        `,
        "/src/contracts/authz.ts": `
          export interface ActionGrant<A extends string> { action: A }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> {
            void value; void action;
          }
        `,
        "/src/infrastructure/audit/audit-store.ts": `
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          export function verifyAndListOrgChain(db: unknown, grant: ActionGrant<"audit.export">): unknown {
            assertActionGrant(grant, "audit.export");
            return { db, grant };
          }
        `,
        "/src/app/route.ts": `
          import { verifyAndListOrgChain } from "@infra/audit/audit-store";
          export const GET = async (req: Request) => verifyAndListOrgChain({}, {} as never);
        `,
      });
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries).toEqual([{
        file: "src/app/route.ts",
        handler: "GET",
        action: "audit.export",
        sink: "verifyAndListOrgChain",
        sinkFile: "src/infrastructure/audit/audit-store.ts",
        grantIndex: 1,
      }]);
      // An arrow handler is held to the same chain, so the unwired form still fails.
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toHaveLength(1);
    });

    it("passes a non-route app handler that takes the request and wires the hook", () => {
      const project = inMemoryProject({
        "/src/app/_server/context.ts": `
          export async function requireActionGrant(req: Request, action: string): Promise<any> { return { ok: true }; }
          export function errorResponse(error: unknown): Response { return new Response(); }
        `,
        "/src/contracts/authz.ts": `
          export interface ActionGrant<A extends string> { action: A }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> {
            void value; void action;
          }
        `,
        "/src/infrastructure/audit/audit-store.ts": `
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          export function verifyAndListOrgChain(db: unknown, grant: ActionGrant<"audit.export">): unknown {
            assertActionGrant(grant, "audit.export");
            return { db, grant };
          }
        `,
        "/src/app/api/audit/_handlers.ts": `
          import { requireActionGrant, errorResponse } from "@app/_server/context";
          import { verifyAndListOrgChain } from "@infra/audit/audit-store";
          export async function chainResponse(req: Request) {
            const auth = await requireActionGrant(req, "audit.export");
            if (!auth.ok) return errorResponse(auth.error);
            return verifyAndListOrgChain({}, auth.value);
          }
        `,
      });
      const discovered = discoverGovernedRoutes(project);
      expect(
        discovered.violations,
        "a correctly-wired app handler is not an unsupported surface",
      ).toEqual([]);
      expect(discovered.entries).toHaveLength(1);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toEqual([]);
    });

    it("refuses a governed sink in a default-exported component outside a reserved file name", () => {
      const project = inMemoryProject({
        "/src/contracts/authz.ts": `
          export interface ActionGrant<A extends string> { action: A }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> {
            void value; void action;
          }
        `,
        "/src/infrastructure/audit/audit-store.ts": `
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          export function verifyAndListOrgChain(db: unknown, grant: ActionGrant<"audit.export">): unknown {
            assertActionGrant(grant, "audit.export");
            return { db, grant };
          }
        `,
        "/src/app/reports/chain-card.tsx": `
          import { verifyAndListOrgChain } from "@infra/audit/audit-store";
          export default async function ChainCard() {
            return verifyAndListOrgChain({}, {} as never);
          }
        `,
      });
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.entries).toEqual([]);
      expect(discovered.violations).toHaveLength(1);
      expect(discovered.violations[0]).toContain("unsupported surface");
      expect(discovered.violations[0]).toContain("default-exported component");
    });

    it("keeps the write exemption for interpolated and CTE mutations", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/principal.ts": `
          import type { TenantContext } from "./tenant";
          export interface WriteActor { tenant: TenantContext; actorUserId: string }
        `,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { WriteActor } from "../../contracts/principal";
          interface Contact extends PIIBearing { fullName: string }
          declare const db: { query(sql: string, params?: unknown[]): Promise<void> };
          export async function updateContactEmail(a: WriteActor, column: string): Promise<Contact> {
            await db.query(\`UPDATE contacts SET \${column} = $3 WHERE id = $1 AND org_id = $2\`, [a.tenant.orgId]);
            return { fullName: a.actorUserId };
          }
          export async function archiveContact(a: WriteActor): Promise<Contact> {
            await db.query("/* archive */ WITH d AS (DELETE FROM contacts RETURNING *) INSERT INTO archived_contacts SELECT * FROM d");
            return { fullName: a.actorUserId };
          }
        `,
      });
      expect(detectUnguardedGovernedSinks(project)).toEqual([]);
    });

    it("refuses to let a PII read buy its own exemption with an inline audit write", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Contact extends PIIBearing { fullName: string }
          declare const db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
          export async function listContacts(tenant: TenantContext): Promise<Contact[]> {
            await db.query("INSERT INTO pii_access_log (org_id, at) VALUES ($1, now())", [tenant.orgId]);
            const res = await db.query<Contact>("SELECT * FROM contacts WHERE org_id = $1", [tenant.orgId]);
            return res.rows;
          }
        `,
      });
      // The DML is the access record; the PII still comes from a PLAIN read, so
      // the callable is a read boundary and owes pii.view.
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/crm/contacts.ts :: listContacts: boundary must require ActionGrant<"pii.view">`,
      ]);
    });

    it("refuses the exemption when the audit write is MERGED INTO the PII read as a CTE", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface Contact extends PIIBearing { fullName: string }
          declare const db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
          export async function listContacts(tenant: TenantContext): Promise<Contact[]> {
            const res = await db.query<Contact>("WITH logged AS (INSERT INTO pii_access_log (org_id, at) VALUES ($1, now()) RETURNING org_id) SELECT c.* FROM contacts c JOIN logged l ON l.org_id = c.org_id", [tenant.orgId]);
            return res.rows;
          }
        `,
      });
      // ONE statement, both a write and a read. Its RESULT is the SELECT, so the
      // callable is still a PII read boundary — the two-statement form's escape
      // does not reappear by merging the statements.
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/crm/contacts.ts :: listContacts: boundary must require ActionGrant<"pii.view">`,
      ]);
    });

    it("classifies CTE statements by what they RETURN, not by which keyword appears first", () => {
      // A data-modifying CTE whose result is a SELECT is BOTH; one whose result is
      // DML is a pure write; a subquery feeding DML never makes the write a read.
      expect(classifySql("WITH x AS (INSERT INTO a VALUES (1)) SELECT * FROM b")).toEqual(["mutation", "read"]);
      expect(classifySql("WITH d AS (DELETE FROM a RETURNING *) INSERT INTO b SELECT * FROM d")).toEqual(["mutation"]);
      expect(classifySql("WITH x (a, b) AS (SELECT 1, 2) INSERT INTO t SELECT * FROM x")).toEqual(["mutation"]);
      expect(classifySql("DELETE FROM a WHERE id IN (SELECT id FROM b)")).toEqual(["mutation"]);
      expect(classifySql("SELECT * FROM a WHERE id = $1 FOR UPDATE")).toEqual(["locking-read"]);
      expect(classifySql("CREATE INDEX i ON a(b)")).toEqual(["other"]);
    });

    it("keeps the write exemption for a locking pre-image read inside an update", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/principal.ts": `
          import type { TenantContext } from "./tenant";
          export interface WriteActor { tenant: TenantContext; actorUserId: string }
        `,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/contacts.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { WriteActor } from "../../contracts/principal";
          interface Contact extends PIIBearing { fullName: string }
          declare const db: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
          export async function renameContact(a: WriteActor, name: string): Promise<Contact> {
            await db.query<Contact>("SELECT full_name FROM contacts WHERE id = $1 AND org_id = $2 FOR UPDATE", [a.tenant.orgId]);
            const res = await db.query<Contact>("UPDATE contacts SET full_name = $3 WHERE org_id = $2 RETURNING *", [a.tenant.orgId, name]);
            return res.rows[0]!;
          }
          export async function auditQuery(a: WriteActor): Promise<Contact> {
            const res = await db.query<Contact>("SELECT * FROM audit_log WHERE detail = 'update household name' AND org_id = $1", [a.tenant.orgId]);
            return res.rows[0]!;
          }
        `,
      });
      // The FOR UPDATE read belongs to the write that follows it (house-crm's own
      // shape). The second callable is a plain read whose quoted VALUE merely
      // contains "update household name" — data, not a DML head — so it is a sink.
      expect(detectUnguardedGovernedSinks(project)).toEqual([
        `src/infrastructure/crm/contacts.ts :: auditQuery: boundary must require ActionGrant<"pii.view">`,
      ]);
    });

    it("derives a PII sink from a MAP-shaped return and from a class-field arrow", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/infrastructure/crm/clients.ts": `
          import type { PIIBearing } from "../../contracts/pii";
          import type { TenantContext } from "../../contracts/tenant";
          interface ClientRecord extends PIIBearing { fullName: string }
          export async function loadClientsById(tenant: TenantContext): Promise<Record<string, ClientRecord>> {
            return { [tenant.orgId]: { fullName: "x" } };
          }
          export async function loadClientsIndexed(tenant: TenantContext): Promise<{ [key: string]: ClientRecord }> {
            return { [tenant.orgId]: { fullName: "x" } };
          }
          export class ClientStore {
            load = (tenant: TenantContext): ClientRecord[] => [{ fullName: tenant.orgId }];
          }
        `,
      });
      const hits = detectUnguardedGovernedSinks(project);
      for (const name of ["loadClientsById", "loadClientsIndexed", "ClientStore.load"]) {
        expect(hits.some((hit) => hit.includes(`:: ${name}:`)), name).toBe(true);
      }
    });

    it("checks the IMPLEMENTATION of a repository annotated with its domain port", () => {
      const project = inMemoryProject({
        "/src/contracts/authz.ts": `
          export interface ActionGrant<A extends string> { action: A }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> { void value; void action; }
        `,
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/domain/ports/clients.ts": `
          import type { ActionGrant } from "../../contracts/authz";
          import type { PIIBearing } from "../../contracts/pii";
          export interface ClientRecord extends PIIBearing { fullName: string }
          export interface ClientRepository {
            listClients(grant: ActionGrant<"pii.view">): ClientRecord[];
          }
        `,
        "/src/infrastructure/crm/clients.ts": `
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          import type { ClientRepository, ClientRecord } from "../../domain/ports/clients";
          export const clientRepo: ClientRepository = {
            listClients(grant: ActionGrant<"pii.view">): ClientRecord[] {
              assertActionGrant(grant, "pii.view");
              return [];
            },
          };
        `,
      });
      // The port's MethodSignature has no body; the ADAPTER's does, and it asserts
      // the grant. Reading the declared type instead would demand an assertion of a
      // declaration that can never hold one — a remedy the author already followed.
      expect(detectUnguardedGovernedSinks(project)).toEqual([]);

      const unguarded = inMemoryProject({
        "/src/contracts/authz.ts": `
          export interface ActionGrant<A extends string> { action: A }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> { void value; void action; }
        `,
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/domain/ports/clients.ts": `
          import type { ActionGrant } from "../../contracts/authz";
          import type { PIIBearing } from "../../contracts/pii";
          export interface ClientRecord extends PIIBearing { fullName: string }
          export interface ClientRepository {
            listClients(grant: ActionGrant<"pii.view">): ClientRecord[];
          }
        `,
        "/src/infrastructure/crm/clients.ts": `
          import type { ActionGrant } from "../../contracts/authz";
          import type { ClientRepository, ClientRecord } from "../../domain/ports/clients";
          export const clientRepo: ClientRepository = {
            listClients(grant: ActionGrant<"pii.view">): ClientRecord[] { void grant; return []; },
          };
        `,
      });
      // ...and the adapter that SKIPS the assertion still fails.
      expect(detectUnguardedGovernedSinks(unguarded)).toEqual([
        `src/infrastructure/crm/clients.ts :: clientRepo.listClients: assertActionGrant(grant, "pii.view") must appear in the contiguous authority prologue, before any side effect, database call, or branching logic`,
      ]);
    });

    /**
     * THE AUTHORITY PROLOGUE, from the grant side. This fence and the
     * tenant-context-required fence each used to demand their OWN assertion be
     * literally statement #1, so a sink carrying both authorities as explicit
     * parameters could not satisfy both at once. The shared rule accepts any order
     * as long as every required assertion runs before anything else, and additionally
     * requires proof the two authorities name the same tenant.
     */
    const dualAuthoritySink = (body: string): Project =>
      inMemoryProject({
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
          export function assertTenantContext(value: unknown): asserts value is TenantContext { void value; }
          export function assertSameTenant(a: unknown, b: unknown): void { void a; void b; }
        `,
        "/src/contracts/authz.ts": `
          import type { TenantContext } from "./tenant";
          export interface ActionGrant<A extends string> { action: A; tenant: TenantContext }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> { void value; void action; }
        `,
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/infrastructure/crm/people.ts": `
          import { assertSameTenant, assertTenantContext, type TenantContext } from "../../contracts/tenant";
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          import type { PIIBearing } from "../../contracts/pii";
          export interface PersonRecord extends PIIBearing { fullName: string }
          export function listPeople(
            tenant: TenantContext,
            grant: ActionGrant<"pii.view">,
          ): PersonRecord[] {
${body}
          }
        `,
      });

    it("PASSES a dual-authority sink whose prologue is contiguous (previously unbuildable)", () => {
      expect(detectUnguardedGovernedSinks(dualAuthoritySink(`
            assertActionGrant(grant, "pii.view");
            assertTenantContext(tenant);
            assertSameTenant(tenant, grant.tenant);
            return [];
      `))).toEqual([]);
    });

    it("rejects a dual-authority sink whose grant assertion is DELAYED past the prologue", () => {
      expect(detectUnguardedGovernedSinks(dualAuthoritySink(`
            assertTenantContext(tenant);
            const rows: PersonRecord[] = [];
            assertActionGrant(grant, "pii.view");
            assertSameTenant(tenant, grant.tenant);
            return rows;
      `))).toHaveLength(2); // both assertions fell outside the prologue, and both are named
    });

    it("rejects a dual-authority sink that never proves the two name the same tenant", () => {
      expect(detectUnguardedGovernedSinks(dualAuthoritySink(`
            assertTenantContext(tenant);
            assertActionGrant(grant, "pii.view");
            return [];
      `))).toHaveLength(1);
    });

    const multiGrantSink = (params: string, body: string): Project =>
      inMemoryProject({
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
          export function assertSameTenant(a: unknown, b: unknown): void { void a; void b; }
        `,
        "/src/contracts/authz.ts": `
          import type { TenantContext } from "./tenant";
          export interface ActionGrant<A extends string> { action: A; tenant: TenantContext }
          export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> { void value; void action; }
        `,
        "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
        "/src/infrastructure/crm/people.ts": `
          import { assertSameTenant } from "../../contracts/tenant";
          import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
          import type { PIIBearing } from "../../contracts/pii";
          export interface PersonRecord extends PIIBearing { fullName: string }
          export function listPeople(${params}): PersonRecord[] {
${body}
          }
        `,
      });

    describe.each(Object.freeze([
      `executionGrant: ActionGrant<"execution.initiate">, piiGrant: ActionGrant<"pii.view">`,
      `piiGrant: ActionGrant<"pii.view">, executionGrant: ActionGrant<"execution.initiate">`,
    ]))("two grants in either parameter order", (params) => {
      it("PASSES only when both authorities agree", () => {
        expect(detectUnguardedGovernedSinks(multiGrantSink(params, `
            assertActionGrant(executionGrant, "execution.initiate");
            assertActionGrant(piiGrant, "pii.view");
            assertSameTenant(executionGrant.tenant, piiGrant.tenant);
            return [];
        `))).toEqual([]);
      });

      it("rejects when the grant pair is not compared", () => {
        expect(detectUnguardedGovernedSinks(multiGrantSink(params, `
            assertActionGrant(executionGrant, "execution.initiate");
            assertActionGrant(piiGrant, "pii.view");
            return [];
        `))).toHaveLength(1);
      });
    });

    it("requires the exact action assertion for every grant, not only the first", () => {
      expect(detectUnguardedGovernedSinks(multiGrantSink(
        `executionGrant: ActionGrant<"execution.initiate">, piiGrant: ActionGrant<"pii.view">`,
        `
            assertActionGrant(executionGrant, "execution.initiate");
            assertActionGrant(piiGrant, "execution.initiate");
            assertSameTenant(executionGrant.tenant, piiGrant.tenant);
            return [];
        `,
      ))).toHaveLength(1);
    });

    const multiActionRoute = (
      executionAuthorization: string,
      piiAuthorization: string,
    ): Project =>
      inMemoryProject({
        "/src/app/_server/context.ts": `
          export async function requireActionGrant(req: Request, action: string): Promise<any> {
            return { ok: true };
          }
          export function errorResponse(error: unknown): Response {
            return new Response();
          }
        `,
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
          export function assertSameTenant(a: unknown, b: unknown): void { void a; void b; }
        `,
        "/src/contracts/authz.ts": `
          import type { TenantContext } from "./tenant";
          export interface ActionGrant<A extends string> { action: A; tenant: TenantContext }
          export function assertActionGrant<A extends string>(
            value: unknown,
            action: A,
          ): asserts value is ActionGrant<A> {
            void value;
            void action;
          }
        `,
        "/src/infrastructure/wire.ts": `
          import { assertActionGrant, type ActionGrant } from "../contracts/authz";
          import { assertSameTenant } from "../contracts/tenant";
          export function startAccountOpening(
            db: unknown,
            executionGrant: ActionGrant<"execution.initiate">,
            piiGrant: ActionGrant<"pii.view">,
          ): unknown {
            assertActionGrant(executionGrant, "execution.initiate");
            assertActionGrant(piiGrant, "pii.view");
            assertSameTenant(executionGrant.tenant, piiGrant.tenant);
            return { db, executionGrant, piiGrant };
          }
        `,
        "/src/app/api/accounts/route.ts": `
          import { requireActionGrant, errorResponse } from "@app/_server/context";
          import { startAccountOpening } from "@infra/wire";
          export async function POST(req: Request) {
            ${executionAuthorization}
            ${piiAuthorization}
            return startAccountOpening({}, execution.value, pii.value);
          }
        `,
      });

    it.each([
      {
        missing: "pii.view",
        execution: `const execution = await requireActionGrant(req, "execution.initiate");
            if (!execution.ok) return errorResponse(execution.error);`,
        pii: "",
      },
      {
        missing: "execution.initiate",
        execution: "",
        pii: `const pii = await requireActionGrant(req, "pii.view");
            if (!pii.ok) return errorResponse(pii.error);`,
      },
    ])("retains every action when a multi-action route omits $missing", ({
      missing,
      execution,
      pii,
    }) => {
      const project = multiActionRoute(execution, pii);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.entries.map((entry) => entry.action).sort()).toEqual([
        "execution.initiate",
        "pii.view",
      ]);
      const violations = detectUnwiredGovernedRoutes(project, discovered.entries);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain(`"${missing}"`);
    });

    it("passes a multi-action route only when both grants reach their positions", () => {
      const project = multiActionRoute(
        `const execution = await requireActionGrant(req, "execution.initiate");
            if (!execution.ok) return errorResponse(execution.error);`,
        `const pii = await requireActionGrant(req, "pii.view");
            if (!pii.ok) return errorResponse(pii.error);`,
      );
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.entries.map((entry) => entry.action).sort()).toEqual([
        "execution.initiate",
        "pii.view",
      ]);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toEqual([]);
    });

    it("requires all three grant pairs before work", () => {
      const params = `executionGrant: ActionGrant<"execution.initiate">,
            piiGrant: ActionGrant<"pii.view">,
            auditGrant: ActionGrant<"audit.export">`;
      const assertions = [
        `assertActionGrant(executionGrant, "execution.initiate");`,
        `assertActionGrant(piiGrant, "pii.view");`,
        `assertActionGrant(auditGrant, "audit.export");`,
      ];
      const pairs = [
        `assertSameTenant(executionGrant.tenant, piiGrant.tenant);`,
        `assertSameTenant(executionGrant.tenant, auditGrant.tenant);`,
        `assertSameTenant(piiGrant.tenant, auditGrant.tenant);`,
      ];
      expect(detectUnguardedGovernedSinks(multiGrantSink(params, `
            ${[...assertions, ...pairs].join("\n            ")}
            return [];
      `))).toEqual([]);
      for (const omitted of pairs) {
        expect(detectUnguardedGovernedSinks(multiGrantSink(params, `
            ${[...assertions, ...pairs.filter((pair) => pair !== omitted)].join("\n            ")}
            return [];
        `))).toHaveLength(1);
      }
    });

    it("rejects a conditional wrapped grant beside a direct governed grant", () => {
      const params = `executionGrant: ActionGrant<"execution.initiate">,
            wrapped: { piiGrant: ActionGrant<"pii.view"> } | { token: string }`;
      const violations = detectUnguardedGovernedSinks(multiGrantSink(params, `
            assertActionGrant(executionGrant, "execution.initiate");
            return [];
      `));
      expect(violations).toHaveLength(1);
    });

    it("attributes a sink called from a route-LOCAL helper to its exported handler", () => {
      const project = governedDiscoveryProject(`
        import { requireActionGrant, errorResponse } from "@app/_server/context";
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        async function loadChain(db: unknown, grant: unknown) {
          return verifyAndListOrgChain(db, grant as never);
        }
        export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          return loadChain({}, auth.value);
        }
      `);
      const { entries, violations } = discoverGovernedRoutes(project);
      // Ordinary decomposition, not a new surface: the sink belongs to GET.
      expect(violations).toEqual([]);
      expect(entries.map((entry) => entry.handler)).toEqual(["GET"]);
    });

    it.each([
      `
        let load: typeof verifyAndListOrgChain;
        load = verifyAndListOrgChain;
        return load({}, auth.value);
      `,
      `
        let load: typeof verifyAndListOrgChain;
        load = verifyAndListOrgChain;
        function selected() {
          return load;
        }
        return selected()({}, auth.value);
      `,
      `
        const reader = {} as { load: typeof verifyAndListOrgChain };
        reader.load = verifyAndListOrgChain;
        return reader.load({}, auth.value);
      `,
    ])("attributes sinks reached through later assignments and helper returns", (work) => {
      const project = governedDiscoveryProject(`
        import { requireActionGrant, errorResponse } from "@app/_server/context";
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "audit.export");
          if (!auth.ok) return errorResponse(auth.error);
          ${work}
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries.map((entry) => entry.handler)).toEqual(["GET"]);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toEqual([]);
    });

    it.each([
      `
        let load: typeof verifyAndListOrgChain;
        load = verifyAndListOrgChain;
        return load({}, {} as never);
      `,
      `
        let load: typeof verifyAndListOrgChain;
        load = verifyAndListOrgChain;
        function selected() {
          return load;
        }
        return selected()({}, {} as never);
      `,
      `
        const reader = {} as { load: typeof verifyAndListOrgChain };
        reader.load = verifyAndListOrgChain;
        return reader.load({}, {} as never);
      `,
    ])("rejects unwired sinks reached through later assignments and helper returns", (work) => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        export async function GET(req: Request) {
          void req;
          ${work}
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      expect(discovered.violations).toEqual([]);
      expect(discovered.entries.map((entry) => entry.handler)).toEqual(["GET"]);
      expect(detectUnwiredGovernedRoutes(project, discovered.entries)).toHaveLength(1);
    });

    it("rejects a helper-returned governed sink passed beyond its visible call site", () => {
      const project = governedDiscoveryProject(`
        import { verifyAndListOrgChain } from "@infra/audit/audit-store";
        declare function invoke(value: unknown): unknown;
        function selected() {
          return verifyAndListOrgChain;
        }
        export async function GET(req: Request) {
          void req;
          return invoke(selected());
        }
      `);
      expect(discoverGovernedRoutes(project).violations.some((violation) =>
        violation.includes("passed as a VALUE")
      )).toBe(true);
    });

    it("does not call a sink INVOKED inside a callback argument an escaped value", () => {
      const repositoryProject = (route: string): Project =>
        inMemoryProject({
          "/src/app/_server/context.ts": `
            export async function requireActionGrant(req: Request, action: string): Promise<any> { return { ok: true }; }
            export function errorResponse(error: unknown): Response { return new Response(); }
          `,
          "/src/contracts/authz.ts": `
            export interface ActionGrant<A extends string> { action: A }
            export function assertActionGrant<A extends string>(value: unknown, action: A): asserts value is ActionGrant<A> { void value; void action; }
          `,
          "/src/contracts/pii.ts": `export interface PIIBearing { readonly pii?: "bearing" }`,
          "/src/infrastructure/new-adapter/repository.ts": `
            import { assertActionGrant, type ActionGrant } from "../../contracts/authz";
            import type { PIIBearing } from "../../contracts/pii";
            export interface ClientRecord extends PIIBearing { fullName: string }
            export const clientRepo = {
              listClients(grant: ActionGrant<"pii.view">): ClientRecord[] {
                assertActionGrant(grant, "pii.view");
                return [];
              },
            };
          `,
          "/src/app/api/clients/route.ts": route,
        });

      const project = repositoryProject(`
        import { requireActionGrant, errorResponse } from "@app/_server/context";
        import { clientRepo as repo } from "@infra/new-adapter/repository";
        declare function withSpan<T>(name: string, fn: () => T): T;
        export async function GET(req: Request) {
          const auth = await requireActionGrant(req, "pii.view");
          if (!auth.ok) return errorResponse(auth.error);
          return withSpan("clients.list", () => repo.listClients(auth.value));
        }
      `);
      const discovered = discoverGovernedRoutes(project);
      // Non-vacuity: the sink really is derived, so "no violation" is a verdict.
      expect(discovered.entries.map((entry) => entry.sink)).toEqual(["clientRepo.listClients"]);
      expect(discovered.violations).toEqual([]);

      // The genuinely escaped shape still fails: no call site left to authorize.
      const escaped = repositoryProject(`
        import { clientRepo as repo } from "@infra/new-adapter/repository";
        declare function runReport(loader: unknown): unknown;
        export async function GET() {
          return runReport({ load: repo.listClients });
        }
      `);
      expect(
        discoverGovernedRoutes(escaped).violations.some((v) => v.includes("passed as a VALUE")),
      ).toBe(true);
    });

    it("passes a correctly wired route whose sink is an owner.property member", () => {
      const project = inMemoryProject({
        "/src/app/_server/context.ts": `
          export async function requireActionGrant(req: Request, action: string): Promise<any> {
            return { ok: true };
          }
          export function errorResponse(error: unknown): Response {
            return new Response();
          }
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          export const clientRepo = {
            listClients(scope: unknown): unknown { return scope; },
          };
        `,
        "/src/app/api/clients/route.ts": `
          import { requireActionGrant, errorResponse } from "@app/_server/context";
          import { clientRepo as repo } from "@infra/new-adapter/repository";
          export async function GET(req: Request) {
            const auth = await requireActionGrant(req, "pii.view");
            if (!auth.ok) return errorResponse(auth.error);
            return repo.listClients(auth.value.grant.tenant);
          }
        `,
      });
      expect(detectUnwiredGovernedRoutes(project, [{
        file: "src/app/api/clients/route.ts",
        handler: "GET",
        action: "pii.view",
        sink: "clientRepo.listClients",
        sinkFile: "src/infrastructure/new-adapter/repository.ts",
      }])).toEqual([]);
    });
  });
});
