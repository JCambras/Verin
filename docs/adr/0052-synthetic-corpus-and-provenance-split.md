# ADR-0052: The replay corpus is a deterministic synthetic substrate with a fenced provenance split, an honestly empty real-derived partition, and digest-bound per-version signoff

**Status:** Accepted
**Date:** 2026-07-28
**Deciders:** Founding architect, executing captain rulings `corpus-real-derived-provenance` and
`corpus-signoff-and-measurement` (both 2026-07-28)
**Relates to:** Charter non-negotiables #1, #2, #3, #4, #5; ADR-0018 (line budgets), ADR-0024
(the deferral precedent this ADR mirrors), ADR-0029 (canonical serializer reused here), D-034 (demo
contract as data), D-035 (golden-case truth set)
**Informed by:** `docs/v3/verin-architecture-v3.md` §2.4, `docs/demo-contract.md` §7,
`docs/v3/verin-prompt-sequence-v3.md` (prompt 11)

**Current Gate B reading:** ADR-0058 credits this Prompt 11a corpus through the blocking validation
command and keeps Prompt 11b signed-case replay materialization explicitly outstanding.

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
`load-smoke.ts`. **This Prompt 11a corpus slice adds zero lines to `contracts`, `domain`,
`infrastructure` or `presentation`**; a corpus type enters `src/` only when a runtime surface consumes
it (charter #5).
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
opaque projected account, bank-instruction, and referenced-owner nodes rather than filtered away. Accounts and bank
instructions preserve their `householdRef`; each non-primary referenced household appears exactly once as
an opaque id with closed relationship reasons. Every household edge resolves without importing foreign
balances, tax attributes, owner roster records, or unrelated household records through that expansion.

Pending-action direction and liquidity class come from a closed kind registry. Only live unresolved
outgoing distributions or debits reduce effective liquidity. Blocked, cancelled, rejected, incoming,
credit, unknown, and unclassified actions do not. Incoming value is excluded until settlement and can
increase availability only once settled. Every action states whether `availableMinor` already reflects
it. An included settled credit uses `preserve-settled-incoming-availability`; an excluded one uses
`credit-settled-incoming-availability`. Settled outgoing debits use the parallel
`preserve-settled-outgoing-availability` or `debit-settled-outgoing-availability` treatments, so replay
can neither omit nor double-count settled value in either direction.

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
envelope and `verin-real-derived-replay/1.11.0` payload. That payload contains only typed destination,
ownership, liquidity, direction, authority, threshold, policy, tax-review, instruction-conflict,
temporal, evidence, reservation, execution, and expected-versus-observed treatment inputs needed by
supported defect classes. Pending actions carry account and household references bound to the request,
selected funding, and exact evidence. Restriction policy carries effectivity instants so lifecycle state
is recomputed at `evaluation.asOf`. Threshold policy identity carries its strict or inclusive comparator.
Absent, extra, ambiguous, incompatible, or unversioned inputs fail. Raw names,
account numbers, unrelated balances, and unrelated household data have no field in the contract.

Every hand-owned corpus JSON document passes one unique-key parser before semantic parsing or hashing.
Delivery bytes must also equal canonical JSON plus one newline. Diagnostics expose only bounded safe
paths and redacted descriptions, never rejected prose or unrecognized key text. The contract runs over
the empty partition in the blocking `corpus` CI job, and its companions drive it with unattested,
free-text-bearing, self-reviewed, duplicate-key, structurally incomplete, and mislabeled cases. This is
what makes a shipped-but-unpopulated capability charter-#5-legal.

Derived ids accept only opaque token components and closed suffix vocabularies. A name or other prose
cannot hide inside an id-shaped string.

The closed `verin-real-derived-semantics/1.13.0` registry separates awkward context from outcome in both
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

Synthetic authority state requires exactly one cited signer. Multiple cited signer rows fail instead
of selecting whichever row sorts first. Destination verification follows the current instruction change
and cannot postdate the source observation or evaluation instant. Repository input readers accept only
regular files whose canonical targets remain inside the repository, and static root provenance trusts
only immutable bindings.

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
request source account resolves exactly once to the request household in the liquidity collection, and
the explicit selected funding set is unique, same-household, source-owner-aligned, supported, and
sufficient in aggregate. Tax risk is
evaluated against exactly that set, including every selected source's tax character and review state.
Aggregate sufficiency uses exact `bigint` arithmetic after rejecting any unsafe integer boundary.
Each pending action names the request household and one selected account, and its action evidence matches
the exact action identity and source.
Instruction conflicts derive only from signed typed terms whose action and source match the exact
request. Required terms conflict when their target does not match; forbidden terms conflict when their
target does match. Every witness carries the exact firm, household, and instruction identity, every
nonempty instruction set requires exact observed evidence, and impacted subjects intersect the request
source account or destination instruction.

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
figure the corpus can report. The `verin-corpus/1.12.0` preimage covers every inventory entry's partition,
case id, byte digest, label kind, and label id, plus versioned semantic digests of the taxonomy definitions
and citations, the real-derived freshness policy, both versioned real-derived JSON Schemas, and the
declarative plus executable semantic contract. Schema bindings include identifiers, exact-byte digests,
and canonical semantic projections. Relabeling inventory, redefining a class, changing a freshness
window, changing either schema's bytes or meaning, or changing a replay predicate or cross-field
authority invalidates prior signoff even if no case bytes change.

**The executable authorities are bound narrowly and by name.** They are the corpus-owned semantic modules
that carry behaviour, plus exactly the shipped surfaces the replay result depends on: `canonicalJson` and
the record predicate it admits values through (which decide the digest preimage bytes), the recorded IANA
time-zone registry and its reader (which decide real-derived temporal treatment), and the golden-case
loader (which decides disjointness). The rest of the runtime closure - the general-purpose `Result` and
`AppError` plumbing, and the decision-record vocabulary reached only through serializer projections the
corpus never builds - is declared as an excluded dependency list rather than digested. Binding it would
invalidate a captain signature over corpus bytes that did not change, and a signature invalidated by
noise is one people re-sign without reading. This narrowing weakens nothing, because two properties are
fenced instead: the bound list and the excluded list **together** are held equal to the complete runtime
closure, so a corpus module that begins depending on new shipped behaviour fails the build until it is
classified into one of the two by an explicit edit; and any change - bound, excluded, or elsewhere - that
actually moves corpus output still fails the blocking regenerate-and-byte-compare gate. Both directions
are proven adversarially: a byte appended to any bound module moves the digest, and every excluded module
is shown to leave it still while a drifted generated file is shown to fail the byte comparison.

A signed record accepts only the closed authority `signedBy: "captain"` and a canonical millisecond UTC
`signedAt` instant. Its hand-owned YAML is parsed fail-closed before those fields are read: parser errors,
warnings, tags, duplicate or unexpected keys, aliases, non-mapping shapes, missing keys, multiple blocks,
and ambiguous values are rejected.

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
D-091 raises the ceiling to 7700 against 7541 measured lines for typed instruction terms, exact
per-instruction evidence, executable-authority dependency closure, fail-closed signoff parsing,
repository-contained citations, and complete executable source discovery. The 159-line buffer preserves
separate evidence, semantic, topology, and fence owners under the unchanged 500-line file ceiling.
D-092 raises the ceiling to 7900 against 7739 measured lines for emitted-record-derived DST and shared
instruction contexts, target-specific joint-owner analysis, and comprehensive executable-authority
loader closure. The 161-line buffer preserves separate structural-context and fence owners under the
unchanged 500-line file ceiling.
D-093 keeps the ceiling at 7900 against 7898 measured lines after adding opaque referenced-owner
projection, signed validation-gateway roots, ambient-global nondeterminism coverage, and distinct
settled-credit treatment semantics. The 2-line buffer preserves those existing ownership boundaries
under the unchanged 500-line file ceiling.
D-152 raises the ceiling to 8000 against 7941 measured lines for element-access nondeterminism coverage,
explicit pending-action balance inclusion, and exact-once funding arithmetic. The 59-line buffer preserves
the separated determinism, schema, semantic, and topology owners under the unchanged 500-line file ceiling.
D-154 keeps the ceiling at 8000 against 7989 measured lines after adding settled-outgoing availability
semantics. The 11-line headroom remains measured rather than implicit.
D-155 raises the ceiling to 8100 against 8018 measured lines for transitive determinism provenance and
restriction lifecycle recomputation. The 82-line buffer preserves the separate fence and semantic owners.
D-156 keeps the ceiling at 8100 against 8035 measured lines after completing default-binding, callable
alias, CommonJS, and computed-member provenance; restoring the repository-wide no-blending scan; and
rejecting impossible synthetic effectivity and withdrawal schedules. The 65-line buffer preserves the
separate fence and schema owners.
D-158 raises the ceiling to 8300 against 8112 measured lines for complete structured-write provenance,
declared repository-input boundaries, and derivable real-derived time-zone rules. The 188-line buffer
preserves the separate fence, schema, and semantic owners under the unchanged 500-line file ceiling.
D-159 keeps the ceiling at 8300 against 8138 measured lines after closing dynamic-code and compound-flow
origins plus recorded time-zone and request-source topology. The 162-line buffer preserves the separate
fence, semantic, and topology owners under the unchanged 500-line file ceiling.
D-160 keeps the ceiling at 8300 against 8250 measured lines after sealing repository file reads and
making synthetic authority and bank-verification evidence unambiguous. The 50-line buffer preserves the
separate input, semantic, schema, and fence owners under the unchanged 500-line file ceiling.
D-167 raises the ceiling to 8700 against 8446 measured lines for the fail-closed evidence-kind
vocabulary, the hand-owned spec-coverage check that replaced a tautological digest test, the narrowed
executable-authority binding with its declared exclusions, and the parameterized signoff root. The
recorded figure had itself gone a round stale (8276 against an actual 8292), leaving eight lines of real
headroom - the condition this budget exists to avoid, where a one-line correction fails the build on an
unrelated ceiling. The 254-line buffer is deliberate: a ceiling that cannot absorb a review round buys
no discipline, it converts findings into documentation deletions. Every file stays under the unchanged
500-line ceiling.
D-172 KEEPS the ceiling at 8700 against a re-measured 8587 lines, after the serial-execution
configuration moved out of the `package.json` strings and into `vitest.config.ts`. D-167's figure was
true when written and went stale by the 141 lines the two review commits after it added - the same
drift D-167 recorded one round earlier, which is why the measurement is re-taken at the END of a review
round rather than at the change that motivated the ceiling. The 113-line buffer holds; the largest
tooling file is 475 lines, under the unchanged 500-line ceiling.
D-173 KEEPS the ceiling at 8700 against a re-measured 8607 lines, after the real-derived intake filename
rule was single-sourced from the case schema. 93 lines of real headroom.
D-175 KEEPS the ceiling at 8700 against a re-measured 8657 lines, after the intake naming authority moved
into its own module - a move the 500-line per-file ceiling forced, costing one module header. 43 lines of
real headroom.
D-176 KEEPS the ceiling at 8700 against a re-measured 8681 lines, after the intake anchoring rule became a
STRUCTURAL read of the pattern rather than a first-and-last-character test. 19 lines of real headroom -
the narrowest this ceiling has run, named here so the next change reads it as the ADR amendment it now is.
D-177 RAISES the ceiling to 9300 against a re-measured 9053 lines, on the rebase onto the prompt-7
decision-ledger trunk. 366 of those lines are the trunk's own build-time tooling - `seed-decision-ledger.ts`,
`ledger-rebuild.ts`, `ledger-rebuild-args.ts`, `decision-ledger-vacuity.ts`, and the chain-verify,
restore-drill, seed and golden-loader edits - which this envelope measures for the first time because it
did not exist when they landed. This branch did not write them and cannot shrink them, and a ceiling is
measured on the tree AS IT LANDS, so the figure is re-taken rather than inherited. The 247-line buffer is
the same deliberate review-round allowance the 8700 raise argued for; every tooling file stays under the
unchanged 500-line per-file ceiling.

This amendment budgets `scripts/**` and stops there. `src/__tests__/**` remains outside both budget
fences - 45,362 lines that no ceiling holds (37,529 before D-173 split the two oversized corpus fence
files into per-topic modules, then the non-determinism scanner decomposition, the D-175 watch-rerun
rebuild, and the D-176 counted double; 38,728 before the decision-ledger suites and fences landed beneath
it) - and the unwalked-tree argument above applies to it
verbatim. That gap is DEFERRED, not exempted: it is recorded in D-172 under follow-up key
`fu-corpus-test-tree-budget`, with the next structural test-tree work as its un-defer trigger.

## What this PR explicitly does NOT claim

- **Not Gate B.** This delivers Prompt 11a's deterministic corpus proof. Gate B also requires prompt
  10's money-movement and account-opening configuration and Prompt 11b's immutable signed-case replay
  materialization with deterministic seeds, expected hashes, byte-identical regeneration, and validated
  domain-configuration and policy-version references (ADR-0058).
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

Delete `fixtures/corpus/`, `scripts/corpus*`, the corpus fences
(`src/__tests__/fitness/{corpus-*,conflict-key-families}.test.ts` with their shared `_corpus-*` helper
modules, the fitness project's corpus `globalSetup` and `forceRerunTriggers` in `vitest.config.ts`, and
the `replay-corpus-substrate` entry in `charter-map.json` that registers them), the `corpus` CI job, the
three package scripts, the `corpus_deferral` matrix section with its `PINNED_IDS` entry, and the
`tooling` budget bucket. Nothing in `src/` depends on any of it.
