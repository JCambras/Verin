# ADR-0016: Testing strategy — fences, unit, integration, E2E from flow #1, axe

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #1, #4, #8, #9
**Informed by:** retro-r7 meta-lesson #5, missing-prompt #3/#4/#6/#7; don't-again #17 (test theater), #39 (red-outside-UTC on main); gap-s4 §4 (Iris dropped E2E)

## Context

Both builds under-tested two dimensions: accessibility and real end-to-end behavior. Iris *regressed* from
a working Playwright suite to zero E2E, had test theater (high count, zero-coverage core), tautological
fences, and a suite red outside UTC on main. The charter fixes all of these.

## Decision

Five test tiers, all CI gates on a **non-UTC clock** (`vitest.config.ts`, CI `TZ=America/New_York`):

1. **Fitness fences** (`src/__tests__/fitness`) — architecture-as-tests; each invariant is a build-failing
   tripwire, proven adversarially (charter #1), each PASS-emitting check paired with a
   detection-is-not-verification companion (charter #4).
2. **Unit** — pure logic, hermetic.
3. **Integration** — real store (PGlite in-memory/file), real engine — never a mock that always succeeds.
   Critical-path tests exercise the real engine (charter #5).
4. **E2E (Playwright + axe)** — **from flow #1** (charter #8). Every flow merges with one happy-path and
   one failure/interruption browser spec, green on main, non-UTC.
5. **Accessibility** — axe on every shared shell primitive (charter #9), in the E2E gate (component-level
   jsdom axe tests are wired into the toolchain but not yet written).

No flow ships without its E2E spec in the same PR. Fences must be non-tautological (a weak fence is worse
than none) and AST-based where feasible.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Unit tests only (Iris HEAD) | Zero E2E — the exact regression; misses real request/lifecycle bugs. |
| Mock-heavy tests | Mock theater: a test passes because its mock always succeeds. |
| UTC-only CI | Trains everyone to ignore red (retro #39). |

## Trade-offs and Costs

- **Gained:** real behavior verified in a browser; a11y multiplied across the shell; fences that actually fail.
- **Sacrificed:** E2E is slower; browsers must be installed in CI; the non-UTC clock must be honored.

## Consequences

`src/__tests__/setup.ts` fails loudly if the clock is UTC. Fence proofs in `docs/fences/proof-log.md`.
Playwright + axe wired from commit #1 (Phase 0 smoke). Charter-map ids 8, 9.

## Revisit When

The team grows past a few engineers (add presubmit/postsubmit test tiers), or the suite exceeds a latency
budget (tiering), or the UI stabilizes enough for visual-regression testing.
