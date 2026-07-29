/**
 * V3 PHASE-GATE MODEL - the SHARED core of the gate constitution (ADR-0030;
 * captain rulings `gate-a-ordering`, `gatea-opus-review-1`, `gatea-fix-review-2`,
 * `gatea-review-3` and `gatea-fix-review-3`, 2026-07-28).
 *
 * Both checkers of `v3-invariants.json` import this module, so the blocking
 * runner (scripts/v3-invariants.ts, CI job `v3-invariants`) and the fitness
 * fence (src/__tests__/fitness/v3-gate-ordering.test.ts) cannot drift apart:
 * the fence proves these rules reject real violations, the runner refuses to
 * PRINT a report that violates them. Same split as scripts/golden-cases.lib.ts.
 * The CI half of it (`parseCiJobs`) is the repo's ONE structured CI authority -
 * the registry fence and the charter-drift fence read the workflow through it too.
 *
 * TWO SEPARATE RELATIONS (the review-round correction):
 *  - ACTIVATION OWNERSHIP - `invariant.gate` names the one gate at which that
 *    invariant's activation is proven. It is pinned, for all 30 invariants, by
 *    the ratchet in the fence, so it cannot be moved by a registry edit alone.
 *  - GATE REQUIREMENT - `gates.<G>.requires` lists what <G> needs to be green.
 *    A gate MUST require every invariant it owns (so ownership cannot drift
 *    silently) and MAY additionally reference invariants owned by other gates,
 *    plus artifacts, fences, and CI gates. v3's Gate C, for instance, restates
 *    "no PII in LLM artifacts" (invariant 1) without taking it from Gate A, and
 *    Gate A requires the prompt-5 structural guarantees of invariants 7, 8, and
 *    9 while Gate D owns their activation; Gate B requires invariant 16, whose
 *    closed policy-AST prohibition is proven at prompt 9 though Gate E owns it.
 *
 * THE ORDERING RULE: nothing a gate requires may land after that gate closes.
 * A gate that requires something unreachable inside its own wave can only ever
 * be "passed" by lying about activation - the circular Gate A dependency this
 * ADR removed, and exactly what v3 §17's never-fake-green preamble forbids.
 *
 * The ordering rule is decided from a requirement's PROOF POINT - the prompt by
 * which it is fully proven (see `proofPoint`). For an invariant that declares
 * `activationPrompts`, that is the last of them; for one that does not, it is
 * the closing prompt of the gate that OWNS its activation, read off the
 * canonical ordered gate ranges. Reading an already-active invariant as "lands
 * at prompt 0" is what previously let a gate reference an invariant a LATER gate
 * owns and still pass (ruling `gatea-fix-review-2`).
 */
import { parse as parseYaml } from "yaml";

/** The v3 build sequence is exactly 30 prompts (docs/v3/verin-prompt-sequence-v3.md). */
export const LAST_PROMPT = 30;

/** Requirement kinds this repo can DECIDE by itself. */
export const MECHANIZED_KINDS = ["invariant", "artifact", "fitness", "ci-gate"] as const;
/** `evidence` names an outcome clause with no executable proof yet - it can never read green. */
export const REQUIREMENT_KINDS = [...MECHANIZED_KINDS, "evidence"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export interface GateRequirement {
  kind: RequirementKind;
  /** `invariant` only: the v3 §17 invariant number this gate requires green. */
  id?: number;
  /** every other kind: the path, fence file, or CI job name. */
  ref?: string;
  /** every non-invariant kind: the prompt whose landing produces it. */
  prompt?: number;
  /** `ci-gate` only: the command the named blocking job must actually run. */
  command?: string;
  note?: string;
}

export interface Gate {
  wave: string;
  title: string;
  prompts: [number, number];
  requires: GateRequirement[];
  entryGates: string[];
  entryCondition: string;
  outcome: string;
}

export interface Invariant {
  id: number;
  gate: string;
  name: string;
  status: string;
  activatesWhen?: string;
  activationPrompts?: number[];
  activationArtifacts?: string[];
  activationMechanisms?: Array<{ type: "fitness"; ref: string }>;
  mechanisms?: InvariantMechanism[];
}

export interface Registry {
  gates: Record<string, Gate>;
  invariants: Invariant[];
}

export interface InvariantMechanism {
  type: string;
  ref: string;
  command?: string;
}

export const ACTIVE_MECHANISM_RATCHET: Readonly<
  Record<number, readonly InvariantMechanism[]>
> = {
  2: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/org-id-required.test.ts",
    },
    {
      type: "fitness",
      ref: "src/__tests__/fitness/decision-core-tenant-scope.test.ts",
    },
  ],
  5: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/audited-write-required.test.ts",
    },
    {
      type: "ci-gate",
      ref: "audit-chain-verify",
      command: "pnpm exec tsx scripts/audit-chain-verify.ts",
    },
    {
      type: "file",
      ref: "src/infrastructure/store/migrations.ts",
    },
  ],
  7: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/decision-core-illegal-states.test.ts",
    },
  ],
  8: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/decision-core-illegal-states.test.ts",
    },
  ],
  9: [
    {
      type: "fitness",
      ref: "src/__tests__/fitness/decision-core-illegal-states.test.ts",
    },
  ],
};

export const ACTIVE_RATCHET = Object.keys(
  ACTIVE_MECHANISM_RATCHET,
).map(Number);

function mechanismTuples(
  mechanisms: readonly InvariantMechanism[],
): Array<[string, string, string | null]> {
  return mechanisms.map((mechanism) => [
    mechanism.type,
    mechanism.ref,
    mechanism.command ?? null,
  ]);
}

export function activeInvariantRatchetProblems(
  reg: Pick<Registry, "invariants">,
): string[] {
  const problems: string[] = [];
  const activeIds = reg.invariants
    .filter((invariant) => invariant.status === "active")
    .map((invariant) => invariant.id)
    .sort((left, right) => left - right);
  const ratchetedIds = [...ACTIVE_RATCHET].sort(
    (left, right) => left - right,
  );
  if (JSON.stringify(activeIds) !== JSON.stringify(ratchetedIds)) {
    problems.push(
      `active invariant ids must exactly match the shipped mechanism ratchet; expected ${JSON.stringify(ratchetedIds)}, received ${JSON.stringify(activeIds)}`,
    );
  }
  for (const id of ACTIVE_RATCHET) {
    const invariant = reg.invariants.find((candidate) => candidate.id === id);
    if (invariant === undefined) continue;
    if (invariant.status !== "active") {
      problems.push(
        `invariant ${id}: shipped as 'active' but regressed to '${invariant.status}' (the ratchet is monotonic)`,
      );
    }
    const expected = mechanismTuples(
      ACTIVE_MECHANISM_RATCHET[id] ?? [],
    );
    const actual = mechanismTuples(invariant.mechanisms ?? []);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(
        `invariant ${id}: shipped mechanism set drifted; expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    }
  }
  return problems;
}

export const INVARIANT_THREE_ACTIVATION_REQUIREMENTS = {
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
  7: [5],
  8: [5],
  9: [5],
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
      "Foundation invariants 1, 2, 4, and 5 are active and green (Wave A, prompts 4-7), and the prompt-5 structural guarantees of invariants 7, 8, and 9 are required at their earliest complete proof point without moving their Gate D activation ownership. Gate D later re-asserts invariants 7, 8, and 9 over evaluator behavior. Invariant 3 is NOT a Gate A requirement: its activation prerequisite is prompt 10, in Wave B, so requiring it here made Gate A unreachable by construction (ADR-0030).",
  },
  B: {
    wave: "B",
    entryGates: ["A"],
    entryCondition:
      "Wave B may not begin until prompts 5, 6, and 7 have landed AND Gate A is green: its owned foundation invariants 1, 2, 4, and 5 and its earliest-proof references to invariants 7, 8, and 9 are active and green (ADR-0030).",
    outcome:
      "Money movement and account opening are expressible as data and the golden corpus is stable; invariant 3 (no core module, directory, or evaluator branch named for a decision domain) is active and green once prompt 10 migrates the ADR-0010 account-opening flow definition into config/domains/, and invariant 16 (no arbitrary executable code in firm policy configuration) is active and green once prompt 9 lands the closed policy AST (Wave B, prompts 8-11; ADR-0030).",
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

export const isMechanized = (r: GateRequirement): boolean => (MECHANIZED_KINDS as readonly string[]).includes(r.kind);

/** How a requirement is named in a report and in a failure message. */
export const requirementLabel = (r: GateRequirement): string => (r.kind === "invariant" ? `#${r.id}` : (r.ref ?? "<no ref>"));

export function mappedFitnessProblems(
  fitnessFiles: readonly string[],
  fileResults: ReadonlyMap<string, boolean>,
  runStatus: number | null,
): string[] {
  const problems: string[] = [];
  if (runStatus !== 0) {
    problems.push(
      runStatus === null
        ? "mapped fitness invocation did not exit normally"
        : `mapped fitness invocation exited ${runStatus}`,
    );
  }
  for (const ref of fitnessFiles) {
    const passed = fileResults.get(ref);
    if (passed === undefined) problems.push(`${ref} produced no result`);
    else if (!passed) problems.push(`${ref} FAILED`);
  }
  return problems;
}

/**
 * Prompt numbers named in prose, in every spelling the registry uses:
 * "prompt 6", "prompts 5-7", "prompts 9, 10", "prompts 5 and 6",
 * "prompts 5, 6, and 7". The `prompt(s)` keyword is required, so ADR numbers,
 * section numbers, dates, and bare counts are NOT prompt references.
 */
export function promptsNamedInProse(prose: string): number[] {
  const out = new Set<number>();
  for (const list of prose.matchAll(/\bprompts?\s+(\d+(?:\s*(?:[-–—]|,\s*and\b|,|\band\b)\s*\d+)*)/gi)) {
    for (const item of list[1]!.matchAll(/(\d+)(?:\s*[-–—]\s*(\d+))?/g)) {
      const from = Number(item[1]);
      const to = item[2] === undefined ? from : Number(item[2]);
      for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Gate keys named in prose: "Gate A", "Gate G/H", "Gate 0" - CASE-INSENSITIVELY,
 * so "gate C is green" cannot slip past the entry-condition rule. Keys are
 * normalized to the registry's uppercase spelling.
 */
export function gatesNamedInProse(prose: string): string[] {
  return [...new Set([...prose.matchAll(/\bgate\s+([0-9a-z](?:\/[0-9a-z])*)\b/gi)].map((m) => m[1]!.toUpperCase()))];
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * One script line with its trailing shell comment removed, quote-aware so a `#`
 * inside `'...'` or `"..."` stays part of the command. A `#` only opens a comment
 * at the start of a word, so `foo#bar` and `--color=#fff` are untouched.
 */
function stripShellComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === "\\" && quote !== "'") i += 1;
    else if (quote !== undefined) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}

/**
 * The commands a `run:` script actually EXECUTES: one entry per logical shell
 * line, comments dropped and `\` continuations rejoined. Splitting per line
 * rather than concatenating the script keeps a match from spanning two unrelated
 * commands.
 */
function shellCommandLines(script: string): string[] {
  const commands: string[] = [];
  let pending = "";
  for (const raw of script.split("\n")) {
    const stripped = stripShellComment(raw).trim();
    if (stripped.endsWith("\\")) {
      pending += `${stripped.slice(0, -1)} `;
      continue;
    }
    const command = collapse(pending + stripped);
    if (command !== "") commands.push(command);
    pending = "";
  }
  const trailing = collapse(pending);
  if (trailing !== "") commands.push(trailing);
  return commands;
}

/** A job of the blocking workflow, as the ci-gate rules read it. */
export interface CiJob {
  /**
   * Set when the job cannot be counted on to fail the build: `continue-on-error`,
   * a conditional that may exclude it from a normal push/PR run, or a `needs`
   * dependency that can prevent it from running. A neutralized job proves nothing,
   * however correct its steps look.
   */
  neutralizedBy?: string;
  /** Dedicated simple commands whose exit status controls a non-neutralized step. */
  commands: string[];
  steps: CiStep[];
}

export interface CiStep {
  neutralizedBy?: string;
  unsupportedRunner?: string;
  unsupportedShell?: string;
  unsupportedWorkingDirectory?: string;
  commands: string[];
  blockingCommand?: string;
  blockingTokens?: string[];
}

export interface CiWorkflow extends Map<string, CiJob> {
  workflowProblem?: string;
}

/**
 * What, if anything, stops a job or step from blocking the build. `continue-on-error`
 * anything but literal `false` swallows the failure; ANY `if:` makes the run
 * conditional, and a GitHub expression is not decidable here - so both are treated as
 * neutralizing. Fail-closed on purpose: an `if:` that is genuinely always true still
 * has to be re-stated in the registry's terms rather than trusted (ADR-0030).
 */
function neutralizerOf(node: unknown): string | undefined {
  const n = node as { "continue-on-error"?: unknown; if?: unknown } | null;
  if (n === null || typeof n !== "object") return undefined;
  const cont = n["continue-on-error"];
  if (cont !== undefined && cont !== false) return `continue-on-error: ${String(cont)}`;
  if (n.if !== undefined) return `if: ${String(n.if)}`;
  return undefined;
}

function dependencyNeutralizerOf(node: unknown): string | undefined {
  const job = node as { needs?: unknown } | null;
  if (job === null || typeof job !== "object" || !Object.hasOwn(job, "needs")) return undefined;
  if (Array.isArray(job.needs) && job.needs.length === 0) return undefined;
  const value = Array.isArray(job.needs) ? job.needs.join(", ") : String(job.needs);
  return `needs: ${value}`;
}

function strategyNeutralizerOf(node: unknown): string | undefined {
  const strategy = (node as { strategy?: unknown } | null)?.strategy;
  if (
    strategy === null ||
    typeof strategy !== "object" ||
    Array.isArray(strategy)
  ) {
    return strategy === undefined
      ? undefined
      : `strategy: ${String(strategy)}`;
  }
  return Object.hasOwn(strategy, "matrix")
    ? "strategy.matrix is not supported as blocking evidence"
    : undefined;
}

function configuredRunShell(node: unknown): unknown {
  const defaults = (node as { defaults?: unknown } | null)?.defaults;
  const run = (defaults as { run?: unknown } | null)?.run;
  return (run as { shell?: unknown } | null)?.shell;
}

function configuredRunWorkingDirectory(node: unknown): unknown {
  const defaults = (node as { defaults?: unknown } | null)?.defaults;
  const run = (defaults as { run?: unknown } | null)?.run;
  return (run as { "working-directory"?: unknown } | null)?.["working-directory"];
}

function workflowTriggerProblem(doc: unknown): string | undefined {
  const trigger = (doc as { on?: unknown } | null)?.on;
  if (Array.isArray(trigger)) {
    const events = new Set(trigger);
    return events.has("push") && events.has("pull_request")
      ? undefined
      : "workflow must run on every push and pull_request event";
  }
  if (trigger === null || typeof trigger !== "object") {
    return "workflow must run on every push and pull_request event";
  }
  const configured = trigger as Record<string, unknown>;
  for (const event of ["push", "pull_request"]) {
    if (!Object.hasOwn(configured, event)) {
      return `workflow is missing the '${event}' trigger`;
    }
    const value = configured[event];
    if (
      value !== null &&
      value !== undefined &&
      (typeof value !== "object" || Array.isArray(value) || Object.keys(value as Record<string, unknown>).length > 0)
    ) {
      return `workflow '${event}' trigger carries branch, path, or event filters`;
    }
  }
  return undefined;
}

const SUPPORTED_POSIX_RUNNERS = new Set([
  "ubuntu-latest",
  "ubuntu-24.04",
  "ubuntu-22.04",
  "macos-latest",
  "macos-15",
  "macos-14",
]);

function runnerProblem(runsOn: unknown): string | undefined {
  if (runsOn === undefined) return "missing runs-on";
  if (typeof runsOn !== "string") return `non-string runs-on '${String(runsOn)}'`;
  const normalized = runsOn.toLowerCase();
  if (SUPPORTED_POSIX_RUNNERS.has(normalized)) return undefined;
  return `unsupported or unschedulable runner '${runsOn}'`;
}

function shellProblem(shell: unknown): string | undefined {
  if (shell === undefined) return undefined;
  if (typeof shell !== "string") return `non-string shell '${String(shell)}'`;
  const normalized = collapse(shell).toLowerCase();
  if (normalized === "bash" || normalized === "sh") return undefined;
  return `unsupported shell '${shell}'`;
}

function workingDirectoryProblem(directory: unknown): string | undefined {
  if (directory === undefined) return undefined;
  if (typeof directory !== "string") return `non-string working-directory '${String(directory)}'`;
  const normalized = directory.trim().replace(/\/+$/, "");
  if (normalized === "" || normalized === ".") return undefined;
  return `working-directory '${directory}' is not the repository root`;
}

function simpleShellCommand(script: string): { text: string; tokens: string[] } | undefined {
  const commands = shellCommandLines(script);
  if (commands.length !== 1) return undefined;
  const text = commands[0]!;
  const tokens: string[] = [];
  let token = "";
  let touched = false;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else token += ch;
      touched = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = undefined;
      } else if (ch === "\\") {
        const next = text[i + 1];
        if (next === undefined) return undefined;
        token += next;
        i += 1;
      } else {
        if (ch === "$" || ch === "`") return undefined;
        token += ch;
      }
      touched = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (touched) {
        tokens.push(token);
        token = "";
        touched = false;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      touched = true;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === undefined) return undefined;
      token += next;
      touched = true;
      i += 1;
      continue;
    }
    if ("$`;&|<>()[]{}!*?~".includes(ch)) return undefined;
    token += ch;
    touched = true;
  }
  if (quote !== undefined) return undefined;
  if (touched) tokens.push(token);
  return tokens.length === 0 ? undefined : { text, tokens };
}

function commandMatches(actual: readonly string[] | undefined, required: readonly string[]): boolean {
  return actual !== undefined && actual.length === required.length && required.every((token, index) => actual[index] === token);
}

/**
 * A ci-gate requirement is only evidence if the named job EXISTS in the blocking
 * workflow, BLOCKS the build, and RUNS the required command. A bare substring match
 * is satisfied by a comment, a path, or an unrelated step - the tautological shape
 * charter #4 rejects - so the workflow is parsed into `job key -> {what neutralizes
 * it, the commands its steps run}`.
 *
 * Structure comes from the real YAML parser, not a line scanner. A scanner cannot
 * tell a command from a sibling `env:` value or a step `name:`, and it loses every
 * job declared after a column-0 comment; both are evasions in a check that is
 * load-bearing for gate readiness (charter: fences parse, they do not
 * pattern-match). The parser drops YAML comments for free and yields the `run`
 * VALUE of each step.
 *
 * YAML is not sufficient on its own: inside a `|` block scalar a `#` is literal
 * script text, so a commented-out command is genuinely part of the run value and
 * only the SHELL treats it as disabled. `shellCommandLines` therefore strips shell
 * comments too - otherwise "# pnpm audit:chain temporarily disabled" would keep
 * proving the gate it just switched off. PRESENT-BUT-DISABLED is the whole defect
 * class here, and `continue-on-error: true` is its cheapest spelling: the command
 * still runs, its failure just stops mattering.
 *
 * Effective runner and shell selection are validated independently. Only the
 * supported POSIX hosted runners, their implicit shells, and the built-in
 * `bash` and `sh` shells are accepted; every other shape fails closed.
 */
export function parseCiJobs(yamlText: string): CiWorkflow {
  const jobs = new Map<string, CiJob>() as CiWorkflow;
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch {
    return jobs;
  }
  const activationProblem = workflowTriggerProblem(doc);
  if (activationProblem !== undefined) {
    jobs.workflowProblem = activationProblem;
  }
  const declared = (doc as { jobs?: unknown } | null)?.jobs;
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) return jobs;
  const workflowShell = configuredRunShell(doc);
  const workflowDirectory = configuredRunWorkingDirectory(doc);
  for (const [key, job] of Object.entries(declared as Record<string, unknown>)) {
    const steps = (job as { steps?: unknown } | null)?.steps;
    const jobShell = configuredRunShell(job);
    const defaultShell = jobShell === undefined ? workflowShell : jobShell;
    const jobDirectory = configuredRunWorkingDirectory(job);
    const defaultDirectory = jobDirectory === undefined ? workflowDirectory : jobDirectory;
    const runsOn = (job as { "runs-on"?: unknown } | null)?.["runs-on"];
    const unsupportedRunner = runnerProblem(runsOn);
    const parsedSteps = (Array.isArray(steps) ? steps : []).flatMap((step): CiStep[] => {
      const run = (step as { run?: unknown } | null)?.run;
      if (typeof run !== "string") return [];
      const stepShell = (step as { shell?: unknown } | null)?.shell;
      const effectiveShell = stepShell === undefined ? defaultShell : stepShell;
      const unsupportedShell = shellProblem(effectiveShell);
      const stepDirectory = (step as { "working-directory"?: unknown } | null)?.["working-directory"];
      const effectiveDirectory = stepDirectory === undefined ? defaultDirectory : stepDirectory;
      const unsupportedWorkingDirectory = workingDirectoryProblem(effectiveDirectory);
      const simple =
        unsupportedRunner === undefined &&
        unsupportedShell === undefined &&
        unsupportedWorkingDirectory === undefined
          ? simpleShellCommand(run)
          : undefined;
      return [
        {
          ...(neutralizerOf(step) === undefined ? {} : { neutralizedBy: neutralizerOf(step) }),
          ...(unsupportedRunner === undefined ? {} : { unsupportedRunner }),
          ...(unsupportedShell === undefined ? {} : { unsupportedShell }),
          ...(unsupportedWorkingDirectory === undefined ? {} : { unsupportedWorkingDirectory }),
          commands: shellCommandLines(run),
          ...(simple === undefined ? {} : { blockingCommand: simple.text, blockingTokens: simple.tokens }),
        },
      ];
    });
    const commands = parsedSteps
      .filter((step) => step.neutralizedBy === undefined && step.blockingCommand !== undefined)
      .map((step) => step.blockingCommand!);
    const neutralizedBy =
      neutralizerOf(job) ??
      dependencyNeutralizerOf(job) ??
      strategyNeutralizerOf(job);
    jobs.set(key, neutralizedBy === undefined ? { commands, steps: parsedSteps } : { neutralizedBy, commands, steps: parsedSteps });
  }
  return jobs;
}

/**
 * True only when `ref` is a declared job with at least one valid executable step
 * whose failure is not neutralized.
 */
export function ciJobBlocks(jobs: Map<string, CiJob>, ref: string): boolean {
  const job = jobs.get(ref);
  return (
    (jobs as CiWorkflow).workflowProblem === undefined &&
    job !== undefined &&
    job.neutralizedBy === undefined &&
    job.steps.some(
      (step) =>
        step.neutralizedBy === undefined &&
        step.unsupportedRunner === undefined &&
        step.unsupportedShell === undefined &&
        step.unsupportedWorkingDirectory === undefined &&
        step.blockingCommand !== undefined,
    )
  );
}

export type CiCommandStatus =
  | { state: "proven" }
  | { state: "missing-job" }
  | { state: "invalid-command" }
  | { state: "inactive-workflow"; reason: string }
  | { state: "neutralized"; reason: string }
  | { state: "unsafe-runner"; reason: string }
  | { state: "unsafe-shell"; reason?: string }
  | { state: "unsafe-working-directory"; reason: string }
  | { state: "missing-command" };

export function ciJobCommandStatus(jobs: Map<string, CiJob>, ref: string, command: string): CiCommandStatus {
  const required = simpleShellCommand(command);
  if (required === undefined) return { state: "invalid-command" };
  const job = jobs.get(ref);
  if (job === undefined) return { state: "missing-job" };
  const workflowProblem = (jobs as CiWorkflow).workflowProblem;
  if (workflowProblem !== undefined) return { state: "inactive-workflow", reason: workflowProblem };
  const relevant = job.steps.filter(
    (step) =>
      commandMatches(step.blockingTokens, required.tokens) ||
      step.commands.some((line) => line.includes(required.text)),
  );
  if (job.neutralizedBy !== undefined && relevant.length > 0) {
    return { state: "neutralized", reason: `job ${job.neutralizedBy}` };
  }
  const blocking = relevant.find(
    (step) => step.neutralizedBy === undefined && commandMatches(step.blockingTokens, required.tokens),
  );
  if (blocking !== undefined) return { state: "proven" };
  const neutralized = relevant.find((step) => step.neutralizedBy !== undefined);
  if (neutralized?.neutralizedBy !== undefined) {
    return { state: "neutralized", reason: `step ${neutralized.neutralizedBy}` };
  }
  const unsupportedRunner = relevant.find((step) => step.unsupportedRunner !== undefined);
  if (unsupportedRunner?.unsupportedRunner !== undefined) {
    return { state: "unsafe-runner", reason: unsupportedRunner.unsupportedRunner };
  }
  const unsupported = relevant.find((step) => step.unsupportedShell !== undefined);
  if (unsupported?.unsupportedShell !== undefined) {
    return { state: "unsafe-shell", reason: unsupported.unsupportedShell };
  }
  const wrongDirectory = relevant.find((step) => step.unsupportedWorkingDirectory !== undefined);
  if (wrongDirectory?.unsupportedWorkingDirectory !== undefined) {
    return { state: "unsafe-working-directory", reason: wrongDirectory.unsupportedWorkingDirectory };
  }
  if (relevant.length > 0) return { state: "unsafe-shell" };
  return { state: "missing-command" };
}

export function ciJobRunProblem(jobs: Map<string, CiJob>, ref: string, command: string): string | undefined {
  const status = ciJobCommandStatus(jobs, ref, command);
  switch (status.state) {
    case "proven":
      return undefined;
    case "missing-job":
      return `ci job '${ref}' is missing from the blocking workflow`;
    case "invalid-command":
      return `required command '${command}' is not a dedicated simple command`;
    case "inactive-workflow":
      return `ci workflow does not provide normal blocking evidence: ${status.reason}`;
    case "neutralized":
      return `ci job '${ref}' command '${command}' is neutralized by ${status.reason}`;
    case "unsafe-runner":
      return `ci job '${ref}' command '${command}' uses ${status.reason}`;
    case "unsafe-shell":
      return status.reason === undefined
        ? `ci job '${ref}' mentions '${command}' only in a compound or multi-command run step`
        : `ci job '${ref}' command '${command}' uses ${status.reason}`;
    case "unsafe-working-directory":
      return `ci job '${ref}' command '${command}' uses ${status.reason}`;
    default:
      return `ci job '${ref}' does not run '${command}' in a dedicated blocking step`;
  }
}

/** True only when `ref` is a declared, blocking job with a dedicated step whose command controls that step's exit status. */
export function ciJobRuns(jobs: Map<string, CiJob>, ref: string, command: string): boolean {
  return ciJobCommandStatus(jobs, ref, command).state === "proven";
}

/** The invariant ids a gate requires green, in registry order (the captain's ruled sets). */
export const requiredInvariantIds = (gate: Gate | undefined): number[] =>
  (gate?.requires ?? []).filter((r) => r.kind === "invariant").map((r) => r.id!);

export const requirementKey = (requirement: GateRequirement): string =>
  requirement.kind === "invariant"
    ? `invariant:${requirement.id}`
    : `${requirement.kind}:${requirement.ref}${
        requirement.kind === "ci-gate"
          ? ` runs '${requirement.command}'`
          : ""
      } @ prompt ${requirement.prompt}`;

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
): Record<string, readonly number[]> =>
  Object.fromEntries(
    reg.invariants
      .filter((invariant) =>
        Object.hasOwn(
          EARLIEST_PROOF_PROMPTS_RATCHET,
          String(invariant.id),
        ),
      )
      .map((invariant) => [
        String(invariant.id),
        invariant.activationPrompts ?? [],
      ]),
  );

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
      label: "prompt-5 earliest proof points",
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
        `${check.label} drifted from the ADR-0030 ratchet; expected ${JSON.stringify(check.expected)}, received ${JSON.stringify(check.actual)}`,
      );
    }
  }
  return problems;
}

export function gateConstitutionProblems(
  reg: Registry,
  exists: (path: string) => boolean,
): string[] {
  return [
    ...gateOrderingProblems(reg, exists),
    ...gateRatchetProblems(reg),
  ];
}

/**
 * The PROOF POINT of a requirement: the prompt by which it is fully proven, plus
 * how the registry says so. `undefined` when the registry does not say (itself a
 * problem reported below).
 *
 * For an invariant this is STATUS-INDEPENDENT on purpose. Reading an active
 * invariant as "needs no future prompt" made the reference direction undecidable
 * - a gate could require an invariant a LATER gate owns and pass - and a rule
 * whose verdict flips the moment an invariant activates is not a structural rule
 * at all. So: the last declared `activationPrompts` entry when there is one, and
 * otherwise the closing prompt of the gate that owns the invariant's activation.
 * The fallback is fail-closed: dropping `activationPrompts` on activation breaks
 * every earlier gate that requires the invariant, which is why those prompt
 * numbers are a permanent record of when it landed, not a to-do list.
 */
function proofPoint(
  req: GateRequirement,
  invById: Map<number, Invariant>,
  gates: Record<string, Gate>,
): { at: number; how: string; ownedBy?: string } | undefined {
  if (req.kind !== "invariant") return req.prompt === undefined ? undefined : { at: req.prompt, how: `prompt ${req.prompt}` };
  const inv = invById.get(req.id ?? Number.NaN);
  if (!inv) return undefined;
  const declared = inv.activationPrompts ?? [];
  if (declared.length > 0) {
    const at = Math.max(...declared);
    return { at, how: `prompt ${at}`, ownedBy: inv.gate };
  }
  const owner = gates[inv.gate];
  if (!owner || !Array.isArray(owner.prompts) || owner.prompts.length !== 2) return undefined;
  return { at: owner.prompts[1], how: `prompt ${owner.prompts[1]}, where gate ${inv.gate} proves its activation`, ownedBy: inv.gate };
}

/**
 * Pure core: every structural rule that keeps the gate constitution acyclic and
 * the report honest. An empty result means the constitution is sound.
 */
export function gateOrderingProblems(reg: Registry, exists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  const gates = reg.gates ?? {};
  const invs = reg.invariants ?? [];
  const invById = new Map(invs.map((i) => [i.id, i]));

  // (a) well-formed gates and well-formed typed requirements
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
    if (!Array.isArray(gate.entryGates) || gate.entryGates.some((entry) => typeof entry !== "string" || entry.length === 0)) {
      problems.push(`gate ${key}: entryGates must be an array of registered predecessor gate keys`);
    } else if (new Set(gate.entryGates).size !== gate.entryGates.length) {
      problems.push(`gate ${key}: entryGates contains duplicate predecessor keys`);
    }
    const requires = gate.requires;
    if (!Array.isArray(requires)) {
      problems.push(`gate ${key}: requires must be an array of typed requirements`);
      continue;
    }
    for (const req of requires) {
      if (!(REQUIREMENT_KINDS as readonly string[]).includes(req?.kind)) {
        problems.push(`gate ${key}: requirement kind '${req?.kind}' is not one of ${REQUIREMENT_KINDS.join(" | ")}`);
        continue;
      }
      if (req.kind === "invariant") {
        if (!Number.isInteger(req.id)) problems.push(`gate ${key}: an 'invariant' requirement must carry the invariant id`);
        else if (!invById.has(req.id!)) problems.push(`gate ${key}: requires invariant ${req.id}, which the registry does not define`);
        continue;
      }
      if (typeof req.ref !== "string" || req.ref.length === 0) {
        problems.push(`gate ${key}: a '${req.kind}' requirement must carry a ref`);
      }
      if (!Number.isInteger(req.prompt) || req.prompt! < 1 || req.prompt! > LAST_PROMPT) {
        problems.push(`gate ${key}: '${requirementLabel(req)}' must name the prompt (1-${LAST_PROMPT}) that produces it`);
      }
      // A CI job name alone is satisfied by a comment or a path; the job must be
      // proven to RUN something, so the requirement names the command (charter #4).
      if (req.kind === "ci-gate" && (typeof req.command !== "string" || req.command.trim().length === 0)) {
        problems.push(
          `gate ${key}: the 'ci-gate' requirement '${requirementLabel(req)}' must name the command that blocking job runs - ` +
            `a job name matching a comment, a path, or an unrelated step is not evidence (ADR-0030)`,
        );
      } else if (req.kind === "ci-gate" && simpleShellCommand(req.command!) === undefined) {
        problems.push(
          `gate ${key}: the 'ci-gate' requirement '${requirementLabel(req)}' command '${req.command}' must be a dedicated simple command`,
        );
      }
      // An `evidence` requirement holds a gate below green forever, so it may not be
      // silent about WHY nothing decides it - that is the deferral-with-no-trigger the
      // charter forbids, and the note is what a later PR closes.
      if (req.kind === "evidence" && (typeof req.note !== "string" || req.note.length === 0)) {
        problems.push(`gate ${key}: the 'evidence' requirement '${requirementLabel(req)}' must carry a note saying why no mechanism decides it yet`);
      }
    }
    // (b) EMPTY SETS NEVER PROVE READINESS: a gate whose requirements nothing can
    // decide would render green the moment it is registered (ruling gatea-opus-review-1).
    if (Array.isArray(requires) && !requires.some(isMechanized)) {
      problems.push(
        `gate ${key}: declares no machine-checkable requirement (${MECHANIZED_KINDS.join(" | ")}) - ` +
          `a gate with nothing to decide would read green merely by being registered (ADR-0030)`,
      );
    }
  }

  // (c) gates are totally ordered - overlapping ranges make "later wave" undecidable
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

  // (d) ACTIVATION OWNERSHIP cannot drift: the gate an invariant is assigned to must require it
  for (const inv of invs) {
    const gate = gates[inv.gate];
    if (!gate) {
      problems.push(`invariant ${inv.id}: gate '${inv.gate}' is not declared in gates - a gate with no prompt range cannot be ordered`);
      continue;
    }
    if (!requiredInvariantIds(gate).includes(inv.id)) {
      problems.push(
        `gate ${inv.gate}: owns invariant ${inv.id} (its activation gate) but does not require it - ` +
          `activation ownership and gate requirements drifted apart (ADR-0030)`,
      );
    }
  }

  // (e) THE ORDERING RULE, over every typed requirement: nothing a gate requires may land after it
  // closes - decided from proof points, so a reference to an invariant a LATER gate owns fails too.
  for (const [key, gate] of Object.entries(gates)) {
    if (!Array.isArray(gate.prompts) || gate.prompts.length !== 2) continue;
    const closesAt = gate.prompts[1];
    for (const req of gate.requires ?? []) {
      const point = proofPoint(req, invById, gates);
      if (point === undefined || point.at <= closesAt) continue;
      const owned = point.ownedBy !== undefined && point.ownedBy !== key ? ` (activation owned by gate ${point.ownedBy})` : "";
      problems.push(
        `gate ${key} (wave ${gate.wave}, prompts ${gate.prompts.join("-")}): requires ${requirementLabel(req)}${owned}, which is ` +
          `not proven until ${point.how} - AFTER this gate closes at prompt ${closesAt}. The gate could never go green without ` +
          `faking activation - require it at a gate that covers prompt ${point.at} (ADR-0030).`,
      );
    }
  }

  for (const inv of invs) {
    const gate = gates[inv.gate];
    if (!gate || !Array.isArray(gate.prompts)) continue;
    const tag = `invariant ${inv.id} (${inv.name})`;

    if (inv.id === 3) {
      const actual = {
        artifacts: inv.activationArtifacts ?? [],
        mechanisms: inv.activationMechanisms ?? [],
      };
      if (JSON.stringify(actual) !== JSON.stringify(INVARIANT_THREE_ACTIVATION_REQUIREMENTS)) {
        problems.push(
          `${tag}: activation requires the two prompt-10 domain artifacts and exact domain-configuration fitness mechanism pinned by ADR-0030`,
        );
      }
    }

    const declared = inv.activationPrompts;
    if (declared !== undefined) {
      if (!Array.isArray(declared) || declared.length === 0) {
        problems.push(`${tag}: activationPrompts must be a non-empty array of prompt numbers`);
      } else if (!declared.every((n) => Number.isInteger(n) && n >= 1 && n <= LAST_PROMPT)) {
        problems.push(`${tag}: activationPrompts must be prompt numbers in 1-${LAST_PROMPT}, got [${declared.join(", ")}]`);
      } else if (new Set(declared).size !== declared.length) {
        problems.push(`${tag}: activationPrompts contains duplicate prompt numbers`);
      } else {
        const inProse = promptsNamedInProse(inv.activatesWhen ?? "");
        const unlisted = inProse.filter((n) => !declared.includes(n));
        if (unlisted.length > 0) {
          problems.push(`${tag}: activatesWhen names prompt(s) ${unlisted.join(", ")} that activationPrompts omits - the structured prerequisite understates the prose`);
        }
      }
    } else if (inv.status === "not-yet-active") {
      problems.push(`${tag}: not-yet-active but declares no activationPrompts - its prerequisite cannot be ordered against gate ${inv.gate}`);
    }

    // (g) HONESTY: activation prerequisites must be well formed, and an invariant
    // cannot be declared implemented until every declared artifact and exact
    // activation mechanism exists and is mapped to that invariant.
    const artifacts = inv.activationArtifacts;
    if (artifacts !== undefined) {
      if (!Array.isArray(artifacts) || artifacts.length === 0 || artifacts.some((artifact) => typeof artifact !== "string" || artifact.length === 0)) {
        problems.push(`${tag}: activationArtifacts must be a non-empty array of artifact paths`);
      } else if (new Set(artifacts).size !== artifacts.length) {
        problems.push(`${tag}: activationArtifacts contains duplicate artifact paths`);
      } else if (inv.status === "active") {
        for (const artifact of artifacts) {
          if (!exists(artifact)) {
            problems.push(`${tag}: marked 'active' but its activation artifact ${artifact} does not exist - claiming an unimplemented invariant (ADR-0030)`);
          }
        }
      }
    }

    const activationMechanisms = inv.activationMechanisms;
    if (activationMechanisms !== undefined) {
      if (
        !Array.isArray(activationMechanisms) ||
        activationMechanisms.length === 0 ||
        activationMechanisms.some(
          (mechanism) =>
            mechanism === null ||
            typeof mechanism !== "object" ||
            mechanism.type !== "fitness" ||
            typeof mechanism.ref !== "string" ||
            mechanism.ref.length === 0,
        )
      ) {
        problems.push(`${tag}: activationMechanisms must be a non-empty array of exact fitness mechanisms`);
      } else if (new Set(activationMechanisms.map((mechanism) => mechanism.ref)).size !== activationMechanisms.length) {
        problems.push(`${tag}: activationMechanisms contains duplicate fitness mechanisms`);
      } else if (inv.status === "active") {
        for (const required of activationMechanisms) {
          const mapped = (inv.mechanisms ?? []).some(
            (mechanism) => mechanism.type === required.type && mechanism.ref === required.ref,
          );
          if (!mapped) {
            problems.push(
              `${tag}: marked 'active' without required activation mechanism ${required.type}:${required.ref} - ` +
                `an unrelated fitness mechanism cannot prove this activation boundary (ADR-0030)`,
            );
          } else if (!exists(required.ref)) {
            problems.push(
              `${tag}: marked 'active' but required activation mechanism ${required.type}:${required.ref} does not exist - ` +
                `claiming an unimplemented invariant (ADR-0030)`,
            );
          }
        }
      }
    }
  }

  // (h) prose entry conditions and structural predecessor gates must describe the
  // same registered, earlier gates.
  for (const [key, gate] of Object.entries(gates)) {
    if (!Array.isArray(gate.prompts) || gate.prompts.length !== 2) continue;
    const namedGates = gatesNamedInProse(gate.entryCondition ?? "");
    const entryGates = Array.isArray(gate.entryGates) ? gate.entryGates : [];
    for (const named of namedGates) {
      if (!entryGates.includes(named)) {
        problems.push(`gate ${key}: entryCondition names Gate ${named}, but entryGates does not structurally require it`);
      }
    }
    for (const named of entryGates) {
      const prior = gates[named];
      if (!prior) {
        problems.push(`gate ${key}: entryGates depends on "Gate ${named}", which is not registered - nothing can compute or report it (ADR-0030)`);
      } else if (Array.isArray(prior.prompts) && prior.prompts[1] >= gate.prompts[0]) {
        problems.push(`gate ${key}: entryGates depends on "Gate ${named}" [${prior.prompts.join("-")}], which does not close before gate ${key} opens`);
      }
      if (!namedGates.includes(named)) {
        problems.push(`gate ${key}: entryGates requires Gate ${named}, but entryCondition does not disclose it`);
      }
    }
  }

  return problems;
}

export type RequirementState = "met" | "unmet" | "unverifiable";
export type GateState = "green" | "not-yet-green" | "not-yet-verifiable";

export interface RequirementView {
  requirement: GateRequirement;
  label: string;
  state: RequirementState;
}
export interface GateView {
  key: string;
  gate: Gate;
  requirements: RequirementView[];
  state: GateState;
  /**
   * EVERY label holding the gate back - the unmet requirements AND the ones no
   * mechanism decides. Reporting only the unmet ones understated what a gate is
   * waiting on: its `evidence` clauses hold it below green after the rest go
   * green, so a reader planning the wave has to see them from the start.
   */
  blocking: string[];
  /** The `blocking` subset nothing here can decide, so the report can name them as such. */
  undecidable: string[];
  entryBlocking: string[];
}

export interface ReadinessDeps {
  /** The COMPUTED invariant state from this run - the registry never stores a result. */
  invariantState: (id: number) => string | undefined;
  exists: (path: string) => boolean;
  /** The named blocking CI job exists AND runs the named command. */
  ciRuns: (ref: string, command: string) => boolean;
  fitnessPassed: (ref: string) => boolean | undefined;
}

function requirementState(req: GateRequirement, deps: ReadinessDeps): RequirementState {
  switch (req.kind) {
    case "invariant":
      return deps.invariantState(req.id ?? Number.NaN) === "active-pass" ? "met" : "unmet";
    case "artifact":
      return deps.exists(req.ref ?? "") ? "met" : "unmet";
    case "fitness":
      return deps.fitnessPassed(req.ref ?? "") === true ? "met" : "unmet";
    case "ci-gate":
      return deps.ciRuns(req.ref ?? "", req.command ?? "") ? "met" : "unmet";
    default:
      // `evidence`: the outcome clause has no executable proof in this repo yet.
      return "unverifiable";
  }
}

/**
 * Per-gate readiness. A gate reads green ONLY when every requirement is met and
 * every requirement is decidable here; a gate with nothing decidable, or with an
 * outcome clause no mechanism proves, is `not-yet-verifiable` - never green.
 */
export function gateReadiness(reg: Registry, deps: ReadinessDeps): GateView[] {
  const views = new Map<string, GateView>();
  const ordered = Object.entries(reg.gates ?? {}).sort((left, right) => left[1].prompts[0] - right[1].prompts[0]);
  for (const [key, gate] of ordered) {
    const requirements = (gate.requires ?? []).map((requirement) => ({
      requirement,
      label: requirementLabel(requirement),
      state: requirementState(requirement, deps),
    }));
    const unmet = requirements.filter((r) => r.state === "unmet");
    const unverifiable = requirements.filter((r) => r.state === "unverifiable");
    const decidable = requirements.some((r) => isMechanized(r.requirement));
    const entryBlocking = (gate.entryGates ?? [])
      .filter((entry) => views.get(entry)?.state !== "green")
      .map((entry) => `Gate ${entry} entry condition`);
    let state: GateState = "green";
    if ((unmet.length > 0 || entryBlocking.length > 0) && decidable) state = "not-yet-green";
    else if (!decidable || unverifiable.length > 0) state = "not-yet-verifiable";
    const blocking = [...unmet, ...unverifiable].map((r) => r.label).concat(entryBlocking);
    const undecidable = unverifiable.map((r) => r.label);
    views.set(key, { key, gate, requirements, state, blocking, undecidable, entryBlocking });
  }
  return [...views.values()];
}
