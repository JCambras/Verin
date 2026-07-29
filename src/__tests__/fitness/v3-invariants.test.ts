import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ciJobRunProblem, parseCiJobs, type CiJob } from "../../../scripts/v3-gates.lib";

/**
 * V3-INVARIANT REGISTRY FENCE (ADR-0023; v3 §17 preamble: CI reports active,
 * not-yet-active, or failed - NEVER FAKE GREEN). v3-invariants.json registers
 * all 30 phase-gated invariants; this fence keeps the registry HONEST:
 *  (a) all 30 invariants present (ids 1..30, unique), each with group + gate;
 *  (b) status is ONLY 'active' or 'not-yet-active' - the registry can never
 *      store a pass/fail RESULT (active-pass vs active-fail is computed by
 *      running the mapped fences: scripts/v3-invariants.ts, CI job
 *      'v3-invariants');
 *  (c) every ACTIVE invariant maps to >=1 runnable fitness mechanism, every
 *      path-like mechanism exists on disk, and every ci-gate mechanism names a
 *      job that EXISTS in the BLOCKING ci.yml and RUNS the mechanism's declared
 *      command (a name surviving only in the non-blocking scheduled.yml, or only
 *      in a comment or a path, does not count - ruling `gatea-fix-review-2`);
 *  (d) every NOT-YET-ACTIVE invariant names its activation prerequisite
 *      (activatesWhen) - a bare "not yet" with no named trigger is the silent
 *      deferral the charter forbids;
 *  (e) ratchet: an invariant that has shipped as 'active' can never flip back
 *      to 'not-yet-active' (activation is monotonic; same doctrine as the
 *      charter-drift ratchet).
 * Disabled-fence detection for mapped fitness files is charter-drift (b),
 * which scans every fence in this directory including the mapped ones.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));

interface Mechanism {
  type: string;
  ref: string;
  /** `ci-gate` only: the command the named blocking job must actually run. */
  command?: string;
}
interface Invariant {
  id: number;
  group: string;
  gate: string;
  name: string;
  status: string;
  activatesWhen: string;
  mechanisms: Mechanism[];
  notes?: string;
}
interface Registry {
  invariants: Invariant[];
}

const VALID_STATUSES = ["active", "not-yet-active"];
const MECHANISM_TYPES = ["fitness", "ci-gate", "file", "config", "adr", "procedure"];
// The RATCHET (e): every invariant id that has shipped as 'active'. Flipping one
// back to 'not-yet-active' would un-enforce it silently; removal needs an ADR
// AND an edit here, where review sees it.
export const ACTIVE_RATCHET = [1, 2, 5, 7, 8, 9];

/** Pure core: validate the registry against an injectable fs/ci view; returns human-readable problems. */
export function validateRegistry(reg: Registry, deps: { exists: (path: string) => boolean; ciJobs: Map<string, CiJob> }): string[] {
  const problems: string[] = [];
  const invs = reg.invariants ?? [];

  const ids = invs.map((i) => i.id);
  const missing = Array.from({ length: 30 }, (_, k) => k + 1).filter((n) => !ids.includes(n));
  if (missing.length > 0) problems.push(`invariants missing from the registry: ${missing.join(", ")}`);
  if (new Set(ids).size !== ids.length) problems.push("duplicate invariant ids in the registry");
  if (invs.length !== 30) problems.push(`registry must hold exactly the 30 v3 §17 invariants, found ${invs.length}`);

  for (const inv of invs) {
    const tag = `invariant ${inv.id} (${inv.name ?? "unnamed"})`;
    if (!inv.name) problems.push(`${tag}: missing name`);
    if (!inv.group) problems.push(`${tag}: missing group`);
    if (!inv.gate) problems.push(`${tag}: missing gate`);
    if (!VALID_STATUSES.includes(inv.status)) {
      problems.push(
        `${tag}: status '${inv.status}' is not allowed. The registry records ACTIVATION only ` +
          `('active' | 'not-yet-active'); pass/fail is COMPUTED by the runner, never stored (v3 §17: never fake green).`,
      );
      continue;
    }
    if (inv.status === "active") {
      const fitness = (inv.mechanisms ?? []).filter((m) => m.type === "fitness");
      if (fitness.length === 0) {
        problems.push(`${tag}: ACTIVE but maps to no runnable fitness mechanism - an active invariant nobody runs is fake green`);
      }
    } else {
      if (!inv.activatesWhen || inv.activatesWhen.trim() === "") {
        problems.push(`${tag}: not-yet-active but names no activation prerequisite (activatesWhen) - that is a silent deferral`);
      }
    }
    for (const m of inv.mechanisms ?? []) {
      if (!MECHANISM_TYPES.includes(m.type)) problems.push(`${tag}: unknown mechanism type '${m.type}'`);
      if (m.type === "ci-gate") {
        if (typeof m.command !== "string" || m.command.trim() === "") {
          problems.push(`${tag}: ci-gate '${m.ref}' must name the command its blocking job runs - a job NAME alone is satisfied by a comment or a path`);
        } else {
          const problem = ciJobRunProblem(deps.ciJobs, m.ref, m.command);
          if (problem !== undefined) problems.push(`${tag}: ${problem}`);
        }
      } else if (!deps.exists(m.ref)) {
        problems.push(`${tag}: mechanism ${m.type}:${m.ref} does not exist on disk`);
      }
    }
  }

  for (const id of ACTIVE_RATCHET) {
    const inv = invs.find((i) => i.id === id);
    if (!inv) continue; // already reported as missing above
    if (inv.status !== "active") problems.push(`invariant ${id}: shipped as 'active' but regressed to '${inv.status}' (the ratchet is monotonic)`);
  }
  return problems;
}

const registry = JSON.parse(readFileSync(root + "v3-invariants.json", "utf8")) as Registry;
const ciJobs = parseCiJobs(existsSync(root + ".github/workflows/ci.yml") ? readFileSync(root + ".github/workflows/ci.yml", "utf8") : "");

describe("v3-invariant registry fence", () => {
  it("enforces: the registry is complete, honest (activation-only), mapped to live mechanisms, and ratcheted", () => {
    const problems = validateRegistry(registry, { exists: (p) => existsSync(root + p), ciJobs });
    expect(problems, `v3-invariants.json problems:\n${problems.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a dishonest or hollow registry cannot pass", () => {
    const inv = (id: number, over: Partial<Invariant> = {}): Invariant => ({
      id,
      group: "g",
      gate: "A",
      name: `inv ${id}`,
      status: "not-yet-active",
      activatesWhen: "some prerequisite lands",
      mechanisms: [],
      ...over,
    });
    const full = (over: Map<number, Partial<Invariant>> = new Map()): Registry => ({
      invariants: Array.from({ length: 30 }, (_, k) => inv(k + 1, over.get(k + 1))),
    });
    const deps = {
      exists: () => true,
      ciJobs: parseCiJobs(
        ["name: ci", "jobs:", "  audit-chain-verify:", "    runs-on: ubuntu-latest", "    steps:", "      - run: pnpm audit:chain", ""].join("\n"),
      ),
    };
    // Ratcheted ids must be active in fixtures that test OTHER failure classes.
    const ratchetActive: Array<[number, Partial<Invariant>]> = ACTIVE_RATCHET.map((id) => [
      id,
      { status: "active", mechanisms: [{ type: "fitness", ref: "src/__tests__/fitness/x.test.ts" }] },
    ]);

    it("flags a stored pass/fail result masquerading as a status", () => {
      const reg = full(new Map<number, Partial<Invariant>>([...ratchetActive, [7, { status: "active-pass" }]]));
      expect(validateRegistry(reg, deps).some((p) => p.includes("never fake green"))).toBe(true);
    });
    it("flags an active invariant with no runnable fitness mechanism (fake green)", () => {
      const reg = full(new Map<number, Partial<Invariant>>([...ratchetActive, [7, { status: "active", mechanisms: [] }]]));
      expect(validateRegistry(reg, deps).some((p) => p.includes("fake green"))).toBe(true);
    });
    it("flags a not-yet-active invariant with no named activation prerequisite (silent deferral)", () => {
      const reg = full(new Map<number, Partial<Invariant>>([...ratchetActive, [8, { activatesWhen: "" }]]));
      expect(validateRegistry(reg, deps).some((p) => p.includes("silent deferral"))).toBe(true);
    });
    it("flags a mechanism pointing at a missing file and a ci-gate absent from ci.yml", () => {
      const reg = full(
        new Map<number, Partial<Invariant>>([
          ...ratchetActive,
          [
            9,
            {
              status: "active",
              mechanisms: [
                { type: "fitness", ref: "src/__tests__/fitness/ghost.test.ts" },
                { type: "ci-gate", ref: "ghost-gate", command: "pnpm ghost" },
              ],
            },
          ],
        ]),
      );
      const problems = validateRegistry(reg, { exists: (p) => !p.includes("ghost"), ciJobs: deps.ciJobs });
      expect(problems.some((p) => p.includes("does not exist on disk"))).toBe(true);
      expect(problems.some((p) => p.includes("ci job 'ghost-gate' is missing"))).toBe(true);
    });
    it("flags a ci-gate satisfied only by a NAME - the job must exist and run the declared command", () => {
      const named = full(
        new Map<number, Partial<Invariant>>([
          ...ratchetActive,
          [9, { status: "active", mechanisms: [{ type: "fitness", ref: "x.test.ts" }, { type: "ci-gate", ref: "audit-chain-verify" }] }],
        ]),
      );
      expect(validateRegistry(named, deps).some((p) => p.includes("must name the command its blocking job runs"))).toBe(true);
      const wrongCommand = full(
        new Map<number, Partial<Invariant>>([
          ...ratchetActive,
          [9, { status: "active", mechanisms: [{ type: "fitness", ref: "x.test.ts" }, { type: "ci-gate", ref: "audit-chain-verify", command: "pnpm lint" }] }],
        ]),
      );
      expect(validateRegistry(wrongCommand, deps).some((p) => p.includes("does not run 'pnpm lint'"))).toBe(true);
      const honest = full(
        new Map<number, Partial<Invariant>>([
          ...ratchetActive,
          [9, { status: "active", mechanisms: [{ type: "fitness", ref: "x.test.ts" }, { type: "ci-gate", ref: "audit-chain-verify", command: "pnpm audit:chain" }] }],
        ]),
      );
      expect(validateRegistry(honest, deps)).toEqual([]);
    });
    it("flags a ratcheted invariant regressing to not-yet-active, and a missing invariant", () => {
      const regressed = full(); // the ratcheted ids default to not-yet-active here
      expect(validateRegistry(regressed, deps).some((p) => p.includes("ratchet is monotonic"))).toBe(true);
      const twentyNine = full(new Map(ratchetActive));
      twentyNine.invariants = twentyNine.invariants.filter((i) => i.id !== 17);
      expect(validateRegistry(twentyNine, deps).some((p) => p.includes("missing from the registry: 17"))).toBe(true);
    });
    it("accepts a complete honest registry (cannot pass by always-failing)", () => {
      expect(validateRegistry(full(new Map(ratchetActive)), deps)).toEqual([]);
    });
  });
});
