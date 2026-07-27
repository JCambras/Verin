import { describe, it, expect } from "vitest";
import { relative, resolve, dirname } from "node:path";
import {
  Node,
  type Project,
  type Signature,
  type SourceFile,
  type Type,
} from "ts-morph";
import {
  realSemanticProject,
  inMemoryProject,
  importSpecifiers,
  REPO_ROOT,
  SRC_ROOT,
} from "./_fence-utils";
import { isPIIField } from "@contracts/pii";

/**
 * LLM-PII-BOUNDARY FENCE (v3 §15.1, INVARIANT 1: "No PII-bearing type is
 * reachable from llm/"). Two derived, compile/import-level checks:
 *
 *  1. MARKER COMPLETENESS (the derivation floor): every type declaration in
 *     the platform layers (contracts/domain/infrastructure — the app layer is
 *     structurally unreachable from llm/ via the dependency-rule fence) that
 *     declares a raw PII-named field must carry the PIIBearing marker or be a
 *     reviewed machine-name escape. Interfaces, type-alias object literals,
 *     and classes all count — a `type Client = { firstName: string }` alias is
 *     the same evasion as an unmarked interface. The marked set is therefore
 *     DERIVED, so a new PII-carrying type cannot ship unmarked and slip past
 *     check 2.
 *
 *  2. IMPORT REACHABILITY: the transitive import closure of every file under
 *     an llm/ directory must contain NO module that declares a PIIBearing-
 *     marked type. Type-only imports count — a type leak is exactly what this
 *     fence exists to stop.
 *
 * The runtime half lives in the scrubber factory (tokenize.ts) and the LLM
 * adapter ingress gate (parseMaskedLlmRequest) — scrub-by-construction plus a
 * fail-closed parse, tested in unit/llm-boundary.test.ts.
 */

// Reviewed machine-name escapes (exact `file :: Interface.prop`): fields whose
// name matches the PII regex but whose VALUE is a machine identifier, never a
// person's data. Anything new must be marked or reviewed into this list.
const NON_PII_ESCAPES: Array<{ ref: string; why: string }> = [
  { ref: "src/domain/schema/entities.ts :: Org.name", why: "the firm's own identity, not client PII (audit scrubbing still redacts it belt-and-braces)" },
  { ref: "src/domain/workflow/engine.ts :: FlowStep.name", why: "machine-readable step id" },
  { ref: "src/domain/workflow/engine.ts :: FlowDefinition.name", why: "machine-readable flow id" },
  { ref: "src/domain/workflow/flows/account-opening.ts :: FlowFieldSpec.name", why: "form-field key for the generic renderer" },
  { ref: "src/infrastructure/observability/tracer.ts :: RecordedSpan.name", why: "OTel span name (machine)" },
  { ref: "src/infrastructure/store/migrations.ts :: Migration.name", why: "migration label (machine)" },
];
const ESCAPE_SET = new Set(NON_PII_ESCAPES.map((e) => e.ref));

function normalizePath(sf: SourceFile): string {
  const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
  return rel.startsWith("..") ? sf.getFilePath().replace(/^\//, "") : rel;
}

interface PIITypeDecl {
  readonly name: string;
  readonly marked: boolean;
  readonly props: ReadonlyArray<{ readonly name: string; readonly type: Type }>;
  readonly callableExposures: readonly string[];
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
      if (
        symbol?.getName() === name &&
        symbol.getDeclarations().some((declaration) =>
          normalizePath(declaration.getSourceFile()) === file
        )
      ) {
        return true;
      }
    }
    queue.push(
      ...current.getUnionTypes(),
      ...current.getIntersectionTypes(),
      ...current.getBaseTypes(),
      ...current.getAliasTypeArguments(),
      ...current.getTypeArguments(),
    );
  }
  return false;
}

function isTokenized(type: Type): boolean {
  return declaredAs(type, "src/contracts/tokenized.ts", "Tokenized");
}

function isPIIBearingType(type: Type): boolean {
  return declaredAs(type, "src/contracts/pii.ts", "PIIBearing");
}

function isLeafType(type: Type): boolean {
  return type.isAny() ||
    type.isUnknown() ||
    type.isNever() ||
    type.isString() ||
    type.isStringLiteral() ||
    type.isNumber() ||
    type.isNumberLiteral() ||
    type.isBoolean() ||
    type.isBooleanLiteral() ||
    type.isNull() ||
    type.isUndefined() ||
    type.isVoid();
}

function isLeafComposite(type: Type): boolean {
  if (isLeafType(type)) return true;
  const members = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
  return members.length > 0 && members.every(isLeafComposite);
}

function aliasProperties(
  type: Type,
  location: Node,
): Array<{ readonly name: string; readonly type: Type }> {
  if (isLeafComposite(type)) return [];
  const members = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
  const candidates = members.length ? members.flatMap((member) =>
    aliasProperties(member, location)
  ) : type.getProperties().map((property) => {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0] ??
      location;
    return {
      name: property.getName(),
      type: property.getTypeAtLocation(declaration),
    };
  });
  const unique = new Map<string, { readonly name: string; readonly type: Type }>();
  for (const property of candidates) {
    unique.set(`${property.name}::${property.type.getText()}`, property);
  }
  return [...unique.values()];
}

function inlinePIIExposures(
  type: Type,
  path: string,
  seen = new Set<string>(),
  location?: Node,
): string[] {
  if (isTokenized(type)) return [];
  if (isPIIBearingType(type)) return [path];
  if (isLeafType(type)) return [];
  const key = `${type.getText()}::${type.getFlags()}`;
  if (seen.has(key)) return [];
  const nextSeen = new Set(seen).add(key);
  const composite = [...type.getUnionTypes(), ...type.getIntersectionTypes()];
  if (composite.length) {
    return composite.flatMap((member) =>
      inlinePIIExposures(member, path, nextSeen, location)
    );
  }
  const typeArguments = [
    ...type.getAliasTypeArguments(),
    ...type.getTypeArguments(),
  ];
  const nestedArguments = typeArguments.flatMap((argument) =>
    inlinePIIExposures(argument, path, nextSeen, location)
  );
  const symbol = type.getAliasSymbol() ?? type.getSymbol();
  const inline = !symbol || symbol.getDeclarations().some((declaration) =>
    Node.isTypeLiteral(declaration)
  );
  const properties = type.getProperties().flatMap((property) => {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0] ??
      location;
    if (!declaration) return [];
    const propertyType = property.getTypeAtLocation(declaration);
    const propertyPath = `${path}.${property.getName()}`;
    if (isPIIField(property.getName()) && !isTokenized(propertyType)) {
      return [propertyPath];
    }
    if (!inline) return [];
    return inlinePIIExposures(propertyType, propertyPath, nextSeen, declaration);
  });
  if (!inline) return [...nestedArguments, ...properties];
  const nestedCalls = type.getCallSignatures().flatMap((signature) =>
    signaturePIIExposures(signature, `${path}.<call>`, nextSeen)
  );
  return [...nestedArguments, ...properties, ...nestedCalls];
}

function signaturePIIExposures(
  signature: Signature,
  path: string,
  seen = new Set<string>(),
): string[] {
  const parameters = signature.getParameters().flatMap((parameter) => {
    const declaration = parameter.getValueDeclaration() ??
      parameter.getDeclarations()[0];
    if (!declaration) return [];
    const parameterType = parameter.getTypeAtLocation(declaration);
    const parameterPath = `${path}(${parameter.getName()})`;
    if (isPIIField(parameter.getName()) && !isTokenized(parameterType)) {
      return [parameterPath];
    }
    return inlinePIIExposures(parameterType, parameterPath, seen, declaration);
  });
  return [
    ...parameters,
    ...inlinePIIExposures(
      signature.getReturnType(),
      `${path}.return`,
      seen,
      signature.getDeclaration(),
    ),
  ];
}

function callablePIIExposures(type: Type): string[] {
  const exposures = type.getCallSignatures().flatMap((signature) =>
    signaturePIIExposures(signature, "<call>")
  );
  for (const property of type.getProperties()) {
    const declaration = property.getValueDeclaration() ??
      property.getDeclarations()[0];
    if (!declaration) continue;
    const propertyType = property.getTypeAtLocation(declaration);
    for (const signature of propertyType.getCallSignatures()) {
      exposures.push(
        ...signaturePIIExposures(signature, property.getName()),
      );
    }
  }
  return [...new Set(exposures)];
}

/** Every property-bearing type declaration — interface, type-alias object literal, or class. */
function piiTypeDeclarations(sf: SourceFile): PIITypeDecl[] {
  const out: PIITypeDecl[] = [];
  for (const iface of sf.getInterfaces()) {
    if (iface.getName() === "PIIBearing") continue; // the marker itself
    out.push({
      name: iface.getName(),
      marked: isPIIBearingType(iface.getType()),
      props: iface.getProperties().map((property) => ({
        name: property.getName(),
        type: property.getType(),
      })),
      callableExposures: callablePIIExposures(iface.getType()),
    });
  }
  for (const alias of sf.getTypeAliases()) {
    const aliasType = alias.getType();
    out.push({
      name: alias.getName(),
      marked: isPIIBearingType(aliasType),
      props: aliasProperties(aliasType, alias),
      callableExposures: isLeafComposite(aliasType)
        ? []
        : callablePIIExposures(aliasType),
    });
  }
  for (const cls of sf.getClasses()) {
    out.push({
      name: cls.getName() ?? "(anonymous class)",
      marked: isPIIBearingType(cls.getType()) ||
        cls.getImplements().some((heritage) =>
          isPIIBearingType(heritage.getType())
        ),
      props: cls.getProperties().map((property) => ({
        name: property.getName(),
        type: property.getType(),
      })),
      callableExposures: callablePIIExposures(cls.getType()),
    });
  }
  return out;
}

/** Platform-layer type declarations with raw PII-named fields that are neither marked nor escaped. */
export function detectUnmarkedPIITypes(project: Project, escapes: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizePath(sf);
    if (!/^src\/(contracts|domain|infrastructure)\//.test(normalized)) continue;
    for (const decl of piiTypeDeclarations(sf)) {
      if (decl.marked) continue;
      for (const prop of decl.props) {
        if (!isPIIField(prop.name) || isTokenized(prop.type)) continue;
        const ref = `${normalized} :: ${decl.name}.${prop.name}`;
        if (!escapes.has(ref)) out.push(ref);
      }
      for (const exposure of decl.callableExposures) {
        const ref = `${normalized} :: ${decl.name}.${exposure}`;
        if (!escapes.has(ref)) out.push(ref);
      }
    }
  }
  return [...new Set(out)];
}

/** Modules that declare at least one PIIBearing-marked type (interface, alias, or class). */
export function markedModules(project: Project): Set<string> {
  const out = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    if (piiTypeDeclarations(sf).some((d) => d.marked)) out.add(normalizePath(sf));
  }
  return out;
}

/**
 * Resolve an import specifier to a project file's normalized path (alias,
 * @/-prefix, and relative forms; .ts/.tsx/index.ts candidates), or null for
 * external modules.
 */
export function resolveToProjectPath(project: Project, fromNormalized: string, spec: string): string | null {
  const known = new Set(project.getSourceFiles().map((sf) => normalizePath(sf)));
  let base: string | null = null;
  const alias: Array<[RegExp, string]> = [
    [/^@contracts\//, "src/contracts/"],
    [/^@domain\//, "src/domain/"],
    [/^@infra\//, "src/infrastructure/"],
    [/^@app\//, "src/app/"],
    [/^@\//, "src/"],
  ];
  for (const [re, prefix] of alias) {
    if (re.test(spec)) {
      base = spec.replace(re, prefix);
      break;
    }
  }
  if (!base && spec.startsWith(".")) {
    base = relative(SRC_ROOT, resolve(SRC_ROOT, dirname(fromNormalized).replace(/^src\//, ""), spec)).replace(/\\/g, "/");
    base = `src/${base}`;
  }
  if (!base) return null; // bare/external module
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** Marked modules reachable (transitively) from any file under an llm/ directory. */
export function detectPIIReachableFromLlm(project: Project): string[] {
  const marked = markedModules(project);
  const byPath = new Map(project.getSourceFiles().map((sf) => [normalizePath(sf), sf] as const));
  const violations: string[] = [];
  const llmFiles = [...byPath.keys()].filter((p) => /\/llm\//.test(p));
  for (const origin of llmFiles) {
    if (marked.has(origin)) {
      violations.push(`${origin} declares a PII-bearing type inside llm/`);
    }
    const visited = new Set<string>([origin]);
    const queue = [origin];
    while (queue.length) {
      const current = queue.shift()!;
      const sf = byPath.get(current);
      if (!sf) continue;
      for (const spec of importSpecifiers(sf)) {
        const target = resolveToProjectPath(project, current, spec);
        if (!target || visited.has(target)) continue;
        visited.add(target);
        if (marked.has(target)) {
          violations.push(`${origin} reaches PII-bearing module ${target} (via import of '${spec}' in ${current})`);
          continue; // report, but keep walking other branches
        }
        queue.push(target);
      }
    }
  }
  return violations;
}

describe("llm-pii-boundary fence (v3 invariant 1)", () => {
  const project = realSemanticProject();

  it("enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked (or a reviewed machine-name escape)", () => {
    const unmarked = detectUnmarkedPIITypes(project, ESCAPE_SET);
    expect(unmarked, `unmarked PII-bearing types (extend PIIBearing or review into NON_PII_ESCAPES):\n${unmarked.join("\n")}`).toEqual([]);
  });

  it("enforces: no stale escapes (each escape still names a live declared property)", () => {
    const live = new Set<string>();
    for (const sf of project.getSourceFiles()) {
      const normalized = normalizePath(sf);
      for (const decl of piiTypeDeclarations(sf)) for (const prop of decl.props) live.add(`${normalized} :: ${decl.name}.${prop.name}`);
    }
    const stale = NON_PII_ESCAPES.filter((e) => !live.has(e.ref)).map((e) => e.ref);
    expect(stale, `stale escapes:\n${stale.join("\n")}`).toEqual([]);
  });

  it("enforces: the marked set is non-empty (a gutted marker would pass reachability vacuously — charter #4)", () => {
    expect(markedModules(project).size).toBeGreaterThanOrEqual(4);
  });

  it("enforces: persisted workflow state retains the PII-bearing marker", () => {
    const engine = project.getSourceFiles().find((sf) =>
      normalizePath(sf) === "src/domain/workflow/engine.ts"
    );
    expect(engine).toBeTruthy();
    const declarations = piiTypeDeclarations(engine!);
    for (const name of ["FlowData", "ExecutionState", "FlowRunResult"]) {
      expect(
        declarations.find((declaration) => declaration.name === name)?.marked,
        `${name} must retain PIIBearing`,
      ).toBe(true);
    }
  });

  it("enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it (invariant 1)", () => {
    const llmFiles = project.getSourceFiles().filter((sf) => /\/llm\//.test(normalizePath(sf)));
    expect(
      llmFiles.map(normalizePath),
      "the masked request boundary is missing - invariant 1 would be vacuous",
    ).toContain("src/infrastructure/llm/request-schema.ts");
    const reached = detectPIIReachableFromLlm(project);
    expect(reached, `PII-bearing types reachable from llm/:\n${reached.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): planted leaks are caught", () => {
    const marker = `export interface PIIBearing { readonly __pii?: "pii-bearing" }`;
    const entities = `import type { PIIBearing } from "@contracts/pii";\nexport interface Contact extends PIIBearing { firstName: string }`;

    it("flags an llm file importing a marked module DIRECTLY (even type-only)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/entities.ts": entities,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "@domain/schema/entities";\nexport type Leak = Contact;`,
      });
      const v = detectPIIReachableFromLlm(project);
      expect(v.some((violation) => violation.includes("entities"))).toBe(true);
    });
    it("flags a PII-bearing type declared inside llm itself", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/infrastructure/llm/evil.ts": `import type { PIIBearing } from "@contracts/pii"; export interface RawRequest extends PIIBearing { requestText: string }`,
      });
      expect(detectPIIReachableFromLlm(project)).toEqual([
        "src/infrastructure/llm/evil.ts declares a PII-bearing type inside llm/",
      ]);
    });
    it("treats requestText, rawText, and evidence as PII-bearing fields", () => {
      const project = inMemoryProject({
        "/src/infrastructure/evil.ts": `export interface Raw { requestText: string; rawText: string; evidence: object }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/infrastructure/evil.ts :: Raw.requestText",
        "src/infrastructure/evil.ts :: Raw.rawText",
        "src/infrastructure/evil.ts :: Raw.evidence",
      ]);
    });
    it("flags a TRANSITIVE leak (llm -> helper -> marked module)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/entities.ts": entities,
        "/src/infrastructure/helper.ts": `export { type Contact } from "../domain/schema/entities";`,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "../helper";\nexport type Leak = Contact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBeGreaterThanOrEqual(1);
    });
    it("allows llm importing the marker-DECLARING module (contracts/pii declares no marked type)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/infrastructure/llm/fine.ts": `import type { PIIBearing } from "@contracts/pii";\nexport const ok = 1;`,
      });
      expect(detectPIIReachableFromLlm(project)).toEqual([]);
    });
    it("flags an UNMARKED interface with a raw PII field (completeness floor)", () => {
      const project = inMemoryProject({
        "/src/domain/sneaky.ts": `export interface Client { firstName: string }`,
      });
      const v = detectUnmarkedPIITypes(project, ESCAPE_SET);
      expect(v).toEqual(["src/domain/sneaky.ts :: Client.firstName"]);
    });
    it("does not flag a Tokenized-typed PII-named field (tokens are the point)", () => {
      const project = inMemoryProject({
        "/src/contracts/tokenized.ts": `export interface Tokenized<T> { value: T; piiFree: true }`,
        "/src/domain/fine.ts": `import type { Tokenized } from "@contracts/tokenized";\nexport interface Masked { firstName: Tokenized<string> }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([]);
    });
    it("resolves Tokenized aliases semantically and rejects same-named impostors", () => {
      const project = inMemoryProject({
        "/src/contracts/tokenized.ts": `export interface Tokenized<T> { value: T; piiFree: true }`,
        "/src/domain/fine.ts": `
          import type { Tokenized as Sealed } from "@contracts/tokenized";
          export interface Masked { firstName: Sealed<string> }
        `,
        "/src/domain/evil.ts": `
          interface Tokenized<T> { value: T }
          export interface Raw { firstName: Tokenized<string> }
        `,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: Raw.firstName",
      ]);
    });
    it("flags PII nested in method parameters and callable signatures", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `
          export interface DependencyShape {
            persist(input: { firstName: string }): Promise<void>;
          }
          export interface CallableShape {
            (input: { accountNumber: string }): void;
          }
          export type FunctionShape = (input: { email: string }) => void;
        `,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: DependencyShape.persist(input).firstName",
        "src/domain/evil.ts :: CallableShape.<call>(input).accountNumber",
        "src/domain/evil.ts :: FunctionShape.<call>(input).email",
      ]);
    });
    it("does not flag Tokenized values nested in callable parameters", () => {
      const project = inMemoryProject({
        "/src/contracts/tokenized.ts": `export interface Tokenized<T> { value: T; piiFree: true }`,
        "/src/domain/fine.ts": `
          import type { Tokenized as Sealed } from "@contracts/tokenized";
          export interface Handler {
            submit(input: { firstName: Sealed<string> }): void;
          }
        `,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([]);
    });
    it("an escape is EXACT-match: a new PII prop on an escaped interface is still flagged", () => {
      const project = inMemoryProject({
        "/src/domain/workflow/engine.ts": `export interface FlowStep { name: string; email: string }`,
      });
      const v = detectUnmarkedPIITypes(project, ESCAPE_SET);
      expect(v).toEqual(["src/domain/workflow/engine.ts :: FlowStep.email"]);
    });
    it("flags an UNMARKED type-alias object literal with a raw PII field (alias evasion)", () => {
      const project = inMemoryProject({
        "/src/domain/sneaky-alias.ts": `export type Client = { firstName: string }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual(["src/domain/sneaky-alias.ts :: Client.firstName"]);
    });
    it("flags an UNMARKED type-alias union/intersection member with a raw PII field", () => {
      const project = inMemoryProject({
        "/src/domain/sneaky-union.ts": `export type Party = { kind: "org" } | { kind: "person"; email: string }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual(["src/domain/sneaky-union.ts :: Party.email"]);
    });
    it("flags an UNMARKED class with a raw PII field (class evasion)", () => {
      const project = inMemoryProject({
        "/src/domain/sneaky-class.ts": `export class Client { firstName = "" }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual(["src/domain/sneaky-class.ts :: Client.firstName"]);
    });
    it("flags llm reaching a module whose PII type is a MARKED type alias (markedModules covers aliases)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/alias-entities.ts": `import type { PIIBearing } from "@contracts/pii";\nexport type Contact = PIIBearing & { firstName: string };`,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "@domain/schema/alias-entities";\nexport type Leak = Contact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBeGreaterThanOrEqual(1);
    });
    it("flags a marked mapped alias with no syntactic object literal", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/contact.ts": `export interface Contact { firstName: string; lastName: string }`,
        "/src/domain/alias.ts": `import type { PIIBearing } from "@contracts/pii"; import type { Contact } from "./contact"; export type NamedContact = PIIBearing & Pick<Contact, "firstName">;`,
        "/src/infrastructure/llm/evil.ts": `import type { NamedContact } from "@domain/alias"; export type Leak = NamedContact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBeGreaterThanOrEqual(1);
    });
    it("flags an unmarked mapped alias with a PII key", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `export type RawContact = Record<"email", string>;`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: RawContact.email",
      ]);
    });
    it("flags a mapped PII type nested in a callable parameter", () => {
      const project = inMemoryProject({
        "/src/domain/evil.ts": `export interface Handler { submit(input: Record<"email", string>): void }`,
      });
      expect(detectUnmarkedPIITypes(project, ESCAPE_SET)).toEqual([
        "src/domain/evil.ts :: Handler.submit(input).email",
      ]);
    });
    it("flags llm reaching a module whose PII type is a MARKED class (markedModules covers classes)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/class-entities.ts": `import type { PIIBearing } from "@contracts/pii";\nexport class Contact implements PIIBearing { firstName = "" }`,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "@domain/schema/class-entities";\nexport type Leak = Contact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBe(1);
    });
  });
});
