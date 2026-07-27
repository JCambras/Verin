import { describe, it, expect } from "vitest";
import {
  detectContractsExternalImportViolations,
  detectLayerViolations,
  realProject,
  inMemoryProject,
} from "./_fence-utils";

/**
 * DEPENDENCY-RULE FENCE (ADR-0001, charter #1). Inner layers never import outer:
 * contracts ← domain ← infrastructure ← app. Detects STATIC imports, re-exports,
 * dynamic import(), AND require() — resolving relative and aliased specifiers to a
 * layer (the seams Iris leaked through: relative + dynamic imports walked past an
 * import-only check).
 */
describe("dependency-rule fence", () => {
  it("enforces: the real src/ tree has zero layer violations", () => {
    const project = realProject();
    const violations = detectLayerViolations(project);
    expect(
      violations,
      `dependency-rule violations:\n${violations.map((v) => `${v.file}: ${v.fromLayer} -> ${v.toLayer} (${v.specifier})`).join("\n")}`,
    ).toEqual([]);
    const external = detectContractsExternalImportViolations(project);
    expect(
      external,
      `contracts external-import violations:\n${external.map((v) => `${v.file}:${v.line} (${v.specifier})`).join("\n")}`,
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

    it("an external package other than zod in contracts is caught with file:line", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `import { createElement } from "react";\nexport { createElement };` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ line: 1, specifier: "react" });
    });

    it("non-literal dynamic imports cannot evade the contracts allowlist", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `const packageName = "react";\nexport const load = () => import(packageName);` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.specifier).toBe("<non-literal dynamic-import>");
    });

    it("import types cannot evade the contracts allowlist", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `export type View = import("react").ReactNode;` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ line: 1, specifier: "react" });
    });

    it("import-equals declarations cannot evade the contracts allowlist", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `import React = require("react");\nexport type View = React.ReactNode;` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ line: 1, specifier: "react" });
    });

    it("relative traversal outside a project layer cannot reach an external package", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `import React from "../../../node_modules/react/index.js";\nexport { React };` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.specifier).toBe("../../../node_modules/react/index.js");
    });

    it("zod is the only permitted contracts external dependency", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/ok.ts": `import { z } from "zod";\nexport const schema = z.string();` }),
      );
      expect(v).toEqual([]);
    });
  });
});
