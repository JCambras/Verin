# ADR-0051: The contracts and infrastructure ceilings absorb the scoped rebuild and counted provenance

**Status:** Accepted
**Date:** 2026-08-06
**Deciders:** Founding architect
**Amends:** ADR-0018, ADR-0048, and ADR-0050
**Relates to:** Charter non-negotiables #1, #3, #4, #10

## Context

Four ratified prompt-7 review corrections land together, and three of them add capability
rather than prose:

- the operator repair (`pnpm ledger:rebuild`) becomes tenant-scoped and preview-by-default,
  which needs a rollback path through the SAME replay transaction plus the post-condition
  that proves the rebuilt rows cover exactly what was replayed;
- `/api/ledger`'s two remaining bare counts (`total`, `decisionsTotal`) become
  `DisplayMetric`s, which needs a whole-chain provenance fold in `ledger-verification.ts`
  and a decision-total fold in `ledger-register.ts` - charter #3 does not permit a
  synthetic-derived figure to render unlabeled;
- the register badge stops hardcoding one fake class and derives the label from the
  provenance the producer stored, which adds the synthetic-source badge vocabulary beside
  the existing `DEV_BADGE_TEXT` taxonomy in `contracts/provenance.ts`.

The one purely subtractive correction - deduplicating the six-times-written decision-id
extractor into `contracts/decision-core/ledger.ts` - moves lines from infrastructure and
domain INTO contracts, so it relieves the layer that had room and charges the layer that
did not.

Infrastructure measured 7,691 after the dedup against ADR-0048's 7,750, and contracts
measured 6,025 against ADR-0040/0041's 6,050. Both ceilings then ran out. The two remedies
a ceiling without headroom leaves are the ones ADR-0048, ADR-0049, and ADR-0050 were each
written to close: pay in deleted prose, or pay in folded code. This amendment pays in the
ADR chain instead.

## Decision

- ADR-0018's contracts ceiling rises from 6,050 to **6,110**. Measured after the
  corrections: 6,064, leaving forty-six lines of bounded correction headroom.
- ADR-0018's infrastructure ceiling rises from 7,750 to **7,840**. Measured after the
  corrections: 7,788, leaving fifty-two lines.
- Domain (1,581/1,650) and presentation (928/6,000) are unchanged by this amendment and
  were re-measured, not assumed.
- `foldStoredProvenance` lands in `contracts/provenance.ts` rather than in the ledger
  subsystem. It is the "latest input `asOf`" rule that three call sites were each spelling
  out beside `deriveArtifactProvenance`; keeping it in the contract is what stops one
  surface's fold from drifting from another's, and it is a pure function over
  `RecordProvenance`, which is the layer that owns that type.
- `referencedDecisionId` lands in `contracts/decision-core/ledger.ts`, the module that
  defines the `LedgerEntry` union it reads. The promoted `decision_id` column, L3's drift
  check, projection keying, and the register fold now share one definition, so a future
  variant that names its decision differently cannot make them silently disagree.
- No per-file `max-file-size` pin is added. The largest files this correction touches are
  `ledger-store.ts` at 502/550 (pinned by ADR-0050) and `ledger-verification.ts` at
  426/500; neither is near its ceiling, so no file is grandfathered by this amendment.
- The ADR-0018 obligations are unchanged: ceilings ratchet DOWN to actual plus buffer at
  foundation close, a further raise is another amendment in this chain, and no correction
  is ever paid for by deleting documentation (ADR-0048) or by folding readable code onto
  fewer lines (ADR-0050).

## Alternatives Rejected

| Alternative | Why rejected |
|-------------|--------------|
| Compress the new doc comments to fit | The exact anti-pattern ADR-0048 exists to close; the rationale for a rollback preview and a whole-chain fold is what the next agent needs most. |
| Drop the rebuild post-condition to save lines | The verify-after half of the ratified scoped-rebuild contract; removing it to fit a ceiling makes the ceiling decide the safety property. |
| Leave `total`/`decisionsTotal` bare and record why | Charter #3 admits no "structural metadata" exemption for a figure derived from synthetic rows and rendered to a user. |
| Put `foldStoredProvenance` in the ledger subsystem to spare contracts | Charges placement to whichever ceiling has room, which is how a layer boundary erodes; it also trips the tenant-context fence as an exported callable in a SQL-bearing module. |
| Raise both ceilings far enough to stop amending | Unbounded headroom is the shrink-only budget's opposite failure - the ratchet stops measuring anything (rejected at ADR-0048, ADR-0049, and ADR-0050). |

## Trade-offs and Costs

- **Gained:** the scoped rebuild, the labeled counts, and the truthful badge land with their
  rationale intact, and both layers can absorb their next correction without buying it back
  in prose or formatting.
- **Sacrificed:** sixty lines of contracts ceiling and ninety of infrastructure, plus one
  more amendment to read in the ADR-0018 chain.

## Consequences

`line-budget.test.ts` carries contracts 6,110 and infrastructure 7,840, each recorded beside
the measurement it was decided against - a figure in that file is a MEASUREMENT, so the next
change to either layer re-measures rather than trusting this line.

## Revisit When

Foundation close ratchets both ceilings down to actual plus buffer, or a correction again
finds either layer's headroom exhausted.
