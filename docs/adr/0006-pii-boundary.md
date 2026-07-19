# ADR-0006: PII boundary at the use-case layer

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #3, #13; SOC 2 Confidentiality/Privacy
**Informed by:** retro-r7 do-again #33; don't-again #20 (PII unencrypted, PII-access logging shipped-but-unwired)

## Context

Meridian never encrypted PII at rest and shipped a PII-access audit that was "infrastructure-complete but
unwired." Iris placed a PII boundary at the use-case layer with `assertNoPII()` as a machine-readable spec
and scrubbing at three crossings. The domain keeps precise PII for the UI; it is scrubbed at the edges.

## Decision

`contracts/pii.ts` defines field-name and value patterns (SSN, DOB, PAN with a Luhn backstop, phone,
email) and `assertNoPII(payload, boundary)` which throws `PII_VIOLATION` on any residue. PII is scrubbed
at three enforcement points: (1) the **audit write** boundary (before every audit entry is persisted —
so before/after snapshots never store raw SSN/DOB); (2) any **LLM prompt** boundary (deferred until an AI
surface is wired — no AI scaffolding now, charter #5); (3) the **API response** boundary (client bodies
carry masked PII, never raw). The house-CRM store holds identity PII (it is the SoR); the audit/analytics
stores never do (a fence rejects PII-named columns there). Masked PII is allowed in the advisor UI by
design.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Scrub at the DB layer only | Too late; PII would already be in logs/audit/prompts. |
| No structured PII policy (Meridian) | Unencrypted at rest, unwired access logging — a confidentiality failure. |

## Trade-offs and Costs

- **Gained:** PII never leaks into audit, logs, or client bodies; `assertNoPII` is a testable spec.
- **Sacrificed:** boundary crossings must call scrub/assert; value-pattern tuning to avoid over-redaction.

## Consequences

Fences (Phase B/E): PII-not-in-audit-store, audit-entry-scrubbed. Escape-at-render, not at storage
(ADR-0007 records the raw-domain value and scrubs the *audit copy*, avoiding Iris's double-escape bug).

## Revisit When

An AI/LLM surface is wired (activate the prompt boundary), or a field-level encryption scheme for PII at
rest is added (WISP technical control).
