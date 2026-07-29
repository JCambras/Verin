# ADR-0006: PII boundary at the use-case layer

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #3, #13; SOC 2 Confidentiality/Privacy
**Informed by:** retro-r7 do-again #33; don't-again #20 (PII unencrypted, PII-access logging shipped-but-unwired)

## Context

Meridian never encrypted PII at rest and shipped a PII-access audit that was "infrastructure-complete but
unwired." Iris placed a PII boundary at the use-case layer with a machine-readable assertion and
edge scrubbing. The domain and system of record retain precise PII for authorized UI/API use; audit,
operational telemetry, and model boundaries do not.

## Decision

`contracts/pii.ts` defines the shared field-name, credential, person-word, phone/email/SSN, and
separator-aware account-reference shapes. `assertNoPIIValues(payload, boundary)` throws
`PII_VIOLATION` when PII survives scrubbing. The **audit write** boundary scrubs before/after snapshots
and detail before persistence. The **observability** boundary accepts only typed, derived vocabularies
and sealed identifiers; request-derived record UUIDs become keyed tenant/field digests rather than raw
telemetry. The **LLM prompt** boundary accepts only scrubber-minted `Tokenized<T>` values, while the
evidence-to-LLM projection binds complete sensitive spans to opaque slots and refuses residual names or
unbroken, spaced, or hyphenated account references (ADR-0031). Fences prove no `PIIBearing`-marked type is
reachable from `src/infrastructure/llm/`. Authorized API/UI surfaces may return the PII they exist to
display, but governed reads require a sealed `ActionGrant<"pii.view">`; there is no generic response
masking helper until a real surface requires one (D-028).
The house-CRM store holds identity PII (it is the SoR); the audit/analytics
stores never do (a fence rejects PII-named columns there). Masked PII is allowed in the advisor UI by
design.

**Actor attribution (D-014):** the audit `actor` and OTel span attribution are the user's opaque
`userId`, never the raw email — an email in the append-only audit_log or an exported span attribute
would be un-deletable PII at exactly the boundaries this ADR closes. Display surfaces (audit view,
console, nav) resolve userId → email at render time.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Scrub at the DB layer only | Too late; PII would already be in logs/audit/prompts. |
| No structured PII policy (Meridian) | Unencrypted at rest, unwired access logging — a confidentiality failure. |

## Trade-offs and Costs

- **Gained:** PII never leaks into audit, operational telemetry, model requests, or unauthorized client
  bodies; the shared predicates and runtime seals are testable specifications.
- **Sacrificed:** boundary crossings must call scrub/assert; value-pattern tuning to avoid over-redaction.

## Consequences

Fences: `no-pii-in-audit-store`, `observability-vocabulary`, `llm-pii-boundary`,
`tokenized-factory-only`, and `governed-actions`. Escape-at-render, not at storage (ADR-0007 keeps the
raw domain value in the SoR and scrubs the *audit copy*, avoiding Iris's double-escape bug).

## Revisit When

The first production LLM caller lands (prompt 13, activating the prompt boundary the projection layer
already shipped per ADR-0031), or a field-level encryption scheme for PII at rest is added (WISP technical
control).
