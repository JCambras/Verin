# docs/v3 - the ratified Verin v3 architecture direction

**Status: RATIFIED DIRECTION** (captain, 2026-07-26), implemented into this repo's charter machinery by
**ADR-0023 through ADR-0028** (`docs/adr/`). The ratified documents in the table below are committed
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

## The 30 invariants, phase-gated

[`v3-invariants.json`](../../v3-invariants.json) registers every v3 §17 invariant with its phase gate,
activation state, and (for active ones) the live enforcing mechanism. `pnpm v3:invariants` prints the
three-state report - **active-pass / active-fail / not-yet-active** - and is a blocking CI job
(`v3-invariants` in `.github/workflows/ci.yml`) that fails on any active-fail. A not-yet-active invariant
is rendered visibly distinct from a passing one; CI never fakes green (v3 §17 preamble).

## What a build session must do

1. Read `CHARTER.md` first (always), then this directory.
2. Read `verin-architecture-v3.md` before any decision-core work; read the demo contract before any
   UI/demo work. UI prompts (3, 29) additionally read `docs/demo-design-language.md` first (ADR-0028;
   now authored - the gate is satisfied).
3. Name the phase, active invariants served, demo behavior changed, and unresolved contradictions in
   every PR (the PR template asks; orchestrator rule 3).
4. On contradiction with the architecture: stop and raise it. Never improvise around it (orchestrator
   rule 4).
