import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, Node, type SourceFile } from "ts-morph";
import { relative } from "node:path";
import { walk, REPO_ROOT, inMemoryProject } from "./_fence-utils";
import { DATA_DICTIONARY, type FieldSpec } from "@domain/schema/dictionary";

/**
 * METRIC-PROVENANCE FENCE (charter #3; ADR-0022; closes Vale V12 — the
 * displayed-metric->source provenance trace). Two complementary AST rules that,
 * with the type system, make every metric-class value render with a visible
 * source/asOf label:
 *
 *  RULE A — renderer contract. The sanctioned metric-class surfaces (`<Metric>`,
 *    `<FreshValue>`) must each declare their provenance-bearing prop as REQUIRED.
 *    If one is made optional or removed, the type-system half is silently hollowed
 *    out — this rule fails the build (a "detection is not verification" guard on the
 *    type enforcement itself).
 *
 *  RULE B — no naked metric render. A metric-class field (derived from the data
 *    dictionary's `display: "metric"` flag) may NOT appear in JSX child position
 *    (rendered as text) anywhere in the app EXCEPT inside a sanctioned renderer.
 *    Extracting a metric out of its provenance envelope and rendering it naked
 *    (`<td>{account.balanceMinorUnits}</td>`) is the exact bypass Vale V12 named;
 *    this rule catches it with file:line. Metric values pass provenance because they
 *    flow to `<Metric metric={…}>` as an ATTRIBUTE, never as a naked child.
 *
 * The type system carries the primary guarantee (a `DisplayMetric` is not a
 * `ReactNode`, and `<Metric>` requires provenance); this fence guards the two seams
 * the type system alone cannot: contract erosion (A) and the naked bypass (B).
 */

// The ONLY surfaces allowed to unwrap a metric for display, and the required
// provenance-bearing prop each must keep. Curated on purpose: adding a metric
// renderer means adding it here (and to EXEMPT_FILES), where review sees it.
interface RendererSpec {
  readonly file: string;
  readonly component: string;
  readonly requiredProp: string;
  readonly propTypeIncludes: string;
}
const SANCTIONED_RENDERERS: readonly RendererSpec[] = [
  { file: "src/app/presentation/metric.tsx", component: "Metric", requiredProp: "metric", propTypeIncludes: "DisplayMetric" },
  { file: "src/app/presentation/fresh-value.tsx", component: "FreshValue", requiredProp: "provenance", propTypeIncludes: "RecordProvenance" },
];
// Files exempt from RULE B — the sanctioned renderers themselves must read the value.
const EXEMPT_FILES = new Set(SANCTIONED_RENDERERS.map((r) => r.file));

/** The metric-class field registry, DERIVED from the dictionary's `display` flag (not hand-listed). */
export function metricFieldNames(dictionary: Record<string, Record<string, FieldSpec>>): Set<string> {
  const names = new Set<string>();
  for (const fields of Object.values(dictionary)) {
    for (const [field, spec] of Object.entries(fields)) {
      if (spec.display === "metric") names.add(field);
    }
  }
  return names;
}

/** RULE A: a sanctioned renderer must declare `requiredProp` as a required prop of the right type. */
export function rendererContractViolations(sf: SourceFile, spec: RendererSpec): string[] {
  const fn = sf.getFunction(spec.component);
  if (!fn) return [`${spec.component}: sanctioned renderer not found (renamed/removed?) in ${spec.file}`];
  const typeNode = fn.getParameters()[0]?.getTypeNode();
  if (!typeNode || !Node.isTypeLiteral(typeNode)) return [`${spec.component}: props are not an inline object type (cannot verify the provenance prop)`];
  const prop = typeNode.getProperties().find((p) => p.getName() === spec.requiredProp);
  if (!prop) return [`${spec.component}: required '${spec.requiredProp}' prop is missing`];
  if (prop.hasQuestionToken()) return [`${spec.component}: '${spec.requiredProp}' prop is OPTIONAL — a metric could render without provenance`];
  const t = prop.getTypeNode()?.getText() ?? "";
  if (!t.includes(spec.propTypeIncludes)) return [`${spec.component}: '${spec.requiredProp}' type '${t}' must carry ${spec.propTypeIncludes}`];
  return [];
}

/** Every same-file `const/let x = <init>` binding, by name (function-local included). */
function localInitializers(sf: SourceFile): Map<string, Node> {
  const map = new Map<string, Node>();
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer();
    if (init && !map.has(vd.getName())) map.set(vd.getName(), init);
  }
  return map;
}

/**
 * Does `node` render a metric field? True if it is/contains an identifier named as a
 * metric field (covers `a.balanceMinorUnits`, a destructured `{balanceMinorUnits}`,
 * and a bare identifier), OR a same-file alias whose initializer does (one+ hop,
 * cycle-guarded). Returns the offending field name, or null.
 */
function referencesMetricField(node: Node, locals: Map<string, Node>, metric: Set<string>, seen: Set<string>): string | null {
  const idents = Node.isIdentifier(node) ? [node] : node.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const id of idents) if (metric.has(id.getText())) return id.getText();
  // element access with a string-literal metric key: obj["balanceMinorUnits"]
  for (const ea of node.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const arg = ea.getArgumentExpression();
    if (arg?.getKind() === SyntaxKind.StringLiteral && metric.has(arg.getText().slice(1, -1))) return arg.getText().slice(1, -1);
  }
  // alias resolution: follow same-file `const x = <metric expr>` one or more hops.
  for (const id of idents) {
    const name = id.getText();
    if (seen.has(name)) continue;
    seen.add(name);
    const init = locals.get(name);
    if (init) {
      const hit = referencesMetricField(init, locals, metric, seen);
      if (hit) return hit;
    }
  }
  return null;
}

/** RULE B: metric fields rendered in JSX child position (not through a sanctioned renderer). */
export function nakedMetricRenders(sf: SourceFile, rel: string, metric: Set<string>): string[] {
  const out: string[] = [];
  const locals = localInitializers(sf);
  for (const jsxExpr of sf.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const parentKind = jsxExpr.getParent()?.getKind();
    // Skip attribute positions (`prop={…}` / `{...spread}`) — only rendered CHILDREN count.
    if (parentKind === SyntaxKind.JsxAttribute || parentKind === SyntaxKind.JsxSpreadAttribute) continue;
    const inner = jsxExpr.getExpression();
    if (!inner) continue;
    const hit = referencesMetricField(inner, locals, metric, new Set());
    if (hit) out.push(`${rel}:${jsxExpr.getStartLineNumber()} :: metric field '${hit}' rendered without provenance (route it through <Metric>/<FreshValue>)`);
  }
  return out;
}

function appProject(): Project {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  for (const f of walk(`${REPO_ROOT}src/app`, (f) => f.endsWith(".tsx"))) project.addSourceFileAtPath(f);
  return project;
}

describe("metric-provenance fence", () => {
  const fields = metricFieldNames(DATA_DICTIONARY);

  it("derived-completeness: the dictionary declares at least one metric field (else the fence is vacuous)", () => {
    // A zero-size registry means the `display: "metric"` flag went stale and RULE B
    // could never fire — fail loudly rather than pass vacuously (charter #4).
    expect(fields.size, "no field marked display:'metric' in the data dictionary").toBeGreaterThan(0);
  });

  it("RULE A: every sanctioned metric renderer keeps its provenance prop REQUIRED", () => {
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    const offenders: string[] = [];
    for (const spec of SANCTIONED_RENDERERS) {
      const sf = project.addSourceFileAtPath(`${REPO_ROOT}${spec.file}`);
      offenders.push(...rendererContractViolations(sf, spec));
    }
    expect(offenders, `renderer contract broken:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("RULE B: no metric field is rendered in JSX without provenance", () => {
    const offenders: string[] = [];
    for (const sf of appProject().getSourceFiles()) {
      const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
      if (EXEMPT_FILES.has(rel)) continue;
      offenders.push(...nakedMetricRenders(sf, rel, fields));
    }
    expect(offenders, `naked metric renders (charter #3 / Vale V12):\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): contract erosion and naked renders are caught", () => {
    const metric = new Set(["balanceMinorUnits"]);
    const file = (src: string) => inMemoryProject({ "/src/app/x/page.tsx": src }).getSourceFiles()[0]!;

    it("RULE A flags an OPTIONAL provenance prop", () => {
      const sf = inMemoryProject({ "/f.tsx": `export function FreshValue({ provenance }: { provenance?: RecordProvenance }) { return null; }` }).getSourceFiles()[0]!;
      const v = rendererContractViolations(sf, SANCTIONED_RENDERERS[1]!);
      expect(v[0]).toContain("OPTIONAL");
    });
    it("RULE A flags a MISSING provenance prop", () => {
      const sf = inMemoryProject({ "/f.tsx": `export function FreshValue({ children }: { children: unknown }) { return null; }` }).getSourceFiles()[0]!;
      expect(rendererContractViolations(sf, SANCTIONED_RENDERERS[1]!)[0]).toContain("missing");
    });
    it("RULE A passes a REQUIRED provenance prop of the right type", () => {
      const sf = inMemoryProject({ "/f.tsx": `export function FreshValue({ provenance }: { provenance: RecordProvenance }) { return null; }` }).getSourceFiles()[0]!;
      expect(rendererContractViolations(sf, SANCTIONED_RENDERERS[1]!)).toEqual([]);
    });
    it("RULE B flags a naked member-access metric render (<td>{account.balanceMinorUnits}</td>)", () => {
      const sf = file(`export default function P(){ const account = {} as any; return <table><tbody><tr><td>{account.balanceMinorUnits}</td></tr></tbody></table>; }`);
      expect(nakedMetricRenders(sf, "src/app/x/page.tsx", metric).length).toBe(1);
    });
    it("RULE B flags a destructured bare-identifier metric render", () => {
      const sf = file(`export default function P(){ const { balanceMinorUnits } = {} as any; return <span>{balanceMinorUnits}</span>; }`);
      expect(nakedMetricRenders(sf, "src/app/x/page.tsx", metric).length).toBe(1);
    });
    it("RULE B flags a ONE-HOP alias metric render (const bal = a.balanceMinorUnits; {bal})", () => {
      const sf = file(`export default function P(){ const a = {} as any; const bal = a.balanceMinorUnits; return <span>{bal}</span>; }`);
      expect(nakedMetricRenders(sf, "src/app/x/page.tsx", metric).length).toBe(1);
    });
    it("RULE B PASSES a metric passed as an attribute to <Metric> (provenance preserved)", () => {
      const sf = file(`export default function P(){ const a = {} as any; return <Metric metric={metric(a.balanceMinorUnits, "currency-minor", a.provenance)} />; }`);
      expect(nakedMetricRenders(sf, "src/app/x/page.tsx", metric)).toEqual([]);
    });
    it("RULE B ignores a non-metric child (<span>{a.name}</span>)", () => {
      const sf = file(`export default function P(){ const a = {} as any; return <span>{a.name}</span>; }`);
      expect(nakedMetricRenders(sf, "src/app/x/page.tsx", metric)).toEqual([]);
    });
    it("derives the balanceMinorUnits registry from the real dictionary", () => {
      expect(metricFieldNames(DATA_DICTIONARY).has("balanceMinorUnits")).toBe(true);
    });
  });
});
