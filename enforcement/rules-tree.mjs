// enforcement/rules-tree.mjs - rules E5..E10 and their fact collector. The rules are pure over collected
// facts; collectTreeFacts() is the input collector (git, tree, oracle reads, and the registered
// regenerate-and-byte-compare runs). E5's classifier is exhaustive and ordered (proven-G, else B, else H);
// E10 reads the oracle's signed truth through git and never parses a byte it has not verified.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const v = (rule, ref, message) => ({ rule, ref, message });
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 26 });
const gitBuf = (...a) => execFileSync("git", a, { maxBuffer: 1 << 26 });
const PINS_PATH = "enforcement/signed-truth-pins.json";
const SEAM_MODULES = ["enforcement/contract.mjs"]; // the declared seam's home; later slices extend this list
const PRODUCT_DIRS = ["src", "app", "pages", "components", "lib"]; // product code; enforcement/ and CI are tooling
const isTestPath = (p) => /(^|\/)(__tests__|tests?)\/|\.test\.|\.spec\./.test(p);

export function regenerateSignedTruthPins() {
  const head = JSON.parse(readFileSync(PINS_PATH, "utf8")).oracleHead;
  const paths = ["docs/golden-cases.md", ...git("ls-tree", "-r", head, "--name-only", "fixtures/golden/").trim().split("\n")];
  const pins = {};
  for (const p of paths) pins[p] = sha256(gitBuf("cat-file", "blob", `${head}:${p}`));
  return JSON.stringify({ oracleHead: head, pins }, null, 2) + "\n";
}

function diffRange(input) {
  if (input.eventName === "pull_request" && input.baseSha && input.headSha) return [input.baseSha, input.headSha];
  if (input.eventName === "push" && input.beforeSha && !/^0+$/.test(input.beforeSha)) return [input.beforeSha, input.headPushSha];
  return null;
}

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name.startsWith(".") && dir === "." && ![".github"].includes(name)) continue;
    const p = dir === "." ? name : `${dir}/${name}`;
    if (statSync(p).isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

export function collectTreeFacts(input) {
  const facts = { changed: null, diffAdded: {}, regen: {}, gallery: null, ceilings: null, proofLogAdded: "", e6: null, e7: [], e9: [], oracle: null };
  const range = diffRange(input);
  if (range) {
    try {
      const numstat = git("diff", "--numstat", `${range[0]}..${range[1]}`).trim();
      facts.changed = numstat ? numstat.split("\n").map((l) => {
        const [a, , p] = l.split("\t");
        let bytes = 0, binary = a === "-", exists = true;
        try { const b = gitBuf("cat-file", "blob", `${range[1]}:${p}`); bytes = b.length; binary = binary || b.subarray(0, 8000).includes(0); }
        catch { exists = false; }
        return { path: p, added: a === "-" ? 0 : Number(a), binary, bytes, exists };
      }) : [];
      for (const c of facts.changed.filter((x) => x.exists && !x.binary && x.bytes < (1 << 22))) {
        facts.diffAdded[c.path] = git("diff", `${range[0]}..${range[1]}`, "--", c.path).split("\n")
          .filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
      }
      facts.proofLogAdded = (facts.diffAdded["docs/proof-log.md"] ?? []).join("\n");
      if (facts.changed.some((c) => c.path === "package.json")) {
        const dep = (sha, key) => { try { return Object.keys(JSON.parse(git("cat-file", "blob", `${sha}:package.json`))[key] ?? {}); } catch { return []; } };
        facts.deps = {
          runtimeAdded: dep(range[1], "dependencies").filter((k) => !dep(range[0], "dependencies").includes(k)),
          devAdded: dep(range[1], "devDependencies").filter((k) => !dep(range[0], "devDependencies").includes(k)),
        };
      }
    } catch { facts.changed = null; }
  }
  const reg = existsSync("enforcement/generated-artifacts.json") ? JSON.parse(readFileSync("enforcement/generated-artifacts.json", "utf8")) : {};
  for (const [path, r] of Object.entries(reg)) {
    const entry = { reproduced: false, summaryExists: false, summaryLines: 0, summaryPath: r.summary };
    try {
      const expected = execFileSync(r.regenerate[0], r.regenerate.slice(1), { maxBuffer: 1 << 26 });
      entry.reproduced = existsSync(path) && Buffer.compare(expected, readFileSync(path)) === 0;
    } catch { entry.reproduced = false; }
    if (r.summary && existsSync(r.summary)) { entry.summaryExists = true; entry.summaryLines = readFileSync(r.summary, "utf8").split("\n").length - 1; }
    facts.regen[path] = entry;
  }
  if (existsSync("docs/review-gallery.md"))
    facts.gallery = [...readFileSync("docs/review-gallery.md", "utf8").matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|/gm)].map((m) => ({ path: m[1], sha: m[2] }));
  if (existsSync("CONSTITUTION.md")) {
    const text = readFileSync("CONSTITUTION.md", "utf8");
    facts.ceilings = {};
    for (const m of text.matchAll(/^\| Slice class `([^`]+)` - measure \| Preferred \| Hard \|\n\|[-:| ]+\|\n((?:\|.*\|\n)+)/gm)) {
      const rows = {};
      for (const r of m[2].trim().split("\n")) { const c = r.split("|").map((s) => s.trim()); rows[c[1]] = { preferred: c[2], hard: c[3] }; }
      facts.ceilings[m[1]] = rows;
    }
  }
  const files = listFiles(".");
  const workflows = files.filter((p) => p.startsWith(".github/workflows/"));
  const roots = new Set(workflows.flatMap((w) => [...readFileSync(w, "utf8").matchAll(/node ([\w./-]+\.mjs)/g)].map((m) => m[1])));
  const mods = files.filter((p) => p.endsWith(".mjs") && !isTestPath(p));
  const importsOf = (p) => [...readFileSync(p, "utf8").matchAll(/import[\s\S]{0,200}?from\s+["'](\.[^"']+)["']|import\(["'](\.[^"']+)["']\)/g)]
    .map((m) => new URL(m[1] ?? m[2], `file:///${p}`).pathname.slice(1));
  const reachable = new Set(roots); const queue = [...roots];
  while (queue.length) { const p = queue.pop(); if (!existsSync(p)) continue; for (const i of importsOf(p)) if (!reachable.has(i)) { reachable.add(i); queue.push(i); } }
  facts.e6 = { newExports: [], reachable: [...reachable] };
  for (const [path, added] of Object.entries(facts.diffAdded)) {
    if (!path.endsWith(".mjs") || isTestPath(path)) continue;
    for (const line of added) {
      const m = line.match(/^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/);
      if (!m) continue;
      const callers = mods.filter((f) => f !== path && reachable.has(f) && importsOf(f).includes(path) && new RegExp(`\\b${m[1]}\\b`).test(readFileSync(f, "utf8")));
      facts.e6.newExports.push({ path, name: m[1], line, callerCount: callers.length });
    }
  }
  for (const [path, added] of Object.entries(facts.diffAdded)) {
    if (!/\.(tsx|jsx)$/.test(path) || isTestPath(path)) continue;
    added.forEach((line, i) => {
      if (/\{[^}]*\.(balance|amount|total|count|score|health)\w*\}/i.test(line))
        facts.e7.push({ path, line: line.trim(), hasProvenance: /source/.test(line) && /asOf/.test(line), n: i });
    });
  }
  for (const p of files.filter((f) => PRODUCT_DIRS.some((d) => f.startsWith(d + "/")) && /\.(m?js|ts|tsx|jsx)$/.test(f) && !isTestPath(f))) {
    const text = readFileSync(p, "utf8");
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/\b(?:fetch|axios|request|got)\s*\(\s*(["'`]?)([^)\s,]*)/g)) {
        if (!m[1] || m[2].includes("${")) facts.e9.push({ path: `${p}:${i + 1}`, host: null });
        else { try { facts.e9.push({ path: `${p}:${i + 1}`, host: new URL(m[2]).host }); } catch { facts.e9.push({ path: `${p}:${i + 1}`, host: null }); } }
      }
      if (/from\s+["'](node:https?|undici|axios|got)["']/.test(line)) facts.e9.push({ path: `${p}:${i + 1}`, host: null });
    });
  }
  facts.oracle = { committed: existsSync(PINS_PATH) ? readFileSync(PINS_PATH, "utf8") : null, regenerated: null, live: null };
  if (facts.oracle.committed != null) {
    try { facts.oracle.regenerated = regenerateSignedTruthPins(); } catch (err) { facts.oracle.regenerated = `unavailable: ${err}`; }
    try {
      facts.oracle.live = {};
      for (const p of Object.keys(JSON.parse(facts.oracle.committed).pins)) {
        try { facts.oracle.live[p] = sha256(gitBuf("cat-file", "blob", `origin/main:${p}`)); } catch { facts.oracle.live[p] = "absent-from-origin/main"; }
      }
    } catch { facts.oracle.live = null; }
  }
  return facts;
}

const MB = 1048576;
export function e5ReviewBudget(input) {
  if (input.eventName !== "pull_request") return []; // measured on every pull_request run; pushes reach generation-4 only through a measured PR
  if (!Array.isArray(input.changed)) return [v("E5", "diff", "the changed-path list could not be collected; failing closed")];
  if (input.changed.length === 0) return [v("E5", "diff", "E5 saw zero changed paths; a check that sees nothing must never report clean")];
  const out = [];
  const cls = input.declaredSliceClass, table = input.ceilings?.[cls];
  if (!table) return [v("E5", "Slice-Class", `no ceilings recorded in CONSTITUTION.md for declared slice class '${cls}'; failing closed`)];
  const H = [], G = [], B = [];
  for (const c of input.changed) {
    if (!c.exists) continue; // a deleted path adds no authored line and no artifact
    const r = input.regen[c.path];
    if (r) {
      if (r.reproduced && r.summaryExists && r.summaryLines <= 40) { G.push(c); continue; }
      out.push(v("E5", c.path, `bucket-G artifact failed its qualification (reproduced=${r.reproduced}, summary=${r.summaryExists ? r.summaryLines + " lines" : "missing"}); reclassified to ${c.binary ? "B" : "H"} and the broken regeneration fails in its own right`));
      (c.binary ? B : H).push(c); continue;
    }
    (c.binary ? B : H).push(c);
  }
  for (const c of B) if (!input.gallery?.some((g) => g.path === c.path)) out.push(v("E5", c.path, "bucket-B artifact has no review-gallery row (path + SHA-256); unindexed evidence is not reviewable"));
  const hLines = H.reduce((n, c) => n + c.added, 0);
  const measures = [
    ["Bucket H, reviewable text lines", hLines],
    ["Files touched", input.changed.length],
    ["Canonical owners touched", new Set(input.changed.map((c) => /^(enforcement\/|\.github\/|docs\/|CONSTITUTION\.md|README\.md)/.test(c.path) ? "enforcement-contract" : c.path.split("/")[0])).size],
    ["New public seam symbols", SEAM_MODULES.flatMap((mod) => input.diffAdded[mod] ?? []).filter((l) => /^export\s/.test(l)).length],
    ["New database objects", Object.entries(input.diffAdded).filter(([p]) => p.endsWith(".sql")).flatMap(([, a]) => a).filter((l) => /^\s*CREATE\s+(TABLE|INDEX|VIEW|SEQUENCE|TRIGGER|FUNCTION)/i.test(l)).length],
    ["New direct dependencies, application/runtime allowlist", input.deps?.runtimeAdded?.length ?? 0],
    ["New direct dependencies, development/test/build allowlist", input.deps?.devAdded?.length ?? 0],
    ["Review surface (H at 8 lines/min + B at 2 artifacts/min)", Math.round(hLines / 8 + B.length / 2)],
  ];
  for (const [name, value] of measures) {
    const hard = Number((table[name]?.hard ?? "").replace(/[^\d]/g, ""));
    if (!Number.isFinite(hard) || table[name] == null) out.push(v("E5", name, `no hard ceiling found for measure '${name}'; failing closed`));
    else if (value > hard) out.push(v("E5", name, `${name}: measured ${value} exceeds hard ceiling ${hard}`));
  }
  for (const [name, list] of [["Bucket G, generated-deterministic artifacts", G], ["Bucket B, binary and captured-evidence artifacts", B]]) {
    const m = (input.ceilings[cls][name]?.hard ?? "").match(/(\d+)\s*files?\s*\/\s*(\d+)\s*MB/i);
    if (!m) { out.push(v("E5", name, `no hard ceiling found for '${name}'; failing closed`)); continue; }
    const bytes = list.reduce((n, c) => n + c.bytes, 0);
    if (list.length > Number(m[1])) out.push(v("E5", name, `${name}: ${list.length} artifacts exceeds hard ceiling ${m[1]}`));
    if (bytes > Number(m[2]) * MB) out.push(v("E5", name, `${name}: ${bytes} gross bytes exceeds hard ceiling ${m[2]} MB`));
  }
  if (out.length) for (const c of input.changed) out.push(v("E5", c.path, `bucket ${G.includes(c) ? "G" : B.includes(c) ? "B" : c.exists ? "H" : "deleted"}, added ${c.added} lines, ${c.bytes} bytes`));
  return out;
}

export function e6Reachability(input) {
  if (!input.e6) return [v("E6", "tree", "the export graph could not be collected; failing closed")];
  return input.e6.newExports.filter((e) => e.callerCount === 0)
    .map((e) => v("E6", `${e.path}`, `new exported symbol '${e.name}' has no non-test caller reachable from a live entry path`));
}

export function e7Provenance(input) {
  return (input.e7 ?? []).filter((c) => !c.hasProvenance)
    .map((c) => v("E7", c.path, `metric-class render without provenance (no source/asOf): ${c.line}`));
}

export function e8CompanionProof(input) {
  if (input.eventName !== "pull_request") return [];
  const newIds = [...new Set(Object.entries(input.diffAdded ?? {}).filter(([p]) => p.startsWith("enforcement/")).flatMap(([, a]) => a).flatMap((l) => [...l.matchAll(/\["(E\d+)",/g)].map((m) => m[1])))];
  const out = [];
  for (const id of newIds) {
    const section = input.proofLogAdded.split(/^## /m).find((s) => s.startsWith(`M-${id} (rule ${id})`));
    if (!section) { out.push(v("E8", id, `new PASS-emitting check ${id} ships with no companion mutation entry added to docs/proof-log.md in this PR`)); continue; }
    if (!/injected/i.test(section) || !/FAIL/.test(section))
      out.push(v("E8", id, `companion entry for ${id} records no observed failure; a companion that never failed proves nothing`));
  }
  return out;
}

export function e9NoExternalEffect(input) {
  const allowlist = []; // empty until slice 9, and telemetry is never added to it (5B.7)
  return (input.e9 ?? []).flatMap((s) => {
    if (s.host == null) return [v("E9", s.path, "outbound call with an unresolved destination; a host the rule cannot read is a host it refuses")];
    return allowlist.includes(s.host) ? [] : [v("E9", s.path, `outbound network host '${s.host}' is not on the allowlist (which is empty until slice 9)`)];
  });
}

export function e10SignedTruthImmutable(input) {
  const o = input.oracle;
  if (!o || o.committed == null) return [v("E10", PINS_PATH, "the signed-truth pin registry is missing; failing closed")];
  if (o.regenerated !== o.committed) return [v("E10", PINS_PATH, "the committed pin registry does not byte-match its regeneration from the pinned oracle head; refusing to continue")];
  if (o.live == null) return [v("E10", "origin/main", "the oracle's live signed-truth bytes could not be read; failing closed")];
  const pins = JSON.parse(o.committed).pins;
  return Object.entries(pins).filter(([p, d]) => o.live[p] !== d)
    .map(([p, d]) => v("E10", p, `signed truth changed before parsing: expected sha256 ${d}, read ${o.live[p]}; refusing to continue`));
}
