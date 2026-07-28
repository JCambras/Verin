import { describe, it, expect } from "vitest";
import { Project, ts } from "ts-morph";
import { join } from "node:path";
import {
  detectContractsExternalImportViolations,
  detectLayerViolations,
  isShippedSourceFilePath,
  realProject,
  inMemoryProject,
  SRC_ROOT,
} from "./_fence-utils";

/**
 * DEPENDENCY-RULE FENCE (ADR-0001, charter #1). Inner layers never import outer:
 * contracts ← domain ← infrastructure ← app. Detects STATIC imports, re-exports,
 * dynamic import(), AND require() — resolving relative and aliased specifiers to a
 * layer (the seams Iris leaked through: relative + dynamic imports walked past an
 * import-only check).
 *
 * Computed loader members are resolved when their key comes from a local literal
 * declaration or a preceding simple assignment. Runtime, conditional, and
 * configuration-derived keys are outside this static fence's proof boundary.
 */
describe("dependency-rule fence", () => {
  it("enforces: the real src/ tree has zero layer violations", () => {
    const project = realProject();
    const violations = detectLayerViolations(project);
    expect(
      violations,
      `dependency-rule violations:\n${violations.map((v) => `${v.file}:${v.line}: ${v.fromLayer} -> ${v.toLayer} (${v.specifier})`).join("\n")}`,
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

    it("configured aliases are resolved from compiler options before classification", () => {
      const project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
          baseUrl: "/",
          paths: { "@outer/*": ["src/infrastructure/*"] },
        },
      });
      project.createSourceFile(
        "/src/domain/evil.ts",
        `import { x } from "@outer/store";\nexport const y = x;`,
      );
      const v = detectLayerViolations(project);
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->infrastructure");
    });

    it("baseUrl modules are classified through TypeScript resolution", () => {
      const project = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
          baseUrl: "/",
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        },
      });
      project.createSourceFile(
        "/src/domain/evil.ts",
        `import { x } from "src/infrastructure/store";\nexport const y = x;`,
      );
      project.createSourceFile("/src/infrastructure/store.ts", "export const x = 1;");
      const v = detectLayerViolations(project);
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->infrastructure");
    });

    it.each([
      [
        "package imports",
        { name: "verin", type: "module", imports: { "#infra/*": "./src/infrastructure/*.ts" } },
        "#infra/store",
      ],
      [
        "package self-references",
        { name: "verin", type: "module", exports: { "./infra/*": "./src/infrastructure/*.ts" } },
        "verin/infra/store",
      ],
    ] as Array<[string, Record<string, unknown>, string]>)(
      "%s are classified through TypeScript resolution",
      (_name, packageJson, specifier) => {
        const project = new Project({
          useInMemoryFileSystem: true,
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            resolvePackageJsonExports: true,
            resolvePackageJsonImports: true,
          },
        });
        project.createSourceFile("/package.json", JSON.stringify(packageJson), {
          scriptKind: ts.ScriptKind.JSON,
        });
        project.createSourceFile(
          "/src/domain/evil.ts",
          `import { x } from "${specifier}";\nexport const y = x;`,
        );
        project.createSourceFile("/src/infrastructure/store.ts", "export const x = 1;");
        const v = detectLayerViolations(project);
        expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->infrastructure");
      },
    );

    it("local imports outside the four source layers fail closed", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/evil.ts": `import { x } from "../../scripts/local";\nexport const y = x;`,
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->unresolved");
    });

    it("resolved source files outside the project fail closed", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/evil.ts": `import { x } from "../../shared/local";\nexport const y = x;`,
          "shared/local.ts": "export const x = 1;",
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->unresolved");
    });

    it("alias traversal from contracts into infrastructure is normalized before classification", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/contracts/evil.ts": `import { x } from "@contracts/../infrastructure/store";\nexport const y = x;`,
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("contracts->infrastructure");
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

    it("non-literal dynamic import() fails closed in an inner layer", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/evil.ts": `const target = "@infra/store";\nexport const load = () => import(target);`,
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->unresolved");
      expect(v[0]?.specifier).toBe("<non-literal dynamic-import>");
    });

    it("non-literal require() fails closed in an inner layer", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/infrastructure/evil.ts": `const target = "@app/page";\nexport const load = () => require(target);`,
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("infrastructure->unresolved");
      expect(v[0]?.specifier).toBe("<non-literal require>");
    });

    it.each([
      `const load = require;\nexport const value = load("@infra/store");`,
      `export const value = (0, require)("@infra/store");`,
      `export const value = module.require("@infra/store");`,
      `export const value = module["require"]("@infra/store");`,
    ])("indirect CommonJS loaders fail closed", (source) => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/domain/evil.ts": source }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it.each([
      `import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = nodeModule.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `const { createRequire } = require("node:module");\nconst load = createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `const nodeModule = require("node:module");\nconst load = nodeModule["createRequire"](import.meta.url);\nexport const value = load("@infra/store");`,
      `const nodeModule = await import("node:module");\nconst load = nodeModule.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `const nodeModule = await import("node:module");\nconst key = "createRequire";\nconst load = nodeModule[key](import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Reflect.get(nodeModule, "createRequire")(import.meta.url);\nexport const value = load("@infra/store");`,
    ])("createRequire loaders fail closed", (source) => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/domain/evil.ts": source }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it("type-asserted node:module loaders cannot evade createRequire detection", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/evil.ts": [
            `const load = (await import("node:module") as any).createRequire(import.meta.url);`,
            `export const value = load("@infra/store");`,
          ].join("\n"),
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
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

    it("triple-slash type references cannot evade the contracts allowlist", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `/// <reference types="react" />\nexport type View = string;` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ line: 1, specifier: "react" });
    });

    it("triple-slash path references cannot cross project layers", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/contracts/evil.ts": `/// <reference path="../infrastructure/store.ts" />\nexport type View = string;`,
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("contracts->infrastructure");
      expect(v[0]).toMatchObject({ line: 1, specifier: "../infrastructure/store.ts" });
    });

    it("triple-slash lib references cannot restore contracts platform globals", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/evil.ts": `/// <reference lib="dom" />\nexport const value = fetch("https://example.test");`,
        }),
      );
      expect(v.some((violation) => violation.specifier === "dom")).toBe(true);
      expect(v.some((violation) => violation.line === 1)).toBe(true);
    });

    it("JSX cannot create an implicit runtime dependency in contracts", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.tsx": `export const view = <div />;` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ line: 1, specifier: "react/jsx-runtime" });
    });

    it.each([
      "fetch('https://example.test')",
      "Buffer.from('x')",
      "process.getBuiltinModule('fs')",
      "globalThis.fetch('https://example.test')",
    ])(
      "implicit platform global %s cannot evade contracts isolation",
      (expression) => {
        const v = detectContractsExternalImportViolations(
          inMemoryProject({
            "src/contracts/evil.ts": `export const forbidden = ${expression};`,
          }),
        );
        expect(v).toHaveLength(1);
        expect(v[0]?.line).toBe(1);
      },
    );

    it("platform namespaces are rejected by diagnostic code", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/evil.ts": "export type Timer = NodeJS.Timeout;",
        }),
      );
      expect(v).toEqual([
        expect.objectContaining({ line: 1, specifier: "<platform-global NodeJS>" }),
      ]);
    });

    it("DOM globals are rejected by diagnostic code", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/evil.ts":
            "export const title = document.title;",
        }),
      );
      expect(v).toEqual([
        expect.objectContaining({
          line: 1,
          specifier: "<platform-global document>",
        }),
      ]);
    });

    it.each([
      {
        "src/contracts/evil.ts":
          "declare const fetch: (url: string) => unknown;\nexport const value = fetch('https://example.test');",
      },
      {
        "src/contracts/platform.d.ts":
          "declare const fetch: (url: string) => unknown;",
        "src/contracts/use.ts":
          "export const value = fetch('https://example.test');",
      },
      {
        "src/contracts/platform.d.ts":
          "declare namespace NodeJS { interface Timeout {} }",
        "src/contracts/use.ts":
          "export type Timer = NodeJS.Timeout;",
      },
    ] as Array<Record<string, string>>)("ambient declarations cannot restore platform dependencies", (files) => {
      const v = detectContractsExternalImportViolations(inMemoryProject(files));
      expect(v.some((violation) =>
        violation.specifier.startsWith("<ambient-declaration "),
      )).toBe(true);
    });

    it("a type-only `unique symbol` brand is not a platform dependency, but a USED one still is", () => {
      const branded = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/brand.ts": [
            "declare const TenantBrand: unique symbol;",
            "export interface Tenant { readonly orgId: string; readonly [TenantBrand]: 'Tenant' }",
          ].join("\n"),
        }),
      );
      expect(branded).toEqual([]);
      // The SAME declaration referenced as a VALUE is the thing the rule refuses:
      // the exemption is about having no runtime surface, not about the type node.
      const used = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/leak.ts": [
            "declare const TenantBrand: unique symbol;",
            "export const key = TenantBrand;",
          ].join("\n"),
        }),
      );
      expect(used.some((v) => v.specifier === "<ambient-declaration TenantBrand>")).toBe(true);
    });

    it("locally declared platform-like names do not trip contracts isolation", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/ok.ts": [
            "const fetch = (value: string) => value;",
            "const Buffer = { from: (value: string) => value };",
            "const process = { getBuiltinModule: (value: string) => value };",
            "export const values = [fetch('x'), Buffer.from('x'), process.getBuiltinModule('x')];",
          ].join("\n"),
        }),
      );
      expect(v).toEqual([]);
    });

    it("relative traversal outside a project layer cannot reach an external package", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `import React from "../../../node_modules/react/index.js";\nexport { React };` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.specifier).toBe("../../../node_modules/react/index.js");
    });

    it("alias traversal cannot disguise an external package as a contracts import", () => {
      const specifier = "@contracts/../../node_modules/react/index.js";
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `import React from "${specifier}";\nexport { React };` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.specifier).toBe(specifier);
    });

    it("an external package nested under its own src directory remains external", () => {
      const specifier = "@contracts/../../node_modules/example/src/contracts/index.js";
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": `import value from "${specifier}";\nexport { value };` }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]?.specifier).toBe(specifier);
    });

    it("nested __tests__ paths remain subject to layer enforcement", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/contracts/__tests__/evil.ts": `import { x } from "@infra/store";\nexport const y = x;`,
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("contracts->infrastructure");
    });

    it("nested __tests__ paths remain subject to the contracts external allowlist", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/__tests__/evil.ts": `import { createElement } from "react";\nexport { createElement };`,
        }),
      );
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ line: 1, specifier: "react" });
    });

    it("source-local declaration files remain shipped and dependency-enforced", () => {
      expect(
        isShippedSourceFilePath(join(SRC_ROOT, "contracts", "evil.d.ts")),
      ).toBe(true);
      expect(
        isShippedSourceFilePath(join(SRC_ROOT, "__tests__", "evil.d.ts")),
      ).toBe(false);
      const project = inMemoryProject({
        "src/contracts/evil.d.ts": `import type { ReactNode } from "react";\nexport type View = ReactNode;`,
      });
      expect(detectContractsExternalImportViolations(project)).toEqual([
        expect.objectContaining({ line: 1, specifier: "react" }),
      ]);
    });

    it("zod is the only permitted contracts external dependency", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/ok.ts": `import { z } from "zod";\nexport const schema = z.string();` }),
      );
      expect(v).toEqual([]);
    });

    it("locally declared require-shaped values do not trip the fence", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/ok.ts": [
            `const require = (value: string) => value;`,
            `const local = { require: (value: string) => value };`,
            `export const values = [require("x"), local.require("x"), local["require"]("x")];`,
            `export type Contract = { require: string };`,
          ].join("\n"),
        }),
      );
      expect(v).toEqual([]);
    });

    it("require-shaped members of values imported from ANOTHER module do not trip the fence", () => {
      // The same-file case above passes for the wrong reason: those symbols resolve
      // locally. A member reached through an import resolves into the OTHER module, and
      // a receiver typed `any` resolves nowhere - both used to read as a CommonJS
      // loader and hard-fail an inner layer on a property that merely shares the name.
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/cfg.ts": [
            `export const cfg = { require: (value: string) => value, nested: { require: (value: string) => value } };`,
            `export type Contract = { require: string };`,
          ].join("\n"),
          "src/domain/ok.ts": [
            `import { cfg, type Contract } from "./cfg";`,
            `declare const untyped: any;`,
            `const { require: renamed } = cfg;`,
            `const contract: Contract = { require: "x" };`,
            `export const values = [`,
            `  cfg.require("x"),`,
            `  cfg["require"]("x"),`,
            `  cfg.nested["require"]("x"),`,
            `  renamed("x"),`,
            `  contract.require,`,
            `  untyped.require("x"),`,
            `  untyped["require"]("x"),`,
            `];`,
          ].join("\n"),
        }),
      );
      expect(v).toEqual([]);
    });

    it.each([
      `export const value = module.require("@infra/store");`,
      `export const value = module["require"]("@infra/store");`,
      `export const value = (globalThis as any).require("@infra/store");`,
      `export const value = (globalThis as any)["require"]("@infra/store");`,
      `const loader = module;\nexport const value = loader.require("@infra/store");`,
    ])("a require member reached through an AMBIENT global still fails closed", (source) => {
      // NON-VACUOUS pair for the companion above: narrowing the scan to real loaders
      // must not narrow it past `module`/`globalThis`, whose `require` is exactly the
      // CommonJS escape the dependency rule exists to close. Ambiently declared or
      // undeclared receivers stay caught; project-declared ones do not.
      const v = detectLayerViolations(
        inMemoryProject({
          "src/types/node-shim.d.ts": `declare const module: { require(id: string): unknown };`,
          "src/domain/evil.ts": source,
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain("domain->unresolved");
      expect(v[0]?.specifier).toBe("<non-literal require-reference>");
    });

    it("an ambient module alias typed as any remains loader provenance", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/types/node-shim.d.ts":
            "declare const module: { require(id: string): unknown };",
          "src/domain/evil.ts": [
            "const moduleAlias: any = module;",
            `export const value = moduleAlias.require("@infra/store");`,
          ].join("\n"),
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
      expect(v[0]?.specifier).toBe("<non-literal require-reference>");
    });

    it.each([
      [
        "direct",
        `const { require: load } = module;\nexport const value = load("@infra/store");`,
      ],
      [
        "type-erased",
        `const ambient: any = module;\nconst { require: load } = ambient;\nexport const value = load("@infra/store");`,
      ],
      [
        "computed literal",
        `const { ["require"]: load } = module;\nexport const value = load("@infra/store");`,
      ],
      [
        "computed literal type-erased",
        `const ambient: any = module;\nconst { ["require"]: load } = ambient;\nexport const value = load("@infra/store");`,
      ],
      [
        "computed constant",
        `const key = "require" as const;\nconst { [key]: load } = module;\nexport const value = load("@infra/store");`,
      ],
      [
        "assigned computed key",
        `let key = "other";\nkey = "require";\nconst { [key]: load } = module;\nexport const value = load("@infra/store");`,
      ],
      [
        "assignment",
        `let load: any;\n({ require: load } = module);\nexport const value = load("@infra/store");`,
      ],
      [
        "assignment type-erased",
        `const ambient: any = module;\nlet load: any;\n({ ["require"]: load } = ambient);\nexport const value = load("@infra/store");`,
      ],
      [
        "assigned receiver",
        `let ambient: any;\nambient = module;\nconst { require: load } = ambient;\nexport const value = load("@infra/store");`,
      ],
      [
        "reassigned receiver",
        `let ambient: any = {};\nambient = module;\nconst { require: load } = ambient;\nexport const value = load("@infra/store");`,
      ],
      [
        "parameter",
        `export function value({ require: load } = module) { return load("@infra/store"); }`,
      ],
    ])("destructured ambient require provenance remains enforced: %s", (_name, source) => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/types/node-shim.d.ts":
            "declare const module: { require(id: string): unknown };",
          "src/domain/evil.ts": source,
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
      expect(v[0]?.specifier).toBe("<non-literal require-reference>");
    });

    it.each([
      [
        "computed literal",
        `const { ["createRequire"]: make } = require("node:module");\nexport const load = make(import.meta.url);`,
      ],
      [
        "computed literal type-erased",
        `const namespace: any = await import("node:module");\nconst { ["createRequire"]: make } = namespace;\nexport const load = make(import.meta.url);`,
      ],
      [
        "computed constant",
        `const key = "createRequire" as const;\nconst { [key]: make } = await import("node:module");\nexport const load = make(import.meta.url);`,
      ],
      [
        "assigned computed key",
        `let key = "other";\nkey = "createRequire";\nconst { [key]: make } = await import("node:module");\nexport const load = make(import.meta.url);`,
      ],
      [
        "assignment",
        `let make: any;\n({ createRequire: make } = await import("node:module"));\nexport const load = make(import.meta.url);`,
      ],
      [
        "assignment type-erased",
        `const namespace: any = await import("node:module");\nlet make: any;\n({ ["createRequire"]: make } = namespace);\nexport const load = make(import.meta.url);`,
      ],
      [
        "assigned receiver",
        `let namespace: any;\nnamespace = await import("node:module");\nconst { createRequire: make } = namespace;\nexport const load = make(import.meta.url);`,
      ],
      [
        "reassigned receiver",
        `let namespace: any = {};\nnamespace = await import("node:module");\nconst { createRequire: make } = namespace;\nexport const load = make(import.meta.url);`,
      ],
      [
        "parameter",
        `export function load({ createRequire: make } = require("node:module")) { return make(import.meta.url); }`,
      ],
    ])("destructured createRequire provenance remains enforced: %s", (_name, source) => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/domain/evil.ts": source }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
      expect(v.some((violation) =>
        violation.specifier === "<non-literal create-require>",
      )).toBe(true);
    });

    it.each([
      [
        "ambient require",
        `let key = "other";\nkey = "require";\nexport const value = module[key]("@infra/store");`,
      ],
      [
        "createRequire",
        `let key = "other";\nkey = "createRequire";\nexport const load = (await import("node:module"))[key](import.meta.url);`,
      ],
    ])("assigned element-access loader keys remain enforced: %s", (_name, source) => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/types/node-shim.d.ts":
            "declare const module: { require(id: string): unknown };",
          "src/domain/evil.ts": source,
        }),
      );
      expect(v.map((violation) =>
        `${violation.fromLayer}->${violation.toLayer}`,
      )).toContain("domain->unresolved");
    });
  });
});
