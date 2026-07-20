# ADR-0018: Line budgets — ratchet-down platform ceilings, a separate growable presentation budget, a load gate

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #1, #10, #11
**Informed by:** retro-r7 do-again #36/#37 (shrink-only budgets, ratcheting ceilings), don't-again (shrink-only global budget punished richness); gap-s4 §3-Structural #2

## Context

Iris's line budgets turned measured cleanliness into an invariant, but a single shrink-only global budget
*penalized* adding richness to the surface users most wanted it (fact-find at 99.7% full). The fix: keep
platform ceilings ratchet-down, but give the presentation tier its **own** budget, generous and growable
only by an ADR bump.

## Decision

Two independent budgets, both fitness-enforced (Phase B/D):

- **Platform ceiling** — `contracts/` + `domain/` + `infrastructure/` production lines. **Ratchet-down
  only**: lowering a ceiling is a code change; raising it is an ADR amendment. Plus a per-file ceiling
  (default; a pinned map of known-larger files that only shrinks).
- **Presentation budget** — `app/presentation/` (+ presentation flows). Its own separate envelope, **grown
  only by an explicit ADR bump** (never a silent edit) so richness is planned. Platform ceilings are
  unaffected by presentation growth.

Separately, the **load gate** (charter #11): a deterministic pilot-scale seed (1,000 households × ~2,000
accounts, D-010) with a **p95 step-latency assertion** as a regression gate. The identical pilot-scale run
executes in both `ci.yml` (every push/PR) and `scheduled.yml` (on the schedule) — there is no fast-subset
vs full-scale split (that split was never built, D-010; the nightly full-scale scale-up is deferred, D-018).
A regression fails CI — the latency budget is owned (ADR-0014).

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| One shrink-only global budget (Iris ADR-0031) | Punishes richness where users want it; fights every "make it feel better" PR. |
| No line budgets | Today's cleanliness drifts; god components regrow (retro don't-again #11). |
| Raise a ceiling in code to green the build | The anti-pattern; raising a ceiling must be an ADR decision. |

## Trade-offs and Costs

- **Gained:** platform stays lean (ratchet-down); presentation richness is planned with an owned budget;
  latency regressions fail CI.
- **Sacrificed:** two budgets to maintain; a genuine presentation-growth PR needs an ADR bump.

## Consequences

Fences: `line-budget` (platform ratchet + presentation envelope), `max-file-size` (per-file ratchet), the
load-smoke gate. Charter-map ids 10, 11.

## Revisit When

A budget is legitimately exhausted (an ADR bump for presentation; a refactor to shrink platform), or the
per-file ceiling blocks a justified file (architecture-review note + pinned entry).
