import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  gateOrderingProblems,
  gateReadiness,
  promptsNamedInProse,
  requiredInvariantIds,
  type Gate,
  type GateRequirement,
  type Registry,
} from "../../../scripts/v3-gates.lib";

/**
 * V3 GATE-ORDERING FENCE (ADR-0030; captain rulings `gate-a-ordering` and
 * `gatea-opus-review-1`, 2026-07-28). A phase gate that requires something which
 * lands in a LATER wave is unreachable by construction - the exact circular
 * dependency that made Gate A (Wave A, prompts 4-7) require invariant 3, whose
 * prerequisite is prompt 10 in Wave B. Such a gate can only ever be "passed" by
 * lying about activation, which is precisely what v3 §17's never-fake-green
 * preamble forbids.
 *
 * The rules live in scripts/v3-gates.lib.ts because the BLOCKING RUNNER
 * (scripts/v3-invariants.ts) enforces the identical set before it prints a
 * report - the report is itself a document bound by ruling clause 5, so it may
 * not emit a claim this fence would reject. One core, two callers, no drift.
 * This file owns the ADVERSARIAL half (charter #4: detection is not
 * verification) plus the captain's ruled requirement sets.
 *
 * The rules:
 *  (a) every gate is well-formed - an integer prompt range inside the 30-prompt
 *      sequence, and every requirement is a typed `invariant` | `artifact` |
 *      `fitness` | `ci-gate` | `evidence` entry naming its id/ref and prompt;
 *  (b) EMPTY SETS NEVER PROVE READINESS: a gate declaring no machine-checkable
 *      requirement is rejected, because it would read green on registration;
 *  (c) gates are totally ordered - their prompt ranges never overlap, so "later
 *      wave" is a decidable relation rather than a reading of prose;
 *  (d) ACTIVATION OWNERSHIP cannot drift: the gate named by an invariant's own
 *      `gate` field must require that invariant. Ownership ("where activation is
 *      proven") stays distinct from requirement ("what this gate needs to be
 *      green"), so a later gate may REFERENCE an invariant an earlier gate owns
 *      - Gate C restates invariant 1 without taking it from Gate A;
 *  (e) THE ORDERING RULE, over every typed requirement: nothing a gate requires
 *      may land after that gate closes. Re-gating invariant 3 at A (prerequisite
 *      prompt 10 > gate A's prompt 7) fails here;
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
    expect(requiredInvariantIds(registry.gates.B)).toEqual([3]);
    expect(registry.invariants.find((i) => i.id === 3)?.gate).toBe("B");
    // Invariant 3 may only be claimed implemented once prompt 10's artifacts exist,
    // whatever its status is at the time - the durable form of ruling clause 5.
    const three = registry.invariants.find((i) => i.id === 3)!;
    expect(three.activationArtifacts?.length ?? 0).toBeGreaterThan(0);
    if (three.status === "active") {
      for (const artifact of three.activationArtifacts ?? []) expect(existsSync(root + artifact), `${artifact} must exist`).toBe(true);
    }
  });

  it("enforces: a gate never reads green while any requirement is unmet or undecidable", () => {
    const views = gateReadiness(registry, {
      invariantState: (id) => (registry.invariants.find((i) => i.id === id)?.status === "active" ? "active-pass" : "not-yet-active"),
      exists: (p) => existsSync(root + p),
      ciDeclares: () => true,
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
    const base = (): Registry => ({
      gates: { A: gate("A", [4, 7], [inv(1)]), B: gate("B", [8, 11], [inv(3)]) },
      invariants: [
        { id: 1, gate: "A", name: "one", status: "not-yet-active", activatesWhen: "the surface lands (Wave A prompt 6)", activationPrompts: [6] },
        { id: 3, gate: "B", name: "three", status: "not-yet-active", activatesWhen: "account opening becomes config (Wave B prompt 10)", activationPrompts: [10] },
      ],
    });

    it("flags the ORIGINAL defect: Gate A requiring invariant 3, whose prerequisite is prompt 10", () => {
      const reg = base();
      reg.invariants[1]!.gate = "A";
      reg.gates.A!.requires = [inv(1), inv(3)];
      reg.gates.B!.requires = [inv(1)];
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems.some((p) => p.includes("lands AFTER that gate closes"))).toBe(true);
    });
    it("flags a gate REFERENCING an invariant a later gate owns (the same defect, by reference)", () => {
      const reg = base();
      reg.gates.A!.requires = [inv(1), inv(3)];
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems.some((p) => p.includes("activation is owned by gate B") && p.includes("lands AFTER that gate closes"))).toBe(true);
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
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("lands AFTER that gate closes"))).toBe(true);
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
      reg.gates.B!.requires = [inv(1)];
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
    it("reads prompt ranges and gate keys out of prose, not just single numbers", () => {
      expect(promptsNamedInProse("the planner lands (Wave F prompts 24-25) per ADR-0026")).toEqual([24, 25]);
      expect(promptsNamedInProse("no prompt numbers here at all (ADR-0010)")).toEqual([]);
    });
    it("accepts the corrected ordering (cannot pass by always-failing)", () => {
      expect(gateOrderingProblems(base(), () => true)).toEqual([]);
    });

    describe("readiness: registering a gate can never manufacture green", () => {
      const deps = { invariantState: () => "active-pass", exists: () => true, ciDeclares: () => true, fitnessPassed: () => true };
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
    });
  });
});
