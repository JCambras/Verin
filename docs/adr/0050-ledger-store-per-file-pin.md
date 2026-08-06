# ADR-0050: The ledger's write chokepoint is pinned rather than compressed

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Founding architect
**Amends:** ADR-0018 and ADR-0049
**Relates to:** Charter non-negotiables #1, #4, #10

## Context

ADR-0048 ended the exhausted-headroom failure at the layer ratchet and ADR-0049 ended it at the
per-file pin for `src/infrastructure/store/migrations.ts`. ADR-0049 then recorded that "no other
file is grandfathered above the default, so no other pin needs this correction." That was true of
the pinned map and false of the ratchet it describes: the binding constraint had moved to the
DEFAULT ceiling, on `src/infrastructure/ledger/ledger-store.ts`.

That file measured exactly 500 - the default - at ADR-0049. The next review correction on it
(classifying the append prologue, D-122) had to buy its own lines back, and did so by folding a
six-line `insertEvidenceSnapshots(...)` call onto a single line, landing at 499. Without that
fold the correction would have measured 504 and failed the fence. Nothing about
that formatting was a judgement about readability; it was the ceiling being paid in code shape,
which is the same anti-pattern as paying it in prose. The file is the decision ledger's SOLE
write chokepoint and the module this branch has corrected most often, so the next finding here
faced the identical two remedies ADR-0048 was written to remove.

## Decision

- The folded call in `appendDecisionEvents` is restored to its multi-line form. Formatting is
  never a currency for ceilings.
- `src/infrastructure/ledger/ledger-store.ts` takes the second pinned `max-file-size` entry, at
  **550** against a measured 504 - forty-six lines of bounded correction room, sized like the
  `migrations.ts` pin (fifty over measurement, fifty over the 500 default) so the pin still
  measures something.
- Splitting is rejected on the file's own merits, not deferred by the ceiling: the seams a split
  would use are already extracted into siblings (`ledger-bindings.ts`, `ledger-sources.ts`,
  `ledger-projection-store.ts`, `ledger-verification.ts`). What remains is one append transaction
  - prepare, lock, preflight, savepoint, insert sources, append chain, classify - and cutting
  through it would separate the savepoint that guards the caller's transaction from the work it
  guards.
- Every other shipped file this branch touched was re-measured against its ceiling. The closest
  runner-up is `src/infrastructure/ledger/ledger-replay-loader.ts` at 493/500; it is outside the
  threshold this correction applies and takes no pin, and it is the next candidate if a
  correction lands there.
- The ADR-0018 obligations are unchanged: the pinned map still ONLY SHRINKS as a code change,
  raising an entry stays an amendment in this chain, and both pins drop to actual plus buffer at
  foundation close.

## Alternatives Rejected

| Alternative | Why rejected |
|-------------|--------------|
| Leave the file at 499 under the default | One line of headroom is the exhausted-headroom failure ADR-0048/0047 exist to close, on the file this subsystem corrects most. |
| Keep the folded call and skip the pin | Ratifies formatting as the way a ceiling gets paid, which is the anti-pattern in a cheaper disguise. |
| Split `ledger-store.ts` now | A split under ceiling pressure cuts an arbitrary seam; the real seams are already siblings, and the remainder is one transaction. |
| Raise the DEFAULT ceiling to 550 | Charges one file's justified pin to every shipped file, which is exactly what the pinned map exists to avoid. |
| Pin far above measurement | Unbounded headroom stops the ratchet measuring anything - rejected at the layer in ADR-0048 and at the first pin in ADR-0049. |

## Trade-offs and Costs

- **Gained:** the ledger's write chokepoint can absorb its next correction without paying in
  formatting or prose, and the anti-pattern is now closed at the layer ceiling, the pinned map,
  and the default.
- **Sacrificed:** fifty lines of per-file ceiling on one file, a second entry in a map whose
  value is that it stays small, and one more amendment to read in the ADR-0018 chain.

## Consequences

`max-file-size.test.ts` carries 550 for `ledger-store.ts` alongside 560 for `migrations.ts`, each
with the measurement it was decided against. ADR-0018's status line names this amendment and both
pins. Layer ceilings are untouched; the restored formatting returns infrastructure to a measured
7,706 against 7,800.

## Revisit When

Foundation close ratchets the pins down, or a correction again finds this file's headroom
exhausted - at which point splitting the append transaction is reconsidered on its own merits
rather than under ceiling pressure.
