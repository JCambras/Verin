# ADR-0040: Authority-lapse ledger events extend the v3 `LedgerEntry` union until prompt 7 lands it

**Status:** Accepted (deferral with trigger)
**Date:** 2026-07-28
**Deciders:** Founding architect (recording the captain's D-102 signature on GC-16), captain (D-102)
**Relates to:** D-102 (signed money truth, evidence completeness, canonical status planes); ADR-0023 (v3 adoption - deviations from v3 are recorded by ADR); ADR-0026 (the existing v3-deviation register); charter #1 (fence every invariant), #4 (detection is not verification)
**Informed by:** `docs/v3/verin-core-contracts.ts` §5 (the ratified `LedgerEntry` union), `docs/v3/verin-prompt-sequence-v3.md` (prompt 7 - the ledger)

## Context

D-102 signed GC-16 (`GC-16-specialist-review-expiration`) as product truth: a specialist-review
stage that lapses unactioned records `ApprovalStageEscalated` at its P1D escalation point and then
`ApprovalStageExpired` at the projected deadline. It deliberately does NOT invalidate a nonexistent
approval or derive a new decision from the lapse alone - both would misstate what happened.

The ratified, SHA-256-pinned `LedgerEntry` union in `docs/v3/verin-core-contracts.ts` has fourteen
members and carries neither event. Authority lapse is expressible in v3 only by reusing
`ApprovalInvalidated`, which asserts an approval existed and was voided - the exact falsehood the
signed case rejects. So the signed truth set and the ratified reference genuinely disagree, and the
charter is explicit that deviations from v3 are recorded by ADR, not by a code comment.

Before this ADR the golden-case validator simply listed sixteen accepted event types and told the
reader they "must be a v3 LedgerEntry type". That message, and `docs/golden-cases.md` §5 item 11,
asserted a conformance the artifacts no longer had.

## Decision

1. **The extension is named, not blended.** `scripts/golden-cases.lib.ts` splits the accepted
   vocabulary into `V3_LEDGER_ENTRY_TYPES` (the fourteen ratified members, transcribed) and
   `AUTHORITY_LAPSE_EVENT_TYPES` (`ApprovalStageEscalated`, `ApprovalStageExpired`).
   `LEDGER_EVENT_TYPES` is their composition, and the validator's rejection message names both
   halves so no artifact claims unqualified v3 conformance.
2. **The transcription is fenced against the pinned reference.** `validateLedgerVocabulary` parses
   the `LedgerEntry` union out of `docs/v3/verin-core-contracts.ts` and fails the build if the
   transcription drops a ratified member, invents one the reference does not declare, or if the
   reference itself moves/renames the union. The check is text-injectable, so the `golden-cases`
   fence companion proves each rejection (charter #4).
3. **The extension is self-collapsing.** The same fence fails if either authority-lapse event
   appears in the ratified union: at that moment the extension MUST be emptied into
   `V3_LEDGER_ENTRY_TYPES` rather than left shadowing the canonical member. The divergence therefore
   cannot outlive its cause.
4. **`docs/golden-cases.md` §5 item 11 states the extension** instead of claiming the v3 union alone.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Re-sign GC-16 onto `ApprovalInvalidated` | Records a false fact (an approval that never existed being voided) as examiner-facing product truth, and reverses a captain signature to spare an ADR. |
| Edit `docs/v3/verin-core-contracts.ts` to add both members | The v3 documents are ratified references pinned by the arch-version fence; the repo records deviations against them, it does not rewrite them ahead of the wave that implements them. |
| Leave it as a code comment plus the D-102 journal entry | The charter requires an ADR for v3 deviations, and a comment cannot carry the collapse trigger or be enforced - which is exactly how the "must be a v3 LedgerEntry type" message went stale. |
| Drop the two events from GC-16 until prompt 7 | Deletes signed truth to satisfy a vocabulary the wave has not landed yet; the truth set exists precisely to constrain the engine that comes later. |

## Trade-offs and Costs

- **Gained:** the signed authority-lapse sequence survives intact; the divergence is explicit,
  enforced, and cannot silently widen or silently persist; every artifact states exactly the
  conformance it has.
- **Sacrificed:** one transcription of the ratified union lives in `scripts/golden-cases.lib.ts` and
  must track the pinned reference - the cost is bounded by the fence that fails when it drifts.

## Consequences

- Prompt 7 adds `ApprovalStageEscalated` and `ApprovalStageExpired` to the canonical event union it
  lands; the `golden-cases` fence then fails until `AUTHORITY_LAPSE_EVENT_TYPES` is emptied and both
  members move into the transcribed v3 list. No follow-up ticket is needed - the build reports it.
- Any future extension of the signed ledger vocabulary follows this shape: name it, fence it against
  the ratified reference, and give it a collapse trigger.

## Revisit When

- Prompt 7 lands the ledger and the union carries either event (the fence will say so) - collapse the
  extension in that PR.
- A THIRD event is proposed for the extension: stop. Two named exceptions is a recorded deviation; a
  growing list means the ratified union is wrong and belongs in a v3 amendment, not in this ADR.
