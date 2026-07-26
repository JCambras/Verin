# ADR-0025: Money movement is the Phase 1 vertical

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** captain (effective reversal in the queued 7-prompt demo chain; confirmed by v3 ratification 2026-07-26), founding architect
**Relates to:** ADR-0023 (v3 adoption); ADR-0024 (Salesforce deferral - execution stays faked until the trigger); charter #16 (idempotent external writes); v3 §2 (demo contract), §13 (concurrency is a Phase 1 concern), §19 (Phase 1), non-negotiable 7 / invariant 3 (no domain-named core modules)
**Informed by:** `docs/v3/marriage-map.md` conflict C5

## Context

The earlier POC strategy directive sequenced Wave 1 as read flows (meeting-prep, compliance-scan views)
with money movement in Wave 2 - the reasoning was to prove the surface before touching the highest-risk
operation. The captain effectively reversed that in the queued 7-prompt demo chain (its P6 built a
money-movement demo beat), and v3 makes the reversal explicit: **money movement IS the Phase 1
vertical** - "one polished money-movement vertical" (§19), the seven-minute "$75,000 for the Smiths"
journey (§2, demo contract), and §13's ruling that money movement makes concurrency, reservations, and
idempotency Phase 1 concerns rather than future enhancements. The rationale: only a consequential,
risk-bearing operation proves the decision-led category (disposition, authority, revalidation,
reservation, honest status) - a read flow cannot demonstrate any of that.

## Decision

**Ratify money movement as the Phase 1 vertical.** The read-flows-first Wave 1 sequencing is superseded.
Concretely:

1. Phase 1 is the v3 §2 / demo-contract journey: intent through evidence, disposition, authority,
   revalidation, reservation, idempotent execution, honest status, Firm A/B comparison, and the one
   constrained natural-language policy moment.
2. Concurrency safety is in scope from the start (v3 §13): conflict keys, reservations, pre-execution
   revalidation, and the two-simultaneous-$75k reference failure are Phase 1 requirements, not
   stretch goals.
3. **Money movement enters the system as configuration, never as a core module** (v3 non-negotiable 7,
   invariant 3, prompt 10): `config/domains/money-movement.yaml` against shared primitives. Account
   opening is expressed as configuration in the same wave precisely so the primitives are not overfit to
   one vertical (v3 §20 risk 3).
4. Read-flow surfaces (meeting-prep, compliance-scan, role-aware homes) become later-phase surfaces
   (marriage-map C7); compliance beats survive inside the Phase 1 journey as evidence/conflict and
   examiner-record views.

Execution against a real external system remains governed by ADR-0024: the vertical is built and proven
against in-memory fakes; the real Salesforce path lands when the sandbox trigger fires; Phase 1 is never
declared complete on fakes.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Keep read-flows-first (original Wave 1) | Read flows cannot prove the decision-led category - no disposition, authority, revalidation, or honest execution status to show. The captain already walked away from this order in the 7-prompt chain. |
| A lower-risk write vertical first (e.g. account opening) | Account opening is already the walking-skeleton flow and stays as the second configured domain (prompt 10), but it lacks the liquidity/reservation/concurrency stakes that make the investor "aha" (v3 §13). |
| Money movement as a hardcoded core module to move faster | Violates v3 non-negotiable 7 and invariant 3 outright; it is the exact transferability failure (a thousand firms needing a thousand implementations) v3 §1 names. |

## Trade-offs and Costs

- **Gained:** Phase 1 proves the category on the operation where governance actually bites; the
  scariest engineering (concurrency, idempotency, revalidation) is confronted first on the existing
  idempotent-write substrate (charter #16, `auditedWrite`) instead of discovered late.
- **Sacrificed:** the friendlier read-flow demos arrive later; Phase 1 carries real financial-harm risk
  classes (v3 §20 risk 7) that read flows would have dodged - mitigated by invariants 20-25 and the
  golden-case corpus.

## Consequences

- The re-baselined prompt sequence (marriage-map §6) is the build order; Wave 0 (demo contract, golden
  cases, walking skeleton) starts when its gates allow, under ADR-0027 (labeled fakes) and ADR-0028
  (design language).
- `v3-invariants.json` demo invariants (26-30) reference the money-movement journey as their activation
  subject.
- No `money_movement/` (or any domain-named) directory may appear in core code - enforcement lands with
  the Wave A/B fences per invariant 3's registry entry.

## Revisit When

- Phase 2 planning: the vertical's primitives face the cross-domain matrix (account opening, trading,
  life events, client service) - if they only serve money movement, the vocabulary is overfit (v3 §20
  risk 3) and the primitive set is re-derived.
- The demo-contract cast reconciliation (marriage-map C8) is decided by the captain (Smiths joining the
  Cascade world vs a new cast) - a demo-contract edit, not a re-sequencing.
