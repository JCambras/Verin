import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ciJobBlocks,
  ciJobCommandStatus,
  ciJobRunProblem,
  ciJobRuns,
  gateOrderingProblems,
  gateReadiness,
  gatesNamedInProse,
  INVARIANT_THREE_ACTIVATION_REQUIREMENTS,
  parseCiJobs,
  promptsNamedInProse,
  requiredInvariantIds,
  type Gate,
  type GateRequirement,
  type Registry,
} from "../../../scripts/v3-gates.lib";

/**
 * V3 GATE-ORDERING FENCE (ADR-0030; captain rulings `gate-a-ordering`,
 * `gatea-opus-review-1`, `gatea-fix-review-2`, `gatea-review-3` and
 * `gatea-fix-review-3`, 2026-07-28). A phase gate that
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
 * verification) plus the captain's ruled requirement sets and the five ratchets
 * that keep those sets from moving by a registry edit alone: the 30-invariant
 * activation-ownership map, the prompt-5 proof points for invariants 7-9,
 * invariant 3's activation prerequisites, complete gate metadata, and every
 * gate's COMPLETE typed requirement set.
 *
 * The rules:
 *  (a) every gate is well-formed - an integer prompt range inside the 30-prompt
 *      sequence, and every requirement is a typed `invariant` | `artifact` |
 *      `fitness` | `ci-gate` | `evidence` entry naming its id/ref and prompt, and
 *      a `ci-gate` additionally names the command its blocking job must run - a
 *      job name matching a comment or a path is not evidence, and neither is a
 *      job that runs the command without blocking on it (`continue-on-error`, or
 *      a conditional that may exclude it from a normal push/PR run);
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
 *      10 > gate A's 7) fails, while Gate A can reference invariants 7, 8, and 9
 *      because their structural proof point is permanently recorded as prompt 5;
 *  (f) prose cannot drift from the structured field: every prompt number named
 *      in `activatesWhen` must appear in `activationPrompts`, so the ordering
 *      rule cannot be dodged by understating the prerequisite in the
 *      machine-readable field while the human-readable one names a later wave;
 *  (g) HONESTY: an invariant naming `activationArtifacts` or
 *      `activationMechanisms` may not be flipped to 'active' until every exact
 *      prerequisite exists and every mechanism is mapped to the invariant;
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

/**
 * The TEN gates of the ratified prompt sequence, over their ratified prompt ranges
 * (docs/v3/verin-prompt-sequence-v3.md wave map, lines 42-56). G (27-28, "the full
 * journey uses a real Salesforce invocation and an honestly labeled returned status")
 * and H (29, investor demo hardening) are two gates there, and are two gates here:
 * the registry's inherited `G/H` [27, 29] label let invariants provable at prompt 28
 * be required only by a gate closing at 29 (ruling `gatea-fix-review-3`).
 */
const RATIFIED_GATES: Record<string, [number, number]> = {
  "0": [1, 3],
  A: [4, 7],
  B: [8, 11],
  C: [12, 15],
  D: [16, 19],
  E: [20, 22],
  F: [23, 26],
  G: [27, 28],
  H: [29, 29],
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
  26: "G", 27: "H", 28: "G", 29: "H", 30: "G",
};

const EARLIEST_PROOF_PROMPTS_RATCHET: Record<string, number[]> = {
  7: [5],
  8: [5],
  9: [5],
};

const INVARIANT_THREE_ACTIVATION_RATCHET = {
  artifacts: [
    "config/domains/account-opening.yaml",
    "config/domains/money-movement.yaml",
  ],
  mechanisms: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/domain-configuration.test.ts",
    },
  ],
} as const;

type RatchetedGateMetadata = Pick<Gate, "wave" | "entryGates" | "entryCondition" | "outcome">;

const GATE_METADATA_RATCHET: Record<string, RatchetedGateMetadata> = {
  "0": {
    wave: "0",
    entryGates: [],
    entryCondition: "None - Wave 0 opens the build sequence.",
    outcome: "The seven-minute journey is clickable on static/fake data, every required screen exists, and the UI does not invent decisions (Wave 0, prompts 1-3; ADR-0027 labeled fakes).",
  },
  A: {
    wave: "A",
    entryGates: ["0"],
    entryCondition: "Gate 0 is green: Wave 0 (prompts 1-3) has landed and the seven-minute journey is clickable on labeled fake data (ADR-0027).",
    outcome: "Foundation invariants 1, 2, 4, and 5 are active and green (Wave A, prompts 4-7), and the prompt-5 structural guarantees of invariants 7, 8, and 9 are required at their earliest complete proof point without moving their Gate D activation ownership. Gate D later re-asserts invariants 7, 8, and 9 over evaluator behavior. Invariant 3 is NOT a Gate A requirement: its activation prerequisite is prompt 10, in Wave B, so requiring it here made Gate A unreachable by construction (ADR-0030).",
  },
  B: {
    wave: "B",
    entryGates: ["A"],
    entryCondition: "Wave B may not begin until prompts 5, 6, and 7 have landed AND Gate A is green: its owned foundation invariants 1, 2, 4, and 5 and its earliest-proof references to invariants 7, 8, and 9 are active and green (ADR-0030).",
    outcome: "Money movement and account opening are expressible as data and the golden corpus is stable; invariant 3 (no core module, directory, or evaluator branch named for a decision domain) is active and green once prompt 10 migrates the ADR-0010 account-opening flow definition into config/domains/, and invariant 16 (no arbitrary executable code in firm policy configuration) is active and green once prompt 9 lands the closed policy AST (Wave B, prompts 8-11; ADR-0030).",
  },
  C: {
    wave: "C",
    entryGates: ["B"],
    entryCondition: "Gate B is green: money movement and account opening are expressible as data (Wave B, prompts 8-11).",
    outcome: "The canonical request reaches a validated immutable input bundle with no PII in LLM artifacts (Wave C, prompts 12-15).",
  },
  D: {
    wave: "D",
    entryGates: ["C"],
    entryCondition: "Gate C is green: the canonical request reaches a validated immutable input bundle (Wave C, prompts 12-15).",
    outcome: "Proceed, blocked, and prohibited decisions replay byte-identically; decision-core invariants 6-13 green, and the prompt-18 authority/approval guarantees (invariants 18 and 19) are proven where they land (Wave D, prompts 16-19).",
  },
  E: {
    wave: "E",
    entryGates: ["D"],
    entryCondition: "Gate D is green.",
    outcome: "A natural-language draft becomes simulated and approved structured policy; policy invariants 14-17 green (Wave E, prompts 20-22).",
  },
  F: {
    wave: "F",
    entryGates: ["E"],
    entryCondition: "Gate E is green.",
    outcome: "Concurrent, repeated, failed, and delayed execution paths are safe and recorded; approval/execution invariants 18-25 green against fakes (Wave F, prompts 23-26).",
  },
  G: {
    wave: "G",
    entryGates: ["F"],
    entryCondition: "Gate F is green. Prompt 27 is DEFERRED pending sandbox access (ADR-0024); until the trigger fires no external status claim may be presented as real, and Phase 1 is never declared complete on fakes.",
    outcome: "The full journey uses a real Salesforce invocation and an honestly labeled returned status; the assembled vertical proves Firm B differs only through configuration and the printable record reconstructs from ledger + replay (invariants 26, 28, 30; Wave G, prompts 27-28).",
  },
  H: {
    wave: "H",
    entryGates: ["G"],
    entryCondition: "Gate G is green: the full journey uses a real Salesforce invocation with an honestly labeled returned status (Wave G, prompts 27-28).",
    outcome: "The demo runs in seven minutes and emits measured proof: the UI distinguishes every decision and execution state, the natural-language policy path is choreographed end to end, and a cold reviewer understands that Salesforce performs defined work while Verin determines, governs, and records the right work (invariants 27 and 29; Wave H, prompt 29; Phase 1 completion).",
  },
  I: {
    wave: "I",
    entryGates: ["H"],
    entryCondition: "Gate H is green: the demo runs in seven minutes on a real Salesforce invocation with an honestly labeled returned status.",
    outcome: "No unresolved critical finding; all accepted limitations are visible in the demo and documentation (Wave I, prompt 30).",
  },
};

/**
 * RATCHET 4 - the COMPLETE typed requirement set of every gate, not merely its
 * invariant ids. Pinning ids alone left a gate's `artifact` / `fitness` /
 * `ci-gate` / `evidence` requirements editable by a registry change nothing
 * ratcheted: gate 0's only non-met requirement is its `evidence` clause, so
 * deleting that one entry made every remaining requirement met and decidable and
 * rendered gate 0 GREEN, with both prior ratchets and every structural rule still
 * passing (ruling `gatea-fix-review-3`). A gate cannot be talked into readiness by
 * dropping what it cannot yet prove.
 *
 * The ruled sets: Gate A owns `{1, 2, 4, 5}` and references the prompt-5
 * structural guarantees `{7, 8, 9}`; invariant 3 is required at Gate B
 * (ruling `gate-a-ordering`). Gate C references invariant 1; Gate B additionally
 * requires invariant 16, Gate C invariant 11, and Gate D invariants 18 and 19,
 * because each is complete inside that gate's own prompt range (rulings
 * `gatea-fix-review-2`, `gatea-fix-review-3`) - while invariant 6 stays a Gate D
 * requirement only, since it needs prompt 15's bundle AND prompt 16's evaluator.
 * Gates 0 and I are artifact/evidence-based and require no invariant.
 */
const GATE_REQUIREMENTS_RATCHET: Record<string, string[]> = {
  "0": [
    "artifact:docs/demo-contract.md @ prompt 1",
    "artifact:config/demo/scenarios.yaml @ prompt 1",
    "artifact:docs/golden-cases.md @ prompt 2",
    "ci-gate:golden-cases runs 'pnpm golden:validate' @ prompt 2",
    "fitness:src/__tests__/fitness/demo-skeleton-honesty.test.ts @ prompt 3",
    "ci-gate:e2e runs 'pnpm test:e2e' @ prompt 3",
    "evidence:every demo-contract §4 required surface exists and is reachable in the walking skeleton @ prompt 3",
  ],
  A: ["invariant:1", "invariant:2", "invariant:4", "invariant:5", "invariant:7", "invariant:8", "invariant:9"],
  B: [
    "invariant:3",
    "invariant:16",
    "artifact:config/domains/account-opening.yaml @ prompt 10",
    "artifact:config/domains/money-movement.yaml @ prompt 10",
    "evidence:both domain YAML files parse against the domain schema and bind through the shared engine without domain-specific core branches @ prompt 10",
    "evidence:the deterministic replay corpus and signed golden fixtures are stable @ prompt 11",
  ],
  C: [
    "invariant:1",
    "invariant:11",
    "evidence:the canonical request reaches a validated immutable DecisionInputBundle (the prompts 12-15 acceptance tests) @ prompt 15",
  ],
  D: [
    "invariant:6",
    "invariant:7",
    "invariant:8",
    "invariant:9",
    "invariant:10",
    "invariant:11",
    "invariant:12",
    "invariant:13",
    "invariant:18",
    "invariant:19",
  ],
  E: ["invariant:14", "invariant:15", "invariant:16", "invariant:17"],
  F: [
    "invariant:18",
    "invariant:19",
    "invariant:20",
    "invariant:21",
    "invariant:22",
    "invariant:23",
    "invariant:24",
    "invariant:25",
    "evidence:verification reconciliation records delayed status and closes only when configured proof requirements are satisfied @ prompt 26",
  ],
  G: ["invariant:26", "invariant:28", "invariant:30"],
  H: [
    "invariant:27",
    "invariant:29",
    "evidence:the canonical journey completes within seven minutes without developer intervention @ prompt 29",
    "evidence:the measured results report exposes methodology, corpus version, and separate real-derived and synthetic provenance results @ prompt 29",
    "evidence:a cold reviewer understands that Salesforce performs defined work while Verin determines, governs, and records the right work @ prompt 29",
  ],
  I: [
    "artifact:docs/reviews/phase-1-adversarial-audit.md @ prompt 30",
    "evidence:no unresolved critical finding; every accepted limitation is visible in the demo and the documentation @ prompt 30",
  ],
};

/** Every requirement identified by kind, id/ref, proof prompt, and the command a ci-gate must prove. */
const requirementKey = (r: GateRequirement): string =>
  r.kind === "invariant"
    ? `invariant:${r.id}`
    : `${r.kind}:${r.ref}${r.kind === "ci-gate" ? ` runs '${r.command}'` : ""} @ prompt ${r.prompt}`;

const ownershipOf = (reg: Registry): Record<string, string> => Object.fromEntries(reg.invariants.map((i) => [String(i.id), i.gate]));
const earliestProofPromptsOf = (reg: Registry): Record<string, number[]> =>
  Object.fromEntries(
    reg.invariants
      .filter((invariant) => Object.hasOwn(EARLIEST_PROOF_PROMPTS_RATCHET, String(invariant.id)))
      .map((invariant) => [String(invariant.id), invariant.activationPrompts ?? []]),
  );
const invariantThreeActivationOf = (reg: Registry) => {
  const invariant = reg.invariants.find((candidate) => candidate.id === 3);
  return {
    artifacts: invariant?.activationArtifacts ?? [],
    mechanisms: invariant?.activationMechanisms ?? [],
  };
};
const metadataOf = (reg: Registry): Record<string, RatchetedGateMetadata> =>
  Object.fromEntries(
    Object.entries(reg.gates).map(([key, gate]) => [
      key,
      { wave: gate.wave, entryGates: gate.entryGates, entryCondition: gate.entryCondition, outcome: gate.outcome },
    ]),
  );
const requirementsOf = (reg: Registry): Record<string, string[]> =>
  Object.fromEntries(Object.entries(reg.gates).map(([key, gate]) => [key, (gate.requires ?? []).map(requirementKey)]));
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
    expect(requiredInvariantIds(registry.gates.A)).toEqual([1, 2, 4, 5, 7, 8, 9]);
    expect(requiredInvariantIds(registry.gates.B)).toContain(3);
    expect(registry.invariants.find((i) => i.id === 3)?.gate).toBe("B");
    // Invariant 3 may only be claimed implemented once prompt 10's artifacts exist,
    // whatever its status is at the time - the durable form of ruling clause 5.
    const three = registry.invariants.find((i) => i.id === 3)!;
    expect(INVARIANT_THREE_ACTIVATION_REQUIREMENTS).toEqual(INVARIANT_THREE_ACTIVATION_RATCHET);
    expect(invariantThreeActivationOf(registry)).toEqual(INVARIANT_THREE_ACTIVATION_RATCHET);
    if (three.status === "active") {
      for (const artifact of three.activationArtifacts ?? []) expect(existsSync(root + artifact), `${artifact} must exist`).toBe(true);
    }
  });

  it("enforces (ratchet): the ratified activation-ownership map of all 30 invariants", () => {
    expect(ownershipOf(registry)).toEqual(GATE_ASSIGNMENT_RATCHET);
  });

  it("enforces (ratchet): invariants 7, 8, and 9 retain their prompt-5 proof point", () => {
    expect(earliestProofPromptsOf(registry)).toEqual(EARLIEST_PROOF_PROMPTS_RATCHET);
  });

  it("enforces (ratchet): every gate's wave, structural entry condition, and outcome are the ruled ones", () => {
    expect(metadataOf(registry)).toEqual(GATE_METADATA_RATCHET);
  });

  it("enforces (ratchet): every gate's COMPLETE typed requirement set is the ruled one", () => {
    expect(requirementsOf(registry)).toEqual(GATE_REQUIREMENTS_RATCHET);
  });

  it("enforces: every ci-gate requirement names a blocking job that exists and runs its command", () => {
    const unproven = Object.entries(registry.gates).flatMap(([key, gate]) =>
      (gate.requires ?? [])
        .filter((r) => r.kind === "ci-gate")
        .flatMap((r) => {
          const problem = ciJobRunProblem(ciJobs, r.ref ?? "", r.command ?? "");
          return problem === undefined ? [] : [`gate ${key}: ${problem}`];
        }),
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
      const clean = view.requirements.every((r) => r.state === "met") && view.entryBlocking.length === 0;
      expect(view.state === "green", `gate ${view.key} reads ${view.state} with requirements ${JSON.stringify(view.requirements.map((r) => [r.label, r.state]))}`).toBe(clean);
    }
  });

  describe("detects (companion): a circular, incomplete, or undecidable gate cannot pass", () => {
    const inv = (id: number): GateRequirement => ({ kind: "invariant", id });
    const gate = (wave: string, prompts: [number, number], requires: GateRequirement[], entryGates: string[] = []): Gate => ({
      wave,
      title: `wave ${wave}`,
      prompts,
      requires,
      entryGates,
      entryCondition: entryGates.length === 0 ? "None." : `Gate ${entryGates.join(" and Gate ")} is green.`,
      outcome: "green",
    });
    // Mirrors the ruled shape: gates A and B reference invariants proved inside
    // their prompt ranges while later gates retain activation ownership.
    const base = (): Registry => ({
      gates: {
        A: gate("A", [4, 7], [inv(1), inv(7)]),
        B: gate("B", [8, 11], [inv(3), inv(16)], ["A"]),
        D: gate("D", [16, 19], [inv(7), inv(16)], ["B"]),
      },
      invariants: [
        { id: 1, gate: "A", name: "one", status: "not-yet-active", activatesWhen: "the surface lands (Wave A prompt 6)", activationPrompts: [6] },
        {
          id: 3,
          gate: "B",
          name: "three",
          status: "not-yet-active",
          activatesWhen: "account opening becomes config (Wave B prompt 10)",
          activationPrompts: [10],
          activationArtifacts: [...INVARIANT_THREE_ACTIVATION_RATCHET.artifacts],
          activationMechanisms: INVARIANT_THREE_ACTIVATION_RATCHET.mechanisms.map((mechanism) => ({
            ...mechanism,
          })),
        },
        { id: 7, gate: "D", name: "seven", status: "active", activationPrompts: [5] },
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
    it("accepts an already-active invariant at its recorded earliest proof point without moving ownership", () => {
      const reg = base();
      reg.gates.A!.requires = [inv(1), inv(7)];
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems).toEqual([]);
    });
    it("flags invalid activation prompts on an active invariant", () => {
      const reg = base();
      reg.invariants[2]!.activationPrompts = [0];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("invariant 7") && p.includes("prompt numbers in 1-30"))).toBe(true);
    });
    it("flags an early reference when its recorded proof point is dropped", () => {
      const reg = base();
      delete reg.invariants[2]!.activationPrompts;
      const problems = gateOrderingProblems(reg, () => true);
      expect(problems.some((p) => p.includes("gate A") && p.includes("activation owned by gate D") && p.includes("where gate D proves its activation"))).toBe(true);
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
      ghost.gates.B!.entryGates = ["C"];
      ghost.gates.B!.entryCondition = "Gate C is green.";
      expect(gateOrderingProblems(ghost, () => true).some((p) => p.includes("is not registered - nothing can compute"))).toBe(true);
      const backwards = base();
      backwards.gates.A!.entryGates = ["B"];
      backwards.gates.A!.entryCondition = "Gate B is green.";
      expect(gateOrderingProblems(backwards, () => true).some((p) => p.includes("does not close before gate A opens"))).toBe(true);
    });
    it("flags entry-condition prose that is not encoded as a structural predecessor", () => {
      const reg = base();
      reg.gates.B!.entryGates = [];
      expect(gateOrderingProblems(reg, () => true).some((p) => p.includes("entryCondition names Gate A") && p.includes("does not structurally require it"))).toBe(true);
      const missing = base();
      delete (missing.gates.B as Partial<Gate>).entryGates;
      expect(gateOrderingProblems(missing, () => true).some((p) => p.includes("entryGates must be an array"))).toBe(true);
    });
    it("flags the same entry condition written in lower case (the scanner is case-insensitive)", () => {
      const ghost = base();
      ghost.gates.B!.entryGates = ["C"];
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
      expect(gatesNamedInProse("Gate H is green: the demo runs in seven minutes")).toEqual(["H"]);
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
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: e2e + axe",
          "        run: pnpm test:e2e",
          "      # golden-cases screenshots are uploaded by e2e/demo-journey.spec.ts",
          "  quality:",
          "    runs-on: ubuntu-latest",
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

    it("refuses a command that survives only as a SHELL comment inside a block scalar", () => {
      // A `#` inside `run: |` is literal script text, not YAML syntax, so the YAML
      // parser hands the whole line over - the shell is what disables it. Counting it
      // would let a PR switch a blocking gate off and keep its invariant reading green.
      const jobs = parseCiJobs(
        [
          "name: ci",
          "jobs:",
          "  audit-chain-verify:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          "          # pnpm audit:chain temporarily disabled while we debug",
          "          echo skip",
          "",
        ].join("\n"),
      );
      expect(jobs.get("audit-chain-verify")?.commands).toEqual(["echo skip"]);
      expect(ciJobRuns(jobs, "audit-chain-verify", "pnpm audit:chain")).toBe(false);
      // but a `#` inside a quoted argument stays part of a dedicated command
      const quoted = parseCiJobs(
        ["name: ci", "jobs:", "  audit-chain-verify:", "    runs-on: ubuntu-latest", "    steps:", "      - run: pnpm audit:chain '# strict'", ""].join("\n"),
      );
      expect(ciJobRuns(quoted, "audit-chain-verify", "pnpm audit:chain '# strict'")).toBe(true);
      expect(ciJobRuns(quoted, "audit-chain-verify", "pnpm audit:chain")).toBe(false);
    });

    it("keeps every job declared after a column-0 comment inside the jobs block", () => {
      const jobs = parseCiJobs(
        [
          "name: ci",
          "jobs:",
          "  quality:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: pnpm lint",
          "# ---- verification gates ----",
          "  audit-chain-verify:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: pnpm audit:chain",
          "",
        ].join("\n"),
      );
      expect([...jobs.keys()]).toEqual(["quality", "audit-chain-verify"]);
      expect(ciJobRuns(jobs, "audit-chain-verify", "pnpm audit:chain")).toBe(true);
    });

    it("refuses a command that appears only in a step name, an env value, or a path", () => {
      const jobs = parseCiJobs(
        [
          "name: ci",
          "jobs:",
          "  audit-chain-verify:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: pnpm audit:chain",
          "        run: echo hello",
          "      - run: echo goodbye",
          "        env:",
          "          FALLBACK: pnpm audit:chain",
          "      - uses: ./.github/actions/pnpm-audit-chain",
          "",
        ].join("\n"),
      );
      expect(jobs.get("audit-chain-verify")?.commands).toEqual(["echo hello", "echo goodbye"]);
      expect(ciJobRuns(jobs, "audit-chain-verify", "pnpm audit:chain")).toBe(false);
    });

    it("refuses substring mentions, short-circuited commands, heredocs, and neutralized exit status", () => {
      const scripts = [
        "echo 'pnpm audit:chain'",
        "false && pnpm audit:chain",
        "cat <<EOF\npnpm audit:chain\nEOF",
        "pnpm audit:chain || true",
      ];
      for (const script of scripts) {
        const jobs = parseCiJobs(
          ["name: ci", "jobs:", "  audit-chain-verify:", "    runs-on: ubuntu-latest", "    steps:", "      - run: |", ...script.split("\n").map((line) => `          ${line}`), ""].join(
            "\n",
          ),
        );
        expect(ciJobCommandStatus(jobs, "audit-chain-verify", "pnpm audit:chain").state, script).toBe("unsafe-shell");
        expect(ciJobRuns(jobs, "audit-chain-verify", "pnpm audit:chain"), script).toBe(false);
      }
    });

    it("resolves workflow, job, and step shells and rejects unsupported execution semantics", () => {
      const workflow = (workflowShell: string, jobShell: string, stepShell: string) =>
        parseCiJobs(
          [
            "name: ci",
            ...(workflowShell === "" ? [] : ["defaults:", "  run:", `    shell: ${workflowShell}`]),
            "jobs:",
            "  audit-chain-verify:",
            "    runs-on: ubuntu-latest",
            ...(jobShell === "" ? [] : ["    defaults:", "      run:", `        shell: ${jobShell}`]),
            "    steps:",
            ...(stepShell === "" ? [] : [`      - shell: ${stepShell}`]),
            ...(stepShell === "" ? ["      - run: pnpm audit:chain"] : ["        run: pnpm audit:chain"]),
            "",
          ].join("\n"),
        );
      const status = (workflowShell: string, jobShell: string, stepShell: string) =>
        ciJobCommandStatus(workflow(workflowShell, jobShell, stepShell), "audit-chain-verify", "pnpm audit:chain");

      expect(status("echo {0}", "", "")).toEqual({ state: "unsafe-shell", reason: "unsupported shell 'echo {0}'" });
      expect(status("bash", "echo {0}", "")).toEqual({ state: "unsafe-shell", reason: "unsupported shell 'echo {0}'" });
      expect(status("bash", "sh", "echo {0}")).toEqual({ state: "unsafe-shell", reason: "unsupported shell 'echo {0}'" });
      expect(status("echo {0}", "bash", "")).toEqual({ state: "proven" });
      expect(status("bash", "echo {0}", "sh")).toEqual({ state: "proven" });
      expect(
        ciJobCommandStatus(
          parseCiJobs(["jobs:", "  audit-chain-verify:", "    steps:", "      - run: pnpm audit:chain", ""].join("\n")),
          "audit-chain-verify",
          "pnpm audit:chain",
        ),
      ).toEqual({ state: "unsafe-shell", reason: "implicit shell on unsupported runner 'undefined'" });
    });

    it("refuses a job that runs the command but cannot fail the build (continue-on-error, or a condition)", () => {
      const workflow = (jobLevel: string, stepLevel: string) =>
        parseCiJobs(
          [
            "name: ci",
            "jobs:",
            "  audit-chain-verify:",
            "    runs-on: ubuntu-latest",
            ...(jobLevel === "" ? [] : [`    ${jobLevel}`]),
            "    steps:",
            "      - name: seed + verify org audit chains",
            ...(stepLevel === "" ? [] : [`        ${stepLevel}`]),
            "        run: pnpm audit:chain",
            "",
          ].join("\n"),
        );
      const proves = (jobLevel: string, stepLevel: string) => ciJobRuns(workflow(jobLevel, stepLevel), "audit-chain-verify", "pnpm audit:chain");

      // the command is present and correct in every one of these - and disabled
      expect(proves("continue-on-error: true", "")).toBe(false);
      expect(proves("", "continue-on-error: true")).toBe(false);
      expect(proves("if: ${{ github.event_name == 'schedule' }}", "")).toBe(false);
      expect(proves("", "if: ${{ false }}")).toBe(false);
      expect(ciJobCommandStatus(workflow("", "continue-on-error: true"), "audit-chain-verify", "pnpm audit:chain")).toEqual({
        state: "neutralized",
        reason: "step continue-on-error: true",
      });
      // a neutralized job is not even a BLOCKING job, which is all charter-drift asks
      expect(ciJobBlocks(workflow("continue-on-error: true", ""), "audit-chain-verify")).toBe(false);
      expect(ciJobBlocks(workflow("if: ${{ github.ref == 'refs/heads/nope' }}", ""), "audit-chain-verify")).toBe(false);
      expect(workflow("continue-on-error: true", "").get("audit-chain-verify")?.neutralizedBy).toBe("continue-on-error: true");

      // and the unneutralized shape - plus an explicit `continue-on-error: false` - still proves it
      expect(proves("", "")).toBe(true);
      expect(proves("continue-on-error: false", "continue-on-error: false")).toBe(true);
      expect(ciJobBlocks(workflow("", ""), "audit-chain-verify")).toBe(true);
      expect(ciJobBlocks(workflow("", ""), "no-such-job")).toBe(false);
      // the real workflow's blocking jobs are blocking
      for (const ref of ["e2e", "golden-cases", "audit-chain-verify", "v3-invariants", "test"]) expect(ciJobBlocks(ciJobs, ref), ref).toBe(true);
    });

    it("does not treat malformed, empty, unsupported, or fully skipped jobs as blocking", () => {
      const jobs = parseCiJobs(
        [
          "jobs:",
          "  malformed: null",
          "  empty:",
          "    runs-on: ubuntu-latest",
          "    steps: []",
          "  uses-only:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - uses: actions/checkout@v7",
          "  unsupported:",
          "    runs-on: windows-latest",
          "    steps:",
          "      - run: pnpm lint",
          "  skipped:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - if: false",
          "        run: pnpm lint",
          "  blocking:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: pnpm lint",
          "",
        ].join("\n"),
      );
      for (const ref of ["malformed", "empty", "uses-only", "unsupported", "skipped"]) {
        expect(ciJobBlocks(jobs, ref), ref).toBe(false);
      }
      expect(ciJobBlocks(jobs, "blocking")).toBe(true);
    });

    it("refuses an evidence job with a needs dependency that can prevent it from running", () => {
      const jobs = parseCiJobs(
        [
          "jobs:",
          "  disabled:",
          "    runs-on: ubuntu-latest",
          "    if: false",
          "    steps:",
          "      - run: echo disabled",
          "  audit-chain-verify:",
          "    runs-on: ubuntu-latest",
          "    needs: disabled",
          "    steps:",
          "      - run: pnpm audit:chain",
          "",
        ].join("\n"),
      );
      expect(ciJobRuns(jobs, "audit-chain-verify", "pnpm audit:chain")).toBe(false);
      expect(ciJobBlocks(jobs, "audit-chain-verify")).toBe(false);
      expect(ciJobRunProblem(jobs, "audit-chain-verify", "pnpm audit:chain")).toContain("needs: disabled");
    });

    it("requires a dedicated command step and still reads a folded simple command", () => {
      const jobs = parseCiJobs(
        [
          "name: ci",
          "jobs:",
          "  audit-chain-verify:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: |",
          "          pnpm db:seed",
          "          pnpm audit:chain --strict",
          "  sast:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: >-",
          "          semgrep scan",
          "          --error",
          "",
        ].join("\n"),
      );
      expect(jobs.get("audit-chain-verify")?.commands).toEqual([]);
      expect(jobs.get("audit-chain-verify")?.steps[0]?.commands).toEqual(["pnpm db:seed", "pnpm audit:chain --strict"]);
      expect(ciJobRuns(jobs, "audit-chain-verify", "pnpm audit:chain")).toBe(false);
      expect(ciJobRuns(jobs, "audit-chain-verify", "pnpm db:seed pnpm audit:chain")).toBe(false);
      expect(ciJobRuns(jobs, "sast", "semgrep scan --error")).toBe(true);
    });

    it("yields no jobs from a workflow it cannot parse, so every ci-gate reads unmet", () => {
      const jobs = parseCiJobs(["jobs:", "  quality:", "    steps: [unbalanced", ""].join("\n"));
      expect(jobs.size).toBe(0);
      expect(ciJobRuns(jobs, "quality", "pnpm lint")).toBe(false);
      expect(ciJobRunProblem(jobs, "quality", "pnpm lint")).toContain("is missing");
    });

    it("diagnoses a neutralized command separately from a missing command", () => {
      const neutralized = parseCiJobs(
        ["jobs:", "  quality:", "    runs-on: ubuntu-latest", "    steps:", "      - continue-on-error: true", "        run: pnpm lint", ""].join("\n"),
      );
      const missing = parseCiJobs(["jobs:", "  quality:", "    runs-on: ubuntu-latest", "    steps:", "      - run: pnpm typecheck", ""].join("\n"));
      expect(ciJobRunProblem(neutralized, "quality", "pnpm lint")).toContain("neutralized by step continue-on-error: true");
      expect(ciJobRunProblem(missing, "quality", "pnpm lint")).toContain("does not run");
    });

    it("flags an invariant pushed to another gate, or a gate quietly dropping a ruled requirement", () => {
      const moved = clone(registry);
      moved.invariants.find((i) => i.id === 6)!.gate = "E";
      expect(ownershipOf(moved)).not.toEqual(GATE_ASSIGNMENT_RATCHET);
      const dropped = clone(registry);
      dropped.gates.A!.requires = dropped.gates.A!.requires.filter((r) => r.id !== 4);
      expect(requirementsOf(dropped)).not.toEqual(GATE_REQUIREMENTS_RATCHET);
      const movedPrompt = clone(registry);
      movedPrompt.gates.B!.requires.find((r) => r.kind === "artifact")!.prompt = 9;
      expect(requirementsOf(movedPrompt)).not.toEqual(GATE_REQUIREMENTS_RATCHET);
      const falsifiedEarlyProof = clone(registry);
      falsifiedEarlyProof.invariants.find((i) => i.id === 7)!.activationPrompts = [1];
      expect(earliestProofPromptsOf(falsifiedEarlyProof)).not.toEqual(EARLIEST_PROOF_PROMPTS_RATCHET);
      const weakenedActivation = clone(registry);
      weakenedActivation.invariants.find((i) => i.id === 3)!.activationMechanisms = [
        { type: "fitness", ref: "src/__tests__/fitness/no-bare-throw.test.ts" },
      ];
      expect(invariantThreeActivationOf(weakenedActivation)).not.toEqual(INVARIANT_THREE_ACTIVATION_RATCHET);
      const droppedActivationArtifact = clone(registry);
      droppedActivationArtifact.invariants.find((i) => i.id === 3)!.activationArtifacts = [
        "config/domains/account-opening.yaml",
      ];
      expect(invariantThreeActivationOf(droppedActivationArtifact)).not.toEqual(
        INVARIANT_THREE_ACTIVATION_RATCHET,
      );
      const relinked = clone(registry);
      relinked.gates.B!.entryGates = [];
      relinked.gates.B!.entryCondition = "None.";
      expect(metadataOf(relinked)).not.toEqual(GATE_METADATA_RATCHET);
      const renamedWave = clone(registry);
      renamedWave.gates.B!.wave = "Vocabulary";
      expect(metadataOf(renamedWave)).not.toEqual(GATE_METADATA_RATCHET);
      const narrowedOutcome = clone(registry);
      narrowedOutcome.gates.B!.outcome = "Both domain files exist.";
      expect(metadataOf(narrowedOutcome)).not.toEqual(GATE_METADATA_RATCHET);
      const softenedEntry = clone(registry);
      softenedEntry.gates.B!.entryCondition = "Gate A is advisory.";
      expect(metadataOf(softenedEntry)).not.toEqual(GATE_METADATA_RATCHET);
      // the pinned maps must match the registry they are pinning (no always-failing ratchet)
      expect(ownershipOf(registry)).toEqual(GATE_ASSIGNMENT_RATCHET);
      expect(metadataOf(registry)).toEqual(GATE_METADATA_RATCHET);
      expect(requirementsOf(registry)).toEqual(GATE_REQUIREMENTS_RATCHET);
    });

    it("refuses to activate invariant 3 with an unrelated or missing domain-configuration proof", () => {
      const unpinned = clone(registry);
      delete unpinned.invariants.find((invariant) => invariant.id === 3)!.activationMechanisms;
      expect(gateOrderingProblems(unpinned, () => true)).toContain(
        "invariant 3 (No core module, directory, or evaluator branch is named for a decision domain): activation requires the two prompt-10 domain artifacts and exact domain-configuration fitness mechanism pinned by ADR-0030",
      );

      const unrelated = clone(registry);
      const three = unrelated.invariants.find((invariant) => invariant.id === 3)!;
      three.status = "active";
      three.mechanisms = [
        { type: "fitness", ref: "src/__tests__/fitness/no-bare-throw.test.ts" },
      ];
      expect(gateOrderingProblems(unrelated, () => true)).toContain(
        "invariant 3 (No core module, directory, or evaluator branch is named for a decision domain): marked 'active' without required activation mechanism fitness:src/__tests__/fitness/domain-configuration.test.ts - an unrelated fitness mechanism cannot prove this activation boundary (ADR-0030)",
      );

      const missing = clone(registry);
      const activeThree = missing.invariants.find((invariant) => invariant.id === 3)!;
      activeThree.status = "active";
      activeThree.mechanisms = [
        {
          type: "fitness",
          ref: "src/__tests__/fitness/domain-configuration.test.ts",
        },
      ];
      const problems = gateOrderingProblems(
        missing,
        (path) => path !== "src/__tests__/fitness/domain-configuration.test.ts",
      );
      expect(problems.some((problem) => problem.includes("required activation mechanism") && problem.includes("does not exist"))).toBe(true);
    });

    it("holds Gate B below green until both domain files are schema-valid and bound through the shared engine", () => {
      const reg = clone(registry);
      reg.gates = {
        B: {
          ...reg.gates.B!,
          entryGates: [],
          entryCondition: "None.",
          requires: reg.gates.B!.requires.filter(
            (requirement) =>
              requirement.kind === "artifact" ||
              requirement.ref === "both domain YAML files parse against the domain schema and bind through the shared engine without domain-specific core branches",
          ),
        },
      };
      const deps = { invariantState: () => "active-pass", exists: () => true, ciRuns: () => true, fitnessPassed: () => true };
      expect(gateReadiness(reg, deps)[0]!.state).toBe("not-yet-verifiable");
      reg.gates.B!.requires = reg.gates.B!.requires.filter((requirement) => requirement.kind !== "evidence");
      expect(gateReadiness(reg, deps)[0]!.state).toBe("green");
      expect(requirementsOf(reg)).not.toEqual(GATE_REQUIREMENTS_RATCHET);
    });

    it("flags a gate DELETING the requirement it cannot yet prove - the one-line edit that turned gate 0 green", () => {
      // Gate 0's every other requirement is already met on disk and in ci.yml, so its
      // lone `evidence` clause is the only thing holding it below green.
      const gutted = clone(registry);
      gutted.gates["0"]!.requires = gutted.gates["0"]!.requires.filter((r) => r.kind !== "evidence");
      expect(gateOrderingProblems(gutted, () => true)).toEqual([]); // every structural rule still passes...
      expect(requirementsOf(gutted)).not.toEqual(GATE_REQUIREMENTS_RATCHET); // ...and the ratchet is what catches it
      const view = gateReadiness(gutted, {
        invariantState: () => "active-pass",
        exists: () => true,
        ciRuns: () => true,
        fitnessPassed: () => true,
      }).find((v) => v.key === "0")!;
      expect(view.state).toBe("green");
      // Downgrading it to a weaker kind is the same escape, and is caught the same way.
      const weakened = clone(registry);
      weakened.gates.C!.requires = weakened.gates.C!.requires.map((r) => (r.kind === "evidence" ? { ...r, kind: "artifact" as const, ref: "docs/demo-contract.md" } : r));
      expect(requirementsOf(weakened)).not.toEqual(GATE_REQUIREMENTS_RATCHET);
      // and a swapped ci-gate command, which no id-only pin could see
      const swapped = clone(registry);
      swapped.gates["0"]!.requires.find((r) => r.kind === "ci-gate")!.command = "pnpm lint";
      expect(requirementsOf(swapped)).not.toEqual(GATE_REQUIREMENTS_RATCHET);
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
        expect(view.undecidable).toEqual(["a reviewer agrees"]);
      });
      it("never understates what a gate awaits: an unmet requirement does not hide the undecidable ones", () => {
        // The evidence clause holds the gate below green AFTER #1 goes green, so a
        // reader planning the wave has to be told about it while #1 is still unmet.
        const reg = base();
        reg.gates.A!.requires = [inv(1), { kind: "evidence", ref: "a reviewer agrees", prompt: 7 }];
        const view = gateReadiness(reg, { ...deps, invariantState: () => "not-yet-active" }).find((v) => v.key === "A")!;
        expect(view.state).toBe("not-yet-green");
        expect(view.blocking).toEqual(["#1", "a reviewer agrees"]);
        expect(view.undecidable).toEqual(["a reviewer agrees"]);
      });
      it("holds a gate below green while any structural predecessor is non-green", () => {
        const reg = base();
        const views = gateReadiness(reg, {
          ...deps,
          invariantState: (id) => (id === 1 ? "not-yet-active" : "active-pass"),
        });
        const gateA = views.find((view) => view.key === "A")!;
        const gateB = views.find((view) => view.key === "B")!;
        expect(gateA.state).toBe("not-yet-green");
        expect(gateB.requirements.every((requirement) => requirement.state === "met")).toBe(true);
        expect(gateB.state).toBe("not-yet-green");
        expect(gateB.entryBlocking).toEqual(["Gate A entry condition"]);
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
