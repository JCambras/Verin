# ADR-0049: The per-file pin gets the same bounded headroom as the layer ceiling

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Founding architect
**Amends:** ADR-0018 and ADR-0048
**Amended by:** ADR-0050 (a second pin; the "only pinned entry" statement below no longer holds)
**Relates to:** Charter non-negotiables #1, #4, #10

## Context

ADR-0048 restored the explanatory comments an earlier correction had compressed out of
`src/infrastructure/store/migrations.ts`, and it fixed the exhausted-headroom failure at the
LAYER ratchet: infrastructure rose to 7,750 against a measured 7,706, leaving 44 lines of
bounded correction room. It then re-created the same failure one ratchet down. The first
pinned `max-file-size` entry gave that file 520 against a measured 510 - about ten lines.

ADR-0048 itself records why that figure is wrong: the file measured 507 lines before the
compression, so the PER-FILE ceiling was the binding constraint that bought the deletion. A
pin ten lines above measurement leaves the next correction touching this file the same two
remedies that produced the anti-pattern in the first place - another ADR amendment, or
deleting prose again. Applying the principle at one ratchet and not the other leaves the
failure mode intact on the very file whose prose was just restored.

## Decision

- The `max-file-size` pin for `src/infrastructure/store/migrations.ts` rises from 520 to
  **560**, against a measured 510 - fifty lines of bounded correction headroom, roughly four
  times the twelve lines of prose ADR-0048 restored. It is sized like the layer amendment:
  enough for the restoration plus a few near-term corrections, and small enough that the pin
  still measures something (the default ceiling is 500).
- It remains the only pinned entry. No other file is grandfathered above the default, so no
  other pin needs this correction.
- The ADR-0018 obligations are unchanged. The pinned map still ONLY SHRINKS as a code change;
  raising an entry stays an ADR amendment in this chain, and the ratchet drops to actual plus
  buffer at foundation close.
- The reasoning ADR-0048 gives for pinning rather than splitting still holds and is not
  re-litigated here: the ledger DDL is already extracted, and the next cut would separate a
  migration's DDL from the runner and preflight that prove the ledger is an exact prefix.

## Alternatives Rejected

| Alternative | Why rejected |
|-------------|--------------|
| Leave the pin at 520 | Ten lines is the same exhausted headroom ADR-0048 was written to end; the next correction on this file pays in prose or in another ADR. |
| Split `migrations.ts` to stay under the default | Rejected in ADR-0048 for reasons this ADR does not disturb: the natural seam is already extracted. |
| Raise the default ceiling for every file | Charges one file's justified pin to the whole codebase, which is what the pinned map exists to avoid. |
| Pin far above measurement so no amendment is ever needed | Unbounded headroom stops the ratchet from measuring anything - ADR-0048 rejected the same move at the layer. |

## Trade-offs and Costs

- **Gained:** the file whose prose was just restored can absorb its next correction without
  paying in documentation; the anti-pattern is closed at both ratchets, not one.
- **Sacrificed:** 40 lines of per-file ceiling, and one more amendment in the ADR-0018 chain.

## Consequences

`max-file-size.test.ts` carries 560 for `migrations.ts` and records the measurement this ADR
was decided against. ADR-0018's status line names this amendment and the pin now in force.
Layer ceilings are untouched: contracts 6,050, domain 1,650, infrastructure 7,750,
presentation 6,000.

## Revisit When

Foundation close ratchets the pins down, or a correction again finds this file's headroom
exhausted - at which point splitting the runner from the baseline schema is reconsidered on
its own merits rather than under ceiling pressure.
