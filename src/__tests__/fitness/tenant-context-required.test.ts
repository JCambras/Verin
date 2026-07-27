import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import {
  Node,
  SyntaxKind,
  ts,
  type Project,
  type Signature,
  type SourceFile,
  type Type,
} from "ts-morph";
import {
  realSemanticProject,
  inMemoryProject,
  REPO_ROOT,
} from "./_fence-utils";

const REVIEWED_ESCAPES: Array<{ ref: string; why: string }> = [
  { ref: "src/infrastructure/store/db.ts :: createDbFromDump", why: "global database restoration factory" },
  { ref: "src/infrastructure/store/db.ts :: createDb", why: "global database connection factory" },
  { ref: "src/infrastructure/store/db.ts :: getDb", why: "global database singleton factory" },
  { ref: "src/infrastructure/store/db.ts :: createMemoryDb", why: "isolated test database factory" },
  { ref: "src/infrastructure/store/migrations.ts :: runMigrations", why: "global schema management" },
  { ref: "src/infrastructure/identity/identity-store.ts :: findUserByEmail", why: "login resolves the tenant from the identity row" },
  { ref: "src/infrastructure/identity/identity-store.ts :: getPasswordHash", why: "user-PK capability before authentication" },
  { ref: "src/infrastructure/identity/identity-store.ts :: authenticate", why: "identity boundary that produces the sealed tenant" },
  { ref: "src/infrastructure/identity/identity-store.ts :: revokeSession", why: "session-id capability" },
  { ref: "src/infrastructure/identity/identity-store.ts :: renewSession", why: "session-id capability rotation" },
  { ref: "src/infrastructure/identity/identity-store.ts :: deleteDeadSessions", why: "global session maintenance" },
  { ref: "src/infrastructure/identity/session.ts :: resolveSession", why: "signed-cookie identity boundary" },
  { ref: "src/infrastructure/identity/session.ts :: resolveAndRenewSession", why: "signed-cookie identity boundary" },
  { ref: "src/infrastructure/identity/session.ts :: signSessionCookie", why: "pure signed-cookie creation" },
  { ref: "src/infrastructure/identity/session.ts :: parseSignedCookie", why: "pure signed-cookie verification" },
  { ref: "src/infrastructure/identity/session.ts :: requireRole", why: "pure role authorization" },
  { ref: "src/infrastructure/crm/application-store.ts :: getApplicationByToken", why: "e-sign capability load" },
  { ref: "src/infrastructure/store/execution-store.ts :: makeExecutionStore", why: "factory whose returned port is checked independently" },
  { ref: "src/infrastructure/store/execution-store.ts :: makeExecutionStore.loadByToken", why: "unguessable resume-token capability load" },
  { ref: "src/infrastructure/audit/audit-store.ts :: enqueueAudit", why: "transaction-local auditedWrite internal" },
  { ref: "src/infrastructure/audit/audit-store.ts :: discardedAuditEventWork", why: "non-persisting login constant work" },
  { ref: "src/infrastructure/wire.ts :: resumeAccountOpeningByToken", why: "e-sign resume-token capability" },
  { ref: "src/infrastructure/wire.ts :: esignCallback", why: "verified e-sign signature and resume-token capability" },
  { ref: "src/infrastructure/wire.ts :: computeEsignSignature", why: "pure e-sign simulation signer" },
];

const PORT_ESCAPES = new Set([
  "src/domain/observability/safe-values.ts :: isSafeObservabilityPrimitive.<call>",
  "src/domain/observability/safe-values.ts :: safeLogMessage.<call>",
  "src/domain/observability/safe-values.ts :: safeSpanName.<call>",
  "src/domain/pii/projection-resolution.ts :: hasUnresolvedProjectionValue.<call>",
  "src/domain/pii/projection-resolution.ts :: resolveCompleteSensitiveEntities.<call>",
  "src/domain/workflow/engine.ts :: ExecutionStore.loadByToken",
  "src/domain/schema/entities.ts :: isAccountType.<call>",
  "src/domain/schema/golden-record.ts :: resolveConflict.<call>",
]);

const SQL_ADAPTER_MODULES = ["@electric-sql/pglite"] as const;

export interface TenantFenceViolation {
  ref: string;
  detail: string;
}

function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
}

function declaredAs(type: Type, file: string, name: string): boolean {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.getText()}::${current.getFlags()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const symbol of [current.getAliasSymbol(), current.getSymbol()]) {
      if (symbol?.getName() !== name) continue;
      if (
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

function carriesTenant(type: Type): boolean {
  if (
    declaredAs(type, "src/contracts/tenant.ts", "TenantContext") ||
    declaredAs(type, "src/contracts/principal.ts", "WriteActor")
  ) {
    return true;
  }
  for (const name of ["tenant", "actor"]) {
    const property = type.getProperty(name);
    const declaration = property?.getValueDeclaration() ??
      property?.getDeclarations()[0];
    if (!declaration || !property) continue;
    const propertyType = property.getTypeAtLocation(declaration);
    if (
      declaredAs(propertyType, "src/contracts/tenant.ts", "TenantContext") ||
      declaredAs(propertyType, "src/contracts/principal.ts", "WriteActor")
    ) {
      return true;
    }
  }
  return false;
}

interface RepositoryEntry {
  readonly name: string;
  readonly signatures: Signature[];
}

interface RuntimeGuard {
  readonly functionName: "assertActionGrant" | "assertTenantContext" | "assertWriteActor";
  readonly file: string;
  readonly argument: string;
}

function callableMembers(
  type: Type,
  owner: string,
): Array<{ name: string; signatures: Signature[] }> {
  const entries: Array<{ name: string; signatures: Signature[] }> = [];
  const direct = type.getCallSignatures();
  if (direct.length) entries.push({ name: owner, signatures: direct });
  if (
    type.isString() ||
    type.isStringLiteral() ||
    type.isNumber() ||
    type.isNumberLiteral() ||
    type.isBoolean() ||
    type.isBooleanLiteral()
  ) {
    return entries;
  }
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  if (
    symbol &&
    !symbol.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
    )
  ) {
    return entries;
  }
  for (const property of type.getProperties()) {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0];
    if (!declaration) continue;
    const signatures = property.getTypeAtLocation(declaration).getCallSignatures();
    if (signatures.length) {
      entries.push({ name: `${owner}.${property.getName()}`, signatures });
    }
  }
  return entries;
}

function signatureHas(
  signature: Signature,
  predicate: (type: Type) => boolean,
): boolean {
  return signature.getParameters().some((parameter) => {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    return Boolean(declaration && predicate(parameter.getTypeAtLocation(declaration)));
  });
}

function runtimeGuard(signature: Signature): RuntimeGuard | null {
  for (const parameter of signature.getParameters()) {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    if (!declaration) continue;
    const parameterType = parameter.getTypeAtLocation(declaration);
    const parameterName = parameter.getName();
    if (declaredAs(parameterType, "src/contracts/authz.ts", "ActionGrant")) {
      return {
        functionName: "assertActionGrant",
        file: "src/contracts/authz.ts",
        argument: parameterName,
      };
    }
    if (declaredAs(parameterType, "src/contracts/principal.ts", "WriteActor")) {
      return {
        functionName: "assertWriteActor",
        file: "src/contracts/principal.ts",
        argument: parameterName,
      };
    }
    if (declaredAs(parameterType, "src/contracts/tenant.ts", "TenantContext")) {
      return {
        functionName: "assertTenantContext",
        file: "src/contracts/tenant.ts",
        argument: parameterName,
      };
    }
    for (const propertyName of ["actor", "tenant"] as const) {
      const property = parameterType.getProperty(propertyName);
      const propertyDeclaration = property?.getValueDeclaration() ??
        property?.getDeclarations()[0];
      if (!property || !propertyDeclaration) continue;
      const propertyType = property.getTypeAtLocation(propertyDeclaration);
      if (declaredAs(propertyType, "src/contracts/principal.ts", "WriteActor")) {
        return {
          functionName: "assertWriteActor",
          file: "src/contracts/principal.ts",
          argument: `${parameterName}.${propertyName}`,
        };
      }
      if (declaredAs(propertyType, "src/contracts/tenant.ts", "TenantContext")) {
        return {
          functionName: "assertTenantContext",
          file: "src/contracts/tenant.ts",
          argument: `${parameterName}.${propertyName}`,
        };
      }
    }
  }
  return null;
}

function callResolvesTo(
  call: Node,
  file: string,
  name: string,
): boolean {
  if (!Node.isCallExpression(call)) return false;
  const symbol = call.getExpression().getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  return target?.getName() === name &&
    target.getDeclarations().some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) === file
    );
}

function signatureHasFirstRuntimeGuard(
  signature: Signature,
  guard: RuntimeGuard,
): boolean {
  const declaration = signature.getDeclaration();
  if (
    !Node.isFunctionDeclaration(declaration) &&
    !Node.isMethodDeclaration(declaration) &&
    !Node.isFunctionExpression(declaration) &&
    !Node.isArrowFunction(declaration)
  ) {
    return false;
  }
  const body = declaration.getBody();
  if (!Node.isBlock(body)) return false;
  const first = body.getStatements()[0];
  if (!Node.isExpressionStatement(first)) return false;
  const expression = first.getExpression();
  return callResolvesTo(expression, guard.file, guard.functionName) &&
    Node.isCallExpression(expression) &&
    expression.getArguments()[0]?.getText() === guard.argument;
}

function exportedDomainCallableTypes(
  sf: SourceFile,
): Array<{ name: string; type: Type }> {
  return [
    ...sf.getFunctions()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({
        name: declaration.getName() ?? "<anonymous>",
        type: declaration.getType(),
      })),
    ...sf.getVariableDeclarations()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({
        name: declaration.getName(),
        type: declaration.getType(),
      })),
    ...sf.getInterfaces()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({ name: declaration.getName(), type: declaration.getType() })),
    ...sf.getTypeAliases()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({ name: declaration.getName(), type: declaration.getType() })),
    ...sf.getClasses()
      .filter((declaration) => declaration.isExported())
      .map((declaration) => ({ name: declaration.getName() ?? "<anonymous>", type: declaration.getType() })),
  ].filter((declaration) =>
    callableMembers(declaration.type, declaration.name).some((member) =>
      member.signatures.some((signature) =>
        normalizedPath(signature.getDeclaration().getSourceFile().getFilePath())
          .startsWith("src/domain/")
      )
    )
  );
}

function returnedRepositoryEntries(
  declaration: Node,
  owner: string,
): RepositoryEntry[] {
  const body = Node.isFunctionDeclaration(declaration) ||
      Node.isFunctionExpression(declaration) ||
      Node.isArrowFunction(declaration)
    ? declaration.getBody()
    : null;
  if (!body) return [];
  const returnedExpressions: Node[] = [];
  if (!Node.isBlock(body)) returnedExpressions.push(body);
  for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const containingFunction = statement.getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isArrowFunction(ancestor) ||
      Node.isMethodDeclaration(ancestor)
    );
    if (containingFunction !== declaration) continue;
    const expression = statement.getExpression();
    if (expression) returnedExpressions.push(expression);
  }
  const resolveObject = (expression: Node, seen = new Set<string>()): Node | null => {
    const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (Node.isObjectLiteralExpression(expression)) return expression;
    if (Node.isParenthesizedExpression(expression) ||
      Node.isAsExpression(expression) ||
      Node.isSatisfiesExpression(expression) ||
      Node.isTypeAssertion(expression)) {
      return resolveObject(expression.getExpression(), seen);
    }
    if (!Node.isIdentifier(expression)) return null;
    const symbol = expression.getSymbol();
    const target = symbol?.getAliasedSymbol() ?? symbol;
    for (const candidate of target?.getDeclarations() ?? []) {
      if (!Node.isVariableDeclaration(candidate)) continue;
      const initializer = candidate.getInitializer();
      if (initializer) return resolveObject(initializer, seen);
    }
    return null;
  };
  const expressions = returnedExpressions
    .map((expression) => resolveObject(expression))
    .filter((expression): expression is Node => expression !== null);
  const entries: RepositoryEntry[] = [];
  for (const expression of expressions) {
    if (!Node.isObjectLiteralExpression(expression)) continue;
    for (const property of expression.getProperties()) {
      if (Node.isMethodDeclaration(property)) {
        entries.push({
          name: `${owner}.${property.getName()}`,
          signatures: [property.getSignature()],
        });
        continue;
      }
      if (!Node.isPropertyAssignment(property)) continue;
      const initializer = property.getInitializer();
      if (!initializer ||
        (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) {
        continue;
      }
      entries.push({
        name: `${owner}.${property.getName()}`,
        signatures: [initializer.getSignature()],
      });
    }
  }
  return entries;
}

function sqlBackedInfrastructureModules(project: Project): Set<string> {
  const modules = new Set<string>(["src/infrastructure/store/db.ts"]);
  const isSqlAdapter = (specifier: string): boolean =>
    SQL_ADAPTER_MODULES.some((moduleName) =>
      specifier === moduleName || specifier.startsWith(`${moduleName}/`)
    );
  let changed = true;
  while (changed) {
    changed = false;
    for (const sf of project.getSourceFiles()) {
      const normalized = normalizedPath(sf.getFilePath());
      if (
        !normalized.startsWith("src/infrastructure/") ||
        modules.has(normalized)
      ) {
        continue;
      }
      const staticTargets = sf.getImportDeclarations().flatMap((declaration) => {
        const target = declaration.getModuleSpecifierSourceFile();
        return target ? [normalizedPath(target.getFilePath())] : [];
      });
      const importsSqlAdapter = sf.getImportDeclarations().some((declaration) =>
        isSqlAdapter(declaration.getModuleSpecifierValue())
      );
      const dynamicTargets: string[] = [];
      let loadsSqlAdapter = false;
      let unverifiableModuleLoad = false;
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expression = call.getExpression();
        const isModuleLoad = expression.getKind() === SyntaxKind.ImportKeyword ||
          expression.getText() === "require";
        if (!isModuleLoad) continue;
        const argument = call.getArguments()[0];
        if (!argument || !Node.isStringLiteral(argument)) {
          unverifiableModuleLoad = true;
          continue;
        }
        if (isSqlAdapter(argument.getLiteralValue())) {
          loadsSqlAdapter = true;
        }
        const resolved = ts.resolveModuleName(
          argument.getLiteralValue(),
          sf.getFilePath(),
          project.getCompilerOptions(),
          project.getModuleResolutionHost(),
        ).resolvedModule?.resolvedFileName;
        if (resolved) dynamicTargets.push(normalizedPath(resolved));
      }
      const reachesSql = importsSqlAdapter ||
        loadsSqlAdapter ||
        unverifiableModuleLoad ||
        [...staticTargets, ...dynamicTargets].some((target) =>
          modules.has(target)
        );
      if (reachesSql) {
        modules.add(normalized);
        changed = true;
      }
    }
  }
  return modules;
}

export function detectMissingTenantParams(
  project: Project,
  escapes: ReadonlySet<string>,
): TenantFenceViolation[] {
  const out: TenantFenceViolation[] = [];
  const repositoryModules = sqlBackedInfrastructureModules(project);
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (!repositoryModules.has(normalized)) continue;

    const entries: RepositoryEntry[] = [];
    for (const fn of sf.getFunctions()) {
      if (fn.isExported()) {
        entries.push({
          name: fn.getName() ?? "<anonymous>",
          signatures: [fn.getSignature()],
        });
        entries.push(...returnedRepositoryEntries(
          fn,
          fn.getName() ?? "<anonymous>",
        ));
      }
    }
    for (const declaration of sf.getVariableDeclarations()) {
      if (!declaration.isExported()) continue;
      for (const member of callableMembers(declaration.getType(), declaration.getName())) {
        entries.push({
          name: member.name,
          signatures: member.signatures,
        });
      }
      const initializer = declaration.getInitializer();
      if (initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        entries.push(...returnedRepositoryEntries(initializer, declaration.getName()));
      }
    }
    for (const assignment of sf.getExportAssignments()) {
      const expression = assignment.getExpression();
      if (Node.isIdentifier(expression)) continue;
      for (const member of callableMembers(expression.getType(), "default")) {
        entries.push({
          name: member.name,
          signatures: member.signatures,
        });
      }
    }
    for (const cls of sf.getClasses().filter((candidate) => candidate.isExported())) {
      for (const method of cls.getMethods()) {
        if (method.getScope() === "private" || method.getScope() === "protected") continue;
        entries.push({
          name: `${cls.getName() ?? "<anonymous>"}.${method.getName()}`,
          signatures: [method.getSignature()],
        });
      }
    }

    for (const entry of entries) {
      const ref = `${normalized} :: ${entry.name}`;
      if (escapes.has(ref)) continue;
      const unscoped = entry.signatures.some((signature) =>
        !signatureHas(signature, carriesTenant)
      );
      if (unscoped) {
        out.push({
          ref,
          detail: "repository callable has no sealed tenant context",
        });
        continue;
      }
      const missingGuard = entry.signatures.some((signature) => {
        const guard = runtimeGuard(signature);
        return !guard || !signatureHasFirstRuntimeGuard(signature, guard);
      });
      if (missingGuard) {
        out.push({
          ref,
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        });
      }
    }
  }
  return out;
}

export function detectUnscopedPortMethods(
  project: Project,
  escapes: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (!normalized.startsWith("src/domain/")) continue;
    const declarations = exportedDomainCallableTypes(sf);
    for (const declaration of declarations) {
      const members = callableMembers(declaration.type, declaration.name)
        .map((member) => ({
          ref: `${normalized} :: ${member.name === declaration.name ? `${declaration.name}.<call>` : member.name}`,
          signatures: member.signatures.filter((signature) =>
            normalizedPath(signature.getDeclaration().getSourceFile().getFilePath())
              .startsWith("src/domain/")
          ),
        }))
        .filter((member) => member.signatures.length > 0);
      for (const member of members) {
        if (escapes.has(member.ref)) continue;
        const unscoped = member.signatures.some((signature) =>
          !signatureHas(signature, carriesTenant)
        );
        if (unscoped) out.push(member.ref);
      }
    }
  }
  return out;
}

const ESCAPE_SET = new Set(REVIEWED_ESCAPES.map((entry) => entry.ref));

function repositoryFixture(
  source: string,
  extras: Record<string, string> = {},
): Project {
  return inMemoryProject({
    "/src/infrastructure/store/db.ts": `
      export interface SqlQueryable { query(sql: string): unknown }
      export interface SqlTx extends SqlQueryable {}
      export interface SqlDb extends SqlQueryable {}
    `,
    "/src/contracts/tenant.ts": `
      export interface TenantContext { orgId: string }
      export function assertTenantContext(value: unknown): asserts value is TenantContext {
        void value;
      }
    `,
    "/src/contracts/principal.ts": `
      import type { TenantContext } from "./tenant";
      export interface WriteActor { tenant: TenantContext; actorUserId: string }
      export function assertWriteActor(value: unknown): asserts value is WriteActor {
        void value;
      }
    `,
    "/src/infrastructure/crm/subject.ts": source,
    ...extras,
  });
}

describe("tenant-context-required fence", () => {
  it("enforces: every exported SQL repository entry requires a sealed tenant context or exact escape", () => {
    const violations = detectMissingTenantParams(realSemanticProject(), ESCAPE_SET);
    expect(
      violations,
      violations.map((violation) => `${violation.ref} - ${violation.detail}`).join("\n"),
    ).toEqual([]);
  });

  it("enforces: no stale repository escapes", () => {
    const project = realSemanticProject();
    const unescaped = new Set(
      detectMissingTenantParams(project, new Set())
        .map((violation) => violation.ref),
    );
    expect(
      REVIEWED_ESCAPES
        .filter((entry) => !unescaped.has(entry.ref))
        .map((entry) => entry.ref),
    ).toEqual([]);
  });

  it("enforces: every exported domain port method requires TenantContext unless capability-keyed", () => {
    const project = realSemanticProject();
    const callableTypes = project.getSourceFiles()
      .filter((sf) => normalizedPath(sf.getFilePath()).startsWith("src/domain/"))
      .flatMap(exportedDomainCallableTypes);
    expect(callableTypes.length).toBeGreaterThanOrEqual(3);
    expect(detectUnscopedPortMethods(project, PORT_ESCAPES)).toEqual([]);
  });

  it("enforces: no stale domain-port escapes", () => {
    const project = realSemanticProject();
    const live = new Set<string>();
    for (const sf of project.getSourceFiles()) {
      const normalized = normalizedPath(sf.getFilePath());
      if (!normalized.startsWith("src/domain/")) continue;
      for (const declaration of exportedDomainCallableTypes(sf)) {
        for (const member of callableMembers(declaration.type, declaration.name)) {
          live.add(
            `${normalized} :: ${member.name === declaration.name ? `${declaration.name}.<call>` : member.name}`,
          );
        }
      }
    }
    expect([...PORT_ESCAPES].filter((ref) => !live.has(ref))).toEqual([]);
  });

  describe("detects (companion): semantic and declaration-form evasions are caught", () => {
    it("flags an exported repository function without tenant scope", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export function listAll(db: SqlDb) { return db.query("SELECT 1"); }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags an imported SQL type alias", () => {
      const project = repositoryFixture(`
        import type { SqlDb as Database } from "../store/db";
        export function listAll(db: Database) { return db.query("SELECT 1"); }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags a contextually inferred SQL parameter", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        type Read = (db: SqlDb) => unknown;
        export const listAll: Read = (db) => db.query("SELECT 1");
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags an exported repository function that obtains its database internally", () => {
      const project = repositoryFixture(`
        import { getDb } from "../store/db";
        export async function listAll() {
          const db = await getDb();
          return db.query("SELECT 1");
        }
      `, {
        "/src/infrastructure/store/db.ts": `
          export interface SqlQueryable { query(sql: string): unknown }
          export interface SqlTx extends SqlQueryable {}
          export interface SqlDb extends SqlQueryable {}
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags SQL-backed repositories outside the established adapter directories", () => {
      const project = inMemoryProject({
        "/src/infrastructure/store/db.ts": `
          export interface SqlDb { query(sql: string): unknown }
          export function getDb(): Promise<SqlDb> { throw new Error(); }
        `,
        "/src/infrastructure/new-adapter/repository.ts": `
          import { getDb } from "../store/db";
          export async function listAll() {
            const db = await getDb();
            return db.query("SELECT 1");
          }
        `,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/new-adapter/repository.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("flags repositories that import the SQL adapter directly", () => {
      const project = inMemoryProject({
        "/src/infrastructure/direct/repository.ts": `
          import { PGlite } from "@electric-sql/pglite";
          export async function listAll() {
            const db = new PGlite();
            return db.query("SELECT 1");
          }
        `,
      });
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/direct/repository.ts :: listAll",
          detail: "repository callable has no sealed tenant context",
        },
      ]);
    });

    it("flags an exported repository class method with a bound database", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export class Repo {
          constructor(private db: SqlDb) {}
          listAll() { return this.db.query("SELECT 1"); }
        }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags exported repository object methods", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        export const repo = {
          listAll(db: SqlDb) { return db.query("SELECT 1"); },
        };
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags default-exported repository object methods", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        const repo = {
          listAll(db: SqlDb) { return db.query("SELECT 1"); },
        };
        export default repo;
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("flags separately exported repository object methods", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        const repo = {
          listAll(db: SqlDb) { return db.query("SELECT 1"); },
        };
        export { repo };
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toHaveLength(1);
    });

    it("allows direct TenantContext, aliased TenantContext, and WriteActor", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import { assertTenantContext, type TenantContext as Scope } from "../../contracts/tenant";
        import { assertWriteActor, type WriteActor } from "../../contracts/principal";
        export function listGood(db: SqlDb, tenant: Scope) {
          assertTenantContext(tenant);
          return db.query("SELECT 1");
        }
        export function writeGood(db: SqlDb, actor: WriteActor) {
          assertWriteActor(actor);
          return db.query("SELECT 1");
        }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([]);
    });

    it("flags a typed tenant parameter whose runtime seal is never asserted", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        export function listAll(db: SqlDb, tenant: TenantContext) {
          return db.query("SELECT 1");
        }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: listAll",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });

    it("flags an unguarded method returned by an escaped repository factory", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext } from "../../contracts/tenant";
        interface Repo {
          loadById(id: string, tenant: TenantContext): unknown;
        }
        export function makeRepo(db: SqlDb): Repo {
          return {
            loadById(id, tenant) {
              return db.query("SELECT 1");
            },
          };
        }
      `);
      expect(detectMissingTenantParams(
        project,
        new Set(["src/infrastructure/crm/subject.ts :: makeRepo"]),
      )).toEqual([
        {
          ref: "src/infrastructure/crm/subject.ts :: makeRepo.loadById",
          detail: "repository callable does not assert its sealed tenant authority before SQL access",
        },
      ]);
    });

    it("keeps repository escapes exact-match", () => {
      const project = repositoryFixture(
        `import type { SqlDb } from "../store/db"; export function findUserByEmailOrRole(db: SqlDb) { return db.query("SELECT 1"); }`,
        {
          "/src/infrastructure/identity/identity-store.ts": `
            import type { SqlDb } from "../store/db";
            export function findUserByEmailOrRole(db: SqlDb) { return db.query("SELECT 1"); }
          `,
        },
      );
      expect(detectMissingTenantParams(project, ESCAPE_SET).some((violation) =>
        violation.ref.includes("findUserByEmailOrRole")
      )).toBe(true);
    });

    it("flags an unscoped exported port method", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `export interface EvidencePort { load(id: string): unknown }`,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: EvidencePort.load",
      ]);
    });

    it("flags dependency-shaped interfaces regardless of their name", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export interface AccountOpeningDeps {
            createContact(input: { firstName: string }): Promise<void>;
          }
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: AccountOpeningDeps.createContact",
      ]);
    });

    it("flags callable-property and direct-call port signatures", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export interface LoaderDeps {
            load: (id: string) => unknown;
          }
          export interface Resolver {
            (id: string): unknown;
          }
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: LoaderDeps.load",
        "src/domain/evil.ts :: Resolver.<call>",
      ]);
    });

    it("flags type-alias and abstract-class port forms", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/domain/evil.ts": `
          export type LoaderPort = {
            load(id: string): unknown;
          };
          export abstract class WriterPort {
            abstract save(id: string): Promise<void>;
          }
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: LoaderPort.load",
        "src/domain/evil.ts :: WriterPort.save",
      ]);
    });

    it("flags separately exported type-alias and abstract-class ports", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
        "/src/domain/evil.ts": `
          type LoaderPort = {
            load(id: string): unknown;
          };
          abstract class WriterPort {
            abstract save(id: string): Promise<void>;
          }
          export { LoaderPort, WriterPort };
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: LoaderPort.load",
        "src/domain/evil.ts :: WriterPort.save",
      ]);
    });

    it("flags exported function and function-valued variable port forms", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export function load(id: string): unknown {
            return id;
          }
          export const save: (id: string) => Promise<void> = async () => {};
        `,
      });
      expect(detectUnscopedPortMethods(project, new Set())).toEqual([
        "src/domain/evil.ts :: load.<call>",
        "src/domain/evil.ts :: save.<call>",
      ]);
    });
  });
});
