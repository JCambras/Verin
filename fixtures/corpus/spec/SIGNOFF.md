# Replay-corpus signoff (v3 prompt 11)

**HAND-OWNED. No generator writes this file, and agents never sign it.**

Signoff is **per corpus version**, bound to the canonical `corpusDigest` recorded in
`fixtures/corpus/manifest.json` (captain ruling `corpus-signoff-and-measurement`, 2026-07-28;
ADR-0052). Two legal states exist and nothing in between:

| state | `signedBy` | `signedAt` | `signedDigest` |
|---|---|---|---|
| `pending-captain` | `null` | `null` | `null` |
| `signed` | exactly `captain` | canonical `YYYY-MM-DDTHH:MM:SS.mmmZ` | the exact `corpusDigest` signed |

**Regeneration that changes `corpusDigest` invalidates the signature.** `pnpm corpus:validate` fails with
`signed-but-regenerated` rather than carrying a stale attestation forward. Narrative wording outside the
signed corpus - this document's prose, `docs/corpus.md`, the ADR - does not invalidate a signature. The
`verin-corpus/1.12.0` digest covers each inventory entry's partition, case id, bytes, label kind, and label
id. It also covers the versioned semantic digests of the defect taxonomy, the real-derived per-kind
freshness policy, and both real-derived JSON Schemas, including each schema's identifier, exact bytes, and
canonical semantic projection. It binds `verin-real-derived-semantics/1.13.0`, including the closed
context, expected-treatment, defective-treatment, topology, and outcome rules, plus the exact executable
authorities.

Those authorities are the corpus-owned semantic modules **plus** the shipped surfaces the replay result
actually depends on: the canonical serializer and the record predicate that decide the digest preimage
bytes, the recorded IANA time-zone registry and its reader that decide real-derived temporal treatment,
and the golden-case loader that decides disjointness. They are deliberately **not** the whole runtime
dependency closure: the general-purpose `Result`/`AppError` plumbing and the decision-record vocabulary
reached only through the serializer's unused projections are declared as excluded dependencies, because a
signature invalidated by an unrelated edit to shipped plumbing is one people re-sign without reading.
Nothing escapes by being excluded - the two declared lists together are held equal to the complete
closure, so a corpus module that starts depending on new shipped behaviour must be classified before it
can build; and any change anywhere that actually moves corpus output still fails the blocking
regenerate-and-byte-compare gate.

This YAML block is parsed fail-closed. Parser errors, warnings, tags, duplicate or unexpected keys,
aliases, unsupported shapes, missing keys, multiple blocks, and ambiguous values invalidate the signoff
record before its authority or digest is interpreted.

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
