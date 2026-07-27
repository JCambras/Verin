import { describe, it, expect } from "vitest";
import { relative } from "node:path";
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
  realSemanticProject,
  inMemoryProject,
  REPO_ROOT,
} from "./_fence-utils";
import { GOVERNED_ACTIONS } from "@contracts/authz";
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
}

function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
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
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
}

/**
 * Every declaration a callee expression can reach. getAliasedSymbol() unwraps
 * import/export aliases only, so a one-line LOCAL alias
 * (`const listChain = verifyAndListOrgChain`) would otherwise hide a governed
 * sink from discovery — and a route that is never discovered is never checked.
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
  const symbol = expression.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  const declarations = target?.getDeclarations() ?? [];
  const out = [...declarations];
  for (const declaration of declarations) {
    if (!Node.isVariableDeclaration(declaration)) continue;
    const initializer = declaration.getInitializer();
    if (initializer) out.push(...resolveCallTargets(initializer, seen));
  }
  return out;
}

function governedSinkForCall(
  call: CallExpression,
  sinks: readonly GovernedSink[],
): GovernedSink | null {
  const targets = resolveCallTargets(call.getExpression());
  return sinks.find((sink) =>
    targets.some((declaration) =>
      sink.anchors.some((anchor) => nodeKey(declaration) === nodeKey(anchor))
    )
  ) ?? null;
}

/**
 * Does this call reach the entry's governed sink? Symbol-anchored, never text:
 * sink names are built as `owner.property`, which never equals the callee text
 * of `store.load(…)` or an aliased `repo.listClients(…)`, so a text comparison
 * fails permanently on CORRECTLY wired code and forces the first escape.
 */
function callMatchesSink(call: CallExpression, entry: GovernedRouteEntry): boolean {
  const expected = entry.sink.split(".").pop()!;
  const targets = resolveCallTargets(call.getExpression());
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
    const key = `${current.getText()}::${current.getFlags()}`;
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

function containsDeclaredType(
  type: Type,
  file: string,
  name: string,
): boolean {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.getText()}::${current.getFlags()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (declaredAs(current, file, name)) return true;
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
  return false;
}

function governedOutputAction(type: Type): string | null {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.getText()}::${current.getFlags()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (declaredAs(current, "src/contracts/authz.ts", "GovernedOutput")) {
      const action = current.getTypeArguments()[0];
      if (action?.isStringLiteral()) {
        const value = action.getLiteralValue();
        return typeof value === "string" ? value : null;
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
  return null;
}

function actionGrantAction(signature: Signature): string | null {
  for (const parameter of signature.getParameters()) {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    if (!declaration) continue;
    for (const action of V3_15_3_ACTIONS) {
      if (
        actionGrantParameter(parameter.getTypeAtLocation(declaration), action)
      ) {
        return action;
      }
    }
  }
  return null;
}

function hasTenantBoundaryParameter(signature: Signature): boolean {
  return signature.getParameters().some((parameter) => {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    if (!declaration) return false;
    const type = parameter.getTypeAtLocation(declaration);
    return declaredAs(type, "src/contracts/tenant.ts", "TenantContext") ||
      declaredAs(type, "src/contracts/principal.ts", "WriteActor") ||
      declaredAs(type, "src/contracts/authz.ts", "ActionGrant");
  });
}

// STATEMENT-ANCHORED. An unanchored /\bUPDATE\b/ matches the trailing row-lock
// clause of `SELECT … FOR UPDATE` — the idiom already live in house-crm.ts — and
// would silently drop that PII read out of governed-sink derivation.
const SQL_MUTATION_RE = /^\s*(?:--[^\n]*\n\s*)*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i;
const SQL_EXECUTOR_METHODS = new Set(["exec", "execute", "query"]);

function mutatesSql(sql: string): boolean {
  return sql.split(";").some((statement) => SQL_MUTATION_RE.test(statement));
}

/** A resolved SQL-executor call: `db.query(sql, …)` / `tx.exec(sql)`. */
function isSqlExecutorCall(call: CallExpression): boolean {
  const expression = call.getExpression();
  if (
    !Node.isPropertyAccessExpression(expression) ||
    !SQL_EXECUTOR_METHODS.has(expression.getName())
  ) {
    return false;
  }
  return expression.getType().getCallSignatures().some((signature) => {
    const parameter = signature.getParameters()[0];
    const declaration = parameter?.getValueDeclaration() ??
      parameter?.getDeclarations()[0];
    return Boolean(parameter && declaration &&
      parameter.getTypeAtLocation(declaration).isString());
  });
}

/**
 * SQL text in the STATEMENT SLOT of a resolved SQL executor. Classifying from
 * the AST (not from declaration.getText(), and not from every string argument of
 * every call) is what keeps the write exemption from being one word wide: an
 * identifier named `update`, a `.update()` method call, prose saying "nothing to
 * update", and a `FOR UPDATE` row lock are all reads.
 */
function sqlStatementTexts(declaration: Node): string[] {
  return declaration.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(isSqlExecutorCall)
    .flatMap((call) => {
      const argument = call.getArguments()[0];
      if (!argument) return [];
      if (
        Node.isStringLiteral(argument) ||
        Node.isNoSubstitutionTemplateLiteral(argument)
      ) {
        return [argument.getLiteralValue()];
      }
      return Node.isTemplateExpression(argument) ? [argument.getText()] : [];
    });
}

/**
 * A callable is exempt from `pii.view` only when it issues a REAL DML statement
 * through a resolved SQL executor. Calling auditedWrite is deliberately NOT a
 * mutation signal on its own: it would mean that adding a PII-access audit
 * record to a read DELETES that read's authorization requirement — the more
 * auditable the read, the less authorized it must be. Genuine writers reach a
 * DML statement anyway (house-CRM writers pass INSERT/UPDATE to tx.query inside
 * auditedWrite's `perform`), so nothing legitimate depends on that signal.
 */
function mutatesPersistence(declaration: Node): boolean {
  return sqlStatementTexts(declaration).some(mutatesSql);
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
    if (!declaration) continue;
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
    callables.push(
      ...semanticCallables(variable.getType(), variable.getName(), [variable]),
    );
  }
  for (const cls of sf.getClasses().filter((candidate) => candidate.isExported())) {
    for (const method of cls.getMethods()) {
      if (method.getScope() === "private" || method.getScope() === "protected") continue;
      callables.push({
        name: `${cls.getName() ?? "<anonymous>"}.${method.getName()}`,
        declaration: method,
        signature: method.getSignature(),
        anchors: [method],
      });
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
  return callables;
}

export function deriveGovernedSinks(project: Project): GovernedSink[] {
  const sinks: GovernedSink[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = normalizedPath(sf.getFilePath());
    if (!file.startsWith("src/infrastructure/")) continue;
    for (const callable of exportedCallables(sf)) {
      const grantAction = actionGrantAction(callable.signature);
      const outputAction = governedOutputAction(callable.signature.getReturnType());
      const returnsPii = containsDeclaredType(
        callable.signature.getReturnType(),
        "src/contracts/pii.ts",
        "PIIBearing",
      );
      const inferredAction = outputAction ??
        (returnsPii &&
          hasTenantBoundaryParameter(callable.signature) &&
          !mutatesPersistence(callable.declaration)
          ? "pii.view"
          : null);
      const action = inferredAction ?? grantAction;
      if (action) sinks.push({ file, action, ...callable });
    }
  }
  return sinks;
}

export function detectUnguardedGovernedSinks(project: Project): string[] {
  const out: string[] = [];
  for (const sink of deriveGovernedSinks(project)) {
    const grant = sink.signature.getParameters().find((parameter) => {
      const declaration = parameter.getValueDeclaration() ??
        parameter.getDeclarations()[0];
      return Boolean(declaration &&
        actionGrantParameter(
          parameter.getTypeAtLocation(declaration),
          sink.action,
        ));
    });
    const declaration = sink.declaration;
    const body = Node.isFunctionDeclaration(declaration) ||
        Node.isMethodDeclaration(declaration) ||
        Node.isArrowFunction(declaration) ||
        Node.isFunctionExpression(declaration)
      ? declaration.getBody()
      : undefined;
    if (!Node.isBlock(body) || !grant) {
      out.push(
        `${sink.file} :: ${sink.name}: boundary must require ActionGrant<"${sink.action}">`,
      );
      continue;
    }
    const firstStatement = body.getStatements()[0];
    const expression = firstStatement && Node.isExpressionStatement(firstStatement)
      ? firstStatement.getExpression()
      : null;
    const args = expression && Node.isCallExpression(expression)
      ? expression.getArguments()
      : [];
    const assertionIsFirstStatement = expression &&
      Node.isCallExpression(expression) &&
      callResolvesTo(
        expression,
        "src/contracts/authz.ts",
        "assertActionGrant",
      ) &&
      args[0]?.getText() === grant.getName() &&
      Node.isStringLiteral(args[1]) &&
      args[1].getLiteralValue() === sink.action;
    if (!assertionIsFirstStatement) {
      out.push(
        `${sink.file} :: ${sink.name}: first statement must assert ActionGrant<"${sink.action}">`,
      );
    }
  }
  return out;
}

const APP_SURFACE_RE = /^src\/app\/.*\.tsx?$/;
const ROUTE_HANDLER_RE = /^src\/app\/.*\/route\.ts$/;

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
 */
const UNSUPPORTED_SURFACE_RULE =
  "governed sinks are reachable only from a route handler (src/app/**/route.ts): " +
  "requireActionGrant needs the framework's NextRequest, which a Server Action or " +
  "server component never has";

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
    if (!APP_SURFACE_RE.test(file)) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const sink = governedSinkForCall(call, sinks);
      if (!sink) continue;
      if (!ROUTE_HANDLER_RE.test(file)) {
        violations.push(
          `${file}:${call.getStartLineNumber()}: governed sink '${sink.name}' on an unsupported surface — ${UNSUPPORTED_SURFACE_RULE}`,
        );
        continue;
      }
      const handler = call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
      if (!handler?.isExported() || !handler.getName()) {
        violations.push(
          `${file}:${call.getStartLineNumber()}: governed sink '${sink.name}' must be called inside an exported app-surface handler`,
        );
        continue;
      }
      entries.push({
        file,
        handler: handler.getName()!,
        action: sink.action,
        sink: sink.name,
        sinkFile: sink.file,
      });
    }
  }
  return {
    entries: entries.filter((entry, index) =>
      entries.findIndex((candidate) =>
        candidate.file === entry.file &&
        candidate.handler === entry.handler &&
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

function authDeclaration(
  statement: Statement,
  action: string,
  handlerParameters: ReadonlySet<string>,
): { variable: string; declaration: Node } | null {
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
  if (
    !request ||
    !Node.isIdentifier(request) ||
    !handlerParameters.has(request.getText()) ||
    !Node.isStringLiteral(args[1]) ||
    args[1].getLiteralValue() !== action
  ) {
    return null;
  }
  return { variable: declaration.getName(), declaration };
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
    const sf = project.getSourceFiles().find((f) => {
      const rel = relative(REPO_ROOT, f.getFilePath()).replace(/\\/g, "/");
      const normalized = rel.startsWith("..") ? f.getFilePath().replace(/^\//, "") : rel;
      return normalized === entry.file;
    });
    if (!sf) {
      out.push(`${entry.file}: file missing (surfaced action '${entry.action}' has no route)`);
      continue;
    }
    const handler = sf.getFunction(entry.handler);
    if (!handler?.isExported() || !handler.getBody()) {
      out.push(`${entry.file}: exported ${entry.handler} handler missing`);
      continue;
    }
    const body = handler.getBodyOrThrow();
    if (!Node.isBlock(body)) {
      out.push(`${entry.file} :: ${entry.handler}: handler body must be a block`);
      continue;
    }
    const statements = body.getStatements();
    const handlerParameters = new Set(
      handler.getParameters().map((parameter) => parameter.getName()),
    );
    const auth = statements[0]
      ? authDeclaration(statements[0], entry.action, handlerParameters)
      : null;
    if (!auth) {
      out.push(
        `${entry.file} :: ${entry.handler}: first statement must bind requireActionGrant(req, "${entry.action}")`,
      );
      continue;
    }
    if (!statements[1] || !isFailClosedGuard(statements[1], auth.variable)) {
      out.push(
        `${entry.file} :: ${entry.handler}: authorization result must be fail-closed before route work`,
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
    const referencesAuthorization = (node: Node): boolean => {
      const identifiers = [
        ...(Node.isIdentifier(node) ? [node] : []),
        ...node.getDescendantsOfKind(SyntaxKind.Identifier),
      ];
      return identifiers.some((identifier) => {
        const symbol = identifier.getSymbol();
        const target = symbol?.getAliasedSymbol() ?? symbol;
        const keys = (target?.getDeclarations() ?? []).map(nodeKey);
        if (keys.some((key) => derivedKeys.has(key))) return true;
        if (!keys.includes(authKey)) return false;
        const parent = identifier.getParent();
        return Node.isPropertyAccessExpression(parent) &&
          parent.getExpression() === identifier &&
          parent.getName() === "value";
      });
    };
    for (const statement of statements.slice(2)) {
      if (!Node.isVariableStatement(statement)) continue;
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (initializer && referencesAuthorization(initializer)) {
          derivedKeys.add(nodeKey(declaration));
        }
      }
    }
    const authorizedSink = statements.slice(2)
      .flatMap((statement) =>
        statement.getDescendantsOfKind(SyntaxKind.CallExpression)
      )
      .some((call) =>
        callMatchesSink(call, entry) &&
        call.getArguments().some(referencesAuthorization)
      );
    if (!authorizedSink) {
      out.push(
        `${entry.file} :: ${entry.handler}: authorized value does not reach '${entry.sink}'`,
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

  it("enforces: governed sinks validate action-scoped grants at their execution boundaries", () => {
    const violations = detectUnguardedGovernedSinks(realSemanticProject());
    expect(
      violations,
      `unguarded governed sinks:\n${violations.join("\n")}`,
    ).toEqual([]);
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
      const project = governedTestProject(
        `export async function GET(req: Request) { const a = await requireActionGrant(req, "pii.view"); }`,
      );
      const v = detectUnwiredGovernedRoutes(project, [{ file: "src/app/api/audit/route.ts", handler: "GET", action: "audit.export", sink: "listEverything" }]);
      expect(v.length).toBe(1);
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
          `src/infrastructure/crm/house-crm.ts :: listHouseholds: first statement must assert ActionGrant<"pii.view">`
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
