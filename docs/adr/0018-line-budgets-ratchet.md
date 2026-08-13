# ADR-0018: Line budgets — ratchet-down platform ceilings, a separate growable presentation budget, a load gate

**Status:** Accepted (amended by ADR-0029, the ADR-0030..0040 line-budget series, ADR-0041, and the ledger series ADR-0042..0045 and ADR-0047..0051, each via this ADR's own amendment path; amended by ADR-0052 §7 and ratified as the Prompt 11c budget slice by ADR-0058: build-time tooling under `scripts/**` is a third measured envelope with its own ceiling, and the per-file ceiling walks that tree too; later live ceilings are recorded by their measured ADR amendments)
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

Two independent budgets, both fitness-enforced (Phase B/D) - joined later by a third, the tooling
envelope of ADR-0052 §7:

- **Platform ceiling** — `contracts/` + `domain/` + `infrastructure/` production lines. **Ratchet-down
  only**: lowering a ceiling is a code change; raising it is an ADR amendment. Plus a per-file ceiling
  (default; a pinned map of known-larger files that only shrinks).
- **Presentation budget** — `app/presentation/` (+ presentation flows). Its own separate envelope, **grown
  only by an explicit ADR bump** (never a silent edit) so richness is planned. Platform ceilings are
  unaffected by presentation growth.
- **Tooling envelope** (added by ADR-0052 §7) - `scripts/**`, previously walked by neither budget fence.
  Same rules: its own ceiling, raised only by an ADR amendment, with the same zero-total staleness guard,
  so moving code out of `src/` measures it instead of hiding it.

ADR-0058 ratifies this tooling envelope as the Prompt 11c slice against the integrated tree. The line
budget and per-file fence share one executable-source discovery, the zero-total rule is proven from an
actually empty tooling root, and a planted script overage is measured through the real counter. The
complete tree measures 14,317 tooling lines under the unchanged 14,350 ceiling, with 33 lines of named
correction room. The largest script measures 468 lines under the unchanged 500-line default.

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

Fences: `line-budget` (platform, presentation, and tooling envelopes), `max-file-size` (shipped and
tooling per-file ratchet), and the load-smoke gate. Charter-map ids 1, 10, 11. ADR-0058 maps both budget
fences to charter #1 as well as the presentation obligation under #10.

## Revisit When

A budget is legitimately exhausted (an ADR bump for presentation; a refactor to shrink platform), or the
per-file ceiling blocks a justified file (architecture-review note + pinned entry).
