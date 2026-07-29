# ADR-0034: The replay corpus is a deterministic synthetic substrate with a fenced provenance split, an honestly empty real-derived partition, and digest-bound per-version signoff

**Status:** Accepted
**Date:** 2026-07-28
**Deciders:** Founding architect, executing captain rulings `corpus-real-derived-provenance` and
`corpus-signoff-and-measurement` (both 2026-07-28)
**Relates to:** Charter non-negotiables #1, #2, #3, #4, #5; ADR-0018 (line budgets), ADR-0024
(the deferral precedent this ADR mirrors), ADR-0029 (canonical serializer reused here), D-034 (demo
contract as data), D-035 (golden-case truth set)
**Informed by:** `docs/v3/verin-architecture-v3.md` §2.4, `docs/demo-contract.md` §7,
`docs/v3/verin-prompt-sequence-v3.md` (prompt 11)

## Context

Prompt 11 exists to produce the labeled defect corpus behind the demo's headline measured claim.
Three facts constrain it, and each has been quietly ignored in prior builds:

1. **A synthetic-only rate is circular.** Architecture §2.4 requires the metric to be split by
   provenance and never blended; demo contract §7 adds that a rate measured on author-invented
   defects is *synthetic-defect coverage*, not detection. `config/demo/scenarios.yaml` records
   `replay-corpus` with `reality_at_phase1: real-derived-fixture`. **There is no scrubbed real defect
   history in this repository**, no owner, and no delivery date.
2. **A corpus that is not byte-stable is not replay input.** The corpus feeds later replay and
   regression work. A generator whose output churns when the spec is reordered makes every downstream
   digest meaningless.
3. **The line budget has no room in any platform layer.** `contracts` measures close to its ceiling
   and two in-flight branches already exceed it. A corpus generator does not belong in `src/`.

## Decision

### 1. Two artifacts, never conflated

The sixteen captain-signed golden cases (`fixtures/golden/`) answer *"what is the correct outcome?"*.
The replay corpus (`fixtures/corpus/`) answers *"does Verin catch this defect before execution?"*.
They are **disjoint by construction** and the `corpus-provenance-split` fence asserts it. **The golden
sixteen are never counted in a corpus denominator** - they were authored to be caught, so scoring
against them is exactly the circularity §2.4 warns about.

### 2. Generation is build-time tooling, path-keyed and deterministic

The generator lives in `scripts/corpus/`, beside `golden-cases.lib.ts`, `v3-invariants.ts` and
`load-smoke.ts`. **Prompt 11 adds zero lines to `contracts`, `domain`, `infrastructure` or
`presentation`**; a corpus type enters `src/` only when a runtime surface consumes it (charter #5).
That move is honest only because it is measured: this PR adds the `tooling` bucket to the line-budget
fence and extends the per-file ceiling to walk `scripts/**` (see ADR-0018 amendment below).

Derivation is **path-keyed**, `SHA-256(seed ‖ path ‖ field)`, not a stream PRNG. A stream makes the
corpus order-fragile: inserting one household reshuffles every subsequent value. Path-keying makes
each value a pure function of its own address, so **adding a household changes exactly that
household's bytes** - fenced directly, along with byte identity across runs and time zones, seed
sensitivity, and an AST ban on clocks, randomness, locale APIs and environment reads inside
`scripts/corpus/`. The ban resolves direct calls, named imports, aliases, and destructured globals.

Bytes come from the landed `canonicalJson` (ADR-0029) plus one trailing newline. Money is integer
minor units; percentages are basis points; every string is NFC-normalized; every collection is
explicitly sorted; local time is rendered from **time-zone transition instants carried in the spec**
and checked against the platform tz database by the fence as an independent oracle - never from a
hardcoded offset and never from `Intl` inside the generator. The active offset is selected from the
chronologically latest qualifying transition, independent of input order, and duplicate instants fail.

Order-independence and reference resolution are part of the same property (D-080). Every cross-record
reference resolves by **structured parse against exact identifiers**, never by substring - a household
keyed `smiths-west` must not leak a legal hold into `smiths`, and the determinism fence's inserted
household is keyed for exactly that collision. Anything read positionally out of the hand-owned spec is
sorted first, so a semantically neutral reorder in `cases.json` cannot move a conflict key or a digest.

Every evidence and request reference resolves to exactly one emitted record in its own case subgraph.
Every evidence-producing collection is present, keyed collections reject duplicates, planned withdrawals
and model assignments carry distinct prefixed derived ids, recent changes are emitted, restriction
subjects are preserved, and an explicitly named cross-household destination is represented by minimal
opaque projected account and bank-instruction nodes rather than filtered away. Accounts and bank
instructions preserve their `householdRef`; each non-primary referenced household appears exactly once as
an opaque id with closed relationship reasons. Every household edge resolves without importing foreign
balances, tax attributes, owner roster records, or unrelated household records through that expansion.

Pending-action direction and liquidity class come from a closed kind registry. Only live unresolved
outgoing distributions or debits reduce effective liquidity. Blocked, cancelled, rejected, incoming,
credit, unknown, and unclassified actions do not. Incoming value is excluded until settlement and can
increase availability only once settled.

### 2b. Evidence carries three instants, not one (D-078)

`recordChangedAt` is when the underlying FACT changed or was recorded; `observedAt` is when the evidence
SOURCE observed the record; `retrievedAt` is when this evaluation retrieved it. They drive three
different rules - the recent-change window, freshness, and the per-kind retrieval band (measured from
`trigger.asOf`) - and **deriving one from another is itself a defect class**. An earlier revision
inferred `observedAt` from a business date, which makes every long-standing fact necessarily stale and
planted `evidence-staleness-unnoticed` in four of the five labeled clean controls: the false-positive
denominator carried the defect it exists to measure. Every record therefore carries its own `observedAt`
in the hand-owned spec, the way `balanceObservedAt` always did, and staleness is a deliberate per-record
property.

### 3. The provenance split is structural, not editorial

- **No aggregate type exists.** There is no `overall`, no index signature, and no accessor that reduces
  across provenance classes. Structured numeric reports are private to `scripts/corpus/report.ts`; shipped
  callers can import only its string-rendering boundary. This removes destructuring, bracket access,
  assignment, parameter, return-flow, and imported-alias laundering from the reachable product API.
- **Measurement inputs are provenance-specific.** Every outcome carries a required partition literal,
  and the measurement boundary rejects an outcome supplied to the wrong partition.
- **Attribution is defect-specific.** An evaluated outcome carries a closed list of attributed
  defect-class ids. Coverage credits a defect case only for its exact signed class; any class on a clean
  control is a false positive. Null attribution is incomplete, while duplicate, unknown, or contradictory
  attribution is invalid.
- **The labels are different words.** `syntheticDefectCoverage` for the synthetic partition;
  `detectionRate` may name only the real-derived one. Enforced by structural key identity.
- **Honest empty.** With `realDerived.total === 0` the reporter emits `detectionRate: null` with
  `reasonCode: "real-derived-corpus-absent"` and refuses to substitute the synthetic figure. The
  companion populates the partition and a number appears, so the `null` is a real branch, not a stub.
- **No favorable subsets.** If any required detector outcome is missing, both figures for that partition
  are withheld with `reasonCode: "detector-outcomes-incomplete"`. Counts and labels come from the manifest
  inventory, not detector outcomes. Reporting recomputes the inventory-bound `corpusDigest`, validates
  signoff internally, rejects duplicate, unknown, cross-partition, or relabeled outcomes, and requires
  exactly one evaluated outcome per inventoried case before interpreting a figure.

### 4. The real-derived partition ships EMPTY, with its intake pipeline (captain ruling)

Population is **formally deferred** pending an authorized scrubbed source, an accountable owner for
extraction and de-identification, and an agreed delivery date and review path. This is recorded
through the same mechanism as the Salesforce deferral (ADR-0024 + a `deferral` record in the scenario
matrix): `config/demo/scenarios.yaml` now carries a `corpus_deferral` section with the un-defer
trigger, cross-checked against `fixtures/corpus/manifest.json` by the fence.

Until the partition is populated and reviewed: **Phase 1 is not complete, no investor-facing
detection-rate claim is permitted, and synthetic coverage stays labeled synthetic.**

The deferral is fail-closed: any delivered filesystem entry fails validation while it remains active,
including hidden, nested, non-JSON, and unsupported entries. Generated-tree ownership uses the same
recursive inventory, so no nested or hidden file can evade regenerate-and-compare. After the deferral is
explicitly lifted, files must be top-level canonical `RD-<token>.json` names, case ids must be unique
across the collection, and every case must name the active corpus version before it can enter inventory.
The intake validates that canonical filename before it can appear in a diagnostic; an invalid delivery is
identified only by its bounded ordinal. The active collection must include at least one valid labeled
defect and at least one valid clean control. Each valid real-derived case is then inventoried in the
generated manifest, bound into `corpusDigest`, and fed to the real-derived reporting path.

What ships now is the *pipeline*: a required `scrubAttestation` (source-system class, opaque identities
for extractor, scrubber, and reviewer, chronological occurrence/extraction/scrub/review instants, records
before and after, method, with review by a second party) plus strict hand-owned JSON Schemas for the case
envelope and `verin-real-derived-replay/1.5.0` payload. That payload contains only typed destination,
ownership, liquidity, direction, authority, threshold, policy, tax-review, instruction-conflict,
temporal, evidence, reservation, execution, and expected-versus-observed treatment inputs needed by
supported defect classes. Pending actions carry account and household references bound to the request,
selected funding, and exact evidence. Threshold policy identity carries its strict or inclusive
comparator. Absent, extra, ambiguous, incompatible, or unversioned inputs fail. Raw names,
account numbers, unrelated balances, and unrelated household data have no field in the contract.

Every hand-owned corpus JSON document passes one unique-key parser before semantic parsing or hashing.
Delivery bytes must also equal canonical JSON plus one newline. Diagnostics expose only bounded safe
paths and redacted descriptions, never rejected prose or unrecognized key text. The contract runs over
the empty partition in the blocking `corpus` CI job, and its companions drive it with unattested,
free-text-bearing, self-reviewed, duplicate-key, structurally incomplete, and mislabeled cases. This is
what makes a shipped-but-unpopulated capability charter-#5-legal.

Derived ids accept only opaque token components and closed suffix vocabularies. A name or other prose
cannot hide inside an id-shaped string.

The closed `verin-real-derived-semantics/1.5.0` registry separates awkward context from outcome in both
corpus partitions. A defect case is accepted only when its label is the exact singleton context-bound
treatment mismatch. Detector attribution for a defect is either an empty miss or the exact signed-label
singleton. A clean control records the
expected treatment for every active class, so effective cross-household authority, correctly treated
owner-beneficiary context, segmented or missing reserves, valid holds, exact thresholds, and time-zone
boundaries remain clean when treated correctly. Missing, duplicate, unknown, contradictory, or
context-free outcome assertions fail. Reserve state, authority state, and the signed threshold
comparator select the applicable treatment pair. The registry is checked for exact equality with the
signed taxonomy, so an unsupported class cannot enter either denominator by relabeling a structurally
valid case. Its declarative bytes and exact executable-authority source digests are part of
`corpusDigest`, so changing a predicate or cross-field rule invalidates signoff.

Replay references are entity-kind-scoped. Each real-derived case, request, and reservation carries the
same exact opaque `firmRef`; reservation identity is the pair `(firmRef, conflictKey)`. Generic replay
subjects, evidence subjects, and impacted-subject inventories exclude firm references, so no
second tenant scope can enter through a generic reference collection. Synthetic identity contexts carry
typed unresolved raw bytes, canonical values, exact candidate references, candidate raw bytes, and
household bindings. Ambiguity and canonical collision are derived from those emitted records rather than
from assumption ids. Synthetic requests and real-derived payloads both carry an
explicit duplicate-free selected funding set. Synthetic pending actions and pending model assignments
used by semantics must name an account in that exact set and the request household. Request, household,
account, instruction, owner, actor, grant,
policy, restriction, hold, pending-action, and time-zone identities cannot be satisfied by one generic
token. Every material plane has exactly one evidence tuple matching kind, subject, source, and permitted
observation state. Missing evidence supports only an explicit absence or unavailable payload of the same
typed plane; every concrete value requires observed evidence. The
request source account resolves in the liquidity collection, and the explicit selected funding set is
unique, same-household, source-owner-aligned, supported, and sufficient in aggregate. Tax risk is
evaluated against exactly that set, including every selected source's tax character and review state.
Aggregate sufficiency uses exact `bigint` arithmetic after rejecting any unsafe integer boundary.
Each pending action names the request household and one selected account, and its action evidence matches
the exact action identity and source.
An instruction-conflict witness names the exact governed request and household. Every referenced
instruction belongs to that household, and impacted subjects intersect the request source account or
destination instruction.

Each real-derived case records `evaluation.asOf` and the closed
`verin-real-derived-freshness/1.0.0` policy version. The policy has one freshness window per supported
evidence kind. Observed evidence enforces `observedAt <= retrievedAt <= evaluation.asOf` and its supplied
fresh/stale value must equal the derived value. `unknown` is legal only through the typed
`observationState: "missing"` arm with `observedAt: null`. Unknown policy versions, unsupported evidence
kinds, impossible chronology, or inconsistent freshness are rejected before inventory. The policy version
and semantic digest are bound into `corpusDigest`.

**This ADR invents no defect history.** Every defect class in the taxonomy cites a requirement or a
signed case that already exists in this repository, and the cited file's existence is validated.

### 5. Signoff is per corpus version, bound to `corpusDigest` (captain ruling)

The captain signs a **corpus version**, not each case, and the signature is bound to the canonical
`corpusDigest`. Any regeneration that changes the digest invalidates the signature and requires
re-signing (`signed-but-regenerated` fails the build). Narrative wording outside the signed bytes -
this ADR, `docs/corpus.md`, the signoff file's own prose - never invalidates a signature. What is
signed is the **labels and their closed semantic vocabulary**, because they are the denominator of every
figure the corpus can report. The `verin-corpus/1.10.0` preimage covers every inventory entry's partition,
case id, byte digest, label kind, and label id, plus versioned semantic digests of the taxonomy definitions
and citations, the real-derived freshness policy, both versioned real-derived JSON Schemas, and the
declarative plus executable semantic contract. Schema bindings include identifiers, exact-byte digests,
and canonical semantic projections. Relabeling inventory, redefining a class, changing a freshness
window, changing either schema's bytes or meaning, or changing a replay predicate or cross-field
authority invalidates prior signoff even if no case bytes change.

A signed record accepts only the closed authority `signedBy: "captain"` and a canonical millisecond UTC
`signedAt` instant. Its hand-owned YAML is parsed fail-closed before those fields are read: parser errors,
duplicate or unexpected keys, aliases, non-mapping shapes, missing keys, multiple blocks, and ambiguous
values are rejected.

**Agents never sign.** No generated file carries a signature: the manifest holds a `signoffRef`
pointer, not a signature block, and validation recursively rejects `signedBy`, `signedAt`, or
`signedDigest` keys in the actual generated artifact values, regardless of how source code constructed
them. The generator can emit only into `synthetic/`.

### 6. Labeled clean controls and a false-positive rate are mandatory (captain ruling)

Every coverage figure ships with a **false-positive rate computed from labeled clean controls**, and a
coverage figure without one is marked `interpretable: false`. A detector that blocks everything scores
1.0 coverage *and* 1.0 false positives and cannot claim success. A corpus with no clean controls fails
validation.

### 7. ADR-0018 amendment: the `tooling` envelope

`scripts/**` was invisible to both budget fences. This PR adds a measured `tooling` bucket with its
own ceiling and extends the per-file 500-line ceiling to walk `scripts/**`. The bucket carries the
same zero-total staleness guard as every other, so a renamed path fails loudly instead of silently
dropping its envelope. D-081 raises the tooling ceiling from 4000 to 4300 for the fail-closed graph,
intake, signoff, and measurement boundaries, with 46 lines of measured headroom rather than deleting
existing design documentation to conceal the growth. **Ratchet-down point:** after the corpus
generator's first post-prompt-19 simplification pass, once replay has shown which generator surface
is actually load-bearing. D-082 raises the ceiling from 4300 to 4900 for the inventory-bound report,
recursive tree intake, direction-aware actions, referenced-household topology, generated-signature scan,
and versioned real-derived freshness policy. D-084 records the completed review boundary at exactly 4900
measured lines, with no unmeasured headroom and no ceiling increase. D-085 raises the ceiling to 5900
against 5747 measured lines for signed executable semantics, recursive strict JSON intake,
entity-kind-scoped topology, exact evidence support, and explicit selected funding. The 153-line buffer
preserves readable ownership boundaries instead of forcing these rules back into one oversized validator.
D-086 raises the ceiling to 6200 against 5996 measured lines for outcome-based defect semantics,
request-bound instruction-conflict topology, schema-driven nested uniqueness, and complete
nondeterminism-flow enforcement. The 204-line buffer keeps these authorities separated and readable.
D-087 raises the ceiling to 6500 against 6426 measured lines for shared synthetic and real-derived
treatment semantics, selector-driven authority, reserve, and threshold policy identity, exact
pending-action topology, and request source ownership. The 74-line buffer keeps the new semantic owner
separate from generation and validation. D-088 raises the ceiling to 6700 against 6552 measured lines
for exact label and attribution identity, explicit synthetic funding topology, and schedule-derived
reserve state. The 148-line buffer keeps those validation owners separate.
D-089 raises the ceiling to 7000 against 6878 measured lines for structural firm scope,
observation-state evidence authority, complete selected-funding tax and pending-action semantics, and
synthetic ownership topology. The 122-line buffer keeps schema, topology, evidence, and funding ownership
in separate files under the unchanged 500-line file ceiling.
D-090 raises the ceiling to 7300 against 7129 measured lines for typed synthetic identity inputs,
single-firm generic-subject closure, and exact minor-unit funding arithmetic. The 171-line buffer keeps
identity derivation separate from outcome and topology owners under the unchanged 500-line file ceiling.

## What this PR explicitly does NOT claim

- **Not Gate B.** Gate B requires money movement *and account opening* expressible as data - prompt
  10's deliverable - plus a stable corpus. This delivers the second half only.
- **Zero v3 invariants are activated.** No `activatesWhen` in `v3-invariants.json` names prompt 11.
- **No detection rate, and no number of any kind today.** The corpus is unsigned and no detector
  exists, so every figure is `null` with a reason code.
- **Not "the labeled replay corpus" of demo contract §7.** It is the synthetic half of it.
- **No signed golden fixture, `docs/golden-cases.md`, or golden validator is modified.** Signed-case
  materialization and `signoff.signedDigest` are a later, separate PR.

## Consequences

- The corpus is regenerable and byte-verifiable; a hand edit to a generated file fails CI.
- The demo's weakest number is now *structurally* prevented from being overstated, at the cost of
  reporting nothing until the captain signs and a detector exists. That is the intended trade.
- Adding a defect class or an awkward structure is a spec edit plus a regeneration plus a re-signoff.

## Alternatives considered

- **A stream PRNG.** Simpler, and order-fragile. Rejected: it would make every spec insertion churn
  the whole corpus and its digests.
- **Corpus entities added to `DATA_DICTIONARY`.** Rejected: charter #2 forbids speculative modeling.
  They graduate when a real evidence source port needs them (prompt 14).
- **Seeding the corpus into the house-CRM store.** Rejected: keeps `org-id-required`, the audit chain
  and the PII boundary out of prompt 11's blast radius. The corpus is a fixture-plane asset.
- **Per-case corpus signoff** (extending `docs/golden-cases.md`'s rule unchanged). Rejected by the
  captain: the ceremony does not scale to a generated corpus, and digest binding is stronger.
- **Amending Phase 1 so a synthetic-only corpus suffices.** Rejected: it permanently forfeits the
  demo's primary proof metric.

## Revert path

Delete `fixtures/corpus/`, `scripts/corpus*`, the four fences, the `corpus` CI job, the three package
scripts, the `corpus_deferral` matrix section with its `PINNED_IDS` entry, and the `tooling` budget
bucket. Nothing in `src/` depends on any of it.
