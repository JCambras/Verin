# Sacrificial components register

Per ADR-0020. A deliberately-temporary component becomes permanent by accident unless its deletion trigger
is written down. Each entry: **role**, **replacement/deletion trigger**, **guardrails**. Nothing here is
scaffolded empty — every entry is reachable and used now (charter #5), backed by the knip dead-export gate.

| Component | Role | Replacement / deletion trigger | Guardrails |
|-----------|------|-------------------------------|------------|
| **Simulated e-sign provider + webhook** (`src/infrastructure/esign/*`, Phase E) | Proves FlowStep suspend/resume + webhook finalize + idempotency without a real vendor | A real e-sign adapter (DocuSign/Dropbox Sign) is wired behind the e-sign port | Must not present itself as a real signature; HMAC-verified webhook; clearly labeled; never claims legal e-sign validity |
| **Minimal labeled seed** (`scripts/db-seed.ts`, Phase E) | Smallest labeled dataset the skeleton, its Playwright specs, the house-CRM console, and the load gate need | The first demo milestone (captain D-005 / ADR-0012) expands seed into the real populated world | Every row carries `source=verin-crm`, `asOf`, visible provenance (charter #3); never feeds a compliance decision |
| **PGlite dev/CI store adapter** (`src/infrastructure/store/pglite-*`, Phase E) | Real Postgres (WASM), hermetic, durable — dev/CI store behind `StorePort` | Production swaps to managed Postgres via the `node-postgres` adapter (D-006) | Same SQL/DDL/triggers as prod Postgres; sacrificial in posture, durable in role |
| **Load-seed generator** (`scripts/load-smoke.ts`, Phase F) | Deterministic pilot-scale dataset for the p95 load gate | Superseded if a production-representative load harness replaces it | Deterministic (no `Math.random`), labeled, isolated from real data |

When a trigger fires: delete the component **and prune its doc references in the same PR** (retro
don't-again #42 — the HubSpot stub left doc drift for two review cycles). Demo/seed affordances are also
guarded by the demo-mode-prod-isolation fence (Phase E) so they cannot run in production.
