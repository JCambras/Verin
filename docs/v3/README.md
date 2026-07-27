# docs/v3 - the ratified Verin v3 architecture direction

**Status: RATIFIED DIRECTION** (captain, 2026-07-26), implemented into this repo's charter machinery by
**ADR-0023 through ADR-0028** (`docs/adr/`). These documents are committed **verbatim** from the ratified
sources; each file's SHA-256 is pinned in [`v3-invariants.json`](../../v3-invariants.json) and verified by
the arch-version fence (`src/__tests__/fitness/arch-version.test.ts`), so build work can never silently
target a stale or edited copy. If a document legitimately changes, update its pin **in the same PR** and
review the invariant registry for drift.

There is exactly ONE constitution: [`CHARTER.md`](../../CHARTER.md). The v3 architecture doc's own
"supersedes prior documents" header is read through ADR-0023: v3 is ratified INTO the charter machinery,
never beside it. Where v3 and the charter conflict, the resolution is recorded in an ADR below - never
resolved silently (v3's own rule, §0.5 and orchestrator rule 4).

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
| [0029](../adr/0029-decision-core-contracts.md) | Prompt 5 landed: the §5 decision-core contracts as Zod strict schemas in `src/contracts/decision-core/`; contracts ceiling re-baselined 600→3100 (amends ADR-0018); invariants 7-9 active |

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
