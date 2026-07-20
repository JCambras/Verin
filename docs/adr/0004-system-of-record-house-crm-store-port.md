# ADR-0004: House CRM as system of record, behind a CRM/Store port, on PostgreSQL

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect; captain (D-001, D-006)
**Relates to:** Charter non-negotiables #2, #7, #16; System-of-Record strategy (decided)
**Informed by:** retro-r7 don't-again #4, #5, #6, #7 (single-custodian facade, one-org-pattern SF integration, no golden record); gap-s4 §System-of-record

## Context

The charter decides the system of record: Verin ships its own **house CRM** as the real SoR for the PoC —
the canonical schema (ADR-0005) *is* its schema, seeded with a (minimal, labeled) world, records durable
and editable live in a demo. Salesforce comes later as a *second* adapter. Meridian's diseases to avoid:
a client-side shadow world, a single global custodian switch, and one-Salesforce-org-pattern coupling.

## Decision

The CRM/store seam is a port. As built, the persistence interface is `SqlDb`
(`src/infrastructure/store/db.ts`) with the house CRM as the module of adapter functions over it
(`house-crm.ts`); a named domain-level `CRMPort` interface is extracted when the first external-CRM
adapter lands. No CRM-native types, field
names, or SDK imports cross the seam (enforced today by the dependency-rule fence and the deliberate
absence of any external-CRM adapter code; a dedicated CRM-type-leak fence lands with the first
external-CRM adapter). The house CRM is the
port's first real adapter: genuine persistence, real CRUD, canonical schema as its schema. The store is
**PostgreSQL** — **PGlite** (real Postgres, WASM, durable) in dev/CI behind that interface, managed Postgres
via `node-postgres` in production (D-006); DDL/triggers are portable Postgres. Every query filters by
`org_id` (fence: org-id-required). No global custodian switch; no hardcoded firm identity. Provenance
`source=verin-crm` (ADR-0005). **No Salesforce adapter code now** (charter #5 forbids unshipped code); the
SF object-graph read/write mapping is maintained as documentation so wiring SF later is adapter work, not
a remodel.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| libSQL/Turso (Iris) | No real per-tenant RLS (its own ADR-0004 defers it); below the SOC2 bar to start on. |
| Client-side demo fixtures as "the product" (Meridian shadow world) | The disease the charter forbids; not durable, no single schema. |
| Build the Salesforce adapter now | Charter #5: no built-but-not-shipped; SF has no live customer need yet. |

## Trade-offs and Costs

- **Gained:** a real, durable, multi-tenant SoR editable live in a demo; a clean seam for SF/CSV later.
- **Sacrificed:** we maintain a CRM instead of deferring to Salesforce; the SF mapping is doc upkeep.

## Consequences

The house-CRM console (Phase E) is the plain internal CRUD surface over these entities, RBAC-gated and
audited. Golden-record/survivorship policy (ADR-0005) anticipates a future second source. Adding the
house-CRM → SF sync/import path is a scale-ladder item (ADR-0015) with a trigger.

**Schema evolution (D-016 trigger executed - deep-review r6 finding #6, D-029).** The store DDL was
initially a single idempotent `CREATE IF NOT EXISTS` script with schema versioning deferred (D-016). The
first real schema change - hardening every temporal column to `timestamptz`, adding the
`contacts`/`financial_accounts` → `households` and `sessions` → `orgs` foreign keys, and the household_id
/ user_id lookup indexes - fired that trigger. `migrations.ts` is now an ordered `MIGRATIONS` list with a
`runMigrations` runner and a `schema_migrations` ledger (version 1 = the hardened baseline); future schema
changes append a versioned migration rather than editing shipped DDL in place. Portable Postgres DDL still
runs identically on PGlite (dev/CI) and managed Postgres (prod). The app boundary keeps ISO strings on
both read and write - the driver serializes them and a `timestamptz` read-parser normalizes reads back to
canonical UTC ISO - so nothing above the store changed.

## Revisit When

A second real source (Salesforce, CSV import) signs on (build the second adapter + activate survivorship),
OR multi-tenant load outgrows a single Postgres instance (scale-ladder ADR-0015: connection pooling,
read replicas, or per-tenant sharding).
