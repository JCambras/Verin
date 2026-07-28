/**
 * V3 PHASE-GATE MODEL - the SHARED core of the gate constitution (ADR-0030;
 * captain rulings `gate-a-ordering`, `gatea-opus-review-1` and
 * `gatea-fix-review-2`, 2026-07-28).
 *
 * Both checkers of `v3-invariants.json` import this module, so the blocking
 * runner (scripts/v3-invariants.ts, CI job `v3-invariants`) and the fitness
 * fence (src/__tests__/fitness/v3-gate-ordering.test.ts) cannot drift apart:
 * the fence proves these rules reject real violations, the runner refuses to
 * PRINT a report that violates them. Same split as scripts/golden-cases.lib.ts.
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
 *    Gate B requires invariant 16, whose closed policy-AST prohibition is fully
 *    proven at prompt 9 - inside Wave B - though Gate E owns its activation.
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

/**
 * A ci-gate requirement is only evidence if the named job EXISTS in the blocking
 * workflow and RUNS the required command. A bare substring match is satisfied by
 * a comment, a path, or an unrelated step - the tautological shape charter #4
 * rejects - so the workflow is parsed into `job key -> the commands its steps run`.
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
 * proving the gate it just switched off.
 *
 * A workflow this cannot parse yields NO jobs, so every ci-gate reads unmet - the
 * honest answer when the evidence cannot be read at all.
 */
export function parseCiJobs(yamlText: string): Map<string, string[]> {
  const jobs = new Map<string, string[]>();
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch {
    return jobs;
  }
  const declared = (doc as { jobs?: unknown } | null)?.jobs;
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) return jobs;
  for (const [key, job] of Object.entries(declared as Record<string, unknown>)) {
    const steps = (job as { steps?: unknown } | null)?.steps;
    const commands = (Array.isArray(steps) ? steps : [])
      .map((step) => (step as { run?: unknown } | null)?.run)
      .filter((run): run is string => typeof run === "string")
      .flatMap(shellCommandLines);
    jobs.set(key, commands);
  }
  return jobs;
}

/** True only when `ref` is a declared job that runs `command` in one of its steps. */
export function ciJobRuns(jobs: Map<string, string[]>, ref: string, command: string): boolean {
  const needle = collapse(command);
  if (needle === "") return false;
  return (jobs.get(ref) ?? []).some((r) => r.includes(needle));
}

/** The invariant ids a gate requires green, in registry order (the captain's ruled sets). */
export const requiredInvariantIds = (gate: Gate | undefined): number[] =>
  (gate?.requires ?? []).filter((r) => r.kind === "invariant").map((r) => r.id!);

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
  /**
   * EVERY label holding the gate back - the unmet requirements AND the ones no
   * mechanism decides. Reporting only the unmet ones understated what a gate is
   * waiting on: its `evidence` clauses hold it below green after the rest go
   * green, so a reader planning the wave has to see them from the start.
   */
  blocking: string[];
  /** The `blocking` subset nothing here can decide, so the report can name them as such. */
  undecidable: string[];
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
    const blocking = [...unmet, ...unverifiable].map((r) => r.label);
    const undecidable = unverifiable.map((r) => r.label);
    return { key, gate, requirements, state, blocking, undecidable };
  });
}
