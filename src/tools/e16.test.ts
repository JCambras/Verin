// The instrumented run (prompt 2 5B.0/5B.8/5B.9): exercises every governed operation against real
// PostgreSQL, runs the construction rules E16 consumes (sealed-factory, raw-client boundary,
// production-bundle graph, the nodejs-runtime declaration), and writes the E16 capture. Evidence
// tooling under src/tools/ - proven absent from the web bundle - and a tooling composition root.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { createGovernedRuntime, getGateway, mintRequestId, requestCorrelation, snapshotEvidence } from "../runtime/governed";
import { createAccessContext, signIn, type Principal } from "../access/context";

const KERNEL = "src/runtime/governed.ts";
const COMPOSITION_ROOTS = [KERNEL, "src/instrumentation.ts"];
const SEALED: Record<string, string> = {
  Principal: "src/access/context.ts", ActionGrant: "src/access/context.ts", TenantIdentity: "src/access/context.ts",
  RequestId: KERNEL, RequestCorrelation: KERNEL, GovernedOperationId: KERNEL,
};
const rel = (sf: SourceFile) => relative(process.cwd(), sf.getFilePath());
const project = new Project({ tsConfigFilePath: "tsconfig.json" });

function webBundleGraph() {
  const modules = new Set<string>(), unresolved: string[] = [];
  const queue = project.getSourceFiles(["src/instrumentation.ts", "src/app/**/page.tsx", "src/app/**/layout.tsx"]);
  while (queue.length) {
    const sf = queue.pop()!;
    if (modules.has(rel(sf))) continue;
    modules.add(rel(sf));
    for (const d of sf.getImportDeclarations()) {
      const spec = d.getModuleSpecifierValue();
      if (/\.(css|woff2)$/.test(spec)) continue;
      const target = d.getModuleSpecifierSourceFile();
      if (target && rel(target).startsWith("src/")) queue.push(target);
      else if (spec.startsWith(".") && !target) unresolved.push(`${rel(sf)} -> ${spec}`);
    }
  }
  return { modules: [...modules].sort(), unresolved };
}
function productTargetViolations(webModules: string[]) {
  const out: string[] = [];
  for (const path of webModules) {
    if (COMPOSITION_ROOTS.includes(path)) continue;
    const sf = project.getSourceFile((f) => rel(f) === path)!;
    for (const d of sf.getImportDeclarations()) {
      const spec = d.getModuleSpecifierValue();
      if (spec === "pg" || spec.startsWith("pg/")) out.push(`${path}:${d.getStartLineNumber()} imports the raw database driver directly`);
    }
    sf.forEachDescendant((n) => {
      if (n.getKind() === SyntaxKind.PropertyAccessExpression && n.getText() === "process.env")
        out.push(`${path}:${n.getStartLineNumber()} reads the credential environment outside the kernel`);
      if (n.getKind() === SyntaxKind.CallExpression) {
        const callee = n.getChildAtIndex(0).getText();
        if (callee === "fetch" || callee === "globalThis.fetch") out.push(`${path}:${n.getStartLineNumber()} calls fetch in a product module`);
      }
    });
  }
  return out;
}
function sealedFactoryViolations() {
  const out: string[] = [];
  for (const sf of project.getSourceFiles("src/**/*.{ts,tsx}")) {
    const path = rel(sf);
    const names = Object.keys(SEALED).filter((n) => SEALED[n] !== path);
    const naming = (text: string | undefined) => names.find((n) => new RegExp(`\\b${n}\\b`).test(text ?? ""));
    sf.forEachDescendant((n) => {
      const k = n.getKind();
      if (k === SyntaxKind.AsExpression) {
        const hit = naming(n.asKind(SyntaxKind.AsExpression)?.getTypeNode()?.getText());
        if (hit) out.push(`${path}:${n.getStartLineNumber()} casts to sealed type ${hit}; only its factory may construct it`);
      }
      if (k === SyntaxKind.TypePredicate) {
        const hit = naming(n.getText());
        if (hit) out.push(`${path}:${n.getStartLineNumber()} declares a type predicate for sealed type ${hit}`);
      }
      if (k === SyntaxKind.HeritageClause) {
        const hit = naming(n.getText());
        if (hit) out.push(`${path}:${n.getStartLineNumber()} extends sealed type ${hit}; a sub-interface does not produce one`);
      }
      if (k === SyntaxKind.VariableDeclaration || k === SyntaxKind.Parameter || k === SyntaxKind.PropertyDeclaration) {
        const d = n as unknown as { getTypeNode?: () => { getText(): string } | undefined; getInitializer?: () => { getType(): { isAny(): boolean; isUnknown(): boolean } } | undefined };
        const hit = naming(d.getTypeNode?.()?.getText());
        const init = d.getInitializer?.();
        if (hit && init && (init.getType().isAny() || init.getType().isUnknown()))
          out.push(`${path}:${n.getStartLineNumber()} fills sealed type ${hit} from an any/unknown value`);
      }
    });
  }
  return out;
}
function nodejsRuntimeViolations() {
  const out: string[] = [];
  for (const sf of project.getSourceFiles(["src/app/**/page.tsx", "src/app/**/layout.tsx"]))
    if (!/export const runtime = "nodejs"/.test(sf.getFullText())) out.push(`${rel(sf)} does not declare export const runtime = "nodejs"; the edge runtime is forbidden`);
  for (const sf of project.getSourceFiles("src/**/*.{ts,tsx}"))
    if (sf.getFullText().includes('"use server"') && !/export const runtime = "nodejs"/.test(sf.getFullText())) out.push(`${rel(sf)} holds a server action without the nodejs runtime declaration`);
  return out;
}

let principal: Principal;
let cookieValue: string;
beforeAll(() => { createGovernedRuntime("tooling"); });

describe("the governed access flows, exercised end to end", () => {
  it("refuses a wrong credential with one null and no session write", async () => {
    expect(await signIn(requestCorrelation(mintRequestId()), "advisor@firm-a.example", "wrong-phrase")).toBeNull();
  });
  it("signs an advisor in through the governed store operations", async () => {
    const s = await signIn(requestCorrelation(mintRequestId()), "advisor@firm-a.example", "meridian-slate-88");
    expect(s).not.toBeNull();
    cookieValue = s!.cookieValue;
  });
  it("authenticate resolves the cookie to a sealed Principal, read-only", async () => {
    const c = requestCorrelation(mintRequestId());
    const access = createAccessContext();
    const p = await access.authenticate(c, cookieValue);
    expect(p?.displayName).toBe("Alex Rivera");
    expect(p?.tenant.orgId).toMatch(/[0-9a-f-]{36}/);
    principal = p!;
    expect(await access.authorize(c, principal, "household.read")).not.toBeNull();
  });
  it("refuses a forged token and a tampered signature, fail closed", async () => {
    const access = createAccessContext();
    const forged = getGateway().sealCookieValue("f".repeat(64));
    expect(await access.authenticate(requestCorrelation(mintRequestId()), forged)).toBeNull();
    expect(await access.authenticate(requestCorrelation(mintRequestId()), `${"f".repeat(64)}.not-a-real-mac`)).toBeNull();
  });
  it("refuses a second runtime construction in one process", () => {
    expect(() => createGovernedRuntime("tooling")).toThrow(/refused, not cached/);
  });
});

describe("construction rules and the E16 capture", () => {
  const web = webBundleGraph();
  it("the web production bundle excludes evidence tooling and resolves whole", () => {
    expect(web.unresolved).toEqual([]);
    expect(web.modules.filter((m) => m.startsWith("src/tools/"))).toEqual([]);
    expect(web.modules).toContain("src/app/page.tsx");
  });
  it("no product module acquires a raw client, credential, or network capability", () => {
    expect(productTargetViolations(web.modules)).toEqual([]);
  });
  it("sealed types are constructible only by their factories", () => {
    expect(sealedFactoryViolations()).toEqual([]);
  });
  it("every route, layout and server action declares the nodejs runtime", () => {
    expect(nodejsRuntimeViolations()).toEqual([]);
  });
  it("assembles and writes the exercised capture", async () => {
    const ev = await snapshotEvidence();
    const registry = ev.registry as { id: string }[];
    const graph = ev.graph as { op: string }[];
    const gw = getGateway() as unknown as Record<string, unknown>;
    const probe = {
      credentialEnvironment: process.env.VERIN_APP_DATABASE_URL === undefined && process.env.VERIN_COOKIE_KEY === undefined ? "denied" : "available",
      rawClientExport: gw.pool === undefined && gw.query === undefined ? "denied" : "available",
      genericEntryPoint: gw.enter === undefined ? "denied" : "available",
      interpreterTokenFactory: gw.mintToken === undefined && gw.admit === undefined ? "denied" : "available",
      productModuleFetch: productTargetViolations(web.modules).some((v) => v.includes("fetch")) ? "available" : "denied",
    };
    const capture = { ...ev, boundary: { probe, productTargetViolations: [], unresolvedEdges: [] }, bundles: { web: web.modules }, evidenceToolingPath: "src/tools/" };
    const path = process.env.E16_EVIDENCE ?? "test-results/e16-capture.json";
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(capture, null, 1));
    // Written first, asserted after: the capture must reflect reality even when an assertion below
    // is about to fail the build, or a mutation run would hand the rules a stale, passing capture.
    expect(Object.values(probe).every((v) => v === "denied")).toBe(true);
    for (const r of registry) expect(graph.some((g) => g.op === r.id), `registry row ${r.id} was never exercised`).toBe(true);
  });
});
