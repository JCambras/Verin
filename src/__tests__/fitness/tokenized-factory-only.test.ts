import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
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
  inMemoryProject,
  realSemanticProject,
  REPO_ROOT,
} from "./_fence-utils";
import { SYSTEM_ACTOR_IDS } from "@contracts/tenant";

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
  {
    typeName: "ObservabilityId",
    declaration: "src/domain/observability/safe-values.ts",
    factory: "src/domain/observability/safe-values.ts",
  },
] as const;

const TRUSTED_FACTORY_CALLS = [
  {
    name: "principalFromIdentity",
    declaration: "src/contracts/principal.ts",
    allowed: [
      { file: "src/infrastructure/identity/identity-store.ts", owner: "createSession" },
      { file: "src/infrastructure/identity/session.ts", owner: "principalFromRow" },
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

const REVIEWED_FACTORY_EXPORTS = new Map<string, ReadonlySet<string>>([
  ["src/contracts/authz.ts", new Set(["actorRefOf", "authorizeGovernedAction"])],
  ["src/contracts/principal.ts", new Set([
    "delegatedWriteActor", "principalFromIdentity", "systemWriteActor",
    "writeActorOf",
  ])],
  ["src/contracts/tenant.ts", new Set([
    "systemTenant", "tenantFromIdentity", "tenantOf",
  ])],
  ["src/infrastructure/pii/tokenize.ts", new Set([
    "tokenizeRecord", "tokenizeText",
  ])],
  ["src/domain/observability/safe-values.ts", new Set(["observabilityId"])],
]);

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
    queue.push(
      ...current.getAliasTypeArguments(),
      ...current.getTypeArguments(),
      ...current.getUnionTypes(),
      ...current.getIntersectionTypes(),
      // Base types too (the sibling declaredAs() in llm-pii-boundary already
      // walks them): `interface AnyTenant extends TenantContext {}` is a
      // different symbol with a different name, so without this a one-line
      // sub-interface launders every sealed type past the fence AND the ESLint
      // mirror, leaving only the runtime WeakSet — the layer this fence backs up.
      ...current.getBaseTypes(),
    );
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

/**
 * Test-only injection points into PRODUCTION authority allowlists. No shipped
 * module may reach one: registerTestSystemActor widens the set systemTenant
 * accepts, so a shipped caller could attribute audit entries in a real tenant's
 * hash chain to the actor "test". Keyed SEMANTICALLY (never on identifier text)
 * so an aliased import — `import { registerTestSystemActor as reg }` — is caught.
 */
const TEST_ONLY_INJECTION_POINTS = [
  { file: "src/contracts/tenant.ts", name: "registerTestSystemActor" },
] as const;

export function detectShippedTestAuthorityUse(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizedPath(sf.getFilePath());
    if (
      (!normalized.startsWith("src/") && !normalized.startsWith("scripts/")) ||
      normalized.includes("/__tests__/")
    ) continue;
    for (const identifier of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
      const symbol = identifier.getSymbol();
      const target = symbol?.getAliasedSymbol() ?? symbol;
      for (const point of TEST_ONLY_INJECTION_POINTS) {
        if (
          normalized === point.file ||
          target?.getName() !== point.name ||
          !target.getDeclarations().some((declaration) =>
            normalizedPath(declaration.getSourceFile().getFilePath()) === point.file
          )
        ) continue;
        out.push(`${normalized}:${identifier.getStartLineNumber()} references ${point.name}`);
      }
    }
  }
  return out;
}

/** Does any call beneath these nodes resolve into the sealed type's factory module? */
function consultsFactory(nodes: readonly Node[], factory: string): boolean {
  return nodes.some((node) =>
    [...(Node.isCallExpression(node) ? [node] : []), ...node.getDescendantsOfKind(SyntaxKind.CallExpression)]
      .some((call) => {
        const symbol = call.getExpression().getSymbol();
        const target = symbol?.getAliasedSymbol() ?? symbol;
        return Boolean(target?.getDeclarations().some((declaration) =>
          normalizedPath(declaration.getSourceFile().getFilePath()) === factory
        ));
      })
  );
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

    // A user-defined type predicate / assertion signature MINTS a sealed type out
    // of `unknown` with no cast and no literal: `asserts value is TenantContext`
    // is exactly as powerful as the cast this fence exists to stop, and neither
    // detectFactoryResultLaundering (return type is boolean/void) nor ESLint
    // (no TSTypePredicate selector) sees it.
    for (const predicate of sf.getDescendantsOfKind(SyntaxKind.TypePredicate)) {
      const typeNode = predicate.getTypeNode();
      const sealed = typeNode ? sealedType(typeNode.getType()) : null;
      if (sealed && normalized !== sealed.factory) {
        out.push(
          `${normalized}:${predicate.getStartLineNumber()} - type predicate narrows to sealed type '${sealed.typeName}' outside its factory`,
        );
      }
    }

    // A generic coercion helper (`coerce<T>(v: unknown): T`) mints a sealed type
    // with no named cast anywhere: the sealed name appears only as an explicit
    // TYPE ARGUMENT at the call site, or as the declared annotation the call
    // initializes. Both are handled here so the helper has nothing to hide behind.
    // The one sanctioned shape is a generic that CONSULTS the factory's own
    // runtime seal (the zod ingress gate's `isSealedTokenized` check) — that
    // proves the value came from the factory rather than asserting that it did.
    for (const kind of [SyntaxKind.CallExpression, SyntaxKind.NewExpression] as const) {
      for (const call of sf.getDescendantsOfKind(kind)) {
        for (const typeArgument of call.getTypeArguments()) {
          const sealed = sealedType(typeArgument.getType());
          if (
            sealed &&
            normalized !== sealed.factory &&
            !consultsFactory(call.getArguments(), sealed.factory)
          ) {
            out.push(
              `${normalized}:${call.getStartLineNumber()} - sealed type '${sealed.typeName}' minted through an explicit type argument outside its factory`,
            );
          }
        }
      }
    }
    for (const declaration of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const typeNode = declaration.getTypeNode();
      const initializer = declaration.getInitializer();
      const sealed = typeNode ? sealedType(typeNode.getType()) : null;
      if (!sealed || !initializer || normalized === sealed.factory) continue;
      const call = Node.isAwaitExpression(initializer)
        ? initializer.getExpression()
        : initializer;
      if (!Node.isCallExpression(call) || consultsFactory([call], sealed.factory)) {
        continue;
      }
      const symbol = call.getExpression().getSymbol();
      const target = symbol?.getAliasedSymbol() ?? symbol;
      const fromFactory = target?.getDeclarations().some((candidate) =>
        normalizedPath(candidate.getSourceFile().getFilePath()) === sealed.factory
      );
      if (!fromFactory) {
        out.push(
          `${normalized}:${declaration.getStartLineNumber()} - sealed type '${sealed.typeName}' annotated onto a value produced outside its factory`,
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
      const parent = reference.getParent();
      if (
        reference.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) ||
        reference.getFirstAncestorByKind(SyntaxKind.ExportDeclaration) ||
        (Node.isFunctionDeclaration(parent) &&
          parent.getNameNode() === reference)
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
  out.push(...detectFactoryResultLaundering(project));
  return [...new Set(out)];
}

function callableSignatures(
  type: Type,
  seen = new Set<string>(),
): Signature[] {
  const key = `${type.getText()}::${type.getFlags()}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const signatures = [...type.getCallSignatures()];
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  const projectType = !symbol || symbol.getDeclarations().some((declaration) =>
    normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
  );
  if (!projectType) return signatures;
  for (const property of type.getProperties()) {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0];
    if (!declaration) continue;
    signatures.push(
      ...callableSignatures(property.getTypeAtLocation(declaration), seen),
    );
  }
  return signatures;
}

function detectFactoryResultLaundering(project: Project): string[] {
  const out: string[] = [];
  for (const [file, reviewed] of REVIEWED_FACTORY_EXPORTS) {
    const sf = project.getSourceFiles().find((sourceFile) =>
      normalizedPath(sourceFile.getFilePath()) === file
    );
    if (!sf) continue;
    for (const [name, declarations] of sf.getExportedDeclarations()) {
      if (reviewed.has(name)) continue;
      for (const declaration of declarations) {
        if (
          !Node.isFunctionDeclaration(declaration) &&
          !Node.isVariableDeclaration(declaration) &&
          !Node.isClassDeclaration(declaration)
        ) {
          continue;
        }
        for (const signature of callableSignatures(declaration.getType())) {
          const sealed = sealedType(signature.getReturnType());
          if (sealed) {
            out.push(
              `${file}:${declaration.getStartLineNumber()} - exported '${name}' launders sealed type '${sealed.typeName}'`,
            );
          }
        }
      }
    }
  }
  return out;
}

/**
 * The ESLint mirror's two lists, read from the config source. Nothing fails when
 * the mirror and this fence diverge unless something compares them, and a mirror
 * that seals four of seven types is an editor that stays silent on the three that
 * carry write attribution, actor identity, and observability ids.
 */
function eslintMirrorArray(name: string): string[] {
  const text = readFileSync(join(REPO_ROOT, "eslint.config.mjs"), "utf8");
  const block = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(text);
  if (!block) return [];
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!).sort();
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

  it("enforces: no production authority allowlist ships a test actor id", () => {
    expect([...SYSTEM_ACTOR_IDS].filter((id) => /^test\b/.test(id))).toEqual([]);
  });

  it("enforces: the test-only authority injection point has no shipped caller", () => {
    const leaks = detectShippedTestAuthorityUse(realSemanticProject());
    expect(leaks, `shipped code widening production authority:\n${leaks.join("\n")}`).toEqual([]);
  });

  it("enforces: the ESLint edit-time mirror seals exactly the same types and factories", () => {
    expect(eslintMirrorArray("SEALED_TYPES")).toEqual(
      [...new Set(SEALED.map((sealed) => sealed.typeName))].sort(),
    );
    expect(eslintMirrorArray("SEALED_FACTORY_FILES")).toEqual(
      [...new Set(SEALED.map((sealed) => sealed.factory))].sort(),
    );
  });

  describe("detects (companion): structural and semantic bypasses are caught", () => {
    it("catches shipped code widening production authority, even through an ALIAS", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `
          export function registerTestSystemActor(id: string): string { return id; }
        `,
        "/src/infrastructure/crm/direct.ts": `
          import { registerTestSystemActor } from "../../contracts/tenant";
          registerTestSystemActor("test");
        `,
        "/src/infrastructure/crm/aliased.ts": `
          import { registerTestSystemActor as reg } from "../../contracts/tenant";
          reg("test");
        `,
      });
      expect(detectShippedTestAuthorityUse(project).sort()).toEqual([
        "src/infrastructure/crm/aliased.ts:3 references registerTestSystemActor",
        "src/infrastructure/crm/direct.ts:3 references registerTestSystemActor",
      ]);
    });

    it("catches a cast to a sub-interface that merely EXTENDS a sealed type", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          interface AnyTenant extends TenantContext {}
          const tenant = JSON.parse("{}") as AnyTenant;
          void tenant;
        `,
      );
      expect(detectSealedTypeConstruction(project).some((hit) =>
        hit.startsWith("src/app/evil.ts") && hit.includes("TenantContext")
      )).toBe(true);
    });

    it("catches an assertion signature minting a sealed type outside its factory", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          export function assumeTenant(value: unknown): asserts value is TenantContext {
            void value;
          }
          export function looksTenant(value: unknown): value is TenantContext {
            return typeof value === "object";
          }
        `,
      );
      const hits = detectSealedTypeConstruction(project).filter((hit) =>
        hit.includes("type predicate narrows to sealed type 'TenantContext'")
      );
      expect(hits).toHaveLength(2);
    });

    it("catches a generic coercion helper called with a sealed type argument", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          function coerce<T>(value: unknown): T { return value as T; }
          const tenant = coerce<TenantContext>(JSON.parse("{}"));
          void tenant;
        `,
      );
      expect(detectSealedTypeConstruction(project).some((hit) =>
        hit.includes("explicit type argument") && hit.includes("TenantContext")
      )).toBe(true);
    });

    it("catches a sealed annotation filled by a call outside the factory", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          function coerce(value: unknown) { return value as never; }
          const tenant: TenantContext = coerce(JSON.parse("{}"));
          void tenant;
        `,
      );
      expect(detectSealedTypeConstruction(project).some((hit) =>
        hit.includes("produced outside its factory") && hit.includes("TenantContext")
      )).toBe(true);
    });

    it("allows a sealed annotation filled by the type's own factory", () => {
      const project = sealedFixture(
        "/src/app/fine.ts",
        `
          import { systemTenant, type TenantContext } from "../contracts/tenant";
          const tenant: TenantContext = systemTenant("seed", "org");
          void tenant;
        `,
      );
      expect(detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/fine.ts")
      )).toEqual([]);
    });

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

    it("catches an ObservabilityId assertion outside its runtime-sealed factory", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { ObservabilityId } from "../domain/observability/safe-values";
          const id = { field: "entityId", value: "941000517334" } as ObservabilityId;
          void id;
        `,
      );
      project.createSourceFile(
        "/src/domain/observability/safe-values.ts",
        `export interface ObservabilityId { field: string; value: string }`,
      );
      expect(detectSealedTypeConstruction(project).some((hit) =>
        hit.includes("ObservabilityId")
      )).toBe(true);
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
    it("catches privileged result wrappers exported by factory declaration modules", () => {
      const project = inMemoryProject({
        "/src/contracts/tenant.ts": `
          export interface TenantContext { orgId: string }
          export function tenantFromIdentity(actorId: string, orgId: string): TenantContext { return { orgId } }
          export function systemTenant(systemId: string, orgId: string): TenantContext { return { orgId } }
          export function mintTenant(orgId: string): TenantContext {
            return systemTenant("seed", orgId);
          }
        `,
        "/src/contracts/principal.ts": `
          import type { TenantContext } from "./tenant";
          export interface Principal { userId: string }
          export interface WriteActor { tenant: TenantContext; actorUserId: string }
          export function principalFromIdentity(input: object): Principal { return input as Principal }
          export function systemWriteActor(systemId: string, orgId: string): WriteActor { throw new Error(); }
          export function delegatedWriteActor(actor: WriteActor, actorUserId: string): WriteActor { return { ...actor, actorUserId }; }
          export function mintActor(orgId: string): WriteActor {
            return systemWriteActor("seed", orgId);
          }
        `,
        "/src/infrastructure/pii/tokenize.ts": `
          export function tokenizeText(raw: string): object { return { value: raw }; }
          export function tokenizeRecord(raw: object): object { return raw; }
          export function mintToken(raw: string): object {
            return tokenizeText(raw);
          }
        `,
        "/src/infrastructure/pii/llm-projection.ts": "",
      });
      const hits = detectUntrustedFactoryCalls(project);
      for (const name of ["systemTenant", "systemWriteActor", "tokenizeText"]) {
        expect(hits.some((hit) => hit.includes(name)), name).toBe(true);
      }
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
