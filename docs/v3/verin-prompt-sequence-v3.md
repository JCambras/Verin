# Verin — 30-Prompt Build Sequence v3

**Companion to:** `verin-architecture-v3.md`.
**Build posture:** demo-first, architecture-enforced, Salesforce-integration-gated.
**Primary objective:** produce one investor-quality money-movement journey that proves the decision-led model without corrupting the long-term architecture.

Every prompt assumes the architecture document and the outputs of all prior gates are in context.

---

## Orchestrator rules

1. Do not skip gates. A prompt may begin only when its prerequisite gate is green or explicitly marked not-yet-active.
2. Do not report later-phase invariants as passing before their prerequisites exist.
3. Each agent returns:
   - files created or changed;
   - tests added;
   - active invariants served;
   - unresolved architecture questions;
   - demo behavior changed;
   - exact commands used to validate the work.
4. The orchestrator stops when an agent discovers a contradiction with the architecture. It does not ask the agent to improvise around it.
5. The UI walking skeleton begins before the engine is complete. Phase 1 is a demonstrated product, not an API collection.
6. Salesforce may be faked during early waves. Phase 1 cannot be declared complete until Prompt 27 passes against a real sandbox capability and real returned status.
7. Domain examples may appear in configuration, fixtures, demo copy, and tests. They may not create domain-named core modules or evaluator branches.
8. Use role labels below as execution specialties. Multiple prompts may be assigned to the same agent if the orchestrator prefers.

### Roles

- **Product Architect:** demo contract, domain boundaries, integration of product and technical intent.
- **Core Domain Engineer:** schemas, evaluator, policy, precedence, replay.
- **Platform Engineer:** ledger, ports, execution, concurrency, persistence.
- **Security Engineer:** tenancy, actor authorization, PII boundary, secrets, observability.
- **UI/Demo Engineer:** household workspace, decision workspace, demo choreography, audit views.
- **Salesforce Integration Engineer:** managed-package archaeology and real adapter.
- **Adversarial Reviewer:** invariants, property tests, architecture audit, false-proof detection.

---

## Wave map

| Wave | Prompts | Gate |
|---|---:|---|
| 0 — Demo contract and walking skeleton | 1–3 | The seven-minute journey is clickable on static/fake data |
| A — Foundation and boundaries | 4–7 | Foundation invariants are active and green |
| B — Vocabulary and configuration | 8–11 | Money movement and account opening are expressible as data |
| C — Intake, resolution, evidence | 12–15 | One request reaches a validated immutable input bundle |
| D — Deterministic judgment | 16–19 | Proceed, blocked, and prohibited decisions replay byte-identically |
| E — Policy and institutional logic | 20–22 | A natural-language draft becomes simulated and approved structured policy |
| F — Execution integrity | 23–26 | Concurrent, repeated, failed, and delayed execution paths are safe and recorded |
| G — Real Salesforce and full assembly | 27–28 | The full journey uses real Salesforce invocation and honest returned status |
| H — Investor demo hardening | 29 | The demo runs in seven minutes and emits measured proof |
| I — Adversarial audit | 30 | Critical findings resolved or explicitly accepted |

**Parallelizable after prerequisites:** 5‖6, 8‖11, 12‖14, 20‖21, 23‖24, selected UI work throughout.

---

# Wave 0 — Demo contract and walking skeleton

## 1 — Freeze the demo contract

**Role:** Product Architect

> Convert §2 of the architecture into a machine-readable and human-readable demo contract. Create `docs/demo-contract.md` and `config/demo/scenarios.yaml`. Define the exact seven-minute sequence, the required screens, every visible state label, which steps are fake-backed during development, which step must be real before Phase 1 completion, and the measured outputs. Include the canonical request: “The Smiths need $75,000 for their home renovation by August 15.” Include Firm A and Firm B differences, the recent bank-instruction block, one prohibition, one dual-approval case, one evidence-change invalidation, one execution failure, and one delayed NIGO event. Do not add product scope beyond §2.

**Required deliverables:**

- `docs/demo-contract.md`
- `config/demo/scenarios.yaml`
- state vocabulary: proceed, blocked, prohibited, awaiting approval, approved, submitted, in flight, completed, NIGO, unknown
- explicit list of simulated versus real elements
- acceptance checklist mapping each moment to a screen and ledger artifact

**Acceptance:** a reviewer can storyboard the entire demo without reading code or inventing missing behavior.

---

## 2 — Create the golden-case specification

**Role:** Product Architect + Adversarial Reviewer

> Create `docs/golden-cases.md` and machine-readable fixtures describing the minimum truth set. Each case must state: trigger, firm configuration, household evidence, policy versions, household instructions, expected disposition, expected authority stages, expected execution eligibility, expected explanation nodes, expected ledger events, and expected verification state. Include at least twelve cases: Firm A happy path, Firm B happy path, recent bank change, insufficient liquidity, household restriction, regulatory or firm prohibition, ambiguous household, stale evidence, two simultaneous distributions, duplicate retry, partial Salesforce success, delayed NIGO. Treat these expected results as product truth subject to human signoff, not agent invention.

**Required deliverables:**

- `docs/golden-cases.md`
- `fixtures/golden/*.json`
- human signoff field in every case
- a validation script that ensures every required field is populated

**Acceptance:** the engine can later be judged against explicit domain outcomes instead of self-generated tests.

---

## 3 — Build the clickable walking skeleton

**Role:** UI/Demo Engineer

> Build the full required screen sequence using static contract data and fake service interfaces. Read `docs/demo-design-language.md` first and derive every color, type, and layout decision from its tokens; implement the Decision Spine as the persistent top rail generated only from typed view models, and the proceed/blocked/prohibited treatments exactly as specified (blocked shows resolving affordances; prohibited shows the stamp and zero affordances). The goal is not visual perfection; it is to make the investor experience tangible before backend completion. Implement the household workspace, contextual intent panel, evidence/conflict view, recommendation, policy trace, approval stages, execution timeline, verification state, printable record, and Firm A/Firm B comparison. All fake data must carry a visible development-only provenance badge that can be removed only when the corresponding real path lands. No business logic in the UI. Every rendered state comes from typed view models.

**Required deliverables:**

- navigable React/Vite experience
- typed UI state model
- demo route that runs the full sequence
- screenshot or Playwright snapshot for every required screen
- no decision branches in components

**Gate 0:** the seven-minute journey is clickable on static/fake data, every required screen exists, and the UI does not invent decisions.

---

# Wave A — Foundation and boundaries

## 4 — Repository scaffold and phase-gated CI

**Role:** Platform Engineer

> Scaffold the repository per §16 and §18. Use TypeScript, Fastify, SQLite WAL, React/Vite, Zod, Vitest, dependency-cruiser or eslint-plugin-boundaries, and forward-only migrations. Create all core module directories from §16 with README contracts. Implement phase-gated invariant reporting with three states: active-pass, active-fail, not-yet-active. Copy the architecture non-negotiables into `CLAUDE.md` and require every PR to name phase, active invariants, demo behavior, and unresolved contradictions. Do not add business logic.

**Required deliverables:**

- repo scaffold
- CI pipeline
- import-boundary checks
- phase-gated invariant runner
- PR template
- architecture checksum or version check preventing agents from silently using an older document

**Acceptance:** Foundation invariants can run without pretending execution or integration invariants exist.

---

## 5 — Canonical core type system

**Role:** Core Domain Engineer

> Implement the contracts in §5 as Zod schemas with derived TypeScript types. Use discriminated unions so illegal states are unrepresentable: a proceed decision requires authority and execution plan; blocked and prohibited decisions cannot carry either; a prohibition cannot carry a resolving condition. Implement tenant-scoped branded IDs, Trigger, Intent, ResolutionState, EvidenceSnapshotRef, DecisionInputBundle, DecisionRecord, ApprovalStage, ApprovalRequirement, Prohibition, ResolvableBlocker, ExecutionPlan, and replay metadata. Do not collapse disposition and authority.

**Required tests:**

- compile-time or schema tests rejecting authority on blocked/prohibited results
- rejection of proceed without authority or execution plan
- rejection of unscoped persisted records
- rejection of prohibition with resolving evidence
- canonical serialization fixtures

**Acceptance:** the type system enforces the major distinctions without relying on reviewer discipline.

---

## 6 — Tenant, actor, PII, and secret boundaries

**Role:** Security Engineer

> Implement §15. Every repository and port call requires TenantContext. Add ActorRef and authorization hooks for viewing PII, supplying evidence, policy actions, decision approval, override, execution, and audit export. Implement PII-bearing marker types, Tokenized wrappers, and compile/import tests proving no PII-bearing type is reachable from `llm/`. Scrubbing occurs in the LLM adapter and evidence-to-LLM projection layer. Create PII-safe logging helpers and prevent secrets from entering config, ledger, traces, or exception messages.

**Required tests:**

- cross-tenant access fails
- missing tenant context cannot compile or parse
- PII cannot reach LLM request schemas
- raw names and account numbers do not appear in logs or traces
- unauthorized actors cannot approve or execute
- `Tokenized` values are constructible only through the scrubber module's factory; a lint/CI rule fails any object literal or cast producing `Tokenized` elsewhere in the codebase

**Acceptance:** security seams are structural even if Phase 1 uses a simplified identity provider.

---

## 7 — Append-only ledger and replay storage skeleton

**Role:** Platform Engineer

> Implement the append-only ledger types from §12 and immutable evidence/input-bundle storage. Distinguish DecisionRecorded, ApprovalRecorded, ApprovalInvalidated, ReservationCreated, ReservationReleased, ExecutionStarted, ExecutionSucceeded, ExecutionPartiallySucceeded, ExecutionFailed, StatusObserved, VerificationClosed, VerificationStuck, and ExceptionDecisionRequested. Create projections for current decision state without mutating prior events. Add canonical serialization versioning and engine-version metadata. No decision logic yet.

**Required tests:**

- prior ledger rows cannot be updated through repository APIs
- projections rebuild from an empty database plus ledger
- event ordering is deterministic
- malformed cross-tenant references fail
- serializer version is persisted

**Gate A:** Foundation invariants 1–5 are active and green.

---

# Wave B — Vocabulary and configuration

## 8 — Primitive vocabulary with falsification tests

**Role:** Core Domain Engineer

> Derive the initial decision primitives from money movement, account opening, trading/rebalancing, life events, and client service. Target under fifteen primitives. For each primitive, define parameters, deterministic semantics, applicable evidence, possible effects, and a falsification test explaining what real operating case would prove the primitive wrong or too narrow. Mark the vocabulary versioned and provisional. Do not create domain branches.

**Required deliverables:**

- `src/primitives/catalog.ts`
- `docs/primitive-rationale.md`
- `primitive-set-version.json`
- cross-domain matrix showing which primitives serve which example domains

**Acceptance:** no primitive exists solely because the money-movement demo needed a one-off condition.

---

## 9 — Constrained policy AST and deterministic interpreter

**Role:** Core Domain Engineer

> Implement §6.1 as a closed, typed policy AST with deterministic parser, validator, and evaluator skeleton. Support only approved ValueNode, PredicateNode, and PolicyEffect variants. Explicitly ban arbitrary code, user functions, dynamic paths, SQL, shell calls, and LLM-executed effects. The interpreter must be total: valid input produces a typed result or a typed evaluation error. Version the AST and primitive set independently.

**Required tests:**

- deterministic output for the same AST and input
- unknown operators and paths rejected at load time
- attempts to inject executable strings rejected
- no evaluator branch on domain ID
- AST migration fixture for one schema-version change
- two rules with co-satisfiable predicates emitting `set_parameter` on the same `(primitiveId, parameter)` are rejected at load time, never resolved by rule order
- two rules emitting `select_candidate` on the same `primitiveId` are rejected at load time
- cumulative effects (`require_evidence`, `require_approval`, `block`, `prohibit`) resolve to the most restrictive result regardless of rule order (property test across shuffled rule arrays)

**Acceptance:** firms can configure binding logic without turning configuration into custom TypeScript.

---

## 10 — Domain configuration schema

**Role:** Core Domain Engineer

> Define the schema by which a decision domain is expressed entirely as data: supported intents, slot requirements, evidence requirements and freshness, primitive bindings, policy references, household instruction kinds, prohibitions, approval templates, execution adapter bindings, conflict keys, reservation rules, verification rules, and UI presentation metadata. Express money movement and account opening as configuration files with zero supporting domain code. Report anything that cannot be expressed and classify it as missing primitive, missing platform capability, or mistaken requirement.

**Required deliverables:**

- `src/config/domain-schema.ts`
- `config/domains/money-movement.yaml`
- `config/domains/account-opening.yaml`
- schema validation and versioning
- a test that greps core code for domain-specific branching

**Acceptance:** both domains parse and bind against the same engine contracts.

---

## 11 — Synthetic corpus and signed golden fixtures

**Role:** Platform Engineer + Product Architect

> Build a deterministic synthetic household generator covering people, trusts, entities, accounts, beneficiaries, authorized signers, bank instructions, planned withdrawals, restrictions, recent changes, model assignments, and pending actions. Include awkward structures deliberately. Materialize the signed golden cases from Prompt 2 as immutable fixtures with deterministic seeds and expected hashes. No real PII. Where available, incorporate anonymized real defect history — NIGO returns, custodian rejections, operational exceptions from actual past submissions, scrubbed before entering fixtures — and label every fixture's provenance (real-derived vs. synthetic) so the §2.4 detection-rate split is possible.

**Required tests:**

- same seed produces byte-identical corpus
- every golden case references valid domain config and policy versions
- simultaneous-request cases share conflict keys
- recent-change cases have realistic observed and retrieved timestamps

**Gate B:** money movement and account opening are expressible as data and the golden corpus is stable.

---

# Wave C — Intake, resolution, and evidence

## 12 — One intake pipeline for human and system triggers

**Role:** Platform Engineer

> Implement intake normalization for human requests and system events. Both converge into one Intent before entity binding. Preserve trigger provenance in the ledger, but prohibit downstream decision branches on trigger kind. Add a fake event source for bank-instruction changes and a human-request path using masked request text.

**Required tests:**

- equivalent human and system triggers produce equivalent downstream intent shape
- downstream evaluator input contains no trigger-type branch flag
- every intent is tenant-scoped and actor/system-attributed

---

## 13 — Masked intent shaping and deterministic entity binding

**Role:** Core Domain Engineer

> Implement the three-stage resolution split from §15: LLM intent shaping over masked text, deterministic entity binding over real records, and human disambiguation outside the model. The model emits action plus typed slot structure only. It never selects the client, account, bank instruction, or policy. Test ambiguity with multiple Smith households and multiple bank instructions.

**Required outcomes:**

- resolved
- ambiguous with a typed human question
- evidence gap
- unsupported intent

**Acceptance:** no PII reaches the model and no model output binds a real entity.

---

## 14 — Immutable evidence snapshots and source ports

**Role:** Platform Engineer

> Implement EvidenceSource contracts and immutable EvidenceSnapshotRef creation. Capture observedAt, retrievedAt, attribution, schema version, encrypted storage reference, content hash, and freshness. Scrub only projections sent to LLM paths; preserve secure evidence for deterministic evaluation and replay. Implement in-memory sources for CRM household data, bank instructions, account values, planned withdrawals, and pending actions.

**Required tests:**

- live source changes do not mutate prior snapshots
- replay loads the old snapshot, not current source data
- stale, fresh, and unknown freshness classify deterministically
- every snapshot is tenant-scoped and attributed

---

## 15 — Validation and input-bundle assembly

**Role:** Core Domain Engineer

> Implement validation as a distinct stage. Determine whether the evidence set is sufficient, internally consistent, and fresh enough to evaluate. Produce proceed-to-evaluation, blocked-with-resolvable-gaps, or requires-specialist-evidence; do not produce a decision. Assemble and hash the immutable DecisionInputBundle with schema, serializer, engine, primitive set, domain config, policy, instruction versions, snapshot IDs, asOf, and time zone.

**Required tests:**

- present-but-stale evidence cannot silently proceed
- contradictory evidence identifies both sources
- bundle hash changes on any material input change
- bundle hash does not change from irrelevant ordering

**Gate C:** the canonical request reaches a validated immutable input bundle with no PII in LLM artifacts.

---

# Wave D — Deterministic judgment

## 16 — Evaluator and explanation trace

**Role:** Core Domain Engineer

> Complete the deterministic policy evaluator. Input is the immutable DecisionInputBundle plus the exact versioned AST and primitive set. Output is a typed evaluation trace, not a post-hoc narrative. Generate human explanation nodes from the trace through deterministic templates; optional LLM wording may operate only on tokenized trace data and may not change meaning. Evaluate the Firm A and Firm B reserve rules.

**Required tests:**

- pure-function behavior
- no network or clock access inside evaluation
- same input and engine version produce identical trace
- explanation names the exact evidence and policy source
- different firm config changes output with no code change

---

## 17 — Precedence, blockers, and prohibitions

**Role:** Core Domain Engineer

> Implement order-independent precedence between firm policy and household instructions. Narrowing is permitted; widening requires explicit exception authority. Implement proceed, blocked, and prohibited as distinct decision results. Blockers name resolvable conditions. Prohibitions offer no resolution path and short-circuit before authority. Every conflict emits a versioned PrecedenceStep.

**Required property tests:**

- shuffle policy and instruction order across many seeds; output remains identical
- blocked never carries approval or execution
- prohibited never carries a resolving condition
- proceed always carries a recommendation pending authority assignment

---

## 18 — Authority, multistage approval, and override

**Role:** Platform Engineer

> Implement automatic, approval, and specialist-review authority modes. Approval supports sequential and parallel stages, quorum, distinct actors, role eligibility, requester exclusion, prior-executor exclusion, expiration, escalation, and structured override reasons. Approval events bind to decisionHash and inputBundleHash. Implement invalidation on material evidence or policy change.

**Reference cases:**

- Firm A requires two distinct operations approvers above $25,000.
- Firm B requires two distinct approvers only above $100,000.
- Requester may not satisfy both approval requirements.
- Recent bank change forces specialist review.

**Required tests:**

- duplicate actor cannot satisfy distinct-actor quorum
- unauthorized role rejected
- expired approval cannot execute
- evidence change emits ApprovalInvalidated
- override remains an event and does not mutate the decision
- templates carry `expiresAfter: Duration`; instantiation computes absolute `expiresAt` deterministically from decision creation time; replay uses the recorded instance, never re-instantiation

---

## 19 — Byte-identical replay

**Role:** Core Domain Engineer + Adversarial Reviewer

> Implement replay from DecisionInputBundle, archived or version-addressable engine, primitive-set version, policy AST, instruction versions, and immutable evidence snapshots. Use canonical serialization with deterministic key ordering and timestamp normalization. Prove byte-identical DecisionRecord and explanation trace. Then attempt to break replay through live source changes, array reordering, time-zone changes, engine upgrades, and policy supersession.

**Gate D:** proceed, blocked, and prohibited cases replay byte-identically and all decision-core invariants 6–13 are green.

---

# Wave E — Policy and institutional logic

## 20 — Policy lifecycle and simulation

**Role:** Core Domain Engineer

> Implement draft → simulated → in_review → approved → active → superseded. No active policy is editable. Candidate policy simulation runs against the signed corpus and reports changed decisions, changed dispositions, changed authority requirements, and newly introduced blockers or prohibitions. The reviewer artifact is a human-readable impact report linked to exact before/after decision hashes.

**Required tests:**

- approval impossible without simulation
- active mutation impossible
- supersession preserves old replay
- simulation corpus version pinned
- approver identity and role recorded

---

## 21 — Household instruction lifecycle

**Role:** Core Domain Engineer

> Implement household commitments, preferences, restrictions, and approved exceptions as an independently versioned layer. Define authorship, approval, effective dates, expiration, revocation, and precedence interactions. Household instructions must not be stored as hidden policy patches. Include planned withdrawal commitments, destination restrictions, do-not-sell restrictions, and approved one-time exceptions.

**Acceptance:** household instructions can change decisions without changing firm policy or core code, and old decisions replay against prior versions.

---

## 22 — One constrained natural-language policy path

**Role:** Core Domain Engineer + UI/Demo Engineer

> Implement only the Phase 1 policy-authoring moment: “Always preserve twelve months of planned withdrawals in cash.” Mask any PII, send the policy text to the LLM adapter, receive a candidate PolicyAst, validate it against the closed schema, and display the exact deterministic interpretation. Simulate against the signed corpus, show changed cases, require human approval, activate a new immutable version, and rerun the canonical request. Reject ambiguous or unsupported drafts rather than guessing.

**Required tests:**

- LLM output cannot bypass AST validation
- unsupported operator rejected
- no policy becomes active without simulation and approval
- rerun changes because of policy version, not prompt wording
- same approved AST evaluates identically without any LLM call

**Gate E:** the narrow natural-language path produces a simulated, approved structured policy and policy invariants 14–17 are green.

---

# Wave F — Execution integrity

## 23 — Conflict keys, commitments, reservations, and revalidation

**Role:** Platform Engineer

> Implement conflict-key derivation from domain configuration, append-only reservations, expiration, and release events. Before execution, refresh material evidence, rebuild the input bundle, invalidate stale approvals, check pending and in-flight actions, reserve constrained resources, and reevaluate liquidity. Use the two-simultaneous-$75,000 case as the reference failure: each request is individually valid, but both together violate the reserve.

**Required tests:**

- two concurrent requests cannot both overcommit liquidity
- expired reservation releases through an event
- failed execution releases or preserves reservation according to policy
- revalidation changes decision when market value or pending action changes

---

## 24 — Ports, adapter conformance, and idempotency

**Role:** Platform Engineer

> Implement separately typed EvidenceSource, ExecutionTarget, and StatusSource ports. Every port has an in-memory fake. Create the conformance suite before the real Salesforce adapter: tenant propagation, attribution, timeout semantics, partial success, status taxonomy, duplicate suppression, and idempotency. Every external execution step carries a stable idempotency key before Phase 1 execution.

**Required tests:**

- repeated command with same key produces one external effect in the fake
- same key with materially different command is rejected
- partial success is represented explicitly
- status source cannot silently upgrade submitted to completed
- fake passes the conformance suite

---

## 25 — Execution planner and event-driven exception loop

**Role:** Platform Engineer

> Implement dependency-aware execution plans. Every step includes target, command, idempotency key, conflict keys, reservation refs, preconditions, verification rule, and optional compensating action. Record execution events separately from decisions. On failure, timeout, or partial success, classify whether further judgment is required. Emit ExceptionDecisionRequested only when policy must choose retry, reroute, specialist review, remain blocked, or stop. Nothing disappears into logs or a dead-letter queue.

**Required tests:**

- partial success produces exact completed and incomplete step events
- mechanical retry does not create a new decision when policy already permits it
- judgment-requiring failure creates a derived decision linked to the event and prior decision
- compensating action is recorded and idempotent

---

## 26 — Verification reconciler and delayed statuses

**Role:** Platform Engineer

> Implement status polling and event ingestion for Submitted, InFlight, Completed, Rejected, NIGO, and Unknown. Verification closes only when configured proof requirements are satisfied. Prolonged Unknown emits VerificationStuck and may request a derived decision. Model delayed NIGO as a later status observation, including a human-channel ingestion path. Never infer a stronger state than the source supplies.

**Required tests:**

- submitted remains unverified when settlement proof is absent
- NIGO arriving two simulated days later reopens the timeline
- unknown timeout produces stuck event
- repeated status observations are idempotent

**Gate F:** approval/execution invariants 18–25 are green against fakes, including concurrency and duplicate suppression.

---

# Wave G — Real Salesforce and full assembly

## 27 — Managed-package archaeology and real Salesforce adapter

**Role:** Salesforce Integration Engineer

> This prompt requires sandbox access. Do not fake completion. First inventory the managed package flows and invocable Apex surface. Classify each decision node as firm policy, evidence requirement, prohibition, authority, or execution mechanics. Mechanics remain in Salesforce; policy and judgment remain in Verin. Determine exactly what the money-movement capability accepts, returns, and exposes for later status polling. Identify whether it returns submission, acceptance, settlement, or something weaker. Then implement the real Salesforce EvidenceSource, ExecutionTarget, and StatusSource adapters without modifying existing managed flows solely to fit Verin. Hold the adapter to the Prompt 24 conformance suite. Model every capability gap explicitly.

**Required deliverables:**

- `docs/salesforce-capability-inventory.md`
- `docs/salesforce-decision-logic-delta.md`
- real adapter implementation
- sandbox setup instructions
- conformance-suite results
- exact status-semantics statement used by the UI

**Hard stop:** if sandbox access is unavailable, mark Prompt 27 blocked. Continue non-integration polish if useful, but do not declare Phase 1 complete or show fake status as real.

---

## 28 — Assemble the complete money-movement vertical

**Role:** Product Architect + Platform Engineer + UI/Demo Engineer

> Assemble the entire vertical through configuration and shared platform modules. No new money-movement core module. Run all signed golden cases. Replace development fake badges with real provenance only for the paths implemented by Prompt 27. The canonical case must perform a real Salesforce action after approval, revalidation, reservation, and idempotency checks, then display the exact real returned status. Firm A and Firm B must differ only through configuration. Generate the printable decision artifact from ledger and replay data.

**Required tests:**

- all golden cases pass
- Firm B requires zero core-code change
- real adapter and fake both pass conformance
- duplicate UI submit creates one Salesforce instruction
- evidence change between approval and execution forces re-decision
- all demo screens are populated from real domain view models

**Gate G:** the full journey uses a real Salesforce invocation and an honestly labeled returned status.

---

# Wave H — Investor demo hardening

## 29 — Measurement, polish, and choreography

**Role:** UI/Demo Engineer + Product Architect + Adversarial Reviewer

> Turn the working vertical into the investor demonstration defined in §2. Audit every screen against `docs/demo-design-language.md`: token fidelity, ledger-register consistency, disposition treatments, and the three orchestrated motion moments (evidence stagger, pre-execution revalidation sweep, hash seal and void). Choreograph the ApprovalInvalidated scenario around the seal-void moment; it is the demo's most memorable ten seconds and must land without narration. Verify the printable artifact reads as a compliance-binder document and photographs well. Remove debug clutter without hiding provenance or uncertainty. Add a one-click demo reset using deterministic fixtures. Instrument known-defect detection on the signed replay corpus, time to configure Firm B, clarification cycles for the policy draft, and internal TFIC. Produce a presenter script that finishes in seven minutes and a fifteen-minute deep-dive path. Test with a reviewer who has not read the architecture; record where they fail to understand the category. Revise the interface, not the explanation, wherever possible.

**Required deliverables:**

- `docs/demo-script-7-minute.md`
- `docs/demo-deep-dive-15-minute.md`
- measured results report with corpus version, methodology, and provenance split: detection rate on real anonymized defect history reported separately from synthetic cases, never blended into one number (per §2.4 corpus provenance rule)
- deterministic reset script
- Playwright end-to-end demo test
- explicit roadmap labeling for anything downstream of submitted status

**Gate H:** a cold reviewer understands that Salesforce performs defined work while Verin determines, governs, and records the right work.

---

# Wave I — Adversarial audit

## 30 — Architecture, safety, and false-proof audit

**Role:** Adversarial Reviewer

> Audit the complete Phase 1 codebase against every active invariant and the demo contract. Search specifically for: domain-named branches disguised as config helpers; prompt-only decision behavior; PII in model traces; unscoped tenant access; approval shortcuts; UI-generated authority; missing idempotency; mutable evidence; replay dependence on live sources; operational events mislabeled as decisions; concurrent overcommitment; status inflation; fake data presented as real; and code changes required for Firm B. Attempt to create duplicate external actions, cross-tenant reads, stale approvals, and replay drift. For every finding, state whether code, configuration, test, or architecture should change and why. No severity inflation and no waived critical findings.

**Required final report:**

- pass/fail for all active invariants
- unresolved critical, high, medium, and low findings
- exact reproduction steps
- transferability warnings
- primitive-vocabulary risks
- demo-credibility risks
- a diligence-facing statement of what Phase 1 proves and explicitly does not prove

**Gate I:** no unresolved critical finding; all accepted limitations are visible in the demo and documentation.

---

## Standing rules

- Read `verin-architecture-v3.md` first.
- Read `docs/demo-contract.md` before any UI, API, or demo work.
- Read `docs/demo-design-language.md` before any UI work; derive visual decisions from its tokens, do not improvise them.
- Name the phase, active invariants, and demo behavior in every PR.
- Do not create a decision-domain module or evaluator branch.
- Do not replace the typed policy AST with hard-coded TypeScript rules.
- Do not create a general-purpose expression engine.
- Do not let the LLM bind entities, activate policy, approve, or execute.
- Do not treat a failure, timeout, approval, or status observation as a decision unless a policy choice is actually required.
- Do not execute externally without revalidation, conflict control, reservation, and idempotency.
- Do not call submitted “completed,” “settled,” “verified,” or “invested.”
- Do not claim Phase 1 is complete without Prompt 27 and Prompt 28 running against a real Salesforce sandbox path.
- When implementation reveals a missing primitive, report it before adding one. A primitive is a platform decision, not a local convenience.
