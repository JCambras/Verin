# Verin — Phase 1 Investor Demo Contract

**Status:** Normative Phase 1 product contract.
**Companion:** `verin-architecture-v3.md` §2.
**Purpose:** Make the decision-led category immediately understandable through one polished, honest, end-to-end journey.

---

## 1. The investor takeaway

By the end of the demonstration, a viewer should understand:

> Salesforce can perform a defined money-movement operation. Verin determines whether that operation is appropriate, what evidence and policy govern it, who must approve it, whether it is safe to execute now, and what the returned status actually proves.

The demonstration is successful only when this distinction is visible in the product. It should not depend on a long verbal explanation.

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

### Minute 0:00–0:45 — Intent

Show the household workspace. The advisor enters the request in a contextual Verin panel.

Visible proof:

- household is already the primary context;
- conversation controls the software but is not the entire interface;
- request is interpreted into typed intent and slots.

### Minute 0:45–1:30 — Evidence

Verin gathers account, liquidity, planned-withdrawal, bank-instruction, household-instruction, and pending-action evidence.

Visible proof:

- source and timestamp for every item;
- observed time versus retrieved time;
- evidence freshness;
- missing or conflicting information;
- no unexplained "AI confidence" score.

### Minute 1:30–2:30 — Decision

Verin presents the recommended source and execution path, alternatives considered, and reasons alternatives were rejected.

Visible proof:

- active firm-policy version;
- household-instruction version;
- precedence trace;
- exact blocker or prohibition when applicable;
- distinction among proceed, blocked, and prohibited.

### Minute 2:30–3:20 — Authority

Show the required approval stages.

Visible proof:

- eligible roles;
- required quorum;
- distinct-actor requirement;
- whether requester may approve;
- expiration and escalation;
- approval bound to the exact decision hash.

### Minute 3:20–4:05 — Safety before execution

After approval, Verin refreshes material evidence, checks pending actions, creates reservations, and invalidates approval if facts changed.

Visible proof:

- pre-execution revalidation timestamp;
- conflict keys and reservation;
- no duplicate or jointly-invalid movement;
- stable idempotency key.

### Minute 4:05–5:00 — Real execution

Verin invokes the real managed Salesforce capability.

Visible proof:

- real adapter provenance;
- exact request state, without exposing PII in logs;
- one external instruction despite retry or double-click;
- real returned status.

### Minute 5:00–5:40 — Honest verification

Show what the returned status proves and what remains unresolved.

Visible proof:

- `submitted` is not presented as `settled`;
- next poll or external-status expectation;
- ability to ingest delayed NIGO;
- stuck-state rules.

### Minute 5:40–6:25 — Firm B comparison

Rerun the same request under Firm B.

Visible proof:

- different policy version;
- different reserve logic or approval result;
- no code deployment;
- explanation changes because policy changed, not because a prompt changed.

### Minute 6:25–7:00 — Policy authoring proof

Enter:

> "Always preserve twelve months of planned withdrawals in cash."

Show structured draft, deterministic interpretation, simulation delta, human approval, version activation, and changed rerun result.

---

## 4. Required product surfaces

1. Household workspace
2. Contextual intent panel
3. Evidence and conflict view
4. Recommendation and alternatives
5. Policy and precedence trace
6. Approval stages and actor status
7. Pre-execution safety check
8. Execution timeline
9. Verification state
10. Firm A / Firm B comparison
11. Policy draft and simulation impact
12. Printable examiner-grade decision artifact

No binding decision logic may live in the UI.

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

---

## 6. Provenance labels

Every visible data element or status is labeled internally as one of:

- synthetic fixture;
- real-derived fixture (anonymized historical defect or case, scrubbed of PII);
- fake adapter response;
- real Salesforce sandbox response;
- user-entered demo input;
- deterministic engine output;
- LLM-proposed draft or wording.

The investor-facing UI need not show noisy technical badges during the final presentation, but the system must retain provenance and the presenter must not misstate simulated behavior as real.

---

## 7. Measured proof

The demo reports:

- known-defect detection rate on a versioned, labeled replay corpus, **reported split by corpus provenance**: the rate on anonymized real defect history (NIGO returns, custodian rejections, operational exceptions from actual past submissions) is stated separately from the rate on synthetic cases, and the two are never blended into one number. A rate measured only on author-invented synthetic defects is circular and must be labeled as synthetic-defect coverage, not detection. Real anonymized defect history from firm operations is the strongly preferred corpus foundation (architecture §2.4 corpus provenance rule);
- time to configure Firm B;
- schema and core-code changes required for Firm B—target zero;
- clarification cycles required to create the policy draft;
- internal TFIC from intent to governed submitted status.

The methodology, corpus version, and provenance breakdown remain accessible from the result.

---

## 8. Phase 1 completion test

Phase 1 is complete only when:

- the journey runs in seven minutes without developer intervention;
- the Salesforce invocation and displayed returned status are real;
- retries do not create duplicate instructions;
- material evidence changes invalidate approval;
- two concurrent valid requests cannot jointly violate liquidity policy;
- Firm A and Firm B differ only through configuration;
- the natural-language policy path ends in a structured approved version;
- the complete decision artifact replays byte-identically;
- a cold reviewer understands the category without a long architecture explanation.
