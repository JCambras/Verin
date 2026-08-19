# ADR-0023: Adopt the v3 direction - Verin as the governed decision and execution layer

**Status:** Accepted (charter amendment - product framing; v3 §3/§17 adopted as phase-gated commitments)
**Date:** 2026-07-26
**Deciders:** captain (v3 ratification, 2026-07-26), founding architect
**Relates to:** charter operating model (amended only by ADR; charter-drift fence); all 16 non-negotiables (unchanged); ADR-0024..0028 (the deviations and deferrals this adoption requires); ADR-0010 (workflow engine - repositioned, see Consequences)
**Informed by:** `docs/v3/marriage-map.md` (the full alignment analysis; conflicts C1-C15), especially C9 (the two-constitutions risk)
**Amended by:** ADR-0055 (Gate A owns invariants 1, 2, 4, and 5; invariant 3 is gated at B); ADR-0060
(scope only: this adoption stays accepted for CURRENT VERIN and stands as fourth-generation oracle
evidence; it selects no replacement architecture and does not bind fourth-generation composition
unless the later F8 captain ratification explicitly adopts it)

## Context

The repo was chartered as a practice-intelligence platform an RIA runs its book on, with the house CRM
as system of record (`CHARTER.md` SoR strategy; `PRODUCT-DIRECTION.md` "Iris on the surface"). The v3
architecture (`docs/v3/verin-architecture-v3.md`) repositions Verin as **the governed decision and
execution layer for RIA operations**: external systems (CRM, meeting tools, custodians) supply evidence,
provide staff surfaces, and perform actions; Verin determines the governed action, explains it, routes
authority, coordinates execution, and records what was proven. Its core is the 15-stage decision spine
(§4), a typed policy AST with a deterministic evaluator (§6), authority stages (§11), a typed append-only
event ledger with byte-identical replay (§12), and execution integrity (reservations, revalidation,
idempotency - §13). It ships with 12 non-negotiables (§3), 30 phase-gated invariants (§17), a module map
(§16), a 30-prompt build sequence, and a Phase 1 demo contract.

The v3 document's own header claims "Ground truth for all build work. Supersedes prior planning and
architecture documents." Taken literally that creates two rival constitutions (marriage-map C9): this
repo already has a constitution (`CHARTER.md`), amended only by ADR, with a charter-drift fence that
enforces its own enforcement. The marriage map's analysis: the v3 methodology is the SAME soul as the
charter's (phase-gated invariants never fake green == adversarially-proven fences; honest status labeling
== charter #3; tenant scoping == charter #7; append-only ledger == charter #13), and nearly all of the
existing foundation carries forward (marriage-map §2).

## Decision

**Adopt the v3 thesis, spine, contracts, invariants, and build sequence as the ratified direction - and
ratify them INTO the existing charter machinery, never beside it.** Concretely:

1. **One constitution.** `CHARTER.md` remains the only constitution. Its product-framing is amended (by
   this ADR, in the same PR) to state the decision-layer thesis and point at `docs/v3/`. The v3 header's
   "supersedes prior documents" is read as "ratified direction, implemented through the charter's own
   amendment process" - exactly what this ADR does. The charter's 16 non-negotiables stand unchanged:
   they cover the ops/security axes (SOC 2, DR, supply chain, a11y, budgets, observability) v3 does not;
   v3's 12 non-negotiables + 30 invariants cover the decision core the 16 do not.
2. **The four v3 documents are committed verbatim** under `docs/v3/` with a README stating their status,
   plus the marriage map (the alignment analysis). Each is SHA-256-pinned in `v3-invariants.json` and
   verified by the arch-version fence, so no build session can silently target a stale copy
   (prompt-sequence prompt 4's "architecture checksum").
3. **The 30 §17 invariants become phase-gated commitments** registered in `v3-invariants.json` (sibling
   to `charter-map.json`, same doctrine): each names its phase gate, its activation state, and - when
   active - the live mechanism enforcing it. A blocking CI job (`v3-invariants`) reports every invariant
   three-state (active-pass / active-fail / not-yet-active) and fails on active-fail. Not-yet-active is
   visibly distinct from passing; CI never fakes green (v3 §17 preamble == charter #4's soul).
4. **Every PR names its phase, active invariants served, demo behavior changed, and unresolved
   architecture contradictions** (PR template; orchestrator rule 3). A contradiction with the
   architecture stops work and is raised, never silently resolved (orchestrator rule 4).
5. **The v3 module map (§16) lands inside the four chartered layers** (marriage-map C6): v3 modules
   become `domain/` (+ `infrastructure/`) subsystems under the existing dependency rule; v3's dependency
   rules (e.g. `decision/` never imports `llm/`; no module imports `config/`) become new fences in the
   waves that create those modules. No flat module tree replaces the layers.
6. **The build sequence is the re-baselined 30-prompt sequence** (marriage-map §6), which assumes this
   shipped repo, not a greenfield (C12). The previously queued p2-p7 demo chain is superseded by it.
   Existing gates (fences, e2e/axe, knip, load, chain-verify, secret-scan, SAST, non-UTC discipline) are
   extended, never replaced or weakened.

What this ADR does NOT do: it does not build any decision-core code (that starts at Wave 0/A of the
sequence); it does not modify `PRODUCT-DIRECTION.md` (its v2 revision - marriage-map C7 - is separately
planned); it does not resolve the stack/timing conflicts - those are ADR-0024 (Salesforce), ADR-0025
(money movement), ADR-0026 (stack + FirmId), ADR-0027 (Wave 0 fakes), ADR-0028 (design language).

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Treat v3 as literal ground truth superseding CHARTER.md | Two rival constitutions (C9). The charter-drift fence, proof-log discipline, and ADR trail all hang off CHARTER.md; abandoning them abandons the enforcement machinery v3 itself demands. |
| Reject v3; keep the practice-intelligence/house-CRM framing | The captain ratified the v3 direction. The marriage map shows v3 is an improvement of direction, not a rebuild: nearly every foundation asset carries forward. |
| Adopt v3 informally (prose note, no registry/runner/pins) | Prose-only invariants are the exact disease the charter forbids. 30 unregistered invariants would drift silently; a stale architecture doc would be invisible. |
| Extend charter-map.json's 16 entries with 30 more | Different lifecycles: charter entries are all-active and ratcheted; v3 invariants are phase-gated with activation states. A sibling registry keeps the charter-drift fence's semantics untouched (it still sees and ratchets the new fences via charter-map entries). |

## Trade-offs and Costs

- **Gained:** one ratified, machine-pinned direction a fresh agent can read entirely in-repo; the 30
  invariants tracked honestly from day zero instead of appearing mid-build; the charter machinery
  (amend-by-ADR, drift fence, proof log) now covers the decision core.
- **Sacrificed:** governance surface grows (a second registry + runner + pins to maintain); every edit to
  a ratified v3 document now costs a pin update + invariant review in the same PR (that friction is the
  point).

## Consequences

- `CHARTER.md` gains a PRODUCT FRAMING amendment block referencing this ADR (charter operating model:
  ADR-referenced in the same PR, never silent).
- `v3-invariants.json` + `scripts/v3-invariants.ts` (CI job `v3-invariants`) + two fences ship in this
  PR: `arch-version.test.ts` (document pins) and `v3-invariants.test.ts` (registry integrity - the
  registry cannot store a PASS, only activation state; results are computed by running the mapped
  fences). `charter-map.json` gains operating-model entries for both, so the charter-drift fence's
  orphan/ratchet checks cover them.
- ADR-0010's generic workflow engine is repositioned, not retired (marriage-map C10): it survives as the
  execution substrate; the account-opening flow definition migrates to domain configuration in Wave B
  (prompt 10); "not a workflow builder" (v3 §6) governs the product story.
- Wave 0 build work may begin only under the re-baselined sequence, respecting ADR-0024's Salesforce
  deferral and ADR-0028's design-language gate.

## Revisit When

- Any ratified v3 document changes: the arch-version fence forces the pin update; the same PR must
  review `v3-invariants.json` for drift and record material changes by ADR.
- `PRODUCT-DIRECTION.md` v2 lands (C7): it must restate the product story under this framing or name the
  contradiction.
- Phase 1 completes (all 30 invariants active-pass): fold the lessons into a v4 review of what §17
  missed, per the known-risks register (v3 §20).
