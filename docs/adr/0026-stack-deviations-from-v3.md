# ADR-0026: Stack deviations from v3 §18 - Postgres, Next.js, ts-morph fences; FirmId ≡ org_id

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** captain (v3 ratification with marriage-map posture, 2026-07-26), founding architect
**Relates to:** ADR-0023 (v3 adoption - "implement inside the existing chartered machinery rather than v3's incidental stack prescriptions"); D-001 / ADR-0004 (PostgreSQL); ADR-0001 (dependency rule); ADR-0007 (hash-chained audit trail); charter #7 (org_id on every query); v3 §18 (stack), §16 (dependency rules), §15.2 (tenant isolation)
**Informed by:** `docs/v3/marriage-map.md` conflicts C1 (store), C2 (web stack), C3 (import tooling), C13 (tenant vocabulary)

## Context

v3 §18 prescribes a stack chosen for a greenfield repo: SQLite in WAL mode, Fastify API + React/Vite UI,
and dependency-cruiser or eslint-plugin-boundaries for import boundaries. This repo is not greenfield
(marriage-map C12): it ships PostgreSQL (PGlite dev/CI, managed Postgres prod) behind a store port with
append-only triggers and a hash-chained audit log; Next.js App Router with Server Actions, fenced and
e2e-proven; and ts-morph AST fitness fences that resolve static, relative, AND dynamic imports - proven
adversarially in the proof log. v3's stack lines are means; its binding requirements are the ends:
append-only ledger + immutable snapshots (§12), transport carries no domain logic (§16 `api/` rule),
import boundaries enforced in CI (§18), and tenant scoping on every persisted object (§15.2).

v3 also brands the tenant key `FirmId` throughout its contracts, while every table, fence, and audit
chain in this repo speaks `org_id` (C13).

## Decision

Deviate from v3 §18's incidental prescriptions where the existing chartered choice is strictly stronger;
record each deviation here so no future session "corrects" the repo toward v3's letter:

1. **PostgreSQL stays (reaffirms D-001; rejects SQLite WAL).** The append-only story v3 demands is
   IMPLEMENTED with Postgres mechanisms: BEFORE UPDATE/DELETE/TRUNCATE triggers that RAISE EXCEPTION on
   the audit log (`src/infrastructure/store/migrations.ts`), per-org hash chains verified in CI, RLS as
   the tenancy hardening path, PITR for RPO/RTO. SQLite WAL offers none of that without rebuilding it in
   application code. The v3 ledger tables (prompt 7) land on this substrate.
2. **Next.js App Router stays (rejects Fastify + React/Vite).** v3's real requirement is "`api/` -
   transport; no domain logic" and "`ui/` - no binding logic" (§16). That is already this repo's law:
   the four-layer dependency rule confines domain logic to `domain/`, and route handlers / Server
   Actions are thin app-layer transport - fenced by `dependency-rule.test.ts` and ESLint at edit time.
   Rebuilding the shipped, fenced, e2e-proven auth/session/presentation stack on Fastify+Vite would be
   a rewrite with zero requirement gained.
3. **ts-morph fitness fences stay (rejects dependency-cruiser / eslint-plugin-boundaries).** The
   existing fences satisfy v3 §18's intent ("import boundaries in CI") and exceed those tools: AST-based,
   dynamic-import-aware, adversarially proven (proof log), and extensible to v3's module rules
   (`decision/` never imports `llm/`, no module imports `config/`) as those modules land - each new rule
   fenced in the wave that creates its subject.
4. **FirmId ≡ org_id.** `org_id` stays the store-layer vocabulary: every table, the org-id-required
   fence, and the per-org audit chains are UNCHANGED - the substrate is not renamed. When the v3 domain
   contracts land (prompt 5), `FirmId` is the branded domain-contract spelling of the same identity, and
   the store adapter maps between them at the boundary. v3 invariant 2 ("every persisted record and
   repository operation is tenant-scoped") is therefore ALREADY enforced by the org-id-required fence,
   and `v3-invariants.json` records that fence as its live mechanism.

Everything else in v3 §18 stands as written and is either already true here (Zod 4 parse-at-boundary,
Vitest, forward-only versioned migrations per D-016/D-029, non-UTC test discipline) or lands with its
wave (canonical serialization package, property tests for precedence/idempotency/replay, OpenAI-compatible
LLM adapter, typed versioned configuration loaded at boot).

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Adopt SQLite WAL per v3's letter | Strictly weaker for the ledger story (no triggers/RLS/PITR without reimplementation); reverses a captain decision (D-001) that named exactly these reasons; migration churn with zero v3 requirement served. |
| Rebuild on Fastify + React/Vite | A multi-week rewrite of shipped, fenced, proven foundation to satisfy an incidental prescription whose real requirement (transport carries no domain logic) is already mechanically enforced. |
| Add dependency-cruiser alongside the fences | Duplicate enforcement drifts; the weaker tool would become the one people read. The fences are the authoritative mechanism (charter-map "dependency-rule"). |
| Rename org_id to firm_id across schema/fences | Touches every table, the audit chains (hashed rows include org_id), and adversarially-proven fences - enormous churn to move a name the domain layer can brand at the boundary for free. |

## Trade-offs and Costs

- **Gained:** zero rewrite churn; the strongest available mechanism behind each v3 requirement; a
  recorded answer future agents cite instead of re-litigating the stack every session.
- **Sacrificed:** permanent vocabulary bilingualism (FirmId in domain contracts, org_id in the store) -
  one mapping to maintain at the adapter boundary; the repo diverges from v3's letter, so every reader
  needs this ADR (hence the pointer in `docs/v3/README.md` and AGENTS.md).

## Consequences

- `v3-invariants.json` invariant 2 points at `src/__tests__/fitness/org-id-required.test.ts` as its live
  mechanism with the FirmId ≡ org_id note; invariant 4 (import boundaries match §16) activates per-wave
  as ts-morph fences, never as dependency-cruiser.
- Prompt 4's scaffold items for Fastify/SQLite/Vite/dep-cruiser are DROPPED from the re-baselined
  sequence (marriage-map §6); its live remainder (invariant runner, PR template, arch checksum) ships
  with ADR-0023's PR.
- The prompt-5 contracts landing must brand `FirmId` per `docs/v3/verin-core-contracts.ts` and map it to
  `org_id` in the store adapter; no schema rename.

## Revisit When

- Postgres blocks a v3 requirement in practice (e.g. canonical-serialization or replay needs a storage
  property PG cannot give) - reopen with measurements, per the scale-ladder ADR discipline.
- The transport layer starts accumulating domain logic despite the fences (fence findings recur) - the
  Next.js deviation gets re-examined rather than the fences weakened.
- A third tenant-key spelling appears anywhere (schema, contracts, or config) - stop: two is the
  recorded maximum; a third means this mapping failed and needs redesign.
