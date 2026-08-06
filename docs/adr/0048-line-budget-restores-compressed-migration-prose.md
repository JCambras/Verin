# ADR-0048: The infrastructure ceiling absorbs restored migration prose

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Founding architect
**Amends:** ADR-0018 and ADR-0047
**Relates to:** Charter non-negotiables #1, #4, #10

## Context

ADR-0047 left infrastructure at 7,700 against a measured 7,652. Later prompt-7 review
corrections consumed that room down to 11 lines, and one of those corrections paid for
itself by compressing explanatory comments out of `src/infrastructure/store/migrations.ts` -
a file `CLAUDE.md` and `AGENTS.md` both send readers to for sharp-edge knowledge. The
deleted prose was exactly the knowledge those pointers promise: that `schema_migrations`
is bootstrapped with `CREATE TABLE IF NOT EXISTS` before any version runs, so
`runMigrations` can read it on a virgin store, and the rationale trail behind the
version-1 hardened baseline.

The line-budget fence's own header already names this failure mode: a ceiling that
cannot absorb a correction "just converts review findings into documentation
deletions." Paying a review finding with documentation is the anti-pattern, not the
remedy, and it recurred here because the headroom was gone rather than because anyone
decided the prose was expendable.

## Decision

- The compressed comments in `src/infrastructure/store/migrations.ts` are restored: the
  `schema_migrations` bootstrap note, the version-1 baseline rationale, and the
  `Migration` / `PreflightProbe` field documentation.
- ADR-0018's infrastructure ceiling rises from 7,700 to 7,800. The measured result after
  the restoration is 7,701 lines, leaving 99 lines of bounded correction headroom.
  Contracts measures 4,598/4,650, domain 1,584/1,600, and presentation 928/6,000; those
  three ceilings are unchanged.
- `src/infrastructure/store/migrations.ts` takes the first pinned entry in the
  `max-file-size` map, at 520 against a measured 510. This ADR is the architecture-review
  note that map requires. The same squeeze applied here: the file measured 507 lines
  before the compression, so the deleted prose was paying the per-file ceiling too. The
  ledger DDL already lives in `decision-ledger-migration.ts`; the remaining content is
  the baseline schema and the runner that applies it, and splitting those would separate
  a migration's DDL from the code that proves the ledger is an exact prefix of the list.
- Restoring documentation is never a valid reason to shrink other documentation. A
  correction that cannot fit inside a ceiling amends the ceiling here, in the ADR chain
  ADR-0018 owns, and never silently in `line-budget.test.ts`.

## Alternatives Rejected

| Alternative | Why rejected |
|-------------|--------------|
| Leave the prose compressed | `CLAUDE.md` and `AGENTS.md` point readers at a header that no longer says what they were sent to read. |
| Re-compress a different infrastructure file to fit 7,700 | Moves the deletion rather than reversing it, and the budget header names that as the anti-pattern. |
| Split `migrations.ts` instead of pinning it | The natural seam (the ledger DDL) is already extracted; the next cut separates a migration's DDL from its runner and preflight, which is worse than a bounded pin. |
| Raise the ceiling far enough to stop needing amendments | Unbounded headroom is the shrink-only budget's opposite failure: the ratchet stops measuring anything. |
| Exempt comments from the measurement | Comment-only exemption makes prose free and code scarce, which is a different distortion, not fewer. |

## Trade-offs and Costs

- **Gained:** the sharp-edge knowledge the agent-memory files promise stays where they
  point; the next infrastructure correction has room that does not have to be bought
  from documentation.
- **Sacrificed:** 100 lines of measured platform ceiling, and one more amendment in the
  ADR-0018 chain to read when reconstructing why a ceiling sits where it does.

## Consequences

`line-budget.test.ts` carries 7,800 for infrastructure and records the measurement this
ADR was decided against, and `max-file-size.test.ts` carries the pinned entry. ADR-0018's
status line names this amendment. Both ratchet obligations are unchanged: the pinned map
still only shrinks, and at foundation close the layer ceilings drop to actual plus buffer.

## Revisit When

Foundation close ratchets the platform ceilings down, or a correction again finds the
infrastructure headroom exhausted.
