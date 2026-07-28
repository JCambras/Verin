# Replay-corpus signoff (v3 prompt 11)

**HAND-OWNED. No generator writes this file, and agents never sign it.**

Signoff is **per corpus version**, bound to the canonical `corpusDigest` recorded in
`fixtures/corpus/manifest.json` (captain ruling `corpus-signoff-and-measurement`, 2026-07-28;
ADR-0034). Two legal states exist and nothing in between:

| state | `signedBy` | `signedAt` | `signedDigest` |
|---|---|---|---|
| `pending-captain` | `null` | `null` | `null` |
| `signed` | captain attribution | ISO date | the exact `corpusDigest` signed |

**Regeneration that changes `corpusDigest` invalidates the signature.** `pnpm corpus:validate` fails with
`signed-but-regenerated` rather than carrying a stale attestation forward. Narrative wording outside the
signed corpus - this document's prose, `docs/corpus.md`, the ADR - does not invalidate a signature, because
the digest covers the generated case bytes only.

**What signing means here.** The captain signs the corpus version's **labels**: that each defect case's
`defectClassId` and each clean control's control status are correct product truth. The labels are the
denominator of every figure the corpus can ever report, so unsigned labels would make any measurement
agent-invented defects scored against agent-written detection.

**What signing does NOT mean.** It is not a claim that any labeled defect has occurred in production. Every
case in the synthetic partition is author-invented (`provenance: synthetic-fixture`). Real defect history
is the deferred real-derived partition - see `fixtures/corpus/real-derived/README.md` and
`docs/corpus-scrub-procedure.md`.

**Until this file says `signed`,** `pnpm corpus:report` emits every figure as `null` with
`reasonCode: "corpus-signoff-pending"`. That is intended: no number is better than an unsigned one.

```yaml
corpusVersion: "2026.07.0"
status: pending-captain
signedBy: null
signedAt: null
signedDigest: null
```
