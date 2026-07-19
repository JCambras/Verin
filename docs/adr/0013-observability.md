# ADR-0013: Observability from commit #1 — OpenTelemetry traces, metrics, structured logs

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiable #14, #11
**Informed by:** retro-r7 missing-prompt #8; Iris ADR-0015 (SLOs); don't-again #20 (no monitoring)

## Context

"A Type II audit and an SLA are both impossible blind." Meridian scored Availability 1.5/5 (no monitoring).
Observability must exist from commit #1, not be retrofitted.

## Decision

Wire OpenTelemetry (`@opentelemetry/*`) so every flow step and every external/store call emits a **trace
span** carrying latency + outcome attributes (`durationMs`, `ok`); a dedicated OTel **metrics** pipeline
(step-latency / flow-outcome / outbox-depth instruments) is deferred to the deploy target; today those
signals live on spans and in `/ready`'s backlog query; and all logs are **structured** via `pino` with
PII scrubbed (ADR-0006) — raw `console.*` is
banned outside a small allowlist (only the logger scrubs PII). A dev/test exporter keeps spans in-process
(no external collector required); production points OTLP at a collector via config (ADR-0003). Correlation
ids thread from the HTTP boundary through the engine to the store/webhook. **Health + readiness endpoints**
(`/health`, `/ready`) report liveness and store/outbox readiness (charter #11). A fitness fence
asserts the engine step path and external calls are instrumented (not silently un-traced).

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Add observability later | Blind builds cannot pass Type II or hold an SLA; retrofit misses the early flows. |
| Vendor-specific APM SDK | OTel is vendor-neutral; the collector/exporter is a config choice. |
| console.log logging | No structure, no PII scrubbing, not queryable. |

## Trade-offs and Costs

- **Gained:** every step/external call is traced; SLOs measurable; dated evidence for Type II.
- **Sacrificed:** instrumentation overhead; spans/metrics to maintain as flows grow.

## Consequences

Feeds the SLO/error-budget policy (ADR-0014) and health checks (charter #11). Alerting rules as code land
with the deploy target. Fence: observability-coverage (engine + external calls instrumented).

## Revisit When

A second region or real production traffic warrants a managed backend + sampling strategy, or per-tenant
cost attribution is needed.
