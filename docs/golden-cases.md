# Verin - Golden-Case Specification (v3 build-sequence prompt 2)

**Status:** Signed truth set - **all 16 cases signed as drafted by the captain on 2026-07-26**
(approval relayed via firstmate). Fifteen of them were subsequently AMENDED under a recorded ruling
and now carry an `amendment` block awaiting countersignature (§1.1); the 2026-07-26 signature covers
only the pre-amendment content. Expected results are product truth subject to human signoff, not
agent invention (build-sequence prompt 2; re-baseline note: the signoff authority for every case is
the captain).
**Machine mirror:** [`fixtures/golden/*.json`](../fixtures/golden/) - one file per case, validated
by `pnpm golden:validate` (CI job `golden-cases`) and the `golden-cases` fitness fence.
**Vocabulary sources:** [`config/demo/scenarios.yaml`](../config/demo/scenarios.yaml) (scenario ids,
firm ids, state vocabulary, provenance labels, deferral status - all under that file's append-only
stability contract) and [`docs/v3/verin-core-contracts.ts`](./v3/verin-core-contracts.ts)
(dispositions, authority modes, ledger event types, freshness, ObservedStatus).
**Acceptance:** the engine is later judged against these explicit domain outcomes instead of
self-generated tests (all signed golden cases run at Gate B and again at prompt 28).

---

## 1. Signoff protocol

Every case carries a `signoff` block initialized to:

```json
{ "status": "pending-captain", "authority": "captain", "signedBy": null, "signedAt": null }
```

- Only the captain may flip a case to signed; the agent that drafted a case must never sign it.
- The validation gate accepts exactly two signoff shapes: `pending-captain` (signedBy/signedAt
  null) and `signed` (signer and timestamp populated). A signed status without attribution, or any
  other status, fails the build. The captain signed all 16 cases as drafted on 2026-07-26.
- Signing happens per case. A signed case's expected outcomes become binding product truth; changing
  them afterwards requires a new captain decision recorded in the PR.
- Where a draft had to FIX an answer the demo contract deliberately left open, the case's signoff
  note flags it explicitly (GC-02: Firm B sub-threshold authority; GC-15: post-invalidation
  re-approval rule; GC-13: partial-part taxonomy).

### 1.1 Amending signed bytes

A signature attests to the bytes the captain was given, and to nothing else. When a recorded ruling
requires a change to an already-signed case, the original `signoff` block stays **byte-intact** with
its 2026-07-26 scope and the case gains an `amendment` block stating the exact change, the ruling
that mandated it, the amendment date, and the status
`amended-awaiting-captain-countersignature`. Amended bytes are NOT captain-signed until the captain
countersigns them; a countersignature is routed as its own decision, never inferred.

The signed scope itself is recorded OUTSIDE the signed bytes, in
[`fixtures/golden-signed-scope.json`](../fixtures/golden-signed-scope.json): caseId to the content
hash the captain signed (the case with its `signoff` and `amendment` blocks removed, keys deep-sorted).
`pnpm golden:validate` and the `golden-cases` fence check both directions - content that still matches
its signed scope may not claim an amendment, and content that does NOT match must carry a complete,
self-consistent one whose `signedContentHash` matches the ledger and whose `amendedContentHash`
matches the current bytes. A signed-status claim over amended bytes with no amendment block fails
the build.

**Currently amended and awaiting countersignature (2026-08-05):** all cases except
GC-08-ambiguous-household, for the review-12 canonical-account ruling
(`subject:smiths-joint-taxable` to `subject:smiths-family-taxable`), plus GC-07's added
`prohibition.precedenceTrace`.

## 2. Expected-outcomes summary (one row per case - the captain signs against this table)

| Case | Spec case | Scenario branch | Firm | Disposition | Authority | Execution | Verification | Signoff |
|---|---|---|---|---|---|---|---|---|
| GC-01-firm-a-happy-path | Firm A happy path | safe-proceed | firm-a | proceed | dual ops approval (2 distinct, requester excluded) | eligible; 1 instruction | submitted | signed (captain, 2026-07-26) |
| GC-02-firm-b-happy-path | Firm B happy path | safe-proceed | firm-b | proceed | automatic (below $100k threshold) | eligible; 1 instruction | submitted | signed (captain, 2026-07-26) |
| GC-03-recent-bank-change-firm-a | recent bank change | recent-bank-change-block | firm-a | proceed | specialist review, then dual ops approval | eligible after both stages | submitted | signed (captain, 2026-07-26) |
| GC-04-recent-bank-change-firm-b | recent bank change | recent-bank-change-block | firm-b | blocked | none (blocked carries no authority) | not eligible | not reached | signed (captain, 2026-07-26) |
| GC-05-insufficient-liquidity | insufficient liquidity | - (single-request variant; see note) | firm-b | blocked | none | not eligible | not reached | signed (captain, 2026-07-26) |
| GC-06-household-restriction | household restriction | permanent-prohibition | firm-a | prohibited | none | not eligible | not reached | signed (captain, 2026-07-26) |
| GC-07-regulatory-prohibition | regulatory or firm prohibition | permanent-prohibition | firm-a | prohibited | none | not eligible | not reached | signed (captain, 2026-07-26) |
| GC-08-ambiguous-household | ambiguous household | ambiguous-instruction | firm-a | blocked | none | not eligible | not reached | signed (captain, 2026-07-26) |
| GC-09-stale-evidence | stale evidence | stale-evidence | firm-a | blocked | none | not eligible | not reached | signed (captain, 2026-07-26) |
| GC-10-simultaneous-distributions-first | two simultaneous distributions | competing-liquidity | firm-a | proceed | dual ops approval | eligible; holds the reservation | submitted | signed (captain, 2026-07-26) |
| GC-11-simultaneous-distributions-second | two simultaneous distributions | competing-liquidity | firm-a | blocked | none | not eligible (sibling reservation) | not reached | signed (captain, 2026-07-26) |
| GC-12-duplicate-retry | duplicate retry | duplicate-retry | firm-a | proceed | dual ops approval | eligible; retries suppressed, exactly 1 instruction | submitted | signed (captain, 2026-07-26) |
| GC-13-partial-salesforce-success | partial Salesforce success | partial-salesforce-success | firm-a | proceed | dual ops approval | eligible; partial receipt → exception | unknown (cannot close) | signed (captain, 2026-07-26) |
| GC-14-delayed-nigo | delayed NIGO | delayed-nigo | firm-b | proceed | automatic | eligible; 1 instruction | nigo (late return → exception) | signed (captain, 2026-07-26) |
| GC-15-approval-invalidation | approval invalidation after evidence change | approval-invalidation | firm-a | proceed | dual ops approval, invalidated, re-run on new hash | eligible after re-approval | submitted | signed (captain, 2026-07-26) |
| GC-16-specialist-review-expiration | specialist-review expiration and escalation | specialist-review-expiration | firm-a | proceed | specialist review expired → escalated; still awaiting | not eligible (authority unresolved) | not reached | signed (captain, 2026-07-26) |

Notes on the two structural choices in the matrix mapping:

- **GC-05** has `scenarioRef: null`: the prompt-2 spec requires a SINGLE-request insufficient-liquidity
  case, while the scenario matrix's `competing-liquidity` is the two-request variant (GC-10/GC-11).
  The matrix stays untouched (its ids are append-only, and adding a branch is a captain-approved
  demo-contract change); the fixture records the reason in `scenarioRefNote`.
- **The prompt-2 twelve** map to 14 fixtures because two spec cases are inherently two-sided:
  "recent bank change" diverges per firm (GC-03/GC-04 - the same facts, config-only divergence),
  and "two simultaneous distributions" has a winner and a loser (GC-10/GC-11). GC-15 and GC-16
  extend coverage to the remaining demo-contract §5 branches so every scenarios.yaml branch has an
  expected-outcome home.

## 3. Scenario-branch coverage (scenarios.yaml → cases)

| scenarios.yaml branch | Covered by |
|---|---|
| safe-proceed | GC-01, GC-02 |
| recent-bank-change-block | GC-03 (firm-a arm), GC-04 (firm-b arm) |
| permanent-prohibition | GC-06 (household source), GC-07 (regulatory source) |
| stale-evidence | GC-09 |
| ambiguous-instruction | GC-08 |
| dual-approval | exercised by GC-01, GC-03, GC-10, GC-12, GC-13, GC-15 (Firm A stage structure at $75k) |
| approval-invalidation | GC-15 |
| competing-liquidity | GC-10, GC-11 |
| duplicate-retry | GC-12 |
| partial-salesforce-success | GC-13 |
| delayed-nigo | GC-14 |
| specialist-review-expiration | GC-16 |

## 4. Firm configurations (shared by every case; from the demo contract §2 via scenarios.yaml)

| | firm-a | firm-b |
|---|---|---|
| Cash reserve (months of planned withdrawals) | 6 | 12 |
| Dual-approval threshold | $25,000 | $100,000 |
| Approvals required above threshold | 2, distinct actors | 2, distinct actors |
| Eligible approver role | operations | not specified by the contract (null) |
| Requester constraint | may not satisfy both approvals | not specified by the contract (null) |
| Recent bank-instruction change | specialist review | block until independently verified |

Contract silences (Firm B's role and requester rule) stay null in every fixture - silence is
recorded, never filled in.

### Canonical Smiths taxable-account identities

The signed liquidity source is `subject:smiths-family-taxable`, displayed as **Smith Family
Taxable**. Its normal-case balance is $420,000. The distinct account
`subject:smiths-joint-taxable`, displayed as **Joint Taxable**, remains a separate $95,000
workspace account and is never an alias for the signed liquidity source (D-074).

## 5. Required fields per case (the validation contract)

Every case - in this document and in its fixture - states all of:

1. **trigger** - kind (`human_request`/`system_event`), description, requester role, masked-request
   summary, `asOf`;
2. **firm configuration** - the full §4 parameter set for the case's firm;
3. **household evidence** - each item: evidenceKind, subjectRef, observedAt, retrievedAt, freshness
   (`fresh`/`stale`/`unknown`), source, provenance label, summary;
4. **policy versions** - domain config, firm policy, household-instruction version ids (empty only
   with a recorded `householdInstructionsNote`, e.g. GC-08), regulatory version (or null);
5. **household instructions** - kind, version id, summary (same recorded-silence escape);
6. **expected disposition** - `proceed`/`blocked`/`prohibited`;
7. **expected authority stages** - mode (`automatic`/`approval`/`specialist_review`, or `none` for
   non-proceed dispositions), full stage definitions (roles, quorum, distinctness, requester rule,
   expiry, escalation);
8. **expected execution eligibility** - eligible flag, reason, idempotency key, reservations,
   preconditions;
9. **expected explanation nodes** - code + summary each;
10. **expected ledger events** - ordered `LedgerEntry` types (v3 core contracts) with notes;
11. **expected verification state** - reached flag, observed status (execution-plane state
    vocabulary), the settled-claim rule, note;
12. **signoff** - §1.

Structural consistency is validated, not assumed: a blocked or prohibited case cannot carry
authority stages, execution eligibility, or a reached verification state (v3 invariants 8/9); a
proceed case must state a real authority mode; the partial-Salesforce case must carry the deferral
marking; every case id here must exist as a fixture and vice versa.

## 6. The cases

Amounts, balances, and dates below are synthetic fixture values (provenance `synthetic-fixture`,
charter #3); the household is the Smiths shape required by the demo contract §2. All timestamps are
demo-world values in America/New_York. Shared numbers: planned withdrawals $8,000/month, so the
Firm A reserve is $48,000 and the Firm B reserve is $96,000.

### GC-01-firm-a-happy-path - Firm A happy path

- **Trigger:** advisor enters "The Smiths need $75,000 for their home renovation by August 15."
- **Firm configuration:** firm-a (§4).
- **Household evidence:** taxable balance $420,000 (fresh); IRA $610,000 (fresh; taxable-event
  source, rejected); planned withdrawals $8,000/mo (fresh); bank instruction unchanged since
  2025-11-01, verified (fresh); destination restriction satisfied (fresh).
- **Policy versions:** money-movement@2026.07.0; firm-a-policy@2026.07.1;
  smiths-destination-restriction@v2 + smiths-liquidity-preference@v1; no regulatory version.
- **Household instructions:** destination restriction (household-titled only); liquidity preference
  (taxable before retirement).
- **Expected disposition:** proceed.
- **Expected authority stages:** one stage `ops-dual-approval` - operations role, 2 approvals,
  distinct actors, requester may not approve, P3D expiry, P1D escalation to operations-manager.
- **Expected execution eligibility:** eligible; stable idempotency key; liquidity reservation on
  `conflict:smiths-liquidity`; evidence-fresh-at-execution and hash-bound-approval preconditions.
- **Expected explanation nodes:** source-account-selected; cash-reserve-preserved;
  dual-approval-required.
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ReservationCreated →
  ApprovalRecorded ×2 → ExecutionStarted → ExecutionSucceeded → StatusObserved.
- **Expected verification state:** reached; `submitted` - and submitted is not presented as settled.
- **Signoff:** signed (captain, 2026-07-26).

### GC-02-firm-b-happy-path - Firm B happy path

- **Trigger:** the identical $75,000 request under Firm B.
- **Firm configuration:** firm-b (§4).
- **Household evidence:** taxable balance $420,000 (fresh) - covers the movement plus the $96,000
  twelve-month reserve; planned withdrawals, verified bank instruction, satisfied destination
  restriction (all fresh).
- **Policy versions:** money-movement@2026.07.0; firm-b-policy@2026.07.1; same household versions.
- **Household instructions:** as GC-01.
- **Expected disposition:** proceed.
- **Expected authority stages:** none required - mode `automatic`: $75,000 is below Firm B's
  $100,000 threshold. (Flagged in the signoff note: the contract is silent on Firm B sub-threshold
  authority; the captain confirms or replaces `automatic`.)
- **Expected execution eligibility:** eligible; own idempotency key and reservation.
- **Expected explanation nodes:** source-account-selected; cash-reserve-preserved (twelve-month);
  dual-approval-not-required (policy changed, not a prompt).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ReservationCreated →
  ExecutionStarted → ExecutionSucceeded → StatusObserved.
- **Expected verification state:** reached; `submitted`.
- **Signoff:** signed (captain, 2026-07-26).

### GC-03-recent-bank-change-firm-a - recent bank change (Firm A arm)

- **Trigger:** the $75,000 request; the destination bank instruction changed 2026-07-22 (four days
  before asOf), unverified.
- **Firm configuration:** firm-a (§4) - recent bank change routes to specialist review.
- **Household evidence:** changed bank instruction (fresh snapshot OF the change); balance $420,000;
  reserve satisfied.
- **Policy versions / household instructions:** as GC-01 (destination restriction still satisfied -
  the changed instruction remains household-titled).
- **Expected disposition:** proceed.
- **Expected authority stages:** stage 1 `bank-change-specialist-review` (bank-change-specialist, 1
  approval, P2D expiry, P1D escalation to operations-manager), then stage 2 `ops-dual-approval`
  (as GC-01).
- **Expected execution eligibility:** eligible only after both stages; precondition
  bank-instruction-independently-verified must still hold at execution.
- **Expected explanation nodes:** recent-bank-change-detected; specialist-review-required;
  dual-approval-required.
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ApprovalRecorded
  (specialist) → ApprovalRecorded ×2 (ops) → ReservationCreated → ExecutionStarted →
  ExecutionSucceeded → StatusObserved.
- **Expected verification state:** reached; `submitted`.
- **Signoff:** signed (captain, 2026-07-26).

### GC-04-recent-bank-change-firm-b - recent bank change (Firm B arm)

- **Trigger:** identical facts to GC-03 under Firm B.
- **Firm configuration:** firm-b (§4) - recent bank change blocks until independently verified.
- **Household evidence:** the same changed, unverified bank instruction; liquidity sufficient.
- **Policy versions / household instructions:** firm-b-policy@2026.07.1; destination restriction.
- **Expected disposition:** **blocked** - the same facts that proceed (with review) under Firm A.
- **Expected authority stages:** none - a blocked decision carries no authority (v3 invariant 8).
- **Expected execution eligibility:** not eligible; blocker `bank-instruction-change-unverified`
  with resolving evidence: an independent verification of the instruction.
- **Expected explanation nodes:** recent-bank-change-detected; firm-b-blocks-until-verified (the
  resolving affordance is shown).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded (blocked).
- **Expected verification state:** not reached.
- **Signoff:** signed (captain, 2026-07-26).

### GC-05-insufficient-liquidity - insufficient liquidity

- **Trigger:** the $75,000 request under Firm B; effective liquidity cannot fund it and preserve
  twelve months of withdrawals.
- **Firm configuration:** firm-b (§4).
- **Household evidence:** taxable balance $160,000; pending approved distribution $20,000 (effective
  liquidity $140,000); planned withdrawals $8,000/mo → $96,000 reserve. $140,000 − $75,000 =
  $65,000 < $96,000.
- **Policy versions / household instructions:** firm-b-policy@2026.07.1; destination restriction and
  liquidity preference both satisfied - liquidity is the failing constraint.
- **Expected disposition:** blocked (resolvable: funds can arrive, pending activity can settle, a
  smaller request is a new intent).
- **Expected authority stages:** none.
- **Expected execution eligibility:** not eligible; blocker `cash-reserve-breach` with resolving
  evidence: fresh balance or settled pending actions.
- **Expected explanation nodes:** effective-liquidity-computed (pending activity counts);
  cash-reserve-breach (arithmetic shown); firm-divergence-noted (the same facts proceed under
  Firm A's $48,000 reserve - config-only divergence).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded (blocked).
- **Expected verification state:** not reached.
- **Signoff:** signed (captain, 2026-07-26).

### GC-06-household-restriction - household restriction

- **Trigger:** advisor requests $30,000 to the contractor's business account (third-party
  destination) for the renovation deposit.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** liquidity sufficient; requested destination not household-titled; standing
  destination restriction in force.
- **Policy versions / household instructions:** smiths-destination-restriction@v2 - the violated
  instruction IS the prohibition source.
- **Expected disposition:** **prohibited** - the stamp, zero affordances; no approval can waive a
  standing client mandate (v3 invariant 9).
- **Expected authority stages:** none.
- **Expected execution eligibility:** not eligible; prohibition source household_instruction,
  reason `destination-not-household-titled`.
- **Expected explanation nodes:** destination-restriction-applies (with precedence);
  destination-off-list (exact instruction + version cited).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded (prohibited).
- **Expected verification state:** not reached; an on-list request later is a NEW intent.
- **Signoff:** signed (captain, 2026-07-26).

### GC-07-regulatory-prohibition - regulatory or firm prohibition

- **Trigger:** the $75,000 request; the source account carries an active legal hold (recorded
  2026-07-18).
- **Firm configuration:** firm-a (§4).
- **Household evidence:** balance sufficient; account-restriction evidence shows the active hold.
- **Policy versions:** adds regulatory version reg-distribution-holds@2026.02; household destination
  restriction satisfied (NOT the source here).
- **Expected disposition:** prohibited - regulatory precedence outranks firm policy and household
  instructions; the precedence trace shows it.
- **Expected authority stages:** none.
- **Expected execution eligibility:** not eligible; prohibition source regulatory, reason
  `active-legal-hold`.
- **Expected explanation nodes:** legal-hold-detected; regulatory-precedence-applied. The ordered
  precedence projection records `left_wins` from the regulatory source first over the firm-policy
  source and then over the household-instruction source, with source ids, version ids, and reason
  codes preserved exactly.
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded (prohibited).
- **Expected verification state:** not reached; a released hold arrives as new evidence for a new
  intent.
- **Signoff:** signed (captain, 2026-07-26).

### GC-08-ambiguous-household - ambiguous household

- **Trigger:** "The Smiths need $75,000..." - but the advisor's book contains TWO Smith households
  (Robert & Ana Smith; the Smith Family Trust). The canonical multiple-Smiths ambiguity.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** the household-directory snapshot listing both candidate refs - the
  ambiguity itself is recorded evidence.
- **Policy versions / household instructions:** firm policy pinned; household-instruction versions
  deliberately EMPTY with a recorded note - no instruction can bind before the household does
  (silence is recorded, never filled in).
- **Expected disposition:** blocked - Verin never guesses between candidates.
- **Expected authority stages:** none (disambiguation is recorded evidence, not an approval).
- **Expected execution eligibility:** not eligible; blocker `household-slot-ambiguous` with
  resolving evidence: the advisor's structured disambiguation answer.
- **Expected explanation nodes:** household-candidates-found (both shown with context);
  human-disambiguation-required (the question IS the affordance; the answer is attributed evidence).
- **Expected ledger events:** EvidenceSnapshotRecorded (the two-candidate directory snapshot) →
  DecisionRecorded (blocked, carrying the structured human question).
- **Expected verification state:** not reached; the recorded answer re-runs evaluation with the
  household bound.
- **Signoff:** signed (captain, 2026-07-26).

### GC-09-stale-evidence - stale evidence

- **Trigger:** the $75,000 request; the planned-withdrawal schedule was last observed 47 days ago
  (2026-06-09) and the reserve computation depends on it.
- **Firm configuration:** firm-a (§4); policy freshness window for reserve-material evidence: 30
  days (draft archetype, flagged for signoff).
- **Household evidence:** balance fresh; planned withdrawals **stale** - observed vs retrieved
  shown separately, stale badge on the surface.
- **Policy versions / household instructions:** as GC-01.
- **Expected disposition:** blocked - present-but-stale evidence cannot silently proceed
  (v3 invariant 11; validate is distinct from evaluate).
- **Expected authority stages:** none.
- **Expected execution eligibility:** not eligible; blocker `reserve-evidence-stale` with resolving
  evidence: a fresh planned-withdrawal snapshot.
- **Expected explanation nodes:** freshness-window-exceeded (no unexplained confidence score);
  stale-cannot-silently-proceed (refresh, not override).
- **Expected ledger events:** EvidenceSnapshotRecorded (freshness `stale` - staleness is
  provenance) → DecisionRecorded (blocked).
- **Expected verification state:** not reached; a fresh snapshot re-runs evaluation on a NEW bundle,
  never patching the stale one.
- **Signoff:** signed (captain, 2026-07-26).

### GC-10-simultaneous-distributions-first - two simultaneous distributions (winner)

- **Trigger:** advisor A's $75,000 renovation request; advisor B's $75,000 request (GC-11) arrives
  simultaneously. Balance $160,000: either alone preserves the $48,000 reserve, both together
  cannot (the v3 prompt-23 reference failure).
- **Firm configuration:** firm-a (§4).
- **Household evidence:** balance $160,000; planned withdrawals; no sibling reservation visible at
  THIS request's commit instant - it commits first.
- **Policy versions / household instructions:** as GC-01.
- **Expected disposition:** proceed.
- **Expected authority stages:** `ops-dual-approval` as GC-01.
- **Expected execution eligibility:** eligible - holds reservation `res:GC-10:liquidity` on
  `conflict:smiths-liquidity`; ordering is decided by decision commit order, deterministically.
- **Expected explanation nodes:** individually-valid; reservation-acquired.
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ReservationCreated →
  ApprovalRecorded ×2 → ExecutionStarted → ExecutionSucceeded → StatusObserved.
- **Expected verification state:** reached; `submitted`; the reservation is released on
  VerificationClosed or expiry.
- **Signoff:** signed (captain, 2026-07-26).

### GC-11-simultaneous-distributions-second - two simultaneous distributions (loser)

- **Trigger:** advisor B's $75,000 beach-house-closing request, moments after GC-10's reservation
  committed.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** raw balance still $160,000 (the sibling has not settled) - but the active
  sibling reservation is visible pending activity, so effective liquidity is $85,000.
- **Policy versions / household instructions:** as GC-01.
- **Expected disposition:** **blocked at decision time** - $85,000 − $75,000 = $10,000 < $48,000;
  the joint violation is prevented before any authority is requested.
- **Expected authority stages:** none.
- **Expected execution eligibility:** not eligible; blocker `liquidity-reserved-by-sibling` with
  resolving evidence: reservation release or new funds.
- **Expected explanation nodes:** individually-valid-jointly-overcommitted (arithmetic + sibling
  reservation cited); reservation-prevents-joint-violation (both resolution paths shown).
- **Expected ledger events:** EvidenceSnapshotRecorded (sibling reservation in the recorded basis)
  → DecisionRecorded (blocked; no second reservation).
- **Expected verification state:** not reached; two concurrent valid requests can never jointly
  violate liquidity policy (demo-contract §8).
- **Signoff:** signed (captain, 2026-07-26).

### GC-12-duplicate-retry - duplicate retry

- **Trigger:** the $75,000 request; after approval, a double-click on Execute plus one automatic
  transport-timeout retry - three attempts total.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** balance $420,000; reserve satisfied - execution integrity is the subject.
- **Policy versions / household instructions:** as GC-01 (destination restriction only).
- **Expected disposition:** proceed.
- **Expected authority stages:** `ops-dual-approval` as GC-01.
- **Expected execution eligibility:** eligible; the idempotency key derives from the decision, NOT
  the click, so all three attempts carry the same key.
- **Expected explanation nodes:** stable-idempotency-key; duplicate-suppressed (one external
  instruction; retries annotated against it, original handle returned).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ReservationCreated →
  ApprovalRecorded ×2 → ExecutionStarted (exactly one - duplicates absorbed, never re-recorded) →
  ExecutionSucceeded → StatusObserved (once).
- **Expected verification state:** reached; `submitted`; provable against the fake adapter now,
  re-proven against the real sandbox when the trigger fires.
- **Signoff:** signed (captain, 2026-07-26).

### GC-13-partial-salesforce-success - partial Salesforce success `[deferred-pending-sandbox]`

- **Trigger:** the $75,000 request; the external capability accepts the instruction record but
  fails to schedule the disbursement leg.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** clean evaluation (balance/reserve fine) - the partial outcome is an
  execution-plane event.
- **Policy versions / household instructions:** as GC-12.
- **Expected disposition:** proceed.
- **Expected authority stages:** `ops-dual-approval` as GC-01.
- **Expected execution eligibility:** eligible (execution legitimately started; the partial outcome
  is discovered from the receipt, not predicted); reservation NOT released while parts remain
  incomplete.
- **Expected explanation nodes:** partial-outcome-recorded (completed `instruction-created`,
  incomplete `disbursement-scheduled`, exact sourceStatus - nothing rounded up to success);
  exception-requires-judgment (derived decision, never a silent retry - v3 invariant 24).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ReservationCreated →
  ApprovalRecorded ×2 → ExecutionStarted → **ExecutionPartiallySucceeded** → StatusObserved
  (Unknown; raw sourceStatus preserved) → **ExceptionDecisionRequested**.
- **Expected verification state:** reached; `unknown` - verification cannot close; the completed
  part is proven, the incomplete part is not, and the surface says exactly that.
- **Deferral:** the whole case is specified against the in-memory fake ExecutionTarget/StatusSource
  and marked `deferred-pending-sandbox` (captain's standing Salesforce directive); it is re-proven
  against the real managed package when sandbox access is granted, including the real part taxonomy
  (prompt-27 archaeology may refine the part names, under a new captain signoff).
- **Signoff:** signed (captain, 2026-07-26).

### GC-14-delayed-nigo - delayed NIGO

- **Trigger:** the $75,000 request under Firm B submits cleanly; two business days later the
  custodian returns it NIGO (signature date predates the form version).
- **Firm configuration:** firm-b (§4).
- **Household evidence:** clean evaluation; verified destination - the NIGO is about paperwork.
- **Policy versions / household instructions:** firm-b-policy@2026.07.1; destination restriction.
- **Expected disposition:** proceed (authority automatic, as GC-02).
- **Expected authority stages:** none required - mode `automatic`.
- **Expected execution eligibility:** eligible; the NIGO is a later external fact.
- **Expected explanation nodes:** submitted-not-settled-vindicated (the product never claimed
  settlement, so the late NIGO contradicts nothing); delayed-nigo-ingested (exact custodian reason
  preserved; remediation via derived exception decision).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ReservationCreated →
  ExecutionStarted → ExecutionSucceeded → StatusObserved (Submitted) → StatusObserved (NIGO,
  ingested late) → ExceptionDecisionRequested (resubmit-with-corrected-paperwork vs cancel).
- **Expected verification state:** reached; `nigo` - the original decision is never retroactively
  reopened; the NIGO is a new observed fact.
- **Signoff:** signed (captain, 2026-07-26).

### GC-15-approval-invalidation - approval invalidation after evidence change

- **Trigger:** the $75,000 request; both approvals land; before execution a NEW $15,000 pending
  distribution posts, changing the liquidity basis the approvals were bound to.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** balance $300,000; no pending activity at first evaluation; the $15,000
  pending distribution appears at revalidation (reserve still satisfied on both bases - the
  invalidation fires on material CHANGE, not on breach).
- **Policy versions / household instructions:** as GC-01.
- **Expected disposition:** proceed (through invalidation and re-approval).
- **Expected authority stages:** `ops-dual-approval`, run TWICE end to end: once against the
  original decision hash, and - after invalidation - again in full against the derived decision's
  new hash. Approvals bind to a hash, never to a request; prior approvals never carry over.
- **Expected execution eligibility:** eligible only after the second pass; precondition: the
  input-bundle hash is unchanged since (re-)approval.
- **Expected explanation nodes:** material-change-detected; approval-bound-to-hash (v3 invariant
  19); re-approval-on-new-bundle.
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ApprovalRecorded ×2 →
  EvidenceSnapshotRecorded (the new pending activity) → **ApprovalInvalidated** (prior hash + new
  bundle hash) → DecisionRecorded (derived) → ApprovalRecorded ×2 (new hash) → ReservationCreated →
  ExecutionStarted → ExecutionSucceeded → StatusObserved.
- **Expected verification state:** reached; `submitted`.
- **Decision fixed here (per the scenario matrix's explicit deferral to prompt 2), subject to
  captain signoff:** after invalidation, re-evaluate on the new bundle; still-proceed re-runs the
  SAME stages against the NEW hash; no-longer-proceed becomes whatever decision the new facts
  dictate.
- **Signoff:** signed (captain, 2026-07-26).

### GC-16-specialist-review-expiration - specialist-review expiration and escalation

- **Trigger:** the GC-03 situation (recent bank change, Firm A), but the bank-change specialist
  takes no action for two days; the review stage expires and escalates.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** the changed, unverified bank instruction; liquidity satisfied.
- **Policy versions / household instructions:** as GC-03.
- **Expected disposition:** proceed (authority remains unresolved - the branch ends still awaiting).
- **Expected authority stages:** as GC-03; the subject is the time dimension - the P2D expiry
  lapses, the P1D escalation widens eligibility to operations-manager, stage 2 never arms.
- **Expected execution eligibility:** **not eligible** - expiration never auto-approves and never
  silently cancels.
- **Expected explanation nodes:** specialist-review-required; stage-expired-escalated (lapse and
  escalation shown as recorded facts).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ApprovalInvalidated
  (the lapsed stage closes with reason approval-expired and re-arms for the escalation roles) →
  ExceptionDecisionRequested (attention decision for the operations manager - the stall never
  disappears into a queue).
- **Expected verification state:** not reached while authority is unresolved.
- **Signoff:** signed (captain, 2026-07-26).

## 7. Salesforce deferral posture

Per the captain's standing directive (recorded in the demo contract and scenarios.yaml `deferral`):
every external execution/status expectation in these cases is specified against the in-memory fake
`ExecutionTarget`/`StatusSource` adapters, whose responses carry the `fake-adapter-response`
provenance label. GC-13 additionally carries the case-level `deferred-pending-sandbox` marking -
its distinctive expectation (the real managed package's partial-success behavior) cannot be proven
before the sandbox trigger fires. No golden case is "passed" as real on fake responses; realness
labels flip only when prompt 27 lands against the real sandbox.

## 8. Validation

- `pnpm golden:validate` - runs [`scripts/golden-cases-validate.ts`](../scripts/golden-cases-validate.ts)
  (CI job `golden-cases`, blocking): every required §5 field present and populated in every fixture,
  vocabulary aligned with scenarios.yaml, structural consistency (§5) enforced, doc/fixture ids in
  sync, all twelve spec-required case names covered, at least twelve cases, every signoff in one of
  the two legal §1 shapes (all signed by the captain, 2026-07-26).
- The `golden-cases` fitness fence (`src/__tests__/fitness/golden-cases.test.ts`) runs the same
  validator inside `pnpm test` and ships the adversarial companion proving a broken or prematurely
  signed case CANNOT pass (charter #4: detection is not verification).
