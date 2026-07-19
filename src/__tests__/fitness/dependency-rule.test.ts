import { describe, it, expect } from "vitest";
import { detectLayerViolations, realProject, inMemoryProject } from "./_fence-utils";

/**
 * DEPENDENCY-RULE FENCE (ADR-0001, charter #1). Inner layers never import outer:
 * contracts ← domain ← infrastructure ← app. Detects STATIC imports, re-exports,
 * dynamic import(), AND require() — resolving relative and aliased specifiers to a
 * layer (the seams Iris leaked through: relative + dynamic imports walked past an
 * import-only check).
 */
describe("dependency-rule fence", () => {
  it("enforces: the real src/ tree has zero layer violations", () => {
    const violations = detectLayerViolations(realProject());
    expect(
      violations,
      `dependency-rule violations:\n${violations.map((v) => `${v.file}: ${v.fromLayer} -> ${v.toLayer} (${v.specifier})`).join("\n")}`,
    ).toEqual([]);
  });

  // COMPANION (charter #4): incomplete/wrong code CANNOT pass. Each seam is caught.
  describe("detects (companion): a planted violation is caught", () => {
    it("static import from domain into infrastructure (alias)", () => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/domain/evil.ts": `import { x } from "@infra/store";\nexport const y = x;` }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->infrastructure");
    });

    it("relative import from domain into infrastructure (../)", () => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/domain/evil.ts": `import { x } from "../infrastructure/store";\nexport const y = x;` }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->infrastructure");
    });

    it("dynamic import() from contracts into app", () => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/contracts/evil.ts": `export async function go() { return import("@app/page"); }` }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("contracts->app");
    });

    it("require() from infrastructure into app", () => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/infrastructure/evil.ts": `export const p = require("@app/page");` }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("infrastructure->app");
    });

    it("clean inner->inner imports do NOT trip the fence", () => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/domain/ok.ts": `import { Result } from "@contracts/result";\nexport const r: Result<number> | null = null;` }),
      );
      expect(v).toEqual([]);
    });
  });
});
