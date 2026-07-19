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
  execution state (a durable `flow_execution` record with `status = 'suspended'`, the resume `token`, and
  the accumulated context) and returns to the caller (HTTP 202 / `FLOW_SUSPENDED`).
- An external event (a webhook, an approval, a signature) calls **`resume(token, payload)`**; the engine
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

## Revisit When

Resume needs to survive very long waits with SLAs (add scheduled reminders/escalation), or a durable
workflow engine (Temporal-class) is warranted by flow complexity (scale-ladder ADR-0015).
