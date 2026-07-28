/**
 * V3 PHASE-GATE MODEL - the SHARED core of the gate constitution (ADR-0030;
 * captain rulings `gate-a-ordering` and `gatea-opus-review-1`, 2026-07-28).
 *
 * Both checkers of `v3-invariants.json` import this module, so the blocking
 * runner (scripts/v3-invariants.ts, CI job `v3-invariants`) and the fitness
 * fence (src/__tests__/fitness/v3-gate-ordering.test.ts) cannot drift apart:
 * the fence proves these rules reject real violations, the runner refuses to
 * PRINT a report that violates them. Same split as scripts/golden-cases.lib.ts.
 *
 * TWO SEPARATE RELATIONS (the review-round correction):
 *  - ACTIVATION OWNERSHIP - `invariant.gate` names the one gate at which that
 *    invariant's activation is proven. The ordering rule is computed against it.
 *  - GATE REQUIREMENT - `gates.<G>.requires` lists what <G> needs to be green.
 *    A gate MUST require every invariant it owns (so ownership cannot drift
 *    silently) and MAY additionally reference invariants owned by earlier gates,
 *    plus artifacts, fences, and CI gates. v3's Gate C, for instance, restates
 *    "no PII in LLM artifacts" (invariant 1) without taking it from Gate A.
 *
 * THE ORDERING RULE: nothing a gate requires may land after that gate closes.
 * A gate that requires something unreachable inside its own wave can only ever
 * be "passed" by lying about activation - the circular Gate A dependency this
 * ADR removed, and exactly what v3 §17's never-fake-green preamble forbids.
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
  note?: string;
}

export interface Gate {
  wave: string;
  title: string;
  prompts: [number, number];
  requires: GateRequirement[];
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
}

export interface Registry {
  gates: Record<string, Gate>;
  invariants: Invariant[];
}

export const isMechanized = (r: GateRequirement): boolean => (MECHANIZED_KINDS as readonly string[]).includes(r.kind);

/** How a requirement is named in a report and in a failure message. */
export const requirementLabel = (r: GateRequirement): string => (r.kind === "invariant" ? `#${r.id}` : (r.ref ?? "<no ref>"));

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

/** Gate keys named in prose: "Gate A", "Gate G/H", "Gate 0". */
export function gatesNamedInProse(prose: string): string[] {
  return [...new Set([...prose.matchAll(/\bGate\s+([0-9A-Z](?:\/[0-9A-Z])*)/g)].map((m) => m[1]!))];
}

/** The invariant ids a gate requires green, in registry order (the captain's ruled sets). */
export const requiredInvariantIds = (gate: Gate | undefined): number[] =>
  (gate?.requires ?? []).filter((r) => r.kind === "invariant").map((r) => r.id!);

/**
 * The earliest prompt by which a requirement can be satisfied, or `undefined`
 * when the registry does not say (which is itself a problem reported below).
 * An already-active invariant needs no future prompt, so it lands at 0.
 */
function landsAtPrompt(req: GateRequirement, invById: Map<number, Invariant>): number | undefined {
  if (req.kind !== "invariant") return req.prompt;
  const inv = invById.get(req.id ?? Number.NaN);
  if (!inv) return undefined;
  if (inv.status === "active") return 0;
  const declared = inv.activationPrompts ?? [];
  return declared.length > 0 ? Math.max(...declared) : undefined;
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

  // (e) THE ORDERING RULE, over every typed requirement: nothing a gate requires may land after it closes
  for (const [key, gate] of Object.entries(gates)) {
    if (!Array.isArray(gate.prompts) || gate.prompts.length !== 2) continue;
    const closesAt = gate.prompts[1];
    for (const req of gate.requires ?? []) {
      const lands = landsAtPrompt(req, invById);
      if (lands === undefined || lands <= closesAt) continue;
      const owner = req.kind === "invariant" ? invById.get(req.id!) : undefined;
      const owned = owner && owner.gate !== key ? ` (activation is owned by gate ${owner.gate})` : "";
      problems.push(
        `gate ${key} (wave ${gate.wave}, prompts ${gate.prompts.join("-")}): requires ${requirementLabel(req)}${owned}, whose ` +
          `prerequisite is prompt ${lands}, which lands AFTER that gate closes. The gate could never go green without ` +
          `faking activation - require it at the gate that covers prompt ${lands} (ADR-0030).`,
      );
    }
  }

  for (const inv of invs) {
    const gate = gates[inv.gate];
    if (!gate || !Array.isArray(gate.prompts)) continue;
    const tag = `invariant ${inv.id} (${inv.name})`;

    if (inv.status === "not-yet-active") {
      const declared = inv.activationPrompts;
      if (!Array.isArray(declared) || declared.length === 0) {
        problems.push(`${tag}: not-yet-active but declares no activationPrompts - its prerequisite cannot be ordered against gate ${inv.gate}`);
      } else if (!declared.every((n) => Number.isInteger(n) && n >= 1 && n <= LAST_PROMPT)) {
        problems.push(`${tag}: activationPrompts must be prompt numbers in 1-${LAST_PROMPT}, got [${declared.join(", ")}]`);
      } else {
        // (f) prose may not name a later prompt than the structured field admits
        const inProse = promptsNamedInProse(inv.activatesWhen ?? "");
        const unlisted = inProse.filter((n) => !declared.includes(n));
        if (unlisted.length > 0) {
          problems.push(`${tag}: activatesWhen names prompt(s) ${unlisted.join(", ")} that activationPrompts omits - the structured prerequisite understates the prose`);
        }
      }
    }

    // (g) HONESTY: an artifact-gated invariant cannot be declared implemented before its artifacts exist
    for (const artifact of inv.activationArtifacts ?? []) {
      if (inv.status === "active" && !exists(artifact)) {
        problems.push(`${tag}: marked 'active' but its activation artifact ${artifact} does not exist - claiming an unimplemented invariant (ADR-0030)`);
      }
    }
  }

  // (h) an entry condition naming another gate must name a REGISTERED, EARLIER one -
  // "Gate C is green" is only a requirement if Gate C is something this repo can compute.
  for (const [key, gate] of Object.entries(gates)) {
    if (!Array.isArray(gate.prompts) || gate.prompts.length !== 2) continue;
    for (const named of gatesNamedInProse(gate.entryCondition ?? "")) {
      const prior = gates[named];
      if (!prior) {
        problems.push(`gate ${key}: entryCondition depends on "Gate ${named}", which is not registered - nothing can compute or report it (ADR-0030)`);
      } else if (Array.isArray(prior.prompts) && prior.prompts[1] >= gate.prompts[0]) {
        problems.push(`gate ${key}: entryCondition depends on "Gate ${named}" [${prior.prompts.join("-")}], which does not close before gate ${key} opens`);
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
  /** The labels holding the gate back: unmet requirements, else the unverifiable ones. */
  blocking: string[];
}

export interface ReadinessDeps {
  /** The COMPUTED invariant state from this run - the registry never stores a result. */
  invariantState: (id: number) => string | undefined;
  exists: (path: string) => boolean;
  ciDeclares: (ref: string) => boolean;
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
      return deps.ciDeclares(req.ref ?? "") ? "met" : "unmet";
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
  return Object.entries(reg.gates ?? {}).map(([key, gate]) => {
    const requirements = (gate.requires ?? []).map((requirement) => ({
      requirement,
      label: requirementLabel(requirement),
      state: requirementState(requirement, deps),
    }));
    const unmet = requirements.filter((r) => r.state === "unmet");
    const unverifiable = requirements.filter((r) => r.state === "unverifiable");
    const decidable = requirements.some((r) => isMechanized(r.requirement));
    let state: GateState = "green";
    if (unmet.length > 0 && decidable) state = "not-yet-green";
    else if (!decidable || unverifiable.length > 0) state = "not-yet-verifiable";
    const blocking = (unmet.length > 0 ? unmet : unverifiable).map((r) => r.label);
    return { key, gate, requirements, state, blocking };
  });
}
