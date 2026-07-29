# Verin - Phase 1 Investor Demo Contract (v1)

**Status:** Normative Phase 1 product contract, committed as product truth (prompt 1 of the v3 build
sequence, Wave 0).
**Parent:** architecture v3 §2 (the Phase 1 demo contract).
**Companion data:** [`config/demo/scenarios.yaml`](../config/demo/scenarios.yaml) (the scenario
matrix as machine-usable data) and [`demo-contract-checklist.md`](./demo-contract-checklist.md)
(the acceptance checklist mapping timeline moments to surfaces and ledger artifacts).
**Purpose:** Make the decision-led category immediately understandable through one polished, honest,
end-to-end journey.

---

## How to read this document

The body below is the captain-authored v1 contract, adopted in full; its substance is unchanged
(formatting normalized to house style). Three captain directives - two dated 2026-07-26 and one
dated 2026-07-28 - are integrated as annotations. Nothing else is altered:

1. **Salesforce deferral (captain ruling, 2026-07-26).** Sandbox access does not yet exist. Every
   step, surface item, or completion-test item that requires the REAL managed-Salesforce invocation
   is marked **`[deferred-pending-sandbox]`**. The un-defer trigger is: **Salesforce sandbox access
   granted.** Until the trigger fires, those elements run on labeled fake adapters (provenance label
   `fake-adapter-response`, §6); everything not so marked is fake-adapter-backed or real now. Phase 1
   completion (§8) stays honestly gated: the demo runs end to end on labeled fakes, but Phase 1 is
   **never declared complete on fakes** (orchestrator rule 6 of the build sequence).
2. **Design language (captain ruling, 2026-07-26).** All demo UI derives its look from
   [`demo-design-language.md`](./demo-design-language.md) (being authored in a parallel task). That
   document expresses the **established Verin design system** - OKLCH slate tokens, Geist, the
   `Verin.` wordmark, the presentation-tier micro-components (WhyBubble, FreshValue, StatusBadge,
   ProgressSteps, StepInfoCard, EmptyState), freshness-as-opacity, WCAG 2.2 AA, reduced-motion - not
   v3's visual prescriptions. v3's UX **semantics** are kept and re-expressed in that language: the
   Decision Spine as persistent orientation, the distinct proceed / blocked / prohibited treatments
   (blocked shows resolving affordances; prohibited shows the stamp and zero affordances), and the
   approval-invalidation moment. UI work is blocked until that document lands.
3. **Canonical status planes (captain ruling, 2026-07-28).** The contract's prose uses "settled" as
   the ordinary English word for proven completion. There is no canonical `settled` status. The
   canonical **observed external statuses** are exactly `submitted`, `in-flight`, `completed`,
   `rejected`, `nigo`, and `unknown` (`config/demo/scenarios.yaml` `state_vocabulary`, class
   `execution`; the type is `ObservedStatus` in
   [`docs/v3/verin-core-contracts.ts`](./v3/verin-core-contracts.ts)). Two further ids belong to
   their own planes and are never presented as observed statuses: `stuck` is a **verification
   projection** (a rule firing over the absence of a status), and `duplicate-suppressed` is an
   **execution receipt** (proof that a retry produced no second instruction). Read every
   "`submitted` is not `settled`" line below in those terms: **`submitted` is not final execution
   completion**; only `completed`, with a status source that proves it, may be presented as done.
   The three planes are enumerated in `src/contracts/execution-status.ts`, and the
   `demo-status-vocabulary` half of the golden-cases fence fails the build if this document, the
   acceptance checklist, the design language, the scenario matrix, or the demo's rendered statuses
   drift apart.

Canonical observed-status ids: `submitted`, `in-flight`, `completed`, `rejected`, `nigo`, `unknown`.

This contract is amended only by captain decision, recorded in the PR that changes it.

---

## 1. The investor takeaway

By the end of the demonstration, a viewer should understand:

> Salesforce can perform a defined money-movement operation. Verin determines whether that operation
> is appropriate, what evidence and policy govern it, who must approve it, whether it is safe to
> execute now, and what the returned status actually proves.

The demonstration is successful only when this distinction is visible in the product. It should not
depend on a long verbal explanation.

---

## 2. Canonical scenario

An advisor enters:

> "The Smiths need $75,000 for their home renovation by August 15."

The household contains:

- multiple taxable and retirement accounts;
- planned withdrawals requiring a cash reserve;
- a recently changed bank instruction;
- a household-specific destination restriction;
- pending approved activity that affects available liquidity;
- enough complexity to require real judgment without becoming implausible.

Firm A and Firm B use the same household and request but different approved logic.

### Firm A

- Preserve six months of planned withdrawals in cash.
- Require two distinct operations approvers above $25,000.
- Requester may not satisfy both approvals.
- Recent bank-instruction change requires specialist review.

### Firm B

- Preserve twelve months of planned withdrawals in cash.
- Require two distinct approvers above $100,000.
- Recent bank-instruction change blocks execution until independently verified.

No core code changes are permitted between Firm A and Firm B.

---

## 3. Seven-minute sequence

### Minute 0:00-0:45 - Intent

Show the household workspace. The advisor enters the request in a contextual Verin panel.

Visible proof:

- household is already the primary context;
- conversation controls the software but is not the entire interface;
- request is interpreted into typed intent and slots.

### Minute 0:45-1:30 - Evidence

Verin gathers account, liquidity, planned-withdrawal, bank-instruction, household-instruction, and
pending-action evidence.

Visible proof:

- source and timestamp for every item;
- observed time versus retrieved time;
- evidence freshness;
- missing or conflicting information;
- no unexplained "AI confidence" score.

### Minute 1:30-2:30 - Decision

Verin presents the recommended source and execution path, alternatives considered, and reasons
alternatives were rejected.

Visible proof:

- active firm-policy version;
- household-instruction version;
- precedence trace;
- exact blocker or prohibition when applicable;
- distinction among proceed, blocked, and prohibited.

### Minute 2:30-3:20 - Authority

Show the required approval stages.

Visible proof:

- eligible roles;
- required quorum;
- distinct-actor requirement;
- whether requester may approve;
- expiration and escalation;
- approval bound to the exact decision hash.

### Minute 3:20-4:05 - Safety before execution

After approval, Verin refreshes material evidence, checks pending actions, creates reservations, and
invalidates approval if facts changed.

Visible proof:

- pre-execution revalidation timestamp;
- conflict keys and reservation;
- no duplicate or jointly-invalid movement;
- stable idempotency key.

### Minute 4:05-5:00 - Real execution `[deferred-pending-sandbox]`

Verin invokes the real managed Salesforce capability.

> **Deferral annotation.** The REAL invocation is deferred until sandbox access is granted. Until
> then, this minute runs against the fake `ExecutionTarget` adapter and every displayed value on the
> execution timeline carries the `fake-adapter-response` provenance label. The choreography, the
> surfaces, the idempotency proof, and the exactly-once behavior are exercised now against the fake;
> only "real" is deferred.

Visible proof:

- real adapter provenance `[deferred-pending-sandbox]`;
- exact request state, without exposing PII in logs;
- one external instruction despite retry or double-click;
- real returned status `[deferred-pending-sandbox]`.

### Minute 5:00-5:40 - Honest verification

Show what the returned status proves and what remains unresolved.

> **Deferral annotation.** The verification surface, the `submitted`-is-not-`settled` distinction,
> delayed-NIGO ingestion, and stuck-state rules are all exercised now against fake `StatusSource`
> responses (labeled `fake-adapter-response`). Only the REAL returned status feeding this surface is
> `[deferred-pending-sandbox]`.

> **Status-plane annotation (annotation 3).** In canonical terms: `submitted` is not final execution
> completion. The observed statuses are `submitted`, `in-flight`, `completed`, `rejected`, `nigo`,
> `unknown`; `stuck` is a verification projection, not an observed status.

Visible proof:

- `submitted` is not presented as `settled`;
- next poll or external-status expectation;
- ability to ingest delayed NIGO;
- stuck-state rules.

### Minute 5:40-6:25 - Firm B comparison

Rerun the same request under Firm B.

Visible proof:

- different policy version;
- different reserve logic or approval result;
- no code deployment;
- explanation changes because policy changed, not because a prompt changed.

### Minute 6:25-7:00 - Policy authoring proof

Enter:

> "Always preserve twelve months of planned withdrawals in cash."

Show structured draft, deterministic interpretation, simulation delta, human approval, version
activation, and changed rerun result.

---

## 4. Required product surfaces

1. Household workspace
2. Contextual intent panel
3. Evidence and conflict view
4. Recommendation and alternatives
5. Policy and precedence trace
6. Approval stages and actor status
7. Pre-execution safety check
8. Execution timeline (renders `fake-adapter-response` data until the sandbox trigger fires; the
   surface itself is built now)
9. Verification state (same deferral posture as surface 8)
10. Firm A / Firm B comparison
11. Policy draft and simulation impact
12. Printable examiner-grade decision artifact

No binding decision logic may live in the UI.

> **Design-language annotation.** Every surface above derives its look from
> [`demo-design-language.md`](./demo-design-language.md) (annotation 2, "How to read this
> document"). No surface adopts v3's visual prescriptions directly.

---

## 5. Required scenario branches

The demo environment must support all of these without code changes:

- safe proceed;
- recent bank change causing a resolvable block;
- permanent prohibition;
- stale evidence;
- ambiguous household or bank instruction;
- dual approval;
- approval invalidation after evidence change;
- simultaneous requests competing for liquidity;
- duplicate execution retry;
- partial Salesforce success;
- delayed NIGO;
- specialist-review expiration and escalation.

The machine-usable form of these branches, with ids, descriptions, and expected outcome classes, is
[`config/demo/scenarios.yaml`](../config/demo/scenarios.yaml).

---

## 6. Provenance labels

Every visible data element or status is labeled internally as one of:

- synthetic fixture;
- real-derived fixture (anonymized historical defect or case, scrubbed of PII);
- fake adapter response;
- real Salesforce sandbox response `[deferred-pending-sandbox]` (this label cannot be produced
  before the sandbox trigger fires; until then every external response is `fake adapter response`);
- user-entered demo input;
- deterministic engine output;
- LLM-proposed draft or wording.

The investor-facing UI need not show noisy technical badges during the final presentation, but the
system must retain provenance and the presenter must not misstate simulated behavior as real.

---

## 7. Measured proof

The demo reports:

- known-defect detection rate on a versioned, labeled replay corpus, **reported split by corpus
  provenance**: the rate on anonymized real defect history (NIGO returns, custodian rejections,
  operational exceptions from actual past submissions) is stated separately from the rate on
  synthetic cases, and the two are never blended into one number. A rate measured only on
  author-invented synthetic defects is circular and must be labeled as synthetic-defect coverage,
  not detection. Real anonymized defect history from firm operations is the strongly preferred
  corpus foundation (architecture §2.4 corpus provenance rule);
- time to configure Firm B;
- schema and core-code changes required for Firm B - target zero;
- clarification cycles required to create the policy draft;
- internal TFIC from intent to governed submitted status (the Phase-1-reported TFIC is measured on
  the real execution path `[deferred-pending-sandbox]`; interim measurements on fakes are labeled
  as fake-path measurements).

The methodology, corpus version, and provenance breakdown remain accessible from the result.

---

## 8. Phase 1 completion test

Phase 1 is complete only when:

- the journey runs in seven minutes without developer intervention;
- the Salesforce invocation and displayed returned status are real `[deferred-pending-sandbox]`;
- retries do not create duplicate instructions (provable against the fake adapter now; re-proven
  against the real sandbox when the trigger fires);
- material evidence changes invalidate approval;
- two concurrent valid requests cannot jointly violate liquidity policy;
- Firm A and Firm B differ only through configuration;
- the natural-language policy path ends in a structured approved version;
- the complete decision artifact replays byte-identically;
- a cold reviewer understands the category without a long architecture explanation.

> **Gating annotation.** The `[deferred-pending-sandbox]` item above is a hard gate, not a waived
> one. Every other item may be proven on labeled fakes during development, but the completion test
> as a whole cannot be declared passed until the deferred item passes against the real sandbox
> capability (orchestrator rule 6; build-sequence prompt 27). A demo that runs end to end on fakes
> is a development milestone, never Phase 1 completion.
