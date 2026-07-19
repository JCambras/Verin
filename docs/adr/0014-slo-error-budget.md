# ADR-0014: SLOs and the error-budget policy

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiable #14, #11
**Informed by:** Iris ADR-0015/0019; retro-r7 missing-prompt #8 ("latency budget is unowned … 30s/5m timeouts are meeting-hostile")

## Context

Non-functionals must be *measured, not modeled*. A Type II audit and an SLA both require named SLOs with an
error-budget policy, measured from real telemetry (ADR-0013).

## Decision

Foundation SLO targets (measured via OTel):

- **Availability:** 99.5% of successful requests per rolling 30 days.
- **Flow step latency:** p95 < 2s (interactive steps); LCP < 2.5s for the primary surfaces.
- **Health endpoint:** p99 < 500ms.
- **Error rate:** < 0.5% of requests return a 5xx.
- **Workflow success:** > 95% of started flows complete or suspend cleanly (no crash).

**Error-budget policy:** > 50% budget remaining → ship freely; 20-50% → caution (no risky changes); < 20% →
freeze features, spend the budget on reliability. The load gate (`scripts/load-smoke.ts`, charter #11)
asserts a store-read p95 threshold so a latency regression fails CI — the budget is owned, not
aspirational; the step/LCP/health SLO numbers above are telemetry targets (ADR-0013), not gate assertions.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| No SLOs / unowned latency (Meridian, early Iris) | Meeting-hostile timeouts; no way to hold an SLA or pass Type II. |
| Aspirational SLOs not tied to a gate | Unmeasured targets drift; the charter demands measured. |

## Trade-offs and Costs

- **Gained:** measurable reliability targets; an explicit ship/freeze policy; regression caught by the load gate.
- **Sacrificed:** SLOs constrain shipping when the budget is spent (by design).

## Consequences

Measured by ADR-0013 telemetry; enforced at the boundary by the load/latency gate (charter #11). Tighter
post-scale SLOs are a revisit, not a day-one commitment.

## Revisit When

30 days of production data exist (tighten targets), a second region is added, or a customer SLA requires
different numbers.
