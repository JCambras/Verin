# ADR-0053: The constrained policy AST and deterministic interpreter (v3 prompt 9)

**Status:** Accepted
**Date:** 2026-08-07
**Deciders:** Build agent under the captain's Wave B ratification (waveb-design-ratification,
2026-07-26); reversible, logged per the decision protocol (D-178)
**Relates to:** ADR-0023, ADR-0029, ADR-0039, ADR-0054, charter #1/#4/#5, v3 §6.1/§6.2,
v3 invariant 16, marriage-map C6
**Amends:** nothing; extends the decision core beside ADR-0029's contracts and ADR-0039's catalog

## Context

v3 prompt 9 lands §6.1: a closed, typed policy AST with a deterministic parser, validator, and
evaluator skeleton, so firms can configure binding logic without configuration becoming custom
TypeScript. The Wave B design (`data/verin-primdesign-b6/report.md`) was ratified by the captain
with all eight open-question rulings adopted as recommended; this ADR records how that settled
design landed in this repo and the implementation choices the design left open.

## Decision

### Where things live

- **The grammar** is `src/contracts/decision-core/policy.ts`: strict Zod schemas for exactly the
  ratified ValueNode (4 kinds), PredicateNode (7 evaluable ops), and PolicyEffect (6 kinds)
  variants, beside the other decision-core contracts (ADR-0029's home, per the ratified design's
  own placement note).
- **The interpreter** is `src/domain/policy/` (marriage-map C6: v3 module paths become subsystems
  inside the four fenced layers): `load.ts` + `load-checks.ts` + `load-effects.ts` (the
  seven-check loader; every check that reads an effect lives in `load-effects.ts`), `conflict.ts`
  (the disjointness prover), `facts.ts` (the facts plane and three-valued predicate
  semantics), `evaluate.ts` + `evaluate-primitives.ts` (the four-phase evaluator), `temporal.ts`
  (pure integer calendar math - no Date, no Intl), `registries.ts` (the four pinned registries),
  `trace.ts` (the typed evaluation trace). Three files exist purely because of the 500-line
  per-file ceiling; the seams (`load-checks`, `load-effects`, `evaluate-primitives`) are the
  natural check/phase boundaries.

### The ratified grammar, with its three ratified deltas

No ad-hoc extension. The exact deltas, each captain-ratified:

1. **`in.set` members are constants only** (design §3.1 v1 restriction): dynamic
   instruction-sourced lists belong to `restriction-screen`, which returns source-attributed
   matches; a dynamic `in` would silently drop provenance.
2. **`require_evidence` carries `reviewTemplateId`, required exactly when `absence` is
   `specialist_review`** (OQ-2 ruling), so the specialist stage's shape resolves from the same
   template registry as every other stage. The loader additionally requires that template to be
   specialist-kind.
3. **`elapsed` is the ONE reserved future op** (OQ-7 ruling). Grammar 1.1.0 parses it - that is
   what the migration fixture exercises - but the loader refuses it as
   `reserved-op-not-evaluable`: it gains semantics only through its activating version bump.
   Any other interim temporal mechanism is rejected rather than improvised.

The grammar version (1.0.0 active) and the primitive-set version (1.0.0, ADR-0039) are pinned
independently in every policy document, exactly as the DecisionInputBundle already pins them.

### Load-time gate (the seven checks, design §3.2)

`loadPolicy(document, registries)` returns a `LoadedPolicy` or an accumulated typed issue list -
27 precise codes, never a silent fallback. Paths, context keys, primitives, parameters,
strategies, and templates resolve against Map-backed pinned registries, which is what makes
injection INERT: `__proto__` is simply an unknown path, and an executable string is data nothing
ever interprets. Closure covers the reason-code NAMESPACE too: `ReasonCodeSchema` is an opaque
brand, so an authored `blockerCode`/`prohibitionCode` inside a prefix the evaluator synthesizes
its fail-closed blockers under (`RESERVED_REASON_CODE_PREFIXES`) is refused as
`reserved-reason-namespace` rather than silently merging with a platform blocker at evaluation.
Closure also covers the parameters a primitive's published keys are DERIVED from: each catalog
entry declares its `keyShapingParameters`, and a `set_parameter` naming one is refused as
`key-shaping-parameter-not-writable` - the context-key vocabulary closes over the CONFIGURED
values, so a policy write there would desynchronize the closed vocabulary from the runtime key
space (D-184; prompt 10's binding model must not re-open it).
The effect-conflict rule (§6.1 normative) uses the conservative syntactic
disjointness prover: predicates normalize to DNF (capped at 64 branches - exceeding the cap is
itself a load error), every cross-rule conjunction pair must carry a contradiction on some shared
variable, and an unprovable pair is REJECTED naming both rules, the target, and why. Sound by
construction, incomplete by choice, per the captain's ruling.

### Evaluation semantics (design §3.5)

`evaluatePolicy` is a pure four-phase function: configuration rules, primitives in canonical
dependency order, evaluation rules, then the fixed lattice (prohibit > block > specialist_review
> approval > automatic). Kleene three-valued predicate logic makes fail-closed totality honest:
`exists`/`is_fresh` are presence-aware, an absent value in a VALUE position makes the rule
unevaluable and synthesizes a `rule-unevaluable:<ruleId>` blocker, and an exists-guarded rule
collapses to plain false. A context key resolves by its DECLARED ORIGIN: a primitive-origin key
comes only from the published facts and an intent-origin key only from the intent slots, so a
stray intent entry can never stand in for a fact an unevaluable primitive did not publish
(D-185). Effects accumulate in commutative structures; every trace collection is
canonically sorted; the trace round-trips the canonical serializer byte-stably. Policy content
never refuses - it lands in the trace; only structural impossibilities (loader bypass, catalog
contract violation, malformed assembly) return typed refusals.

### Implementation choices the design left open (fixed here)

- **Freshness windows are day-or-finer with integer components.** `is_fresh` over `P1M`/`P1Y`
  needs calendar-anchoring semantics nobody ratified, and fractional components invite float
  drift into replay hashes; both refuse at load with `duration-granularity-unsupported`. The
  `elapsed` activation is where richer temporal semantics would land (OQ-7).
- **Stratification covers `set_parameter` VALUES, not only `when` clauses.** A parameter value
  reading a primitive-published key cannot resolve in Phase 0 (no primitive has run); refusing it
  at load is forced by the ratified phase structure, and load-time refusal beats an evaluation
  surprise.
- **Prompt-9 scope of Phase 1:** invocations arrive ASSEMBLED (evidence projection and tz
  anchoring are harness work owned by prompts 14-16 - the D-102 precedent). The evaluator
  verifies them against the catalog contracts fail-closed (parameter validation, context-binding
  resolution, published-key containment and collision refusal, canonical topological order) and
  runs the real primitives. Bundle-shaped content a primitive's schema refuses lands as an
  unevaluable execution (dependent rules block); only malformed assembly refuses.
- **A policy-resolved parameter the target primitive refuses** marks the writing rules
  unevaluable (fail-closed blockers) and skips the primitive rather than running it
  half-configured.
- **The migration fixture compares version-stamp-free projections** (loaded rules and trace with
  the `grammarVersion` field held out), because the stamp itself legitimately differs; both
  digests are pinned in `fixtures/policy/migration-1.0.0.json` and re-verified by the fence.

### Fences and invariant activation

The `policy-ast` fence (`src/__tests__/fitness/policy-ast.test.ts`) pins: grammar closure
(this fence carries its own copy of the ratified vocabulary), domain neutrality and purity over
the whole module (shared scanners with the primitive-catalog fence, now in `_module-scan.ts`),
the migration-fixture digests, and reachability-by-name (every module value export is consumed or
a NAMED deferral stating its landing prompt - the D-116 precedent). v3 invariant 16 ("Firm
policy configuration contains no arbitrary executable code") is ACTIVE, mapped to this fence and
the loader test suite. Property families A-G (fast-check) prove order independence, conflict
soundness with the runtime single-writer companion, totality, purity under poisoned
Date.now/Math.random, most-restrictive monotonicity, fail-closed absence handling, and that no
loader-accepted write reshapes a published key space (D-184).

The evaluation input plane (`PolicyEvaluationFacts`, `PolicyPrimitiveInvocation`,
`PolicyEvaluationInput`) is PIIBearing-marked - evidence content stays structurally unreachable
from `llm/`; the grammar's evidence-KIND discriminators are reviewed llm-pii-boundary escapes
(identifiers, never contents). The module's pure functions are reviewed tenant-context port
escapes: they perform no repository access (the fence bans IO across the module), and their
inputs arrive pre-scoped from the tenant-pinned bundle.

## Alternatives rejected

- A general-purpose expression engine or user functions (banned by §6.2 and the standing rules).
- Resolving effect conflicts by rule order, rule id, or last-writer-wins (the exact back door
  §6.1 closes; the captain's ruling is explicit: reject when disjointness is unprovable).
- Implementing `elapsed` semantics now "since the arm exists" (OQ-7 reserves it; grammar-only).
- A TenantContext parameter on the pure evaluator (ambient authority a pure function cannot
  honor; scoping lives in the bundle and its assembling repositories).
- Deferring the evaluator to prompt 16 and landing only the loader (the ratified design and the
  captain's routing put the four-phase interpreter in prompt 9; prompt 16 completes it over the
  real DecisionInputBundle).

## Revert path

Delete `src/domain/policy/`, `src/contracts/decision-core/policy.ts`, the prompt-9 brands in
`ids.ts`, `fixtures/policy/`, the policy test files, and the `policy-ast` fence; remove the
policy escapes from the llm-pii-boundary and tenant-context fences and the `policy.ts` row from
the decision-core tenant-scope inventory; flip invariant 16 back to `not-yet-active` (with the
registry ratchet note); restore ADR-0051's ceilings per ADR-0054's revert path; drop the
fast-check devDependency.
