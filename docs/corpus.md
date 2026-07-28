# Verin - Replay-Corpus Specification (v3 build-sequence prompt 11)

**Normative.** This document and [`ADR-0034`](./adr/0034-synthetic-corpus-and-provenance-split.md) govern
the replay corpus. Where this document and a generated artifact disagree, the artifact is wrong: run
`pnpm corpus:validate`.

**Status: no figure is reported.** The corpus is unsigned, no detector exists yet, and the real-derived
partition is empty. `pnpm corpus:report` emits every rate as `null` with a reason code. That is the
intended output, not a gap to paper over.

---

## 1. What the corpus is, and what it is not

| | **Signed golden cases** (16) | **Replay corpus** (this document) |
|---|---|---|
| Question | "What is the correct outcome here?" | "Does Verin catch this defect before execution?" |
| Ground truth | Captain-signed expected outcome | Labeled defect class, or labeled clean control |
| Owner | Hand-authored, immutable | Generator-owned, regenerated, digest-pinned |
| Location | `fixtures/golden/*.json` | `fixtures/corpus/**` |
| Counted in a detection denominator? | **Never** | Yes, once signed and evaluated |

**The golden sixteen are never counted in a corpus denominator.** They were authored to be caught;
scoring against them is the circularity architecture v3 §2.4 warns about. The two sets are disjoint by
construction (`CS-` vs `GC-` ids) and the `corpus-provenance-split` fence asserts it.

---

## 2. Layout and ownership

```
fixtures/corpus/
  spec/world.json            hand-owned  world clock, roster, households, accounts, instructions
  spec/cases.json            hand-owned  the 20 awkward structures + every case
  spec/defect-taxonomy.json  hand-owned  the closed defect vocabulary
  spec/SIGNOFF.md            hand-owned  captain-only; agents never write it
  manifest.json              GENERATED   version, seed, digests, per-partition counts
  synthetic/CS-*.json        GENERATED   provenance: synthetic-fixture
  real-derived/              captain-gated intake - SHIPS EMPTY
```

Generated-file ownership is enforced by **regenerate-and-byte-compare** in the blocking `corpus` CI job,
not by a comment. `.gitattributes` marks the generated trees `linguist-generated` and pins them to LF;
each directory's README names its owning command.

---

## 3. Determinism rules

| # | Rule |
|---|---|
| 1 | Bytes come from `canonicalJson` (`src/contracts/decision-core/serialization.ts`) plus exactly one trailing `\n`. |
| 2 | No `Math.random`, `Date.now`, argless `new Date()`, `crypto.randomUUID`, `performance.now`, `process.hrtime` anywhere under `scripts/corpus/`. AST-fenced. |
| 3 | No wall clock. Every instant descends from `spec.clock.asOf` by an explicit offset. |
| 4 | No locale API and no `Intl` in generator code. Local time is derived from pinned tz transitions. |
| 5 | No `Set`/`Map` iteration-order dependence: every collection is sorted by a named comparator before emission. |
| 6 | Money is integer minor units; percentages are basis points. No float reaches a fixture. |
| 7 | Timestamps are canonical UTC with exactly three fractional digits - the form `TimestampSchema` accepts. |
| 8 | Every emitted string equals its NFC form. |
| 9 | No sparse arrays, `undefined`, non-finite numbers, or class instances (`canonicalJson` refuses all four). |
| 10 | LF line endings, pinned by `.gitattributes`. |
| 11 | Ids are derived, never typed: `conflict:`, `res:`, `idem:`, `subject:`, `bank-instruction:` all come from derivation functions. |

**Derivation is path-keyed**, `SHA-256(seed ‖ path ‖ field)` - not a stream PRNG. Adding a household
therefore changes **only that household's cases**, which the determinism fence asserts by inserting one
mid-spec and requiring exactly one changed file.

Seed: `verin-corpus/2026.07.0`. World clock: `2026-07-26T13:30:00.000Z`, `America/New_York`,
`iana-tzdb/2026b`.

---

## 4. The twenty awkward structures

Each structure exists to falsify a specific assumption, and is labeled with it in `spec/cases.json` so a
later engine failure names the structure that broke it. `AS-01`…`AS-20` cover: surname and trust-name
collision; one party in two households; a trust that both owns and inherits; an LLC signer outside the
household; conflicting owner instructions on one joint account; a shared bank instruction; duplicate
last-four destinations; a beneficiary contradicting a destination restriction; authority lapsing inside
the evidence interval; a pending rebalance during evaluation; a **segmented** withdrawal schedule; an
**absent** schedule; expired-and-future restrictions; a position-scoped legal hold; a **blocked** pending
action; observations straddling both DST transitions; a non-ASCII roster name; requests at the exact
thresholds; a deadline before the decision instant; and liquidity available only in a retirement account.

Every assumption must be attacked by at least one case - an unexercised structure is decoration, and the
spec loader refuses it.

---

## 5. Labels, and why clean controls are mandatory

A case carries exactly one label:

- `{"kind": "defect", "defectClassId": <closed taxonomy id>}`, or
- `{"kind": "clean-control", "controlRationale": <why no defect is present>}`.

Every defect class cites a requirement or signed case **in this repository**, and the cited file's
existence is validated - a class cannot cite a document that was renamed or never written. **No class
claims a defect has been observed in production.**

**Labeled clean controls are mandatory** (captain ruling, 2026-07-28). A coverage figure without a
false-positive rate is not a measurement: a detector that blocks everything would score perfectly. A
corpus with no clean controls fails validation, and coverage computed without controls is reported
`interpretable: false`.

---

## 6. Timestamp realism, given machine meaning

1. `observedAt` strictly precedes `retrievedAt`; nothing is observed after the trigger.
2. Retrieval follows the trigger, inside the committed per-kind latency band.
3. A zero or out-of-band lag fails - the "every timestamp is the same second" tell.
4. **Freshness is recomputed**, never trusted: `(asOf - observedAt)` against the per-kind window.
5. Recent-change window membership is recomputed against the firm window.
6. "Two business days later" lands on a real weekday in `America/New_York`, and local renderings come
   from pinned tz transitions - checked against the **platform time-zone database** by the fence, so a
   hardcoded `-04:00` cannot survive.

---

## 7. Conflict-key families

`conflictKey(scope, family) = "conflict:<scope>-<family>"`, which reproduces the signed literal
`conflict:smiths-liquidity` exactly - so no signed fixture changes and no re-signoff is triggered.

Seven families: `liquidity`, `bank-instruction`, `account-registration`, `household-instruction`,
`regulatory-hold`, `party-authority`, `model-rebalance`.

`external-submission` is **deliberately excluded**: an external submission attempted twice is an
idempotency question, and giving it a conflict key would make a retry contend with itself.

**Reservation identity is the pair `(firmId, conflictKey)`**, never the string alone. The signed literal
carries no firm, and the demo runs one household under two firms - a string-keyed lookup would let Firm
A's reservation block Firm B's request. Reservations land at prompt 23; prompt 11 records and fences the
requirement.

**Idempotency stays separate.** Seven of the eight signed idempotency literals share the facts
`smiths-75000-2026-08-15`, so a facts-only key collapses seven distinct decisions onto one. The shipped
derivation keys on the DECISION: `idem:<caseId>:<scope>-<discriminator>`. The fence proves both halves against the live signed set.

---

## 8. Provenance split

- Synthetic partition's figure: **`syntheticDefectCoverage`**.
- Real-derived partition's figure: **`detectionRate`**. Different words, deliberately.
- **No aggregate exists** - no `overall`, no index signature, and an AST rule fails the build on any
  expression combining the two partitions arithmetically.
- With an empty real-derived partition, `detectionRate` is `null` with
  `reasonCode: "real-derived-corpus-absent"`, and the synthetic figure is never substituted.

See [`fixtures/corpus/real-derived/README.md`](../fixtures/corpus/real-derived/README.md) and
[`docs/corpus-scrub-procedure.md`](./corpus-scrub-procedure.md).

---

## 9. Signoff

Per **corpus version**, bound to `corpusDigest` (captain ruling, 2026-07-28). Two legal states:
`pending-captain` (all signature fields null) and `signed` (all populated, `signedDigest` equal to the
current `corpusDigest`). **Regeneration that changes the digest invalidates the signature**
(`signed-but-regenerated` fails the build). Narrative wording outside the signed bytes never invalidates
one.

**Agents never sign.** No generated file contains a signature: the manifest holds a `signoffRef` pointer,
a fence proves no corpus code path originates a `signedBy`/`signedAt`/`signedDigest` literal, and the
generator can emit only into `synthetic/`.

---

## 10. What this corpus does NOT claim

- **Not Gate B.** Gate B also requires prompt 10's money-movement and account-opening configuration.
- **No v3 invariant is activated by prompt 11.**
- **No detection rate**, and no figure of any kind until the corpus is signed and a detector exists.
- **Not "the labeled replay corpus"** of demo contract §7 - it is the synthetic half of it.

---

## 11. Commands

```
pnpm corpus:generate   # spec + seed -> manifest.json + synthetic/**
pnpm corpus:validate   # regenerate, byte-compare, re-check every rule (CI job `corpus`)
pnpm corpus:report     # provenance-split measurement; refuses to blend
```

Fences: `corpus-determinism`, `corpus-provenance-split`, `corpus-timestamps`, `conflict-key-families`
(adversarial proofs PF-090…PF-093 in [`docs/fences/proof-log.md`](./fences/proof-log.md)).
