# Verin - Golden-Case Specification (v3 build-sequence prompt 2)

**Status:** Signed truth set - **all 16 cases signed by the captain on 2026-07-26; 15 cases
reapproved on 2026-07-28** for explicit evidence completeness and canonical UTC instants (approval
relayed via firstmate). GC-03 remains the exact 2026-07-26 signed artifact. Its later authority gap
is recorded as awaiting captain signature and execution is withheld. Expected results are product
truth subject to human signoff, not agent invention (build-sequence prompt 2; the signoff authority
for every case is the captain).
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
  other status, fails the build. The captain signed all 16 cases on 2026-07-26 and reapproved the
  evidence-completeness amendment for 15 cases on 2026-07-28. GC-03 was not reapproved and remains
  bound to its original signed bytes.
- Signing happens per case. A signed case's expected outcomes become binding product truth; changing
  them afterwards requires a new captain decision recorded in the PR.
- Where a draft had to FIX an answer the demo contract deliberately left open, the case's signoff
  note flags it explicitly (GC-02: Firm B sub-threshold authority; GC-15: post-invalidation
  re-approval rule; GC-13: partial-part taxonomy).

## 2. Expected-outcomes summary (one row per case - the captain signs against this table)

| Case | Spec case | Scenario branch | Firm | Disposition | Authority | Execution | Verification | Signoff |
|---|---|---|---|---|---|---|---|---|
| GC-01-firm-a-happy-path | Firm A happy path | safe-proceed | firm-a | proceed | dual ops approval (2 distinct, requester excluded) | eligible; 1 instruction | submitted | signed (captain, 2026-07-28) |
| GC-02-firm-b-happy-path | Firm B happy path | safe-proceed | firm-b | proceed | automatic (below $100k threshold) | eligible; 1 instruction | submitted | signed (captain, 2026-07-28) |
| GC-03-recent-bank-change-firm-a | recent bank change | recent-bank-change-block | firm-a | proceed | specialist review, then dual ops approval | signed outcome: eligible after both stages; demo withheld pending signed post-review evidence | signed outcome: submitted; demo not reached while evidence is absent | signed (captain, 2026-07-26) |
| GC-04-recent-bank-change-firm-b | recent bank change | recent-bank-change-block | firm-b | blocked | none (blocked carries no authority) | not eligible | not reached | signed (captain, 2026-07-28) |
| GC-05-insufficient-liquidity | insufficient liquidity | - (single-request variant; see note) | firm-b | blocked | none | not eligible | not reached | signed (captain, 2026-07-28) |
| GC-06-household-restriction | household restriction | permanent-prohibition | firm-a | prohibited | none | not eligible | not reached | signed (captain, 2026-07-28) |
| GC-07-regulatory-prohibition | regulatory or firm prohibition | permanent-prohibition | firm-a | prohibited | none | not eligible | not reached | signed (captain, 2026-07-28) |
| GC-08-ambiguous-household | ambiguous household | ambiguous-instruction | firm-a | blocked | none | not eligible | not reached | signed (captain, 2026-07-28) |
| GC-09-stale-evidence | stale evidence | stale-evidence | firm-a | blocked | none | not eligible | not reached | signed (captain, 2026-07-28) |
| GC-10-simultaneous-distributions-first | two simultaneous distributions | competing-liquidity | firm-a | proceed | dual ops approval | eligible; holds the reservation | submitted | signed (captain, 2026-07-28) |
| GC-11-simultaneous-distributions-second | two simultaneous distributions | competing-liquidity | firm-a | blocked | none | not eligible (sibling reservation) | not reached | signed (captain, 2026-07-28) |
| GC-12-duplicate-retry | duplicate retry | duplicate-retry | firm-a | proceed | dual ops approval | eligible; retries suppressed, exactly 1 instruction | submitted | signed (captain, 2026-07-28) |
| GC-13-partial-salesforce-success | partial Salesforce success | partial-salesforce-success | firm-a | proceed | dual ops approval | eligible; partial receipt → exception | unknown (cannot close) | signed (captain, 2026-07-28) |
| GC-14-delayed-nigo | delayed NIGO | delayed-nigo | firm-b | proceed | automatic | eligible; 1 instruction | nigo (late return → exception) | signed (captain, 2026-07-28) |
| GC-15-approval-invalidation | approval invalidation after evidence change | approval-invalidation | firm-a | proceed | dual ops approval, invalidated, re-run on new hash | eligible after re-approval | submitted | signed (captain, 2026-07-28) |
| GC-16-specialist-review-expiration | specialist-review expiration and escalation | specialist-review-expiration | firm-a | proceed | specialist review escalated → expired unresolved | not eligible (authority unresolved) | not reached | signed (captain, 2026-07-28) |

GC-03's signed disposition, authority, execution eligibility, chronology, and verification outcome
remain unchanged. The live demo cannot claim that outcome has been established because the signed
artifact has no post-review bank-instruction evidence and does not carry the later completeness,
structured-money, event-binding, chronology, or verification-detail authorities. The SHA-256-pinned
gap in [`config/demo/golden-authority-gaps.json`](../config/demo/golden-authority-gaps.json) records
that absence without changing or re-signing the fixture. Execution remains withheld pending captain
signature.

Notes on the two structural choices in the matrix mapping:

- **GC-05** has `scenarioRef: null`: the prompt-2 spec requires a SINGLE-request insufficient-liquidity
  case, while the scenario matrix's `competing-liquidity` is the two-request variant (GC-10/GC-11).
  The matrix stays untouched (its ids are append-only, and adding a branch is a captain-approved
  demo-contract change); the fixture records the reason in `scenarioRefNote`.
- **The `competing-liquidity` branch is firm-split** in the matrix (D-100). Both signed cases are
  firm-a and run on a $160,000 pool: either $75,000 request alone clears Firm A's $48,000 six-month
  reserve, both together do not. Under Firm B's $96,000 twelve-month reserve the SAME single request
  is recorded as blocked before a live reservation matters. No signed numeric case binds that
  firm-b arm to this branch, so the demo states the missing authority instead of borrowing GC-05.
  GC-05 is a separate single-request case: $160,000 available minus $20,000 pending leaves
  $140,000 effective liquidity, and the $75,000 request leaves $65,000, below the $96,000 reserve.
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
| competing-liquidity | GC-10, GC-11 (firm-a arms); firm-b outcome recorded in the matrix with numeric authority explicitly missing |
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

## 5. Required fields per case (the validation contract)

The 2026-07-28 validation contract requires every case to state all of:

1. **trigger** - kind (`human_request`/`system_event`), description, requester role, masked-request
   summary, `asOf`;
2. **firm configuration** - the full §4 parameter set for the case's firm;
3. **household evidence** - each item: evidenceKind, subjectRef, canonical UTC observedAt and
   retrievedAt, freshness (`fresh`/`stale`/`unknown`), source, provenance label, summary, and
   `observedAbsent: true` when an explicit absence is the fact. A row that displays money carries
   its own structured `displayValue` with value and `USD` or `USD/month` unit; a material-age rule
   carries its structured `freshnessWindowDays`;
4. **evidence completeness** - one explicit matrix row per fact required to compute or validate the
   expected result, naming the evidence source and whether it is present or observed absent.
   Proceed cases record request amount, source balance, planned-withdrawal schedule, pending
   liquidity activity, destination bank instruction, and destination restriction. Blocked and
   prohibited cases record the decisive evidence for their signed trigger, including the changed
   bank instruction, reserve breach, household restriction, legal hold, household ambiguity, or
   stale snapshot that determines the result. Silence is never inferred as benign;
5. **policy versions** - domain config, firm policy, household-instruction version ids (empty only
   with a recorded `householdInstructionsNote`, e.g. GC-08), regulatory version (or null);
6. **household instructions** - kind, version id, summary (same recorded-silence escape);
7. **expected disposition** - `proceed`/`blocked`/`prohibited`;
8. **expected authority stages** - mode (`automatic`/`approval`/`specialist_review`, or `none` for
   non-proceed dispositions), full stage definitions (roles, quorum, distinctness, requester rule,
   expiry, escalation);
9. **expected execution eligibility** - eligible flag, reason, idempotency key, reservations,
   preconditions;
10. **expected explanation nodes** - code + summary each;
11. **expected ledger events** - ordered event types with notes, drawn from the ratified v3
    `LedgerEntry` union PLUS the two authority-lapse events (`ApprovalStageEscalated`,
    `ApprovalStageExpired`) the union does not yet declare. That extension is authorized and
    trigger-bound by [ADR-0040](./adr/0040-authority-lapse-ledger-events.md); the validator fences
    the transcribed union against the pinned reference and fails when prompt 7 lands either event,
    so the extension collapses instead of shadowing the canonical member;
12. **expected verification state** - a closed state carrying reached flag, observed status
    (execution-plane state vocabulary), settled-claim rule, observation instant, current and
    custodian reasons, proven and not-yet-proven claims, polling state, typed exception state, and
    note. Unsupported combinations fail instead of being repaired from scenario flags or prose;
13. **signoff** - §1;
14. **signed money** - `signedMoney`: currency, cadence, the request amount, the monthly planned
    withdrawal, the reserve floor, the available liquidity, and the pending liquidity activity
    counted against it, as STRUCTURED
    whole-dollar fields. These fields ARE the signed numbers - the prose summaries restate them,
    never the reverse. The validator derives the floor through the shared money arithmetic
    (`src/contracts/money-movement.ts`) and requires each figure to still appear in the case's own
    trigger / planned-withdrawals / account-balance / pending-actions summaries, so structure and
    prose can neither diverge nor be regexed apart. `preExecutionRevalidation`, when present,
    records a second available/pending snapshot whose evidence rows carry
    `liquidityPhase: pre-execution-revalidation`; initial rows carry `initial-decision`. Four rules
    make the derivation total rather
    than opt-in:
    - a case that states a reserve floor WITHOUT restating the schedule derives it from the
      household's canonical signed schedule (the one value the schedule-stating cases agree on);
      if no case anywhere states a schedule, the validator fails with a missing-authority
      diagnostic instead of skipping the arithmetic;
    - `pendingLiquidityUsd: 0` is the observed-absent reading and is REQUIRED wherever a
      pending-actions snapshot records `observedAbsent: true`; stating available liquidity without
      stating the pending activity beside it is rejected (silence is recorded, never inferred);
    - a `proceed` case must actually leave the request covered: available - pending - reserve floor
      must be at least the request amount;
    - every `proceed` case must state all five numeric authorities itself. Missing request,
      schedule, floor, available liquidity, or pending activity fails with a named
      missing-authority diagnostic, and every revalidation snapshot must independently cover the
      request. Every structured signed amount that appears as evidence must bind to that row's own
      `displayValue`; one case-wide liquidity figure cannot replace another account's value.

Structural consistency is validated, not assumed: a blocked or prohibited case cannot carry
authority stages, execution eligibility, or a reached verification state (v3 invariants 8/9); a
proceed case must state a real authority mode; the partial-Salesforce case must carry the deferral
marking; every case id here must exist as a fixture and vice versa.

GC-03 is the one immutable 2026-07-26 artifact that does not yet satisfy every later field above.
Its exact fixture hash and each missing authority category are declared in the authority-gap
manifest. The validator accepts only those exact, independently reproduced diagnostics and refuses
execution. A changed fixture hash, an unrecognized or stale gap category, an undeclared diagnostic,
or a gap that does not remain fail-closed fails the build.

## 6. The cases

Amounts, balances, and dates below are synthetic fixture values (provenance `synthetic-fixture`,
charter #3); the household is the Smiths shape required by the demo contract §2. The 15 amended
fixtures use canonical `YYYY-MM-DDTHH:MM:SS.mmmZ` UTC instants. GC-03 retains the offsets in its
immutable signed artifact. Descriptive dates below render in the demo world's America/New_York
zone. Shared numbers outside the GC-03 authority gap are planned withdrawals $8,000/month, so the
Firm A reserve is $48,000 and the Firm B reserve is $96,000.

Every execution-eligible ledger follows one governed sequence: the decision is recorded, required
approvals are recorded, evidence is revalidated immediately before execution, the reservation is
created against the still-current approved and revalidated decision, and only then may execution
start. If revalidation changes material evidence, stale approvals are invalidated, a derived
decision is recorded, and its required approvals are acquired before the reservation.

### GC-01-firm-a-happy-path - Firm A happy path

- **Trigger:** advisor enters "The Smiths need $75,000 for their home renovation by August 15."
- **Firm configuration:** firm-a (§4).
- **Household evidence:** taxable balance $420,000 (fresh); IRA $610,000 (fresh; taxable-event
  source, rejected); planned withdrawals $8,000/mo (fresh); bank instruction unchanged since
  2025-11-01, verified (fresh); destination restriction satisfied (fresh); no pending liquidity
  activity observed.
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
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ApprovalRecorded ×2 →
  EvidenceSnapshotRecorded (pre-execution revalidation) → ReservationCreated → ExecutionStarted →
  ExecutionSucceeded → StatusObserved.
- **Expected verification state:** reached; `submitted` - and submitted is not presented as settled.
- **Signoff:** signed (captain, 2026-07-28).

### GC-02-firm-b-happy-path - Firm B happy path

- **Trigger:** the identical $75,000 request under Firm B.
- **Firm configuration:** firm-b (§4).
- **Household evidence:** taxable balance $420,000 (fresh) - covers the movement plus the $96,000
  twelve-month reserve; planned withdrawals, verified bank instruction, satisfied destination
  restriction, and explicit absence of pending liquidity activity (all fresh).
- **Policy versions:** money-movement@2026.07.0; firm-b-policy@2026.07.1; same household versions.
- **Household instructions:** as GC-01.
- **Expected disposition:** proceed.
- **Expected authority stages:** none required - mode `automatic`: $75,000 is below Firm B's
  $100,000 threshold. (Flagged in the signoff note: the contract is silent on Firm B sub-threshold
  authority; the captain confirms or replaces `automatic`.)
- **Expected execution eligibility:** eligible; own idempotency key and reservation.
- **Expected explanation nodes:** source-account-selected; cash-reserve-preserved (twelve-month);
  dual-approval-not-required (policy changed, not a prompt).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → EvidenceSnapshotRecorded
  (pre-execution revalidation) → ReservationCreated → ExecutionStarted → ExecutionSucceeded →
  StatusObserved.
- **Expected verification state:** reached; `submitted`.
- **Signoff:** signed (captain, 2026-07-28).

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

**Authority gap, not signed case content:** the signed artifact has no post-review bank-instruction
evidence and was not amended or re-signed for the 2026-07-28 completeness contract. The demo states
that signed post-review bank-instruction evidence is absent and withholds execution pending
captain-signed evidence. Its signed expected outcome remains unchanged.

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
- **Signoff:** signed (captain, 2026-07-28).

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
- **Signoff:** signed (captain, 2026-07-28).

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
- **Signoff:** signed (captain, 2026-07-28).

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
- **Expected explanation nodes:** legal-hold-detected; regulatory-precedence-applied.
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded (prohibited).
- **Expected verification state:** not reached; a released hold arrives as new evidence for a new
  intent.
- **Signoff:** signed (captain, 2026-07-28).

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
- **Signoff:** signed (captain, 2026-07-28).

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
- **Signoff:** signed (captain, 2026-07-28).

### GC-10-simultaneous-distributions-first - two simultaneous distributions (winner)

- **Trigger:** advisor A's $75,000 renovation request; advisor B's $75,000 request (GC-11) arrives
  simultaneously. Balance $160,000: either alone preserves the $48,000 reserve, both together
  cannot (the v3 prompt-23 reference failure).
- **Firm configuration:** firm-a (§4).
- **Household evidence:** balance $160,000; planned withdrawals; verified bank instruction;
  destination restriction satisfied; explicit absence of a sibling reservation at this request's
  commit instant - it commits first.
- **Policy versions / household instructions:** as GC-01.
- **Expected disposition:** proceed.
- **Expected authority stages:** `ops-dual-approval` as GC-01.
- **Expected execution eligibility:** eligible - holds reservation `res:GC-10:liquidity` on
  `conflict:smiths-liquidity`; ordering is decided by governed approval and revalidation commit
  order, deterministically.
- **Expected explanation nodes:** individually-valid; reservation-acquired.
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ApprovalRecorded ×2 →
  EvidenceSnapshotRecorded (pre-execution revalidation) → ReservationCreated → ExecutionStarted →
  ExecutionSucceeded → StatusObserved.
- **Expected verification state:** reached; `submitted`; the reservation is released on
  VerificationClosed or expiry.
- **Signoff:** signed (captain, 2026-07-28).

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
- **Signoff:** signed (captain, 2026-07-28).

### GC-12-duplicate-retry - duplicate retry

- **Trigger:** the $75,000 request; after approval, a double-click on Execute plus one automatic
  transport-timeout retry - three attempts total.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** balance $420,000; $8,000 monthly schedule and $48,000 reserve; verified
  bank instruction; destination restriction satisfied; no pending liquidity activity observed.
- **Policy versions / household instructions:** as GC-01 (destination restriction only).
- **Expected disposition:** proceed.
- **Expected authority stages:** `ops-dual-approval` as GC-01.
- **Expected execution eligibility:** eligible; the idempotency key derives from the decision, NOT
  the click, so all three attempts carry the same key.
- **Expected explanation nodes:** stable-idempotency-key; duplicate-suppressed (one external
  instruction; retries annotated against it, original handle returned).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ApprovalRecorded ×2 →
  EvidenceSnapshotRecorded (pre-execution revalidation) → ReservationCreated → ExecutionStarted
  (exactly one - duplicates absorbed, never re-recorded) → ExecutionSucceeded → StatusObserved
  (once).
- **Expected verification state:** reached; `submitted`; provable against the fake adapter now,
  re-proven against the real sandbox when the trigger fires.
- **Signoff:** signed (captain, 2026-07-28).

### GC-13-partial-salesforce-success - partial Salesforce success `[deferred-pending-sandbox]`

- **Trigger:** the $75,000 request; the external capability accepts the instruction record but
  fails to schedule the disbursement leg.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** clean evaluation with $420,000 available taxable liquidity, $8,000 monthly schedule, $48,000 reserve,
  verified bank instruction, satisfied destination restriction, and explicit absence of pending
  liquidity activity. The partial outcome is an execution-plane event.
- **Policy versions / household instructions:** as GC-12.
- **Expected disposition:** proceed.
- **Expected authority stages:** `ops-dual-approval` as GC-01.
- **Expected execution eligibility:** eligible (execution legitimately started; the partial outcome
  is discovered from the receipt, not predicted); reservation NOT released while parts remain
  incomplete.
- **Expected explanation nodes:** partial-outcome-recorded (completed `instruction-created`,
  incomplete `disbursement-scheduled`, exact sourceStatus - nothing rounded up to success);
  exception-requires-judgment (derived decision, never a silent retry - v3 invariant 24).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → ApprovalRecorded ×2 →
  EvidenceSnapshotRecorded (pre-execution revalidation) → ReservationCreated → ExecutionStarted →
  **ExecutionPartiallySucceeded** → StatusObserved (Unknown; raw sourceStatus preserved) →
  **ExceptionDecisionRequested**.
- **Expected verification state:** reached; `unknown` - verification cannot close; the completed
  part is proven, the incomplete part is not, and the surface says exactly that.
- **Deferral:** the whole case is specified against the in-memory fake ExecutionTarget/StatusSource
  and marked `deferred-pending-sandbox` (captain's standing Salesforce directive); it is re-proven
  against the real managed package when sandbox access is granted, including the real part taxonomy
  (prompt-27 archaeology may refine the part names, under a new captain signoff).
- **Signoff:** signed (captain, 2026-07-28).

### GC-14-delayed-nigo - delayed NIGO

- **Trigger:** the $75,000 request under Firm B submits cleanly; two business days later the
  custodian returns it NIGO (signature date predates the form version).
- **Firm configuration:** firm-b (§4).
- **Household evidence:** clean evaluation with balance, $8,000 monthly schedule, $96,000 reserve,
  verified destination, satisfied destination restriction, and no pending liquidity activity
  observed. The NIGO is about paperwork.
- **Policy versions / household instructions:** firm-b-policy@2026.07.1; destination restriction.
- **Expected disposition:** proceed (authority automatic, as GC-02).
- **Expected authority stages:** none required - mode `automatic`.
- **Expected execution eligibility:** eligible; the NIGO is a later external fact.
- **Expected explanation nodes:** submitted-not-settled-vindicated (the product never claimed
  settlement, so the late NIGO contradicts nothing); delayed-nigo-ingested (exact custodian reason
  preserved; remediation via derived exception decision).
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded → EvidenceSnapshotRecorded
  (pre-execution revalidation) → ReservationCreated → ExecutionStarted → ExecutionSucceeded →
  StatusObserved (Submitted) → StatusObserved (NIGO, ingested late) →
  ExceptionDecisionRequested (resubmit-with-corrected-paperwork vs cancel).
- **Expected verification state:** reached; `nigo` - the original decision is never retroactively
  reopened; the NIGO is a new observed fact.
- **Signoff:** signed (captain, 2026-07-28).

### GC-15-approval-invalidation - approval invalidation after evidence change

- **Trigger:** the $75,000 request; both approvals land; before execution a NEW $15,000 pending
  distribution posts, changing the liquidity basis the approvals were bound to.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** balance $300,000; $8,000 monthly schedule and $48,000 reserve; verified
  bank instruction and satisfied destination restriction. The structured initial-decision phase
  records $300,000 available and an observed absence of pending activity. Only the structured
  pre-execution-revalidation phase records the new $15,000 pending distribution and $285,000
  effective liquidity (reserve still satisfied on both bases - the invalidation fires on material
  CHANGE, not on breach).
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
- **Signoff:** signed (captain, 2026-07-28).

### GC-16-specialist-review-expiration - specialist-review expiration and escalation

- **Trigger:** the GC-03 situation (recent bank change, Firm A), but the bank-change specialist
  takes no action. The P1D escalation fires first; unresolved escalated authority later reaches its
  projected deadline.
- **Firm configuration:** firm-a (§4).
- **Household evidence:** the changed, unverified bank instruction; $420,000 available taxable
  liquidity, $8,000 monthly schedule, and $48,000 reserve; destination restriction satisfied; no
  pending liquidity activity observed.
- **Policy versions / household instructions:** as GC-03.
- **Expected disposition:** proceed (authority remains unresolved - the branch ends still awaiting).
- **Expected authority stages:** as GC-03; the subject is the time dimension. At P1D the configured
  escalation projects operations-manager eligibility and a new expiry. If that authority remains
  unsatisfied through the projected deadline, expiration is recorded. The original stage remains
  immutable and stage 2 never arms.
- **Expected execution eligibility:** **not eligible** - expiration never auto-approves and never
  silently cancels.
- **Expected explanation nodes:** specialist-review-required; stage-escalated-then-expired, with
  both authority facts shown and nothing auto-approved.
- **Expected ledger events:** EvidenceSnapshotRecorded → DecisionRecorded →
  **ApprovalStageEscalated** at P1D → **ApprovalStageExpired** at the projected deadline. The
  authority surface renders those two facts in that chronological order with their timestamps. No
  `ApprovalInvalidated` occurs because no approval was recorded, and lapse alone does not derive a
  new decision.
- **Expected verification state:** not reached while authority is unresolved.
- **Signoff:** signed (captain, 2026-07-28).

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
  (CI job `golden-cases`, blocking): every required §5 field present and populated in each of the 15
  reapproved fixtures, evidence completeness and canonical UTC instants enforced, amount/unit/schedule/reserve/status
  semantics aligned with the live demo and scenarios.yaml, branch-and-firm source binding and
  phased revalidation enforced, every exact signed source represented, request-relative visible
  event order enforced, GC-16 fixture and visible event order enforced, structural consistency
  (§5) enforced, doc/fixture ids in sync, all twelve spec-required case names covered, at least
  twelve cases, and every signoff in one of the two legal §1 shapes. GC-03 remains byte-exact to its
  2026-07-26 captain signature; its later missing authorities are exact, SHA-256-bound, and
  execution-withheld pending captain signature.
- The `golden-cases` fitness fence (`src/__tests__/fitness/golden-cases.test.ts`) runs the same
  validator inside `pnpm test` and ships the adversarial companion proving a broken or prematurely
  signed case CANNOT pass (charter #4: detection is not verification).
