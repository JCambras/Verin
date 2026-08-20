// enforcement/rules-supply.mjs - E11..E15: charter non-negotiable #15 landing as a mechanism, blocking and
// never advisory. E11 and E15 are exhaustive two-state rules: an intentionally manifest-free, build-free
// tree takes the honest-empty path (positively proven, never "skipped"); the first appearance of any
// subject requires the complete non-empty proof. E13 is a self-contained gitleaks-class history scanner
// (the pinned gitleaks action runs beside it in CI as an independent layer); E14 consumes the pinned
// semgrep engine's report over the repo-owned ruleset and fails closed when no report was produced.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const v = (rule, ref, message) => ({ rule, ref, message });
const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lockb"];
const SECRET_RULES = [
  ["aws-access-key-id", /\bAKIA[0-9A-Z]{16}\b/],
  ["github-token", /\bgh[posru]_[A-Za-z0-9]{36,}\b/],
  ["private-key-block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["generic-credential-assignment", /(?:password|passwd|secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["'](?![$({])[^"']{8,}["']/i],
];

function parseAllowlists() {
  if (!existsSync("CONSTITUTION.md")) return null;
  const text = readFileSync("CONSTITUTION.md", "utf8");
  const grab = (marker) => {
    const para = text.split(marker)[1]?.split("\n\n")[0] ?? "";
    return Object.fromEntries([...para.matchAll(/`([^`]+)` (\d+(?:\.\d+)*)/g)].map((m) => [m[1], m[2]]));
  };
  const runtime = grab("**Application/runtime (eleven):**"), dev = grab("**Development/test/build (thirteen):**");
  const lic = text.match(/`E12` license allowlist \(closed\): ([^]*?)\. The last/)?.[1]?.split(/,\s*/m).map((s) => s.trim().replace(/\n/g, ""));
  const floor = text.match(/`E12` declared severity floor: \*\*(\w+)\*\*/)?.[1] ?? null;
  return Object.keys(runtime).length === 11 && Object.keys(dev).length === 13 ? { runtime, dev, licenses: lic ?? null, floor } : null;
}

export function collectSupplyFacts() {
  const facts = { manifest: null, lockfiles: LOCKFILES.filter((f) => existsSync(f)), allowlists: parseAllowlists(), frozen: null, audit: null, licenses: null, sast: null, secrets: [], release: null };
  if (existsSync("package.json")) { try { facts.manifest = JSON.parse(readFileSync("package.json", "utf8")); } catch { facts.manifest = "unparseable"; } }
  if (facts.manifest && typeof facts.manifest === "object" && facts.lockfiles.includes("pnpm-lock.yaml")) {
    const before = readFileSync("pnpm-lock.yaml", "utf8");
    try {
      execFileSync("corepack", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--reporter=silent"], { stdio: "pipe", timeout: 600000 });
      facts.frozen = { ok: true, drifted: readFileSync("pnpm-lock.yaml", "utf8") !== before };
    } catch (err) { facts.frozen = { ok: false, error: String(err.stderr ?? err).slice(0, 400) }; }
    try { facts.audit = JSON.parse(execFileSync("corepack", ["pnpm", "audit", "--json", "--prod"], { encoding: "utf8", maxBuffer: 1 << 26, timeout: 300000 })); } catch (err) { try { facts.audit = JSON.parse(String(err.stdout ?? "")); } catch { facts.audit = null; } }
    try { facts.licenses = JSON.parse(execFileSync("corepack", ["pnpm", "licenses", "list", "--json"], { encoding: "utf8", maxBuffer: 1 << 26, timeout: 300000 })); } catch { facts.licenses = null; }
  }
  if (process.env.SEMGREP_REPORT && existsSync(process.env.SEMGREP_REPORT)) { try { facts.sast = JSON.parse(readFileSync(process.env.SEMGREP_REPORT, "utf8")); } catch { facts.sast = null; } }
  try {
    const log = execFileSync("git", ["log", "-p", "--unified=0", "--no-color"], { encoding: "utf8", maxBuffer: 1 << 28 });
    let commit = "?", file = "?";
    for (const line of log.split("\n")) {
      const c = line.match(/^commit ([0-9a-f]{40})/); if (c) { commit = c[1]; continue; }
      const f = line.match(/^\+\+\+ b\/(.*)/); if (f) { file = f[1]; continue; }
      if (!line.startsWith("+")) continue;
      for (const [id, re] of SECRET_RULES) if (re.test(line)) facts.secrets.push({ id, commit, file });
    }
  } catch { facts.secrets = null; }
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  facts.release = {
    artifacts: tracked.filter((p) => /^(release|dist)\//.test(p) || /\.(tgz|tar\.gz)$/.test(p)),
    sboms: tracked.filter((p) => /(\.spdx\.json|\.cdx\.json)$/.test(p) || /(^|\/)sbom[^/]*\.json$/.test(p)),
  };
  return { supply: facts };
}

function lockfileComponents() {
  const out = new Set();
  for (const m of readFileSync("pnpm-lock.yaml", "utf8").matchAll(/^ {2}'?\/?((?:@[\w.-]+\/)?[\w.-]+)@([\w.-]+(?:\([^)]*\))*)'?:\s*$/gm))
    out.add(`${m[1]}@${m[2].replace(/\(.*/, "")}`);
  return out;
}

export function e11DependencyIntegrity(input) {
  const s = input.supply;
  if (!s) return [v("E11", "supply", "supply-chain facts could not be collected; failing closed")];
  const declared = typeof s.manifest === "object" && s.manifest ? Object.entries({ ...s.manifest.dependencies, ...s.manifest.devDependencies }) : [];
  if (s.manifest == null && s.lockfiles.length === 0) return []; // the honest-empty state, positively reported by the runner
  const out = [];
  if (s.manifest === "unparseable") return [v("E11", "package.json", "the dependency manifest is unparseable; failing closed")];
  if (s.manifest == null) return [v("E11", s.lockfiles[0], `a lockfile (${s.lockfiles.join(", ")}) appeared with no manifest; a partial subject leaves the honest-empty state and lacks the complete non-empty proof`)];
  if (s.lockfiles.length === 0) out.push(v("E11", "package.json", "a dependency manifest appeared with no lockfile; the ratified baseline requires a complete frozen lockfile"));
  if (!s.allowlists) out.push(v("E11", "CONSTITUTION.md", "the two ratified allowlists could not be read; failing closed"));
  for (const [name, ver] of declared) {
    if (!/^\d/.test(String(ver))) out.push(v("E11", name, `'${name}' is declared as '${ver}', a range; every entry is an exact version`));
    const list = s.allowlists ? (name in s.allowlists.runtime ? "runtime" : name in s.allowlists.dev ? "dev" : null) : null;
    if (s.allowlists && !list) out.push(v("E11", name, `'${name}' is in neither ratified allowlist; a new package needs captain ratification`));
    else if (s.allowlists && s.allowlists[list][name] !== ver) out.push(v("E11", name, `'${name}' is declared ${ver} but ratified ${s.allowlists[list][name]}; the manifest, lockfile and CONSTITUTION.md must carry the same string`));
  }
  if (s.lockfiles.includes("pnpm-lock.yaml")) {
    if (s.frozen == null) out.push(v("E11", "pnpm-lock.yaml", "the frozen-lockfile install proof did not run; failing closed"));
    else if (!s.frozen.ok) out.push(v("E11", "pnpm-lock.yaml", `the frozen-lockfile install failed: ${s.frozen.error}`));
    else if (s.frozen.drifted) out.push(v("E11", "pnpm-lock.yaml", "the lockfile changed during install; it was not frozen"));
    try {
      const lock = lockfileComponents();
      for (const [name, ver] of declared) if (/^\d/.test(String(ver)) && !lock.has(`${name}@${ver}`)) {
        const resolved = [...lock].filter((c) => c.startsWith(`${name}@`)).map((c) => c.slice(name.length + 1));
        out.push(v("E11", name, `'${name}' is declared ${ver} but the lockfile resolves ${resolved.join(", ") || "no version of it"}; manifest and lockfile disagree`));
      }
    } catch { out.push(v("E11", "pnpm-lock.yaml", "the lockfile could not be read for resolution comparison; failing closed")); }
  }
  const typesNode = declared.find(([n]) => n === "@types/node");
  const runtimeMajor = Number(process.versions.node.split(".")[0]);
  if (typesNode) { const typeMajor = Number(String(typesNode[1]).split(".")[0]); if (typeMajor !== runtimeMajor) out.push(v("E11", "@types/node", `the executing Node runtime major is ${runtimeMajor} but @types/node is ${typesNode[1]} (major ${typeMajor}); the majors must be equal`)); }
  else out.push(v("E11", "@types/node", "a manifest is in scope but @types/node is not declared; the runtime/type compatibility check has no subject"));
  return out;
}

export function e12DependencyAudit(input) {
  const s = input.supply;
  if (!s) return [v("E12", "supply", "supply-chain facts could not be collected; failing closed")];
  if (s.manifest == null && s.lockfiles.length === 0) return []; // zero dependencies, positively reported by the runner
  const out = [];
  if (!s.allowlists?.licenses || !s.allowlists?.floor) return [v("E12", "CONSTITUTION.md", "the declared severity floor or license allowlist could not be read; failing closed")];
  const FLOOR = ["low", "moderate", "high", "critical"].slice(["low", "moderate", "high", "critical"].indexOf(s.allowlists.floor));
  if (s.audit == null) out.push(v("E12", "pnpm-audit", "the advisory audit produced no readable answer; failing closed"));
  else for (const a of Object.values(s.audit.advisories ?? {})) if (FLOOR.includes(a.severity)) out.push(v("E12", a.module_name, `'${a.module_name}' ${a.findings?.[0]?.version ?? ""} carries advisory ${a.github_advisory_id ?? a.id} (${a.severity}), at or above the declared floor`));
  const ALLOWED = s.allowlists.licenses;
  if (s.licenses == null) out.push(v("E12", "pnpm-licenses", "the license inventory produced no readable answer; failing closed"));
  else for (const [license, pkgs] of Object.entries(s.licenses)) {
    if (license.split(/ (?:AND|OR) |[()]/).filter(Boolean).every((l) => ALLOWED.includes(l.trim()))) continue;
    for (const p of pkgs) out.push(v("E12", p.name, `'${p.name}' ${p.versions?.join("/") ?? ""} carries license '${license}', which is off the declared allowlist`));
  }
  return out;
}

export function e13SecretScanning(input) {
  const s = input.supply;
  if (!s || s.secrets == null) return [v("E13", "history", "the whole-history secret scan could not run; failing closed")];
  return s.secrets.map((h) => v("E13", `${h.commit.slice(0, 12)}:${h.file}`, `gitleaks-class rule '${h.id}' matched a credential-shaped byte in commit ${h.commit.slice(0, 12)}, file ${h.file}`));
}

export function e14StaticAnalysis(input) {
  const s = input.supply;
  if (!s || s.sast == null) return [v("E14", "semgrep-report", "no SAST report was provided by the pinned semgrep step (SEMGREP_REPORT); failing closed")];
  return (s.sast.results ?? []).filter((r) => (r.extra?.severity ?? "ERROR") === "ERROR")
    .map((r) => v("E14", `${r.path}:${r.start?.line}`, `SAST rule '${r.check_id}' (${r.extra?.severity}) matched at ${r.path}:${r.start?.line}`));
}

export function e15Sbom(input) {
  const s = input.supply;
  if (!s?.release) return [v("E15", "release", "release-artifact facts could not be collected; failing closed")];
  const { artifacts, sboms } = s.release;
  if (artifacts.length === 0 && sboms.length === 0) return []; // the honest-empty state, positively reported by the runner
  const out = [];
  for (const a of artifacts) if (!sboms.some((b) => { try { return JSON.parse(readFileSync(b, "utf8")).metadata?.component?.name === a; } catch { return false; } })) out.push(v("E15", a, `release artifact '${a}' is the subject of no SBOM`));
  for (const b of sboms) {
    let doc; try { doc = JSON.parse(readFileSync(b, "utf8")); } catch { out.push(v("E15", b, `SBOM '${b}' is unparseable; failing closed`)); continue; }
    const subject = doc.metadata?.component?.name;
    if (!subject || !artifacts.includes(subject)) { out.push(v("E15", b, `SBOM '${b}' names no release subject in this tree (subject: ${subject ?? "none"})`)); continue; }
    const comps = new Set((doc.components ?? []).map((c) => `${c.name}@${c.version}`));
    if (comps.size === 0) { out.push(v("E15", b, `SBOM '${b}' carries zero components; an empty inventory is the easiest false pass and never reports clean`)); continue; }
    let lock; try { lock = lockfileComponents(); } catch { out.push(v("E15", b, "no readable lockfile to compare the SBOM against; failing closed")); continue; }
    for (const c of lock) if (!comps.has(c)) out.push(v("E15", b, `component '${c}' is in the resolved lockfile but missing from the SBOM`));
    for (const c of comps) if (!lock.has(c)) out.push(v("E15", b, `component '${c}' is in the SBOM but the resolved lockfile does not contain it`));
  }
  return out;
}
