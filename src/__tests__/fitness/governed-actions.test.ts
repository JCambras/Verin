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
  detectAppLayerSqlAccess,
  isSqlExecutorCall,
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
  /**
   * Which parameter of the sink is its ActionGrant. THAT argument must carry the
   * authorized value — "some argument mentions auth.value" would let a route pass
   * `listHouseholds(scopedDb(auth.value.tenant), body.value.grant)`, where the
   * grant itself is client-supplied.
   */
  readonly grantIndex?: number | null;
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
  if (Node.isConditionalExpression(expression)) {
    return [
      ...resolveCallTargets(expression.getWhenTrue(), seen),
      ...resolveCallTargets(expression.getWhenFalse(), seen),
    ];
  }
  // `[listHouseholds][0](…)` — every element is a possible callee.
  if (Node.isElementAccessExpression(expression)) {
    const receiver = expression.getExpression();
    if (Node.isArrayLiteralExpression(receiver)) {
      return receiver.getElements().flatMap((element) =>
        resolveCallTargets(element, seen)
      );
    }
  }
  const symbol = expression.getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  const declarations = target?.getDeclarations() ?? [];
  const out = [...declarations];
  for (const declaration of declarations) {
    if (
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

/** The parameter POSITION of the sink's `ActionGrant<action>`, or null if it has none. */
function actionGrantParameterIndex(
  signature: Signature,
  action: string,
): number | null {
  const parameters = signature.getParameters();
  for (const [index, parameter] of parameters.entries()) {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    if (
      declaration &&
      actionGrantParameter(parameter.getTypeAtLocation(declaration), action)
    ) {
      return index;
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

// A DML head, matched against a statement whose row-LOCK clause has been removed
// first. `SELECT … FOR UPDATE` — the idiom already live in house-crm.ts — is a
// read, and treating it as a write would silently drop that PII read out of
// governed-sink derivation. Anchoring at the statement start instead is not the
// answer either: `WITH d AS (DELETE FROM …) INSERT INTO …` is a genuine write
// whose first token is WITH, and a `/* … */`-prefixed statement is a write whose
// first token is a comment. So: strip comments and the lock clause, then look for
// a DML head anywhere in what remains.
const SQL_ROW_LOCK_RE = /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b|\bFOR\s+(?:KEY\s+)?SHARE\b/gi;
const SQL_MUTATION_RE =
  /\b(?:INSERT\s+INTO|UPDATE\s+(?:ONLY\s+)?["\w]|DELETE\s+FROM|TRUNCATE\b)/i;

function mutatesSql(sql: string): boolean {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .split(";")
    .some((statement) =>
      SQL_MUTATION_RE.test(statement.replace(SQL_ROW_LOCK_RE, " "))
    );
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
      const argument = call.getArguments()[0];
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

/** The exported handler a call sits inside — `export function GET` or `export const GET = async (req) => …`. */
function enclosingHandlerName(call: CallExpression): string | null {
  for (const ancestor of call.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor)) {
      return ancestor.isExported() ? ancestor.getName() ?? null : null;
    }
    if (Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor)) {
      const declaration = ancestor.getParent();
      // A nested arrow (a withSpan callback) is still INSIDE its handler: keep
      // walking unless this arrow is itself the exported handler.
      if (Node.isVariableDeclaration(declaration) && declaration.isExported()) {
        return declaration.getName();
      }
    }
  }
  return null;
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
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    for (const argument of call.getArguments()) {
      for (const node of [argument, ...argument.getDescendants()]) {
        if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node)) continue;
        const parent = node.getParent();
        // Invoked right here (`f(() => sink(…))`, `f(sink(…))`), or the `.name`
        // half of a property access whose whole expression is checked separately.
        if (Node.isCallExpression(parent) && parent.getExpression() === node) continue;
        if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) continue;
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
      const sink = governedSinkForCall(call, sinks);
      if (!sink) continue;
      if (unsupported) {
        violations.push(
          `${file}:${call.getStartLineNumber()}: governed sink '${sink.name}' on an unsupported surface (${unsupported}) — ${UNSUPPORTED_SURFACE_RULE}`,
        );
        continue;
      }
      const handler = enclosingHandlerName(call);
      if (!handler) {
        violations.push(
          `${file}:${call.getStartLineNumber()}: governed sink '${sink.name}' must be called inside an exported app-surface handler`,
        );
        continue;
      }
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
    const sf = project.getSourceFiles().find((f) => {
      const rel = relative(REPO_ROOT, f.getFilePath()).replace(/\\/g, "/");
      const normalized = rel.startsWith("..") ? f.getFilePath().replace(/^\//, "") : rel;
      return normalized === entry.file;
    });
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
    const referencesAuthorization = (node: Node): boolean => {
      const identifiers = [
        ...(Node.isIdentifier(node) ? [node] : []),
        ...node.getDescendantsOfKind(SyntaxKind.Identifier),
      ];
      return identifiers.some((identifier) => {
        const keys = declarationKeys(identifier);
        if (keys.some((key) => derivedKeys.has(key))) return true;
        if (!keys.includes(authKey)) return false;
        const parent = identifier.getParent();
        return Node.isPropertyAccessExpression(parent) &&
          parent.getExpression() === identifier &&
          parent.getName() === "value";
      });
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
        if (referencesAuthorization(initializer)) {
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
    const authorizedSink = routeWork
      .flatMap((statement) =>
        statement.getDescendantsOfKind(SyntaxKind.CallExpression)
      )
      .some((call) => {
        if (!callMatchesSink(call, entry)) return false;
        const args = call.getArguments();
        // The GRANT argument specifically — not "some argument".
        if (entry.grantIndex === undefined || entry.grantIndex === null) {
          return args.some(referencesAuthorization);
        }
        const grantArgument = args[entry.grantIndex];
        return Boolean(grantArgument && referencesAuthorization(grantArgument));
      });
    if (!authorizedSink) {
      out.push(
        `${entry.file} :: ${entry.handler}: authorized value does not reach the ActionGrant parameter of '${entry.sink}'`,
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

    it("does not mistake a same-named non-SQL method for persistence", () => {
      const project = inMemoryProject({
        "/src/app/api/audit/route.ts": `
          const cache = { query(spec: { id: string }): string { return spec.id; } };
          export async function GET() { return cache.query({ id: "x" }); }
        `,
      });
      expect(detectAppLayerSqlAccess(project)).toEqual([]);
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
