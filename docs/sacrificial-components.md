# Sacrificial components register

Per ADR-0020. A deliberately-temporary component becomes permanent by accident unless its deletion trigger
is written down. Each entry: **role**, **replacement/deletion trigger**, **guardrails**. Nothing here is
scaffolded empty — every entry is reachable and used now (charter #5), backed by the knip dead-export gate.

| Component | Role | Replacement / deletion trigger | Guardrails |
|-----------|------|-------------------------------|------------|
| **Simulated e-sign provider + webhook** (`src/infrastructure/esign/*`, Phase E) | Proves FlowStep suspend/resume + webhook finalize + idempotency without a real vendor | A real e-sign adapter (DocuSign/Dropbox Sign) is wired behind the e-sign port | Must not present itself as a real signature; HMAC-verified webhook; clearly labeled; never claims legal e-sign validity; the simulate-sign route REFUSES APP_ENV=production |
| **Minimal labeled seed** (`scripts/db-seed.ts`, Phase E) | Smallest labeled dataset the skeleton, its Playwright specs, the house-CRM console, and the load gate need | The first demo milestone (captain D-005 / ADR-0012) expands seed into the real populated world | Every row carries `source=verin-crm`, `asOf`, visible provenance (charter #3); never feeds a compliance decision; the seed REFUSES APP_ENV=production (publicly committed demo credential) |
| **PGlite dev/CI store adapter** (`src/infrastructure/store/db.ts`, Phase E) | Real Postgres (WASM), hermetic, durable — dev/CI store behind `StorePort` | Production swaps to managed Postgres via the `node-postgres` adapter (D-006) | Same SQL/DDL/triggers as prod Postgres; sacrificial in posture, durable in role |
| **Load-seed generator + p95 gate** (`scripts/load-smoke.ts`, Phase F) | Deterministic pilot-scale seed plus the p95 load gate: store-read, end-to-end flow-step, and concurrency-contention p95 vs the ADR-0014 budget | Superseded if a production-representative load harness replaces it | Seed is deterministic (no `Math.random`), labeled, isolated from real data; the flow-step/concurrency workload deliberately drives the real (randomUUID-keyed, timestamped) write path - the path the SLO measures |

When a trigger fires: delete the component **and prune its doc references in the same PR** (retro
don't-again #42 — the HubSpot stub left doc drift for two review cycles). Demo/seed affordances are also
guarded by the config fail-closed production guards (ADR-0003); a dedicated demo-mode fence lands with
the demo milestone (D-005).
