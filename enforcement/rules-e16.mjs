// enforcement/rules-e16.mjs - E16 governed-runtime observability: the six comparisons of section 5B.5 over
// a real exercised run's capture, plus the sealed correlation contract and the boundary-evidence checks.
// The proof is runtime, never source shape: the checker reads what the subject's own instrumented test run
// emitted (registry, admission and constructed definitions, runtime invocations, independently captured
// raw executions, exercised graph, emissions, boundary and bundle evidence), from E16_EVIDENCE or
// evidence/e16-capture.json. A tree with no governed code and no registry delta passes honestly; a tree
// that has governed code but supplies no capture fails closed. SemanticEffectId is always re-derived here
// from versioned canonical bytes - an id copied from the registry cannot conceal different executed bytes.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const v = (ref, message) => ({ rule: "E16", ref, message });
const EFFECT = ["store", "provider", "external"], NON_EFFECT = ["use-case", "module-operation", "flow-step"];
const KIND_FIELDS = { RequestCorrelation: ["requestId"], DecisionCorrelation: ["requestId", "decisionId"], ProposalCorrelation: ["requestId", "proposalId"], RunCorrelation: ["runId"] };
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const SHAPES = {
  "prepared-query": ["statementName", "canonicalSql", "parameters", "resultValidator", "cardinality", "transactionClass", "authorityClass"],
  "closed-store-command": ["command", "inputValidator", "resultValidator", "transactionClass", "authorityClass"],
  "provider-action": ["provider", "action", "method", "endpointTemplate", "requestConstructor", "responseValidator", "authorityClass"],
};
const PII_FORMS = [["bare-account-reference", /\b\d{8,16}\b/], ["spaced-account-reference", /\b\d{2,4}( \d{2,4}){2,}\b/], ["hyphenated-account-reference", /\b\d{2,4}(-\d{2,4}){2,}\b/]];
// GD-003 sharpening: the runtime's own minted correlation ids (16/32 unbroken hex) are excluded from
// account-reference candidacy in correlation-key positions ONLY - by exact value from the capture's
// minted list, shape-bounded, so a genuine account reference in any form anywhere else (and any value
// in a non-correlation key) keeps full sensitivity. Cures the ~4 percent all-digit-hex flake.
const CORRELATION_KEYS = new Set(["requestId", "traceId", "spanId"]);
const MINTED_ID_SHAPE = /^[0-9a-f]{16}$|^[0-9a-f]{32}$/;

function canonicalize(x, path, problems) {
  if (typeof x === "string") { if (x === "") problems.push(`${path} is empty`); return JSON.stringify(x); }
  if (typeof x === "number" || typeof x === "boolean") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map((e, i) => canonicalize(e, `${path}[${i}]`, problems)).join(",") + "]";
  if (x && typeof x === "object") {
    if (x.$function) problems.push(`${path} is function-valued`);
    if (x.$callerControlled) problems.push(`${path} is caller-controlled`);
    if (x.$unresolved) problems.push(`${path} is unresolved`);
    const keys = Object.keys(x).sort();
    if (keys.length === 0) problems.push(`${path} is empty`);
    return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonicalize(x[k], `${path}.${k}`, problems)}`).join(",") + "}";
  }
  problems.push(`${path} is not closed data (${typeof x})`); return "null";
}

function deriveSemanticEffectId(def, problems = []) {
  const shape = SHAPES[def?.kind];
  if (!shape) { problems.push(`kind '${def?.kind}' is not in the closed effect union`); return null; }
  for (const f of shape) if (!(f in def)) problems.push(`required field '${f}' is missing`);
  for (const f of Object.keys(def)) if (f !== "kind" && !shape.includes(f)) problems.push(`unknown field '${f}'`);
  if (def.kind === "provider-action" && !HTTP.includes(def.method)) problems.push(`method '${def.method}' is not a closed HTTP method`);
  const bytes = "semfx.v1|" + canonicalize(def, "definition", problems);
  return problems.length ? null : "semfx.v1:" + createHash("sha256").update(bytes).digest("hex");
}

function findGovernedSource(dir = "src") {
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) { const hit = findGovernedSource(p); if (hit) return hit; }
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && /createGovernedRuntime|GovernedOperationRegistry/.test(readFileSync(p, "utf8"))) return p;
  }
  return null;
}

export function e16GovernedRuntimeObservability() {
  const path = process.env.E16_EVIDENCE ?? "evidence/e16-capture.json";
  if (!existsSync(path)) {
    const src = findGovernedSource();
    return src ? [v(src, "governed-runtime source exists but no E16 capture was supplied; a rule that cannot see the thing it governs is not a rule; failing closed")] : [];
  }
  let ev; try { ev = JSON.parse(readFileSync(path, "utf8")); } catch { return [v(path, "the E16 capture is unparseable; failing closed")]; }
  const out = [];
  const reg = new Map((ev.registry ?? []).map((r) => [r.id, r]));
  if (reg.size === 0) return (ev.graph ?? []).length ? [v(path, "an exercised graph exists but the registry is empty; every exercised operation must be registered")] : [];
  if ((ev.graph ?? []).length === 0) return [v(path, "the registry is non-empty but the capture holds zero telemetry and an empty graph; the flow was never exercised at all")];
  const derived = new Map();
  for (const r of reg.values()) {
    if (!EFFECT.includes(r.class) && !NON_EFFECT.includes(r.class)) { out.push(v(r.id, `class '${r.class}' is not one of the six governed classes`)); continue; }
    if (EFFECT.includes(r.class)) {
      if (!r.semanticEffect || !r.semanticEffectId) { out.push(v(r.id, `effect-bearing class '${r.class}' row is missing its required semanticEffect/semanticEffectId`)); continue; }
      const problems = [];
      const id = deriveSemanticEffectId(r.semanticEffect, problems);
      for (const p of problems) out.push(v(r.id, `semantic-effect definition rejected before construction: ${p}`));
      if (id && id !== r.semanticEffectId) out.push(v(r.id, `registry semanticEffectId ${r.semanticEffectId} does not equal the derived id ${id}; ids are derived, never handwritten`));
      if (id) derived.set(r.id, id);
    } else if (r.semanticEffect || r.semanticEffectId) out.push(v(r.id, `non-effect class '${r.class}' row carries a semantic-effect field, which is forbidden there`));
    if (!(r.correlation in KIND_FIELDS)) out.push(v(r.id, `correlation kind '${r.correlation}' is not in the sealed contract`));
    if (ev.correlationTable && ev.correlationTable[r.id] !== r.correlation) out.push(v(r.id, `registry declares correlation '${r.correlation}' but the prompt-owned table says '${ev.correlationTable?.[r.id]}'`));
  }
  const adm = new Map((ev.admission ?? []).map((a) => [a.id, a]));
  for (const r of reg.values()) {
    const a = adm.get(r.id);
    if (!a) { out.push(v(r.id, "registry row has no admission-table entry; the bijection is broken")); continue; }
    if (a.gatewayEntry !== r.gatewayEntry) out.push(v(r.id, `admitted gateway symbol '${a.gatewayEntry}' differs from the registry's '${r.gatewayEntry}'`));
    if (EFFECT.includes(r.class)) {
      const problems = [], cid = a.constructedDefinition ? deriveSemanticEffectId(a.constructedDefinition, problems) : null;
      if (!a.constructedDefinition) out.push(v(r.id, "effect-bearing admission entry has no independently constructed definition"));
      else if (problems.length) for (const p of problems) out.push(v(r.id, `constructed definition rejected: ${p}`));
      else if (cid !== derived.get(r.id)) out.push(v(r.id, `constructed definition digest ${cid} does not equal the registry definition digest ${derived.get(r.id)}; the canonical-byte comparison refuses construction`));
    } else if (a.constructedDefinition || a.semanticEffectId) out.push(v(r.id, "non-effect admission entry carries a semantic-effect field, which fails as an extra"));
  }
  for (const id of adm.keys()) if (!reg.has(id)) out.push(v(id, "admission-table entry names no registry row; the bijection is broken"));
  const seen = new Set([...adm.values()].map((a) => a.gatewayEntry));
  if (seen.size !== adm.size) out.push(v("admission", "two rows admit the same gateway symbol; the admission table must be a bijection"));
  const nodes = new Map();
  for (const g of ev.graph ?? []) {
    if (nodes.has(g.node)) out.push(v(g.node, "duplicate graph node id"));
    nodes.set(g.node, g);
    const r = reg.get(g.op);
    if (!r) { out.push(v(g.node, `exercised operation '${g.op}' is absent from the typed registry`)); continue; }
    if (g.gatewayEntry !== r.gatewayEntry) out.push(v(g.node, `operation '${g.op}' was entered through '${g.gatewayEntry}', not its admitted '${r.gatewayEntry}'`));
    if (EFFECT.includes(r.class) && g.semanticEffectId !== derived.get(g.op)) out.push(v(g.node, `graph node for '${g.op}' carries semanticEffectId ${g.semanticEffectId}, expected ${derived.get(g.op)}`));
    if (!EFFECT.includes(r.class) && g.semanticEffectId) out.push(v(g.node, `non-effect node for '${g.op}' carries a semantic-effect id`));
    const parentOp = g.parent === "entry" ? "entry" : nodes.get(g.parent)?.op ?? "unknown";
    if (!(r.permittedParents ?? []).includes(parentOp)) out.push(v(g.node, `operation '${g.op}' ran under parent '${parentOp}', not in its declared permittedParents`));
    const fields = g.correlation?.fields ?? {};
    if (g.correlation?.kind !== r.correlation) out.push(v(g.node, `operation '${g.op}' was entered with correlation '${g.correlation?.kind}', declared '${r.correlation}'`));
    for (const f of KIND_FIELDS[r.correlation] ?? []) {
      if (!fields[f]?.value) out.push(v(g.node, `correlation for '${g.op}' is missing required field '${f}'; the runtime fails closed`));
      else if (fields[f].purpose !== f) out.push(v(g.node, `correlation field '${f}' carries purpose tag '${fields[f].purpose}'; a value cannot pose as another identifier`));
    }
  }
  for (const r of reg.values()) {
    if ([...nodes.values()].some((g) => g.op === r.id)) continue;
    if (!r.unreachableInSlice) out.push(v(r.id, "registered operation was never exercised and carries no unreachableInSlice classification; a one-directional register proves nothing about the side it does not read"));
  }
  const mkey = (x) => `${x.op}|${x.gatewayEntry}|${x.semanticEffectId}`;
  const count = (list) => { const m = new Map(); for (const x of list) m.set(mkey(x), (m.get(mkey(x)) ?? 0) + 1); return m; };
  const effNodes = [...nodes.values()].filter((g) => EFFECT.includes(reg.get(g.op)?.class));
  const sets = { invocations: count((ev.invocations ?? []).filter((i) => EFFECT.includes(reg.get(i.op)?.class ?? "external"))), rawExecutions: count(ev.rawExecutions ?? []), graph: count(effNodes) };
  for (const [a, b] of [["invocations", "rawExecutions"], ["rawExecutions", "graph"]])
    for (const k of new Set([...sets[a].keys(), ...sets[b].keys()]))
      if (sets[a].get(k) !== sets[b].get(k)) out.push(v(k, `${a} count ${sets[a].get(k) ?? 0} != ${b} count ${sets[b].get(k) ?? 0}; every raw effect goes through its exact operation-specific gateway entry`));
  for (const x of ev.rawExecutions ?? []) {
    const r = reg.get(x.op);
    if (r && !EFFECT.includes(r.class)) { out.push(v(x.op, `a raw execution is attributed to non-effect class '${r.class}'; it has no legal multiset row and cannot hide beneath its parent`)); continue; }
    if (x.canonicalBytes && "semfx.v1:" + createHash("sha256").update(x.canonicalBytes).digest("hex") !== x.semanticEffectId)
      out.push(v(x.op, `raw-execution bytes do not reproduce ${x.semanticEffectId}; an id copied from the registry cannot conceal different executed bytes`));
  }
  const em = ev.emissions ?? {};
  const metricFor = (id) => `${ev.namingPattern?.replace("{id}", id)}`;
  for (const r of reg.values()) {
    const opNodes = [...nodes.values()].filter((g) => g.op === r.id);
    if (opNodes.length === 0) continue;
    // Metrics aggregate across an instrument, so per-node attribution is the sum: N nodes owe a total of N.
    const total = (em.metrics ?? []).filter((m) => m.name === `${metricFor(r.id)}.${r.metric}`).reduce((n, m) => n + (m.value ?? 0), 0);
    if (total !== opNodes.length) out.push(v(r.id, `operation '${r.id}' has ${opNodes.length} exercised node(s) but its required metric '${r.metric}' recorded a total of ${total}; exactly once per node is required (metric)`));
  }
  for (const g of nodes.values()) {
    const r = reg.get(g.op); if (!r) continue;
    const spans = (em.spans ?? []).filter((s) => s.node === g.node);
    if (spans.filter((s) => s.completed).length !== 1) out.push(v(g.node, `operation '${g.op}' has ${spans.filter((s) => s.completed).length} completed span(s); exactly one is required (span)`));
    if ((em.logs ?? []).filter((l) => l.node === g.node).length !== 1) out.push(v(g.node, `operation '${g.op}' emitted ${(em.logs ?? []).filter((l) => l.node === g.node).length} structured log record(s); exactly one is required (log)`));
  }
  const mintedIds = new Set((ev.mintedCorrelationIds ?? []).filter((x) => MINTED_ID_SHAPE.test(String(x))));
  const mintedCorrelationValue = (k, val) => CORRELATION_KEYS.has(k) && mintedIds.has(String(val));
  const checkAttrs = (e, r, where) => {
    for (const [k, val] of Object.entries(e.attributes ?? {})) {
      if (k === "semanticEffectId") continue; // the constant identity attribute, verified separately
      const dom = r.attributes?.[k];
      if (!dom) { out.push(v(where, `attribute '${k}' on '${r.id}' has no declared value domain; unbounded cardinality`)); continue; }
      const ok = dom.domain === "boolean" ? typeof val === "boolean" : dom.domain === "enum" || dom.domain === "bucketed" ? (dom.values ?? []).includes(val) : dom.domain === "digest" ? /^[0-9a-f]{16,64}$/.test(String(val)) : false;
      if (!ok) out.push(v(where, `attribute '${k}'='${val}' on '${r.id}' is outside its declared ${dom.domain} domain; failing on cardinality`));
      if (!mintedCorrelationValue(k, val)) for (const [form, re] of PII_FORMS) if (re.test(String(val))) out.push(v(where, `attribute '${k}' on '${r.id}' carries a ${form}; a raw identifier in telemetry is a PII defect`));
    }
    for (const [k, val] of Object.entries(e.fields ?? {})) { if (mintedCorrelationValue(k, val)) continue; for (const [form, re] of PII_FORMS) if (re.test(String(val))) out.push(v(where, `a structured-log field on '${r.id}' carries a ${form}; a raw identifier in telemetry is a PII defect`)); }
  };
  for (const [type, list] of Object.entries({ spans: em.spans ?? [], logs: em.logs ?? [] }))
    for (const e of list) {
      const g = nodes.get(e.node), r = g && reg.get(g.op);
      if (!g || !r) { out.push(v(e.name ?? type, `an emission maps to no graph node; it is ad-hoc or misattributed`)); continue; }
      const want = EFFECT.includes(r.class) ? derived.get(g.op) : undefined;
      if ((e.semanticEffectId ?? undefined) !== want) out.push(v(e.node, `${type} emission for '${g.op}' carries semanticEffectId '${e.semanticEffectId}', expected '${want}'`));
      const base = metricFor(g.op);
      if (e.name !== base && !String(e.name).startsWith(base + ".")) out.push(v(e.node, `emission name '${e.name}' was not produced by the declared naming function ('${base}')`));
      checkAttrs(e, r, e.node);
    }
  for (const e of em.metrics ?? []) {
    const r = [...reg.values()].find((x) => e.name === `${metricFor(x.id)}.${x.metric}`);
    if (!r) { out.push(v(e.name, `a metric emission matches no registered operation's declared metric name; it is ad-hoc or misattributed`)); continue; }
    const want = EFFECT.includes(r.class) ? derived.get(r.id) : undefined;
    if ((e.attributes?.semanticEffectId ?? undefined) !== want) out.push(v(e.name, `metric emission for '${r.id}' carries semanticEffectId '${e.attributes?.semanticEffectId}', expected '${want}'`));
    checkAttrs(e, r, e.name);
  }
  if (!ev.boundary) out.push(v(path, "no boundary evidence: the capability-denied product-target graph resolution and start-up probe results are missing; failing closed"));
  else {
    for (const b of [...(ev.boundary.productTargetViolations ?? []), ...(ev.boundary.unresolvedEdges ?? [])]) out.push(v(b.ref ?? "boundary", `product-target boundary: ${b.message ?? b}`));
    for (const [cap, res] of Object.entries(ev.boundary.probe ?? {})) if (res !== "denied") out.push(v(cap, `the start-up probe found '${cap}' available in the capability-denied product target (${res})`));
    if (!ev.boundary.probe) out.push(v("probe", "no start-up probe results; failing closed"));
  }
  if (!ev.bundles) out.push(v(path, "no production-bundle module graphs were supplied; the evidence-tooling exclusion is a construction fact, not a promise; failing closed"));
  else for (const [bundle, mods] of Object.entries(ev.bundles)) for (const m of mods ?? []) if (ev.evidenceToolingPath && String(m).startsWith(ev.evidenceToolingPath)) out.push(v(m, `evidence-tooling module reached the ${bundle} production bundle`));
  return out;
}
