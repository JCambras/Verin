# DECISIONS.md — the decision journal

Per the charter's DECISION PROTOCOL: reversible decisions proceed without stopping but are logged here
(what, why, alternatives considered, revert path). Irreversible/architectural decisions stop and ask the
captain via a `needs-decision`; their answers are recorded here too. A decision that is neither logged
nor asked is a defect.

Format: `ID · date · [captain-decision | reversible] · decision`.

---

## Captain decisions (irreversible/architectural — asked via the read-back gate)

Source: `PLAN.md` read-back gate → captain review 2026-07-18 (recorded in the task's
`captain-decisions.md`). PLAN.md APPROVED.

### D-001 · 2026-07-18 · captain-decision · Production DB = PostgreSQL, behind the store port
**Why:** real per-tenant row-level security for `org_id` isolation, mature triggers for append-only
audit, PITR backup/restore for RPO/RTO, scales past pilot without a rewrite — the $1B/SOC2 bar.
**Alternatives:** libSQL/Turso (Iris-proven, simpler) — rejected; its own ADR-0004 defers "real RLS".
**Revert path:** the store hides behind `StorePort`; swapping engines is an adapter change, not a remodel.

### D-002 · 2026-07-18 · captain-decision · Auth = build real credential+session auth now, behind an identity port
**Why:** satisfies "real auth in the skeleton, no secret fallbacks" (charter #12) immediately; avoids an
external dependency for the foundation + falsification session; keeps a WorkOS/Auth0 swap a later adapter.
**Alternatives:** adopt WorkOS/Auth0 now — rejected (external dep + cost before needed).
**Revert path / un-defer trigger:** add a provider adapter behind `IdentityPort` when the first enterprise
customer requires SAML/SSO.

### D-003 · 2026-07-18 · captain-decision · Hosting = container-platform class (managed Postgres + queue)
**Why:** rule 16 needs a stateless app tier + queue-backed work with backpressure; rule 11/14 need
health/readiness + backup-restore + OTel. Final platform pick (Fly/Render/Cloud Run/ECS) waits for the
deploy gate. **Revert path:** deploy target is configuration; the app tier is stateless by design.

### D-004 · 2026-07-18 · captain-decision · Brand = keep "Verin."
Code name and wordmark stand until the captain names the real brand. **Revert path:** a wordmark string
+ a copy pass.

### D-005 · 2026-07-18 · captain-decision (scope directive) · Port the feel; DEFER the populated demo world
Captain annotation: *"I want the feel, but no fake data (yet)."*
- **Port the feel fully:** design tokens, fonts, "Verin." wordmark, micro-components, WhyBubble doctrine,
  presentation-tier budget.
- **DEFER** seeding the rich populated demo world (Meridian's named households/personas/computed-health
  719-line fixture). **Un-defer trigger:** the first demo milestone — the same milestone that un-defers the
  tour/narration/recorder engines. Planned in the demo-tier ADR ([[adr-0012]]) and catalogued in
  `PORT-LEDGER.md`.
- **Minimal, clearly-labeled functional seed IS required** for the walking skeleton, its Playwright specs,
  the house-CRM console, and the load-test gate. Every seeded row carries `source=verin-crm`, `asOf`, and
  visible provenance (charter #3). This supersedes any charter wording like "seeded with the populated
  world"; reconciliation recorded, not stopped.

---

## Reversible decisions (mine — logged, proceeding)

### D-006 · 2026-07-18 · reversible · PGlite as the concrete Postgres store adapter for dev/CI
Implements D-001. PGlite is real PostgreSQL (WASM), durable, supports PL/pgSQL append-only triggers
(verified) and `sha256` for hash-chaining. Production swaps to `node-postgres` behind the same
`StorePort`; SQL/DDL/triggers are portable Postgres. **Why:** hermetic, real-Postgres-semantics tests
with no Docker/service flakiness; keeps the store swappable. **Alternatives:** Docker Postgres service
(heavier, flakier locally); pg-mem (not real Postgres, no triggers) — rejected. **Revert:** implement the
`node-postgres` adapter; both live behind `StorePort`.

### D-007 · 2026-07-18 · reversible · Node built-in `crypto.scrypt` for password hashing
**Why:** zero native dependency (supply-chain minimal), memory-hard, standard. **Alternatives:** argon2id
via `@node-rs/argon2` (prebuilt) — a reasonable upgrade, deferred. **Revert:** swap the hashing function
behind the identity port's credential verifier.

### D-008 · 2026-07-18 · reversible · Toolchain pins — pnpm (corepack), ESLint 9.x, TypeScript 6.x
ESLint pinned to 9.39.5 because typescript-eslint 8 is incompatible with ESLint 10's scope-manager
(`scopeManager.addGlobals` crash). TypeScript pinned to 6.0.3 (not the new Go-based TS 7) for tooling
compatibility (matches the proven Iris stack; within typescript-eslint's peer range). **Revert:** bump
when the ecosystem catches up.

### D-009 · 2026-07-18 · reversible · Hash-chain audit ON TOP OF Postgres append-only triggers + outbox
Reconciles charter #13 (tamper-evident, hash-chained) with report do-again #34 (append-only triggers +
outbox). Both: DB-level UPDATE/DELETE forbidden AND an app-computed hash-chain re-verified by a scheduled
CI job. **Revert:** the chain columns are additive; triggers stand alone if the chain is dropped.

### D-010 · 2026-07-18 · reversible · Load-gate interpretation of "1,000 households × 2,000 accounts"
Read as 1,000 households and ~2,000 accounts total (≈2/household) for the CI pilot-scale gate. A fast
subset runs as the PR "load smoke"; the full pilot-scale p95 assertion runs scheduled/nightly. The
scale-ladder ADR documents 10×/100×. **Revert:** adjust the seed size + cadence (config).

### D-011 · 2026-07-18 · reversible · `geist` font package instead of `next/font/google`
**Why:** self-contained (no build-time Google Fonts fetch) → reproducible, network-free builds — the
enterprise/supply-chain posture. **Revert:** switch to `next/font/google` (one file).

### D-013 · 2026-07-18 · reversible · Dead-export gate treats `domain/schema` as vocabulary (like `contracts/`)
The canonical schema (`src/domain/schema/*`: entity types, data dictionary, SF mapping, survivorship) is
declarative shared vocabulary consumed flow-by-flow — the same character as `contracts/`, which the charter
explicitly exempts from the dead-export check. So `knip` treats it as an entry root. The gate still fully
covers all business logic and UI in `app/`, `infrastructure/`, and non-schema `domain/` (the real
built-but-not-shipped risk). **Why:** the entities are forward-referenced within the foundation (Phase E
store/flow/console consume them); flagging vocabulary as dead is a false positive. **Revert:** remove the
`src/domain/schema/**` entry from `knip.json` once every entity has a runtime consumer.

### D-012 · 2026-07-18 · reversible · SAST = semgrep; secret scan = gitleaks; both blocking
Charter #15 says "SAST (semgrep-class)" and "secret scanning (gitleaks-class)", "none advisory". Both are
hard CI gates (no `continue-on-error`), unlike Iris's advisory CodeQL. **Revert:** swap rulesets/tools.
