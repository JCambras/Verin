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
  moduleReferences,
  realSemanticProject,
  REPO_ROOT,
  typeKey,
} from "./_fence-utils";
import { registerTestSystemActor, SYSTEM_ACTOR_IDS } from "@contracts/tenant";

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

/**
 * The ONE factory allowed to build a `piiFree` payload — DERIVED from the registry
 * above rather than spelled out at each check, so moving the scrubber cannot leave
 * three hardcoded copies of its path behind.
 */
const TOKENIZED_FACTORY =
  SEALED.find((sealed) => sealed.typeName === "Tokenized")!.factory;

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
  ["src/domain/observability/safe-values.ts", new Set([
    "observabilityId", "observabilityIdOrRedacted",
  ])],
]);

function normalizedPath(path: string): string {
  const rel = relative(REPO_ROOT, path).replace(/\\/g, "/");
  return rel.startsWith("..") ? path.replace(/^\//, "") : rel;
}

/**
 * Does this type reach a sealed type?
 *
 * `descendTypeArguments` is the difference between "this type MENTIONS a sealed
 * type" and "a value of this type IS a sealed type". Naming a sealed type inside
 * a cast is laundering (`x as Map<string, TenantContext>` hands out sealed values
 * from `.get()`), so casts use the full walk. But a value of type
 * `Map<string, TenantContext>` is a Map, not a TenantContext — so the positions
 * that describe a VALUE (a type argument that flows out of a call, a declared
 * annotation) use the narrow walk, or `new Map<string, TenantContext>()` and
 * `useState<Principal | null>(null)` would fail the build while minting nothing.
 *
 * `candidates` narrows WHICH sealed types count, so the same walk can answer "does
 * this cast's SOURCE already hold the very type its target names?" without a second
 * copy of the traversal drifting away from this one.
 *
 * `descendForeignProperties` lifts the project-owned gate on property/return
 * descent. That gate keeps the TARGET side from dragging library type graphs into
 * every question, but on the SOURCE side it invents mints: `parsed.data as
 * MaskedLlmRequest` starts from a type zod's .d.ts owns whose PROPERTIES are this
 * repo's `Tokenized<…>` - the value plainly carries the sealed type, and only the
 * owner of the containing symbol was foreign.
 */
function sealedType(
  type: Type,
  descendTypeArguments = true,
  candidates: readonly (typeof SEALED)[number][] = SEALED,
  descendForeignProperties = false,
): (typeof SEALED)[number] | null {
  const queue = [type];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = typeKey(current);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const symbol of [current.getAliasSymbol(), current.getSymbol()]) {
      if (!symbol) continue;
      for (const sealed of candidates) {
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
      ...current.getUnionTypes(),
      ...current.getIntersectionTypes(),
      // Base types too (the sibling declaredAs() in llm-pii-boundary already
      // walks them): `interface AnyTenant extends TenantContext {}` is a
      // different symbol with a different name, so without this a one-line
      // sub-interface launders every sealed type past the fence AND the ESLint
      // mirror, leaving only the runtime WeakSet — the layer this fence backs up.
      ...current.getBaseTypes(),
    );
    if (descendTypeArguments) {
      queue.push(...current.getAliasTypeArguments(), ...current.getTypeArguments());
      const symbol = current.getAliasSymbol() ?? current.getSymbol();
      const projectOwned = !symbol || symbol.getDeclarations().some((declaration) =>
        Node.isTypeLiteral(declaration) ||
        normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
      );
      if (projectOwned || descendForeignProperties) {
        for (const property of current.getProperties()) {
          const declaration = property.getValueDeclaration() ??
            property.getDeclarations()[0];
          if (declaration) queue.push(property.getTypeAtLocation(declaration));
        }
        for (const signature of [
          ...current.getCallSignatures(),
          ...current.getConstructSignatures(),
        ]) {
          queue.push(signature.getReturnType());
        }
      }
    }
  }
  return null;
}

/** The sealed type a VALUE of this type is (never one it merely contains). */
function sealedValueType(type: Type): (typeof SEALED)[number] | null {
  return sealedType(type, false);
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
    for (const reference of moduleReferences(sf)) {
      if (![
        "create-require",
        "dynamic-import",
        "import-equals",
        "require",
        "require-reference",
      ].includes(reference.kind)) continue;
      if (reference.specifier === null) {
        out.push(
          `${normalized}:${reference.line} - unverifiable module load could expose a privileged factory`,
        );
        continue;
      }
      const targetPath = resolvedModulePath(
        project,
        sf,
        reference.specifier,
      );
      const names = targetPath ? privilegedModules.get(targetPath) : undefined;
      if (names && targetPath !== normalized) {
        out.push(
          `${normalized}:${reference.line} - dynamic factory module access exposes ${names.join(", ")}`,
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
 *
 * The name is READ OFF the imported symbol rather than spelled here, so a rename
 * cannot leave this registry pointing at a symbol that no longer exists: the
 * detector below filters on (name, declaring file), and an entry that resolves to
 * nothing makes it return [] forever - green, while shipped code calls the renamed
 * function and widens SYSTEM_ACTOR_IDS. The sibling SYSTEM_ACTOR_IDS check is
 * rename-safe for exactly this reason (it imports the real value); this one was not.
 */
const TEST_ONLY_INJECTION_POINTS = [
  { file: "src/contracts/tenant.ts", name: registerTestSystemActor.name },
] as const;

/**
 * Injection points whose declaration no longer sits where the registry says.
 * Importing the symbol pins its NAME, but not its home: a move that leaves a
 * re-export behind still imports and still renames nothing, while every
 * `declaration.getSourceFile()` comparison in the detector goes false. Existence is
 * asserted against the real project (charter #4), never assumed - the same way each
 * sealed factory path is.
 */
function detectUnresolvedTestAuthorityPoints(project: Project): string[] {
  const out: string[] = [];
  for (const point of TEST_ONLY_INJECTION_POINTS) {
    const sf = project.getSourceFiles().find((candidate) =>
      normalizedPath(candidate.getFilePath()) === point.file
    );
    const declarations = sf?.getExportedDeclarations().get(point.name) ?? [];
    if (
      !declarations.some((declaration) =>
        normalizedPath(declaration.getSourceFile().getFilePath()) === point.file
      )
    ) {
      out.push(
        `${point.file} no longer declares an exported '${point.name}' - detectShippedTestAuthorityUse would resolve nothing and pass vacuously`,
      );
    }
  }
  return out;
}

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
      // An unresolved identifier is checked HERE rather than inside the point loop:
      // the registry name is now read off the real symbol, so it is a `string` and
      // `target?.getName() !== point.name` no longer narrows `target` the way a
      // comparison against a literal type did.
      const target = symbol?.getAliasedSymbol() ?? symbol;
      if (!target) continue;
      for (const point of TEST_ONLY_INJECTION_POINTS) {
        if (
          normalized === point.file ||
          target.getName() !== point.name ||
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

function isFunctionLike(node: Node): boolean {
  return Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) || Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) || Node.isConstructorDeclaration(node);
}

/** The value an `async`/thenable position actually yields. */
function awaited(type: Type): Type {
  const target = type.getAliasSymbol() ?? type.getSymbol();
  if (target?.getName() !== "Promise") return type;
  const [inner] = type.getTypeArguments();
  return inner ? awaited(inner) : type;
}

/**
 * A value the checker has stopped reasoning about. `any`/`unknown` (and the `never`
 * of an exhaustive-cast helper) are the ONLY things assignable to a `unique symbol`
 * brand without a cast, so they are the whole compile-legal mint surface for the
 * annotation rule below.
 */
function isUncheckedSource(type: Type): boolean {
  return type.isAny() || type.isUnknown() || type.isNever();
}

/** Nothing in this repo nests a sealed type deeper than a handful of positions. */
const POSITION_DEPTH = 8;

/** One step into a type: a named property, an array element, a type argument, a return. */
type PositionStep =
  | { readonly kind: "property"; readonly name: string }
  | { readonly kind: "element" }
  | { readonly kind: "argument"; readonly index: number }
  | { readonly kind: "call-return"; readonly index: number }
  | { readonly kind: "construct-return"; readonly index: number };

interface SealedPosition {
  readonly steps: readonly PositionStep[];
  /** The sealed type living there, WITH its type arguments. */
  readonly sealed: string;
  readonly owner: (typeof SEALED)[number];
}

interface SealedPositionInventory {
  readonly positions: readonly SealedPosition[];
  readonly complete: boolean;
}

/**
 * The sealed instance a value of this type IS - never one it merely contains - with
 * its type arguments folded into the key, so `ActionGrant<"pii.view">` and
 * `ActionGrant<"decision.approve">` are different authorities rather than one name.
 */
function sealedKeyOf(type: Type): string | null {
  const unions = type.getUnionTypes();
  if (unions.length) {
    const keys = unions.map(sealedKeyOf);
    return keys.every((key): key is string => key !== null) &&
      new Set(keys).size === 1
      ? keys[0]!
      : null;
  }
  const intersections = type.getIntersectionTypes();
  if (intersections.length) {
    const keys = intersections
      .map(sealedKeyOf)
      .filter((key): key is string => key !== null);
    return keys.length > 0 && new Set(keys).size === 1 ? keys[0]! : null;
  }
  const direct = sealedValueType(type);
  if (!direct) return null;
  const args = [...type.getAliasTypeArguments(), ...type.getTypeArguments()];
  return args.length ? `${direct.typeName}<${args.map(typeKey).join(",")}>` : direct.typeName;
}

/** Is this type's own shape declared in this repo? Mirrors sealedType's descent gate. */
function projectOwned(type: Type): boolean {
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  return !symbol || symbol.getDeclarations().some((declaration) =>
    Node.isTypeLiteral(declaration) ||
    normalizedPath(declaration.getSourceFile().getFilePath()).startsWith("src/")
  );
}

/**
 * WHERE a sealed type sits inside this one - the structural positions a value of
 * this type hands one out at.
 *
 * "Does the other side MENTION this sealed type anywhere in its graph?" is not the
 * question. `ActionGrant` carries both a `TenantContext` and a `WriteActor`, so
 * every governed route handler holds a value that mentions three sealed types, and
 * a reachable-anywhere test exempts `grant as unknown as TenantContext` - a
 * one-line mint of the very authority the cast names. Since every sealed type is
 * `unique symbol`-branded, `as unknown as X` is the ONLY compile-legal cast form,
 * so that is the MAINLINE laundering shape, not an exotic one.
 *
 * Position is what separates re-shaping an authorized value (`held as { tenant:
 * TenantContext }`, where `held.tenant` already is one) from minting: the sealed
 * type has to come out where it went in. The walk STOPS at a sealed value, or
 * descending `ActionGrant.tenant` would re-open the same hole one level down, and
 * it keeps sealedType's project-owned gate so a cast to a library container costs
 * a type-argument walk rather than that container's whole member graph.
 */
function sealedPositionsOf(
  type: Type,
): SealedPositionInventory {
  const positions: SealedPosition[] = [];
  const visit = (
    current: Type,
    steps: readonly PositionStep[],
    ancestors: ReadonlySet<object>,
  ): boolean => {
    const sealed = sealedKeyOf(current);
    if (!sealed && !sealedType(current)) return true;
    if (steps.length > POSITION_DEPTH) return false;
    if (sealed) {
      const owner = sealedValueType(current);
      if (!owner) return false;
      positions.push({ steps, sealed, owner });
      return true;
    }
    const key = current.compilerType as unknown as object;
    if (ancestors.has(key)) return false;
    const nested = new Set(ancestors).add(key);
    let complete = true;
    for (const member of [
      ...current.getUnionTypes(),
      ...current.getIntersectionTypes(),
      ...current.getBaseTypes(),
    ]) {
      complete = visit(member, steps, nested) && complete;
    }
    const element = current.getArrayElementType();
    if (element) {
      complete = visit(element, [...steps, { kind: "element" }], nested) &&
        complete;
    }
    [...current.getAliasTypeArguments(), ...current.getTypeArguments()]
      .forEach((argument, index) => {
        complete = visit(
          argument,
          [...steps, { kind: "argument", index }],
          nested,
        ) && complete;
      });
    if (!projectOwned(current)) return complete;
    for (const property of current.getProperties()) {
      const declaration = property.getValueDeclaration() ??
        property.getDeclarations()[0];
      if (declaration) {
        complete = visit(
          property.getTypeAtLocation(declaration),
          [...steps, { kind: "property", name: property.getName() }],
          nested,
        ) && complete;
      }
    }
    current.getCallSignatures().forEach((signature, index) => {
      complete = visit(
        signature.getReturnType(),
        [...steps, { kind: "call-return", index }],
        nested,
      ) && complete;
    });
    current.getConstructSignatures().forEach((signature, index) => {
      complete = visit(
        signature.getReturnType(),
        [...steps, { kind: "construct-return", index }],
        nested,
      ) && complete;
    });
    return complete;
  };
  return { positions, complete: visit(type, [], new Set()) };
}

/**
 * The type the OTHER side of a cast delivers at the same position - resolved by
 * name on demand, never by enumerating that side's members, so a foreign source
 * (zod's inferred `parsed.data`) is answered without dragging its type graph in.
 */
function nextTypeAtPosition(type: Type, step: PositionStep): Type | null {
  if (step.kind === "property") {
    const property = type.getProperty(step.name);
    const declaration = property?.getValueDeclaration() ?? property?.getDeclarations()[0];
    return property && declaration ? property.getTypeAtLocation(declaration) : null;
  }
  if (step.kind === "element") {
    return type.getArrayElementType() ?? null;
  }
  if (step.kind === "argument") {
    return [...type.getAliasTypeArguments(), ...type.getTypeArguments()][step.index] ?? null;
  }
  return step.kind === "call-return"
    ? type.getCallSignatures()[step.index]?.getReturnType() ?? null
    : type.getConstructSignatures()[step.index]?.getReturnType() ?? null;
}

function sealedKeyAtPosition(type: Type, steps: readonly PositionStep[]): string | null {
  if (steps.length === 0) return sealedKeyOf(type);
  const unions = type.getUnionTypes();
  if (unions.length) {
    const keys = unions.map((member) => sealedKeyAtPosition(member, steps));
    return keys.every((key): key is string => key !== null) &&
      new Set(keys).size === 1
      ? keys[0]!
      : null;
  }
  const [step, ...rest] = steps;
  const next = nextTypeAtPosition(type, step!);
  if (next) return sealedKeyAtPosition(next, rest);
  const intersections = type.getIntersectionTypes();
  if (intersections.length) {
    const keys = intersections
      .map((member) => sealedKeyAtPosition(member, steps))
      .filter((key): key is string => key !== null);
    return keys.length > 0 && new Set(keys).size === 1 ? keys[0]! : null;
  }
  return null;
}

function uncheckedAtPosition(type: Type, steps: readonly PositionStep[]): boolean {
  if (steps.length === 0) return isUncheckedSource(awaited(type));
  const unions = type.getUnionTypes();
  if (unions.length) {
    return unions.some((member) => uncheckedAtPosition(member, steps));
  }
  const [step, ...rest] = steps;
  const next = nextTypeAtPosition(type, step!);
  if (next) return uncheckedAtPosition(next, rest);
  return type.getIntersectionTypes().some((member) =>
    uncheckedAtPosition(member, steps)
  );
}

/**
 * A sealed ANNOTATION filled from a value the checker never verified.
 *
 * Every sealed interface carries a `unique symbol` brand, so the only compile-legal
 * way to fill one WITHOUT an `as` cast is to hand it an `any`/`unknown` — from
 * `JSON.parse`, `await req.json()`, an untyped cache read. Keying on THAT (rather
 * than on "the source is not already sealed") is what makes the rule two-sided:
 * ordinary propagation (`const t: TenantContext = deps.tenantFor(id)`) and the
 * nullable shapes the design note promised to leave alone (`const p: Principal |
 * null = null`) both type-check against a real declaration, so neither is a mint.
 *
 * The annotation is read with the FULL walk, so it reaches a sealed type through a
 * container: `Promise<TenantContext>` is the normal shape of an async laundering
 * function, and `const ts: TenantContext[] = JSON.parse("[]")` hands out sealed
 * elements just as surely as the scalar form. That differs from `new Map<string,
 * TenantContext>()`, which the type-argument rule below still leaves alone, because
 * an empty container mints nothing — here an `any` becomes every member. The SOURCE
 * is read through `await`, because an async function returning `Promise<any>` is
 * handing the annotation an unchecked value one layer down.
 */
function detectSealedAnnotationMints(sf: SourceFile, normalized: string): string[] {
  const out: string[] = [];
  const check = (annotation: Type | undefined, source: Node | undefined, line: number): void => {
    if (!annotation || !source) return;
    const expected = awaited(annotation);
    const value = awaited(source.getType());
    const inventory = sealedPositionsOf(expected);
    if (!inventory.complete) {
      const unresolved = SEALED.filter((candidate) =>
        normalized !== candidate.factory &&
        sealedType(expected, true, [candidate]) !== null
      );
      for (const owner of unresolved) {
        out.push(
          `${normalized}:${line} - sealed type '${owner.typeName}' annotated onto an unchecked value produced outside its factory`,
        );
      }
      return;
    }
    for (const { steps, owner } of inventory.positions) {
      if (
        normalized === owner.factory ||
        (!isUncheckedSource(value) && !uncheckedAtPosition(value, steps))
      ) {
        continue;
      }
      out.push(
        `${normalized}:${line} - sealed type '${owner.typeName}' annotated onto an unchecked value produced outside its factory`,
      );
    }
  };

  for (const kind of [
    SyntaxKind.VariableDeclaration,
    SyntaxKind.PropertyDeclaration,
    // A parameter DEFAULT is an initializer against a declared annotation too.
    SyntaxKind.Parameter,
  ] as const) {
    for (const declaration of sf.getDescendantsOfKind(kind)) {
      check(
        declaration.getTypeNode()?.getType(),
        declaration.getInitializer(),
        declaration.getStartLineNumber(),
      );
    }
  }

  // DECLARE-then-ASSIGN (`let t: TenantContext; t = JSON.parse(x)`) never passes
  // through an initializer, so the assignment itself is the mint site.
  for (const assignment of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (assignment.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    check(
      assignment.getLeft().getType(),
      assignment.getRight(),
      assignment.getStartLineNumber(),
    );
  }

  for (const kind of [
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.ArrowFunction,
    SyntaxKind.FunctionExpression,
    SyntaxKind.MethodDeclaration,
    SyntaxKind.GetAccessor,
  ] as const) {
    for (const fn of sf.getDescendantsOfKind(kind)) {
      const body = fn.getBody();
      if (!body) continue;
      const contextualMethodReturns = (): Type[] => {
        if (!Node.isMethodDeclaration(fn)) return [];
        const parent = fn.getParent();
        const ownerTypes: Type[] = [];
        if (Node.isObjectLiteralExpression(parent) && parent.getContextualType()) {
          ownerTypes.push(parent.getContextualType()!);
        }
        const cls = fn.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
        if (cls) {
          ownerTypes.push(
            ...cls.getImplements().map((implemented) =>
              implemented.getExpression().getType()
            ),
            ...cls.getType().getBaseTypes(),
          );
        }
        return ownerTypes.flatMap((ownerType) => {
          const property = ownerType.getProperty(fn.getName());
          if (!property) return [];
          const declaration = property.getValueDeclaration() ??
            property.getDeclarations()[0] ??
            fn;
          return property.getTypeAtLocation(declaration)
            .getCallSignatures()
            .map((signature) => signature.getReturnType());
        });
      };
      const annotatedReturns = fn.getReturnTypeNode()
        ? [fn.getReturnTypeNode()!.getType()]
        : Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)
        ? (fn.getContextualType()?.getCallSignatures() ?? []).map((signature) =>
          signature.getReturnType()
        )
        : contextualMethodReturns();
      if (annotatedReturns.length === 0) continue;
      if (!Node.isBlock(body)) {
        for (const returnType of annotatedReturns) {
          check(returnType, body, body.getStartLineNumber());
        }
        continue;
      }
      for (const statement of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
        // Only THIS function's returns — a nested closure has its own contract.
        if (statement.getFirstAncestor(isFunctionLike) !== fn) continue;
        for (const returnType of annotatedReturns) {
          check(returnType, statement.getExpression(), statement.getStartLineNumber());
        }
      }
    }
  }
  return out;
}

/**
 * Type parameters a signature INVENTS: named in the return type, named by no
 * parameter. `coerce<T>(v: unknown): T` invents T — whatever the call site asks
 * for, it gets — which is the cast this fence exists to stop, wearing a generic.
 * `unwrap<T>(r: Result<T>): T` invents nothing: T was already sealed on the way in.
 */
function inventedTypeParameters(declaration: Node): Set<string> {
  if (!Node.isFunctionLikeDeclaration(declaration) && !Node.isMethodSignature(declaration) &&
    !Node.isFunctionTypeNode(declaration)) {
    return new Set();
  }
  const declared = new Set(declaration.getTypeParameters().map((p) => p.getName()));
  if (!declared.size) return new Set();
  const namesIn = (node: Node | undefined): string[] =>
    node
      ? [node, ...node.getDescendants()]
        .filter((child): child is Node => Node.isIdentifier(child))
        .map((child) => child.getText())
        .filter((name) => declared.has(name))
      : [];
  const inParameters = new Set(
    declaration.getParameters().flatMap((parameter) => namesIn(parameter.getTypeNode())),
  );
  return new Set(
    namesIn(declaration.getReturnTypeNode()).filter((name) => !inParameters.has(name)),
  );
}

/**
 * A call whose sealed result came from INFERENCE rather than from the callee's
 * declaration. Explicit (`coerce<TenantContext>(raw)`) and inferred
 * (`const t: TenantContext = coerce(raw)`) are the same mint — the type argument is
 * merely written down in one of them — so gating on an explicit type-argument list
 * left the inferred half invisible to every layer except the runtime WeakSet.
 */
function mintsThroughInventedTypeParameter(
  call: Node & { getExpression(): Node },
): (typeof SEALED)[number] | null {
  const sealed = sealedValueType(awaited(call.getType()));
  if (!sealed) return null;
  const symbol = call.getExpression().getSymbol();
  const target = symbol?.getAliasedSymbol() ?? symbol;
  const declarations = target?.getDeclarations() ?? [];
  // The factory's OWN generic entry points may of course be parameterized:
  // `tokenizeRecord<Shape>(…)` is the sanctioned mint, not an evasion of it.
  if (
    declarations.some((declaration) =>
      normalizedPath(declaration.getSourceFile().getFilePath()) === sealed.factory
    )
  ) {
    return null;
  }
  return declarations.some((declaration) => inventedTypeParameters(declaration).size > 0)
    ? sealed
    : null;
}

/** Strip `as T` / `<T>v` / `(v)` / `v satisfies T` down to the expression itself. */
function unwrapAssertions(node: Node): Node {
  return Node.isAsExpression(node) || Node.isTypeAssertion(node) ||
      Node.isParenthesizedExpression(node) || Node.isSatisfiesExpression(node)
    ? unwrapAssertions(node.getExpression())
    : node;
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
        const type = typeNode?.getType();
        // The TARGET is read with the FULL walk, because a cast to a CONTAINER of a
        // sealed type hands out the sealed value at the property it names:
        // `(row as { tenant: TenantContext }).tenant` is a TenantContext that never
        // passed tenantOf/systemTenant. Gating on `sealedValueType` (the narrow walk)
        // let that shape through entirely, which left this fence WEAKER than the
        // ESLint mirror it is asserted to be a superset of - the mirror's descendant
        // selector matches the name wherever it appears inside the cast.
        if (!type || !sealedType(type)) continue;
        const inventory = sealedPositionsOf(type);
        const source = awaited(unwrapAssertions(node.getExpression()).getType());
        const foreign = inventory.complete
          ? inventory.positions.filter(({ steps, sealed, owner }) =>
            normalized !== owner.factory &&
            sealedKeyAtPosition(source, steps) !== sealed
          ).map(({ owner }) => owner)
          : SEALED.filter((candidate) =>
            normalized !== candidate.factory &&
            sealedType(type, true, [candidate]) !== null
          );
        if (foreign.length === 0) continue;
        // ...and the SOURCE is what tells minting apart from re-shaping, compared at
        // the SAME structural position. "The source mentions this sealed type
        // somewhere" is not enough: `ActionGrant` carries a `TenantContext` and a
        // `WriteActor`, so a reachable-anywhere test exempts `grant as unknown as
        // TenantContext` - the mainline laundering shape, since a `unique symbol`
        // brand leaves `as unknown as X` the only compile-legal cast form.
        for (const sealed of new Set(foreign)) {
          out.push(
            `${normalized}:${node.getStartLineNumber()} - cast to sealed type '${sealed.typeName}' outside its factory`,
          );
        }
      }
    }

    // A composite literal fills the same annotation the call-argument rule below
    // reads, one property further in: `consume({ tenant: JSON.parse(x) })`. Gated on
    // the literal's OWN type carrying an unchecked member first - resolving a
    // contextual type is the expensive step, and a literal with nothing unchecked in
    // it cannot be minting anything.
    for (
      const literal of [
        ...sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression),
        ...sf.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression),
      ]
    ) {
      const contextual = literal.getContextualType();
      if (!contextual || !sealedType(contextual)) continue;
      const value = awaited(literal.getType());
      const inventory = sealedPositionsOf(awaited(contextual));
      const foreign = inventory.complete
        ? inventory.positions.filter(({ steps, owner }) =>
          normalized !== owner.factory &&
          (isUncheckedSource(value) || uncheckedAtPosition(value, steps))
        ).map(({ owner }) => owner)
        : SEALED.filter((candidate) =>
          normalized !== candidate.factory &&
          sealedType(contextual, true, [candidate]) !== null
        );
      for (const nested of new Set(foreign)) {
        out.push(
          `${normalized}:${literal.getStartLineNumber()} - sealed type '${nested.typeName}' minted from an unchecked call argument outside its factory`,
        );
      }
    }

    for (const literal of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const contextual = literal.getContextualType();
      const sealed = contextual ? sealedValueType(contextual) : null;
      if (sealed && normalized !== sealed.factory) {
        out.push(
          `${normalized}:${literal.getStartLineNumber()} - object literal constructs sealed type '${sealed.typeName}'`,
        );
      }
      // The impostor this rule exists to catch is a hand-built `{ value, piiFree:
      // true }` — so the flag has to BE the flag. A Zod schema DECLARATION describes
      // the shape a parser validates (`piiFree: z.literal(true)`, a ZodLiteral, not a
      // boolean) and mints nothing; flagging it would make the decision-core
      // contracts unrepresentable rather than making anything safer.
      const hasPiiFree = literal.getProperties().some((property) => {
        if (
          !Node.isPropertyAssignment(property) &&
          !Node.isShorthandPropertyAssignment(property)
        ) return false;
        if (property.getName() !== "piiFree") return false;
        const value = Node.isPropertyAssignment(property)
          ? property.getInitializer()
          : property.getNameNode();
        if (!value) return true;
        const inner = unwrapAssertions(value);
        // The flag itself (`piiFree: true`, `… as const`) or a name bound to it
        // (`const piiFree = true as const; { value, piiFree }`). A CALL is a parser
        // describing the flag, never a value claiming to have been scrubbed.
        return inner.getKind() === SyntaxKind.TrueKeyword || Node.isIdentifier(inner);
      });
      if (hasPiiFree && normalized !== TOKENIZED_FACTORY) {
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
      const type = typeNode?.getType();
      if (!type) continue;
      const inventory = sealedPositionsOf(type);
      const foreign = inventory.complete
        ? inventory.positions
          .map(({ owner }) => owner)
          .filter((owner) => normalized !== owner.factory)
        : SEALED.filter((candidate) =>
          normalized !== candidate.factory &&
          sealedType(type, true, [candidate]) !== null
        );
      for (const sealed of new Set(foreign)) {
        out.push(
          `${normalized}:${predicate.getStartLineNumber()} - type predicate narrows to sealed type '${sealed.typeName}' outside its factory`,
        );
      }
    }

    // A generic coercion helper (`coerce<T>(v: unknown): T`) mints a sealed type
    // with no named cast anywhere. Scoped to what the call YIELDS through a type
    // parameter the signature invents, so `new Map<string, TenantContext>()` and
    // `z.custom<Tokenized<string>>(…)` — which hand out no sealed value — are not
    // build failures, while both the explicit and the INFERRED form of the helper
    // are.
    for (const kind of [SyntaxKind.CallExpression, SyntaxKind.NewExpression] as const) {
      for (const call of sf.getDescendantsOfKind(kind)) {
        // Per-TYPE, never whole-file: the `normalized !== sealed.factory` guard below
        // already exempts the Tokenized case this used to skip the file for, and
        // skipping the whole file let `const t: TenantContext = coerce(raw)` inside
        // the scrubber mint any of the OTHER six sealed types silently.
        const sealed = mintsThroughInventedTypeParameter(call);
        if (sealed && normalized !== sealed.factory) {
          out.push(
            `${normalized}:${call.getStartLineNumber()} - sealed type '${sealed.typeName}' minted through an inferred or explicit type argument outside its factory`,
          );
        }
        // A PARAMETER is an annotation the CALLER fills, so `consume(JSON.parse(x))`
        // is the same mint as `const t: TenantContext = JSON.parse(x)` with the
        // annotation moved one frame down - and it leaves no cast, no literal and no
        // type argument on the line for any other rule here to see. Ordered
        // cheap-test-first: the contextual (parameter) type is only resolved for an
        // argument the checker has already stopped reasoning about.
        for (const argument of call.getArguments()) {
          if (!Node.isExpression(argument)) continue;
          const parameter = argument.getContextualType();
          if (!parameter || !sealedType(parameter)) continue;
          const value = awaited(argument.getType());
          const inventory = sealedPositionsOf(awaited(parameter));
          const foreign = inventory.complete
            ? inventory.positions.filter(({ steps, owner }) =>
              normalized !== owner.factory &&
              (isUncheckedSource(value) || uncheckedAtPosition(value, steps))
            ).map(({ owner }) => owner)
            : SEALED.filter((candidate) =>
              normalized !== candidate.factory &&
              sealedType(parameter, true, [candidate]) !== null
            );
          for (const filled of new Set(foreign)) {
            out.push(
              `${normalized}:${argument.getStartLineNumber()} - sealed type '${filled.typeName}' minted from an unchecked call argument outside its factory`,
            );
          }
        }
      }
    }
    out.push(...detectSealedAnnotationMints(sf, normalized));

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
        normalized !== TOKENIZED_FACTORY
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
    // Identifier covers a member access too — `ns.principalFromIdentity`'s NAME node
    // is itself an Identifier that resolves to the factory — so a separate
    // PropertyAccessExpression source could never fire alone, and unprovable
    // detection surface is worse than none. ElementAccess is different and stays:
    // `ns["principalFromIdentity"]` names the factory in a STRING, so the whole
    // expression is the only node that resolves (companion below plants exactly it).
    const references: Node[] = [
      ...sf.getDescendantsOfKind(SyntaxKind.Identifier),
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
  const key = typeKey(type);
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

/**
 * Reviewed factory modules whose path no longer resolves.
 *
 * detectFactoryResultLaundering asks each module for its exports, so an unresolved
 * key does not fail - it silently disables the whole "exported X launders sealed
 * type Y" check for that module, which is precisely what a moved factory or a typo
 * in a new key produces. Asserted against the REAL project below (the companions
 * feed deliberately partial in-memory trees, so the skip belongs there and the
 * assertion belongs here), together with the reconciliation that the keys ARE the
 * sealed factory paths: a sealed factory with no reviewed-export list would ship
 * unlaundering-checked.
 */
function detectUnresolvedFactoryModules(project: Project): string[] {
  return [...REVIEWED_FACTORY_EXPORTS.keys()]
    .filter((file) =>
      !project.getSourceFiles().some((sourceFile) =>
        normalizedPath(sourceFile.getFilePath()) === file
      )
    )
    .map((file) =>
      `${file} - reviewed factory module does not resolve, so its laundering check silently does not run`
    );
}

function detectFactoryResultLaundering(project: Project): string[] {
  const out: string[] = [];
  for (const [file, reviewed] of REVIEWED_FACTORY_EXPORTS) {
    const sf = project.getSourceFiles().find((sourceFile) =>
      normalizedPath(sourceFile.getFilePath()) === file
    );
    // Resolution is not assumed: detectUnresolvedFactoryModules fails the build for
    // the real project when a key stops resolving.
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
      import type { TenantContext } from "./tenant";
      export interface ActorRef { actorId: string }
      // Generic and tenant-carrying like the real one (contracts/authz.ts): a grant
      // is the value every governed handler holds, so it is the source a
      // reachable-anywhere exemption would launder three sealed types out of.
      export interface ActionGrant<A extends string = string> {
        action: A;
        tenant: TenantContext;
      }
    `,
    "/src/contracts/principal.ts": `
      import { systemTenant, type TenantContext } from "./tenant";
      export interface Principal { userId: string }
      export interface WriteActor { tenant: TenantContext; actorUserId: string }
      export function principalFromIdentity(input: object): Principal { return input as Principal }
      // Built through the tenant factory ON PURPOSE: a fixture that violates the
      // detector gives every companion in this file a free baseline hit, and a
      // companion that counts hits it did not plant proves nothing.
      export function systemWriteActor(systemId: string, orgId: string): { tenant: TenantContext } {
        return { tenant: systemTenant(systemId, orgId) }
      }
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

  it("enforces: every reviewed factory module resolves, and covers exactly the sealed factories", () => {
    const unresolved = detectUnresolvedFactoryModules(realSemanticProject());
    expect(unresolved, unresolved.join("\n")).toEqual([]);
    // Equal sets, not subset: a sealed factory absent from the reviewed lists gets
    // no laundering check at all, and a key that is not a sealed factory is a path
    // typo wearing a review.
    expect([...REVIEWED_FACTORY_EXPORTS.keys()].sort()).toEqual(
      [...new Set(SEALED.map((sealed) => sealed.factory))].sort(),
    );
  });

  it("enforces: every test-only authority injection point still resolves where the registry says", () => {
    const unresolved = detectUnresolvedTestAuthorityPoints(realSemanticProject());
    expect(unresolved, unresolved.join("\n")).toEqual([]);
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

  it("enforces: the ESLint mirror is WIRED for every shipped layer, factories excepted", async () => {
    // Matching NAME lists proves nothing while the rule is spread into some layer
    // blocks and not others: src/infrastructure/config/** was uncovered, so a
    // `x as TenantContext` there drew no editor error at all. Resolved through
    // ESLint's own config resolution so the assertion tracks the real wiring.
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const covered = [
      "src/contracts/result.ts",
      "src/domain/workflow/engine.ts",
      "src/infrastructure/crm/house-crm.ts",
      "src/infrastructure/config/index.ts",
      "src/app/api/audit/route.ts",
    ];
    for (const file of covered) {
      const config = await eslint.calculateConfigForFile(join(REPO_ROOT, file));
      const entries = (config.rules?.["no-restricted-syntax"] ?? []) as unknown[];
      expect(
        entries.some((entry) =>
          typeof entry === "object" && entry !== null &&
          String((entry as { selector?: string }).selector ?? "").includes("TSAsExpression")
        ),
        `${file} is not covered by the sealed-type ESLint rule`,
      ).toBe(true);
    }
    // The factory modules are the sanctioned construction sites: exempt on purpose.
    for (const factory of new Set(SEALED.map((sealed) => sealed.factory))) {
      const config = await eslint.calculateConfigForFile(join(REPO_ROOT, factory));
      const entries = (config.rules?.["no-restricted-syntax"] ?? []) as unknown[];
      expect(
        entries.some((entry) =>
          typeof entry === "object" && entry !== null &&
          String((entry as { selector?: string }).selector ?? "").includes("TSAsExpression")
        ),
        `${factory} must stay exempt — it is where sealed types are built`,
      ).toBe(false);
    }
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

    it("catches a test-authority injection point RENAMED or MOVED out from under the registry", () => {
      const [point] = TEST_ONLY_INJECTION_POINTS;
      // A rename: the detector's (name, file) filter matches nothing, so it returns
      // [] and the shipped-caller assertion above passes over a widened allowlist.
      const renamed = detectUnresolvedTestAuthorityPoints(inMemoryProject({
        [`/${point.file}`]: `export function ${point.name}Elsewhere(id: string): string { return id; }`,
      }));
      expect(renamed).toHaveLength(1);
      expect(renamed[0]).toContain(point.name);
      expect(renamed[0]).toContain("pass vacuously");

      // A MOVE behind a re-export: the name still imports (so pinning the symbol is
      // not enough on its own), but no declaration lives at `file` any more, and
      // every declaration-path comparison in the detector goes false.
      const moved = `${point.file.split("/").pop()!.replace(/\.ts$/, "")}-moved`;
      expect(detectUnresolvedTestAuthorityPoints(inMemoryProject({
        [`/${point.file.replace(/[^/]+$/, `${moved}.ts`)}`]:
          `export function ${point.name}(id: string): string { return id; }`,
        [`/${point.file}`]: `export { ${point.name} } from "./${moved}";`,
      }))).toHaveLength(1);
    });

    it("allows the injection point declared exactly where the registry says", () => {
      const [point] = TEST_ONLY_INJECTION_POINTS;
      expect(detectUnresolvedTestAuthorityPoints(inMemoryProject({
        [`/${point.file}`]: `export function ${point.name}(id: string): string { return id; }`,
      }))).toEqual([]);
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

    it("a factory exemption applies only to its own sealed positions", () => {
      const project = sealedFixture(
        "/src/infrastructure/pii/tokenize.ts",
        `
          import type { Tokenized } from "../../contracts/tokenized";
          import type { TenantContext } from "../../contracts/tenant";
          const mixed: { token: Tokenized<string>; tenant: TenantContext } = JSON.parse("{}");
          void mixed;
        `,
      );
      const hits = detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/infrastructure/pii/tokenize.ts")
      );
      expect(hits.some((hit) =>
        hit.includes("TenantContext") && hit.includes("unchecked value")
      ), hits.join("\n")).toBe(true);
      expect(hits.some((hit) =>
        hit.includes("Tokenized") && hit.includes("unchecked value")
      ), hits.join("\n")).toBe(false);
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

    it("plants nothing: the shared fixture itself is clean (so every hit below was planted)", () => {
      expect(
        detectSealedTypeConstruction(sealedFixture("/src/app/fine.ts", `export const nothing = 1;`)),
      ).toEqual([]);
    });

    it("catches a shorthand annotated Tokenized literal", () => {
      const project = sealedFixture(
        "/src/domain/evil.ts",
        `import type { Tokenized } from "../contracts/tokenized"; const piiFree = true as const; const value: Tokenized<string> = { value: "raw", piiFree };`,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.startsWith("src/domain/evil.ts"));
      // Each branch asserted BY ITS MESSAGE: a count alone would stay green when
      // one of the two branches is deleted and the other still fires.
      expect(hits.some((hit) => hit.includes("object literal constructs sealed type 'Tokenized'"))).toBe(true);
      expect(hits.some((hit) => hit.includes("object literal with 'piiFree'"))).toBe(true);
    });

    it("catches a bare `piiFree: true` bag, but not a SCHEMA that merely validates the flag", () => {
      const project = sealedFixture(
        "/src/domain/evil.ts",
        `
          declare const z: { strictObject(shape: object): object; literal<T>(v: T): { brand: "zod"; value: T }; string(): object };
          export const bag = { value: "raw", piiFree: true };
          export const asserted = { value: "raw", piiFree: true as const };
          export const schema = z.strictObject({ value: z.string(), piiFree: z.literal(true) });
        `,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.includes("object literal with 'piiFree'"));
      // Lines 3 and 4 are hand-built impostors — `as const` is not a different one;
      // line 5 is a parser DESCRIBING the shape.
      expect(hits).toHaveLength(2);
      expect(hits[0]).toContain("src/domain/evil.ts:3");
      expect(hits[1]).toContain("src/domain/evil.ts:4");
    });

    it("catches a class implementing an aliased sealed type", () => {
      const project = sealedFixture(
        "/src/domain/evil.ts",
        `import type { Tokenized as Safe } from "../contracts/tokenized"; class Fake implements Safe<string> { value = "raw"; piiFree = true as const; }`,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.startsWith("src/domain/evil.ts"));
      expect(hits.some((hit) => hit.includes("class implements sealed type 'Tokenized'"))).toBe(true);
      expect(hits.some((hit) => hit.includes("class declares 'piiFree'"))).toBe(true);
    });

    it("catches every `any`-sourced sealed mint: return type, class property, and bare property access", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          import type { ActionGrant } from "../contracts/authz";
          export function tenantFromCache(raw: string): TenantContext {
            return JSON.parse(raw);
          }
          export const reviveTenant = (raw: string): TenantContext => JSON.parse(raw);
          export class Holder {
            readonly tenant: TenantContext = JSON.parse("{}");
          }
          declare const body: any;
          const grant: ActionGrant = body.grant;
          void grant;
        `,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.includes("produced outside its factory"));
      // The declaration return, the arrow return, the class property, the const.
      expect(hits).toHaveLength(4);
      expect(hits.some((hit) => hit.includes("ActionGrant"))).toBe(true);
    });

    it("catches an unchecked expression-bodied return under a contextual callable annotation", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          declare const raw: string;
          const revive: () => TenantContext = () => JSON.parse(raw);
          void revive;
        `,
      );
      expect(detectSealedTypeConstruction(project).some((hit) =>
        hit.startsWith("src/app/evil.ts:4") &&
        hit.includes("unchecked value") &&
        hit.includes("TenantContext")
      )).toBe(true);
    });

    it("catches sealed authority nested in unchecked structural containers", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          declare const raw: string;
          const casted = JSON.parse(raw) as { tenant: TenantContext };
          const annotated: { tenant: TenantContext } = JSON.parse(raw);
          void casted;
          void annotated;
        `,
      );
      const hits = detectSealedTypeConstruction(project);
      expect(hits.some((hit) =>
        hit.startsWith("src/app/evil.ts:4") && hit.includes("TenantContext")
      )).toBe(true);
      expect(hits.some((hit) =>
        hit.startsWith("src/app/evil.ts:5") && hit.includes("TenantContext")
      )).toBe(true);
    });

    it("catches a CONTAINER cast off a checked-but-unsealed source, and an unchecked call ARGUMENT", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          declare const row: { tenant: unknown };
          declare function consume(tenant: TenantContext): void;
          const stolen = (row as { tenant: TenantContext }).tenant;
          consume(JSON.parse("{}"));
          void stolen;
        `,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.startsWith("src/app/evil.ts"));
      // `row` is neither sealed NOR unchecked - the two conditions the old rule
      // required - so both of its halves passed this shape, and the property access
      // hands out a TenantContext that never saw tenantOf.
      expect(hits.some((hit) =>
        hit.startsWith("src/app/evil.ts:5") && hit.includes("cast to sealed type 'TenantContext'")
      )).toBe(true);
      // The parameter is the annotation; nothing on line 6 is a cast or a literal.
      expect(hits.some((hit) =>
        hit.startsWith("src/app/evil.ts:6") && hit.includes("unchecked call argument") &&
        hit.includes("TenantContext")
      )).toBe(true);
    });

    it("catches a DIRECT cast whose source merely CARRIES the sealed type elsewhere", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          import type { ActionGrant } from "../contracts/authz";
          import type { Principal } from "../contracts/principal";
          declare const grant: ActionGrant<"pii.view">;
          declare const byId: Map<string, Principal>;
          declare const getTenant: () => TenantContext;
          declare const allTenants: readonly TenantContext[];
          export const a = grant as unknown as TenantContext;
          export const b = byId as unknown as Principal;
          export const c = getTenant as unknown as TenantContext;
          export const d = allTenants as unknown as TenantContext;
          export const e = grant as unknown as ActionGrant<"decision.approve">;
        `,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.startsWith("src/app/evil.ts"));
      // Every source here is CHECKED and mentions the target sealed type somewhere -
      // a grant carries a TenantContext, a Map is parameterized by a Principal, a
      // function RETURNS one, an array holds them. None of them delivers it at the
      // position the cast claims, so all five are mints. A `unique symbol` brand
      // leaves `as unknown as X` the only compile-legal cast form, so this IS the
      // mainline laundering shape.
      for (const line of [9, 10, 11, 12, 13]) {
        expect(
          hits.some((hit) => hit.startsWith(`src/app/evil.ts:${line} `)),
          `line ${line} not reported: ${hits.join(" | ")}`,
        ).toBe(true);
      }
      // ...including re-labelling one authority as another: same symbol, different
      // action, so matching on the NAME alone would hand out an approval grant.
      expect(hits.some((hit) =>
        hit.startsWith("src/app/evil.ts:13") && hit.includes("ActionGrant")
      )).toBe(true);
    });

    it("catches an unchecked value NESTED inside a composite literal argument", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          declare function consume(scope: { tenant: TenantContext }): void;
          declare function consumeAll(scopes: TenantContext[]): void;
          declare const raw: string;
          consume({ tenant: JSON.parse(raw) });
          consumeAll([JSON.parse(raw)]);
        `,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.startsWith("src/app/evil.ts"));
      for (const line of [6, 7]) {
        expect(
          hits.some((hit) =>
            hit.startsWith(`src/app/evil.ts:${line} `) && hit.includes("TenantContext")
          ),
          `line ${line} not reported: ${hits.join(" | ")}`,
        ).toBe(true);
      }
    });

    it("allows a CHECKED source that delivers the sealed type at the cast's own position", () => {
      const project = sealedFixture(
        "/src/app/fine.ts",
        `
          import { systemTenant, type TenantContext } from "../contracts/tenant";
          import type { ActionGrant } from "../contracts/authz";
          declare function consume(scope: { tenant: TenantContext }): void;
          declare function consumeAll(scopes: TenantContext[]): void;
          declare const grant: ActionGrant<"pii.view">;
          declare const held: { tenant: TenantContext; note: string };
          // The re-shape the position rule must not eat: the sealed type comes out
          // where it went in, and the grant keeps its own action.
          export const narrowed = held as { tenant: TenantContext };
          export const same = grant as ActionGrant<"pii.view">;
          export const scope = grant.tenant as TenantContext;
          consume({ tenant: systemTenant("seed", "org") });
          consumeAll([systemTenant("seed", "org")]);
        `,
      );
      expect(detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/fine.ts")
      )).toEqual([]);
    });

    it("rejects union reshapes unless every possible arm carries the same sealed type", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          declare const direct: TenantContext | string;
          declare const nested:
            | { tenant: TenantContext; kind: "trusted" }
            | { tenant: string; kind: "raw" };
          export const forgedDirect = direct as TenantContext;
          export const forgedNested = nested as { tenant: TenantContext };
        `,
      );
      const hits = detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/evil.ts") && hit.includes("cast")
      );
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:7"))).toBe(true);
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:8"))).toBe(true);
    });

    it("checks every repeated sibling sealed position in casts and contextual literals", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import { systemTenant, type TenantContext } from "../contracts/tenant";
          declare const raw: string;
          declare const source: { primary: TenantContext; secondary: unknown };
          declare function consume(value: {
            primary: TenantContext;
            secondary: TenantContext;
          }): void;
          export const forged = source as {
            primary: TenantContext;
            secondary: TenantContext;
          };
          consume({
            primary: systemTenant("seed", "org"),
            secondary: JSON.parse(raw),
          });
        `,
      );
      const hits = detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/evil.ts")
      );
      expect(hits.some((hit) =>
        hit.startsWith("src/app/evil.ts:9") && hit.includes("cast")
      )).toBe(true);
      expect(hits.some((hit) =>
        hit.startsWith("src/app/evil.ts:13") && hit.includes("unchecked call argument")
      )).toBe(true);
    });

    it("does not let an owned Tokenized position hide foreign sealed siblings", () => {
      const project = sealedFixture(
        "/src/infrastructure/pii/tokenize.ts",
        `
          import type { Tokenized } from "../../contracts/tokenized";
          import type { TenantContext } from "../../contracts/tenant";
          declare const raw: any;
          declare function consume(value: {
            token: Tokenized<string>;
            tenant: TenantContext;
          }): void;
          interface Composite {
            token: Tokenized<string>;
            tenant: TenantContext;
          }
          export const cast = raw as {
            token: Tokenized<string>;
            tenant: TenantContext;
          };
          export const initialized: Composite = raw;
          export let assigned: Composite;
          assigned = raw;
          export function returned(): Composite {
            return raw;
          }
          export function defaulted(value: Composite = raw): Composite {
            return value;
          }
          consume(raw);
          consume({
            token: raw,
            tenant: raw,
          });
        `,
      );
      const hits = detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/infrastructure/pii/tokenize.ts") &&
        hit.includes("TenantContext")
      );
      expect(hits.some((hit) => hit.includes("cast to sealed type"))).toBe(true);
      expect(hits.some((hit) => hit.includes("unchecked call argument"))).toBe(true);
      expect(hits.filter((hit) =>
        hit.includes("annotated onto an unchecked value")
      ).length).toBeGreaterThanOrEqual(4);
    });

    it("rejects incomplete recursive, over-depth, and overloaded sealed-position inventories", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          interface RecursiveTarget { tenant: TenantContext; next?: RecursiveTarget }
          interface RecursiveSource { tenant: TenantContext; next?: { tenant: unknown } }
          interface OverloadedTarget {
            (): TenantContext;
            (key: string): TenantContext;
          }
          interface OverloadedSource {
            (): TenantContext;
            (key: string): unknown;
          }
          declare const recursive: RecursiveSource;
          declare const deep: {
            shallow: TenantContext;
            nested: { a: { b: { c: { d: { e: { f: { g: { tenant: unknown } } } } } } } };
          };
          declare const overloaded: OverloadedSource;
          export const forgedRecursive = recursive as RecursiveTarget;
          export const forgedDeep = deep as {
            shallow: TenantContext;
            nested: { a: { b: { c: { d: { e: { f: { g: { tenant: TenantContext } } } } } } } };
          };
          export const forgedOverload = overloaded as OverloadedTarget;
        `,
      );
      const hits = detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/evil.ts") && hit.includes("cast")
      );
      for (const line of [19, 20, 24]) {
        expect(
          hits.some((hit) => hit.startsWith(`src/app/evil.ts:${line} `)),
          `line ${line} not reported: ${hits.join(" | ")}`,
        ).toBe(true);
      }
    });

    it("rejects nested unchecked sources at every sealed assignment boundary", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          interface Scope { tenant: TenantContext }
          declare const raw: { tenant: any };
          declare const unknownRaw: { tenant: unknown };
          const initialized: Scope = raw;
          let assigned: Scope;
          assigned = raw;
          export function revived(): Scope { return raw; }
          export function defaulted(scope: Scope = raw): Scope { return scope; }
          declare function consume(scope: Scope): void;
          consume(raw);
          consume(unknownRaw);
          void initialized;
          void assigned;
        `,
      );
      const hits = detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/evil.ts") && hit.includes("unchecked")
      );
      for (const line of [6, 8, 9, 10, 12, 13]) {
        expect(
          hits.some((hit) => hit.startsWith(`src/app/evil.ts:${line} `)),
          `line ${line} not reported: ${hits.join(" | ")}`,
        ).toBe(true);
      }
    });

    it("accepts union and intersection reshapes that retain sealed identity in every runtime value", () => {
      const project = sealedFixture(
        "/src/app/fine.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          declare const union:
            | { tenant: TenantContext; kind: "one" }
            | { tenant: TenantContext; kind: "two" };
          declare const intersection: TenantContext & { readonly source: "trusted" };
          export const narrowedUnion = union as { tenant: TenantContext };
          export const narrowedIntersection = intersection as TenantContext;
        `,
      );
      expect(detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/fine.ts")
      )).toEqual([]);
    });

    it("allows RESHAPING an already-sealed value and passing one into a sealed parameter", () => {
      const project = sealedFixture(
        "/src/app/fine.ts",
        `
          import { systemTenant, type TenantContext } from "../contracts/tenant";
          import type { Principal } from "../contracts/principal";
          declare function consume(tenant: TenantContext): void;
          declare const held: { tenant: TenantContext; note: string };
          export const byOrg = new Map<string, TenantContext>();
          export const current: Principal | null = null;
          const reshaped = held as { tenant: TenantContext };
          consume(systemTenant("seed", "org"));
          void reshaped;
        `,
      );
      // The exemptions the container rule must not eat: a cast whose SOURCE already
      // carried the sealed type (a re-shape mints nothing), a sealed type merely
      // NAMED in a generic position, a null-initialized nullable, and an argument
      // the factory itself produced.
      expect(detectSealedTypeConstruction(project).filter((hit) =>
        hit.startsWith("src/app/fine.ts")
      )).toEqual([]);
    });

    it("catches contextual object and implemented class method returns", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          declare const raw: string;
          interface Reviver { revive(): TenantContext }
          const objectReviver: Reviver = {
            revive() { return JSON.parse(raw); },
          };
          class ClassReviver implements Reviver {
            revive() { return JSON.parse(raw); }
          }
          void objectReviver;
          void ClassReviver;
        `,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.includes("unchecked value"));
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:6"))).toBe(true);
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:9"))).toBe(true);
    });

    it("catches a coercion helper whose sealed type argument is INFERRED, not written", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          function coerce<T>(value: unknown): T { return value as T; }
          const tenant: TenantContext = coerce(JSON.parse("{}"));
          void tenant;
        `,
      );
      // Deleting the type argument is not a different mint — it is the same one
      // with the evidence removed, so it has to fail on the type-argument rule.
      expect(detectSealedTypeConstruction(project).some((hit) =>
        hit.startsWith("src/app/evil.ts:4") && hit.includes("type argument") &&
        hit.includes("TenantContext")
      )).toBe(true);
    });

    it("catches a PROMISE-wrapped laundering function (the normal async shape)", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          export async function tenantFromCache(raw: string): Promise<TenantContext> {
            return JSON.parse(raw);
          }
          declare function fetchJson(url: string): Promise<any>;
          export async function tenantFromApi(url: string): Promise<TenantContext> {
            return fetchJson(url);
          }
        `,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.includes("unchecked value") && hit.includes("TenantContext"));
      // The annotation is unchecked one layer down in both: a raw `any` return, and
      // an awaited `Promise<any>` — the shape a real async cache/HTTP read has.
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:4"))).toBe(true);
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:8"))).toBe(true);
    });

    it("catches the four declaration positions the annotation scan used to skip", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          let mutable: TenantContext;
          mutable = JSON.parse("{}");
          void mutable;
          export class Holder {
            get tenant(): TenantContext { return JSON.parse("{}"); }
          }
          export function withDefault(t: TenantContext = JSON.parse("{}")): string { return t.orgId; }
          const many: TenantContext[] = JSON.parse("[]");
          void many;
        `,
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.includes("unchecked value"));
      // Anchored per position: declare-then-assign, get accessor, parameter
      // default, container annotation. A total alone would survive losing three.
      for (const line of [4, 7, 9, 10]) {
        expect(hits.some((hit) => hit.startsWith(`src/app/evil.ts:${line}`)), `line ${line}`).toBe(true);
      }
    });

    it("allows the NULLABLE sealed shapes the rule promises to leave alone", () => {
      const project = sealedFixture(
        "/src/app/fine.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          import type { Principal } from "../contracts/principal";
          export const current: Principal | null = null;
          export function tenantFor(id: string): TenantContext | null { void id; return null; }
          export class Holder {
            readonly tenant: TenantContext | undefined = undefined;
          }
        `,
      );
      // null/undefined are checked values, not laundered ones: an annotation is a
      // mint only when the checker has stopped reasoning about what fills it.
      expect(detectSealedTypeConstruction(project)).toEqual([]);
    });

    it("allows ordinary propagation of an already-sealed value", () => {
      const project = sealedFixture(
        "/src/app/fine.ts",
        `
          import { systemTenant, type TenantContext } from "../contracts/tenant";
          declare const deps: { tenantFor(orgId: string): TenantContext };
          const fromDeps: TenantContext = deps.tenantFor("org");
          export function pass(t: TenantContext): TenantContext { return t; }
          export async function later(): Promise<TenantContext> { return systemTenant("seed", "org"); }
          void fromDeps;
        `,
      );
      expect(detectSealedTypeConstruction(project)).toEqual([]);
    });

    it("allows the FACTORY's own generic entry point, but not a foreign coercion helper", () => {
      const project = sealedFixture(
        "/src/infrastructure/pii/llm-projection.ts",
        `
          import { tokenizeRecord } from "./tokenize";
          import type { Tokenized } from "../../contracts/tokenized";
          function coerce<T>(value: unknown): T { return value as T; }
          export const sealed = tokenizeRecord<{ a: string }>({ a: "x" });
          export const forged = coerce<Tokenized<string>>("raw");
        `,
      );
      project.createSourceFile(
        "/src/infrastructure/pii/tokenize.ts",
        `
          import type { Tokenized } from "../../contracts/tokenized";
          export function tokenizeRecord<T>(raw: T): Tokenized<T> { return { value: raw, piiFree: true } as Tokenized<T>; }
        `,
        { overwrite: true },
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.includes("explicit type argument"));
      expect(hits).toHaveLength(1);
      expect(hits[0]).toContain("src/infrastructure/pii/llm-projection.ts:6");
    });

    it("lets the scrubber mint its OWN sealed type, and nothing else, through a coercion helper", () => {
      const project = sealedFixture("/src/app/unused.ts", "export const x = 1;");
      project.createSourceFile(
        "/src/infrastructure/pii/tokenize.ts",
        `
          import type { Tokenized } from "../../contracts/tokenized";
          import type { TenantContext } from "../../contracts/tenant";
          function coerce<T>(value: unknown): T { return value as T; }
          export const sealed = coerce<Tokenized<string>>("raw");
          export const stolen: TenantContext = coerce(JSON.parse("{}"));
        `,
        { overwrite: true },
      );
      const hits = detectSealedTypeConstruction(project)
        .filter((hit) => hit.includes("type argument"));
      // The exemption is per-TYPE, not per-FILE: Tokenized is this file's own type
      // (allowed), TenantContext is not (a mint the whole-file skip used to swallow).
      expect(hits).toHaveLength(1);
      expect(hits[0]).toContain("TenantContext");
      expect(hits.some((hit) => hit.includes("Tokenized"))).toBe(false);
    });

    it("allows a generic container merely PARAMETERIZED by a sealed type", () => {
      const project = sealedFixture(
        "/src/app/fine.ts",
        `
          import type { TenantContext } from "../contracts/tenant";
          import type { Principal } from "../contracts/principal";
          export const byOrg = new Map<string, TenantContext>();
          export const seen = new Set<Principal>();
          declare function pick<T>(values: readonly T[]): T | undefined;
          export const first = pick<string>(["a"]);
        `,
      );
      expect(detectSealedTypeConstruction(project)).toEqual([]);
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
      // Line-anchored: a bare count would stay green if either reference stopped
      // resolving, because the other one alone already makes the list non-empty.
      const hits = detectUntrustedFactoryCalls(project);
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:3"))).toBe(true);
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:4"))).toBe(true);
    });

    it("catches a factory named only in a STRING, through element access", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import * as principal from "../contracts/principal";
          principal["principalFromIdentity"]({});
        `,
      );
      // No identifier anywhere on this line names the factory, so the ElementAccess
      // reference source is the ONLY thing that can catch it.
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.startsWith("src/app/evil.ts:3") && hit.includes("principalFromIdentity")
      )).toBe(true);
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

    it("catches createRequire and aliased require before they can expose factory modules", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import { createRequire } from "node:module";
          const created = createRequire(import.meta.url);
          created("../contracts/tenant");
          const aliased = require;
          aliased("../contracts/tenant");
        `,
      );
      const hits = detectUntrustedFactoryCalls(project)
        .filter((hit) => hit.includes("unverifiable module load"));
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:2"))).toBe(true);
      expect(hits.some((hit) => hit.startsWith("src/app/evil.ts:5"))).toBe(true);
    });

    it("catches reflected createRequire before it can expose factory modules", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import * as nodeModule from "node:module";
          const created = Reflect.get(nodeModule, "createRequire")(import.meta.url);
          created("../contracts/tenant");
        `,
      );
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.startsWith("src/app/evil.ts:3") && hit.includes("unverifiable module load")
      )).toBe(true);
    });

    it("catches createRequire through a destructured Reflect.get alias", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import * as nodeModule from "node:module";
          const { get: read } = Reflect;
          const created = read(nodeModule, "createRequire")(import.meta.url);
          created("../contracts/tenant");
        `,
      );
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.startsWith("src/app/evil.ts:4") && hit.includes("unverifiable module load")
      )).toBe(true);
    });

    it("catches createRequire through a bound Reflect.get wrapper", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import * as nodeModule from "node:module";
          const read = Reflect.get.bind(Reflect);
          const created = read(nodeModule, "createRequire")(import.meta.url);
          created("../contracts/tenant");
        `,
      );
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.startsWith("src/app/evil.ts:4") && hit.includes("unverifiable module load")
      )).toBe(true);
    });

    it("catches createRequire through a property descriptor", () => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import * as nodeModule from "node:module";
          const created = Object.getOwnPropertyDescriptor(nodeModule, "createRequire")!.value(import.meta.url);
          created("../contracts/tenant");
        `,
      );
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.startsWith("src/app/evil.ts:3") && hit.includes("unverifiable module load")
      )).toBe(true);
    });

    it.each([
      `const copy = { ...nodeModule };
          const created = copy.createRequire(import.meta.url);`,
      `let copy = nodeModule;
          if (Date.now() > 0) copy = { createRequire: undefined };
          const created = copy.createRequire(import.meta.url);`,
      `const copy = Object.fromEntries(Object.entries(nodeModule));
          const created = copy.createRequire(import.meta.url);`,
      `const holder = { mod: nodeModule };
          const created = holder.mod.createRequire(import.meta.url);`,
      `const holder = [nodeModule] as const;
          const created = holder[0].createRequire(import.meta.url);`,
      `const [held] = [nodeModule] as const;
          const created = held.createRequire(import.meta.url);`,
      `const holder = [{}, nodeModule] as const;
          let index = 0;
          if (Date.now() > 0) index = 1;
          const created = (holder[index] as typeof nodeModule).createRequire(import.meta.url);`,
      `let read: Function = Reflect.get;
          if (Date.now() > 0) read = Object.getPrototypeOf;
          const created = read(nodeModule, "createRequire")(import.meta.url);`,
      `const created = Reflect.apply(Reflect.get, undefined, [nodeModule, "createRequire"])(import.meta.url);`,
    ])("catches copied or applied node:module provenance before factory access", (loader) => {
      const project = sealedFixture(
        "/src/app/evil.ts",
        `
          import * as nodeModule from "node:module";
          ${loader}
          created("../contracts/tenant");
        `,
      );
      expect(detectUntrustedFactoryCalls(project).some((hit) =>
        hit.includes("unverifiable module load")
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

    it("catches a reviewed factory module that no longer resolves, and passes when all do", () => {
      const modules = [...REVIEWED_FACTORY_EXPORTS.keys()];
      const stub = (files: readonly string[]): Project =>
        inMemoryProject(Object.fromEntries(
          files.map((file) => [`/${file}`, "export const nothing = 1;"]),
        ));
      expect(detectUnresolvedFactoryModules(stub(modules))).toEqual([]);
      // Drop one key's module: detectFactoryResultLaundering would skip it in
      // silence, so every sealed type that module hands out stops being checked.
      const [moved, ...rest] = modules;
      const hits = detectUnresolvedFactoryModules(stub(rest));
      expect(hits).toHaveLength(1);
      expect(hits[0]).toContain(moved!);
      expect(hits[0]).toContain("silently does not run");
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
