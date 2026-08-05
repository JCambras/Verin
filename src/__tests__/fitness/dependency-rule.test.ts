import { describe, it, expect } from "vitest";
import { Project, ts } from "ts-morph";
import { join } from "node:path";
import {
  detectContractsExternalImportViolations,
  detectLayerViolations,
  isShippedSourceFilePath,
  moduleReferences,
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
      `import * as nodeModule from "node:module";\nconst { get } = Reflect;\nconst load = get(nodeModule, "createRequire")(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst reflection = globalThis.Reflect;\nconst { get } = reflection;\nconst load = get(nodeModule, "createRequire")(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nlet read: typeof Reflect.get;\n({ get: read } = Reflect);\nconst load = read(nodeModule, "createRequire")(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nlet read = Object.getOwnPropertyDescriptor;\n({ get: read } = Reflect);\nconst load = read(nodeModule, "createRequire")(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst read = Reflect.get.bind(Reflect);\nconst load = read(nodeModule, "createRequire")(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Reflect.get.call(Reflect, nodeModule, "createRequire")(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Reflect.get.apply(Reflect, [nodeModule, "createRequire"])(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst args = Math.random() ? [nodeModule, "createRequire"] : [];\nconst load = Reflect.get.apply(Reflect, args)(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst copy = { ...nodeModule };\nconst load = copy.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst copy = Object.assign({}, nodeModule);\nconst load = copy.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nlet copy: unknown = nodeModule;\nif (Math.random()) copy = {};\nconst load = (copy as typeof nodeModule).createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst copy = Object.fromEntries(Object.entries(nodeModule));\nconst load = copy.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder = { mod: nodeModule };\nconst load = holder.mod.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder = { nested: { mod: nodeModule } };\nconst load = holder.nested.mod.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder = [nodeModule] as const;\nconst load = holder[0].createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst [held] = [nodeModule] as const;\nconst load = held.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst held = Object.freeze(nodeModule);\nconst load = held.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst [read] = [Reflect.get] as const;\nconst load = read(nodeModule, "createRequire")(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder = [{}, nodeModule] as const;\nlet index = 0;\nif (Math.random()) index = 1;\nconst load = (holder[index] as typeof nodeModule).createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder: Record<string, unknown> = {};\nholder.mod = nodeModule;\nconst load = (holder.mod as typeof nodeModule).createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder = { mod: nodeModule, safe: {} };\nlet key = "mod";\nif (Math.random()) key = "safe";\nconst load = (holder[key as keyof typeof holder] as typeof nodeModule).createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Reflect.apply(Reflect.get, undefined, [nodeModule, "createRequire"])(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Object.getOwnPropertyDescriptor(nodeModule, "createRequire")!.value(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst { getOwnPropertyDescriptor: read } = Object;\nconst load = read(nodeModule, "createRequire")!.value(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst read = Object.getOwnPropertyDescriptor.bind(Object);\nconst load = read(nodeModule, "createRequire")!.value(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Object.getOwnPropertyDescriptor.call(Object, nodeModule, "createRequire")!.value(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Object.getOwnPropertyDescriptor.apply(Object, [nodeModule, "createRequire"])!.value(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Object.getOwnPropertyDescriptors(nodeModule).createRequire.value(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst load = Reflect.getOwnPropertyDescriptor(nodeModule, "createRequire")!.value(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst key = Math.random() ? "createRequire" : "other";\nconst load = Object.getOwnPropertyDescriptor(nodeModule, key)!.value(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nfunction expose() { return nodeModule; }\nconst load = expose().createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { static module = nodeModule; }\nconst load = Holder.module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { static module: typeof nodeModule; }\nHolder.module = nodeModule;\nconst load = Holder.module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { static get module() { return nodeModule; } }\nconst load = Holder.module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { module = nodeModule; }\nconst load = new Holder().module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { get module() { return nodeModule; } }\nconst load = new Holder().module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { module: typeof nodeModule; constructor() { this.module = nodeModule; } }\nconst load = new Holder().module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { constructor(public module = nodeModule) {} }\nconst load = new Holder().module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { constructor(public module: typeof nodeModule) {} }\nconst load = new Holder(nodeModule).module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst modules: Array<typeof nodeModule> = [];\nmodules.push(nodeModule);\nconst load = modules[0]!.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst modules = new Map<string, typeof nodeModule>();\nmodules.set("loader", nodeModule);\nconst load = modules.get("loader")!.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder: { module?: typeof nodeModule } = {};\nObject.assign(holder, { module: nodeModule });\nconst load = holder.module!.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder: { module?: typeof nodeModule } = {};\nObject.defineProperty(holder, "module", { value: nodeModule });\nconst load = holder.module!.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nconst holder: { module?: typeof nodeModule } = {};\nReflect.set(holder, "module", nodeModule);\nconst load = holder.module!.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
      `import * as nodeModule from "node:module";\nclass Holder { static module: typeof nodeModule; static { this.module = nodeModule; } }\nconst load = Holder.module.createRequire(import.meta.url);\nexport const value = load("@infra/store");`,
    ])("createRequire loader %# fails closed", (source) => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/domain/evil.ts": source }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it("follows a node:module namespace exported through another module", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/loader.ts": [
            `import * as nodeModule from "node:module";`,
            "export { nodeModule };",
          ].join("\n"),
          "src/domain/evil.ts": [
            `import { nodeModule } from "./loader";`,
            "const load = nodeModule.createRequire(import.meta.url);",
            `export const value = load("@infra/store");`,
          ].join("\n"),
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it("follows a mutation-held node:module namespace across modules", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/loader.ts": [
            `import * as nodeModule from "node:module";`,
            "export const modules: Array<typeof nodeModule> = [];",
            "modules.push(nodeModule);",
          ].join("\n"),
          "src/domain/evil.ts": [
            `import { modules } from "./loader";`,
            "const load = modules[0]!.createRequire(import.meta.url);",
            `export const value = load("@infra/store");`,
          ].join("\n"),
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it("follows a node:module namespace in an exported static class property", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/loader.ts": [
            `import * as nodeModule from "node:module";`,
            "export class Holder { static module = nodeModule; }",
          ].join("\n"),
          "src/domain/evil.ts": [
            `import { Holder } from "./loader";`,
            "const load = Holder.module.createRequire(import.meta.url);",
            `export const value = load("@infra/store");`,
          ].join("\n"),
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it("follows a node:module namespace in an exported static class getter", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/loader.ts": [
            `import * as nodeModule from "node:module";`,
            "export class Holder { static get module() { return nodeModule; } }",
          ].join("\n"),
          "src/domain/evil.ts": [
            `import { Holder } from "./loader";`,
            "const load = Holder.module.createRequire(import.meta.url);",
            `export const value = load("@infra/store");`,
          ].join("\n"),
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it("follows a node:module namespace in an exported instance class field", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/loader.ts": [
            `import * as nodeModule from "node:module";`,
            "export class Holder { module = nodeModule; }",
          ].join("\n"),
          "src/domain/evil.ts": [
            `import { Holder } from "./loader";`,
            "const load = new Holder().module.createRequire(import.meta.url);",
            `export const value = load("@infra/store");`,
          ].join("\n"),
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it("follows a node:module namespace assigned by an exported constructor", () => {
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/loader.ts": [
            `import * as nodeModule from "node:module";`,
            "export class Holder { module: typeof nodeModule; constructor() { this.module = nodeModule; } }",
          ].join("\n"),
          "src/domain/evil.ts": [
            `import { Holder } from "./loader";`,
            "const load = new Holder().module.createRequire(import.meta.url);",
            `export const value = load("@infra/store");`,
          ].join("\n"),
        }),
      );
      expect(v.map((z) => `${z.fromLayer}->${z.toLayer}`)).toContain(
        "domain->unresolved",
      );
    });

    it("allows project-owned capabilities exported through another module", () => {
      const project = inMemoryProject({
        "src/domain/capability.ts": [
          "export const nodeModule = {",
          "  createRequire: () => (specifier: string) => specifier,",
          "};",
        ].join("\n"),
        "src/domain/consumer.ts": [
          `import { nodeModule } from "./capability";`,
          "const load = nodeModule.createRequire();",
          `export const value = load("@infra/store");`,
        ].join("\n"),
        "src/contracts/capability.ts": [
          "export const Clock = { now: () => 1 };",
          "export const formatter = { format: () => 'safe' };",
        ].join("\n"),
        "src/contracts/consumer.ts": [
          `import { Clock, formatter } from "./capability";`,
          "export const values = [Clock.now(), formatter.format()];",
        ].join("\n"),
      });
      expect(detectLayerViolations(project)).toEqual([]);
      expect(detectContractsExternalImportViolations(project)).toEqual([]);
    });

    it("invalidates cached module references after a source edit", () => {
      const project = inMemoryProject({
        "src/domain/subject.ts": "export const value = 1;",
      });
      const subject = project.getSourceFileOrThrow("src/domain/subject.ts");
      expect(moduleReferences(subject)).toEqual([]);
      subject.replaceWithText(
        `import { value } from "@infra/store";\nexport { value };`,
      );
      expect(detectLayerViolations(project).map((violation) =>
        `${violation.fromLayer}->${violation.toLayer}`
      )).toContain("domain->infrastructure");
    });

    it("invalidates cached container writes after a source edit", () => {
      const project = inMemoryProject({
        "src/domain/subject.ts": [
          "class Holder { static module: unknown; }",
          "Holder.module = { createRequire: () => () => 1 };",
          "const load = (Holder.module as { createRequire(): Function }).createRequire();",
          `export const value = load("@infra/store");`,
        ].join("\n"),
      });
      expect(detectLayerViolations(project)).toEqual([]);
      project.getSourceFileOrThrow("src/domain/subject.ts").replaceWithText([
        `import * as nodeModule from "node:module";`,
        "class Holder { static module: typeof nodeModule; }",
        "Object.assign(Holder, { module: nodeModule });",
        "const load = Holder.module.createRequire(import.meta.url);",
        `export const value = load("@infra/store");`,
      ].join("\n"));
      expect(detectLayerViolations(project).map((violation) =>
        `${violation.fromLayer}->${violation.toLayer}`
      )).toContain("domain->unresolved");
    });

    it("uses the latest write when a destructured reflection binding is overwritten", () => {
      const project = inMemoryProject({
        "src/domain/fine.ts": `
          import * as nodeModule from "node:module";
          let read: Function;
          ({ get: read } = Reflect);
          read = Object.getPrototypeOf;
          read(nodeModule, "createRequire");
        `,
      });
      const source = project.getSourceFileOrThrow("src/domain/fine.ts");
      expect(moduleReferences(source).filter((reference) =>
        reference.kind === "create-require"
      )).toEqual([]);
    });

    it("fails closed when a reflected accessor has a conditionally reaching safe replacement", () => {
      const project = inMemoryProject({
        "src/domain/evil.ts": `
          import * as nodeModule from "node:module";
          let read: Function = Reflect.get;
          if (Math.random()) read = Object.getPrototypeOf;
          const load = read(nodeModule, "createRequire")(import.meta.url);
          export const value = load("@infra/store");
        `,
      });
      const source = project.getSourceFileOrThrow("src/domain/evil.ts");
      expect(moduleReferences(source).some((reference) =>
        reference.kind === "create-require"
      )).toBe(true);
    });

    it("does not classify a statically different node:module property as createRequire", () => {
      const project = inMemoryProject({
        "src/domain/fine.ts": `
          import * as nodeModule from "node:module";
          Object.getOwnPropertyDescriptor(nodeModule, "builtinModules");
        `,
      });
      expect(moduleReferences(project.getSourceFileOrThrow("src/domain/fine.ts"))
        .filter((reference) => reference.kind === "create-require")).toEqual([]);
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

    it.each([
      [
        "bind",
        [
          "const get = process.getBuiltinModule.bind(process);",
          `const load = get("node:module").createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "call",
        [
          `const namespace = process.getBuiltinModule.call(process, "node:module");`,
          `const load = namespace.createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "the globalThis namespace",
        [
          `const load = globalThis.process.getBuiltinModule("node:module").createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "an aliased globalThis-namespaced receiver",
        [
          "const platform = globalThis.process;",
          `const load = platform.getBuiltinModule("node:module").createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "a destructured globalThis-namespaced receiver",
        [
          "const { process: platform } = globalThis as any;",
          `const load = platform.getBuiltinModule("node:module").createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "an assignment-destructured globalThis-namespaced receiver",
        [
          "let platform: any;",
          "({ process: platform = {} } = globalThis as any);",
          `const load = platform.getBuiltinModule("node:module").createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "a conditionally reassigned ambient receiver",
        [
          "const local = { getBuiltinModule: (value: string) => value };",
          "let platform: any = process;",
          "if (false) platform = local;",
          `export const value = platform.getBuiltinModule("node:module");`,
        ].join("\n"),
      ],
      [
        "a closure-visible later ambient reassignment",
        [
          "const local = { getBuiltinModule: (value: string) => value };",
          "let platform: any = local;",
          `export const value = () => platform.getBuiltinModule("node:module");`,
          "platform = process;",
        ].join("\n"),
      ],
      [
        "a computed globalThis member",
        [
          `const load = globalThis["process"].getBuiltinModule("node:module").createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "destructuring",
        [
          "const { getBuiltinModule } = process;",
          `const load = getBuiltinModule("node:module").createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "aliased destructuring",
        [
          "const { getBuiltinModule: acquire } = globalThis.process;",
          `const load = acquire("node:module").createRequire(import.meta.url);`,
          `export const value = load("@infra/store");`,
        ].join("\n"),
      ],
      [
        "a parameter default",
        [
          "function load(platform = process) {",
          `  return platform.getBuiltinModule("node:module");`,
          "}",
          "export const value = load();",
        ].join("\n"),
      ],
      [
        "a parameter supplied at a call site",
        [
          "function load(platform: typeof process) {",
          `  return platform.getBuiltinModule("node:module");`,
          "}",
          "export const value = load(process);",
        ].join("\n"),
      ],
      [
        "a type-aliased parameter supplied at a call site",
        [
          "type Platform = typeof process;",
          "function load(platform: Platform) {",
          `  return platform.getBuiltinModule("node:module");`,
          "}",
          "export const value = load(process);",
        ].join("\n"),
      ],
      [
        "a returned ambient receiver",
        [
          "function platform(): typeof process { return process; }",
          `export const value = platform().getBuiltinModule("node:module");`,
        ].join("\n"),
      ],
      [
        "a conditionally reassigned computed member",
        [
          `let member: "getBuiltinModule" | "cwd" = "getBuiltinModule";`,
          `if (false) member = "cwd";`,
          `export const value = (process as any)[member]("node:module");`,
        ].join("\n"),
      ],
      [
        "an unresolved computed member",
        [
          "function load(member: string) {",
          `  return (process as any)[member]("node:module");`,
          "}",
          `export const value = load("getBuiltinModule");`,
        ].join("\n"),
      ],
      [
        "nested destructuring",
        [
          "const { process: { getBuiltinModule } } = globalThis;",
          `export const value = getBuiltinModule("node:module");`,
        ].join("\n"),
      ],
      [
        "nested assignment destructuring",
        [
          "let getBuiltinModule: (name: string) => unknown;",
          "({ process: { getBuiltinModule } } = globalThis);",
          `export const value = getBuiltinModule("node:module");`,
        ].join("\n"),
      ],
    ])("ambient getBuiltinModule cannot bypass the layer fence through %s", (_name, source) => {
      const v = detectLayerViolations(
        inMemoryProject({ "src/domain/evil.ts": source }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<non-literal get-builtin-module>",
      );
    });

    it("a local getBuiltinModule-shaped value remains an allowed lookalike", () => {
      // NON-VACUOUS pair for the companion above: widening acquisition to the
      // globalThis and destructured spellings must not widen it to a project-owned
      // property that merely shares the name.
      const v = detectLayerViolations(
        inMemoryProject({
          "src/domain/ok.ts": [
            "const process = {",
            "  getBuiltinModule: {",
            "    bind: () => () => ({ createRequire: () => (value: string) => value }),",
            "    call: () => ({ createRequire: () => (value: string) => value }),",
            "  },",
            "};",
            "export const bound = process.getBuiltinModule.bind(process);",
            `export const called = process.getBuiltinModule.call(process, "local");`,
            "const { getBuiltinModule } = process;",
            "export const destructured = getBuiltinModule.call(process);",
            "let platform = process;",
            "if (false) platform = { getBuiltinModule: (value: string) => value };",
            `export const conditional = platform.getBuiltinModule("local");`,
            "function parameter(local = process) { return local.getBuiltinModule.call(process); }",
            "type LocalPlatform = { getBuiltinModule(value: string): string };",
            "function supplied(local: LocalPlatform) { return local.getBuiltinModule('local'); }",
            "export function returned(): LocalPlatform { return { getBuiltinModule: (value) => value }; }",
            "export const returnedValue = returned().getBuiltinModule('local');",
            "function expose() { return { createRequire: () => (value: string) => value }; }",
            "export const localLoader = expose().createRequire();",
            "export const parameterValue = parameter();",
            "export const suppliedValue = supplied(process);",
            "const nested = { process };",
            "const { process: { getBuiltinModule: nestedAcquire } } = nested;",
            "export const nestedValue = nestedAcquire.call(process);",
          ].join("\n"),
        }),
      );
      expect(v).toEqual([]);
    });

    it("traces structurally typed loader parameters to every call source", () => {
      const violations = detectLayerViolations(
        inMemoryProject({
          "src/domain/evil.ts": [
            "type Platform = { getBuiltinModule(name: string): unknown };",
            "function load(platform: Platform) {",
            `  return platform.getBuiltinModule("node:module");`,
            "}",
            "export const value = load(process);",
          ].join("\n"),
        }),
      );
      expect(violations.map((violation) => violation.specifier)).toContain(
        "<non-literal get-builtin-module>",
      );
    });

    it("fails closed on an externally supplied structural loader", () => {
      const violations = detectLayerViolations(
        inMemoryProject({
          "src/domain/evil.ts": [
            "type Platform = { getBuiltinModule(name: string): unknown };",
            "export function load(platform: Platform) {",
            `  return platform.getBuiltinModule("node:module");`,
            "}",
          ].join("\n"),
        }),
      );
      expect(violations.map((violation) => violation.specifier)).toContain(
        "<non-literal get-builtin-module>",
      );
    });

    it("retains loader provenance through object, array, and property writes", () => {
      const violations = detectLayerViolations(
        inMemoryProject({
          "src/domain/evil.ts": [
            "const holder = { platform: process };",
            "const values = [process] as const;",
            "const reassigned = { platform: { getBuiltinModule: (name: string) => name } };",
            "reassigned.platform = process;",
            `export const one = holder.platform.getBuiltinModule("node:module");`,
            `export const two = values[0].getBuiltinModule("node:module");`,
            `export const three = reassigned.platform.getBuiltinModule("node:module");`,
          ].join("\n"),
        }),
      );
      expect(
        violations.filter(
          (violation) =>
            violation.specifier === "<non-literal get-builtin-module>",
        ),
      ).toHaveLength(3);
    });

    it("uses every possible namespace source for createRequire", () => {
      const violations = detectLayerViolations(
        inMemoryProject({
          "src/domain/evil.ts": [
            "const flag = Boolean(0);",
            "const local = { createRequire: (_url: URL) => (value: string) => value };",
            `const api = flag ? local : require("node:module");`,
            "export const load = api.createRequire(import.meta.url);",
          ].join("\n"),
        }),
      );
      expect(violations.map((violation) => violation.specifier)).toContain(
        "<non-literal create-require>",
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
      ["fetch('https://example.test')", ["<platform-global fetch>"]],
      ["Buffer.from('x')", ["<platform-global Buffer>"]],
      [
        "process.getBuiltinModule('fs')",
        ["<non-literal get-builtin-module>", "<platform-global process>"],
      ],
      ["globalThis.fetch('https://example.test')", ["<platform-global fetch>"]],
    ])(
      "implicit platform global %s cannot evade contracts isolation",
      (expression, expected) => {
        const v = detectContractsExternalImportViolations(
          inMemoryProject({
            "src/contracts/evil.ts": `export const forbidden = ${expression};`,
          }),
        );
        // Assert the EXACT specifier set, not merely "something fired at line 1" -
        // a count-only check passes on an unrelated detector once the intended one
        // stops firing.
        expect([...new Set(v.map((violation) => violation.specifier))].sort()).toEqual(
          [...expected].sort(),
        );
        expect(v.every((violation) => violation.line === 1)).toBe(true);
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

    it.each([
      [
        "aliased Reflect.get",
        [
          "const get = Reflect.get;",
          `const Ctor = get(() => undefined, "constructor");`,
          `export const value = Ctor("return 1")();`,
        ].join("\n"),
      ],
      [
        "construct-only receiver",
        `export const value = (class {}).constructor("return 1")();`,
      ],
      [
        "aliased ambient Function",
        `const Ctor = Function;\nexport const value = new Ctor("return 1")();`,
      ],
      [
        "globalThis member",
        `export const value = globalThis["Function"]("return 1")();`,
      ],
      [
        "aliased computed key",
        [
          `const key = "constructor";`,
          "const Ctor = (() => {})[key];",
          `export const value = Ctor("return 1")();`,
        ].join("\n"),
      ],
      [
        "destructured globalThis member",
        [
          "const { Function: Ctor } = globalThis;",
          `export const value = Ctor("return 1")();`,
        ].join("\n"),
      ],
      [
        "computed destructured Reflect.get",
        [
          `const { ["get"]: get } = Reflect;`,
          `const Ctor = get(() => undefined, "constructor");`,
          `export const value = Ctor("return 1")();`,
        ].join("\n"),
      ],
      [
        "shorthand destructured constructor",
        [
          "const { constructor } = (() => {});",
          `export const value = constructor("return 1")();`,
        ].join("\n"),
      ],
      [
        "shorthand assignment-destructured constructor",
        [
          "let constructor: any;",
          "({ constructor } = (() => {}));",
          `export const value = constructor("return 1")();`,
        ].join("\n"),
      ],
      [
        "shorthand destructured globalThis Function",
        [
          "const { Function } = globalThis;",
          `export const value = Function("return 1")();`,
        ].join("\n"),
      ],
      [
        "bound ambient Function",
        `export const value = Function.bind(null)("return 1")();`,
      ],
      [
        "indirect ambient eval",
        `export const value = (0, eval)("1");`,
      ],
      [
        "ambient Function as a value",
        "export const factory = Function;",
      ],
      [
        "unprovable constructor receiver",
        [
          "const prototype = Object.getPrototypeOf(async function () {});",
          `export const value = prototype.constructor("return 1")();`,
        ].join("\n"),
      ],
      [
        "nested destructured Reflect.get",
        [
          "const { Reflect: { get } } = globalThis;",
          `const Ctor = get(() => undefined, "constructor");`,
          `export const value = Ctor("return 1")();`,
        ].join("\n"),
      ],
      [
        "nested assignment-destructured Reflect.get",
        [
          "let get: typeof Reflect.get;",
          "({ Reflect: { get } } = globalThis);",
          `const Ctor = get(() => undefined, "constructor");`,
          `export const value = Ctor("return 1")();`,
        ].join("\n"),
      ],
      [
        "ambient constructor descriptor",
        [
          "const descriptor = Object.getOwnPropertyDescriptor(",
          "  Object.getPrototypeOf(async function () {}),",
          `  "constructor",`,
          ");",
          `export const value = descriptor!.value("return 1")();`,
        ].join("\n"),
      ],
    ])("dynamic-code recovery through %s is rejected", (_name, source) => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": source }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<dynamic-code capability>",
      );
    });

    it.each([
      ["direct clock", "export const value = Date.now();"],
      ["direct randomness", "export const value = Math.random();"],
      [
        "destructured clock",
        "const { now } = Date;\nexport const value = now();",
      ],
      [
        "aliased randomness",
        "const random = Math.random;\nexport const value = random();",
      ],
      [
        "constructed clock",
        "export const value = new Date().toISOString();",
      ],
      ["called clock", "export const value = Date();"],
      ["called clock with an argument", "export const value = Date(0);"],
      [
        "globalThis-namespaced clock",
        "export const value = globalThis.Date.now();",
      ],
      [
        "globalThis-namespaced randomness",
        "export const value = globalThis.Math.random();",
      ],
      [
        "destructured globalThis clock",
        "const { Date: Clock } = globalThis;\nexport const value = Clock.now();",
      ],
      [
        "assignment-destructured globalThis clock",
        [
          "let Clock: DateConstructor;",
          "({ Date: Clock = class {} as unknown as DateConstructor } = globalThis);",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "computed destructured clock",
        `const { ["now"]: now } = Date;\nexport const value = now();`,
      ],
      [
        "assignment-destructured clock",
        [
          "let now = () => 0;",
          "({ now } = Date);",
          "export const value = now();",
        ].join("\n"),
      ],
      [
        "conditionally reassigned ambient clock",
        [
          "class LocalClock { static now() { return 1; } }",
          "let Clock = Date;",
          "if (false) Clock = LocalClock as unknown as DateConstructor;",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "ambient destructuring default",
        [
          "const empty = {} as { Date?: DateConstructor };",
          "const { Date: Clock = Date } = empty;",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "closure-visible later ambient clock",
        [
          "class LocalClock { static now() { return 1; } }",
          "let Clock: DateConstructor | typeof LocalClock = LocalClock;",
          "export const value = () => Clock.now();",
          "Clock = Date;",
        ].join("\n"),
      ],
      [
        "conditional-expression ambient clock",
        [
          "class LocalClock { static now() { return 1; } }",
          "const Clock = false ? LocalClock : Date;",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "logical-assignment ambient clock",
        [
          "class LocalClock { static now() { return 1; } }",
          "let Clock: DateConstructor | typeof LocalClock | undefined = LocalClock;",
          "Clock ||= Date;",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "array-bound ambient clock",
        "const [Clock] = [Date];\nexport const value = Clock.now();",
      ],
      [
        "array-parameter ambient clock",
        [
          "function read([Clock] = [Date]) { return Clock.now(); }",
          "export const value = read();",
        ].join("\n"),
      ],
      [
        "nested-bound ambient clock",
        [
          "const { clocks: { Date: Clock } } = { clocks: globalThis };",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "array-assigned ambient clock",
        [
          "let Clock: DateConstructor;",
          "([Clock] = [Date]);",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "nested-assigned ambient clock",
        [
          "let Clock: DateConstructor;",
          "({ clocks: { Date: Clock } } = { clocks: globalThis });",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "shorthand assignment-default ambient clock",
        [
          "let Clock: DateConstructor;",
          "({ Clock = Date } = {} as { Clock?: DateConstructor });",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "empty-spread constructed clock",
        "export const value = new Date(...([] as [])).toISOString();",
      ],
      [
        "local-time component constructed clock",
        "export const value = new Date(2026, 6, 29).toISOString();",
      ],
      [
        "local-time string constructed clock",
        `export const value = new Date("2026-07-29T12:00:00").toISOString();`,
      ],
      [
        "conditionally reassigned computed clock member",
        [
          `let member: "now" | "parse" = "now";`,
          `if (false) member = "parse";`,
          "export const value = Date[member];",
        ].join("\n"),
      ],
      [
        "unresolved computed clock member",
        [
          "function read(member: string) { return (Date as any)[member]; }",
          `export const value = read("now");`,
        ].join("\n"),
      ],
      [
        "supplied ambient clock parameter",
        [
          "function read(Clock: DateConstructor) { return Clock.now(); }",
          "export const value = read(Date);",
        ].join("\n"),
      ],
      [
        "type-aliased ambient clock parameter",
        [
          "type Clock = DateConstructor;",
          "function read(Clock: Clock) { return Clock.now(); }",
          "export const value = read(Date);",
        ].join("\n"),
      ],
      [
        "returned ambient clock",
        [
          "function clock(): DateConstructor { return Date; }",
          "export const value = clock().now();",
        ].join("\n"),
      ],
      [
        "nested destructured randomness",
        [
          "const { Math: { random } } = globalThis;",
          "export const value = random();",
        ].join("\n"),
      ],
      [
        "nested assignment-destructured randomness",
        [
          "let random: () => number;",
          "({ Math: { random } } = globalThis);",
          "export const value = random();",
        ].join("\n"),
      ],
      [
        "conditionally keyed destructured clock",
        [
          `let member: "now" | "parse" = "now";`,
          `if (false) member = "parse";`,
          "const { [member]: clockMember } = Date;",
          "export const value = clockMember;",
        ].join("\n"),
      ],
      [
        "structurally typed ambient clock parameter",
        [
          "type LocalClock = { now(): number };",
          "function read(Clock: LocalClock) { return Clock.now(); }",
          "export const value = read(Date);",
        ].join("\n"),
      ],
      [
        "unresolved structurally typed clock parameter",
        [
          "type LocalClock = { now(): number };",
          "export function read(Clock: LocalClock) { return Clock.now(); }",
        ].join("\n"),
      ],
      [
        "direct call through an ambient clock parameter",
        [
          "function read(Clock: DateConstructor) { return Clock(0); }",
          "export const value = read(Date);",
        ].join("\n"),
      ],
      [
        "direct call through an unresolved clock parameter",
        "export function read(Clock: DateConstructor) { return Clock(0); }",
      ],
      [
        "clock retained in an object",
        [
          "const holder = { Clock: Date };",
          "export const value = holder.Clock.now();",
        ].join("\n"),
      ],
      [
        "clock retained in an array",
        [
          "const values = [Date] as const;",
          "export const value = values[0].now();",
        ].join("\n"),
      ],
      [
        "clock written to a property",
        [
          "const holder = { Clock: class { static now() { return 1; } } };",
          "holder.Clock = Date;",
          "export const value = holder.Clock.now();",
        ].join("\n"),
      ],
      [
        "ambient clock subclass",
        [
          "class Clock extends Date {}",
          "export const value = Clock.now();",
        ].join("\n"),
      ],
      [
        "ambient formatter subclass",
        [
          "class Formatter extends Intl.DateTimeFormat {}",
          "export const value = new Formatter().format();",
        ].join("\n"),
      ],
      [
        "clock retained in a static class property",
        [
          "class Holder { static Clock = Date; }",
          "export const value = Holder.Clock.now();",
        ].join("\n"),
      ],
      [
        "formatter retained in a static class property",
        [
          "class Holder { static formatter = new Intl.DateTimeFormat(); }",
          "export const value = Holder.formatter.format();",
        ].join("\n"),
      ],
      [
        "formatter assigned to a static class property",
        [
          "class Holder { static formatter: Intl.DateTimeFormat; }",
          "Holder.formatter = new Intl.DateTimeFormat();",
          "export const value = Holder.formatter.format();",
        ].join("\n"),
      ],
      [
        "clock pushed into an array",
        [
          "const clocks: DateConstructor[] = [];",
          "clocks.push(Date);",
          "export const value = clocks[0]!.now();",
        ].join("\n"),
      ],
      [
        "clock stored through Map.set",
        [
          "const clocks = new Map<string, DateConstructor>();",
          `clocks.set("primary", Date);`,
          `export const value = clocks.get("primary")!.now();`,
        ].join("\n"),
      ],
      [
        "clock copied through Object.assign",
        [
          "const holder: { Clock?: DateConstructor } = {};",
          "Object.assign(holder, { Clock: Date });",
          "export const value = holder.Clock!.now();",
        ].join("\n"),
      ],
      [
        "clock installed through Object.defineProperty",
        [
          "const holder: { Clock?: DateConstructor } = {};",
          `Object.defineProperty(holder, "Clock", { value: Date });`,
          "export const value = holder.Clock!.now();",
        ].join("\n"),
      ],
      [
        "clock installed through Reflect.set",
        [
          "const holder: { Clock?: DateConstructor } = {};",
          `Reflect.set(holder, "Clock", Date);`,
          "export const value = holder.Clock!.now();",
        ].join("\n"),
      ],
      [
        "clock assigned in a static block",
        [
          "class Holder {",
          "  static Clock: DateConstructor;",
          "  static { this.Clock = Date; }",
          "}",
          "export const value = Holder.Clock.now();",
        ].join("\n"),
      ],
      [
        "clock retained in a static class getter",
        [
          "class Holder { static get Clock() { return Date; } }",
          "export const value = Holder.Clock.now();",
        ].join("\n"),
      ],
      [
        "formatter retained in a static class getter",
        [
          "class Holder { static get formatter() { return new Intl.DateTimeFormat(); } }",
          "export const value = Holder.formatter.format();",
        ].join("\n"),
      ],
      [
        "clock retained in an instance class property",
        [
          "class Holder { Clock = Date; }",
          "export const value = new Holder().Clock.now();",
        ].join("\n"),
      ],
      [
        "formatter retained in an instance class getter",
        [
          "class Holder { get formatter() { return new Intl.DateTimeFormat(); } }",
          "export const value = new Holder().formatter.format();",
        ].join("\n"),
      ],
      [
        "clock assigned in an instance constructor",
        [
          "class Holder { Clock: DateConstructor; constructor() { this.Clock = Date; } }",
          "export const value = new Holder().Clock.now();",
        ].join("\n"),
      ],
      [
        "formatter retained in a parameter property",
        [
          "class Holder { constructor(public formatter = new Intl.DateTimeFormat()) {} }",
          "export const value = new Holder().formatter.format();",
        ].join("\n"),
      ],
      [
        "formatter retained through Object.freeze",
        [
          "const formatter = Object.freeze(new Intl.DateTimeFormat());",
          "export const value = formatter.format();",
        ].join("\n"),
      ],
      [
        "formatter returned by an object method",
        [
          "const holder = { formatter() { return new Intl.DateTimeFormat(); } };",
          "export const value = holder.formatter().format();",
        ].join("\n"),
      ],
      [
        "formatter returned by an object getter",
        [
          "const holder = { get formatter() { return new Intl.DateTimeFormat(); } };",
          "export const value = holder.formatter.format();",
        ].join("\n"),
      ],
      [
        "formatter returned by an unresolved object method",
        [
          "declare const holder: { formatter(): Intl.DateTimeFormat };",
          "export const value = holder.formatter().format();",
        ].join("\n"),
      ],
      [
        "formatter supplied through an unresolved ambient parameter",
        "export function format(value: Intl.DateTimeFormat) { return value.format(); }",
      ],
      [
        "Intl formatRange output",
        "export const value = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).formatRange(0, 1);",
      ],
      [
        "Intl formatRangeToParts output",
        "export const value = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).formatRangeToParts(0, 1);",
      ],
      [
        "Intl resolved options",
        "export const value = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions();",
      ],
      [
        "Intl supported locales",
        "export const value = Intl.DateTimeFormat.supportedLocalesOf(['en-US']);",
      ],
      [
        "implicit Intl format instant",
        "export const value = new Intl.DateTimeFormat().format();",
      ],
      [
        "implicit Intl formatToParts instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "export const value = formatter.formatToParts(undefined);",
        ].join("\n"),
      ],
      [
        "aliased implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "const format = formatter.format;",
          "export const value = format();",
        ].join("\n"),
      ],
      [
        "container-held implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "const holder = { format: formatter.formatToParts };",
          "export const value = holder.format();",
        ].join("\n"),
      ],
      [
        "destructured implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "const { format } = formatter;",
          "export const value = format();",
        ].join("\n"),
      ],
      [
        "array-held implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "const holder = [formatter.formatToParts] as const;",
          "export const value = holder[0]();",
        ].join("\n"),
      ],
      [
        "property-written implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "const holder: { format?: typeof formatter.format } = {};",
          "holder.format = formatter.format;",
          "export const value = holder.format();",
        ].join("\n"),
      ],
      [
        "returned implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "function expose() { return formatter.formatToParts; }",
          "export const value = expose()();",
        ].join("\n"),
      ],
      [
        "call-wrapped implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "export const value = formatter.format.call(formatter);",
        ].join("\n"),
      ],
      [
        "apply-wrapped implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "export const value = formatter.formatToParts.apply(formatter, []);",
        ].join("\n"),
      ],
      [
        "Reflect.apply-wrapped implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "export const value = Reflect.apply(formatter.format, formatter, []);",
        ].join("\n"),
      ],
      [
        "bound implicit Intl format instant",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "const format = formatter.format.bind(formatter);",
          "export const value = format();",
        ].join("\n"),
      ],
      [
        "apply argument list with an empty reaching assignment",
        [
          "const formatter = new Intl.DateTimeFormat();",
          "export function format(condition: boolean) {",
          "  let args: [number] | [] = [0];",
          "  if (condition) args = [];",
          "  return formatter.format.apply(formatter, args);",
          "}",
        ].join("\n"),
      ],
      [
        "Date call wrapper",
        "export const value = Date.call(null);",
      ],
      [
        "Date apply wrapper",
        "export const value = Date.apply(null, []);",
      ],
      [
        "Date bind wrapper",
        "export const value = Date.bind(null)();",
      ],
      [
        "extracted Date call wrapper",
        "const invoke = Date.call; export const value = invoke(null);",
      ],
      [
        "extracted Date apply wrapper",
        "const invoke = Date.apply; export const value = invoke(null, []);",
      ],
      [
        "extracted Date bind wrapper",
        "const bind = Date.bind; export const value = bind(null)();",
      ],
      [
        "Reflect.apply Date wrapper",
        "export const value = Reflect.apply(Date, null, []);",
      ],
      [
        "Reflect.construct Date wrapper",
        "export const value = Reflect.construct(Date, []);",
      ],
      [
        "Intl number formatting",
        "export const value = new Intl.NumberFormat('en-US').format(1000);",
      ],
      [
        "Intl collation",
        "export const value = new Intl.Collator('en-US').compare('a', 'b');",
      ],
      [
        "Date locale formatting",
        "export const value = new Date(0).toLocaleString('en-US', { timeZone: 'UTC' });",
      ],
      [
        "Date timezone offset",
        "export const value = new Date(0).getTimezoneOffset();",
      ],
      [
        "legacy Date year",
        "export const value = new Date(0).getYear();",
      ],
      [
        "Date parser",
        "export const value = Date.parse('2026-08-05');",
      ],
      [
        "reflected Date prototype method",
        [
          `const method = Object.getOwnPropertyDescriptor(Date.prototype, "getFullYear")!.value;`,
          "export const value = method.call(new Date(0));",
        ].join("\n"),
      ],
      [
        "Reflect-acquired Date prototype method",
        [
          `const method = Reflect.getOwnPropertyDescriptor(Date.prototype, "getFullYear")!.value;`,
          "export const value = method.call(new Date(0));",
        ].join("\n"),
      ],
      [
        "bulk-acquired Date prototype methods",
        [
          "const methods = Object.getOwnPropertyDescriptors(Date.prototype);",
          "export const value = methods.getFullYear!.value.call(new Date(0));",
        ].join("\n"),
      ],
      [
        "typed Intl number formatter",
        "export function format(value: Intl.NumberFormat) { return value.format(1000); }",
      ],
      [
        "generic Intl formatter constraint",
        "export function format<T extends Intl.DateTimeFormat>(value: T) { return value.format(); }",
      ],
      [
        "Intl number formatter subclass",
        "class Formatter extends Intl.NumberFormat {} export const value = new Formatter().format(1000);",
      ],
      [
        "Date subclass timezone offset",
        "class LocalDate extends Date {} export const value = new LocalDate(0).getTimezoneOffset();",
      ],
      [
        "string locale comparison",
        `export const value = "ä".localeCompare("z");`,
      ],
      [
        "number locale formatting",
        "export const value = (1234).toLocaleString();",
      ],
      [
        "bigint locale formatting",
        "export const value = 1234n.toLocaleString();",
      ],
      [
        "string locale lowercasing",
        `export const value = "I".toLocaleLowerCase("tr");`,
      ],
      [
        "string locale uppercasing",
        `export const value = "i".toLocaleUpperCase("tr");`,
      ],
    ])("ambient nondeterminism is rejected: %s", (_name, source) => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({ "src/contracts/evil.ts": source }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it.each([
      [
        "clock",
        "export const Clock = Date;",
        "export const value = Clock.now();",
      ],
      [
        "formatter",
        "export const formatter = new Intl.DateTimeFormat();",
        "export const value = formatter.format();",
      ],
    ])("follows an exported ambient %s across modules", (_name, exported, used) => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts": exported,
          "src/contracts/barrel.ts": `export { ${_name === "clock" ? "Clock" : "formatter"} } from "./capability";`,
          "src/contracts/evil.ts": [
            `import { ${_name === "clock" ? "Clock" : "formatter"} } from "./barrel";`,
            used,
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it("follows a mutation-held ambient clock across modules", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts": [
            "export const clocks: DateConstructor[] = [];",
            "clocks.push(Date);",
          ].join("\n"),
          "src/contracts/evil.ts": [
            `import { clocks } from "./capability";`,
            "export const value = clocks[0]!.now();",
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it.each([
      [
        "clock",
        "export const Clock = Date;",
        "export const value = caps.Clock.now();",
      ],
      [
        "formatter",
        "export const formatter = new Intl.DateTimeFormat();",
        "export const value = caps.formatter.format();",
      ],
    ])("follows a namespace-imported ambient %s across modules", (
      _name,
      exported,
      used,
    ) => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts": exported,
          "src/contracts/barrel.ts": `export * from "./capability";`,
          "src/contracts/evil.ts": [
            `import * as caps from "./barrel";`,
            used,
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it.each([
      [
        "clock",
        "export class Holder { static Clock = Date; }",
        "export const value = Holder.Clock.now();",
      ],
      [
        "formatter",
        "export class Holder { static formatter = new Intl.DateTimeFormat(); }",
        "export const value = Holder.formatter.format();",
      ],
    ])("follows an exported static ambient %s across modules", (
      _name,
      exported,
      used,
    ) => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts": exported,
          "src/contracts/evil.ts": [
            `import { Holder } from "./capability";`,
            used,
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it("follows an exported instance formatter across modules", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts":
            "export class Holder { formatter = new Intl.DateTimeFormat(); }",
          "src/contracts/evil.ts": [
            `import { Holder } from "./capability";`,
            "export const value = new Holder().formatter.format();",
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it("follows an exported constructor-assigned formatter across modules", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts": [
            "export class Holder {",
            "  formatter: Intl.DateTimeFormat;",
            "  constructor() { this.formatter = new Intl.DateTimeFormat(); }",
            "}",
          ].join("\n"),
          "src/contracts/evil.ts": [
            `import { Holder } from "./capability";`,
            "export const value = new Holder().formatter.format();",
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it("follows an exported Date invocation wrapper across modules", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts": "export const invoke = Date.call;",
          "src/contracts/evil.ts": [
            `import { invoke } from "./capability";`,
            "export const value = invoke(null);",
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it("follows a namespace-exported Date invocation wrapper", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts": "export const invoke = Date.call;",
          "src/contracts/barrel.ts": `export * from "./capability";`,
          "src/contracts/evil.ts": [
            `import * as capability from "./barrel";`,
            "export const value = capability.invoke(null);",
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it.each([
      [
        "default clock",
        "export default Date;",
        "import Clock from \"./capability\";\nexport const value = Clock.now();",
      ],
      [
        "default formatter",
        "export default new Intl.DateTimeFormat();",
        "import formatter from \"./capability\";\nexport const value = formatter.format();",
      ],
      [
        "export-equals clock",
        "export = Date;",
        "import Clock = require(\"./capability\");\nexport const value = Clock.now();",
      ],
      [
        "export-equals formatter",
        "export = new Intl.DateTimeFormat();",
        "import formatter = require(\"./capability\");\nexport const value = formatter.format();",
      ],
    ])("follows an ambient %s export assignment", (_name, exported, used) => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/capability.ts": exported,
          "src/contracts/evil.ts": used,
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it("rejects explicit Intl instants through invocation wrappers", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/ok.ts": [
            "const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });",
            "function explicitApplied(condition: boolean) {",
            "  let assignedArgs: [number] = [0];",
            "  if (condition) assignedArgs = [1];",
            "  return formatter.format.apply(formatter, assignedArgs);",
            "}",
            "const bound = formatter.format.bind(formatter, 0);",
            "export const values = [",
            "  formatter.format.call(formatter, 0),",
            "  formatter.formatToParts.apply(formatter, [0]),",
            "  Reflect.apply(formatter.format, formatter, [0]),",
            "  explicitApplied(true),",
            "  bound(),",
            "];",
          ].join("\n"),
        }),
      );
      expect(v.map((violation) => violation.specifier)).toContain(
        "<nondeterministic platform-global>",
      );
    });

    it("local dynamic-code and nondeterminism lookalikes remain allowed", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/ok.ts": [
            "const Reflect = { get: (_value: unknown, key: string) => key };",
            "const Date = Object.assign((_value?: unknown) => 'safe', { now: () => 1 });",
            "const invokeDate = Date.call;",
            "const Math = { random: () => 0.5 };",
            "const Function = (value: string) => () => value;",
            "const eval = (value: string) => value;",
            "const model = { constructor: () => 7 };",
            "type LocalClock = { now(): number };",
            "function suppliedClock(Clock: LocalClock) { return Clock.now(); }",
            "function returnedClock(): LocalClock { return { now: () => 3 }; }",
            "type CallableClock = ((value: number) => string) & { now(): number };",
            "function callClock(Clock: CallableClock) { return Clock(0); }",
            "const callableClock = Object.assign((value: number) => String(value), { now: () => 4 });",
            `let localMember: "now" | "parse" = "now";`,
            `if (false) localMember = "parse";`,
            "const globals = {",
            "  Date: { now: () => 2 },",
            "  Math: { random: () => 0.25 },",
            "  process: { getBuiltinModule: (value: string) => value },",
            "};",
            "const { Date: Clock, process: platform } = globals;",
            "const { Math: { random: nestedRandom } } = globals;",
            "let nestedAssignedRandom = () => 0.75;",
            "({ Math: { random: nestedAssignedRandom } } = globals);",
            "let AssignedClock = globals.Date;",
            "let assignedPlatform = globals.process;",
            "({ Date: AssignedClock, process: assignedPlatform } = globals);",
            "const { now } = Date;",
            "const { constructor: ctor } = model;",
            // The SHORTHAND spelling names a new local, so the source property has
            // to be resolved through the receiver - reading the local would call
            // every ambient member project-declared, and every project member ambient.
            "const { constructor } = model;",
            "export const values = [",
            `  Reflect.get({}, "constructor"),`,
            "  Date.now(),",
            "  Math.random(),",
            `  Function("safe")(),`,
            `  Function.bind(null)("safe")(),`,
            `  (0, eval)("safe"),`,
            "  Date(0),",
            "  invokeDate(null, 0),",
            "  model.constructor(),",
            "  now(),",
            "  ctor(),",
            "  constructor(),",
            "  Clock.now(),",
            `  platform.getBuiltinModule("local"),`,
            "  AssignedClock.now(),",
            `  assignedPlatform.getBuiltinModule("local"),`,
            "  suppliedClock(globals.Date),",
            "  returnedClock().now(),",
            "  nestedRandom(),",
            "  nestedAssignedRandom(),",
            "  Date[localMember],",
            "  callClock(callableClock),",
            "];",
          ].join("\n"),
        }),
      );
      expect(v).toEqual([]);
    });

    it("project-owned clocks remain allowed through mutable carriers", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/ok.ts": [
            "const Clock = { now: () => 1 };",
            "const clocks: Array<typeof Clock> = [];",
            "clocks.push(Clock);",
            "const assigned: { Clock?: typeof Clock } = {};",
            "Object.assign(assigned, { Clock });",
            "const described: { Clock?: typeof Clock } = {};",
            `Object.defineProperty(described, "Clock", { value: Clock });`,
            "const reflected: { Clock?: typeof Clock } = {};",
            `Reflect.set(reflected, "Clock", Clock);`,
            "class Holder {",
            "  static Clock: typeof Clock;",
            "  static { this.Clock = Clock; }",
            "}",
            `const describedMethod = Object.getOwnPropertyDescriptor(Clock, "now")!.value;`,
            "export const values = [",
            "  clocks[0]!.now(),",
            "  assigned.Clock!.now(),",
            "  described.Clock!.now(),",
            "  reflected.Clock!.now(),",
            "  Holder.Clock.now(),",
            "  describedMethod(),",
            "];",
          ].join("\n"),
        }),
      );
      expect(v).toEqual([]);
    });

    it("local reflection and Intl lookalikes remain allowed", () => {
      const violations = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/ok.ts": [
            "const Object = {",
            "  getPrototypeOf: (value: unknown) => value,",
            "  getOwnPropertyDescriptor: (_value: unknown, _key: string) => ({ value: () => 1 }),",
            "};",
            "const Intl = {",
            "  DateTimeFormat: class {",
            "    format() { return 'safe'; }",
            "    formatToParts() { return []; }",
            "  },",
            "  NumberFormat: class { format() { return 'safe'; } },",
            "  Collator: class { compare() { return 0; } },",
            "};",
            "const text = { localeCompare: () => 0, toLocaleLowerCase: () => 'safe' };",
            "const localNumberLike = { toLocaleString: () => '1000' };",
            `export const descriptor = Object.getOwnPropertyDescriptor({}, "constructor")!.value();`,
            "export const formatted = new Intl.DateTimeFormat().format();",
            "export const number = new Intl.NumberFormat().format();",
            "export const compared = new Intl.Collator().compare();",
            "export const localText = [text.localeCompare(), text.toLocaleLowerCase()];",
            "export const localNumber = localNumberLike.toLocaleString();",
          ].join("\n"),
        }),
      );
      expect(violations).toEqual([]);
    });

    it("non-ES globals cannot be hidden from contracts diagnostics", () => {
      const violations = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/evil.ts": [
            "export const first = (globalThis as any).process.cwd();",
            "// @ts-ignore",
            "export const second = process.cwd();",
          ].join("\n"),
        }),
      );
      expect(
        violations.filter(
          (violation) =>
            violation.specifier === "<platform-global process>",
        ),
      ).toHaveLength(2);
    });

    it("all-local conditional and default provenance remains allowed", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/ok.ts": [
            "class FirstClock { static now() { return 1; } }",
            "class SecondClock { static now() { return 2; } }",
            "let Clock = FirstClock;",
            "if (false) Clock = SecondClock;",
            "let LogicalClock: typeof FirstClock | typeof SecondClock | undefined = FirstClock;",
            "LogicalClock ||= SecondClock;",
            "const ConditionalClock = false ? FirstClock : SecondClock;",
            "const empty = {} as { Date?: typeof FirstClock };",
            "const { Date: DefaultClock = FirstClock } = empty;",
            "function read(ParameterClock = FirstClock) { return ParameterClock.now(); }",
            "function readArray([ParameterClock] = [FirstClock]) { return ParameterClock.now(); }",
            "const [ArrayClock] = [FirstClock];",
            "const { clocks: { Date: NestedClock } } = { clocks: { Date: SecondClock } };",
            "let AssignedClock = FirstClock;",
            "([AssignedClock] = [SecondClock]);",
            "let NestedAssignedClock = FirstClock;",
            "({ clocks: { Date: NestedAssignedClock } } = { clocks: { Date: SecondClock } });",
            "let AssignmentDefaultClock = FirstClock;",
            "({ AssignmentDefaultClock = SecondClock } = {} as { AssignmentDefaultClock?: typeof SecondClock });",
            "export const values = [Clock.now(), LogicalClock.now(), ConditionalClock.now(), DefaultClock.now(), read(), readArray(), ArrayClock.now(), NestedClock.now(), AssignedClock.now(), NestedAssignedClock.now(), AssignmentDefaultClock.now()];",
          ].join("\n"),
        }),
      );
      expect(v).toEqual([]);
    });

    it("a pinned-instant Date and a plain destructuring assignment stay allowed", () => {
      const v = detectContractsExternalImportViolations(
        inMemoryProject({
          "src/contracts/ok.ts": [
            "let left = 1;",
            "let right = 2;",
            "({ left, right } = { left: 3, right: 4 });",
            `const instant = "2020-01-01T00:00:00.000Z" as const;`,
            `export const pinned = new Date("2020-01-01T00:00:00.000Z").toISOString();`,
            "export const pinnedAlias = new Date(instant).toISOString();",
            `export const offset = new Date("2020-01-01T05:30:00+05:30").toISOString();`,
            "export const epoch = new Date(0).toISOString();",
            "export const reflectedEpoch = Reflect.construct(Date, [0]).toISOString();",
            "export const boundEpoch = new (Date.bind(null, 0))().toISOString();",
            `const deterministicMember = "UTC" as const;`,
            "export const deterministic = globalThis.Date[deterministicMember];",
            "export const values = [left, right];",
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

    it("every supported source extension remains shipped and dependency-enforced", () => {
      expect(
        isShippedSourceFilePath(join(SRC_ROOT, "contracts", "evil.d.ts")),
      ).toBe(true);
      expect(
        isShippedSourceFilePath(join(SRC_ROOT, "contracts", "evil.mts")),
      ).toBe(true);
      expect(
        isShippedSourceFilePath(join(SRC_ROOT, "contracts", "evil.cts")),
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
