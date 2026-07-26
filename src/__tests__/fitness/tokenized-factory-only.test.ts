import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import { SyntaxKind, type Project } from "ts-morph";
import { realProject, inMemoryProject, REPO_ROOT } from "./_fence-utils";

/**
 * TOKENIZED-FACTORY-ONLY FENCE (v3 §15.1 normative rule, invariant 1). The
 * sealed security types are constructible ONLY inside their factory modules:
 *   Tokenized<T>   → src/infrastructure/pii/tokenize.ts (the scrubber module)
 *   TenantContext  → src/contracts/tenant.ts
 *   ActionGrant    → src/contracts/authz.ts
 * Anywhere else, an object literal or a cast (as / angle-bracket / satisfies)
 * producing one of these types fails the build — `piiFree: true` proves
 * nothing unless the scrubber minted it. ESLint mirrors this at edit time;
 * THIS fence is authoritative (AST over every shipped file, all cast forms).
 */
const SEALED: Array<{ typeName: string; factory: string }> = [
  { typeName: "Tokenized", factory: "src/infrastructure/pii/tokenize.ts" },
  { typeName: "TenantContext", factory: "src/contracts/tenant.ts" },
  { typeName: "ActionGrant", factory: "src/contracts/authz.ts" },
];
const SEALED_RE = new RegExp(`\\b(${SEALED.map((s) => s.typeName).join("|")})\\b`);

function factoryFor(typeText: string): string | null {
  const hit = SEALED.find((s) => new RegExp(`\\b${s.typeName}\\b`).test(typeText));
  return hit ? hit.factory : null;
}

/** Casts or literals producing a sealed type outside its factory module. */
export function detectSealedTypeConstruction(project: Project): string[] {
  const out: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
    const normalized = rel.startsWith("..") ? sf.getFilePath().replace(/^\//, "") : rel;

    const castKinds = [SyntaxKind.AsExpression, SyntaxKind.TypeAssertionExpression, SyntaxKind.SatisfiesExpression] as const;
    for (const kind of castKinds) {
      for (const node of sf.getDescendantsOfKind(kind)) {
        const typeText = node.getTypeNode()?.getText() ?? "";
        if (!SEALED_RE.test(typeText)) continue;
        const factory = factoryFor(typeText);
        if (factory && normalized !== factory) {
          out.push(`${normalized}:${node.getStartLineNumber()} — cast to sealed type '${typeText}' outside its factory`);
        }
      }
    }
    // Structural construction: an object literal claiming `piiFree` outside the
    // scrubber module is a hand-built Tokenized impostor regardless of casts.
    for (const lit of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const hasPiiFree = lit.getProperties().some((p) => p.getKind() === SyntaxKind.PropertyAssignment && p.asKindOrThrow(SyntaxKind.PropertyAssignment).getName() === "piiFree");
      if (hasPiiFree && normalized !== "src/infrastructure/pii/tokenize.ts") {
        out.push(`${normalized}:${lit.getStartLineNumber()} — object literal with 'piiFree' outside the scrubber factory`);
      }
    }
  }
  return out;
}

describe("tokenized-factory-only fence (sealed security types)", () => {
  it("enforces: no cast or literal produces Tokenized / TenantContext / ActionGrant outside its factory module", () => {
    const offenders = detectSealedTypeConstruction(realProject());
    expect(offenders, `sealed-type constructions:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("enforces: each factory module still exists and still contains its ONE sanctioned construction", () => {
    // If a factory moved, the allowlist above silently exempts nothing — and the
    // sealed type would become unconstructible; if the sanctioned cast vanished,
    // the fence may be passing vacuously (charter #4).
    const project = realProject();
    for (const s of SEALED) {
      const sf = project.getSourceFiles().find((f) => relative(REPO_ROOT, f.getFilePath()).replace(/\\/g, "/") === s.factory);
      expect(sf, `factory module ${s.factory} is missing`).toBeTruthy();
      const constructs = sf!.getDescendantsOfKind(SyntaxKind.AsExpression).some((n) => new RegExp(`\\b${s.typeName}\\b`).test(n.getTypeNode()?.getText() ?? ""));
      expect(constructs, `${s.factory} no longer constructs ${s.typeName} — the factory moved without updating this fence`).toBe(true);
    }
  });

  describe("detects (companion): every construction form is caught", () => {
    it("catches an `as Tokenized<...>` cast", () => {
      const project = inMemoryProject({ "/src/domain/evil.ts": `const t = { value: "x", piiFree: true } as Tokenized<string>;` });
      const hits = detectSealedTypeConstruction(project);
      expect(hits.length).toBe(2); // the cast AND the piiFree literal
    });
    it("catches an angle-bracket assertion", () => {
      const project = inMemoryProject({ "/src/domain/evil.ts": `const t = <Tokenized<string>>whatever;` });
      expect(detectSealedTypeConstruction(project).length).toBe(1);
    });
    it("catches `satisfies Tokenized<...>`", () => {
      const project = inMemoryProject({ "/src/domain/evil.ts": `const t = { value: "x", piiFree: true } satisfies Tokenized<string>;` });
      expect(detectSealedTypeConstruction(project).length).toBe(2);
    });
    it("catches a bare piiFree literal with NO cast at all (structural impostor)", () => {
      const project = inMemoryProject({ "/src/app/evil.ts": `export const fake = { value: "x", piiFree: true };` });
      expect(detectSealedTypeConstruction(project).length).toBe(1);
    });
    it("catches a TenantContext cast and an ActionGrant cast outside their factories", () => {
      const project = inMemoryProject({
        "/src/app/evil.ts": `const t = { orgId: "victim-org" } as unknown as TenantContext;\nconst g = fake as ActionGrant;`,
      });
      expect(detectSealedTypeConstruction(project).length).toBe(2);
    });
    it("allows the factory modules their own sanctioned casts", () => {
      const project = inMemoryProject({
        "/src/infrastructure/pii/tokenize.ts": `const t = Object.freeze({ value, piiFree: true }) as Tokenized<string>;`,
        "/src/contracts/tenant.ts": `const c = Object.freeze(ctx) as unknown as TenantContext;`,
        "/src/contracts/authz.ts": `const g = Object.freeze(grant) as unknown as ActionGrant;`,
      });
      expect(detectSealedTypeConstruction(project)).toEqual([]);
    });
    it("does not flag a plain type ANNOTATION (only casts and literals construct)", () => {
      const project = inMemoryProject({ "/src/domain/fine.ts": `export function use(t: Tokenized<string>): string { return String(t.value); }` });
      expect(detectSealedTypeConstruction(project)).toEqual([]);
    });
  });
});
