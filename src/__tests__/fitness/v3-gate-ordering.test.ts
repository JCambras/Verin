import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ciJobRuns,
  gateOrderingProblems,
  gateReadiness,
  gatesNamedInProse,
  parseCiJobs,
  promptsNamedInProse,
  requiredInvariantIds,
  type Gate,
  type GateRequirement,
  type Registry,
} from "../../../scripts/v3-gates.lib";

/**
 * V3 GATE-ORDERING FENCE (ADR-0030; captain rulings `gate-a-ordering`,
 * `gatea-opus-review-1` and `gatea-fix-review-2`, 2026-07-28). A phase gate that
 * requires something which lands in a LATER wave is unreachable by construction
 * - the exact circular dependency that made Gate A (Wave A, prompts 4-7) require
 * invariant 3, whose prerequisite is prompt 10 in Wave B. Such a gate can only
 * ever be "passed" by lying about activation, which is precisely what v3 §17's
 * never-fake-green preamble forbids.
 *
 * The rules live in scripts/v3-gates.lib.ts because the BLOCKING RUNNER
 * (scripts/v3-invariants.ts) enforces the identical set before it prints a
 * report - the report is itself a document bound by ruling clause 5, so it may
 * not emit a claim this fence would reject. One core, two callers, no drift.
 * This file owns the ADVERSARIAL half (charter #4: detection is not
 * verification) plus the captain's ruled requirement sets and the two ratchets
 * that keep those sets from moving by a registry edit alone.
 *
 * The rules:
 *  (a) every gate is well-formed - an integer prompt range inside the 30-prompt
 *      sequence, and every requirement is a typed `invariant` | `artifact` |
 *      `fitness` | `ci-gate` | `evidence` entry naming its id/ref and prompt, and
 *      a `ci-gate` additionally names the command its blocking job must run (a
 *      job name matching a comment or a path is not evidence);
 *  (b) EMPTY SETS NEVER PROVE READINESS: a gate declaring no machine-checkable
 *      requirement is rejected, because it would read green on registration;
 *  (c) gates are totally ordered - their prompt ranges never overlap, so "later
 *      wave" is a decidable relation rather than a reading of prose;
 *  (d) ACTIVATION OWNERSHIP cannot drift: the gate named by an invariant's own
 *      `gate` field must require that invariant. Ownership ("where activation is
 *      proven") stays distinct from requirement ("what this gate needs to be
 *      green"), so another gate may REFERENCE an invariant it does not own -
 *      Gate C restates invariant 1 without taking it from Gate A, and Gate B
 *      requires invariant 16 (complete at prompt 9) though Gate E owns it;
 *  (e) THE ORDERING RULE, over every typed requirement: nothing a gate requires
 *      may land after that gate closes, decided from PROOF POINTS. An invariant
 *      is proven at the last of its `activationPrompts`, or - when it declares
 *      none - at the closing prompt of the gate that owns it, read off the
 *      canonical ordered gate ranges. So re-gating invariant 3 at A (proof point
 *      10 > gate A's 7) fails, and so does Gate A referencing invariant 7, which
 *      Gate D owns, even though invariant 7 is already active;
 *  (f) prose cannot drift from the structured field: every prompt number named
 *      in `activatesWhen` must appear in `activationPrompts`, so the ordering
 *      rule cannot be dodged by understating the prerequisite in the
 *      machine-readable field while the human-readable one names a later wave;
 *  (g) HONESTY: an invariant naming `activationArtifacts` may not be flipped to
 *      'active' until those artifacts exist on disk - the mechanical form of "no
 *      document, proof, or UI may claim invariant 3 is implemented before prompt
 *      10 exists" (ADR-0030);
 *  (h) an `entryCondition` naming another gate must name a REGISTERED gate that
 *      closes first - "Gate C is green" is only a requirement if Gate C exists.
 *
 * Registry completeness/honesty (status vocabulary, mechanism reachability, the
 * activation ratchet) is the neighbouring v3-invariants fence; this one owns the
 * gate model.
 */
const root = fileURLToPath(new URL("../../../", import.meta.url));

const registry = JSON.parse(readFileSync(root + "v3-invariants.json", "utf8")) as Registry;
const ciJobs = parseCiJobs(existsSync(root + ".github/workflows/ci.yml") ? readFileSync(root + ".github/workflows/ci.yml", "utf8") : "");

/** The nine gates of the ratified prompt sequence (docs/v3/verin-prompt-sequence-v3.md wave map). */
const RATIFIED_GATES: Record<string, [number, number]> = {
  "0": [1, 3],
  A: [4, 7],
  B: [8, 11],
  C: [12, 15],
  D: [16, 19],
  E: [20, 22],
  F: [23, 26],
  "G/H": [27, 29],
  I: [30, 30],
};

/**
 * RATCHET 1 - ACTIVATION OWNERSHIP for all 30 invariants (which gate must PROVE
 * each one). Gate assignment is load-bearing: it decides the ordering rule's
 * fallback proof point and which gate can never go green without the invariant.
 * Pushing an invariant to a later gate is the generic form of the escape hatch
 * that needed a captain ruling to use once, so it is pinned HERE, where review
 * sees the edit, and moving one is an amendment to ADR-0030 and ADR-0023.
 */
const GATE_ASSIGNMENT_RATCHET: Record<string, string> = {
  1: "A", 2: "A", 3: "B", 4: "A", 5: "A",
  6: "D", 7: "D", 8: "D", 9: "D", 10: "D", 11: "D", 12: "D", 13: "D",
  14: "E", 15: "E", 16: "E", 17: "E",
  18: "F", 19: "F", 20: "F", 21: "F", 22: "F", 23: "F", 24: "F", 25: "F",
  26: "G/H", 27: "G/H", 28: "G/H", 29: "G/H", 30: "G/H",
};

/**
 * RATCHET 2 - the invariant ids each gate REQUIRES green (a superset of what it
 * owns; the captain's ruled sets). Gate A is `{1, 2, 4, 5}` and invariant 3 is
 * required at Gate B (ruling `gate-a-ordering`). Gate C references invariant 1;
 * Gate B additionally requires invariant 16 and Gate C invariant 11, because
 * each is complete inside that gate's own prompt range (ruling
 * `gatea-fix-review-2`) - while invariant 6 stays a Gate D requirement, since it
 * needs prompt 15's bundle AND prompt 16's evaluator. Gates 0 and I are
 * artifact/evidence-based and require no invariant.
 */
const GATE_INVARIANT_REQUIREMENTS: Record<string, number[]> = {
  "0": [],
  A: [1, 2, 4, 5],
  B: [3, 16],
  C: [1, 11],
  D: [6, 7, 8, 9, 10, 11, 12, 13],
  E: [14, 15, 16, 17],
  F: [18, 19, 20, 21, 22, 23, 24, 25],
  "G/H": [26, 27, 28, 29, 30],
  I: [],
};

const ownershipOf = (reg: Registry): Record<string, string> => Object.fromEntries(reg.invariants.map((i) => [String(i.id), i.gate]));
const requirementsOf = (reg: Registry): Record<string, number[]> =>
  Object.fromEntries(Object.entries(reg.gates).map(([key, gate]) => [key, requiredInvariantIds(gate)]));
const clone = (reg: Registry): Registry => JSON.parse(JSON.stringify(reg)) as Registry;

describe("v3 gate-ordering fence", () => {
  it("enforces: nothing a phase gate requires lands after that gate closes", () => {
    const problems = gateOrderingProblems(registry, (p) => existsSync(root + p));
    expect(problems, `v3-invariants.json gate-ordering problems:\n${problems.join("\n")}`).toEqual([]);
  });

  it("enforces: every gate of the ratified prompt sequence is registered, over its ratified prompt range", () => {
    const registered = Object.fromEntries(Object.entries(registry.gates).map(([k, g]) => [k, g.prompts]));
    expect(registered).toEqual(RATIFIED_GATES);
  });

  it("enforces: the captain's Gate A/Gate B requirement sets (ADR-0030) are the ones in the registry", () => {
    expect(requiredInvariantIds(registry.gates.A)).toEqual([1, 2, 4, 5]);
    expect(requiredInvariantIds(registry.gates.B)).toContain(3);
    expect(registry.invariants.find((i) => i.id === 3)?.gate).toBe("B");
    // Invariant 3 may only be claimed implemented once prompt 10's artifacts exist,
    // whatever its status is at the time - the durable form of ruling clause 5.
    const three = registry.invariants.find((i) => i.id === 3)!;
    expect(three.activationArtifacts?.length ?? 0).toBeGreaterThan(0);
    if (three.status === "active") {
      for (const artifact of three.activationArtifacts ?? []) expect(existsSync(root + artifact), `${artifact} must exist`).toBe(true);
    }
  });

  it("enforces (ratchet): the ratified activation-ownership map of all 30 invariants", () => {
    expect(ownershipOf(registry)).toEqual(GATE_ASSIGNMENT_RATCHET);
  });

  it("enforces (ratchet): every gate's invariant requirement set is the ruled one", () => {
    expect(requirementsOf(registry)).toEqual(GATE_INVARIANT_REQUIREMENTS);
  });

  it("enforces: every ci-gate requirement names a blocking job that exists and runs its command", () => {
    const unproven = Object.entries(registry.gates).flatMap(([key, gate]) =>
      (gate.requires ?? [])
        .filter((r) => r.kind === "ci-gate")
        .filter((r) => !ciJobRuns(ciJobs, r.ref ?? "", r.command ?? ""))
        .map((r) => `gate ${key}: ci job '${r.ref}' does not run '${r.command}'`),
    );
    expect(unproven, unproven.join("\n")).toEqual([]);
  });

  it("enforces: a gate never reads green while any requirement is unmet or undecidable", () => {
    const views = gateReadiness(registry, {
      invariantState: (id) => (registry.invariants.find((i) => i.id === id)?.status === "active" ? "active-pass" : "not-yet-active"),
      exists: (p) => existsSync(root + p),
      ciRuns: (ref, command) => ciJobRuns(ciJobs, ref, command),
      fitnessPassed: () => true,
    });
    expect(views.map((v) => v.key)).toEqual(Object.keys(RATIFIED_GATES));
    for (const view of views) {
      const clean = view.requirements.every((r) => r.state === "met");
      expect(view.state === "green", `gate ${view.key} reads ${view.state} with requirements ${JSON.stringify(view.requirements.map((r) => [r.label, r.state]))}`).toBe(clean);
    }
  });

  describe("detects (companion): a circular, incomplete, or undecidable gate cannot pass", () => {
    const inv = (id: number): GateRequirement => ({ kind: "invariant", id });
    const gate = (wave: string, prompts: [number, number], requires: GateRequirement[]): Gate => ({
      wave,
      title: `wave ${wave}`,
      prompts,
      requires,
      entryCondition: "the prior wave has landed",
      outcome: "green",
    });
    // Mirrors the ruled shape: gate B REFERENCES invariant 16, which gate D owns
    // but which is complete at prompt 9 - inside B - while invariant 7 is already
    // active and owned by the later gate D.
    const base = (): Registry => ({
      gates: {
        A: gate("A", [4, 7], [inv(1)]),
        B: gate("B", [8, 11], [inv(3), inv(16)]),
        D: gate("D", [16, 19], [inv(7), inv(16)]),
      },
      invariants: [
        { id: 1, gate: "A", name: "one", status: "not-yet-active", activatesWhen: "the surface lands (Wave A prompt 6)", activationPrompts: [6] },
        { id: 3, gate: "B", name: "three", status: "not-yet-active", activatesWhen: "account opening becomes config (Wave B prompt 10)", activationPrompts: [10] },
        { id: 7, gate: "D", name: "seven", status: "active" },
        { id: 16, gate: "D", name: "sixteen", status: "not-yet-active", activatesWhen: "the closed policy AST lands (Wave B prompt 9)", activationPrompts: [9] },
      ],
    });

    it("flags the ORIGINAL defect: Gate A requiring invariant 3, whose prerequisite is prompt 10", () => {
      const reg = base();
      reg.invariants[1]!.gate = "A";
      reg.gates.A!.requires = [inv(1), inv(3)];
      reg.gates.B!.requires = [inv(1)];
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems.some((p) => p.includes("requires #3") && p.includes("not proven until prompt 10") && p.includes("AFTER this gate closes at prompt 7"))).toBe(true);
    });
    it("flags a gate REFERENCING an invariant a later gate owns (the same defect, by reference)", () => {
      const reg = base();
      reg.gates.A!.requires = [inv(1), inv(3)];
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems.some((p) => p.includes("activation owned by gate B") && p.includes("AFTER this gate closes at prompt 7"))).toBe(true);
    });
    it("flags a gate referencing an ALREADY-ACTIVE invariant a later gate owns (no prompt to short-circuit on)", () => {
      const reg = base();
      reg.gates.A!.requires = [inv(1), inv(7)];
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems.some((p) => p.includes("activation owned by gate D") && p.includes("where gate D proves its activation"))).toBe(true);
    });
    it("flags a referenced invariant whose activation prompts are dropped, so only its owner gate can place it", () => {
      const reg = base();
      // Gate B legitimately references invariant 16 (complete at prompt 9). Removing the
      // structured record of WHEN it landed leaves gate D's close as the only proof point.
      delete reg.invariants[3]!.activationPrompts;
      reg.invariants[3]!.status = "active";
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems.some((p) => p.includes("gate B") && p.includes("requires #16") && p.includes("AFTER this gate closes at prompt 11"))).toBe(true);
    });
    it("flags an invariant its own activation gate does not require (ownership drift)", () => {
      const reg = base();
      reg.gates.B!.requires = [{ kind: "artifact", ref: "config/domains/money-movement.yaml", prompt: 10 }];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("does not require it"))).toBe(true);
    });
    it("flags a gate with no machine-checkable requirement - an empty set would read green", () => {
      const reg = base();
      reg.gates.A!.requires = [{ kind: "evidence", ref: "a reviewer agrees the foundation is sound", prompt: 7 }];
      reg.invariants[0]!.gate = "B";
      reg.gates.B!.requires = [inv(1), inv(3)];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("no machine-checkable requirement"))).toBe(true);
    });
    it("flags a requirement that names no prompt, an unknown kind, and an unregistered invariant", () => {
      const noPrompt = base();
      noPrompt.gates.A!.requires = [inv(1), { kind: "artifact", ref: "config/domains/late.yaml" }];
      expect(gateOrderingProblems(noPrompt, () => true).some((p) => p.includes("must name the prompt"))).toBe(true);
      const badKind = base();
      badKind.gates.A!.requires = [inv(1), { kind: "vibes" as GateRequirement["kind"], ref: "trust me", prompt: 5 }];
      expect(gateOrderingProblems(badKind, () => true).some((p) => p.includes("is not one of"))).toBe(true);
      const ghost = base();
      ghost.gates.A!.requires = [inv(1), inv(99)];
      expect(gateOrderingProblems(ghost, () => true).some((p) => p.includes("which the registry does not define"))).toBe(true);
    });
    it("flags an 'evidence' requirement that does not say why nothing decides it (silent deferral)", () => {
      const reg = base();
      reg.gates.A!.requires = [inv(1), { kind: "evidence", ref: "a reviewer agrees the foundation is sound", prompt: 7 }];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("must carry a note saying why no mechanism decides it yet"))).toBe(true);
    });
    it("flags an artifact requirement produced by a prompt after its own gate closes", () => {
      const reg = base();
      reg.gates.A!.requires = [inv(1), { kind: "artifact", ref: "config/domains/account-opening.yaml", prompt: 10 }];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("AFTER this gate closes"))).toBe(true);
    });
    it("flags a ci-gate requirement that names a job but no command to prove it runs", () => {
      const reg = base();
      reg.gates.A!.requires = [inv(1), { kind: "ci-gate", ref: "e2e", prompt: 5 }];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("must name the command that blocking job runs"))).toBe(true);
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
      reg.gates.A!.requires = [inv(1), inv(3)];
      reg.gates.B!.requires = [inv(16)];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("understates the prose"))).toBe(true);
    });
    it("flags the same evasion written as a comma list or a conjunction, not just a range", () => {
      const comma = base();
      comma.invariants[1]!.activatesWhen = "the vocabulary and the migration land (Wave B prompts 9, 10)";
      comma.invariants[1]!.activationPrompts = [9];
      expect(gateOrderingProblems(comma, () => true).some((p) => p.includes("names prompt(s) 10"))).toBe(true);
      const conjunction = base();
      conjunction.invariants[1]!.activatesWhen = "the vocabulary and the migration land (Wave B prompts 9 and 10)";
      conjunction.invariants[1]!.activationPrompts = [9];
      expect(gateOrderingProblems(conjunction, () => true).some((p) => p.includes("names prompt(s) 10"))).toBe(true);
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
      undeclared.gates.A!.requires = [{ kind: "artifact", ref: "docs/demo-contract.md", prompt: 4 }];
      expect(gateOrderingProblems(undeclared, () => true).some((p) => p.includes("is not declared in gates"))).toBe(true);
      const overlapping = base();
      overlapping.gates.B!.prompts = [7, 11];
      expect(gateOrderingProblems(overlapping, () => true).some((p) => p.includes("overlap"))).toBe(true);
    });
    it("flags an entry condition that depends on a gate nothing can compute, or on a later one", () => {
      const ghost = base();
      ghost.gates.B!.entryCondition = "Gate C is green.";
      expect(gateOrderingProblems(ghost, () => true).some((p) => p.includes("is not registered - nothing can compute"))).toBe(true);
      const backwards = base();
      backwards.gates.A!.entryCondition = "Gate B is green.";
      expect(gateOrderingProblems(backwards, () => true).some((p) => p.includes("does not close before gate A opens"))).toBe(true);
    });
    it("flags the same entry condition written in lower case (the scanner is case-insensitive)", () => {
      const ghost = base();
      ghost.gates.B!.entryCondition = "gate c is green.";
      expect(gateOrderingProblems(ghost, () => true).some((p) => p.includes('"Gate C", which is not registered'))).toBe(true);
    });

    it("reads every accepted prompt spelling out of prose", () => {
      expect(promptsNamedInProse("the surface lands (Wave A prompt 6)")).toEqual([6]);
      expect(promptsNamedInProse("the planner lands (Wave F prompts 24-25) per ADR-0026")).toEqual([24, 25]);
      expect(promptsNamedInProse("the vocabulary then the migration (Wave B prompts 9, 10)")).toEqual([9, 10]);
      expect(promptsNamedInProse("Wave B may begin once prompts 5, 6, and 7 have landed")).toEqual([5, 6, 7]);
      expect(promptsNamedInProse("the §16 subjects (prompts 5 and 6) land first")).toEqual([5, 6]);
      expect(promptsNamedInProse("the bundle (Wave C prompt 15) and the evaluator (Wave D prompt 16)")).toEqual([15, 16]);
    });
    it("captures nothing that merely LOOKS like a prompt reference (ADR ids, sections, dates, counts)", () => {
      expect(promptsNamedInProse("no prompt numbers here at all (ADR-0010)")).toEqual([]);
      expect(promptsNamedInProse("ADR-0026 amends §17 and section 16 on 2026-07-28")).toEqual([]);
      expect(promptsNamedInProse("the prompt sequence pins 5 ratified documents")).toEqual([]);
      expect(promptsNamedInProse("marriage-map C10 covers invariants 1, 2, 4, 5")).toEqual([]);
      // A trailing non-numeric clause must not extend the list past its real end.
      expect(promptsNamedInProse("(Wave B prompt 10, marriage-map C10) then ADR-0025")).toEqual([10]);
    });
    it("reads gate keys case-insensitively, and only where a gate is actually named", () => {
      expect(gatesNamedInProse("gate c is green")).toEqual(["C"]);
      expect(gatesNamedInProse("Gate G/H is green: the full journey runs")).toEqual(["G/H"]);
      expect(gatesNamedInProse("Gate A's corrected requirements are green")).toEqual(["A"]);
      expect(gatesNamedInProse("the gate is green and the gateway is open")).toEqual([]);
    });

    it("proves a ci-gate only by a declared job that RUNS the command, not by a mention", () => {
      const jobs = parseCiJobs(
        [
          "name: ci",
          "jobs:",
          "  e2e:",
          "    steps:",
          "      - name: e2e + axe",
          "        run: pnpm test:e2e",
          "      # golden-cases screenshots are uploaded by e2e/demo-journey.spec.ts",
          "  quality:",
          "    steps:",
          "      - run: pnpm lint",
          "",
        ].join("\n"),
      );
      expect(ciJobRuns(jobs, "e2e", "pnpm test:e2e")).toBe(true);
      // named only in a comment - the substring shape that used to read "met"
      expect(ciJobRuns(jobs, "golden-cases", "pnpm golden:validate")).toBe(false);
      // the job exists but runs something else
      expect(ciJobRuns(jobs, "quality", "pnpm test:e2e")).toBe(false);
      // a requirement with no command can never be evidence
      expect(ciJobRuns(jobs, "e2e", "")).toBe(false);
      // and the real workflow still satisfies the registry's own ci-gates
      expect(ciJobRuns(ciJobs, "e2e", "pnpm test:e2e")).toBe(true);
      expect(ciJobRuns(ciJobs, "golden-cases", "pnpm golden:validate")).toBe(true);
      expect(ciJobRuns(ciJobs, "audit-chain-verify", "pnpm audit:chain")).toBe(true);
    });

    it("flags an invariant pushed to another gate, or a gate quietly dropping a ruled requirement", () => {
      const moved = clone(registry);
      moved.invariants.find((i) => i.id === 6)!.gate = "E";
      expect(ownershipOf(moved)).not.toEqual(GATE_ASSIGNMENT_RATCHET);
      const dropped = clone(registry);
      dropped.gates.A!.requires = dropped.gates.A!.requires.filter((r) => r.id !== 4);
      expect(requirementsOf(dropped)).not.toEqual(GATE_INVARIANT_REQUIREMENTS);
      // the pinned maps must match the registry they are pinning (no always-failing ratchet)
      expect(ownershipOf(registry)).toEqual(GATE_ASSIGNMENT_RATCHET);
      expect(requirementsOf(registry)).toEqual(GATE_INVARIANT_REQUIREMENTS);
    });

    it("accepts the corrected ordering (cannot pass by always-failing)", () => {
      expect(gateOrderingProblems(base(), () => true)).toEqual([]);
    });

    describe("readiness: registering a gate can never manufacture green", () => {
      const deps = { invariantState: () => "active-pass", exists: () => true, ciRuns: () => true, fitnessPassed: () => true };
      it("renders a requirement-less gate not-yet-verifiable even with everything else green", () => {
        const reg = base();
        reg.gates.A!.requires = [];
        const view = gateReadiness(reg, deps).find((v) => v.key === "A")!;
        expect(view.state).toBe("not-yet-verifiable");
      });
      it("renders a gate carrying an unmechanized outcome clause not-yet-verifiable", () => {
        const reg = base();
        reg.gates.A!.requires = [inv(1), { kind: "evidence", ref: "a reviewer agrees", prompt: 7 }];
        const view = gateReadiness(reg, deps).find((v) => v.key === "A")!;
        expect(view.state).toBe("not-yet-verifiable");
        expect(view.blocking).toEqual(["a reviewer agrees"]);
      });
      it("renders a gate green only when every typed requirement is met and decidable", () => {
        const reg = base();
        reg.gates.A!.requires = [inv(1), { kind: "artifact", ref: "docs/demo-contract.md", prompt: 5 }];
        expect(gateReadiness(reg, deps).find((v) => v.key === "A")!.state).toBe("green");
        expect(gateReadiness(reg, { ...deps, exists: () => false }).find((v) => v.key === "A")!.state).toBe("not-yet-green");
        expect(gateReadiness(reg, { ...deps, invariantState: () => "not-yet-active" }).find((v) => v.key === "A")!.blocking).toContain("#1");
      });
      it("holds a gate below green when its ci job exists but does not run the required command", () => {
        const reg = base();
        reg.gates.A!.requires = [inv(1), { kind: "ci-gate", ref: "e2e", command: "pnpm test:e2e", prompt: 5 }];
        expect(gateReadiness(reg, deps).find((v) => v.key === "A")!.state).toBe("green");
        const view = gateReadiness(reg, { ...deps, ciRuns: () => false }).find((v) => v.key === "A")!;
        expect(view.state).toBe("not-yet-green");
        expect(view.blocking).toContain("e2e");
      });
    });
  });
});
