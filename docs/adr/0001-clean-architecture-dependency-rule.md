# ADR-0001: Clean architecture with a fitness-enforced dependency rule

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #1, #5; operating model (dependency-rule)
**Informed by:** retro-r7 do-again #28; don't-again #9, #23, #35 (leaky boundary, audited by a persona but never gated; import-only checks evaded by relative and dynamic imports)

## Context

Meridian asserted its hexagonal boundary in prose and audited it with a persona; it leaked anyway
(routes imported Salesforce types directly, `Min_DrVale_Engineering_Audit.md` L65-66). Iris fitness-fenced
it and was still bypassed through the seams the fence did not cover: a domain `process.env` read that
"walked past" an import-only check, and a merge that reverted the uncovered invariants with CI green.
The lesson both builds re-learned: an invariant that isn't fitness-fenced — across *all* its seams —
will drift or silently revert.

## Decision

Four layers under `src/`, dependencies point inward only:

- `contracts/` — dependency-free types + pure functions. Imports nothing project-local.
- `domain/` — entities, use-cases, ports (interfaces), the workflow engine + flows. Imports only `contracts/`.
- `infrastructure/` — adapters / port implementations. Imports `domain/` + `contracts/`, never `app/`.
- `app/` — Next.js App Router + presentation tier. May import anything (so the presentation tier is architecture-safe).

Enforced three ways (defense in depth): ESLint `no-restricted-imports` at edit time
(`eslint.config.mjs`); the authoritative `dependency-rule` fitness fence (ts-morph, Phase B) that resolves
**static, relative, AND dynamic `import()`** and classifies each by resolved layer; and TS path aliases.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Convention + persona review (Meridian) | Proven to drift under deadline pressure; leaked with no automated stop. |
| Import-only fitness check (early Iris) | Evadable by relative and dynamic imports and by raw `process.env` — the exact seams that leaked. |
| A monorepo of physical packages per layer | Heavier tooling than a solo/agent build needs now; revisit at real service boundaries. |

## Trade-offs and Costs

- **Gained:** the boundary is witnessed by a green build; a leak fails CI with `file:line`.
- **Sacrificed:** some interface indirection; ports add ceremony vs. calling an adapter directly.

## Consequences

The `dependency-rule` fence (charter-map: dependency-rule) is authoritative; ESLint is fast feedback.
Cross-layer type leaks (CRM-native types above the port) are a separate fence (ADR-0004). This does NOT
split the repo into physical packages.

## Revisit When

Interface indirection produces measurable, repeated boilerplate pain, OR physical service boundaries are
needed for independent deploy/scale (then reconsider a package split — see the scale-ladder, ADR-0015).
