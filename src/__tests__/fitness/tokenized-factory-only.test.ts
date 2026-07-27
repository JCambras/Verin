import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import {
  Node,
  SyntaxKind,
  ts,
  type Project,
  type SourceFile,
  type Type,
} from "ts-morph";
import {
  inMemoryProject,
  realSemanticProject,
  REPO_ROOT,
} from "./_fence-utils";

const SEALED = [
  {
    typeName: "Tokenized",
    declaration: "src/contracts/tokenized.ts",
    factory: "src/infrastructure/pii/tokenize.ts",
  },
  {
    typeName: "TenantContext",
    declaration: "src/contracts/tenant.ts",
    factory: "src/contracts/tenant.ts",
  },
  {
    typeName: "ActionGrant",
    declaration: "src/contracts/authz.ts",
    factory: "src/contracts/authz.ts",
  },
  {
    typeName: "ActorRef",
    declaration: "src/contracts/authz.ts",
    factory: "src/contracts/authz.ts",
  },
  {
    typeName: "Principal",
    declaration: "src/contracts/principal.ts",
    factory: "src/contracts/principal.ts",
  },
  {
    typeName: "WriteActor",
    declaration: "src/contracts/principal.ts",
    factory: "src/contracts/principal.ts",
  },
] as const;

const TRUSTED_FACTORY_CALLS = [
  {
    name: "principalFromIdentity",
    declaration: "src/contracts/principal.ts",
    allowed: [
      { file: "src/infrastructure/identity/identity-store.ts", owner: "createSession" },
      { file: "src/infrastructure/identity/session.ts", owner: "resolveSessionRow" },
      { file: "src/infrastructure/identity/session.ts", owner: "resolveAndRenewSession" },
    ],
  },
  {
    name: "tenantFromIdentity",
    declaration: "src/contracts/tenant.ts",
    allowed: [
      { file: "src/infrastructure/identity/identity-store.ts", owner: "authenticatedUser" },
    ],
  },
  {
    name: "systemTenant",
    declaration: "src/contracts/tenant.ts",
    allowed: [
      { file: "scripts/audit-chain-verify.ts", owner: "main" },
      { file: "scripts/db-seed.ts", owner: "seed" },
      { file: "scripts/load-smoke.ts", owner: "main" },
      { file: "src/contracts/principal.ts", owner: "systemWriteActor" },
      { file: "src/infrastructure/audit/audit-store.ts", owner: "discardedAuditEventWork" },
    ],
  },
  {
    name: "systemWriteActor",
    declaration: "src/contracts/principal.ts",
    allowed: [
      { file: "scripts/backup-restore-drill.ts", owner: "main" },
      { file: "scripts/db-seed.ts", owner: "seed" },
      { file: "src/app/login/actions.ts", owner: "loginAction" },
      { file: "src/infrastructure/wire.ts", owner: "resumeAccountOpeningByToken" },
    ],
  },
  {
    name: "delegatedWriteActor",
    declaration: "src/contracts/principal.ts",
    allowed: [
      { file: "src/app/login/actions.ts", owner: "loginAction" },
      { file: "src/infrastructure/wire.ts", owner: "makeDeps" },
    ],
  },
  {
    name: "tokenizeText",
    declaration: "src/infrastructure/pii/tokenize.ts",
    allowed: [
      { file: "src/infrastructure/pii/llm-projection.ts", owner: "projectForLlm" },
    ],
  },
  {
    name: "tokenizeRecord",
    declaration: "src/infrastructure/pii/tokenize.ts",
    allowed: [
      { file: "src/infrastructure/pii/llm-projection.ts", owner: "projectForLlm" },
    ],
  },
] as const;

function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
}

function sealedType(type: Type): (typeof SEALED)[number] | null {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.getText()}::${current.getFlags()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const symbol of [current.getAliasSymbol(), current.getSymbol()]) {
      if (!symbol) continue;
      for (const sealed of SEALED) {
        if (
          symbol.getName() === sealed.typeName &&
          symbol.getDeclarations().some((declaration) =>
            normalizedPath(declaration.getSourceFile().getFilePath()) ===
            sealed.declaration
          )
        ) {
          return sealed;
        }
      }
    }
    queue.push(...current.getUnionTypes(), ...current.getIntersectionTypes());
  }
  return null;
}

function functionTarget(type: Type): {
  name: string;
  declaration: string;
} | null {
  for (const signature of type.getCallSignatures()) {
    const declaration = signature.getDeclaration();
    const name = declaration.getSymbol()?.getName();
    if (name) {
      return {
        name,
        declaration: normalizedPath(declaration.getSourceFile().getFilePath()),
      };
    }
  }
  return null;
}

function enclosingOwner(node: Node): string | null {
  for (const ancestor of node.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor) && ancestor.getName()) {
      return ancestor.getName()!;
    }
    if (Node.isMethodDeclaration(ancestor)) {
      return ancestor.getName();
    }
  }
  return null;
}

function resolvedModulePath(
  project: Project,
  sourceFile: SourceFile,
  specifier: string,
): string | null {
  const resolved = ts.resolveModuleName(
    specifier,
    sourceFile.getFilePath(),
    project.getCompilerOptions(),
    project.getModuleResolutionHost(),
  ).resolvedModule?.resolvedFileName;
  return resolved ? normalizedPath(resolved) : null;
}

function detectPrivilegedFactoryModuleAccess(project: Project): string[] {
  const out: string[] = [];
  const privilegedModules = new Map<string, string[]>();
  for (const factory of TRUSTED_FACTORY_CALLS) {
    const names = privilegedModules.get(factory.declaration) ?? [];
    names.push(factory.name);
    privilegedModules.set(factory.declaration, names);
  }
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (
      (!normalized.startsWith("src/") && !normalized.startsWith("scripts/")) ||
      normalized.includes("/__tests__/")
    ) {
      continue;
    }
    for (const declaration of sf.getImportDeclarations()) {
      const target = declaration.getModuleSpecifierSourceFile();
      const targetPath = target ? normalizedPath(target.getFilePath()) : null;
      const names = targetPath ? privilegedModules.get(targetPath) : undefined;
      if (
        names &&
        targetPath !== normalized &&
        (declaration.getNamespaceImport() || declaration.getDefaultImport())
      ) {
        out.push(
          `${normalized}:${declaration.getStartLineNumber()} - privileged factory module namespace exposes ${names.join(", ")}`,
        );
      }
    }
    for (const declaration of sf.getExportDeclarations()) {
      const target = declaration.getModuleSpecifierSourceFile();
      const targetPath = target ? normalizedPath(target.getFilePath()) : null;
      const names = targetPath ? privilegedModules.get(targetPath) : undefined;
      if (!names || targetPath === normalized) continue;
      const exportedNames = declaration.getNamedExports().map((item) =>
        item.getNameNode().getText()
      );
      if (
        declaration.isNamespaceExport() ||
        exportedNames.length === 0 ||
        exportedNames.some((name) => names.includes(name))
      ) {
        out.push(
          `${normalized}:${declaration.getStartLineNumber()} - privileged factory re-export exposes ${names.join(", ")}`,
        );
      }
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const isModuleLoad = expression.getKind() === SyntaxKind.ImportKeyword ||
        expression.getText() === "require";
      if (!isModuleLoad) continue;
      const argument = call.getArguments()[0];
      if (!argument || !Node.isStringLiteral(argument)) {
        out.push(
          `${normalized}:${call.getStartLineNumber()} - unverifiable module load could expose a privileged factory`,
        );
        continue;
      }
      const targetPath = resolvedModulePath(
        project,
        sf,
        argument.getLiteralValue(),
      );
      const names = targetPath ? privilegedModules.get(targetPath) : undefined;
      if (names && targetPath !== normalized) {
        out.push(
          `${normalized}:${call.getStartLineNumber()} - dynamic factory module access exposes ${names.join(", ")}`,
        );
      }
    }
  }
  return out;
}

export function detectSealedTypeConstruction(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (
      (!normalized.startsWith("src/") && !normalized.startsWith("scripts/")) ||
      normalized.includes("/__tests__/")
    ) continue;

    for (const kind of [
      SyntaxKind.AsExpression,
      SyntaxKind.TypeAssertionExpression,
      SyntaxKind.SatisfiesExpression,
    ] as const) {
      for (const node of sf.getDescendantsOfKind(kind)) {
        const typeNode = node.getTypeNode();
        const sealed = typeNode ? sealedType(typeNode.getType()) : null;
        if (sealed && normalized !== sealed.factory) {
          out.push(
            `${normalized}:${node.getStartLineNumber()} - cast to sealed type '${sealed.typeName}' outside its factory`,
          );
        }
      }
    }

    for (const literal of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const contextual = literal.getContextualType();
      const sealed = contextual ? sealedType(contextual) : null;
      if (sealed && normalized !== sealed.factory) {
        out.push(
          `${normalized}:${literal.getStartLineNumber()} - object literal constructs sealed type '${sealed.typeName}'`,
        );
      }
      const hasPiiFree = literal.getProperties().some((property) =>
        (Node.isPropertyAssignment(property) ||
          Node.isShorthandPropertyAssignment(property)) &&
        property.getName() === "piiFree"
      );
      if (hasPiiFree && normalized !== "src/infrastructure/pii/tokenize.ts") {
        out.push(
          `${normalized}:${literal.getStartLineNumber()} - object literal with 'piiFree' outside the scrubber factory`,
        );
      }
    }

    for (const cls of sf.getClasses()) {
      for (const implemented of cls.getImplements()) {
        const sealed = sealedType(implemented.getExpression().getType());
        if (sealed && normalized !== sealed.factory) {
          out.push(
            `${normalized}:${implemented.getStartLineNumber()} - class implements sealed type '${sealed.typeName}'`,
          );
        }
      }
      if (
        cls.getProperties().some((property) => property.getName() === "piiFree") &&
        normalized !== "src/infrastructure/pii/tokenize.ts"
      ) {
        out.push(
          `${normalized}:${cls.getStartLineNumber()} - class declares 'piiFree' outside the scrubber factory`,
        );
      }
    }
  }
  return out;
}

export function detectUntrustedFactoryCalls(project: Project): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (
      (!normalized.startsWith("src/") && !normalized.startsWith("scripts/")) ||
      normalized.includes("/__tests__/")
    ) continue;
    const references: Node[] = [
      ...sf.getDescendantsOfKind(SyntaxKind.Identifier),
      ...sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression),
    ];
    for (const reference of references) {
      if (
        reference.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) ||
        reference.getFirstAncestorByKind(SyntaxKind.ExportDeclaration)
      ) {
        continue;
      }
      const target = functionTarget(reference.getType());
      if (!target) continue;
      const factory = TRUSTED_FACTORY_CALLS.find((candidate) =>
        candidate.name === target.name &&
        candidate.declaration === target.declaration
      );
      const owner = enclosingOwner(reference);
      if (
        factory &&
        normalized !== factory.declaration &&
        !factory.allowed.some((scope) =>
          scope.file === normalized && scope.owner === owner
        )
      ) {
        const violation = `${normalized}:${reference.getStartLineNumber()} - ${factory.name} referenced outside its reviewed boundary${owner ? ` (${owner})` : ""}`;
        if (!seen.has(violation)) {
          seen.add(violation);
          out.push(violation);
        }
      }
    }
  }
  out.push(...detectPrivilegedFactoryModuleAccess(project));
  return [...new Set(out)];
}

function sealedFixture(path: string, source: string): Project {
  return inMemoryProject({
    "/src/contracts/tokenized.ts": `export interface Tokenized<T> { value: T; piiFree: true }`,
    "/src/contracts/tenant.ts": `
      export interface TenantContext { orgId: string }
      export function tenantFromIdentity(actorId: string, orgId: string): TenantContext { return { orgId } }
      export function systemTenant(systemId: string, orgId: string): TenantContext { return { orgId } }
    `,
    "/src/contracts/authz.ts": `
      export interface ActorRef { actorId: string }
      export interface ActionGrant { action: string }
    `,
    "/src/contracts/principal.ts": `
      import type { TenantContext } from "./tenant";
      export interface Principal { userId: string }
      export interface WriteActor { tenant: TenantContext; actorUserId: string }
      export function principalFromIdentity(input: object): Principal { return input as Principal }
      export function systemWriteActor(systemId: string, orgId: string): { tenant: TenantContext } { return { tenant: { orgId } } }
      export function delegatedWriteActor(actor: WriteActor, actorUserId: string): WriteActor { return { ...actor, actorUserId } }
    `,
    "/src/infrastructure/pii/llm-projection.ts": "",
    [path]: source,
  });
}

describe("tokenized-factory-only fence (sealed security types)", () => {
  it("enforces: sealed types are built only in their factory modules", () => {
    expect(detectSealedTypeConstruction(realSemanticProject())).toEqual([]);
  });

  it("enforces: identity and system minting factories are called only at reviewed boundaries", () => {
    expect(detectUntrustedFactoryCalls(realSemanticProject())).toEqual([]);
  });

  it("enforces: every trusted factory callsite remains live", () => {
    const project = realSemanticProject();
    for (const factory of TRUSTED_FACTORY_CALLS) {
      for (const scope of factory.allowed) {
        const sf = project.getSourceFiles().find((candidate) =>
          normalizedPath(candidate.getFilePath()) === scope.file
        );
        expect(sf, `${scope.file} missing`).toBeTruthy();
        expect(
          sf!.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => {
            const target = functionTarget(identifier.getType());
            return target?.name === factory.name &&
              target.declaration === factory.declaration &&
              enclosingOwner(identifier) === scope.owner;
          }),
          `${scope.file} :: ${scope.owner} no longer references ${factory.name}`,
        ).toBe(true);
      }
    }
  });

  it("enforces: each sealed factory still contains its sanctioned cast", () => {
    const project = realSemanticProject();
    for (const sealed of SEALED) {
      const sf = project.getSourceFiles().find((candidate) =>
        normalizedPath(candidate.getFilePath()) === sealed.factory
      );
      expect(sf, `${sealed.factory} missing`).toBeTruthy();
      expect(
        sf!.getDescendantsOfKind(SyntaxKind.AsExpression).some((node) => {
          const typeNode = node.getTypeNode();
          return typeNode &&
            sealedType(typeNode.getType())?.typeName === sealed.typeName;
        }),
        `${sealed.factory} no longer constructs ${sealed.typeName}`,
      ).toBe(true);
    }
  });

  describe("detects (companion): structural and semantic bypasses are caught", () => {
    it("catches a cast through an imported type alias", () => {
      const project = sealedFixture(
        "/src/domain/evil.ts",
        `import type { Tokenized as Safe } from "../contracts/tokenized"; const value = {} as Safe<string>;`,
      );
      expect(detectSealedTypeConstruction(project).some((hit) =>
        hit.startsWith("src/domain/evil.ts") && hit.includes("Tokenized")
      )).toBe(true);
    });

    it("catches a shorthand annotated Tokenized literal", () => {
      const project = sealedFixture(
        "/src/domain/evil.ts",
        `import type { Tokenized } from "../contracts/tokenized"; const piiFree = true as const; const value: Tokenized<string> = { value: "raw", piiFree };`,
      );
      expect(detectSealedTypeConstruction(project).length).toBeGreaterThanOrEqual(2);
    });

    it("catches a class implementing an aliased sealed type", () => {
      const project = sealedFixture(
        "/src/domain/evil.ts",
        `import type { Tokenized as Safe } from "../contracts/tokenized"; class Fake implements Safe<string> { value = "raw"; piiFree = true as const; }`,
      );
      expect(detectSealedTypeConstruction(project).length).toBeGreaterThanOrEqual(2);
    });

    it("catches TenantContext, ActorRef, ActionGrant, Principal, and WriteActor assertions", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          import type { ActorRef, ActionGrant } from "../contracts/authz";
          import type { Principal, WriteActor } from "../contracts/principal";
          const a = {} as TenantContext;
          const b = {} as ActorRef;
          const c = {} as ActionGrant;
          const d = {} as Principal;
          const e = {} as WriteActor;
        `,
      );
      const hits = detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/evil.ts")
      );
      for (const typeName of ["TenantContext", "ActorRef", "ActionGrant", "Principal", "WriteActor"]) {
        expect(hits.some((hit) => hit.includes(typeName)), typeName).toBe(true);
      }
    });

    it("catches an aliased principal factory call outside identity", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `import { principalFromIdentity as mint } from "../contracts/principal"; mint({});`,
      );
      expect(detectUntrustedFactoryCalls(project)).toHaveLength(1);
    });

    it("catches trusted factories referenced through call or bind", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import { principalFromIdentity } from "../contracts/principal";
          principalFromIdentity.call(undefined, {});
          const mint = principalFromIdentity.bind(undefined);
          mint({});
        `,
      );
      expect(detectUntrustedFactoryCalls(project).length).toBeGreaterThan(0);
    });

    it("catches trusted factories reached through a reflected module namespace", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import * as tenantModule from "../contracts/tenant";
          Reflect.get(tenantModule, "systemTenant")("seed", "victim");
        `,
      );
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.includes("systemTenant")
      )).toBe(true);
    });

    it("catches system tenant and system write factories outside reviewed boundaries", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import { systemTenant } from "../contracts/tenant";
          import { systemWriteActor } from "../contracts/principal";
          systemTenant("seed", "victim");
          systemWriteActor("seed", "victim");
        `,
      );
      const hits = detectUntrustedFactoryCalls(project);
      expect(hits.some((hit) => hit.includes("systemTenant"))).toBe(true);
      expect(hits.some((hit) => hit.includes("systemWriteActor"))).toBe(true);
    });

    it("catches privileged result wrappers added inside an otherwise reviewed module", () => {
      const project = sealedFixture(
        "/src/infrastructure/audit/audit-store.ts",
        `
          import { systemTenant } from "../../contracts/tenant";
          export function mintForAnyone(orgId: string) {
            return systemTenant("login-constant-work", orgId);
          }
        `,
      );
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.includes("systemTenant") && hit.includes("mintForAnyone")
      )).toBe(true);
    });

    it("catches direct tokenization outside the projection boundary", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import { tokenizeText } from "../infrastructure/pii/tokenize";
          tokenizeText("Alice wants account");
        `,
      );
      project.createSourceFile(
        "/src/infrastructure/pii/tokenize.ts",
        `export function tokenizeText(raw: string): object { return { value: raw } }`,
        { overwrite: true },
      );
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.includes("tokenizeText")
      )).toBe(true);
    });
  });
});
