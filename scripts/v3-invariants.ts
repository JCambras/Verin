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
 *
 * Gates (ADR-0030) declare their wave, prompt range, structural predecessors,
 * entry condition, outcome, and a list of TYPED requirements. This report is itself a document subject to
 * the honesty ruling, so it does not merely PRINT the registry: it re-runs the
 * whole gate rule set from the shared core (scripts/v3-gates.lib.ts) that the
 * v3-gate-ordering fence proves rejects real violations, and refuses to print at
 * all if the constitution is unsound. A gate reads green only when every typed
 * requirement is met, every requirement is decidable here, and every predecessor is green.
 */
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  activeInvariantRatchetProblems,
  ciJobRunProblem,
  ciJobRuns,
  gateConstitutionProblems,
  gateReadiness,
  mappedFitnessProblems,
  parseCiJobs,
  type Gate,
  type Invariant as GateInvariant,
  type Registry as GateRegistry,
} from "./v3-gates.lib";

interface Mechanism {
  type: string;
  ref: string;
  /** `ci-gate` only: the command the named blocking job must actually run. */
  command?: string;
}
interface Invariant extends GateInvariant {
  group: string;
  status: "active" | "not-yet-active";
  activatesWhen: string;
  mechanisms: Mechanism[];
  notes?: string;
}
interface Registry extends GateRegistry {
  architectureVersion: string;
  documents: Array<{ path: string; sha256: string }>;
  gates: Record<string, Gate>;
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
const registryFlagIndex = process.argv.indexOf("--registry");
const registryOverride =
  registryFlagIndex === -1
    ? undefined
    : process.argv[registryFlagIndex + 1];
if (registryFlagIndex !== -1 && registryOverride === undefined) {
  fail("--registry requires a path");
}
const registryPath =
  registryOverride === undefined
    ? join(ROOT, "v3-invariants.json")
    : resolve(registryOverride);
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
// The WHOLE gate rule set (ADR-0030), not a subset: ordering, activation-ownership
// integrity, prose/structured agreement, activation-artifact honesty, and the
// no-empty-requirement-set rule. Same shared core the v3-gate-ordering fence proves
// adversarially, so this report can never emit a claim that fence would reject.
const gateProblems = gateConstitutionProblems(
  registry,
  (path) => existsSync(join(ROOT, path)),
);
if (gateProblems.length > 0) {
  fail(
    `gate constitution problems:\n  - ${gateProblems.join("\n  - ")}`,
  );
}
const activeRatchetProblems =
  activeInvariantRatchetProblems(registry);
if (activeRatchetProblems.length > 0) {
  fail(
    `active invariant ratchet problems:\n  - ${activeRatchetProblems.join("\n  - ")}`,
  );
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
const ciJobs = parseCiJobs(ciText);
const active = registry.invariants.filter((i) => i.status === "active");
const gateFences = Object.values(registry.gates).flatMap((g) => g.requires.filter((r) => r.kind === "fitness").map((r) => r.ref!));
const fitnessFiles = [...new Set([...active.flatMap((i) => i.mechanisms.filter((m) => m.type === "fitness").map((m) => m.ref)), ...gateFences])];

const fileResults = new Map<string, boolean>();
let fitnessRunStatus: number | null = 0;
if (fitnessFiles.length > 0) {
  const outDir = mkdtempSync(join(tmpdir(), "v3-invariants-"));
  const outFile = join(outDir, "vitest.json");
  console.log(dim(`running ${fitnessFiles.length} mapped fitness fence file(s) via vitest…`));
  // Invoke vitest through the current Node binary (no package-manager shim needed:
  // `pnpm` reaches dev shells only via corepack, but node_modules is always here).
  // Serial execution is NOT repeated here: it is held in vitest.config.ts, which
  // this run resolves from `cwd: ROOT` like every other invocation path.
  const vitestEntry = join(ROOT, "node_modules/vitest/vitest.mjs");
  const run = spawnSync(
    process.execPath,
    [
      vitestEntry,
      "run",
      "--reporter=json",
      `--outputFile=${outFile}`,
      ...fitnessFiles,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  fitnessRunStatus = run.status;
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
    if (run.status !== 0) console.error(run.stderr || run.stdout);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const fitnessFailures = mappedFitnessProblems(
  fitnessFiles,
  fileResults,
  fitnessRunStatus,
);
if (fitnessFailures.length > 0) {
  fail(`mapped fitness fences failing:\n  - ${fitnessFailures.join("\n  - ")}`);
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
      // A job NAME can appear in a comment or a path; the blocking job must exist
      // and actually run the mechanism's command (ruling `gatea-fix-review-2`).
      const problem = ciJobRunProblem(ciJobs, m.ref, m.command ?? "");
      if (problem === undefined) details.push(`ci-gate ${m.ref} runs '${m.command}' in a dedicated blocking ci.yml step`);
      else {
        ok = false;
        details.push(problem);
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
const stateById = new Map<number, State>();
let currentGroup = "";
for (const inv of registry.invariants) {
  if (inv.group !== currentGroup) {
    currentGroup = inv.group;
    console.log(bold(`  ${currentGroup}`));
  }
  const { state, details } = stateOf(inv);
  stateById.set(inv.id, state);
  counts[state] += 1;
  const id = `#${String(inv.id).padStart(2, " ")}`;
  // Groups no longer imply a gate (ADR-0030 split the foundation group across gates A and B),
  // so each line carries its own. The not-yet-active line is already dim - nesting dim() there
  // would emit a reset mid-line and un-dim the rest.
  const at = dim(`  [gate ${inv.gate}]`);
  if (state === "active-pass") {
    console.log(`    ${green("✓ active-pass    ")} ${id} ${inv.name}${at}`);
    for (const d of details) console.log(dim(`                         └ ${d}`));
  } else if (state === "active-fail") {
    console.log(`    ${red("✗ ACTIVE-FAIL    ")} ${id} ${inv.name}${at}`);
    for (const d of details) console.log(red(`                         └ ${d}`));
    failures.push(`#${inv.id} ${inv.name}`);
  } else {
    console.log(dim(`    ○ not-yet-active  ${id} ${inv.name}  [gate ${inv.gate}]`));
    console.log(dim(`                         └ activates when: ${inv.activatesWhen}`));
  }
}

// ---------- gate readiness (ADR-0030: typed requirements; an undecidable gate is NEVER green) ----------
console.log(bold("\n  PHASE GATES"));
console.log(dim("  green (every typed requirement met) · not yet green (a requirement is unmet) · not-yet-verifiable (an outcome clause nothing can decide yet)\n"));
const GATE_STATE_WIDTH = "○ not-yet-verifiable".length;
const gateIndent = " ".repeat(4 + GATE_STATE_WIDTH + 1);
const gateTag = (s: string) => s.padEnd(GATE_STATE_WIDTH, " ");
for (const view of gateReadiness(registry, {
  invariantState: (id) => stateById.get(id),
  exists: (p) => existsSync(join(ROOT, p)),
  ciRuns: (ref, command) => ciJobRuns(ciJobs, ref, command),
  fitnessPassed: (ref) => fileResults.get(ref),
})) {
  const { key, gate } = view;
  const label = `gate ${key} (wave ${gate.wave}, prompts ${gate.prompts.join("-")}) requires ${view.requirements.map((r) => r.label).join(" · ")}`;
  if (view.state === "green") console.log(`    ${green(gateTag("✓ green"))} ${label}`);
  else if (view.state === "not-yet-green") console.log(dim(`    ${gateTag("○ not yet green")} ${label}\n${gateIndent}└ awaiting: ${view.blocking.join(" · ")}`));
  else console.log(dim(`    ${gateTag("○ not-yet-verifiable")} ${label}\n${gateIndent}└ no mechanism decides: ${view.blocking.join(" · ")}`));
  // `awaiting` already lists these, but a reader planning the wave has to know WHICH of
  // them no mechanism can close - they hold the gate below green after the rest go green.
  if (view.state === "not-yet-green" && view.undecidable.length > 0) {
    console.log(dim(`${gateIndent}└ no mechanism decides: ${view.undecidable.join(" · ")}`));
  }
  console.log(dim(`${gateIndent}└ wave may begin when: ${gate.entryCondition}`));
}

console.log(bold(`\n  summary: ${green(`${counts["active-pass"]} active-pass`)} · ${counts["active-fail"] > 0 ? red(`${counts["active-fail"]} active-fail`) : `${counts["active-fail"]} active-fail`} · ${dim(`${counts["not-yet-active"]} not-yet-active`)} (${registry.invariants.length} total)\n`));

if (failures.length > 0) fail(`ACTIVE invariants failing:\n  - ${failures.join("\n  - ")}`);
