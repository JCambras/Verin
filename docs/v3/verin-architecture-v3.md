# Verin — Strategy & Technical Architecture v3

**Status:** Ground truth for all build work. Supersedes prior planning and architecture documents.
**Audience:** AI agents building Verin and the humans reviewing them.
**Rule:** If implementation work contradicts this document, stop and raise the contradiction. Do not resolve it silently in code.

---

## 0. How agents use this document

1. Read §2 (Phase 1 demo contract) and §3 (non-negotiables) before writing code.
2. Find the work in §16 (module map). If it has no obvious home, the work is out of scope or the architecture is incomplete. Escalate either condition.
3. Every PR names the phase (§19), active invariants (§17), and demo behavior (§2) it serves.
4. Invariants are phase-gated. Do not pretend a later-stage invariant is green before its dependencies exist.
5. Anything in §20 is a known risk. Do not convert an unresolved claim into an implementation assumption.
6. The Phase 1 proof is a product experience, not merely a backend. A technically correct engine that does not create the investor “aha” has failed Phase 1.

---

## 1. Product thesis and category

Verin is the **governed decision and execution layer for RIA operations**.

Internally, the long-term product can be understood as an **RIA decision operating system**: a configurable foundation that determines what should happen, why, under whose authority, through which systems, and what evidence proves the result.

It sits above CRM, meeting tools, custodians, and operational applications. Those systems supply evidence, provide staff surfaces, or perform actions. Verin determines what the firm should do as a result.

| System | Role |
|---|---|
| Meeting tools such as Jump and Zocks | capture what was said → evidence |
| CRM such as Salesforce or Wealthbox | store records → evidence + staff surface + execution target |
| Custodians such as Schwab, Fidelity, or Pershing | process instructions → execution target + status source |
| **Verin** | **determines the governed action, explains it, routes authority, coordinates execution, and records what was proven** |

**Do not lead with “CRM-less.”** The near-term category is the decision and execution layer. CRM-optional is a destination reached by making the CRM progressively less central.

**Economic thesis:** stable execution primitives, configurable judgment. A thousand firms should not require a thousand implementations. Firms use shared primitives while configuring approved policy, authority, evidence, and exceptions. If onboarding a new firm requires core-code changes, the transferability thesis has failed.

**Defensible product claim:** Verin produces a governed decision artifact containing the exact evidence snapshot, policy and instruction versions, precedence resolution, disposition, authority requirements, approvals, execution events, and verification state. Existing CRMs, workflow tools, and meeting tools do not provide that combined control record.

---

## 2. Phase 1 demo contract

Phase 1 is an **investor-quality proof of the decision-led model**, not a production implementation of the entire platform.

### 2.1 The seven-minute journey

The canonical demonstration uses one realistic synthetic household and a real Salesforce sandbox execution path.

1. An advisor enters: **“The Smiths need $75,000 for their home renovation by August 15.”**
2. Verin shapes the intent and deterministically resolves the household and relevant accounts.
3. Verin gathers evidence and detects at least one material issue: a recent bank-instruction change, a liquidity requirement, or a conflicting household instruction.
4. Verin presents the recommended path, alternatives considered, missing or conflicting evidence, and the exact policy trace.
5. Verin assigns the required approval structure. The interface makes clear who can approve, how many approvers are required, and whether the requester is eligible to approve.
6. Verin blocks incomplete or unsafe work until the named condition is resolved.
7. After approval, Verin performs a mandatory pre-execution revalidation, reserves the relevant household resources, and invokes the managed Salesforce capability using an idempotency key.
8. Salesforce returns a real status. Verin labels it honestly—for example, `submitted`, not `settled`, when that is all the underlying capability proves.
9. Verin displays the complete decision timeline: evidence, policy, approval, execution, status, unresolved verification obligations, and any derived exception decision.
10. The same request is rerun under Firm B. Firm B’s approved policy produces a materially different, correctly explained outcome with no code change.

### 2.2 Required screens

Phase 1 must include:

- **Household workspace:** people, entities, accounts, instructions, restrictions, recent changes, and pending actions.
- **Intent surface:** conversational entry attached to the household workspace; not a permanent 50/50 chatbot layout.
- **Evidence and conflict view:** source, observed time, freshness, conflicts, missing items, and provenance.
- **Recommendation view:** proposed action, alternatives, explanation trace, blockers, and prohibitions.
- **Policy trace:** the exact active firm policy, household instruction, precedence step, and policy version applied.
- **Authority and approval:** approval stages, quorum, role constraints, requester restrictions, expiration, and escalation.
- **Execution timeline:** planned steps, idempotency key, Salesforce invocation, returned status, retries, and partial failures.
- **Verification state:** what has been proven, what has not, next poll, stuck-state rules, and NIGO or exception arrivals.
- **Examiner-grade record:** printable and exportable decision artifact with immutable identifiers and hashes.
- **Firm A / Firm B comparison:** the same intent and household evidence, with configuration-driven differences highlighted.

### 2.3 One real policy-authoring moment

Phase 1 includes one deliberately narrow natural-language policy path:

> “Always preserve twelve months of planned withdrawals in cash.”

Verin must:

1. Translate the sentence into a structured draft policy AST.
2. Show the exact deterministic meaning of the draft.
3. Simulate it against the synthetic or historical replay corpus.
4. Show which prior decisions would change.
5. Require attributed human approval.
6. Activate an immutable policy version.
7. Rerun the $75,000 request and produce the changed decision.

This is not a generalized policy-authoring product. It is the minimum genuine proof that firm logic can enter the system without a custom code change.

### 2.4 Demo measurement

The demo must emit measured evidence, not slide estimates.

**Primary proof metric:** known-defect detection rate on a labeled replay corpus, expressed as the percentage of known submission defects Verin identifies before execution.

**Corpus provenance rule (normative).** A detection rate measured only against synthetic defects the team authored is circular — it measures whether Verin catches defects Verin was designed to catch, and diligence will identify this in one question. Therefore: (a) the strongly preferred corpus is anonymized real defect history — NIGO returns, custodian rejections, and operational exceptions from AdviceOne's own past submissions, scrubbed of PII before entering fixtures; (b) if any portion of the corpus is synthetic, the reported metric must be split by provenance ("N% on real historical defects, M% on synthetic cases") and never presented as a single blended rate; (c) the corpus version, provenance breakdown, and labeling methodology remain accessible from the reported result. Real defect history is available to this team and turns the demo's weakest number into its strongest.

**Secondary metrics:**

- Time to configure Firm B from an empty firm-policy set to the first correct decision.
- Number of schema or core-code changes required to configure Firm B. Target: zero.
- Number of clarification cycles required for the natural-language policy draft.
- Internal TFIC from intent to governed submitted status. TFIC is an engineering metric, not the primary buyer claim.

### 2.5 Explicitly out of scope for Phase 1

- A complete CRM replacement.
- Generalized autonomous financial advice.
- Full production multitenancy and enterprise administration.
- Multiple custodians.
- A generic workflow builder.
- A generalized natural-language policy compiler.
- Verified settlement or investment when the underlying system only reports submission.
- Broad firm transferability beyond the two-firm configuration proof.

---

## 3. Non-negotiables

These are constitutional. They are not traded against a ship date.

1. **AI proposes; deterministic code disposes.** No LLM output is ever a binding decision, policy, approval, or execution instruction.
2. **No PII crosses the LLM boundary.** Scrubbing occurs at the boundary, not by caller convention.
3. **Disposition and authority are separate concepts.** `blocked` is not an authority level. `prohibited` is not a resolvable block.
4. **Policies are structured, versioned, simulated, reviewed, and approved before they bind.**
5. **Policy configuration uses a constrained typed policy AST and deterministic evaluator.** No arbitrary JavaScript, `eval`, unrestricted expression language, or LLM-generated executable code.
6. **Decision artifacts are append-only and replayable from an immutable input bundle.**
7. **Decision domains are configuration, not core modules.** No `money_movement/` directory in core code.
8. **Firm and household conflicts never resolve by evaluation order.** Precedence is explicit and recorded.
9. **Operational occurrences are ledger events.** A failure, timeout, approval, status change, or NIGO is first recorded as an event; a new derived decision is created only when policy must choose what happens next.
10. **No external action executes without idempotency, pre-execution revalidation, and conflict control.** This applies in Phase 1.
11. **Every request and record is tenant-scoped and actor-attributed.** No global unscoped household, policy, evidence, approval, or execution identifiers.
12. **The investor experience is a first-class deliverable.** Phase 1 is not done when only APIs and tests exist.

---

## 4. The spine

The code implements one pipeline for both human requests and system events:

```text
intent or event
  → shape            (identify action and slot structure; masked input only)
  → bind             (deterministically resolve real entities)
  → evidence         (gather immutable snapshots with freshness and provenance)
  → validate         (sufficient, internally consistent, and fresh enough?)
  → evaluate         (deterministic policy AST + household instructions)
  → disposition      (proceed | blocked | prohibited)
  → explain          (generated from evaluation trace, never post-hoc)
  → authority        (for proceed only: approval stages, quorum, roles, deadlines)
  → approve          (events bound to the exact decision hash)
  → revalidate       (refresh material evidence and invalidate stale approval)
  → reserve          (prevent conflicting concurrent actions)
  → execute          (idempotent execution-target calls)
  → reconcile        (poll status sources and ingest external status events)
  → verify           (close only against configured proof requirements)
```

`validate` is distinct from `evaluate`. Present-but-stale evidence must not produce a confident decision.

A failure or status change always emits a ledger event. The exception policy may then create a derived decision such as retry, reroute, escalate, or remain blocked.

---

## 5. Core domain contracts

TypeScript sketches. Names and distinctions are binding; exact field shapes may evolve through implementation review.

### 5.1 Identity, tenancy, and trigger

```ts
type FirmId = Brand<string, 'FirmId'>;
type ActorId = Brand<string, 'ActorId'>;
type DecisionId = Brand<string, 'DecisionId'>;
type PolicyVersionId = Brand<string, 'PolicyVersionId'>;
type EvidenceSnapshotId = Brand<string, 'EvidenceSnapshotId'>;
type DomainConfigVersionId = Brand<string, 'DomainConfigVersionId'>;

interface TenantContext {
  firmId: FirmId;
}

interface ActorRef extends TenantContext {
  actorId: ActorId;
  roleIds: RoleId[];
}

type Trigger =
  | {
      kind: 'human_request';
      requester: ActorRef;
      requestRef: SecureRequestRef; // raw PII-bearing text remains outside llm/
      maskedRequest: Tokenized<string>;
    }
  | {
      kind: 'system_event';
      firmId: FirmId;
      sourceId: EvidenceSourceId;
      eventType: string;
      eventRef: SecureEventRef;
      tokenizedPayload: Tokenized<Record<string, unknown>>;
    };
```

### 5.2 Evidence snapshot and replay input

A mutable source reference is insufficient for replay. Verin pins immutable evidence bytes or an immutable encrypted snapshot reference.

```ts
interface EvidenceSnapshotRef extends TenantContext {
  id: EvidenceSnapshotId;
  kind: EvidenceKind;
  sourceId: EvidenceSourceId;
  subjectRef: SubjectRef;
  observedAt: Timestamp;
  retrievedAt: Timestamp;
  attribution: string;
  schemaVersion: string;
  encryptedStorageRef: SecureBlobRef;
  contentHash: Hash;
  freshness: 'fresh' | 'stale' | 'unknown';
}

interface DecisionInputBundle extends TenantContext {
  id: DecisionInputBundleId;
  schemaVersion: string;
  canonicalSerializerVersion: string;
  engineVersion: string;
  primitiveSetVersion: string;
  domainConfigVersionId: DomainConfigVersionId;
  policyVersionId: PolicyVersionId;
  householdInstructionVersionIds: HouseholdInstructionVersionId[];
  evidenceSnapshotIds: EvidenceSnapshotId[];
  asOf: Timestamp;
  timeZone: string;
  bundleHash: Hash;
}
```

### 5.3 Disposition, prohibition, and authority

```ts
type ProceedDecision = {
  kind: 'proceed';
  recommendation: Recommendation;
  authority: AuthorityRequirement;
  executionPlan: ExecutionPlan;
};

type BlockedDecision = {
  kind: 'blocked';
  blockers: ResolvableBlocker[];
  // resolving evidence is derived from blockers, never stored twice
};

type ProhibitedDecision = {
  kind: 'prohibited';
  prohibition: Prohibition;
};

type DecisionResult = ProceedDecision | BlockedDecision | ProhibitedDecision;

interface Prohibition {
  source: 'firm_policy' | 'household_instruction' | 'regulatory';
  sourceVersionRef: VersionedSourceRef;
  scope: ScopeRef;
  reasonCode: string;
  explanation: string;
}

type AuthorityRequirement =
  | { mode: 'automatic' }
  | {
      mode: 'approval';
      stages: ApprovalStage[];
    }
  | {
      mode: 'specialist_review';
      specialistRoleIds: RoleId[];
      stages: ApprovalStage[];
    };

// Template (in config): relative expiration
interface ApprovalStageTemplate {
  stageId: string;
  order: number;
  executionMode: 'sequential' | 'parallel';
  requirements: ApprovalRequirement[];
  expiresAfter: Duration;
  escalationPath: EscalationStep[];
}

// Instance (on a decision): absolute expiration, computed at instantiation
interface ApprovalStage {
  stageId: string;
  templateId: ApprovalTemplateId;
  order: number;
  executionMode: 'sequential' | 'parallel';
  requirements: ApprovalRequirement[];
  expiresAt: Timestamp;
  escalationPath: EscalationStep[];
}

interface ApprovalRequirement {
  eligibleRoleIds: RoleId[];
  approvalsRequired: number;
  distinctActorsRequired: boolean;
  requesterMayApprove: boolean;
  priorExecutorMayApprove: boolean;
  reasonRequiredOnOverride: boolean;
}
```

### 5.4 Decision artifact

```ts
interface DecisionRecord extends TenantContext {
  id: DecisionId;
  intentId: IntentId;
  inputBundleId: DecisionInputBundleId;
  result: DecisionResult;
  precedenceTrace: PrecedenceStep[];
  explanationTrace: ExplanationNode[];
  riskClass: RiskClass;
  reversibility: 'reversible' | 'partially_reversible' | 'irreversible';
  reevaluateWhen: RevaluationCondition[];
  derivedFromDecisionId?: DecisionId;
  decisionHash: Hash;
  createdBy: ActorRef | SystemActorRef;
  createdAt: Timestamp;
}
```

A prohibited or blocked decision carries no approval contract or executable plan. A proceed decision must carry authority and an execution plan.

---

## 6. Configurable judgment and the policy AST

Verin is not a workflow builder. It is a deterministic evaluator of approved judgment expressed through reusable primitives.

A domain configuration binds:

- supported intents and actions;
- evidence requirements and freshness;
- primitive invocations;
- policy references;
- household-instruction kinds;
- prohibitions;
- authority mappings;
- execution adapters;
- conflict keys and reservation rules;
- verification rules;
- UI presentation metadata.

### 6.1 Safe policy language

Verin requires a constrained, typed policy language. Calling it an interpreter is acceptable; making it general-purpose is not.

```ts
type ValueNode =
  | { kind: 'constant'; value: string | number | boolean | null }
  | { kind: 'evidence'; evidenceKind: EvidenceKind; path: string }
  | { kind: 'household_instruction'; instructionKind: InstructionKind; path: string }
  | { kind: 'context'; key: AllowedContextKey };

type PredicateNode =
  | { op: 'all'; nodes: PredicateNode[] }
  | { op: 'any'; nodes: PredicateNode[] }
  | { op: 'not'; node: PredicateNode }
  | { op: 'exists'; value: ValueNode }
  | { op: 'is_fresh'; evidenceKind: EvidenceKind; maxAge: Duration }
  | { op: 'compare'; comparator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; left: ValueNode; right: ValueNode }
  | { op: 'in'; value: ValueNode; set: ValueNode[] };

type PolicyEffect =
  | { kind: 'require_evidence'; evidenceKind: EvidenceKind; absence: 'block' | 'specialist_review' }
  | { kind: 'set_parameter'; primitiveId: PrimitiveId; parameter: string; value: ValueNode }
  | { kind: 'require_approval'; templateId: ApprovalTemplateId }
  | { kind: 'block'; blockerCode: string; resolvingEvidenceKinds: EvidenceKind[] }
  | { kind: 'prohibit'; prohibitionCode: string }
  | { kind: 'select_candidate'; primitiveId: PrimitiveId; strategy: AllowedSelectionStrategy };

interface PolicyRule {
  id: PolicyRuleId;
  when: PredicateNode;
  effects: PolicyEffect[];
}

interface PolicyAst {
  schemaVersion: string;
  primitiveSetVersion: string;
  rules: PolicyRule[];
}
```

Allowed operators, paths, context keys, effects, and selection strategies are closed vocabularies validated at load time. The evaluator is deterministic and total: every valid AST either produces a typed result or a typed evaluation error.

**Effect-conflict rule (normative).** Within a single policy version, two rules whose predicates can simultaneously hold may not emit `set_parameter` on the same `(primitiveId, parameter)` or `select_candidate` on the same `primitiveId`. This is rejected at **load time** as a validation error — never resolved by rule order, rule ID, or last-writer-wins at evaluation time. `require_evidence`, `require_approval`, `block`, and `prohibit` are cumulative and may repeat; the most restrictive result governs (prohibit > block > specialist_review, and approval requirements union). Cross-version conflicts do not exist: exactly one policy version is active per firm per domain. This closes the back door through which evaluation-order sensitivity would otherwise re-enter via the AST despite invariant 10.

### 6.2 What is banned

- Arbitrary JavaScript or TypeScript in firm configuration.
- `eval`, dynamic imports, shell calls, SQL fragments, or user-defined functions.
- LLM output executed directly.
- Prompt-only policy behavior that cannot be replayed.
- Domain-specific branches hidden in the evaluator.

---

## 7. The five product layers

| Layer | Owns | Authored by | Versioned |
|---|---|---|---|
| **Decision primitives** | reusable concepts such as eligibility, evidence freshness, account selection, liquidity, thresholds, and conflict resolution | Verin | with platform releases |
| **Firm policies** | the firm’s approved interpretation of primitives | firm; AI may draft | independently, with lifecycle |
| **Household instructions** | household commitments, preferences, restrictions, and approved exceptions | authorized firm staff | independently |
| **Execution adapters** | systems that perform defined actions | Verin | per adapter |
| **Verification rules** | evidence required to establish the actual completion state | firm | with policy or domain config |

Initial target: **under fifteen primitives**. If the number climbs quickly, primitives are probably being invented for one vertical rather than reused across domains.

---

## 8. Ports and adapters

The three port contracts remain separately typed:

```ts
interface EvidenceSource {
  snapshot(query: EvidenceQuery, ctx: TenantContext): Promise<EvidenceSnapshotRef[]>;
  subscribe?(eventTypes: string[], ctx: TenantContext): AsyncIterable<SystemEvent>;
}

interface ExecutionTarget {
  execute(command: ExecutionCommand, ctx: ExecutionContext): Promise<ExecutionReceipt>;
}

interface StatusSource {
  poll(handle: ExecutionHandle, ctx: TenantContext): Promise<StatusObservation>;
}
```

An implementation may satisfy both `ExecutionTarget` and `StatusSource`, but through separate interfaces.

### 8.1 Implementation rule

- Every port contract ships with an in-memory fake from the first phase in which it is used.
- Every real adapter must pass the same conformance suite as the fake.
- Any external action or status shown in the Phase 1 demo must use a real implementation before Phase 1 is declared complete.
- The absence of a real adapter is permitted during earlier waves; it is not permitted in the final Phase 1 demo.

Salesforce is a removable adapter: evidence source, execution target, status source, and temporary staff surface—never the policy or decision engine.

---

## 9. Policy lifecycle and natural-language drafting

```text
draft → simulated → in_review → approved → active → superseded
```

- AI-proposed policy enters at `draft` and cannot skip `simulated`.
- Simulation runs the candidate AST against the replay corpus and reports changed decisions.
- Nothing active is editable. Changes fork a new version.
- Approval is attributed to actor, role, firm, timestamp, and the exact policy hash.
- Every decision input bundle pins an immutable policy version.
- Phase 1 supports one constrained natural-language draft path from §2.3.
- Generalized natural-language authoring remains Phase 2.

The LLM produces a candidate AST plus a human-readable interpretation. The deterministic parser and schema validator either accept the candidate as a draft or reject it. The model never activates policy.

---

## 10. Precedence, blocking, and prohibition

### 10.1 Precedence

- Household instruction may narrow firm policy without exception approval.
- Household instruction may not silently widen firm policy.
- Widening requires the explicit exception authority defined by the firm policy.
- Unresolvable conflicts produce a `blocked` result naming both sources and the resolving authority or evidence.
- Every resolution emits a `PrecedenceStep` with both versioned sources.
- Resolution is order-independent.

### 10.2 Blocked is not prohibited

| State | Meaning | Resolvable? | Approval contract? | Execution plan? |
|---|---|---:|---:|---:|
| `blocked` | may proceed after named conditions are satisfied | yes | no | no |
| `prohibited` | never permitted within the stated scope | no | no | no |
| `proceed` | permitted subject to authority requirements | n/a | yes | yes |

Prohibition short-circuits before authority assignment. A blocked result does not offer an approval button as a substitute for missing evidence.

---

## 11. Authority, approval, escalation, and override

Authority modes:

- `automatic`
- `approval`
- `specialist_review`

Approval is modeled as one or more stages. Stages can be sequential or parallel and may require a quorum of distinct actors.

**Template versus instance.** Approval templates live in firm configuration and carry *relative* expiration (`expiresAfter: Duration`) — a reusable template cannot know the wall-clock time of a future decision. When a decision instantiates a template, each stage's absolute `expiresAt` is computed deterministically from the decision's creation time and recorded on the instance. Replay uses the recorded instance, never re-instantiation.

Every non-automatic stage defines:

- eligible roles;
- number of approvals required;
- whether actors must be distinct;
- whether the requester may approve;
- whether a prior executor may approve;
- expiration;
- escalation path;
- whether a structured reason is required for override.

Approval events bind to `decisionHash` and `inputBundleHash`. Material evidence change, policy change, expiration, or pre-execution revalidation failure invalidates approval and requires a new decision.

An override is not an edit to the decision. It is an append-only approval or exception event containing actor, authority basis, reason code, structured explanation, and affected policy provision.

---

## 12. Append-only ledger and replay

A decision is not the only record in the system. Verin maintains an append-only ledger of distinct event types:

```ts
type LedgerEntry =
  | DecisionRecorded
  | EvidenceSnapshotRecorded
  | ApprovalRecorded
  | ApprovalInvalidated
  | ReservationCreated
  | ReservationReleased
  | ExecutionStarted
  | ExecutionSucceeded
  | ExecutionPartiallySucceeded
  | ExecutionFailed
  | StatusObserved
  | VerificationClosed
  | VerificationStuck
  | ExceptionDecisionRequested;
```

Operational events are never disguised as decisions. An `ExecutionFailed` event may lead policy to request a new derived decision, but the failure event remains independently recorded.

### 12.1 Byte-identical replay contract

Byte-identical replay requires pinning:

- decision schema version;
- canonical serializer version;
- engine version;
- primitive-set version;
- domain-configuration version;
- firm-policy version;
- household-instruction versions;
- immutable evidence snapshots;
- `asOf` time;
- time zone;
- deterministic sort and serialization rules.

Replay does not re-fetch live CRM or custodian data. It loads the exact immutable input bundle and engine version or a compatible archived evaluator.

---

## 13. Concurrency, commitments, and idempotency

Money movement makes concurrency a Phase 1 concern, not a future enhancement.

Before execution, Verin must:

1. Refresh all material evidence.
2. Recompute the input-bundle hash.
3. Invalidate stale approvals.
4. Check pending approved and in-flight actions for the same conflict keys.
5. Create reservations or commitments for constrained resources.
6. Re-evaluate liquidity and policy against those reservations.
7. Generate a stable idempotency key for each external execution step.

```ts
interface ExecutionStep {
  id: ExecutionStepId;
  targetId: ExecutionTargetId;
  command: ExecutionCommand;
  idempotencyKey: string;
  conflictKeys: ConflictKey[];
  reservationRefs: ReservationId[];
  preconditions: ExecutionPrecondition[];
  verificationRuleId: VerificationRuleId;
  compensatingAction?: CompensatingAction;
}
```

The same approved command retried with the same idempotency key must not create a duplicate external instruction.

Reservations are append-only records with expiration and release events. They are not silent in-memory locks.

---

## 14. Execution, events, and verification

An execution plan is an ordered or dependency-aware graph of steps. Each step carries target, idempotency, conflict keys, preconditions, and verification path.

A step may produce:

- accepted;
- rejected;
- partial success;
- timeout;
- unknown;
- duplicate-suppressed.

Every result emits an execution event.

Exception policy then determines whether a new derived decision is needed:

```text
execution/status event
  → classify
  → if no judgment required: continue reconciliation
  → if judgment required: emit ExceptionDecisionRequested
  → evaluate derived decision: retry | reroute | specialist review | remain blocked | stop
```

Verification uses a reconciler rather than trusting a callback. It polls status sources and ingests human-channel status events.

Model at least:

- `Submitted`
- `InFlight`
- `Completed`
- `Rejected`
- `NIGO`
- `Unknown`

A prolonged `Unknown` produces a stuck-state event and, when policy requires judgment, a derived decision.

**Do not claim a stronger state than the underlying source proves.** Submitted is not settled. Signed is not submitted. Submitted is not invested.

---

## 15. PII, tenant isolation, actor security, and observability

### 15.1 Zero-PII LLM boundary

Resolution splits into three stages:

| Stage | Runs where | Sees |
|---|---|---|
| Intent shaping | LLM | masked request and typed slot placeholders |
| Entity binding | deterministic trusted runtime | real firm records |
| Disambiguation | deterministic UI | real names shown to authorized staff outside the model |

Additional rules:

- Scrubbing occurs at the LLM adapter boundary and evidence-to-LLM projection boundary.
- `Tokenized<T>` is constructible only through the scrubbing boundary's factory. A `piiFree` flag proves nothing by itself; a lint/CI rule fails any Tokenized construction or cast outside the scrubber module.
- No type reachable from `llm/` carries a PII-bearing field.
- Policy simulation uses synthetic or approved scrubbed data.
- LLM prompts and traces never log raw PII.

### 15.2 Tenant isolation

Every persisted object and every port call carries `firmId`. Repository APIs require tenant context. Cross-tenant joins are impossible through the normal interface and covered by tests.

### 15.3 Actor authorization

All human actions are attributed to actor and role. Permission checks occur before:

- viewing PII;
- supplying evidence;
- drafting or approving policy;
- approving decisions;
- overriding policy;
- initiating execution;
- viewing audit exports.

### 15.4 PII-safe observability

Logs and traces use record IDs, hashes, reason codes, and tokenized labels. Secrets and external credentials are stored outside configuration and never written to the ledger.

---

## 16. Module map and dependency rules

```text
intake/          human requests + system events → normalized intent
resolution/      masked intent shaping, deterministic binding, human disambiguation
evidence/        source ports, immutable snapshots, freshness, attribution, scrubbing
primitives/      reusable decision vocabulary
policy/          typed policy AST, evaluator, lifecycle, simulation, NL draft validation
household/       independently versioned household instructions
precedence/      firm-vs-household resolution, blockers, prohibitions
decision/        DecisionRecord creation, explanation trace, risk, reevaluation conditions
authority/       approval templates, stages, quorum, escalation, override contracts
ledger/          append-only event ledger and projections
replay/          input bundles, canonical serialization, engine-version replay
concurrency/     conflict keys, commitments, reservations, pre-execution revalidation
execution/       execution plans, target ports, idempotency, compensating actions
verification/    status-source ports, reconciler, stuck-state detection
security/        tenancy, actor authorization, PII-safe access boundaries
llm/             intent shaping and policy drafting only
config/          domain configs, firm policies, household instructions, adapter bindings
api/             Fastify transport; no domain logic
ui/              household and decision workspaces; no binding logic
```

**Dependency rules:**

- `llm/` is imported only by masked intent-shaping and policy-draft paths.
- `decision/`, `precedence/`, `authority/`, `execution/`, and `verification/` never import `llm/`.
- `decision/` depends on primitives, policy, household, precedence, and evidence—not execution adapters.
- `execution/` consumes immutable proceed decisions; it does not decide policy.
- `ledger/` records typed events and exposes projections; other modules do not mutate prior records.
- No module imports from `config/`; configuration is parsed, versioned, and injected.
- No core module name is a decision domain.
- `ui/` may render domain-specific labels from configuration but may not contain domain decision branches.

---

## 17. Phase-gated invariants

Invariants activate when their prerequisites exist. CI reports **active**, **not-yet-active**, or **failed**—never fake green.

### Foundation invariants

1. No PII-bearing type is reachable from `llm/`.
2. Every persisted record and repository operation is tenant-scoped.
3. No core module, directory, or evaluator branch is named for a decision domain.
4. Import boundaries match §16.
5. Ledger records are append-only.

### Decision-core invariants

6. Policy evaluation is a pure function of an immutable `DecisionInputBundle` and a deterministic engine version.
7. A proceed decision cannot exist without authority and an execution plan.
8. A blocked decision cannot carry authority or an execution plan.
9. A prohibited decision cannot carry a resolving condition, authority, or execution plan.
10. Precedence is order-independent and every conflict emits a trace.
11. A decision with blocking evidence gaps cannot proceed automatically.
12. Explanation is derived from the evaluation trace.
13. Replay from the pinned bundle is byte-identical under canonical serialization.

### Policy invariants

14. No policy reaches approved without a recorded simulation run.
15. No active policy is mutable.
16. Firm policy configuration contains no arbitrary executable code.
17. LLM output cannot directly activate or bind policy.

### Approval and execution invariants

18. Every non-automatic approval stage defines role eligibility, quorum, actor-distinctness, expiration, and escalation.
19. Approval invalidates on material input-bundle hash change.
20. Every external execution step has an idempotency key and verification rule.
21. Pre-execution revalidation occurs after approval and before external execution.
22. Conflicting pending or in-flight actions are considered through conflict keys and reservations.
23. Every execution and status occurrence is recorded as a ledger event.
24. A failure becomes a derived decision only when policy requires judgment; it never disappears into logs alone.
25. Every real adapter and fake passes the same conformance suite.

### Demo invariants

26. The identical $75,000 request produces different correct results for Firm A and Firm B with zero core-code change.
27. The UI distinguishes blocked, prohibited, approved, submitted, and verified states.
28. Every external status claim shown in the demo is backed by a real adapter response.
29. The constrained natural-language policy path results in a structured draft, simulation, approval, version activation, and changed replay outcome.
30. The printable decision record can be reconstructed entirely from ledger and replay artifacts.

---

## 18. Stack and conventions

- **Runtime:** TypeScript and Node.
- **API:** Fastify.
- **Store:** SQLite in WAL mode for Phase 1; append-only ledger tables plus immutable snapshot storage.
- **UI:** React and Vite.
- **Schemas:** Zod at every external, persistence, configuration, and LLM boundary. Parse, do not merely validate.
- **LLM access:** OpenAI-compatible adapter. Model-agnostic by construction; a local-model path remains possible.
- **Tests:** Vitest. Phase-gated invariant suite runs first.
- **Property tests:** required for precedence order independence, idempotency, replay, and concurrency cases.
- **Import boundaries:** dependency-cruiser or eslint-plugin-boundaries in CI.
- **Salesforce:** invocable Apex and permitted read APIs only. Do not place decision logic in Salesforce or modify managed flows merely to accommodate Verin.
- **Configuration:** typed, versioned, loaded at boot; hot-reload in development only.
- **Canonical serialization:** explicit package and version, with deterministic key ordering and timestamp normalization.
- **Migrations:** forward-only database migrations; prior ledger and snapshot records remain readable.

---

## 19. Product phases

### Phase 1 — Prove the decision model

One polished money-movement vertical on top of the managed Salesforce application.

Must show:

- ambiguous intent;
- deterministic entity resolution;
- immutable evidence and freshness;
- firm and household logic;
- explicit precedence;
- proceed versus blocked versus prohibited;
- realistic approval structure;
- pre-execution revalidation and reservation;
- idempotent real Salesforce invocation;
- honest returned status;
- complete ledger and replay record;
- one constrained natural-language policy change;
- Firm A versus Firm B with zero code change;
- measured known-defect detection.

### Phase 2 — Govern production operations

Existing managed workflows become execution primitives directed by Verin. Verin owns the decision record, policy evaluation, approval state, execution coordination, exception decisions, and verification. Generalized policy authoring, production commitments, broader household graph, enterprise identity, and stronger operational resilience land here.

### Phase 3 — CRM-agnostic and increasingly CRM-optional

Additional CRM, custodian, meeting, and operational adapters sit behind the same contracts. Verin becomes the primary location for operational judgment, policy, execution state, and verified outcomes.

---

## 20. Known risks — do not paper over these

1. **This can resemble a generic business-rules engine.** The differentiation must remain the governed decision artifact, institutional judgment, and verified execution—not merely configurable conditions.
2. **The policy AST may become a workflow language in disguise.** Keep effects closed and execution mechanics outside policy.
3. **The primitive vocabulary may overfit money movement.** Cross-validate each primitive against account opening, trading, life events, and client service before treating it as stable.
4. **Natural-language policy drafting may create false confidence.** The structured interpretation, simulation delta, and approval step must be visible.
5. **Transferability remains unproven.** Firm B is an architectural proof, not market validation. Firm #3 remains the real test.
6. **Verification can become theater.** Never infer settlement, completion, or investment from a weaker status.
7. **Concurrency errors can cause real financial harm.** Two individually valid decisions may be jointly invalid.
8. **Human review is the bottleneck.** Agents accelerate code, not the encoding of correct operating judgment.
9. **A polished UI can conceal fake mechanics.** Every simulated element is labeled; every claimed external status is real.
10. **The demo can be overbuilt.** The Phase 1 contract is deliberately narrow. Additional domains are evidence for primitives, not extra product surfaces.
11. **Ownership and IP structure must be clean before investor diligence.** Code, playbooks, managed-package rights, and contribution history must be unambiguous.

---

## 21. Phase 1 definition of done

### Product experience

- [ ] The canonical seven-minute journey runs without developer intervention.
- [ ] The household workspace, evidence view, recommendation, policy trace, approval, execution timeline, verification state, and audit record are polished and coherent.
- [ ] The UI visibly distinguishes proceed, blocked, prohibited, submitted, NIGO, and verified states.
- [ ] The conversation is contextual, not the entire interface.

### Decision proof

- [ ] Identical $75,000 requests through Firm A and Firm B produce two correct, differently explained outcomes with zero core-code changes.
- [ ] One case blocks on a resolvable condition.
- [ ] One case refuses a prohibition.
- [ ] One case requires multiple distinct approvers.
- [ ] One case invalidates approval after material evidence changes.
- [ ] One system event and one human request converge on the same downstream pipeline.
- [ ] One narrow natural-language policy is drafted, simulated, approved, activated, and changes the rerun outcome.

### Execution integrity

- [ ] Pre-execution revalidation runs after approval.
- [ ] Concurrent requests cannot overcommit the same liquidity reserve.
- [ ] Retrying the same command does not create a duplicate Salesforce instruction.
- [ ] A real Salesforce capability is invoked.
- [ ] A real returned status is displayed and accurately labeled.
- [ ] A partial failure or timeout is recorded as an event and produces a derived decision only when policy requires one.
- [ ] A delayed NIGO or equivalent external exception can enter the ledger and reopen judgment.

### Audit and replay

- [ ] Printable decision artifact includes immutable evidence snapshots, policy and instruction versions, precedence trace, approval events, execution events, and verification state.
- [ ] Replay is byte-identical from the pinned input bundle and engine version.
- [ ] Actor, role, firm, and timestamp attribution exist for every human action.
- [ ] No PII enters LLM prompts or traces.

### Measurement

- [ ] Known-defect detection rate is measured on a labeled replay corpus.
- [ ] Time to configure Firm B is measured.
- [ ] Firm B requires zero schema or core-code changes.
- [ ] TFIC is measured as an internal engineering metric.

### Architecture

- [ ] All active Phase 1 invariants are green.
- [ ] Every real and fake adapter passes the same conformance suite.
- [ ] Zero domain-named core modules or evaluator branches.
