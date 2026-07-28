# Demo-contract acceptance checklist

**What this is.** The acceptance checklist for the seven-minute journey in
[`demo-contract.md`](./demo-contract.md): each §3 timeline moment mapped to the §4 product surface
that carries it, the visible-proof items the audience must see, and the ledger artifact(s) that back
them. Ledger artifact names are the `LedgerEntry` type names from the v3 core contracts (the
14-entry union: `DecisionRecorded`, `EvidenceSnapshotRecorded`, `ApprovalRecorded`,
`ApprovalInvalidated`, `ReservationCreated`, `ReservationReleased`, `ExecutionStarted`,
`ExecutionSucceeded`, `ExecutionPartiallySucceeded`, `ExecutionFailed`, `StatusObserved`,
`VerificationClosed`, `VerificationStuck`, `ExceptionDecisionRequested`). The committed referent
for these names (and for `DecisionRecord`, `DecisionInputBundle`, and `ObservedStatus`) is
[`docs/v3/verin-core-contracts.ts`](./v3/verin-core-contracts.ts), which lands in the parallel
ratification branch `fm/verin-ratify-x2` under its arch-version pin (architecture v3); this
document points at that referent rather than duplicating it.

**How a moment passes.** Every visible-proof item renders on its named surface from recorded
artifacts - real ones, or labeled fakes where the contract's `[deferred-pending-sandbox]`
annotation applies (see "How to read this document" in `demo-contract.md`). A moment whose proof
item cannot be traced to a backing artifact does not pass; a fake-backed pass is a development
milestone, never Phase 1 completion.

**Surface numbers** refer to contract §4. All surfaces derive their look from
[`demo-design-language.md`](./demo-design-language.md).

---

## Moment map

| §3 moment | Surface(s) (§4) | Backing ledger artifact(s) |
|---|---|---|
| 0:00-0:45 Intent | 1 Household workspace · 2 Contextual intent panel | none yet (see note below) |
| 0:45-1:30 Evidence | 3 Evidence and conflict view | `EvidenceSnapshotRecorded` |
| 1:30-2:30 Decision | 4 Recommendation and alternatives · 5 Policy and precedence trace | `DecisionRecorded` |
| 2:30-3:20 Authority | 6 Approval stages and actor status | `ApprovalRecorded` |
| 3:20-4:05 Safety before execution | 7 Pre-execution safety check | `EvidenceSnapshotRecorded`, `ReservationCreated`, `ApprovalInvalidated` (invalidation branch), `ReservationReleased` (release branch) |
| 4:05-5:00 Real execution | 8 Execution timeline | `ExecutionStarted`, `ExecutionSucceeded` / `ExecutionPartiallySucceeded` / `ExecutionFailed` |
| 5:00-5:40 Honest verification | 9 Verification state | `StatusObserved`, `VerificationClosed` / `VerificationStuck`, `ExceptionDecisionRequested` (delayed-NIGO branch) |
| 5:40-6:25 Firm B comparison | 10 Firm A / Firm B comparison | second `DecisionRecorded` (+ its own downstream chain) under the Firm B tenant |
| 6:25-7:00 Policy authoring proof | 11 Policy draft and simulation impact | rerun `DecisionRecorded` pinning the new policy version (see note below) |
| Wrap (spans all moments) | 12 Printable examiner-grade decision artifact | the complete `LedgerEntry` chain + the replayable `DecisionRecord` |

**Ledger-vocabulary notes (recorded, not improvised around):**

- **Intent capture has no dedicated `LedgerEntry` type.** The intent is pinned by the later
  `DecisionRecorded` entry through `DecisionRecord.intentRef`. Whether intake deserves its own ledger
  event is an open architecture question for the ledger prompt (build-sequence prompt 7).
- **Policy-version activation has no dedicated `LedgerEntry` type.** The draft's approval,
  activation, and the changed rerun are proven by the rerun's `DecisionRecorded`, whose input bundle
  pins the new `policyVersionRef`. Whether policy lifecycle transitions get their own ledger events
  is an open architecture question for the policy-lifecycle prompt (build-sequence prompt 20).

---

## Minute 0:00-0:45 - Intent

Surfaces: **1 Household workspace**, **2 Contextual intent panel**.

- [ ] Household is already the primary context (the workspace, not a chat screen, is on stage).
- [ ] Conversation controls the software but is not the entire interface.
- [ ] The request is interpreted into typed intent and slots, visibly.

Backing: no ledger entry yet; the typed intent is later pinned by `DecisionRecorded`
(`DecisionRecord.intentRef`). The typed-intent display carries the `llm-proposed-draft` provenance
label for the shaped interpretation and `user-entered-demo-input` for the request text.

## Minute 0:45-1:30 - Evidence

Surface: **3 Evidence and conflict view**.

- [ ] Source and timestamp shown for every item.
- [ ] Observed time versus retrieved time distinguished.
- [ ] Evidence freshness visible.
- [ ] Missing or conflicting information surfaced.
- [ ] No unexplained "AI confidence" score anywhere.

Backing: one `EvidenceSnapshotRecorded` per gathered item (account, liquidity, planned-withdrawal,
bank-instruction, household-instruction, pending-action), each carrying its content hash.

## Minute 1:30-2:30 - Decision

Surfaces: **4 Recommendation and alternatives**, **5 Policy and precedence trace**.

- [ ] Active firm-policy version shown.
- [ ] Household-instruction version shown.
- [ ] Precedence trace shown.
- [ ] Exact blocker or prohibition shown when applicable.
- [ ] Proceed, blocked, and prohibited are visibly distinct treatments.

Backing: `DecisionRecorded` (decision hash; the `DecisionRecord` carries the precedence trace,
explanation trace, and input-bundle pin that make the display reproducible).

## Minute 2:30-3:20 - Authority

Surface: **6 Approval stages and actor status**.

- [ ] Eligible roles shown.
- [ ] Required quorum shown.
- [ ] Distinct-actor requirement shown.
- [ ] Whether the requester may approve shown.
- [ ] Expiration and escalation shown.
- [ ] Approval bound to the exact decision hash, visibly.

Backing: `ApprovalRecorded` per approval outcome, each carrying `decisionHash` and
`inputBundleHash` (the visible binding).

## Minute 3:20-4:05 - Safety before execution

Surface: **7 Pre-execution safety check**.

- [ ] Pre-execution revalidation timestamp shown.
- [ ] Conflict keys and reservation shown.
- [ ] No duplicate or jointly-invalid movement possible (competing request visibly blocked).
- [ ] Stable idempotency key shown.

Backing: refreshed `EvidenceSnapshotRecorded` entries, `ReservationCreated` (conflict keys,
expiry); on the invalidation branch `ApprovalInvalidated` (+ `ReservationReleased` where a
reservation is given up).

## Minute 4:05-5:00 - Real execution `[deferred-pending-sandbox]`

Surface: **8 Execution timeline**.

- [ ] Adapter provenance shown - `fake-adapter-response` now; `real-salesforce-sandbox-response`
      required before Phase 1 completion (un-defer trigger: sandbox access granted).
- [ ] Exact request state shown, without exposing PII in logs.
- [ ] One external instruction despite retry or double-click.
- [ ] Returned status displayed - real status `[deferred-pending-sandbox]`.

Backing: `ExecutionStarted` (idempotency key), then exactly one of `ExecutionSucceeded`,
`ExecutionPartiallySucceeded` (completed/incomplete parts), or `ExecutionFailed` per step.

## Minute 5:00-5:40 - Honest verification

Surface: **9 Verification state**.

- [ ] `submitted` is never presented as final execution completion (contract annotation 3): the
      observed statuses are `submitted`, `in-flight`, `completed`, `rejected`, `nigo`, `unknown`,
      and only `completed` - with a status source that proves it - may be presented as done. There
      is no canonical `settled` status.
- [ ] Next poll or external-status expectation shown.
- [ ] Delayed NIGO can be ingested (and visibly lands when the scenario fires).
- [ ] Stuck-state rules shown - `stuck` is a verification projection, never an observed status, and
      `duplicate-suppressed` is an execution receipt, never one either.

Backing: `StatusObserved` per observation (honest `ObservedStatus` mapping), `VerificationClosed`
when a rule proves a state, `VerificationStuck` when the stuck rule fires,
`ExceptionDecisionRequested` on the delayed-NIGO branch. Status content is `fake-adapter-response`
until the sandbox trigger fires.

## Minute 5:40-6:25 - Firm B comparison

Surface: **10 Firm A / Firm B comparison**.

- [ ] Different policy version shown.
- [ ] Different reserve logic or approval result shown.
- [ ] No code deployment occurred (Firm A / Firm B differ only through
      [`config/demo/scenarios.yaml`](../config/demo/scenarios.yaml)-class configuration).
- [ ] Explanation changes because policy changed, not because a prompt changed.

Backing: a second `DecisionRecorded` under the Firm B tenant with its own downstream chain; the
comparison surface renders both decisions' traces side by side.

## Minute 6:25-7:00 - Policy authoring proof

Surface: **11 Policy draft and simulation impact**.

- [ ] Structured draft shown (`llm-proposed-draft` provenance).
- [ ] Deterministic interpretation of the draft shown.
- [ ] Simulation delta shown (which prior decisions would change).
- [ ] Attributed human approval required and shown.
- [ ] Version activation shown.
- [ ] Changed rerun result shown.

Backing: the rerun `DecisionRecorded`, whose input bundle pins the newly activated
`policyVersionRef` (see ledger-vocabulary note above on policy lifecycle events).

## Wrap - the examiner-grade record

Surface: **12 Printable examiner-grade decision artifact**.

- [ ] The complete decision timeline is printable/exportable: evidence, policy, approval,
      execution, status, unresolved verification obligations, any derived exception decision.
- [ ] Immutable identifiers and hashes present throughout.
- [ ] The artifact replays byte-identically (contract §8).
- [ ] Any artifact derived from labeled-synthetic or fake inputs is watermarked as a demonstration
      and excluded from the real examiner-export (charter #3 extension, ADR-0022).

Backing: the full `LedgerEntry` chain for the journey plus the replayable `DecisionRecord` and its
`DecisionInputBundle`.

---

## Overall acceptance (prompt 1 criteria)

- [ ] A reviewer can storyboard the entire seven-minute demo from `demo-contract.md`,
      `config/demo/scenarios.yaml`, and this checklist without reading code or inventing missing
      behavior.
- [ ] Every simulated element is identifiable as simulated (the `elements` section of
      `scenarios.yaml`; provenance labels of contract §6).
- [ ] The Firm A / Firm B differences are expressible purely as data (the `firms` section of
      `scenarios.yaml`).
- [ ] Phase 1 completion (§8) remains gated on the real Salesforce invocation; nothing in these
      files declares or implies completion on fakes.
