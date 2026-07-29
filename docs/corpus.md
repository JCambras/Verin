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
  spec/cases.json            hand-owned  the 21 awkward structures + every case
  spec/defect-taxonomy.json  hand-owned  the closed defect vocabulary
  spec/real-derived-semantic-contract.json  hand-owned  signed replay rules
  spec/real-derived-case-schema.json    hand-owned  strict scrubbed-case envelope
  spec/real-derived-replay-schema.json  hand-owned  closed replay inputs
  spec/SIGNOFF.md            hand-owned  captain-only; agents never write it
  manifest.json              GENERATED   version, seed, digests, per-partition counts
  synthetic/CS-*.json        GENERATED   provenance: synthetic-fixture
  real-derived/              hand-delivered, manifest-inventoried intake - SHIPS EMPTY
```

Generated-file ownership is enforced by **regenerate-and-byte-compare** in the blocking `corpus` CI job,
not by a comment. `.gitattributes` marks the generated trees `linguist-generated` and pins them to LF;
each directory's README names its owning command. Inventory is recursive and exact: hidden, nested,
non-JSON, and unsupported filesystem entries cannot sit outside the comparison.

While the ADR-0034 deferral is active, any delivered entry under `real-derived/` fails validation. Once
the deferral is explicitly lifted, every case must be a top-level canonical `RD-<16 hex>.json` file with
a collection-unique case id and the active corpus version before it is inventoried in the generated
manifest, included in `corpusDigest`, and supplied to the provenance-specific reporter.

---

## 3. Determinism rules

| # | Rule |
|---|---|
| 1 | Bytes come from `canonicalJson` (`src/contracts/decision-core/serialization.ts`) plus exactly one trailing `\n`. |
| 2 | No `Math.random`, callable or argless `Date`, `crypto.randomUUID`, random-byte or random-integer APIs, `crypto.getRandomValues`, `performance.now`, or `process.hrtime` anywhere under `scripts/corpus/`, including imports, aliases, assignments, parameters, local returns, and dynamic imports. AST-fenced. |
| 3 | No wall clock. Every instant descends from `spec.clock.asOf` by an explicit offset. |
| 4 | No locale API and no `Intl` in generator code. Local time is derived from the chronologically latest qualifying pinned tz transition; duplicate transition instants are rejected. |
| 5 | No `Set`/`Map` iteration-order dependence: every collection is sorted by a named comparator before emission. |
| 6 | Money is integer minor units; percentages are basis points. No float reaches a fixture. |
| 7 | Timestamps are canonical UTC with exactly three fractional digits - the form `TimestampSchema` accepts. |
| 8 | Every emitted string equals its NFC form. |
| 9 | No sparse arrays, `undefined`, non-finite numbers, or class instances (`canonicalJson` refuses all four). |
| 10 | LF line endings, pinned by `.gitattributes`. |
| 11 | Ids are derived, never typed: `conflict:`, `res:`, `idem:`, `subject:`, `bank-instruction:`, `authority:`, `planned-withdrawal:`, `model-assignment:`, and `change:` all come from derivation functions. |

**Derivation is path-keyed**, `SHA-256(seed ‖ path ‖ field)` - not a stream PRNG. Adding a household
therefore changes **only that household's cases**, which the determinism fence asserts by inserting one
mid-spec and requiring exactly one changed file. The inserted household is keyed `smiths-west`, a
deliberate **prefix collision** with the existing `smiths`: every cross-record reference resolves by
exact structured parse (`legalHoldSubject`), never by substring, so a neighbouring key cannot leak into
a foreign subgraph. Rule 5 covers the same ground for input ORDER: a case's conflict scope is read off
its evidence *after* sorting, and every emitted set-like collection is independently sorted, so a
semantically neutral reorder in `cases.json` cannot move a conflict key, assumption, case byte, or
`corpusDigest`.

Seed: `verin-corpus/2026.07.0`. World clock: `2026-07-26T13:30:00.000Z`, `America/New_York`,
`iana-tzdb/2026b`.

Every evidence and request reference resolves to exactly one emitted record in its case subgraph. Every
evidence-producing collection is required even when empty, collection keys are unique, and relationship
fields such as restriction subjects are preserved. A cross-household destination is represented only by
opaque projected account and bank-instruction nodes plus the ownership edges required for replay. Foreign
balances, tax attributes, owner roster records, and unrelated household records are never imported by
that expansion. Missing, dangling, or multi-resolving references fail validation for defect cases and
controls alike.

Accounts and bank instructions retain `householdRef`. A non-primary household referenced by either appears
exactly once in `records.referencedHouseholds`, carrying only an opaque derived id and closed relationship
reasons. Pending-action kind is closed and maps to typed direction and liquidity class. Only live unresolved
outgoing distributions or debits reduce effective liquidity; blocked, cancelled, rejected, incoming,
credit, unknown, and unclassified actions do not, and incoming value cannot increase availability before
settlement.

Funding is never inferred from available accounts in either partition. Every synthetic request and
real-derived payload names an explicit, duplicate-free `selectedFundingRefs` set. Synthetic selections
resolve exactly once to the request household, and every pending action or pending model assignment used
by synthetic semantics names an account in that exact set. Every cited pending action is bound before
its reducing or nonreducing treatment is selected. Each real-derived selected account resolves
exactly once, belongs to the
request household, shares an owner with the request source account, carries a supported tax class, and
contributes to one aggregate sufficiency check over the request amount, required reserve, and any reducing
pending action. A pending action carries entity-kind-scoped household and account references, names a
selected account in the request household, and has exact action evidence. Tax risk is evaluated over
exactly the selected funding set, and any selected retirement source requires a completed tax review.

Synthetic identity context is emitted as typed unresolved UTF-8 bytes, canonical value, exact candidate
references, candidate raw bytes, and household bindings. Ambiguity requires at least two distinct
resolving candidates with the same derived canonical value. A canonical collision requires distinct raw
bytes that normalize to the same value. Assumption ids never prove either context.

Real-derived funding arithmetic converts only safe integer minor-unit inputs to `bigint` and performs
every aggregate without a `number` sum. Unsafe inputs are rejected at the schema and executable
boundaries.

---

## 4. The twenty-one awkward structures

Each structure exists to falsify a specific assumption, and is labeled with it in `spec/cases.json` so a
later engine failure names the structure that broke it. `AS-01`…`AS-21` cover: surname and trust-name
collision; one party in two households; a trust that both owns and inherits; an LLC signer emitted as a
separate resolvable party outside the LLC household membership edge; conflicting owner instructions on
one joint account; a shared bank instruction; duplicate
last-four destinations; a beneficiary contradicting a destination restriction; authority lapsing inside
the evidence interval; a pending rebalance during evaluation; a **segmented** withdrawal schedule; an
**absent** schedule; expired-and-future restrictions; a position-scoped legal hold; a **blocked** pending
action; change history straddling both DST transitions; a non-ASCII roster name; requests at the exact
thresholds; a deadline before the decision instant; liquidity available only in a retirement account;
and a record whose **last observation** is twelve weeks old while its business date says nothing about
when it was last checked.

Two completeness rules run in both directions, and both fail the build:

- Every assumption must be attacked by at least one case (the spec loader refuses an unexercised one).
- Every defect class in the closed taxonomy must be carried by at least one labeled defect case. An
  unexercised class inflates the taxonomy relative to what the corpus actually exercises - it is
  decoration for exactly the same reason.

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

**A clean control may not carry the defect being measured.** Controls are the false-positive
*denominator*, so one that quietly carries a defect signature makes the very rate it exists to produce
meaningless - a correct detector flagging it would read as a false positive. Synthetic controls are
checked against the mechanical signature of every taxonomy class over their emitted subgraph.

In both corpus partitions, an awkward fact or boundary is context, not a defect. Each supported class
records a typed expected treatment and observed treatment. A defect exists only when the relevant
context is present, the expected treatment matches the signed class rule, and the observed treatment is
that class's closed defective treatment. A defect label must be the exact singleton semantic mismatch,
and detector attribution for a defect must be either an empty miss or the exact signed-label singleton.
A clean control records expected treatment for every active class, including
effective cross-household authority, correctly treated owner-beneficiary context, segmented or missing
reserves, valid holds, exact thresholds, and time-zone boundaries. Missing, duplicate, unknown, or
context-free treatment assertions fail closed.

Instruction-conflict context is also request-bound. Its witness names the exact request and household,
each referenced instruction belongs to that household, and impacted subjects must intersect the
request's source account or destination instruction. Same-household opaque references that do not
connect to the governed request cannot substantiate either a label or a control.

---

## 6. Timestamp realism, given machine meaning

Three instants are kept apart, because collapsing them is itself a defect class (D-078):

| Field | Meaning | Drives |
|---|---|---|
| `recordChangedAt` | when the underlying FACT changed or was recorded | recent-change window membership |
| `observedAt` | when the evidence SOURCE observed the record | freshness |
| `retrievedAt` | when THIS evaluation retrieved it | the per-kind retrieval band |

Deriving `observedAt` from a business date makes every long-standing fact necessarily stale, which
plants `evidence-staleness-unnoticed` in any case citing it. Every record therefore carries its own
`observedAt` in the hand-owned spec, the way `balanceObservedAt` always did, and staleness is a
deliberate per-record property.

1. `observedAt` strictly precedes `retrievedAt`; nothing is observed after the trigger; and
   `recordChangedAt` never postdates the observation reporting it.
2. Retrieval follows the trigger, inside the committed per-kind latency band - the band is measured from
   `trigger.asOf`, not from `observedAt`.
3. A zero or out-of-band lag fails - the "every timestamp is the same second" tell.
4. **Freshness is recomputed**, never trusted: `(asOf - observedAt)` against the per-kind window.
5. Recent-change window membership is recomputed against the firm window from `recordChangedAt`.
6. "Two business days later" lands on a real weekday in `America/New_York`, and every local rendering
   comes from pinned tz transitions - checked against the **platform time-zone database** by the fence,
   so a hardcoded `-04:00` cannot survive.

Real-derived cases use the separate closed `verin-real-derived-freshness/1.0.0` policy. Each case records
`evaluation.asOf` and that policy version. Observed evidence must satisfy
`observedAt <= retrievedAt <= evaluation.asOf`, and its fresh/stale label is recomputed from the policy's
per-kind window. `unknown` requires `observationState: "missing"` and `observedAt: null`. Unknown policy
versions, unsupported kinds, impossible chronology, or inconsistent freshness fail before inventory.
The policy version and semantic digest are included in the signed corpus preimage.

Every material real-derived replay plane is backed by exactly one evidence tuple matching its closed
kind, entity-kind-scoped subject, opaque evidence-source reference, and permitted observation state.
Missing evidence can support only an explicit absence or unavailable payload of the same typed plane.
Every concrete amount, request value, identity value, timestamp, status, reference, and other material
value requires observed evidence. Request, identity, destination,
each liquidity source, reserve, authority, policy, instruction state, tax review, time-zone rule, and
execution preconditions are always supported. Pending actions, restrictions, legal holds, and
multi-subject recent changes are supported when present. Unrelated evidence is rejected.

---

## 7. Conflict-key families

`conflictKey(scope, family) = "conflict:<scope>-<family>"`, which reproduces the signed literal
`conflict:smiths-liquidity` exactly - so no signed fixture changes and no re-signoff is triggered.

Seven families: `liquidity`, `bank-instruction`, `account-registration`, `household-instruction`,
`regulatory-hold`, `party-authority`, `model-rebalance`.

`external-submission` is **deliberately excluded**: an external submission attempted twice is an
idempotency question, and giving it a conflict key would make a retry contend with itself.

**Reservation identity is the pair `(firmRef, conflictKey)`**, never the string alone. Every real-derived
case carries one opaque `firmRef`, and its request and every reservation must carry that same exact value.
Tenant scope is never inferred from household or display data. The demo runs one household under two
firms, so a string-keyed lookup could otherwise let Firm A's reservation block Firm B's request.
Reservations land at prompt 23; prompt 11 records and fences the requirement.
Firm references are excluded from generic replay subjects, evidence subjects, and impacted-subject
inventories, so those collections cannot introduce a second tenant scope.

**Idempotency stays separate.** Seven of the eight signed idempotency literals share the facts
`smiths-75000-2026-08-15`, so a facts-only key collapses seven distinct decisions onto one. The shipped
derivation keys on the DECISION: `idem:<caseId>:<scope>-<discriminator>`. The fence proves both halves against the live signed set.

---

## 8. Provenance split

- Synthetic partition's figure: **`syntheticDefectCoverage`**.
- Real-derived partition's figure: **`detectionRate`**. Different words, deliberately.
- **No aggregate exists** - no `overall` and no index signature. Structured numeric measurement is private
  to `scripts/corpus/report.ts`; shipped callers can import only its string renderer, so destructuring,
  bracket access, later assignment, parameter flow, return flow, and imported aliases cannot acquire both
  partition figures.
- Outcome inputs carry a required provenance literal. Supplying a real-derived outcome to synthetic
  measurement, or the reverse, fails at the measurement boundary.
- Each evaluated outcome carries a closed list of attributed defect-class ids. A defect case accepts
  only an empty miss or the exact signed-label singleton. Any attributed class on a clean control is a
  false positive. Null attribution is unevaluated; duplicate, unknown, extra, or contradictory
  attribution is rejected.
- With an empty real-derived partition, `detectionRate` is `null` with
  `reasonCode: "real-derived-corpus-absent"`, and the synthetic figure is never substituted.
- A partially evaluated partition reports both figures as `null` with
  `reasonCode: "detector-outcomes-incomplete"`. Missing outcomes are neither counted as detector failures
  nor omitted to produce a favorable subset.
- Counts and labels come from the manifest inventory. Reporting recomputes the inventory-bound digest,
  validates signoff itself, rejects duplicate, unknown, cross-partition, or relabeled outcomes, and
  interprets a partition only after every inventoried case has exactly one evaluated outcome.

See [`fixtures/corpus/real-derived/README.md`](../fixtures/corpus/real-derived/README.md) and
[`docs/corpus-scrub-procedure.md`](./corpus-scrub-procedure.md).

---

## 9. Signoff

Per **corpus version**, bound to `corpusDigest` (captain ruling, 2026-07-28). Two legal states:
`pending-captain` (all signature fields null) and `signed` (all populated, `signedDigest` equal to the
current `corpusDigest`, `signedBy: "captain"`, and a canonical millisecond-precision UTC `signedAt`).
**Regeneration that changes the digest invalidates the signature**
(`signed-but-regenerated` fails the build). Narrative wording outside the signed bytes never invalidates
one.

`corpusDigest` uses the versioned `verin-corpus/1.10.0` preimage. It covers each case's partition, id,
byte digest, label kind, and label id across both inventories, plus the versioned semantic digests of
defect-taxonomy definitions, the real-derived per-kind freshness policy, and both versioned real-derived
JSON Schemas. It also binds `verin-real-derived-semantics/1.5.0`: the strict declarative context,
selector-driven expected-treatment, defective-treatment, topology, and outcome registry for both
partitions,
its exact bytes, and exact digests for the executable cross-field authorities. Each schema binding covers
its identifier, exact bytes, and canonical semantic projection. Relabeling an inventory entry, changing
what a defect class means, changing a freshness window, changing either schema, or changing a replay
predicate or topology rule therefore invalidates prior captain signoff even when no case bytes change.

**Agents never sign.** No generated file contains a signature: the manifest holds a `signoffRef` pointer,
validation recursively rejects `signedBy`, `signedAt`, and `signedDigest` keys in actual generated
artifact values, and the generator can emit only into `synthetic/`.

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
(adversarial proofs PF-090 through PF-098 in [`docs/fences/proof-log.md`](./fences/proof-log.md)).
