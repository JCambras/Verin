import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";
import {
  Node,
  Project,
  SyntaxKind,
  type Type,
  type TypeLiteralNode,
} from "ts-morph";
import { walk, REPO_ROOT, inMemoryProject } from "./_fence-utils";
import { SCENARIOS, FIRMS } from "@app/demo/data";

/**
 * DEMO-SKELETON-HONESTY FENCE (v3 prompt 3 Gate 0: "the UI does not invent
 * decisions"; charter #4/#5, ADR-0027). Two machine-enforced halves:
 *
 *  RULE A - CONTRACT PARITY. The walking skeleton's static branch data
 *    (src/app/demo/data.ts) must state EXACTLY the scenario ids, firm ids, and
 *    dispositions (including per-firm splits) that config/demo/scenarios.yaml
 *    records. A skeleton scenario the contract does not know, a missing contract
 *    branch, or a drifted disposition fails the build - the demo cannot show an
 *    outcome the ratified contract does not state.
 *
 *  RULE B - SURFACE IMPORT BOUNDARY. Surface components (src/app/demo/surfaces/)
 *    render typed view models and NOTHING else: they may import react/next,
 *    presentation primitives, the view-model module, and surface-local siblings.
 *    Importing the contract data, the fake service, or the builders from a surface
 *    is exactly how a component would start recomputing decisions - it fails the
 *    build with file:line. Every module-reaching form counts: static imports,
 *    re-exports (export { x } from / export * from), dynamic import(), require(),
 *    and traversal specifiers ("./../data") dressed up as sibling imports; a
 *    non-literal dynamic specifier cannot be verified, so it cannot pass.
 *
 *  RULE C - NO DEAD VIEW-MODEL FIELDS. Every field declared on a demo view model
 *    must be read by a surface or a demo route. knip sees unreferenced EXPORTS,
 *    never unread object properties, so a builder can populate a field no screen
 *    renders - built-but-not-shipped inside a type (charter #5). Each unread field
 *    fails the build with the declaring file:line. The read is OWNER-AWARE: it
 *    resolves each receiver's type through the checker, so an unrelated view model
 *    that merely shares a property name (`ApprovalVM.stages` vs `SetupProofVM.stages`)
 *    cannot stand in as proof - the exact way a bare-name match passed vacuously.
 *    A read counts only when the receiver resolves to the actual declaration that
 *    owns the field. Ownerless inline shapes, Records, and unrelated structural
 *    subsets do not prove that a populated view-model field reaches a surface.
 *    Interfaces and type-alias object, union, and intersection members all count.
 *    The walk DESCENDS into nested inline object types (`authorityPlan`,
 *    `RecordVM.header`, `readonly {...}[]` elements): a top-level-only walk let a dead
 *    field hide one level down inside a shipped view model.
 *
 *  RULE D - ONE NAME PER PROFILE. A surface may not spell a firm's display name. The
 *    view models carry `firmLabel`; a surface that writes "Firm A" - directly or via a
 *    `firmId === "firm-a" ? … : …` ternary - re-derives a name the builder owns, so
 *    renaming a profile updates some steps and not others. Any literal naming a firm
 *    inside src/app/demo/surfaces fails the build with file:line.
 *
 * All four detectors are pure functions so the companions can feed violating inputs
 * (charter #4: detection is not verification).
 */

// ── RULE A: contract parity ─────────────────────────────────────────────────────────
interface BranchFacts {
  readonly scenarios: Record<string, { disposition: string; perFirm?: Record<string, string> }>;
  readonly firms: readonly string[];
}

export function skeletonFacts(): BranchFacts {
  const scenarios: BranchFacts["scenarios"] = {};
  for (const s of SCENARIOS) scenarios[s.id] = { disposition: s.disposition, ...(s.perFirm ? { perFirm: s.perFirm } : {}) };
  return { scenarios, firms: Object.keys(FIRMS) };
}

export function contractFacts(yamlText: string): BranchFacts {
  const doc = parseDocument(yamlText).toJS() as {
    scenarios?: { id?: unknown; disposition?: unknown }[];
    firms?: { id?: unknown }[];
  };
  const scenarios: BranchFacts["scenarios"] = {};
  for (const s of doc.scenarios ?? []) {
    const id = String(s.id);
    if (typeof s.disposition === "string") {
      scenarios[id] = { disposition: s.disposition };
    } else if (s.disposition && typeof s.disposition === "object") {
      const perFirm = (s.disposition as { per_firm?: Record<string, string> }).per_firm ?? {};
      // The yaml records the split; the skeleton must carry BOTH the recorded default
      // (its scenarios.yaml `disposition` shape has no default when split) and the map.
      scenarios[id] = { disposition: "(per-firm)", perFirm };
    }
  }
  return { scenarios, firms: (doc.firms ?? []).map((f) => String(f.id)) };
}

export function parityViolations(skeleton: BranchFacts, contract: BranchFacts): string[] {
  const out: string[] = [];
  for (const id of Object.keys(contract.scenarios)) {
    if (!skeleton.scenarios[id]) out.push(`scenario "${id}" is in the contract but missing from the skeleton (data.ts)`);
  }
  for (const [id, s] of Object.entries(skeleton.scenarios)) {
    const c = contract.scenarios[id];
    if (!c) {
      out.push(`scenario "${id}" exists in the skeleton but not in config/demo/scenarios.yaml - the demo may not invent branches`);
      continue;
    }
    if (c.perFirm) {
      for (const [firmId, disp] of Object.entries(c.perFirm)) {
        if (s.perFirm?.[firmId] !== disp) {
          out.push(`scenario "${id}": contract records per-firm ${firmId}=${disp}, skeleton says ${s.perFirm?.[firmId] ?? "(nothing)"}`);
        }
      }
      for (const [firmId, disp] of Object.entries(s.perFirm ?? {})) {
        if (!(firmId in c.perFirm)) {
          out.push(`scenario "${id}": skeleton records per-firm ${firmId}=${disp} that the contract does not state - the UI may not invent decisions`);
        }
      }
    } else {
      if (s.perFirm) {
        out.push(`scenario "${id}": skeleton records a per-firm split but the contract disposition is plain "${c.disposition}" - the UI may not invent decisions`);
      }
      if (s.disposition !== c.disposition) {
        out.push(`scenario "${id}": contract disposition "${c.disposition}", skeleton says "${s.disposition}" - the UI may not invent decisions`);
      }
    }
  }
  for (const f of contract.firms) if (!skeleton.firms.includes(f)) out.push(`firm "${f}" missing from the skeleton`);
  for (const f of skeleton.firms) if (!contract.firms.includes(f)) out.push(`firm "${f}" invented by the skeleton`);
  return out;
}

// ── RULE B: surface import boundary ─────────────────────────────────────────────────
const SURFACES_DIR = "src/app/demo/surfaces";
/** What a surface may import: react/next, presentation primitives, the view-model
 * vocabulary, contract TYPES, and surface-local siblings. Nothing that carries data
 * or builds view models. */
const ALLOWED = [
  /^react$/,
  /^next\//,
  /^@app\/presentation\//,
  /^\.\.\/model$/,
  /^\.\.\/setup-model$/,
  /^@contracts\//,
  /^\.\//,
];

export function importBoundaryViolations(files: { path: string; specifiers: { spec: string; line: number }[] }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const { spec, line } of f.specifiers) {
      // A ".." segment anywhere (beyond the one allowed "../model") escapes the
      // sibling allowlist by traversal - "./../data" must not read as a sibling.
      const traversal =
        !["../model", "../setup-model"].includes(spec) &&
        spec.split("/").includes("..");
      if (traversal || !ALLOWED.some((re) => re.test(spec))) {
        out.push(`${f.path}:${line} :: import "${spec}" - surfaces render view models only (no data, service, or builder imports)`);
      }
    }
  }
  return out;
}

/** Every module-reaching specifier with its line: static imports, re-exports,
 * dynamic import(), and require(). A non-literal dynamic specifier is recorded as
 * unverifiable so it fails the allowlist instead of slipping past it. */
function specifiersOf(project: Project): { path: string; specifiers: { spec: string; line: number }[] }[] {
  return project.getSourceFiles().map((sf) => {
    const specifiers: { spec: string; line: number }[] = [];
    for (const d of sf.getImportDeclarations()) {
      specifiers.push({ spec: d.getModuleSpecifierValue(), line: d.getStartLineNumber() });
    }
    for (const d of sf.getExportDeclarations()) {
      const spec = d.getModuleSpecifierValue();
      if (spec !== undefined) specifiers.push({ spec, line: d.getStartLineNumber() });
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.ImportKeyword && expr.getText() !== "require") continue;
      const arg = call.getArguments()[0];
      const lit = arg?.asKind(SyntaxKind.StringLiteral) ?? arg?.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
      specifiers.push({ spec: lit ? lit.getLiteralText() : "(non-literal dynamic specifier)", line: call.getStartLineNumber() });
    }
    return { path: relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/"), specifiers };
  });
}

/** Both .ts and .tsx: a plain-.ts helper in surfaces/ could otherwise import ../data
 * and re-export it to surfaces without the fence ever seeing the file. */
function surfacesProject(dir: string = join(REPO_ROOT, SURFACES_DIR)): Project {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  for (const f of walk(dir, (p) => p.endsWith(".ts") || p.endsWith(".tsx"))) project.addSourceFileAtPath(f);
  return project;
}

// ── RULE C: no dead view-model fields ───────────────────────────────────────────────
const VIEW_MODEL_FILES = ["src/app/demo/model.ts", "src/app/demo/setup-model.ts"];
/** Where a view-model field may legitimately be read: the surfaces, the routes that
 * hand view models to them, and the presentation primitives they render through.
 * Anything else is not a rendered field. */
const CONSUMER_DIRS = ["src/app/demo/surfaces", "src/app/app/demo", "src/app/presentation"];

export interface DeclaredField {
  readonly file: string;
  readonly sourcePath: string;
  readonly line: number;
  readonly owner: string;
  /** The exact declaration that OWNS this field, identified by position rather than
   * name, so a nested inline object type (all of which the checker names `__type`) is
   * still a distinguishable owner. */
  readonly ownerKey: string;
  readonly name: string;
}

/** A declaration's identity across ts-morph projects: same file, same offset. */
function declarationKey(declaration: Node): string {
  return `${declaration.getSourceFile().getFilePath()}#${declaration.getStart()}`;
}

/** The inline object types reachable from a declared type node - through arrays,
 * `readonly` operators, parentheses, unions, and intersections. `header: {...}`,
 * `selectedOptions: readonly {...}[]`, and `stateSlot?: {...} | null` all declare
 * fields that a builder can populate and no screen can render. */
function nestedTypeLiterals(typeNode: Node | undefined): TypeLiteralNode[] {
  if (typeNode === undefined) return [];
  if (Node.isTypeLiteral(typeNode)) return [typeNode];
  if (Node.isArrayTypeNode(typeNode)) return nestedTypeLiterals(typeNode.getElementTypeNode());
  if (Node.isParenthesizedTypeNode(typeNode)) return nestedTypeLiterals(typeNode.getTypeNode());
  if (Node.isTypeOperatorTypeNode(typeNode)) return nestedTypeLiterals(typeNode.getTypeNode());
  if (Node.isUnionTypeNode(typeNode) || Node.isIntersectionTypeNode(typeNode)) {
    return typeNode.getTypeNodes().flatMap((member) => nestedTypeLiterals(member));
  }
  return [];
}

/** Every field a view model declares, including type-alias arms and the members of
 * nested inline object types. */
export function declaredViewModelFields(project: Project): DeclaredField[] {
  const fields: DeclaredField[] = [];
  for (const sf of project.getSourceFiles()) {
    const file = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
    const collect = (properties: readonly Node[], owner: string, ownerKey: string): void => {
      for (const property of properties) {
        if (!Node.isPropertySignature(property)) continue;
        const name = property.getName();
        fields.push({
          file,
          sourcePath: sf.getFilePath(),
          line: property.getStartLineNumber(),
          owner,
          ownerKey,
          name,
        });
        for (const literal of nestedTypeLiterals(property.getTypeNode())) {
          collect(literal.getMembers(), `${owner}.${name}`, declarationKey(literal));
        }
      }
    };
    for (const iface of sf.getInterfaces()) {
      collect(iface.getProperties(), iface.getName(), declarationKey(iface));
    }
    for (const alias of sf.getTypeAliases()) {
      for (const literal of nestedTypeLiterals(alias.getTypeNode())) {
        collect(literal.getMembers(), alias.getName(), declarationKey(literal));
      }
    }
  }
  return fields;
}

/** One property READ, with the receiver declarations it was read through. */
export interface ReadOwner {
  readonly name: string;
  readonly declarationKeys: readonly string[];
}
export interface PropertyRead {
  readonly name: string;
  readonly owners: readonly ReadOwner[];
}

/** The project-declared types a receiver expression resolves to. Unions contribute
 * every constituent, so `vm: ApprovalVM | null` still reports ApprovalVM; types whose
 * only declarations are ambient (`Record`, `Array`) contribute nothing, because they
 * say nothing about which view model is being rendered. Anonymous object types keep
 * their declaration position, which is what lets a nested inline shape be owned by the
 * view model that declares it and by nothing else. */
function constituentTypes(type: Type): Type[] {
  if (type.isUnion()) {
    return type.getUnionTypes().flatMap((member) => constituentTypes(member));
  }
  if (type.isIntersection()) {
    return type
      .getIntersectionTypes()
      .flatMap((member) => constituentTypes(member));
  }
  return [type];
}

function ownersOf(node: Node | undefined): ReadOwner[] {
  if (node === undefined) return [];
  let type;
  try {
    type = node.getType();
  } catch {
    return [];
  }
  const constituents = constituentTypes(type);
  const owners = new Map<string, ReadOwner>();
  for (const constituent of constituents) {
    const symbol = constituent.getSymbol() ?? constituent.getAliasSymbol();
    const name = symbol?.getName();
    if (!name || name === "__object") continue;
    const declarations = symbol?.getDeclarations() ?? [];
    if (declarations.length === 0 || declarations.every((d) => d.getSourceFile().isDeclarationFile())) continue;
    const declarationKeys = declarations.map(declarationKey);
    owners.set(`${name}:${declarationKeys.join("|")}`, {
      name,
      declarationKeys,
    });
  }
  return [...owners.values()];
}

/** The receiver a destructuring pattern reads from: `const { a } = expr`, or a
 * parameter whose declared type names the owner. */
function bindingReceiver(element: Node): Node | undefined {
  const pattern = element.getParent();
  const declaration = pattern?.getParent();
  if (declaration === undefined) return undefined;
  if (Node.isVariableDeclaration(declaration)) return declaration.getInitializer() ?? declaration;
  if (Node.isParameterDeclaration(declaration)) return declaration;
  return undefined;
}

/** Every property a consumer READS - `vm.foo`, `{ foo }` destructuring, `vm["foo"]` -
 * keyed by the interface the receiver resolves to, so an unrelated property that
 * merely SHARES a name cannot stand in as proof that a field is rendered. */
export function readProperties(project: Project): PropertyRead[] {
  const reads: PropertyRead[] = [];
  for (const sf of project.getSourceFiles()) {
    for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      reads.push({ name: access.getName(), owners: ownersOf(access.getExpression()) });
    }
    for (const element of sf.getDescendantsOfKind(SyntaxKind.BindingElement)) {
      reads.push({
        name: (element.getPropertyNameNode() ?? element.getNameNode()).getText().replace(/^["']|["']$/g, ""),
        owners: ownersOf(bindingReceiver(element)),
      });
    }
    for (const access of sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
      const argument = access.getArgumentExpression();
      const literal = argument?.asKind(SyntaxKind.StringLiteral) ?? argument?.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
      if (literal) reads.push({ name: literal.getLiteralText(), owners: ownersOf(access.getExpression()) });
    }
  }
  return reads;
}

/**
 * A field is rendered only when a consumer reads it through the declaration that
 * owns the field. A same-name property on an inline or unrelated structural type is
 * not evidence that the populated view-model field reached a surface.
 */
export function deadFieldViolations(fields: readonly DeclaredField[], reads: readonly PropertyRead[]): string[] {
  const byName = new Map<string, PropertyRead[]>();
  for (const read of reads) byName.set(read.name, [...(byName.get(read.name) ?? []), read]);

  const rendered = (field: DeclaredField): boolean => {
    return (byName.get(field.name) ?? []).some((read) =>
      read.owners.some((owner) => owner.declarationKeys.includes(field.ownerKey)),
    );
  };

  return fields
    .filter((field) => !rendered(field))
    .map(
      (field) =>
        `${field.file}:${field.line} :: ${field.owner}.${field.name} is populated but never rendered - ship it or delete it (charter #5)`,
    );
}

// ── RULE D: one name per profile ────────────────────────────────────────────────────
/** A firm display name as a surface would spell it. Kept deliberately broad: "Firm A",
 * "Firm B", and any future "Firm C" all belong to the builder, never a component. */
const FIRM_NAME_PATTERN = /\bFirm [A-Z]\b/;

/** Every literal a surface RENDERS or compares - string literals, template chunks, and
 * JSX text. A ternary on `firmId` always lands one of its branches here. */
export function firmNameLiteralViolations(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const path = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
    const literals: Node[] = [
      ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
      ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
      ...sf.getDescendantsOfKind(SyntaxKind.TemplateHead),
      ...sf.getDescendantsOfKind(SyntaxKind.TemplateMiddle),
      ...sf.getDescendantsOfKind(SyntaxKind.TemplateTail),
      ...sf.getDescendantsOfKind(SyntaxKind.JsxText),
    ];
    for (const literal of literals) {
      const text = literal.getText();
      if (!FIRM_NAME_PATTERN.test(text)) continue;
      out.push(
        `${path}:${literal.getStartLineNumber()} :: "${text.trim().slice(0, 60)}" spells a firm display name - render firmLabel from the view model instead (one profile, one name)`,
      );
    }
  }
  return out;
}

/** Loaded through the repo tsconfig so `@app/...` aliases and imported view-model
 * types resolve: RULE C's owner test is only as good as the checker behind it. */
function projectOf(relativePaths: readonly string[], isDir: boolean): Project {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const rel of relativePaths) {
    const full = join(REPO_ROOT, rel);
    if (isDir) {
      for (const f of walk(full, (p) => p.endsWith(".ts") || p.endsWith(".tsx"))) project.addSourceFileAtPath(f);
    } else {
      project.addSourceFileAtPath(full);
    }
  }
  return project;
}

const yamlText = readFileSync(join(REPO_ROOT, "config/demo/scenarios.yaml"), "utf8");

describe("demo-skeleton-honesty fence", () => {
  it("RULE A enforces: skeleton branch data equals the contract's scenarios, firms, and dispositions", () => {
    const violations = parityViolations(skeletonFacts(), contractFacts(yamlText));
    expect(violations, `skeleton/contract drift:\n${violations.join("\n")}`).toEqual([]);
  });

  it("RULE A is not vacuous: both sides carry the twelve branches and two firms", () => {
    expect(Object.keys(skeletonFacts().scenarios).length).toBe(12);
    expect(Object.keys(contractFacts(yamlText).scenarios).length).toBe(12);
    expect(skeletonFacts().firms.length).toBe(2);
  });

  it("RULE B enforces: no surface component imports data, the fake service, or builders", () => {
    const files = specifiersOf(surfacesProject());
    expect(files.length, "no surface files found - the fence went stale (charter #4)").toBeGreaterThan(0);
    const violations = importBoundaryViolations(files);
    expect(violations, `surface import-boundary violations:\n${violations.join("\n")}`).toEqual([]);
  });

  it("RULE C enforces: every demo view-model field is rendered by a surface or route", () => {
    const fields = declaredViewModelFields(projectOf(VIEW_MODEL_FILES, false));
    expect(fields.length, "no view-model fields found - the fence went stale (charter #4)").toBeGreaterThan(0);
    const violations = deadFieldViolations(fields, readProperties(projectOf(CONSUMER_DIRS, true)));
    expect(violations, `dead view-model fields:\n${violations.join("\n")}`).toEqual([]);
  });

  it("RULE D enforces: no demo surface spells a firm's display name", () => {
    const project = surfacesProject();
    expect(
      project.getSourceFiles().length,
      "no surface files found - the fence went stale (charter #4)",
    ).toBeGreaterThan(0);
    const violations = firmNameLiteralViolations(project);
    expect(violations, `re-derived firm display names:\n${violations.join("\n")}`).toEqual([]);
  });

  it("RULE C is not vacuous: consumer reads resolve to named view-model owners", () => {
    const reads = readProperties(projectOf(CONSUMER_DIRS, true));
    const owners = new Set(reads.flatMap((read) => read.owners.map((owner) => owner.name)));
    expect(owners.has("MoneyMovementSetupVM"), "the checker no longer resolves view-model owners").toBe(true);
    expect(owners.has("SetupProofFirmVM")).toBe(true);
  });

  describe("detects (companion): drifted or dishonest skeletons CANNOT pass", () => {
    it("RULE C flags a populated-but-never-rendered field with file:line", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface ProofVM {\n  readonly inputHash: string;\n  readonly ghostField: string;\n}`,
        "/src/app/demo/surfaces/proof.tsx": `import type { ProofVM } from "../setup-model";\nexport function Proof({ vm }: { vm: ProofVM }) { return vm.inputHash; }`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("setup-model.ts:3");
      expect(violations[0]).toContain("ProofVM.ghostField");
    });

    it("RULE C flags an unread field declared by an object type alias", () => {
      const project = inMemoryProject({
        "/src/app/demo/model.ts": `export type EvidenceVM = {\n  readonly label: string;\n  readonly ghostField: string;\n};`,
        "/src/app/demo/surfaces/evidence.tsx": `import type { EvidenceVM } from "../model";\nexport function Evidence({ vm }: { vm: EvidenceVM }) { return vm.label; }`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("model.ts:3");
      expect(violations[0]).toContain("EvidenceVM.ghostField");
    });

    it("RULE C flags unread fields in every union type-alias arm", () => {
      const project = inMemoryProject({
        "/src/app/demo/model.ts": `export type ResultVM =\n  | { readonly ok: true; readonly value: string; readonly successGhost: string }\n  | { readonly ok: false; readonly error: string; readonly failureGhost: string };`,
        "/src/app/demo/surfaces/result.tsx": `import type { ResultVM } from "../model";\nexport function Result({ vm }: { vm: ResultVM }) { return vm.ok ? vm.value : vm.error; }`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations).toHaveLength(2);
      expect(
        violations.some((violation) =>
          violation.includes("ResultVM.successGhost"),
        ),
      ).toBe(true);
      expect(
        violations.some((violation) =>
          violation.includes("ResultVM.failureGhost"),
        ),
      ).toBe(true);
    });

    it("RULE C flags unread fields in every intersection type-alias member", () => {
      const project = inMemoryProject({
        "/src/app/demo/model.ts": `export type CombinedVM =\n  { readonly title: string; readonly titleGhost: string }\n  & { readonly detail: string; readonly detailGhost: string };`,
        "/src/app/demo/surfaces/combined.tsx": `import type { CombinedVM } from "../model";\nexport function Combined({ vm }: { vm: CombinedVM }) { return vm.title + vm.detail; }`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations).toHaveLength(2);
      expect(
        violations.some((violation) =>
          violation.includes("CombinedVM.titleGhost"),
        ),
      ).toBe(true);
      expect(
        violations.some((violation) =>
          violation.includes("CombinedVM.detailGhost"),
        ),
      ).toBe(true);
    });

    it("RULE C descends: a dead field inside a NESTED inline object type is flagged with file:line", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface ProofFirmVM {\n  readonly authorityPlan: {\n    readonly mode: string;\n    readonly reached: boolean;\n  };\n  readonly selectedOptions: readonly {\n    readonly groupId: string;\n    readonly label: string;\n  }[];\n}`,
        "/src/app/demo/surfaces/proof.tsx": `import type { ProofFirmVM } from "../setup-model";\nexport function Proof({ vm }: { vm: ProofFirmVM }) {\n  return [vm.authorityPlan.reached, vm.selectedOptions.map((o) => o.label)];\n}`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations).toHaveLength(2);
      expect(violations[0]).toContain("setup-model.ts:3");
      expect(violations[0]).toContain("ProofFirmVM.authorityPlan.mode");
      expect(violations[1]).toContain("ProofFirmVM.selectedOptions.groupId");
    });

    it("RULE C descends: a nested field read through its OWN view model counts as rendered", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface ProofFirmVM {\n  readonly approvalClock: {\n    readonly escalation: string;\n  };\n}`,
        "/src/app/demo/surfaces/proof.tsx": `import type { ProofFirmVM } from "../setup-model";\nexport function Proof({ vm }: { vm: ProofFirmVM }) { return vm.approvalClock.escalation; }`,
      });
      expect(
        deadFieldViolations(
          declaredViewModelFields(project),
          readProperties(project),
        ),
      ).toEqual([]);
    });

    it("RULE C descends: a same-named nested field on an unrelated shape does NOT rescue it", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface ProofFirmVM {\n  readonly approvalClock: {\n    readonly escalation: string;\n  };\n}`,
        "/src/app/demo/surfaces/clock.tsx": `interface LocalClock { readonly escalation: string }\nexport function Clock({ clock }: { clock: LocalClock }) { return clock.escalation; }`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations).toHaveLength(2);
      expect(
        violations.some((violation) =>
          violation.includes("ProofFirmVM.approvalClock.escalation"),
        ),
      ).toBe(true);
    });

    it("RULE C is owner-aware: an unrelated property of the same name does NOT rescue a dead field", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface SetupProofVM {\n  readonly engineLabel: string;\n  readonly stages: readonly string[];\n}`,
        "/src/app/demo/surfaces/authority.tsx": `interface ApprovalVM { readonly stages: readonly string[]; readonly binding: string }\nexport function Authority({ vm }: { vm: ApprovalVM }) { return [vm.stages, vm.binding]; }`,
        "/src/app/demo/surfaces/proof.tsx": `import type { SetupProofVM } from "../setup-model";\nexport function Proof({ vm }: { vm: SetupProofVM }) { return vm.engineLabel; }`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("SetupProofVM.stages");
    });

    it("RULE C counts a read on the DECLARING owner as rendered", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface SetupProofVM {\n  readonly stages: readonly string[];\n}`,
        "/src/app/demo/surfaces/proof.tsx": `import type { SetupProofVM } from "../setup-model";\nexport function Proof({ vm }: { vm: SetupProofVM }) { return vm.stages; }`,
      });
      expect(
        deadFieldViolations(
          declaredViewModelFields(project),
          readProperties(project),
        ),
      ).toEqual([]);
    });

    it("RULE C counts destructured and string-indexed reads as rendered", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface StepVM {\n  readonly kicker: string;\n  readonly title: string;\n}`,
        "/src/app/demo/surfaces/step.tsx": `import type { StepVM } from "../setup-model";\nexport function Step(vm: StepVM) {\n  const { kicker } = vm;\n  return kicker + vm["title"];\n}`,
      });
      expect(
        deadFieldViolations(
          declaredViewModelFields(project),
          readProperties(project),
        ),
      ).toEqual([]);
    });

    it("RULE C rejects ownerless inline same-name properties", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface ProofVM {\n  readonly title: string;\n}`,
        "/src/app/demo/surfaces/proof.tsx": `export function Proof({ vm }: { vm: { title: string } }) { return vm.title; }`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("ProofVM.title");
    });

    it("RULE C rejects an unrelated named structural subset", () => {
      const project = inMemoryProject({
        "/src/app/demo/setup-model.ts": `export interface ProofVM {\n  readonly title: string;\n  readonly detail: string;\n}`,
        "/src/app/demo/surfaces/proof.tsx": `interface TitleOnly { readonly title: string }\nexport function Proof({ vm }: { vm: TitleOnly }) { return vm.title; }`,
      });
      const violations = deadFieldViolations(
        declaredViewModelFields(project),
        readProperties(project),
      );
      expect(violations).toHaveLength(2);
      expect(violations.some((violation) => violation.includes("ProofVM.title"))).toBe(true);
    });

    it("RULE D flags a firm name re-derived from firmId, in a ternary or JSX text", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/legend.tsx": `export function Legend({ firmId }: { firmId: string }) {\n  const label = firmId === "firm-a" ? "Firm A" : "Firm B";\n  return <p>{label}</p>;\n}`,
        "/src/app/demo/surfaces/heading.tsx": `export function Heading() { return <dt>Firm B</dt>; }`,
      });
      const violations = firmNameLiteralViolations(project);
      expect(violations).toHaveLength(3);
      // Both ternary branches and the bare JSX heading, each with its own file:line.
      expect(violations.filter((v) => v.includes("legend.tsx:2"))).toHaveLength(2);
      expect(violations.some((v) => v.includes("heading.tsx:1"))).toBe(true);
      expect(violations.every((v) => v.includes("one profile, one name"))).toBe(true);
    });

    it("RULE D passes a surface that renders firmLabel from the view model", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/legend.tsx": `export function Legend({ firmLabel }: { firmLabel: string }) { return <p>{firmLabel}</p>; }`,
      });
      expect(firmNameLiteralViolations(project)).toEqual([]);
    });

    it("RULE A flags a skeleton scenario the contract does not know", () => {
      const skeleton = skeletonFacts();
      const drifted = { ...skeleton, scenarios: { ...skeleton.scenarios, "invented-branch": { disposition: "proceed" } } };
      expect(parityViolations(drifted, contractFacts(yamlText)).some((v) => v.includes(`"invented-branch"`) && v.includes("invent"))).toBe(true);
    });

    it("RULE A flags a missing contract branch", () => {
      const skeleton = skeletonFacts();
      const rest = Object.fromEntries(Object.entries(skeleton.scenarios).filter(([id]) => id !== "delayed-nigo"));
      expect(parityViolations({ ...skeleton, scenarios: rest }, contractFacts(yamlText)).some((v) => v.includes(`"delayed-nigo"`) && v.includes("missing from the skeleton"))).toBe(true);
    });

    it("RULE A flags a drifted disposition (prohibited quietly becoming proceed)", () => {
      const skeleton = skeletonFacts();
      const drifted = { ...skeleton, scenarios: { ...skeleton.scenarios, "permanent-prohibition": { disposition: "proceed" } } };
      expect(parityViolations(drifted, contractFacts(yamlText)).some((v) => v.includes("permanent-prohibition") && v.includes("may not invent"))).toBe(true);
    });

    it("RULE A flags a drifted per-firm split (Firm B's block quietly dropped)", () => {
      const skeleton = skeletonFacts();
      const drifted = {
        ...skeleton,
        scenarios: { ...skeleton.scenarios, "recent-bank-change-block": { disposition: "blocked", perFirm: { "firm-a": "proceed", "firm-b": "proceed" } } },
      };
      expect(parityViolations(drifted, contractFacts(yamlText)).some((v) => v.includes("firm-b=blocked"))).toBe(true);
    });

    it("RULE A flags an invented firm", () => {
      const skeleton = skeletonFacts();
      expect(parityViolations({ ...skeleton, firms: [...skeleton.firms, "firm-c"] }, contractFacts(yamlText)).some((v) => v.includes(`firm "firm-c" invented`))).toBe(true);
    });

    it("RULE A flags a skeleton per-firm split the contract does not record (plain contract disposition)", () => {
      const skeleton = skeletonFacts();
      const invented = {
        ...skeleton,
        scenarios: { ...skeleton.scenarios, "safe-proceed": { disposition: "proceed", perFirm: { "firm-b": "blocked" } } },
      };
      expect(
        parityViolations(invented, contractFacts(yamlText)).some(
          (v) => v.includes(`"safe-proceed"`) && v.includes("per-firm split") && v.includes("may not invent"),
        ),
      ).toBe(true);
    });

    it("RULE A flags a skeleton per-firm entry beyond the contract's recorded split", () => {
      const skeleton = skeletonFacts();
      const extra = {
        ...skeleton,
        scenarios: {
          ...skeleton.scenarios,
          "recent-bank-change-block": { disposition: "blocked", perFirm: { "firm-a": "proceed", "firm-b": "blocked", "firm-c": "proceed" } },
        },
      };
      expect(
        parityViolations(extra, contractFacts(yamlText)).some(
          (v) => v.includes(`"recent-bank-change-block"`) && v.includes("firm-c=proceed") && v.includes("does not state"),
        ),
      ).toBe(true);
    });

    it("RULE B flags a surface importing the contract data (with file:line)", () => {
      const project = inMemoryProject({ "/src/app/demo/surfaces/evil.tsx": `import { SCENARIOS } from "../data";\nexport function Evil() { return SCENARIOS.length; }` });
      const violations = importBoundaryViolations(specifiersOf(project));
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("evil.tsx:1");
      expect(violations[0]).toContain(`"../data"`);
    });

    it("RULE B flags a surface importing the fake service or a builder", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/evil2.tsx": `import { getJourney } from "../journey";\nimport { buildDisposition } from "../build-decision";\nexport const x = [getJourney, buildDisposition];`,
      });
      expect(importBoundaryViolations(specifiersOf(project)).length).toBe(2);
    });

    it("RULE B's walk sees plain-.ts files too - a .ts helper importing the data is caught on disk", () => {
      const dir = mkdtempSync(join(tmpdir(), "surfaces-fence-"));
      try {
        writeFileSync(join(dir, "evil-helper.ts"), `import { SCENARIOS } from "../data";\nexport const leaked = SCENARIOS;\n`);
        const violations = importBoundaryViolations(specifiersOf(surfacesProject(dir)));
        expect(violations.length).toBe(1);
        expect(violations[0]).toContain("evil-helper.ts:1");
        expect(violations[0]).toContain(`"../data"`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("RULE B flags a re-export reaching the contract data or the fake service", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/leak.ts": `export { SCENARIOS } from "../data";\nexport * from "../journey";`,
      });
      const violations = importBoundaryViolations(specifiersOf(project));
      expect(violations.length).toBe(2);
      expect(violations[0]).toContain("leak.ts:1");
      expect(violations[0]).toContain(`"../data"`);
      expect(violations[1]).toContain("leak.ts:2");
      expect(violations[1]).toContain(`"../journey"`);
    });

    it("RULE B flags a dynamic import of the contract data", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/dynamic.tsx": `export async function Sneaky() {\n  const { SCENARIOS } = await import("../data");\n  return SCENARIOS.length;\n}`,
      });
      const violations = importBoundaryViolations(specifiersOf(project));
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("dynamic.tsx:2");
      expect(violations[0]).toContain(`"../data"`);
    });

    it("RULE B flags a non-literal dynamic specifier - unverifiable cannot pass", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/opaque.tsx": `const target = "../data";\nexport const p = import(target);`,
      });
      const violations = importBoundaryViolations(specifiersOf(project));
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("(non-literal dynamic specifier)");
    });

    it("RULE B flags traversal specifiers disguised as sibling imports", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/traverse.tsx": `import { SCENARIOS } from "./../data";\nimport { getJourney } from "./helpers/../../journey";\nexport const t = [SCENARIOS, getJourney];`,
      });
      const violations = importBoundaryViolations(specifiersOf(project));
      expect(violations.length).toBe(2);
      expect(violations[0]).toContain(`"./../data"`);
      expect(violations[1]).toContain(`"./helpers/../../journey"`);
    });

    it("RULE B passes the allowed imports (react, next, presentation, model, siblings)", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/good.tsx": `import Link from "next/link";\nimport { Metric } from "@app/presentation/metric";\nimport type { WorkspaceVM } from "../model";\nimport { SurfaceShell } from "./shared";\nexport const y = [Link, Metric, SurfaceShell];`,
      });
      expect(importBoundaryViolations(specifiersOf(project))).toEqual([]);
    });
  });
});
