import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import {
  Node,
  type ParameterDeclaration,
  type Project,
  type Type,
} from "ts-morph";
import {
  realSemanticProject,
  inMemoryProject,
  REPO_ROOT,
} from "./_fence-utils";

const REPO_MODULE_DIRS = [
  "src/infrastructure/crm/",
  "src/infrastructure/store/",
  "src/infrastructure/audit/",
  "src/infrastructure/identity/",
];

const REVIEWED_ESCAPES: Array<{ ref: string; why: string }> = [
  { ref: "src/infrastructure/identity/identity-store.ts :: findUserByEmail", why: "login resolves the tenant from the identity row" },
  { ref: "src/infrastructure/identity/identity-store.ts :: getPasswordHash", why: "user-PK capability before authentication" },
  { ref: "src/infrastructure/identity/identity-store.ts :: authenticate", why: "identity boundary that produces the sealed tenant" },
  { ref: "src/infrastructure/identity/identity-store.ts :: revokeSession", why: "session-id capability" },
  { ref: "src/infrastructure/identity/identity-store.ts :: renewSession", why: "session-id capability rotation" },
  { ref: "src/infrastructure/identity/identity-store.ts :: deleteDeadSessions", why: "global session maintenance" },
  { ref: "src/infrastructure/identity/session.ts :: resolveSession", why: "signed-cookie identity boundary" },
  { ref: "src/infrastructure/identity/session.ts :: resolveAndRenewSession", why: "signed-cookie identity boundary" },
  { ref: "src/infrastructure/crm/application-store.ts :: getApplicationByToken", why: "e-sign capability load" },
  { ref: "src/infrastructure/store/migrations.ts :: runMigrations", why: "global schema management" },
  { ref: "src/infrastructure/store/execution-store.ts :: makeExecutionStore", why: "factory whose returned port is checked independently" },
  { ref: "src/infrastructure/audit/audit-store.ts :: enqueueAudit", why: "transaction-local auditedWrite internal" },
  { ref: "src/infrastructure/audit/audit-store.ts :: discardedAuditEventWork", why: "non-persisting login constant work" },
];

const PORT_ESCAPES = new Set([
  "src/domain/workflow/engine.ts :: ExecutionStore.loadByToken",
]);

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

function isSqlType(type: Type): boolean {
  return ["SqlDb", "SqlQueryable", "SqlTx"].some((name) =>
    declaredAs(type, "src/infrastructure/store/db.ts", name)
  );
}

function carriesSql(type: Type): boolean {
  if (isSqlType(type)) return true;
  const property = type.getProperty("db");
  const declaration = property?.getValueDeclaration() ?? property?.getDeclarations()[0];
  return Boolean(declaration && isSqlType(property!.getTypeAtLocation(declaration)));
}

function carriesTenant(type: Type): boolean {
  if (
    declaredAs(type, "src/contracts/tenant.ts", "TenantContext") ||
    declaredAs(type, "src/contracts/principal.ts", "WriteActor")
  ) {
    return true;
  }
  const property = type.getProperty("tenant");
  const declaration = property?.getValueDeclaration() ?? property?.getDeclarations()[0];
  return Boolean(
    declaration &&
    declaredAs(
      property!.getTypeAtLocation(declaration),
      "src/contracts/tenant.ts",
      "TenantContext",
    ),
  );
}

interface RepositoryEntry {
  readonly name: string;
  readonly params: ParameterDeclaration[];
  readonly boundSql: boolean;
}

export function detectMissingTenantParams(
  project: Project,
  escapes: ReadonlySet<string>,
): TenantFenceViolation[] {
  const out: TenantFenceViolation[] = [];
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (!REPO_MODULE_DIRS.some((dir) => normalized.startsWith(dir))) continue;

    const entries: RepositoryEntry[] = [];
    for (const fn of sf.getFunctions()) {
      if (fn.isExported()) {
        entries.push({
          name: fn.getName() ?? "<anonymous>",
          params: fn.getParameters(),
          boundSql: false,
        });
      }
    }
    for (const statement of sf.getVariableStatements()) {
      if (!statement.isExported()) continue;
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
          entries.push({
            name: declaration.getName(),
            params: initializer.getParameters(),
            boundSql: false,
          });
        }
      }
    }
    for (const cls of sf.getClasses().filter((candidate) => candidate.isExported())) {
      const boundSql = cls.getConstructors().some((constructor) =>
        constructor.getParameters().some((parameter) => carriesSql(parameter.getType()))
      );
      for (const method of cls.getMethods()) {
        if (method.getScope() === "private" || method.getScope() === "protected") continue;
        entries.push({
          name: `${cls.getName() ?? "<anonymous>"}.${method.getName()}`,
          params: method.getParameters(),
          boundSql,
        });
      }
    }

    for (const entry of entries) {
      if (!entry.boundSql && !entry.params.some((parameter) => carriesSql(parameter.getType()))) {
        continue;
      }
      const ref = `${normalized} :: ${entry.name}`;
      if (escapes.has(ref)) continue;
      if (!entry.params.some((parameter) => carriesTenant(parameter.getType()))) {
        out.push({
          ref,
          detail: `takes (${entry.params.map((parameter) => parameter.getType().getText()).join(", ")}) with no sealed tenant context`,
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
    for (const iface of sf.getInterfaces()) {
      if (!iface.isExported() || !/(Port|Store)$/.test(iface.getName())) continue;
      for (const method of iface.getMethods()) {
        const ref = `${normalized} :: ${iface.getName()}.${method.getName()}`;
        if (
          !escapes.has(ref) &&
          !method.getParameters().some((parameter) => carriesTenant(parameter.getType()))
        ) {
          out.push(ref);
        }
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
    "/src/contracts/tenant.ts": `export interface TenantContext { orgId: string }`,
    "/src/contracts/principal.ts": `
      import type { TenantContext } from "./tenant";
      export interface WriteActor { tenant: TenantContext; actorUserId: string }
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
    const live = new Set<string>();
    for (const sf of project.getSourceFiles()) {
      const normalized = normalizedPath(sf.getFilePath());
      for (const fn of sf.getFunctions()) {
        if (fn.isExported() && fn.getName()) live.add(`${normalized} :: ${fn.getName()}`);
      }
    }
    expect(
      REVIEWED_ESCAPES.filter((entry) => !live.has(entry.ref)).map((entry) => entry.ref),
    ).toEqual([]);
  });

  it("enforces: every exported domain port method requires TenantContext unless capability-keyed", () => {
    const project = realSemanticProject();
    const portMethods = project.getSourceFiles()
      .filter((sf) => normalizedPath(sf.getFilePath()).startsWith("src/domain/"))
      .flatMap((sf) => sf.getInterfaces())
      .filter((iface) => iface.isExported() && /(Port|Store)$/.test(iface.getName()))
      .flatMap((iface) => iface.getMethods());
    expect(portMethods.length).toBeGreaterThan(0);
    expect(detectUnscopedPortMethods(project, PORT_ESCAPES)).toEqual([]);
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

    it("allows direct TenantContext, aliased TenantContext, and WriteActor", () => {
      const project = repositoryFixture(`
        import type { SqlDb } from "../store/db";
        import type { TenantContext as Scope } from "../../contracts/tenant";
        import type { WriteActor } from "../../contracts/principal";
        export function listGood(db: SqlDb, tenant: Scope) { return db.query("SELECT 1"); }
        export function writeGood(db: SqlDb, actor: WriteActor) { return db.query("SELECT 1"); }
      `);
      expect(detectMissingTenantParams(project, ESCAPE_SET)).toEqual([]);
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
  });
});
