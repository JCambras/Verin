# `fixtures/corpus/` - the replay corpus (v3 prompt 11, ADR-0034)

Two ownership planes live here and must never be confused.

| Path | Owner | Rule |
|---|---|---|
| `spec/world.json`, `spec/cases.json`, `spec/defect-taxonomy.json` | **hand-owned** | Reviewable input. Edit these, then regenerate. |
| `spec/SIGNOFF.md` | **hand-owned, captain-only** | Agents never write a signature. |
| `manifest.json`, `synthetic/*.json` | **generated** | `pnpm corpus:generate`. Never hand-edit: CI regenerates and byte-compares. |
| `real-derived/` | **captain-gated intake** | Ships empty. See its README. |

## Commands

```
pnpm corpus:generate   # spec + seed -> manifest.json + synthetic/**
pnpm corpus:validate   # regenerate, byte-compare, re-check every rule  (blocking CI job `corpus`)
pnpm corpus:report     # provenance-split measurement; refuses to blend
```

## Ownership is enforced, not requested

`pnpm corpus:validate` regenerates from the spec and compares bytes. A hand edit to any generated file
fails the build with the file name. The `.gitattributes` `linguist-generated` marking and this README are
signposts; the byte comparison is the mechanism.

## Determinism

Values are derived path-keyed - `SHA-256(seed ‖ path ‖ field)` - not from a stream PRNG, so **adding one
household changes only that household's cases**. The `corpus-determinism` fence proves this directly, along
with byte-identity across runs and time zones, seed sensitivity, and the ban on clocks, randomness, and
locale APIs inside `scripts/corpus/`.

## Honesty

Every case in `synthetic/` is **author-invented** and labeled `synthetic-fixture`. Nothing here is evidence
that a defect has occurred in production. The corpus and the sixteen signed golden cases are disjoint by
construction, and the golden cases are never counted in a corpus denominator - they were authored to be
caught, so scoring against them would be circular.

Normative spec: [`docs/corpus.md`](../../docs/corpus.md).
