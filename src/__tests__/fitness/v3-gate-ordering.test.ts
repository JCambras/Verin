import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * V3 GATE-ORDERING FENCE (ADR-0030; captain ruling of 2026-07-28). A phase gate
 * that requires an invariant whose activation prerequisite lands in a LATER wave
 * is unreachable by construction - the exact circular dependency that made Gate A
 * (Wave A, prompts 4-7) require invariant 3, whose prerequisite is prompt 10 in
 * Wave B. Such a gate can only ever be "passed" by lying about activation, which
 * is precisely what v3 §17's never-fake-green preamble forbids. This fence makes
 * the ordering structural:
 *  (a) every invariant's gate key exists in `gates`, and each gate declares a
 *      well-formed prompt range inside the 30-prompt sequence;
 *  (b) gates are totally ordered - their prompt ranges never overlap, so "later
 *      wave" is a decidable relation rather than a reading of prose;
 *  (c) `gates.<G>.requires` EQUALS the set of invariants carrying gate <G> - the
 *      captain's requirement set ("Gate A requires 1, 2, 4, and 5") is checked
 *      against the registry rather than restated in prose that can drift;
 *  (d) THE ORDERING RULE: every not-yet-active invariant declares the prompts
 *      that activate it, and the last of them lands at or before its gate's last
 *      prompt. Re-gating invariant 3 at A (prerequisite prompt 10 > gate A's
 *      prompt 7) fails here;
 *  (e) prose cannot drift from the structured field: every prompt number named in
 *      `activatesWhen` must appear in `activationPrompts`, so the ordering rule
 *      cannot be dodged by understating the prerequisite in the machine-readable
 *      field while the human-readable one still names a later wave;
 *  (f) HONESTY: an invariant naming `activationArtifacts` may not be flipped to
 *      'active' until those artifacts exist on disk - the mechanical form of "no
 *      document, proof, or UI may claim invariant 3 is implemented before prompt
 *      10 exists" (ADR-0030).
 *
 * Registry completeness/honesty (status vocabulary, mechanism reachability, the
 * activation ratchet) is the neighbouring v3-invariants fence; this one owns only
 * the gate/wave ordering relation.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));

/** The v3 build sequence is exactly 30 prompts (docs/v3/verin-prompt-sequence-v3.md). */
const LAST_PROMPT = 30;

export interface Gate {
  wave: string;
  title: string;
  prompts: [number, number];
  requires: number[];
  entryCondition: string;
  outcome: string;
}
export interface Invariant {
  id: number;
  gate: string;
  name: string;
  status: string;
  activatesWhen: string;
  activationPrompts?: number[];
  activationArtifacts?: string[];
}
export interface Registry {
  gates: Record<string, Gate>;
  invariants: Invariant[];
}

/** Prompt numbers named in prose: "prompt 6", "prompts 24-25", "prompts 5-7". */
export function promptsNamedInProse(prose: string): number[] {
  const out = new Set<number>();
  for (const m of prose.matchAll(/prompts?\s+(\d+)(?:\s*[-–—]\s*(\d+))?/gi)) {
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Pure core: returns human-readable ordering problems (empty == the constitution is acyclic). */
export function gateOrderingProblems(reg: Registry, exists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  const gates = reg.gates ?? {};
  const invs = reg.invariants ?? [];

  // (a) well-formed gates
  for (const [key, gate] of Object.entries(gates)) {
    const range = gate.prompts;
    if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => Number.isInteger(n))) {
      problems.push(`gate ${key}: prompts must be an integer [first, last] range`);
      continue;
    }
    const [first, last] = range;
    if (first < 1 || last > LAST_PROMPT || first > last) {
      problems.push(`gate ${key}: prompt range [${first}, ${last}] is outside the 1-${LAST_PROMPT} build sequence or inverted`);
    }
  }

  // (b) gates are totally ordered - overlapping ranges make "later wave" undecidable
  const ranges = Object.entries(gates)
    .filter(([, g]) => Array.isArray(g.prompts) && g.prompts.length === 2)
    .sort((a, b) => a[1].prompts[0] - b[1].prompts[0]);
  for (let i = 1; i < ranges.length; i += 1) {
    const [prevKey, prev] = ranges[i - 1]!;
    const [key, gate] = ranges[i]!;
    if (gate.prompts[0] <= prev.prompts[1]) {
      problems.push(
        `gates ${prevKey} [${prev.prompts.join("-")}] and ${key} [${gate.prompts.join("-")}] overlap - ` +
          `gate order must be a total order for the ordering rule to be decidable`,
      );
    }
  }

  // (c) the declared requirement set equals the registry's own gate assignment
  const derived = new Map<string, number[]>();
  for (const inv of invs) {
    if (!(inv.gate in gates)) {
      problems.push(`invariant ${inv.id}: gate '${inv.gate}' is not declared in gates - a gate with no prompt range cannot be ordered`);
      continue;
    }
    derived.set(inv.gate, [...(derived.get(inv.gate) ?? []), inv.id]);
  }
  const asKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(",");
  for (const [key, gate] of Object.entries(gates)) {
    const actual = asKey(derived.get(key) ?? []);
    const declared = asKey(gate.requires ?? []);
    if (actual !== declared) {
      problems.push(`gate ${key}: declares requires [${declared}] but the registry assigns invariants [${actual}] to it - one of the two drifted`);
    }
  }

  for (const inv of invs) {
    const gate = gates[inv.gate];
    if (!gate || !Array.isArray(gate.prompts)) continue;
    const tag = `invariant ${inv.id} (${inv.name})`;
    const closesAt = gate.prompts[1];

    if (inv.status === "not-yet-active") {
      const declared = inv.activationPrompts;
      if (!Array.isArray(declared) || declared.length === 0) {
        problems.push(`${tag}: not-yet-active but declares no activationPrompts - its prerequisite cannot be ordered against gate ${inv.gate}`);
      } else if (!declared.every((n) => Number.isInteger(n) && n >= 1 && n <= LAST_PROMPT)) {
        problems.push(`${tag}: activationPrompts must be prompt numbers in 1-${LAST_PROMPT}, got [${declared.join(", ")}]`);
      } else {
        // (d) THE ORDERING RULE
        const lands = Math.max(...declared);
        if (lands > closesAt) {
          problems.push(
            `${tag}: gated at ${inv.gate} (wave ${gate.wave}, prompts ${gate.prompts.join("-")}) but its activation ` +
              `prerequisite is prompt ${lands}, which lands AFTER that gate closes. The gate could never go green ` +
              `without faking activation - move the invariant to the gate that covers prompt ${lands} (ADR-0030).`,
          );
        }
        // (e) prose may not name a later prompt than the structured field admits
        const inProse = promptsNamedInProse(inv.activatesWhen ?? "");
        const unlisted = inProse.filter((n) => !declared.includes(n));
        if (unlisted.length > 0) {
          problems.push(`${tag}: activatesWhen names prompt(s) ${unlisted.join(", ")} that activationPrompts omits - the structured prerequisite understates the prose`);
        }
      }
    }

    // (f) an artifact-gated invariant cannot be declared implemented before its artifacts exist
    for (const artifact of inv.activationArtifacts ?? []) {
      if (inv.status === "active" && !exists(artifact)) {
        problems.push(`${tag}: marked 'active' but its activation artifact ${artifact} does not exist - claiming an unimplemented invariant (ADR-0030)`);
      }
    }
  }

  return problems;
}

const registry = JSON.parse(readFileSync(root + "v3-invariants.json", "utf8")) as Registry;

describe("v3 gate-ordering fence", () => {
  it("enforces: no phase gate requires an invariant whose activation prerequisite lands in a later wave", () => {
    const problems = gateOrderingProblems(registry, (p) => existsSync(root + p));
    expect(problems, `v3-invariants.json gate-ordering problems:\n${problems.join("\n")}`).toEqual([]);
  });

  it("enforces: the captain's Gate A/Gate B requirement sets (ADR-0030) are the ones in the registry", () => {
    expect(registry.gates.A?.requires).toEqual([1, 2, 4, 5]);
    expect(registry.gates.B?.requires).toEqual([3]);
    const three = registry.invariants.find((i) => i.id === 3);
    expect(three?.gate).toBe("B");
    // Honest until prompt 10 exists - never asserted as implemented.
    expect(three?.status).toBe("not-yet-active");
  });

  describe("detects (companion): a circular or mis-ordered gate cannot pass", () => {
    const gate = (wave: string, prompts: [number, number], requires: number[]): Gate => ({
      wave,
      title: `wave ${wave}`,
      prompts,
      requires,
      entryCondition: "prior gate green",
      outcome: "green",
    });
    const base = (): Registry => ({
      gates: { A: gate("A", [4, 7], [1]), B: gate("B", [8, 11], [3]) },
      invariants: [
        { id: 1, gate: "A", name: "one", status: "not-yet-active", activatesWhen: "the surface lands (Wave A prompt 6)", activationPrompts: [6] },
        { id: 3, gate: "B", name: "three", status: "not-yet-active", activatesWhen: "account opening becomes config (Wave B prompt 10)", activationPrompts: [10] },
      ],
    });

    it("flags the ORIGINAL defect: Gate A requiring invariant 3, whose prerequisite is prompt 10", () => {
      const reg = base();
      reg.invariants[1]!.gate = "A";
      reg.gates.A!.requires = [1, 3];
      reg.gates.B!.requires = [];
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems.some((p) => p.includes("lands AFTER that gate closes"))).toBe(true);
    });
    it("flags a requirement set that drifted from the registry's gate assignment", () => {
      const reg = base();
      reg.gates.A!.requires = [1, 3];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("one of the two drifted"))).toBe(true);
    });
    it("flags a not-yet-active invariant with no declared activation prompt", () => {
      const reg = base();
      delete reg.invariants[0]!.activationPrompts;
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("declares no activationPrompts"))).toBe(true);
    });
    it("flags prose that names a later prompt than the structured prerequisite admits", () => {
      const reg = base();
      reg.invariants[1]!.activationPrompts = [6];
      reg.invariants[1]!.gate = "A";
      reg.gates.A!.requires = [1, 3];
      reg.gates.B!.requires = [];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("understates the prose"))).toBe(true);
    });
    it("flags an invariant claimed 'active' before its activation artifact exists", () => {
      const reg = base();
      reg.invariants[1]!.status = "active";
      reg.invariants[1]!.activationArtifacts = ["config/domains/account-opening.yaml"];
      expect(gateOrderingProblems(reg, () => false).some((p) => p.includes("claiming an unimplemented invariant"))).toBe(true);
    });
    it("flags a gate whose key no invariant range can order (undeclared gate, overlapping ranges)", () => {
      const undeclared = base();
      undeclared.invariants[0]!.gate = "C";
      undeclared.gates.A!.requires = [];
      expect(gateOrderingProblems(undeclared, () => true).some((p) => p.includes("is not declared in gates"))).toBe(true);
      const overlapping = base();
      overlapping.gates.B!.prompts = [7, 11];
      expect(gateOrderingProblems(overlapping, () => true).some((p) => p.includes("overlap"))).toBe(true);
    });
    it("reads prompt ranges out of prose, not just single numbers", () => {
      expect(promptsNamedInProse("the planner lands (Wave F prompts 24-25) per ADR-0026")).toEqual([24, 25]);
      expect(promptsNamedInProse("no prompt numbers here at all (ADR-0010)")).toEqual([]);
    });
    it("accepts the corrected ordering (cannot pass by always-failing)", () => {
      expect(gateOrderingProblems(base(), () => true)).toEqual([]);
    });
  });
});
