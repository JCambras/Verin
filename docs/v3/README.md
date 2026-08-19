# docs/v3 - the ratified Verin v3 architecture direction

**Status: RATIFIED DIRECTION FOR CURRENT VERIN** (captain, 2026-07-26; scoped for the fourth
generation by ADR-0060), implemented into this repo's charter machinery by
**ADR-0023 through ADR-0029, ADR-0039, ADR-0041, ADR-0052, ADR-0053, and ADR-0055** (`docs/adr/`). The ratified documents in the table below are committed
**verbatim** from the ratified sources; the arch-version fence
(`src/__tests__/fitness/arch-version.test.ts`) checks the documents **registered in**
[`v3-invariants.json`](../../v3-invariants.json) against their SHA-256 pins, so build work can never
silently target a stale or edited copy of a registered document. The fence covers that registry, not this
directory: a file under `docs/v3/` that is absent from `v3-invariants.json` is not byte-protected, so a
new ratified document must be registered there in the PR that adds it. If a registered document
legitimately changes, update its pin **in the same PR** and review the invariant registry for drift.
**This index page is deliberately not registered** - it is navigation, not ratified content, so it
originates nothing normative: every rule stated here restates a registered document, an ADR, the
charter, or a [`DECISIONS.md`](../../DECISIONS.md) entry, and a new normative statement originates in one
of those instead (D-099).

There is exactly ONE constitution: [`CHARTER.md`](../../CHARTER.md). The v3 architecture doc's own
"supersedes prior documents" header is read through ADR-0023: v3 is ratified INTO the charter machinery,
never beside it. Where v3 and the charter conflict, the resolution is recorded in an ADR below - never
resolved silently (v3's own rule, §0.5 and orchestrator rule 4).

**Scope under ADR-0060 (restated here, originated in the charter).** `CHARTER.md` clauses F1-F9
authorize one controlled fourth implementation generation and preserve current Verin as the read-only
legacy oracle. The ratified v3 direction indexed here is CURRENT VERIN's architecture direction and
fourth-generation oracle evidence; it is not a selected replacement architecture, and it does not
bind fourth-generation composition unless the later F8 captain ratification explicitly adopts it (F6,
F8; ADR-0060, D-271). The charter likewise keeps the four-layer composition that v3's module map lands
inside binding on current Verin and as oracle evidence; it does not bind fourth-generation composition
unless the later F8 captain ratification explicitly adopts it. This index adds nothing to those
clauses and states no rule of its own about them (D-099).

The standing product thesis is [`docs/product-guide.md`](../product-guide.md) (D-098). It binds nothing
on its own and is subordinate to the ratified documents below.

## The documents

| File | What it is |
|---|---|
| [`verin-architecture-v3.md`](./verin-architecture-v3.md) | The architecture: thesis (§1), Phase 1 demo contract (§2), 12 non-negotiables (§3), the 15-stage decision spine (§4), contracts (§5), policy AST (§6), module map (§16), **30 phase-gated invariants (§17)**, stack (§18), phases (§19), known risks (§20) |
| [`verin-prompt-sequence-v3.md`](./verin-prompt-sequence-v3.md) | The 30-prompt build sequence, waves 0/A-I with gates; orchestrator rules (incl. rule 6: never declare done on fakes) |
| [`verin-demo-contract-v1.md`](./verin-demo-contract-v1.md) | Phase 1 investor demo contract: the seven-minute Smiths $75k journey, Firm A/B, provenance labels (§6), completion test (§8) |
| [`verin-core-contracts.ts`](./verin-core-contracts.ts) | Canonical decision-core contracts (reference document, NOT compiled product code - landed as `src/contracts/decision-core/` Zod-first strict schemas in Wave A prompt 5, ADR-0029/D-040) |
| [`marriage-map.md`](./marriage-map.md) | The alignment analysis that produced the ADRs: what stands, conflicts C1-C15, the 30-prompt sequence re-baselined onto this repo (§6), and the captain's two ruling directives of 2026-07-26 |

## How v3 binds this repo (the ADR trail)

| ADR | Ruling |
|---|---|
| [0023](../adr/0023-adopt-v3-decision-layer-direction.md) | v3 adopted: Verin is the governed decision and execution layer; §3 + §17 become phase-gated commitments (charter product-framing amendment) |
| [0024](../adr/0024-salesforce-acceleration-deferred.md) | Salesforce DEFERRED: zero SF adapter code until the un-defer trigger (sandbox access granted); fakes carry every wave; Phase 1 is never declared complete on fakes |
| [0025](../adr/0025-money-movement-phase1-vertical.md) | Money movement is the Phase 1 vertical (supersedes read-flows-first Wave 1) |
| [0026](../adr/0026-stack-deviations-from-v3.md) | Stack deviations from v3 §18: PostgreSQL stays (D-001), Next.js App Router stays, ts-morph fences stay; FirmId ≡ org_id |
| [0027](../adr/0027-demo-first-wave0-labeled-fakes.md) | Wave 0 walking skeleton on internally-labeled fakes is charter-legal (charter #5 extension; no mock theater) |
| [0028](../adr/0028-demo-design-language.md) | Demo UI uses the ESTABLISHED Verin design system; v3 visual prescriptions rejected; v3 UX semantics re-expressed via `docs/demo-design-language.md` |
| [0029](../adr/0029-decision-core-contracts.md) | Prompt 5 landed: the §5 decision-core contracts as Zod strict schemas in `src/contracts/decision-core/`; contracts ceiling re-baselined 600→3500 (amends ADR-0018); invariants 7-9 active |
| [0039](../adr/0039-primitive-vocabulary.md) | Prompt 8 landed: the decision-primitive vocabulary as a versioned, provisional, falsification-tested six-primitive catalog in `src/contracts/primitives/` (v3's `src/primitives/catalog.ts` re-baselined per marriage-map C6), mirrored by the root registry `primitive-set-version.json`; contracts ceiling re-baselined 4,050→5,460 by [ADR-0040](../adr/0040-line-budget-primitive-vocabulary.md) (amends ADR-0035) |
| [0041](../adr/0041-sibling-decision-ledger.md) | Prompt 7 landed: the append-only `decision_ledger` as a SIBLING of the operational `audit_log` (never an extension of it), with immutable replay sources, the vocabulary frozen at 16 event types (v3's 14 plus `ApprovalStageExpired`/`ApprovalStageEscalated`), deterministic projections, and the read-only register at `/app/ledger`; amends ADR-0007, ADR-0018, and ADR-0019, and is itself amended by ADR-0042, ADR-0044, ADR-0046, and ADR-0047 (with the rest of the ADR-0042..0051 series carrying the line budgets); invariant 5's mechanisms and invariant 2's tenancy notes extended, while invariants 4 and 23 gain substrate mechanisms and stay not-yet-active |
| [0052](../adr/0052-synthetic-corpus-and-provenance-split.md) | Prompt 11 landed: the §2.4 replay corpus as a deterministic synthetic substrate in `fixtures/corpus/` + `scripts/corpus/`, with a fenced provenance split, an honestly empty real-derived partition (deferred, no `detectionRate`), and digest-bound per-version captain signoff; `scripts/**` becomes a measured `tooling` budget (amends ADR-0018); no invariant is activated |
| [0053](../adr/0053-policy-ast-and-interpreter.md) | Prompt 9 landed: the §6.1 constrained policy AST as a CLOSED grammar in `src/contracts/decision-core/policy.ts` (grammar 1.0.0 active; 1.1.0 adds only the reserved `elapsed` op, refused by the loader as grammar-only) plus the pure deterministic interpreter `src/domain/policy/` (seven-check loader, conservative effect-conflict rejection, four-phase fail-closed evaluator); invariant 16 activates; contracts and domain ceilings re-baselined by [ADR-0054](../adr/0054-line-budget-policy-ast.md) (amends ADR-0041 and ADR-0051) |
| [0055](../adr/0055-gate-a-invariant-ordering.md) | Gate A owns invariants 1, 2, 4, and 5 and requires prompt-5 guarantees 7, 8, and 9; invariant 3 is gated at **B** (its prerequisite is prompt 10) |

## The 30 invariants, phase-gated

[`v3-invariants.json`](../../v3-invariants.json) registers every v3 §17 invariant with its phase gate,
activation state, and (for active ones) the live enforcing mechanism. `pnpm v3:invariants` prints the
three-state report - **active-pass / active-fail / not-yet-active** - and is a blocking CI job
(`v3-invariants` in `.github/workflows/ci.yml`) that fails on any active-fail. A not-yet-active invariant
is rendered visibly distinct from a passing one; CI never fakes green (v3 §17 preamble).

**Gate requirements are read from the registry, not from the prompt-sequence prose.** All ten gates of
the ratified sequence (0, A, B, C, D, E, F, G, H, I - G closes after prompts 27-28 and H after 29, as the
wave map declares) are registered with their wave, prompt range, structural predecessor-gate list, entry
condition, outcome, and a list of TYPED requirements - `invariant`, `artifact`, `fitness`, `ci-gate`
(machine-checkable) and `evidence` (an outcome clause with no executable proof yet, which can never read
green). Activation OWNERSHIP (`invariant.gate`) is distinct from gate REQUIREMENT, a requirement is set
at the EARLIEST gate that can prove the WHOLE invariant, and nothing a gate requires may be proven after
that gate closes.

The complete rule set - the ordering rule, the five ratchets, the CI-evidence grammar (what makes a
`ci-gate` command blocking evidence and what neutralizes it), gate readiness, and the
registry-structural validation - is owned by [ADR-0055](../adr/0055-gate-a-invariant-ordering.md)
(including its amendment log and "Revisit When" triggers) and implemented ONCE in the shared modules
under `scripts/v3-gates/`, reached through `scripts/v3-gates.lib.ts` and enforced by BOTH the
gate-ordering fence (`src/__tests__/fitness/v3-gate-ordering.test.ts`) and the blocking runner
(`scripts/v3-invariants.ts`), so the two cannot drift and this index does not restate them. The
charter-drift fence reads CI through the same `parseCiJobs` authority. The Gate 0
surface-completeness, screenshot-evidence, Playwright/Axe, and Vitest-registration enforcement
mechanics likewise live in their fences (`src/__tests__/fitness/demo-surface-completeness.test.ts`,
`src/__tests__/fitness/axe-required.test.ts`, `src/__tests__/fitness/charter-drift.test.ts`) and the
ADR-0055 amendment log, not here.

Per **ADR-0055**, `verin-prompt-sequence-v3.md:186`
("Gate A: Foundation invariants 1–5 are active and green") is read as **Gate A owns invariants 1, 2,
4, and 5 and also requires prompt-5 structural guarantees 7, 8, and 9 at their earliest proof point**;
invariant 3 is required at **Gate B**, because its prerequisite - prompt 10, where account
opening becomes domain configuration - is in Wave B. Invariant 3 is not weakened or waived: until prompt
10 exists, no document, proof, or UI may claim it is implemented.

## What a build session must do

1. Read `CHARTER.md` first (always), then this directory.
2. Read `verin-architecture-v3.md` before any decision-core work; read the demo contract before any
   UI/demo work. UI prompts (3, 29) additionally read `docs/demo-design-language.md` first (ADR-0028;
   now authored - the gate is satisfied).
3. Name the phase, active invariants served, demo behavior changed, and unresolved contradictions in
   every PR (the PR template asks; orchestrator rule 3).
4. On contradiction with the architecture: stop and raise it. Never improvise around it (orchestrator
   rule 4).
