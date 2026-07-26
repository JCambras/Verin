import { describe, it, expect } from "vitest";
import { relative, resolve, dirname } from "node:path";
import type { Project, SourceFile } from "ts-morph";
import { realProject, inMemoryProject, importSpecifiers, REPO_ROOT, SRC_ROOT } from "./_fence-utils";
import { isPIIField } from "@contracts/pii";

/**
 * LLM-PII-BOUNDARY FENCE (v3 §15.1, INVARIANT 1: "No PII-bearing type is
 * reachable from llm/"). Two derived, compile/import-level checks:
 *
 *  1. MARKER COMPLETENESS (the derivation floor): every interface in the
 *     platform layers (contracts/domain/infrastructure — the app layer is
 *     structurally unreachable from llm/ via the dependency-rule fence) that
 *     declares a raw PII-named field must extend the PIIBearing marker or be a
 *     reviewed machine-name escape. The marked set is therefore DERIVED, so a
 *     new PII-carrying type cannot ship unmarked and slip past check 2.
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

/** Platform-layer interfaces with raw PII-named fields that are neither marked nor escaped. */
export function detectUnmarkedPIITypes(project: Project, escapes: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const normalized = normalizePath(sf);
    if (!/^src\/(contracts|domain|infrastructure)\//.test(normalized)) continue;
    for (const iface of sf.getInterfaces()) {
      if (iface.getName() === "PIIBearing") continue; // the marker itself
      const marked = iface.getHeritageClauses().some((h) => /\bPIIBearing\b/.test(h.getText()));
      if (marked) continue;
      for (const prop of iface.getProperties()) {
        const typeText = prop.getTypeNode()?.getText() ?? "";
        if (!isPIIField(prop.getName()) || /\bTokenized\b/.test(typeText)) continue;
        const ref = `${normalized} :: ${iface.getName()}.${prop.getName()}`;
        if (!escapes.has(ref)) out.push(ref);
      }
    }
  }
  return out;
}

/** Modules that declare at least one PIIBearing-marked interface. */
export function markedModules(project: Project): Set<string> {
  const out = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    const hasMarked = sf.getInterfaces().some((i) => i.getHeritageClauses().some((h) => /\bPIIBearing\b/.test(h.getText())));
    if (hasMarked) out.add(normalizePath(sf));
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
  const project = realProject();

  it("enforces: every platform-layer type with a raw PII-named field is PIIBearing-marked (or a reviewed machine-name escape)", () => {
    const unmarked = detectUnmarkedPIITypes(project, ESCAPE_SET);
    expect(unmarked, `unmarked PII-bearing types (extend PIIBearing or review into NON_PII_ESCAPES):\n${unmarked.join("\n")}`).toEqual([]);
  });

  it("enforces: no stale escapes (each escape still names a live interface property)", () => {
    const live = new Set<string>();
    for (const sf of project.getSourceFiles()) {
      const normalized = normalizePath(sf);
      for (const iface of sf.getInterfaces()) for (const prop of iface.getProperties()) live.add(`${normalized} :: ${iface.getName()}.${prop.getName()}`);
    }
    const stale = NON_PII_ESCAPES.filter((e) => !live.has(e.ref)).map((e) => e.ref);
    expect(stale, `stale escapes:\n${stale.join("\n")}`).toEqual([]);
  });

  it("enforces: the marked set is non-empty (a gutted marker would pass reachability vacuously — charter #4)", () => {
    expect(markedModules(project).size).toBeGreaterThanOrEqual(4);
  });

  it("enforces: the llm/ surface exists and NO PII-bearing module is import-reachable from it (invariant 1)", () => {
    const llmFiles = project.getSourceFiles().filter((sf) => /\/llm\//.test(normalizePath(sf)));
    expect(llmFiles.length, "the llm/ boundary module is missing — invariant 1 would be vacuous").toBeGreaterThanOrEqual(2);
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
      expect(v.length).toBe(1);
      expect(v[0]).toContain("entities");
    });
    it("flags a TRANSITIVE leak (llm -> helper -> marked module)", () => {
      const project = inMemoryProject({
        "/src/contracts/pii.ts": marker,
        "/src/domain/schema/entities.ts": entities,
        "/src/infrastructure/helper.ts": `export { type Contact } from "../domain/schema/entities";`,
        "/src/infrastructure/llm/evil.ts": `import type { Contact } from "../helper";\nexport type Leak = Contact;`,
      });
      expect(detectPIIReachableFromLlm(project).length).toBe(1);
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
        "/src/domain/fine.ts": `import type { Tokenized } from "@contracts/tokenized";\nexport interface Masked { firstName: Tokenized<string> }`,
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
  });
});
