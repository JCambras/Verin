/**
 * THE ORDERING RULE and gate readiness (ADR-0055): nothing a gate requires may
 * land after that gate closes, decided from each requirement's PROOF POINT, and
 * a gate reads green only when every typed requirement is met, decidable, and
 * every structural predecessor is green. See scripts/v3-gates.lib.ts for the
 * shared entry point both checkers import.
 */
import {
  isMechanized,
  LAST_PROMPT,
  MECHANIZED_KINDS,
  REQUIREMENT_KINDS,
  gatesNamedInProse,
  promptsNamedInProse,
  requiredInvariantIds,
  requirementLabel,
  type Gate,
  type GateRequirement,
  type Invariant,
  type Registry,
} from "./model";
import { simpleShellCommand } from "./shell";
import { INVARIANT_THREE_ACTIVATION_REQUIREMENTS } from "./invariant-ratchets";
import { gateRatchetProblems } from "./gate-ratchets";

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
            `a job name matching a comment, a path, or an unrelated step is not evidence (ADR-0055)`,
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
          `a gate with nothing to decide would read green merely by being registered (ADR-0055)`,
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
          `activation ownership and gate requirements drifted apart (ADR-0055)`,
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
          `faking activation - require it at a gate that covers prompt ${point.at} (ADR-0055).`,
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
          `${tag}: activation requires the two prompt-10 domain artifacts and exact domain-configuration fitness mechanism pinned by ADR-0055`,
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
            problems.push(`${tag}: marked 'active' but its activation artifact ${artifact} does not exist - claiming an unimplemented invariant (ADR-0055)`);
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
                `an unrelated fitness mechanism cannot prove this activation boundary (ADR-0055)`,
            );
          } else if (!exists(required.ref)) {
            problems.push(
              `${tag}: marked 'active' but required activation mechanism ${required.type}:${required.ref} does not exist - ` +
                `claiming an unimplemented invariant (ADR-0055)`,
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
        problems.push(`gate ${key}: entryGates depends on "Gate ${named}", which is not registered - nothing can compute or report it (ADR-0055)`);
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
