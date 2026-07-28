# ADR-0030: Gate A requires invariants 1, 2, 4, and 5; invariant 3 is gated at B

**Status:** Accepted (amends ADR-0023); amended in place 2026-07-28 by review ruling `gatea-opus-review-1`
**Date:** 2026-07-28
**Deciders:** captain (durable ruling, decision key `gate-a-ordering`, 2026-07-28; review ruling `gatea-opus-review-1`, 2026-07-28), founding architect
**Relates to:** ADR-0023 (v3 adoption - §17 becomes phase-gated commitments); ADR-0010 (generic workflow engine); ADR-0025 (money movement as configuration, never a core module); ADR-0026 (fences land in the wave that creates their subject); charter #1 (fence every invariant in the same PR that states it), #4 (detection is not verification), #5 (nothing built-but-not-shipped / no fake green)
**Informed by:** `docs/v3/verin-prompt-sequence-v3.md` (Gate A at prompt 7; prompt 10 in Wave B), `docs/v3/marriage-map.md` C10 (the account-opening flow definition migrates to `config/domains/`), v3 §17 preamble ("CI reports active, not-yet-active, or failed - never fake green")

## Context

Gate A closes Wave A (prompts 4-7). As ratified, it read "Foundation invariants 1-5 are active and
green," and `v3-invariants.json` registered all five foundation invariants at gate A.

Invariant 3 - "no core module, directory, or evaluator branch is named for a decision domain" - cannot
be activated inside Wave A. Its implementation prerequisite is **prompt 10** (Wave B, prompts 8-11),
where the ADR-0010 account-opening flow definition migrates into the domain-configuration system and
both example domains become data (`config/domains/*.yaml`). ADR-0023 and ADR-0025 already record that
migration as Wave B work, and the registry entry for invariant 3 already carried it as a written
`PRE-CONDITION`.

That produced a circular dependency in the governance itself:

- Gate A cannot go green until invariant 3 is active and green.
- Invariant 3 cannot go active-green until prompt 10 lands.
- Prompt 10 is in Wave B, which cannot begin until Gate A is green.

The cycle has exactly three exits: move prompt 10 ahead of the vocabulary prerequisites it depends on
(prompts 8-9), declare invariant 3 green on Wave A substrate that does not implement it, or move the
invariant's activation requirement to the gate that actually covers its prerequisite. The first
re-orders the build against its own dependencies; the second is fake green, which v3 §17 and charter #5
forbid outright, and would put a false claim into the invariant report, the proof log, and any UI that
renders phase state. The captain ruled for the third.

## Decision

The captain's durable ruling (decision key `gate-a-ordering`, 2026-07-28) is adopted verbatim:

1. **Gate A requires invariants 1, 2, 4, and 5 to be active and green.**
2. **Invariant 3 remains honestly `not-yet-active`** until prompt 10 migrates account opening into the
   domain-configuration system.
3. **Gate B requires invariant 3 to be active and green.**
4. **Wave B may begin only after prompts 5, 6, and 7 have landed and Gate A's corrected requirements
   are green.**
5. **No document, proof, or UI may claim invariant 3 is implemented before prompt 10 exists.**

The ruling is implemented as machine-checked structure, not prose:

- `v3-invariants.json` gains a structured `gates` map covering **every gate of the ratified sequence**
  - `0` (prompts 1-3), `A` (4-7), `B` (8-11), `C` (12-15), `D` (16-19), `E` (20-22), `F` (23-26),
  `G/H` (27-29), `I` (30). Each gate declares its `wave`, `prompts` `[first, last]` range, `requires`
  list, `entryCondition`, and `outcome`. Invariant 3's `gate` moves from `A` to `B`.
- Every not-yet-active invariant declares `activationPrompts` - the prompt numbers whose landing
  activates it - so "later wave" is a decidable relation instead of a reading of prose.
- Invariant 3 declares `activationArtifacts`: `config/domains/account-opening.yaml` and
  `config/domains/money-movement.yaml`. It may not be flipped to `active` until those prompt-10
  artifacts exist on disk. That is ruling 5 in mechanical form.

**Two relations, not one (review ruling `gatea-opus-review-1`).** The first cut made
`gates.<G>.requires` a list of invariant ids fenced EQUAL to the set of invariants carrying gate `<G>`.
That conflated two different things and made the model incomplete: gates whose outcome is artifact- or
evidence-based (0, C, I) owned no invariant, so they could not be registered at all - while v3's Gate C
subject ("no PII in LLM artifacts") is invariant **1**, which the ruling pins to Gate A. The two
relations are now separate:

- **Activation ownership** - `invariant.gate` names the one gate at which that invariant's activation
  is proven. The ordering rule is computed against it, and a gate MUST require every invariant it owns,
  so ownership can never drift silently away from the requirement list.
- **Gate requirement** - `gates.<G>.requires` is a list of TYPED requirements: `invariant`, `artifact`,
  `fitness`, `ci-gate` (all machine-checkable) and `evidence` (an outcome clause with no executable
  proof yet, which must carry a note saying why, and which can never read green). A gate may
  additionally REFERENCE an invariant an earlier gate owns - Gate C restates invariant 1 over the
  intake and evidence paths without taking it from Gate A.

The ordering rule generalizes to every typed requirement: **nothing a gate requires may land after that
gate closes**. A gate declaring no machine-checkable requirement is rejected outright, because an empty
set would read green the moment it was registered - empty sets never prove readiness.

**One rule set, two callers.** The rules live in `scripts/v3-gates.lib.ts` (the same split as
`scripts/golden-cases.lib.ts`). `src/__tests__/fitness/v3-gate-ordering.test.ts` owns the adversarial
half - it proves each rule rejects a real violation - and `scripts/v3-invariants.ts` runs the identical
set before it prints anything. The report is itself a document bound by ruling clause 5, so it may not
emit a claim the fence would reject; enforcing a subset there (the first cut re-checked only the
ordering rule) left the report free to make claims about activation artifacts and gate integrity that
nothing verified. The runner computes per-gate readiness from the typed requirements: **green only when
every requirement is met AND every requirement is decidable here.**

**Reading key for the ratified documents.** `docs/v3/verin-prompt-sequence-v3.md:186` still reads
"Gate A: Foundation invariants 1-5 are active and green." The ratified v3 documents are committed
verbatim and SHA-256-pinned; per `docs/v3/README.md` and v3 orchestrator rule 4, a conflict between v3's
letter and this repo is resolved by an ADR, never by a silent edit to the ratified text (the same
mechanism used by ADR-0024 for prompt 27 and ADR-0026 for §18's stack). That sentence is therefore read
through this ADR: **Gate A's requirement set is `{1, 2, 4, 5}`, and `v3-invariants.json` is the
authoritative, executable statement of every gate's requirements.** Invariant 3 is not weakened, waived,
or deferred without a trigger - it is required, in full, at Gate B.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Move prompt 10 into Wave A to satisfy Gate A | Domain configuration binds primitives (prompt 8) and the policy AST (prompt 9); pulling it forward runs the build against its own dependency order and would overfit the primitive vocabulary to whatever prompt 10 needed first (v3 §20 risk 3). |
| Declare invariant 3 active-green on the Wave A scaffold (no domain-named directories exist *yet*) | Fake green. The invariant's subject - decision domains expressed as data - does not exist in Wave A, so a fence over it would pass vacuously, which charter #4 names as worse than no fence. It would also put a false "implemented" claim into the report, the proof log, and any phase-state UI. |
| Waive invariant 3 from every gate | A silent deferral with no trigger, forbidden by the charter; invariant 3 is the transferability guarantee (v3 non-negotiable 7, ADR-0025) and is exactly what must be proven when the domains become configuration. |
| Edit `docs/v3/verin-prompt-sequence-v3.md` line 186 and re-pin its SHA-256 | Rewrites a captain-ratified source document to say something it did not say. The pins exist so the ratified text stays fixed and conflicts surface as ADRs (`docs/v3/README.md`); ADR-0024 and ADR-0026 already override v3's letter without touching its bytes. |
| Register only the gates that own an invariant (leave 0, C, and I out) | Gate D's own entry condition cites "Gate C is green" - a precondition nothing could compute. An unregistered gate is not an absent requirement, it is an unverifiable one. |
| Give gates 0, C, and I an invariant of their own so `requires` can stay an id list | v3's Gate C subject IS invariant 1, which the ruling pins to Gate A; manufacturing a second owner would contradict the ruled set, and §17's 30 invariants are fixed - none may be added or restated to make a gate registrable. |
| Let a requirement-less gate render green and rely on review to catch it | Registration would confer readiness. A gate with nothing to decide is exactly the fake green this ADR exists to remove. |

## Trade-offs and Costs

- **Gained:** Gate A becomes reachable, so Wave A can close honestly. Invariant 3 keeps its full
  strength at the gate where it can actually be proven. The gate/wave ordering relation becomes
  structural: the same class of circular gate cannot be re-introduced by prose, because the ordering
  fence decides it from the registry.
- **Sacrificed:** the registry's `gates` map is now structured data rather than one line of prose per
  gate; every not-yet-active invariant must carry `activationPrompts`, and every gate requirement must
  be typed and name the prompt that produces it - a small, fenced maintenance obligation on anyone
  adding or re-gating an invariant. The repo diverges from one sentence of the ratified prompt sequence,
  so every reader of that sentence needs this ADR (hence the pointers in `docs/v3/README.md`,
  `CLAUDE.md`, and the registry description).

## Consequences

- `v3-invariants.json`: all nine gates of the ratified sequence are registered with typed requirement
  lists; invariant 3 moves to gate B with `activationArtifacts`; invariant 4's `activatesWhen` now names
  its Wave A activation subjects (prompts 5-7) explicitly, since Gate A requires it - later waves extend
  the same §16 fence family without re-gating it (ADR-0026).
- Gate A's requirement set is unchanged by the review round: `{1, 2, 4, 5}`, all four owned by A. Gate B
  requires invariant 3 plus prompt 10's two `config/domains/*.yaml` artifacts. Gate C references
  invariant 1 without owning it. Nothing else took an invariant from another gate.
- Registering a gate cannot make it green. Today gate 0 reads `not-yet-verifiable` (no mechanism decides
  completeness against the demo contract's §4 required-surface list - the skeleton-honesty fence proves
  contract parity and the surface import boundary, and the e2e walkthrough screenshots a hard-coded
  path, but a dropped surface would fail nothing), and gates A through I read `not yet green` against
  their own unmet requirements. `pnpm v3:invariants` prints all nine.
- `scripts/v3-gates.lib.ts` is the single rule set; the fence and the blocking runner both import it, so
  a rule cannot be enforced in one and missing in the other.
- `charter-map.json` gains the `v3-gate-ordering` operating-model entry, so the charter-drift fence's
  orphan and ratchet checks cover the new fence.
- Wave B's entry condition is recorded on gate B: prompts 5, 6, and 7 landed **and** invariants 1, 2, 4,
  5 active and green. Prompt 5 landed with ADR-0029; prompts 6 and 7 remain open.
- The adversarial proof for the new fence is PF-018 in `docs/fences/proof-log.md`.
- This does **not** change what invariant 3 requires, when prompt 10 runs, or the deferral of prompt 27
  (ADR-0024). It changes only which gate holds invariant 3.

## Revisit When

- A future invariant's activation prerequisite legitimately spans two waves (activation begins in one,
  completes in another): the ordering fence's single `max(activationPrompts) <= gate.lastPrompt` rule
  needs a per-invariant partial-activation model rather than a wider tolerance.
- Prompt 10 lands: invariant 3 flips to `active` with its naming fence in the same PR, its
  `activationArtifacts` become real, and Gate B is evaluated for green. The fence asserts no invariant's
  CURRENT status - it asserts that `active` requires the declared artifacts to exist - so the flip needs
  no test edit. If the fence cannot be written without domain-named exceptions, the primitive vocabulary
  is overfit and ADR-0025's revisit trigger fires first.
- A mechanism lands that decides an `evidence` requirement (gate 0's §4 surface-completeness clause,
  gate C's validated-bundle clause, gate I's severity verdict): replace that entry with the
  `invariant` / `fitness` / `artifact` requirement that decides it, in the same PR. An `evidence` entry
  is a named gap, never a permanent excuse.
- Any gate's `requires` list is proposed for change: that is an amendment to this ADR and to ADR-0023's
  phase-gated commitment, never a registry edit alone.
