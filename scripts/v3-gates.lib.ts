/**
 * V3 PHASE-GATE MODEL - the SHARED entry point of the gate constitution
 * (ADR-0055; captain rulings `gate-a-ordering`, `gatea-opus-review-1`,
 * `gatea-fix-review-2`, `gatea-review-3` and `gatea-fix-review-3`, 2026-07-28).
 *
 * Both checkers of `v3-invariants.json` import this module, so the blocking
 * runner (scripts/v3-invariants.ts, CI job `v3-invariants`) and the fitness
 * fence (src/__tests__/fitness/v3-gate-ordering.test.ts) cannot drift apart:
 * the fence proves these rules reject real violations, the runner refuses to
 * PRINT a report that violates them. Same split as scripts/golden-cases.lib.ts.
 * The CI half of it (`parseCiJobs`) is the repo's ONE structured CI authority -
 * the registry fence and the charter-drift fence read the workflow through it too.
 *
 * The rule set lives in `scripts/v3-gates/` under the per-file size ceiling,
 * one module per seam, all reached through this one entry:
 *  - model.ts             shared types, requirement labels/keys, prose readers
 *  - shell.ts             restricted shell-command reading for CI evidence
 *  - ci-values.ts         literal-value validators for workflow fields
 *  - ci-schema.ts         GitHub-executable workflow shape validation
 *  - ci-evidence.ts       neutralizers, triggers, runner/shell/env/predecessor safety
 *  - ci-workflow.ts       parseCiJobs + the ci-gate command-status rules
 *  - invariant-ratchets.ts  shipped-activation mechanism tuples (monotonic)
 *  - gate-ratchets.ts     ownership, proof-point, metadata, requirement ratchets
 *  - ordering.ts          THE ORDERING RULE, constitution problems, readiness
 *  - registry.ts          registry-structural validation (fence + runner)
 *
 * TWO SEPARATE RELATIONS (the review-round correction):
 *  - ACTIVATION OWNERSHIP - `invariant.gate` names the one gate at which that
 *    invariant's activation is proven. It is pinned, for all 30 invariants, by
 *    the ratchet, so it cannot be moved by a registry edit alone.
 *  - GATE REQUIREMENT - `gates.<G>.requires` lists what <G> needs to be green.
 *    A gate MUST require every invariant it owns (so ownership cannot drift
 *    silently) and MAY additionally reference invariants owned by other gates,
 *    plus artifacts, fences, and CI gates.
 *
 * THE ORDERING RULE: nothing a gate requires may land after that gate closes,
 * decided from a requirement's PROOF POINT (see ordering.ts). A gate that
 * requires something unreachable inside its own wave can only ever be "passed"
 * by lying about activation - the circular Gate A dependency ADR-0055 removed,
 * and exactly what v3 §17's never-fake-green preamble forbids.
 */
export {
  LAST_PROMPT,
  MECHANIZED_KINDS,
  REQUIREMENT_KINDS,
  fitnessInvocationProblem,
  gatesNamedInProse,
  isMechanized,
  mappedFitnessProblems,
  promptsNamedInProse,
  requiredInvariantIds,
  requirementKey,
  requirementLabel,
  unattributedFitnessInvocationProblem,
  type Gate,
  type GateRequirement,
  type Invariant,
  type InvariantMechanism,
  type Registry,
  type RequirementKind,
} from "./v3-gates/model";
export {
  ciJobBlocks,
  ciJobCommandStatus,
  ciJobRunProblem,
  ciJobRuns,
  parseCiJobs,
  type CiCommandStatus,
  type CiJob,
  type CiStep,
  type CiWorkflow,
} from "./v3-gates/ci-workflow";
export {
  ACTIVE_MECHANISM_RATCHET,
  ACTIVE_RATCHET,
  INVARIANT_THREE_ACTIVATION_REQUIREMENTS,
  activeInvariantRatchetProblems,
} from "./v3-gates/invariant-ratchets";
export {
  EARLIEST_PROOF_PROMPTS_RATCHET,
  GATE_ASSIGNMENT_RATCHET,
  GATE_METADATA_RATCHET,
  GATE_REQUIREMENTS_RATCHET,
  RATIFIED_GATE_RANGES,
  earliestProofPromptsOf,
  gateRatchetProblems,
  invariantThreeActivationOf,
  metadataOf,
  ownershipOf,
  requirementsOf,
  type RatchetedGateMetadata,
} from "./v3-gates/gate-ratchets";
export {
  gateConstitutionProblems,
  gateOrderingProblems,
  gateReadiness,
  type GateState,
  type GateView,
  type ReadinessDeps,
  type RequirementState,
  type RequirementView,
} from "./v3-gates/ordering";
export {
  validateRegistry,
  type RegistryValidationDeps,
} from "./v3-gates/registry";
