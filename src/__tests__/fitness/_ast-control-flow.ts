import { Node, SyntaxKind, type Statement } from "ts-morph";

function literalBoolean(node: Node): boolean | undefined {
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  if (node.getKind() === SyntaxKind.FalseKeyword) return false;
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isTypeAssertion(node) ||
    Node.isNonNullExpression(node) ||
    Node.isSatisfiesExpression(node)
  ) {
    return literalBoolean(node.getExpression());
  }
  if (
    Node.isPrefixUnaryExpression(node) &&
    node.getOperatorToken() === SyntaxKind.ExclamationToken
  ) {
    const value = literalBoolean(node.getOperand());
    return value === undefined ? undefined : !value;
  }
  return undefined;
}

function statementsMayExit(statements: readonly Statement[]): boolean {
  return statements.some(statementMayExit);
}

/**
 * Can this statement return or throw? EXPORTED so a caller that sanctions ONE
 * reviewed early exit can find every exit itself and judge each by identity,
 * rather than by loosening the reachability rule below for all of them.
 */
export function statementMayExit(statement: Statement): boolean {
  if (Node.isReturnStatement(statement) || Node.isThrowStatement(statement)) {
    return true;
  }
  if (Node.isBlock(statement)) {
    return statementsMayExit(statement.getStatements());
  }
  if (Node.isIfStatement(statement)) {
    const condition = literalBoolean(statement.getExpression());
    if (condition === true) {
      return statementMayExit(statement.getThenStatement());
    }
    if (condition === false) {
      const alternative = statement.getElseStatement();
      return alternative === undefined ? false : statementMayExit(alternative);
    }
    return (
      statementMayExit(statement.getThenStatement()) ||
      (statement.getElseStatement() !== undefined &&
        statementMayExit(statement.getElseStatement()!))
    );
  }
  if (Node.isTryStatement(statement)) {
    return (
      statementsMayExit(statement.getTryBlock().getStatements()) ||
      (statement.getCatchClause() !== undefined &&
        statementsMayExit(
          statement.getCatchClause()!.getBlock().getStatements(),
        )) ||
      (statement.getFinallyBlock() !== undefined &&
        statementsMayExit(statement.getFinallyBlock()!.getStatements()))
    );
  }
  if (Node.isSwitchStatement(statement)) {
    return statement
      .getCaseBlock()
      .getClauses()
      .some((clause) => statementsMayExit(clause.getStatements()));
  }
  if (Node.isWhileStatement(statement)) {
    return (
      literalBoolean(statement.getExpression()) !== false &&
      statementMayExit(statement.getStatement())
    );
  }
  if (
    Node.isDoStatement(statement) ||
    Node.isForStatement(statement) ||
    Node.isForInStatement(statement) ||
    Node.isForOfStatement(statement)
  ) {
    return statementMayExit(statement.getStatement());
  }
  if (Node.isLabeledStatement(statement) || Node.isWithStatement(statement)) {
    return statementMayExit(statement.getStatement());
  }
  return false;
}

function contains(container: Node, node: Node): boolean {
  return container === node || node.getAncestors().includes(container);
}

/**
 * `exempt` names statements a caller has ALREADY judged individually - a reviewed
 * conditional refusal it admits by identity. Everything else that may exit before
 * `node` still makes it unreachable, so exempting one statement can never widen the
 * rule to the next author's early return.
 */
export function isProvablyReachable(
  node: Node,
  boundary: Node,
  exempt: readonly Node[] = [],
): boolean {
  for (const ancestor of node.getAncestors()) {
    if (ancestor === boundary) break;
    if (Node.isIfStatement(ancestor)) {
      const condition = literalBoolean(ancestor.getExpression());
      const inThen = contains(ancestor.getThenStatement(), node);
      if (
        (inThen && condition !== true) ||
        (!inThen && condition !== false)
      ) {
        return false;
      }
    }
    if (Node.isConditionalExpression(ancestor)) {
      const condition = literalBoolean(ancestor.getCondition());
      const inTrue = contains(ancestor.getWhenTrue(), node);
      if (
        (inTrue && condition !== true) ||
        (!inTrue && condition !== false)
      ) {
        return false;
      }
    }
    if (Node.isBlock(ancestor)) {
      const statements = ancestor.getStatements();
      const index = statements.findIndex((statement) =>
        contains(statement, node),
      );
      const preceding = statements
        .slice(0, Math.max(index, 0))
        .filter((statement) => !exempt.includes(statement));
      if (index > 0 && statementsMayExit(preceding)) {
        return false;
      }
    }
  }
  return true;
}
