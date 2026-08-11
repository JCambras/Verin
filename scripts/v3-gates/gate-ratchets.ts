/**
 * Gate-model ratchets (ADR-0055): the ratified prompt ranges, the 30-invariant
 * activation-ownership map, the complete cross-gate proof-point map, complete
 * gate metadata, and every gate's COMPLETE typed requirement set. Moving any of
 * these is an ADR-0055 + ADR-0023 amendment, never a registry edit alone.
 */
import {
  requirementKey,
  type Gate,
  type Registry,
} from "./model";
import { INVARIANT_THREE_ACTIVATION_REQUIREMENTS } from "./invariant-ratchets";

export const RATIFIED_GATE_RANGES: Readonly<
  Record<string, readonly [number, number]>
> = {
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

export const GATE_ASSIGNMENT_RATCHET: Readonly<
  Record<string, string>
> = {
  1: "A",
  2: "A",
  3: "B",
  4: "A",
  5: "A",
  6: "D",
  7: "D",
  8: "D",
  9: "D",
  10: "D",
  11: "D",
  12: "D",
  13: "D",
  14: "E",
  15: "E",
  16: "E",
  17: "E",
  18: "F",
  19: "F",
  20: "F",
  21: "F",
  22: "F",
  23: "F",
  24: "F",
  25: "F",
  26: "G",
  27: "H",
  28: "G",
  29: "H",
  30: "G",
};

export const EARLIEST_PROOF_PROMPTS_RATCHET: Readonly<
  Record<string, readonly number[]>
> = {
  1: [6],
  7: [5],
  8: [5],
  9: [5],
  11: [15],
  16: [9],
  18: [18],
  19: [18],
};

export type RatchetedGateMetadata = Pick<
  Gate,
  "wave" | "entryGates" | "entryCondition" | "outcome"
>;

export const GATE_METADATA_RATCHET: Readonly<
  Record<string, RatchetedGateMetadata>
> = {
  "0": {
    wave: "0",
    entryGates: [],
    entryCondition: "None - Wave 0 opens the build sequence.",
    outcome:
      "The seven-minute journey is clickable on static/fake data, every required screen exists, and the UI does not invent decisions (Wave 0, prompts 1-3; ADR-0027 labeled fakes).",
  },
  A: {
    wave: "A",
    entryGates: ["0"],
    entryCondition:
      "Gate 0 is green: Wave 0 (prompts 1-3) has landed and the seven-minute journey is clickable on labeled fake data (ADR-0027).",
    outcome:
      "Foundation invariants 1, 2, 4, and 5 are active and green (Wave A, prompts 4-7), and the prompt-5 structural guarantees of invariants 7, 8, and 9 are required at their earliest complete proof point without moving their Gate D activation ownership. Gate D later re-asserts invariants 7, 8, and 9 over evaluator behavior. Invariant 3 is NOT a Gate A requirement: its activation prerequisite is prompt 10, in Wave B, so requiring it here made Gate A unreachable by construction (ADR-0055).",
  },
  B: {
    wave: "B",
    entryGates: ["A"],
    entryCondition:
      "Wave B may not begin until prompts 5, 6, and 7 have landed AND Gate A is green: its owned foundation invariants 1, 2, 4, and 5 and its earliest-proof references to invariants 7, 8, and 9 are active and green (ADR-0055).",
    outcome:
      "Money movement and account opening are expressible as data and the golden corpus is stable; invariant 3 (no core module, directory, or evaluator branch named for a decision domain) is active and green once prompt 10 migrates the ADR-0010 account-opening flow definition into config/domains/, and invariant 16 (no arbitrary executable code in firm policy configuration) is active and green once prompt 9 lands the closed policy AST (Wave B, prompts 8-11; ADR-0055).",
  },
  C: {
    wave: "C",
    entryGates: ["B"],
    entryCondition:
      "Gate B is green: money movement and account opening are expressible as data (Wave B, prompts 8-11).",
    outcome:
      "The canonical request reaches a validated immutable input bundle with no PII in LLM artifacts (Wave C, prompts 12-15).",
  },
  D: {
    wave: "D",
    entryGates: ["C"],
    entryCondition:
      "Gate C is green: the canonical request reaches a validated immutable input bundle (Wave C, prompts 12-15).",
    outcome:
      "Proceed, blocked, and prohibited decisions replay byte-identically; decision-core invariants 6-13 green, and the prompt-18 authority/approval guarantees (invariants 18 and 19) are proven where they land (Wave D, prompts 16-19).",
  },
  E: {
    wave: "E",
    entryGates: ["D"],
    entryCondition: "Gate D is green.",
    outcome:
      "A natural-language draft becomes simulated and approved structured policy; policy invariants 14-17 green (Wave E, prompts 20-22).",
  },
  F: {
    wave: "F",
    entryGates: ["E"],
    entryCondition: "Gate E is green.",
    outcome:
      "Concurrent, repeated, failed, and delayed execution paths are safe and recorded; approval/execution invariants 18-25 green against fakes (Wave F, prompts 23-26).",
  },
  G: {
    wave: "G",
    entryGates: ["F"],
    entryCondition:
      "Gate F is green. Prompt 27 is DEFERRED pending sandbox access (ADR-0024); until the trigger fires no external status claim may be presented as real, and Phase 1 is never declared complete on fakes.",
    outcome:
      "The full journey uses a real Salesforce invocation and an honestly labeled returned status; the assembled vertical proves Firm B differs only through configuration and the printable record reconstructs from ledger + replay (invariants 26, 28, 30; Wave G, prompts 27-28).",
  },
  H: {
    wave: "H",
    entryGates: ["G"],
    entryCondition:
      "Gate G is green: the full journey uses a real Salesforce invocation with an honestly labeled returned status (Wave G, prompts 27-28).",
    outcome:
      "The demo runs in seven minutes and emits measured proof: the UI distinguishes every decision and execution state, the natural-language policy path is choreographed end to end, and a cold reviewer understands that Salesforce performs defined work while Verin determines, governs, and records the right work (invariants 27 and 29; Wave H, prompt 29; Phase 1 completion).",
  },
  I: {
    wave: "I",
    entryGates: ["H"],
    entryCondition:
      "Gate H is green: the demo runs in seven minutes on a real Salesforce invocation with an honestly labeled returned status.",
    outcome:
      "No unresolved critical finding; all accepted limitations are visible in the demo and documentation (Wave I, prompt 30).",
  },
};

export const GATE_REQUIREMENTS_RATCHET: Readonly<
  Record<string, readonly string[]>
> = {
  "0": [
    "artifact:docs/demo-contract.md @ prompt 1",
    "artifact:config/demo/scenarios.yaml @ prompt 1",
    "artifact:docs/golden-cases.md @ prompt 2",
    "ci-gate:golden-cases runs 'pnpm exec tsx scripts/golden-cases-validate.ts' @ prompt 2",
    "fitness:src/__tests__/fitness/demo-skeleton-honesty.test.ts @ prompt 3",
    "ci-gate:e2e runs 'pnpm exec playwright test' @ prompt 3",
    "fitness:src/__tests__/fitness/demo-surface-completeness.test.ts @ prompt 3",
  ],
  A: [
    "invariant:1",
    "invariant:2",
    "invariant:4",
    "invariant:5",
    "invariant:7",
    "invariant:8",
    "invariant:9",
  ],
  B: [
    "invariant:3",
    "invariant:16",
    "artifact:config/domains/account-opening.yaml @ prompt 10",
    "artifact:config/domains/money-movement.yaml @ prompt 10",
    "fitness:src/__tests__/fitness/domain-configuration.test.ts @ prompt 10",
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
    "evidence:prompt-17 evaluator property tests prove proceed emits authority and execution, blocked emits neither, and prohibited emits neither nor any resolving condition @ prompt 17",
    "invariant:10",
    "invariant:11",
    "invariant:12",
    "invariant:13",
    "invariant:18",
    "invariant:19",
  ],
  E: [
    "invariant:14",
    "invariant:15",
    "invariant:16",
    "invariant:17",
  ],
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

export const ownershipOf = (
  reg: Registry,
): Record<string, string> =>
  Object.fromEntries(
    reg.invariants.map((invariant) => [
      String(invariant.id),
      invariant.gate,
    ]),
  );

export const earliestProofPromptsOf = (
  reg: Registry,
): Record<string, readonly number[]> => {
  const crossGateRequirements = new Set(
    Object.entries(reg.gates).flatMap(([gateKey, gate]) =>
      gate.requires
        .filter((requirement) => {
          if (requirement.kind !== "invariant") return false;
          return reg.invariants.find(
            (invariant) => invariant.id === requirement.id,
          )?.gate !== gateKey;
        })
        .map((requirement) => requirement.id!),
    ),
  );
  return Object.fromEntries(
    reg.invariants
      .filter((invariant) => crossGateRequirements.has(invariant.id))
      .map((invariant) => [
        String(invariant.id),
        invariant.activationPrompts ?? [],
      ]),
  );
};

export const invariantThreeActivationOf = (reg: Registry) => {
  const invariant = reg.invariants.find(
    (candidate) => candidate.id === 3,
  );
  return {
    artifacts: invariant?.activationArtifacts ?? [],
    mechanisms: invariant?.activationMechanisms ?? [],
  };
};

export const metadataOf = (
  reg: Registry,
): Record<string, RatchetedGateMetadata> =>
  Object.fromEntries(
    Object.entries(reg.gates).map(([key, gate]) => [
      key,
      {
        wave: gate.wave,
        entryGates: gate.entryGates,
        entryCondition: gate.entryCondition,
        outcome: gate.outcome,
      },
    ]),
  );

export const requirementsOf = (
  reg: Registry,
): Record<string, readonly string[]> =>
  Object.fromEntries(
    Object.entries(reg.gates).map(([key, gate]) => [
      key,
      (gate.requires ?? []).map(requirementKey),
    ]),
  );

export function gateRatchetProblems(reg: Registry): string[] {
  const problems: string[] = [];
  const ranges = Object.fromEntries(
    Object.entries(reg.gates).map(([key, gate]) => [
      key,
      gate.prompts,
    ]),
  );
  const checks: Array<{
    label: string;
    expected: unknown;
    actual: unknown;
  }> = [
    {
      label: "ratified gate prompt ranges",
      expected: RATIFIED_GATE_RANGES,
      actual: ranges,
    },
    {
      label: "invariant activation ownership",
      expected: GATE_ASSIGNMENT_RATCHET,
      actual: ownershipOf(reg),
    },
    {
      label: "cross-gate invariant proof points",
      expected: EARLIEST_PROOF_PROMPTS_RATCHET,
      actual: earliestProofPromptsOf(reg),
    },
    {
      label: "invariant 3 activation prerequisites",
      expected: INVARIANT_THREE_ACTIVATION_REQUIREMENTS,
      actual: invariantThreeActivationOf(reg),
    },
    {
      label: "gate metadata",
      expected: GATE_METADATA_RATCHET,
      actual: metadataOf(reg),
    },
    {
      label: "complete typed gate requirements",
      expected: GATE_REQUIREMENTS_RATCHET,
      actual: requirementsOf(reg),
    },
  ];
  for (const check of checks) {
    if (
      JSON.stringify(check.actual) !==
      JSON.stringify(check.expected)
    ) {
      problems.push(
        `${check.label} drifted from the ADR-0055 ratchet; expected ${JSON.stringify(check.expected)}, received ${JSON.stringify(check.actual)}`,
      );
    }
  }
  return problems;
}
