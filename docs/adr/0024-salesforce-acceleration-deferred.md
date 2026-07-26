# ADR-0024: Salesforce acceleration DEFERRED - fakes carry every wave until sandbox access

**Status:** Accepted (deferral with named un-defer trigger; amends the charter SoR section additively)
**Date:** 2026-07-26
**Deciders:** captain (Salesforce directive, 2026-07-26: "Salesforce MCP is going to have to wait, let's do everything else we can without that"), founding architect
**Relates to:** charter SYSTEM-OF-RECORD STRATEGY ("zero SF adapter code now"); charter #5 (nothing built-but-not-shipped); ADR-0023 (v3 adoption); ADR-0027 (labeled fakes); v3 §8.1 (implementation rule), prompt-sequence prompt 27 (hard stop), orchestrator rule 6
**Informed by:** `docs/v3/marriage-map.md` conflict C4 and the captain Salesforce directive recorded there

## Context

The charter's SoR strategy (marked "DECIDED - do not reopen") ships the house CRM as system of record
and explicitly forbids writing Salesforce adapter code now; Salesforce was roadmapped as a later,
Wave 3 adapter. The v3 architecture reverses the timing: Phase 1 COMPLETION requires a **real Salesforce
sandbox execution path** - prompt 27 is a hard stop ("if sandbox access is unavailable, mark Prompt 27
blocked... do not declare Phase 1 complete or show fake status as real"), and demo-contract §8 gates
completion on a real invocation and real returned status. That is a genuine charter-level reversal
(marriage-map C4) - and it collides with a fact: **sandbox access is not yet available**. Provisioning a
sandbox org, managed-package scope, and the invocable Apex surface are captain-level external
dependencies (marriage-map §8).

The captain ruled on 2026-07-26: Salesforce waits; everything else proceeds without it.

## Decision

**Accept v3's Salesforce requirement as ratified direction, and DEFER its execution with a named
trigger** - the charter's own deferral idiom (deferrals are explicit, named in an ADR with the trigger
that un-defers them; never silent):

1. **The charter's "zero SF adapter code now" stands.** No Salesforce adapter, client, or mapping code
   is written before the trigger fires. The existing `sf-mapping` documentation groundwork (charter
   rule 2) continues as documentation only.
2. **In-memory fakes carry every wave** (v3 §8.1: every port contract ships with an in-memory fake from
   the first phase in which it is used). The three separately-typed ports (EvidenceSource,
   ExecutionTarget, StatusSource) and their shared conformance suite (prompt 24) are built against
   fakes; the real adapter must later pass the SAME suite.
3. **Prompts 27 (sandbox archaeology + real adapter) and 28's real-path assembly are DEFERRED.**
   **Un-defer trigger: Salesforce sandbox access granted** (org provisioned, managed-package scope and
   invocable Apex surface reachable). When it fires, prompt 27 runs to the letter, including its
   conformance-suite obligation.
4. **Phase 1 is NEVER declared complete on fakes** (orchestrator rule 6). v3 invariant 28 ("every
   external status claim shown in the demo is backed by a real adapter response") stays
   **not-yet-active** in `v3-invariants.json` until the real adapter lands, and the demo-contract §8
   completion items requiring real Salesforce are deferred-pending-sandbox. Until then, no demo shows a
   fake status as real (ADR-0027's labeling rule makes that mechanical).

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Build the SF adapter now against public API docs, integrate when access arrives | Violates the standing "zero SF adapter code" rule and charter #5 (dead code until sandbox exists); prompt 27's archaeology-first order exists precisely because the managed package's real surface is unknown - code written blind would be speculation. |
| Declare Phase 1 completable on the in-memory fake | Violates v3's hard stop, orchestrator rule 6, invariant 28, and demo-contract §8; it is exactly the "fake data presented as real" failure the adversarial audit (prompt 30) hunts. |
| Pause the whole v3 build until sandbox access | Wastes the ~26 prompts that need no Salesforce; the captain directive explicitly orders "everything else we can without that". |
| Reopen the SoR strategy and make Salesforce the SoR now | v3 itself keeps Salesforce a removable adapter ("never the policy or decision engine", §8.1); the house CRM remains the first in-memory EvidenceSource (prompt 14). |

## Trade-offs and Costs

- **Gained:** the build proceeds at full speed on fakes with honest gates; the charter's discipline
  (explicit deferral, named trigger) is preserved through a genuine strategy reversal; no speculative SF
  code rots while access is pending.
- **Sacrificed:** Phase 1 completion date is hostage to an external dependency; Gate G and the investor
  demo's "real execution" minute cannot be rehearsed end-to-end until the trigger fires; conformance-suite
  gaps against the REAL adapter surface will only surface late (mitigated by prompt 27's
  archaeology-before-implementation order).

## Consequences

- `CHARTER.md`'s SoR section gains an additive AMENDMENT paragraph referencing this ADR (same PR, per
  the operating model). The "do not reopen" core - house CRM as SoR, port as the boundary - is untouched.
- `v3-invariants.json` records invariant 28 as not-yet-active with this deferral named in its activation
  condition; the v3-invariants CI report shows it distinctly (never green).
- Whose org / provisioning path / managed-package scope / Apex surface remain open captain questions
  (marriage-map §8) - they are the trigger's substance.

## Revisit When

- **Sandbox access granted** (the un-defer trigger): schedule prompt 27 immediately; its Gate G
  completion flips the deferred demo-contract §8 items live and lets invariant 28 activate.
- Six months pass without sandbox access: escalate to the captain - either the provisioning path
  changes, or Phase 1's execution target is re-scoped by a new ADR (a decision only the captain makes).
- The managed package's capability inventory (prompt 27 deliverable) contradicts demo-contract
  assumptions (e.g. it proves less than `submitted`): raise as an architecture contradiction, never
  paper over (v3 §14 "do not claim a stronger state than the underlying source proves").
