# ADR-0015: The scale ladder — what breaks at 10x/100x and the trigger that un-defers each

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #11, #16; "Scale ladder as an ADR"
**Informed by:** retro-r7 don't-again #18 (concurrency/resource bugs never run at scale), gap-s4 §5

## Context

The CI load gate stays at pilot scale (1,000 households × ~2,000 accounts, D-010). Scaling stays a *plan,
not speculative day-one engineering* — but every deferral names the measurable trigger that un-defers it,
so nothing is deferred silently.

## Decision — the ladder

| Item | Pilot (now) | Breaks at | Un-defer trigger | Then do |
|------|-------------|-----------|------------------|---------|
| **Data store** | One managed Postgres (PGlite in dev/CI) | ~10x tenants / write throughput | p95 store latency breaches SLO under load, or connections saturate | Connection pooling (PgBouncer), read replicas, then per-tenant sharding |
| **Tenancy isolation** | App-level `org_id` filter (fenced) + RLS-ready | Many firms on one instance | First multi-firm production instance | Postgres RLS policies per `org_id`; consider DB-per-tenant for the largest |
| **Long-running work** | Transactional outbox (ADR-0009) | Outbox backlog / backpressure | Sustained outbox depth > 10k or drain latency breaches SLO | Real broker (SQS/Kafka) with backpressure + a durable workflow engine |
| **Audit hash-chain** | Per-write hash in the app | Very high write volume | Per-write hashing breaches step-latency SLO | Batch/merkle the chain; async verify sharded by `org_id` |
| **Salesforce API limits** | No SF adapter yet | SF as 2nd source at volume | SF adapter live + batch > 25 records or API budget pressure | Bulk API 2.0 / Composite; proactive governor (per-tenant limit tracking) |
| **Cost per tenant** | Unmetered | Many tenants | First cost-attribution need | Per-tenant metering via OTel resource attributes |
| **House-CRM → SF sync/import** | Not built | Second source connects | A customer connects Salesforce/CSV | Build the second CRM adapter + activate survivorship (ADR-0005) |

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Engineer for 100x now | Speculative day-one engineering the charter forbids; unproven complexity. |
| Defer scaling with no triggers | Silent deferral; the charter requires a measurable un-defer trigger per item. |

## Trade-offs and Costs

- **Gained:** a named, triggered plan for every scale cliff; no speculative complexity now.
- **Sacrificed:** each trigger must actually be watched (SLO telemetry, ADR-0013/0014).

## Consequences

The load gate (ADR-0018, charter #11) measures the pilot ceiling; SLO breaches under load are the triggers.
Each ladder item, when triggered, opens a follow-up ADR (do not overwrite this one).

## Revisit When

Any row's trigger fires (open a follow-up ADR for that item), or a new scale dimension appears.
