# ADR-0011: Human-in-the-loop in the core contract — FlowStep suspend / await-external / resume

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiable #6; deliverable E
**Informed by:** retro-r7 missing-prompt #9; AUDIT.md Strategic ("FlowStep is execute-to-completion … recommend an ADR before more flows accrete assumptions that steps never pause") — Iris's self-admitted *largest architectural gap*

## Context

Iris's engine ran all steps to completion in one request; there was no suspend/await-input/resume, no
continuation persistence. Retrofitting async human-in-the-loop across many flows later is far more
expensive than designing it once. The charter requires the FlowStep contract to support
suspend/await-external-input/resume **before any flow is authored**, proven end-to-end.

## Decision

The `FlowStep` / execution model has a first-class **suspended** state and a persisted continuation:

- A step may return `suspend({ token, awaiting })` instead of completing. The engine persists the flow's
  execution state (a durable `flow_executions` record with `status = 'suspended'`, the resume `token`, and
  the accumulated context) and returns to the caller (HTTP 202 / `FLOW_SUSPENDED`).
- An external event (a webhook, an approval, a signature) calls **`resumeFlow(token, payload)`**; the engine
  loads the persisted continuation, validates the token, and runs the remaining steps.
- Resume is **idempotent** (ADR-0009): resuming with the same token/payload twice yields exactly-once effect.

The walking skeleton proves this end-to-end: account opening suspends at the e-sign step (fire-and-return),
a simulated e-sign **webhook** resumes it, and the finalize write is audited + exactly-once.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Execute-to-completion engine (Iris) | Cannot model signatures/approvals; retrofitting across flows is the expensive path. |
| Client-held draft state as "resume" (Iris fact-find) | Not engine suspension; loses server-side continuation, auditability, idempotency. |
| Long-poll/block the request until the webhook | Not scalable; ties up a request for minutes/hours; app tier must stay stateless. |

## Trade-offs and Costs

- **Gained:** signatures/approvals/webhooks are modeled natively; the contract is right before flows accrete.
- **Sacrificed:** continuation persistence + token/idempotency machinery in the engine core.

## Consequences

Fence: `flowstep-suspend-resume` proves the engine has a suspended state and a resume path (not a stub).
Pairs with ADR-0009 (idempotent resume) and ADR-0007 (audited finalize). Charter-map id 6.

## Deferred hardening (explicit, with triggers — D-021)

Pre-suspend writes (`createHousehold`/`createContact`/`createApplication`/`setEsignRequested`) carry
per-execution idempotency keys (`<step>:<executionId>`), so retrying the SAME execution replays its
committed writes instead of duplicating them.

**Cross-submit dedup: UN-DEFERRED (D-027).** The flow-start route now requires a client-minted
per-form-session UUID (`clientRequestId`), used as the executionId: a double-submit (network retry,
second tab) resolves to the SAME execution — the route reports its current state (org-checked) instead
of starting a duplicate. A replayed id whose execution FAILED is re-driven from its saved cursor
(`retryFlow` — the start-path mirror of resume's Vale V7 retry; the per-write keys make it replay-safe),
so a transient mid-start failure is recoverable by resubmitting instead of dead-ending. Only the
concurrent race loser's own PK conflict (SQLSTATE 23505) resolves as a replay; any other start failure
surfaces as a typed error, including a storage throw during the re-drive itself (mapped to a typed
AppError, never an unenveloped 500). A replayed id is honored only for an IDENTICAL payload: a resubmit
with edited input under the same id is rejected with a typed `CONFLICT` instead of silently replaying
the stale submission, and the client re-mints its request id after any failed response, so an edited
resubmit becomes a genuinely new execution. Locked by integration specs (same id → one household + the
same resume token; a different id → a genuinely new execution; a failed start → re-driven, still one
household; an edited resubmit → CONFLICT, no stale write, no duplicate).

Two recovery paths remain deferred:

- **Compensation** — a transient failure after `createHousehold` commits still leaves the created rows
  behind if the user abandons and re-submits (a NEW execution mints new keys); no automatic rollback of
  a partially-created execution exists.
- **Retry-by-execution-id** — resume is token-keyed only. A crash in the window between the suspending
  step's commit (`setEsignRequested`) and the suspended-state save leaves the execution `running` with a
  NULL resume_token: the webhook finds the application but `loadByToken` returns null, and `resumeFlow`
  refuses `running` — wedged until a retry-by-execution-id path (which the per-write keys already make
  replay-safe) exists.

**Un-defer trigger:** the first flow whose pre-suspend writes create externally-visible obligations
(real custodian/e-sign vendors), or the first production incident requiring manual flow recovery.

## Revisit When

Resume needs to survive very long waits with SLAs (add scheduled reminders/escalation), or a durable
workflow engine (Temporal-class) is warranted by flow complexity (scale-ladder ADR-0015).
