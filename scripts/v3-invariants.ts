/**
 * V3 PHASE-GATED INVARIANT RUNNER (ADR-0023; blocking CI job `v3-invariants`).
 *
 * Prints every v3 §17 invariant (docs/v3/verin-architecture-v3.md) with an
 * HONEST three-state status:
 *   - active-pass:     the invariant's mapped fitness fences were EXECUTED here
 *                      and passed (companion mechanisms verified present);
 *   - active-fail:     a mapped mechanism failed or is missing -> exit 1;
 *   - not-yet-active:  prerequisites do not exist yet; rendered visibly
 *                      distinct from passing - NEVER fake green (v3 §17).
 *
 * The registry (v3-invariants.json) stores ACTIVATION state only; pass/fail is
 * computed by running the mapped fences in this process. Registry integrity is
 * fenced by src/__tests__/fitness/v3-invariants.test.ts; the ratified-document
 * SHA-256 pins are re-verified here AND by the arch-version fence.
 */
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface Mechanism {
  type: string;
  ref: string;
}
interface Invariant {
  id: number;
  group: string;
  gate: string;
  name: string;
  status: "active" | "not-yet-active";
  activatesWhen: string;
  mechanisms: Mechanism[];
  notes?: string;
}
interface Registry {
  architectureVersion: string;
  documents: Array<{ path: string; sha256: string }>;
  gates: Record<string, string>;
  invariants: Invariant[];
}

const ROOT = resolve(import.meta.dirname, "..");
const useColor = process.env.NO_COLOR === undefined;
const paint = (code: string, s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const green = (s: string) => paint("32", s);
const red = (s: string) => paint("31;1", s);
const dim = (s: string) => paint("2", s);
const bold = (s: string) => paint("1", s);

function fail(msg: string): never {
  console.error(red(`\nv3-invariants: ${msg}`));
  process.exit(1);
}

// ---------- load + guard the registry ----------
const registryPath = join(ROOT, "v3-invariants.json");
if (!existsSync(registryPath)) fail("v3-invariants.json is missing from the repo root");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Registry;

const structural: string[] = [];
if (registry.invariants.length !== 30) structural.push(`expected 30 invariants, found ${registry.invariants.length}`);
for (const inv of registry.invariants) {
  if (inv.status !== "active" && inv.status !== "not-yet-active") {
    structural.push(`invariant ${inv.id}: illegal status '${inv.status}' (the registry stores activation only; results are computed here)`);
  }
  if (inv.status === "active" && !inv.mechanisms.some((m) => m.type === "fitness")) {
    structural.push(`invariant ${inv.id}: active but maps to no runnable fitness mechanism`);
  }
}

// ---------- verify the ratified-document pins (arch-version, defense in depth) ----------
for (const doc of registry.documents) {
  const p = join(ROOT, doc.path);
  if (!existsSync(p)) {
    structural.push(`${doc.path}: pinned ratified document is MISSING`);
    continue;
  }
  const actual = createHash("sha256").update(readFileSync(p)).digest("hex");
  if (actual !== doc.sha256) {
    structural.push(`${doc.path}: drifted from its ratified pin (pinned ${doc.sha256.slice(0, 12)}…, actual ${actual.slice(0, 12)}…) - update the pin in the same PR and review the invariants (ADR-0023)`);
  }
}
if (structural.length > 0) fail(`registry/pin problems:\n  - ${structural.join("\n  - ")}`);

// ---------- execute the mapped fitness fences (one vitest run, per-file results) ----------
const ciText = existsSync(join(ROOT, ".github/workflows/ci.yml")) ? readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8") : "";
const active = registry.invariants.filter((i) => i.status === "active");
const fitnessFiles = [...new Set(active.flatMap((i) => i.mechanisms.filter((m) => m.type === "fitness").map((m) => m.ref)))];

const fileResults = new Map<string, boolean>();
if (fitnessFiles.length > 0) {
  const outDir = mkdtempSync(join(tmpdir(), "v3-invariants-"));
  const outFile = join(outDir, "vitest.json");
  console.log(dim(`running ${fitnessFiles.length} mapped fitness fence file(s) via vitest…`));
  // Invoke vitest through the current Node binary (no package-manager shim needed:
  // `pnpm` reaches dev shells only via corepack, but node_modules is always here).
  const vitestEntry = join(ROOT, "node_modules/vitest/vitest.mjs");
  const run = spawnSync(process.execPath, [vitestEntry, "run", "--reporter=json", `--outputFile=${outFile}`, ...fitnessFiles], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    interface VitestJson {
      testResults: Array<{ name: string; status: string }>;
    }
    const report = JSON.parse(readFileSync(outFile, "utf8")) as VitestJson;
    for (const tr of report.testResults) {
      const name = tr.name.replace(/\\/g, "/");
      const ref = fitnessFiles.find((f) => name.endsWith(f));
      if (ref) fileResults.set(ref, tr.status === "passed");
    }
  } catch {
    // No parseable report (vitest crashed before writing): trust the exit code, never assume green.
    if (run.status !== 0) console.error(run.stderr || run.stdout);
    for (const f of fitnessFiles) fileResults.set(f, run.status === 0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

// ---------- compute per-invariant state ----------
type State = "active-pass" | "active-fail" | "not-yet-active";
const failures: string[] = [];
function stateOf(inv: Invariant): { state: State; details: string[] } {
  if (inv.status === "not-yet-active") return { state: "not-yet-active", details: [] };
  const details: string[] = [];
  let ok = true;
  for (const m of inv.mechanisms) {
    if (m.type === "fitness") {
      const passed = fileResults.get(m.ref);
      if (passed === undefined || !passed) {
        ok = false;
        details.push(`fitness ${m.ref} ${passed === undefined ? "produced no result" : "FAILED"}`);
      } else {
        details.push(`fitness ${m.ref} passed`);
      }
    } else if (m.type === "ci-gate") {
      if (ciText.includes(m.ref)) details.push(`ci-gate ${m.ref} declared in blocking ci.yml`);
      else {
        ok = false;
        details.push(`ci-gate ${m.ref} MISSING from blocking ci.yml`);
      }
    } else if (existsSync(join(ROOT, m.ref))) {
      details.push(`${m.type} ${m.ref} present`);
    } else {
      ok = false;
      details.push(`${m.type} ${m.ref} MISSING`);
    }
  }
  return { state: ok ? "active-pass" : "active-fail", details };
}

// ---------- report ----------
console.log(bold(`\nV3 PHASE-GATED INVARIANTS - ${registry.architectureVersion} §17 (ADR-0023)`));
console.log(dim("states: active-pass (fences executed and green) · active-fail (blocks CI) · not-yet-active (prerequisites absent - NOT a pass)\n"));

const counts: Record<State, number> = { "active-pass": 0, "active-fail": 0, "not-yet-active": 0 };
let currentGroup = "";
for (const inv of registry.invariants) {
  if (inv.group !== currentGroup) {
    currentGroup = inv.group;
    console.log(bold(`  ${currentGroup}  ${dim(`[gate ${inv.gate}: ${registry.gates[inv.gate] ?? ""}]`)}`));
  }
  const { state, details } = stateOf(inv);
  counts[state] += 1;
  const id = `#${String(inv.id).padStart(2, " ")}`;
  if (state === "active-pass") {
    console.log(`    ${green("✓ active-pass    ")} ${id} ${inv.name}`);
    for (const d of details) console.log(dim(`                         └ ${d}`));
  } else if (state === "active-fail") {
    console.log(`    ${red("✗ ACTIVE-FAIL    ")} ${id} ${inv.name}`);
    for (const d of details) console.log(red(`                         └ ${d}`));
    failures.push(`#${inv.id} ${inv.name}`);
  } else {
    console.log(dim(`    ○ not-yet-active  ${id} ${inv.name}`));
    console.log(dim(`                         └ activates when: ${inv.activatesWhen}`));
  }
}

console.log(bold(`\n  summary: ${green(`${counts["active-pass"]} active-pass`)} · ${counts["active-fail"] > 0 ? red(`${counts["active-fail"]} active-fail`) : `${counts["active-fail"]} active-fail`} · ${dim(`${counts["not-yet-active"]} not-yet-active`)} (${registry.invariants.length} total)\n`));

if (failures.length > 0) fail(`ACTIVE invariants failing:\n  - ${failures.join("\n  - ")}`);
