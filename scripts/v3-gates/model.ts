/**
 * V3 PHASE-GATE MODEL - shared types and small helpers of the gate constitution
 * (ADR-0055). Imported by every other `scripts/v3-gates/` module; see
 * scripts/v3-gates.lib.ts for the one shared entry point both checkers use.
 */

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
  group?: string;
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

export const isMechanized = (r: GateRequirement): boolean => (MECHANIZED_KINDS as readonly string[]).includes(r.kind);

/** How a requirement is named in a report and in a failure message. */
export const requirementLabel = (r: GateRequirement): string => (r.kind === "invariant" ? `#${r.id}` : (r.ref ?? "<no ref>"));

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

/** How a nonzero mapped-fitness invocation reads in a failure message. */
export function fitnessInvocationProblem(
  runStatus: number | null,
): string | undefined {
  if (runStatus === 0) return undefined;
  return runStatus === null
    ? "mapped fitness invocation did not exit normally"
    : `mapped fitness invocation exited ${runStatus}`;
}

/**
 * A nonzero invocation NO mapped file result explains: every mapped fence
 * reported green, so the failure came from outside them and no per-file result
 * may be reported as proof of anything. A nonzero status that a failed or
 * missing mapped file DOES explain keeps its per-file attribution, which is the
 * report an operator needs (ADR-0039).
 */
export function unattributedFitnessInvocationProblem(
  fitnessFiles: readonly string[],
  fileResults: ReadonlyMap<string, boolean>,
  runStatus: number | null,
): string | undefined {
  const invocation = fitnessInvocationProblem(runStatus);
  if (invocation === undefined) return undefined;
  return fitnessFiles.some((ref) => fileResults.get(ref) !== true)
    ? undefined
    : invocation;
}

export function mappedFitnessProblems(
  fitnessFiles: readonly string[],
  fileResults: ReadonlyMap<string, boolean>,
  runStatus: number | null,
): string[] {
  const problems: string[] = [];
  const invocation = fitnessInvocationProblem(runStatus);
  if (invocation !== undefined) {
    problems.push(invocation);
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
