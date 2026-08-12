# Primitive rationale - decision-primitive set 1.0.0 (provisional)

Status: **versioned and provisional**. Set version `1.0.0` (`primitive-set-version.json`,
mirrored by `src/contracts/primitives/catalog.ts`; the `primitive-catalog` fence fails the
build if they disagree in either direction). Ratified design:
`waveb-design-ratification` (captain, 2026-07-26) over the Wave B design report; this
document carries that design's rationale into the repo. Deviations from it require a new
captain ruling, and every catalog change requires a primitive-set version bump.

Placement note: the v3 build sequence names the deliverable `src/primitives/catalog.ts`.
Per marriage-map C6 (v3 module paths become subsystems inside the chartered four-layer
architecture - the same re-baseline that landed prompt 5 at `src/contracts/decision-core/`),
the catalog lives at `src/contracts/primitives/catalog.ts`: it is pure types, Zod schemas,
and pure functions, which is the contracts layer's exact definition, and the prompt-9
policy loader consumes it from there. Recorded as D-102.

## 1. What a primitive is, and the composability razor

A **primitive** is a named, versioned, **pure** function:

```
(parameters, evidence projections, context) -> published typed facts | candidate outcome | restriction matches
```

- **Parameters** are declared with Zod schemas in the catalog; firm policy tunes them via
  `set_parameter`, domain configuration supplies defaults. Selection strategies are chosen
  via `select_candidate` from the primitive's declared closed strategy list.
- **Published context keys** are declared per primitive with types. The policy AST's
  closed context-key vocabulary (prompt 9) is derived from the domain configuration's
  intent-slot list plus the union of published keys of the primitives that configuration
  binds - this is what makes AST paths closable at load time.
- **Invocation** is bound by domain configuration (prompt 10), never by the evaluator
  branching on a domain - the evaluator runs whatever the configuration bound.
- **Binding multiplicity is bounded by published-key scope** (captain rulings
  `p8-review-askuser-2` and `-6`). The four primitives whose published keys are UNSCOPED -
  `net-availability`, `horizon-projection`, `sufficiency-check`, `restriction-screen`,
  publishing `availability.*`, `projection.*`, `sufficiency.*`, `restrictions.*` - are
  bound AT MOST ONCE per domain configuration: those key shapes stay ratified verbatim, so
  a second binding would silently overwrite the first one's published facts and the AST
  would evaluate a wrong-but-plausible fact rather than fail. The two parameter-scoped
  primitives - `candidate-selection` (scoped by `subjectSlot`) and
  `evidence-reconciliation` (scoped by `factKind`) - MAY be bound several times per
  configuration, but every binding MUST carry a distinct key scope. That is what the
  ratified money-movement configuration already does: it binds `candidate-selection`
  twice, at the bind stage for `target-record` (GC-08) and at the evaluate stage for
  `source-account` (GC-01). **This is NOT checked today - deferred as
  `fu-binding-multiplicity-check`, owned by prompt 16 (D-235).** Prompt 10's config load
  was to reject both halves with a precise error naming the primitive and both bindings,
  and it does not: nothing in `src/domain/config/` groups bindings by `primitiveId`. What
  ships is narrower and incidental - `deriveContextKeys` refuses two bindings whose
  published keys COLLIDE within ONE intent, reported against the colliding key and worded
  as a slot-versus-primitive clash, so it names neither the primitive nor the two bindings
  and says nothing about bindings attached to different intents. Both shipped documents
  satisfy the rule by authorship, not by enforcement; last-write-wins is still not an
  option, it is simply not yet refused. Falsification path: a real configuration that
  needs one UNSCOPED primitive twice (a reserve floor AND a per-transaction cap, both
  `sufficiency-check`) forces binding-namespaced published keys under a set version bump.
- **Key-shaping parameters are configuration-only, never policy-writable** (ruling
  `p9-key-shaping-params`). Each entry declares `keyShapingParameters`: the parameters its
  `publishedKeys` body reads to construct the key space - `candidate-selection.subjectSlot`,
  `evidence-reconciliation.factKind`, `net-availability.claimEvidenceKinds`, and
  `restriction-screen.restrictionKinds`. The prompt-9 context-key vocabulary is derived
  once, at load, from the CONFIGURED values, so a `set_parameter` on one of these would run
  the primitive under a namespace the loader never closed over: readers of the derived key
  miss, and two bindings differing only in that parameter collapse onto one invocation
  identity. `loadPolicy` therefore refuses such a write
  (`key-shaping-parameter-not-writable`), and the `primitive-catalog` fence proves the
  declaration against what each `publishedKeys` body actually reads, so it cannot go stale.
  Prompt 10's binding model must NOT re-open these to policy - a binding chooses the key
  scope; a rule may not move it.

**The razor, applied in both directions:**

- If a concept is expressible as a closed AST predicate over values already published
  (compare, exists, is_fresh, in), it must NOT be a primitive. A primitive that duplicates
  the AST is a second place for the same judgment to live and drift.
- If a concept requires any of the four capabilities the AST deliberately lacks, it MUST
  be a primitive, because adding that capability to the AST is the road to the banned
  general-purpose expression engine:
  1. **aggregation** over dynamic collections (sums, counts over evidence sets),
  2. **arithmetic** (even one subtraction),
  3. **per-candidate quantification** (applying predicates inside a candidate set -
     the first-order AST cannot),
  4. **cross-snapshot comparison** within one evidence kind (AST paths resolve to at most
     one snapshot per kind, by design).

Boundaries with the other planes: authority mechanics (quorum, distinct actors, expiry,
escalation) live in the authority layer's templates; idempotency, reservations, and
conflict keys live in the concurrency and execution layers; firm-versus-household
precedence lives in the precedence module. Primitives feed those planes typed facts; they
never implement them.

## 2. The catalog - six primitives

Derived from the five example domains the prompt names (money movement, account opening,
trading/rebalancing, life events, client service), then falsified against the sixteen
captain-signed golden cases and full expressions of the three required operational
domains. Six, not fifteen: the razor removes everything the AST already owns.

### `net-availability`

- **Deterministic semantics:** net available quantity of a constrained resource =
  observed gross quantity minus the sum of recorded claims, with a per-claim-kind
  breakdown. The formula is fixed linear netting; nothing about the formula is
  configurable. A binding with zero claim kinds is refused by schema - netting over
  nothing is a plain evidence read the AST already owns.
- **Parameters:** `resourceEvidenceKind`, `claimEvidenceKinds[]` (unique, kebab-case,
  min 1), `subjectScope` (`bound-subject` | `subject-group`).
- **Applicable evidence:** one resource observation (balance-class) plus zero or more
  claim observations (pending-activity-class, active-reservation-class), each citing its
  snapshot reference; claims are nonnegative integers in minor units; a claim of an
  undeclared kind is a parse error, never silently summed or dropped. One snapshot may
  legitimately contribute SEVERAL claim observations - a single active-reservations
  snapshot yields one row per reservation - so `claims` carries no per-(claimKind,
  snapshotRef) uniqueness refinement, and de-duplicating assembler-side repeats is the
  evidence assembler's obligation (captain ruling `p8-review-askuser-6`). A repeat fails
  conservative: it double-counts the claim, understating `availability.net`, so it
  over-blocks and never over-permits. Whether the evidence-assembly contract should force
  per-(claimKind, snapshotRef) aggregation is a recorded follow-up for prompt 14.
- **Possible effects:** publishes `availability.gross`, `availability.net`, and
  `availability.claims.<kind>` (zero when no claims of that kind are present) - the
  per-kind breakdown is what lets GC-11's sibling-reservation blocker be named
  differently from GC-05's pending-activity shortfall with no new machinery.
- **Falsification test:** a real availability rule that is not linear netting -
  conditional claims (pending buys counting only after settlement), margin or overdraft
  facilities, partial netting by claim class. Any of these forces a claim-classifier
  parameter or a sibling primitive under a version bump. Second kill test: if every
  domain except money movement computes "available" differently, this is domain logic
  wearing a neutral name and must be merged or demoted.

### `horizon-projection`

- **Deterministic semantics:** the sum of a dated scheduled-flow series over a calendar
  horizon anchored at the bundle's asOf date. The window is half-open
  `[anchor, anchor + horizonMonths)`: a flow due on the anchor date is still scheduled
  and counts; a flow due exactly at the far edge belongs to the next window. Month
  arithmetic is proleptic Gregorian with end-of-month clamping (2026-01-31 + P1M ->
  2026-02-28). The anchor date is the bundle's asOf instant projected into the bundle's
  time zone ONCE by the evaluation harness; the primitive itself never touches tz data,
  which keeps its arithmetic pure integer math.
- **Parameters:** `seriesEvidenceKind`, `horizonMonths` (positive integer bounded at 1200,
  one hundred years - the target of the ratified natural-language policy moment), `direction`
  (literal `forward` in v1; a backward projection is a parse error today and a version bump
  tomorrow). The bound exists for totality: the window end is calendar arithmetic on a
  four-digit ISO year, so an unbounded horizon could name a year the date type cannot
  express. `addCalendarMonths` stays total regardless by saturating at `9999-12-31` rather
  than rendering an unparseable date, and the parse-boundary cap keeps that saturation an
  unreachable backstop instead of a silently wrong window.
- **Applicable evidence:** one schedule-class snapshot projecting to dated flows
  (`dueOn`, `amountMinor`).
- **Possible effects:** publishes `projection.total` (the 48,000/96,000 USD reserve
  floors of the golden cases) and `projection.horizon` (the evaluated window). The
  entire Firm A/Firm B reserve divergence is
  `set_parameter(horizon-projection, horizonMonths, 6|12)`.
- **Falsification test:** a real reserve or commitment rule needing non-sum aggregation
  (largest monthly gap, inflation-adjusted projection) or irregular schedules the
  horizon-sum cannot express. Hard kill criterion (captain OQ-4 ruling): if no second
  domain (trading cash-needs, life-event required-distribution projection) has bound it
  by the trading wave, it was a money-movement one-off and must be merged or demoted.

### `sufficiency-check`

- **Deterministic semantics:** whether a proposed draw against an available quantity
  preserves a required floor (mode `floor-preserving`: `available - draw >= bound`) or
  stays within a cap (mode `cap-limited`: `draw <= bound`). Publishes satisfied plus the
  shortfall/headroom arithmetic as a typed trace - GC-05's blocked arithmetic
  ("140,000 - 75,000 = 65,000 < 96,000") renders from this trace, satisfying
  explain-from-trace. This is deliberately the ONLY arithmetic in the decision plane: it
  exists so the AST never grows a subtraction node.
- **Parameters:** a mode-discriminated union. `floor-preserving` binds `available`
  (context reference), `draw` (context reference or the zero constant - exactly zero,
  per the ratified shape), `bound` (context reference or integer constant).
  `cap-limited` binds `draw` and `bound` only - an `available` binding in cap mode is
  unrepresentable. The evaluation harness resolves the bindings; the input schema proves
  each resolved constant equals its binding.
- **Applicable evidence:** none - it is the join point, consuming only context
  (outputs of net-availability and horizon-projection plus intent slots).
- **Possible effects:** publishes `sufficiency.satisfied`, `sufficiency.shortfall`,
  `sufficiency.headroom`.
- **Falsification test:** a real rule needing ratio or percentage headroom ("keep 110%
  of the floor") or joint sufficiency across multiple resources at once. Either
  activates the declared future primitive `deviation-from-target` rather than
  stretching this shape.

### `candidate-selection`

- **Deterministic semantics:** generate -> filter -> rank -> select over a typed
  candidate set. Outcome is exactly one of `selected` (winner plus ranked alternatives
  with rejection reason codes), `ambiguous` (candidates plus a typed human question -
  the model never guesses), or `empty`. Filtering applies the binding's closed exclusion
  list in order; the first matching exclusion names the rejection. Every strategy
  guarantees a deterministic total order: candidates are canonically sorted at the parse
  boundary, and ranking ties break to that order.
- **Parameters:** `candidateEvidenceKind`, `subjectSlot` (the intent slot being selected
  for - the published-key segment), `exclusions[]` (classification -> reason code, the
  closed filter toggles), `ambiguityQuestionCode`.
- **Applicable evidence:** candidate-class records (subject reference plus
  classification codes) and a household preference-class ranking (order is data, never
  sorted; entries need not all be current candidates). The preference ranking is
  OPTIONAL-BY-DESIGN evidence and deliberately NOT a D-104 obligation (captain ruling
  `p8-review-askuser-8`): it only advises ordering, an empty list is indistinguishable from
  a household holding no standing preference, and the resulting canonical fallback is
  labeled honestly with the `canonical-order-tiebreak` reason code rather than gated on.
- **Strategies (closed):** `preference-order` (rank survivors by household preference,
  unranked survivors tie to canonical order; never ambiguous), `single-eligible`
  (exactly one survivor after exclusions, else ambiguous/empty), `exactly-one` (the raw
  set must be singular - the bind-stage semantics; a binding that also configures
  exclusions is refused as self-contradictory). The same primitive serves the bind stage
  (GC-08's two-Smiths ambiguity) and the evaluate stage (GC-01's source choice with the
  retirement-account alternative rejected for the configured taxable-event reason), so
  ambiguity semantics stay uniform everywhere.
- **Possible effects:** publishes `selection.<slot>.outcome` (always) and, conditionally,
  `selection.<slot>.selectedRef`, `selection.<slot>.alternatives`, and
  `selection.<slot>.openQuestion` (feeding `ResolutionState.ambiguous` and the blocked
  decision's structured question). `alternatives` carries the exclusion trace on EVERY
  outcome - every non-selected candidate with its configured `rejectedBecause` code - and
  is absent only when nothing was excluded or ranked behind (captain rulings
  `p8-review-askuser-4` and `-5`). Its order is itself data: a `preference-order` selection
  lists the losing survivors first IN PREFERENCE-RANK ORDER, followed by the excluded
  candidates in canonical order. Those survivors carry one of two fixed codes, because the
  trace must not credit a preference that never spoke (captain ruling `p8-review-askuser-7`):
  a survivor ranked strictly behind the winner's preference rank carries
  `ranked-behind-selection`, and a survivor TIED at the winner's rank - both absent from the
  household preference list, so the canonical (firmId, id) order decided it - carries
  `canonical-order-tiebreak`. Ranking entries are unique, so only the absent-rank sentinel
  ties, and the two codes partition the losing survivors exactly.
  Everywhere else - a `single-eligible` or `exactly-one` selection, and both the ambiguous
  and empty outcomes - the trace is the excluded candidates in canonical order. An empty
  outcome without its trace cannot explain why no candidate survived, and an ambiguous one
  without it hides from the human answering the question that a candidate was filtered out
  before the question was ever asked.
- **Falsification test:** a real case requiring multi-candidate allocation with
  quantities (split 75,000 USD across two sources pro-rata) or pairwise-interacting
  selection (tax-lot selection). Single-winner selection is then wrong and the declared
  `allocation-vector` extension activates. Any strategy that cannot guarantee a total
  order also falsifies the strategy vocabulary.

### `restriction-screen`

- **Deterministic semantics:** match the proposed action's bound subjects against
  standing restrictions across the three governing planes - regulatory evidence,
  firm-policy lists, restriction-class household instructions - honoring allow-list and
  deny-list polarity. A deny-list violates when the subject IS a member; an allow-list
  violates when it is NOT. Matches carry source type, versioned source reference, scope,
  and matched entry, in canonical order regardless of assembly order.
- **Parameters:** `restrictionKinds[]` (each kind with its expected polarity - a list
  arriving with the opposite polarity is refused, never reinterpreted),
  `subjectsInScope[]` (slot names).
- **Applicable evidence:** restriction lists whose source and version references are
  discriminated by plane (a firm-policy restriction carrying a regulatory reference is
  unrepresentable), plus the bound subject references from context.
- **Possible effects:** publishes `restrictions.matched.<kind>` booleans for predicate
  use and `restrictions.matches` with full source attribution - exactly what
  `Prohibition.source` and the precedence machinery need. GC-06 (destination outside the
  household allow-list; source `household_instruction` at
  `smiths-destination-restriction@v2`) and GC-07 (active legal hold; source
  `regulatory`, outranking everything in the precedence trace) both draw their
  prohibition source from this attribution, never from the firm AST's `prohibit` effect:
  a firm rule cannot impersonate a client mandate or a regulation.
- **Absent evidence is the validation stage's problem, not the screen's** (captain ruling
  `p8-review-askuser-5`, mirroring the `evidence-reconciliation` split).
  `restrictions.matched.<kind> = false` means "screened against everything supplied"; it
  NEVER means "the restriction evidence was verified present", so a bundle assembled
  without restriction lists screens clean by construction. A domain configuration that
  binds `restriction-screen` MUST therefore declare its restriction-source evidence kinds
  as required evidence. **That obligation is NOT checked today - deferred as
  `fu-restriction-evidence-required`, owned by prompt 15 (D-235).** Prompt 10 was to
  enforce it at config load, fail-closed, and did not, because the linkage the check must
  read is not expressible: a `restrictionKinds[]` entry carries `kind` and `polarity` and
  nothing else, so no document can name the evidence kind that supplies a bound
  restriction kind's list. `config/domains/account-opening.yaml` binds the screen for
  `jurisdiction-restriction` while declaring no restriction-source evidence, and it loads
  clean. Until the check exists, nothing stops a governed action clearing over
  restrictions nobody assembled; that both shipped documents' decision halves are
  validated-not-yet-evaluated bounds today's exposure but does not remove the hole.
  Falsification path, now the REQUIRED path rather than a contingency: `restrictionKinds[]`
  entries gain `sourceEvidenceKinds` under a primitive-set version bump, and the
  validation-stage evidence-sufficiency contract (prompt 15) reads them.
- **Falsification test:** a restriction whose applicability requires computation, not
  matching - "no more than two distributions per quarter" is an aggregate-based
  restriction, and forcing it through the screen would smuggle aggregation into
  matching. That case activates the declared `windowed-event-count` future primitive.

### `evidence-reconciliation`

- **Deterministic semantics:** cross-source agreement check on one fact kind for one
  subject: given two or more snapshots asserting the fact, determine agreement within a
  configured tolerance (integer facts within tolerance; string facts exact; mixed types
  always disagree); on disagreement emit contradictions citing both snapshot references -
  never the values, which may be PII. Below two assertions the check is vacuously
  consistent: evidence sufficiency belongs to the validation stage, not to this
  primitive.
- **Parameters:** `factKind`, `sourcesToReconcile[]` (min 2 - reconciling fewer is a
  plain read), `tolerance` (nonnegative integer minor units; firm-configurable, which is
  the reason this is a primitive and not hard-wired validation machinery).
- **Applicable evidence:** two or more snapshots of one evidence kind - the ONE place
  the system compares snapshots to each other (razor capability 4).
- **Possible effects:** publishes `reconciliation.<factKind>.consistent` and
  `reconciliation.<factKind>.contradictions` (both sources cited - prompt 15's required
  contradictory-evidence test verbatim). Serves validation-stage blockers,
  account-opening identity checks, and conflicting-change-request detection.
- **Absent evidence is the validation stage's problem here too** (the same split as
  `restriction-screen`): `consistent = true` below two assertions means "nothing supplied
  disagreed", never "the evidence was verified present", so prompt 15's validation-stage
  evidence-sufficiency contract MUST cover reconciliation bindings before an AST rule may
  gate on `reconciliation.<factKind>.consistent` (D-104, obligation 4).
- **Falsification test:** if every real contradiction check turns out to be schema
  validation or a fixed trust-hierarchy rule no firm ever configures (no tolerance, no
  source-pair choices), it is machinery, not a primitive - demote it into the validation
  stage. Disclosed weakness (captain OQ-3 ruling): zero of the sixteen signed golden
  cases exercise it; it is included in set 1.0.0 labeled **activates at prompt 15** so
  Wave C is not blocked on a mid-wave version bump.

## 3. Deliberately NOT primitives

Each was a candidate; each is rejected with the razor. This list is what protects the
acceptance criterion "no primitive exists solely because the money-movement demo needed a
one-off condition."

| Candidate | Verdict | Where it lives instead |
|---|---|---|
| **Threshold** (25k/100k dual approval) | AST-native | `compare(gt, context('intent.amount'), constant(...))` -> `require_approval`. The ratified grammar already owns comparison. |
| **Evidence freshness** | AST-native | `is_fresh(kind, maxAge)` is a ratified predicate; policy windows stay policy constants; snapshot-level freshness stays source-side provenance. |
| **Recency of change** (bank instruction changed 4 days ago) | AST-native via evidence modeling | The change EVENT is its own evidence kind whose `observedAt` is the change time; `is_fresh('bank-instruction-change', P7D)` IS the recency predicate (captain OQ-1 ruling: P7D, a firm policy constant). Velocity rules (3 changes in 30 days) are future `windowed-event-count` territory. |
| **Eligibility** | split | Eligibility of the bound subject = AST predicates over evidence paths. Eligibility within a candidate set = candidate-selection's filter phase. Requester authorization is the security layer, not policy. |
| **Allocation integrity** (beneficiary shares sum to 100%) | schema validation | Data integrity, not judgment; no firm configures "percentages must total 100". Lives at the Zod boundary of the evidence schema. |
| **Precedence / conflict resolution** | platform module | v3 §10: precedence is order-independent platform machinery. Making it configurable judgment would let a firm configure away invariant 10. |
| **Duplicate/conflict detection at decision time** | evidence + net-availability | Sibling reservations and pending activity enter as claims; execution-time duplicate suppression is the idempotency layer (GC-12). |
| **Deadline feasibility** ("by August 15") | out of scope | No golden case gates on it; a plausible future primitive when a real SLA-versus-deadline rule appears. |
| **Approval mechanics** (quorum, distinct actors, requester exclusion) | authority layer | `ApprovalRequirement` carries them; policy only references templates. |

## 4. Cross-domain matrix

Legend: P1 `net-availability`, P2 `horizon-projection`, P3 `sufficiency-check`,
P4 `candidate-selection`, P5 `restriction-screen`, P6 `evidence-reconciliation`.
"AST" names ratified grammar constructs doing the policy work; "plane" flags where a
case's distinctive behavior lives when it is NOT the decision plane.

### Golden-case coverage (all sixteen signed cases)

| Case | Primitives | AST constructs / non-primitive plane |
|---|---|---|
| GC-01 Firm A happy path | P4 (source; retirement alternative rejected), P1, P2 (6mo), P3 (satisfied), P5 (destination passes, no holds) | amount compare > 25k -> require_approval(dual) |
| GC-02 Firm B happy path | same; P2 (12mo) | threshold rule not fired -> authority automatic |
| GC-03 recent bank change, Firm A | GC-01 set; change-event evidence present | all(is_fresh(change, P7D), not(exists(verification))) -> require_approval(specialist) |
| GC-04 recent bank change, Firm B | same facts | same when-clause -> block(unverified-change) |
| GC-05 insufficient liquidity | P1 (pending claim 20k -> net 140k), P2 (96k), P3 (shortfall 31k) | sufficiency false and zero reservation claims -> block(reserve-breach); the firm-divergence-noted node is comparison-surface output (captain OQ-8 ruling) |
| GC-06 household restriction | P5 (allow-list, titling) | platform maps the match -> prohibited, source household_instruction@v2 |
| GC-07 regulatory prohibition | P5 (legal hold, regulatory) | platform maps -> prohibited; precedence trace regulatory-outranks |
| GC-08 ambiguous household | P4 at bind (two candidates, exactly-one -> ambiguous) | resolution stage records the typed question |
| GC-09 stale evidence | (P2 consumes the stale series) | not(is_fresh(planned-withdrawals, P30D)) -> block(stale) |
| GC-10 simultaneous, winner | GC-01 set (no sibling claim at commit instant) | reservation creation is the concurrency layer |
| GC-11 simultaneous, loser | P1 (sibling reservation claim -> net 85k), P2 (48k), P3 (shortfall 38k) | unsatisfied and reservation claims > 0 -> block(reserved-by-sibling) |
| GC-12 duplicate retry | decision plane = GC-01 | execution layer: idempotency key absorbs the retry |
| GC-13 partial external success | decision plane = GC-01 | execution/verification planes |
| GC-14 delayed not-in-good-order | decision plane = GC-02 | verification: late status -> exception decision |
| GC-15 approval invalidation | GC-01 set on TWO bundles; P1 differs (new claim) -> new bundle hash | authority layer: invalidation on material change |
| GC-16 specialist expiry | decision plane = GC-03 | authority time machinery |

Cases 12-16 concentrating in non-primitive planes is expected and correct: the primitive
vocabulary is a decision-plane vocabulary.

### Domain matrix

Three required operational domains, plus the two derivation domains the prompt names,
marked prospective - prospective columns are evidence of breadth, never counted as proof.

| Primitive | Money movement | Account opening | Address/contact change | Trading (prospective) | Life events (prospective) |
|---|---|---|---|---|---|
| `net-availability` | effective liquidity (GC-05/10/11) | funding-source availability | - | position/cash available | - |
| `horizon-projection` | reserve floor (14 of 16 cases) | - | - | cash-needs projection | required-distribution projection |
| `sufficiency-check` | reserve preservation | minimum initial funding | - | cash/position sufficiency | - |
| `candidate-selection` | source account; household binding | registration type, custodian | which record when several exist | lot selection (allocation falsifier) | successor/beneficiary resolution |
| `restriction-screen` | destination restriction, legal hold | offered account types, state restrictions | jurisdiction screens, profile-change holds | do-not-sell | account freeze |
| `evidence-reconciliation` | balance cross-source check (validate) | identity document vs system of record | conflicting change requests | - | date-of-death consistency |

Suspect-primitive audit (the "used once is suspect" rule applied to this catalog):

- `horizon-projection`: 1 of 3 required domains. Defense: it is the target of the single
  ratified natural-language policy moment and the lever of the demo's central Firm A/B
  divergence, with named prospective bindings and an explicit kill date (the trading
  wave). Captain OQ-4 ruling: keep, with the hard kill criterion.
- `evidence-reconciliation`: 3 of 3 domains but 0 of 16 golden cases. Captain OQ-3
  ruling: include in 1.0.0, labeled "activates at prompt 15".
- Everything else: multi-domain and multi-case.

## 5. Versioning discipline

- `PRIMITIVE_SET_VERSION` (catalog) and `primitive-set-version.json` (registry) carry the
  same semver and the fence keeps them equal; the version is pinned into every
  `DecisionInputBundle.primitiveSetVersion` and versions independently of the policy-AST
  grammar version.
- Additive changes (a new primitive, a new strategy in a closed list) are minor bumps;
  semantic changes to an existing primitive are major bumps and force re-simulation of
  affected policies through the policy lifecycle (no silent reinterpretation of approved
  judgment, ever).
- Declared future primitives (`deviation-from-target`, `windowed-event-count`,
  `allocation-vector`) are named in the registry now so their arrival is a version bump
  executing a plan. The v3 standing rule applies to everything else: when implementation
  reveals a missing primitive, REPORT it before adding one - a primitive is a platform
  decision, not a local convenience.
