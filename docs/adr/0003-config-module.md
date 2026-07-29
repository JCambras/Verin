# ADR-0003: One Zod-validated config module, fail-at-boot, no process.env outside it

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #7, #12, #15
**Informed by:** retro-r7 do-again #31; don't-again #24 (`SF_COOKIE_SECRET || "…change-in-prod!!"`, hardcoded firm identity, scattered env reads)

## Context

Meridian scattered `process.env` reads and shipped secret fallbacks and hardcoded firm identity. Iris
centralized config into one Zod module that crashes at boot on invalid config — "textbook defense in
depth." Iris still leaked one `process.env` read into a domain file because the dependency fence checked
imports, not raw env reads.

## Decision

All environment access lives in `src/infrastructure/config` and nowhere else (fence: `no-process-env`,
scans file *contents*, Phase B). One Zod schema validates and caches config; `getConfig()`
throws `FATAL: invalid configuration` at boot on any invalid/missing value. Production-specific
`superRefine` guards refuse to boot when a dangerous config is present (e.g. a placeholder session/e-sign
secret in production, a non-postgres store driver in production, missing store DSN). No secret has a
hardcoded fallback. Validation runs on raw values, but the cached `Config` exposes the database URL,
session secret, and e-sign secret only as `SecretValue`s. Serialization, string conversion, and
inspection reveal `[REDACTED]`; spread and enumeration expose no raw property. Raw access is the free
function `revealSecret()`, fence-allowlisted to the exact HMAC consumers. Validation diagnostics contain
static messages and field paths, never rejected secret values. Domain code receives config/flags by
injection, never by reading env.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Read `process.env` where needed | The Meridian disease — scattered, unvalidated, fallback-prone. |
| Validate lazily / warn on bad config | A misconfigured production boot must fail closed, not degrade silently. |

## Trade-offs and Costs

- **Gained:** one validated source of truth; fail-closed production; no scattered env, secret fallbacks,
  or serializable secret-bearing config objects.
- **Sacrificed:** config must be threaded/injected rather than read ad hoc.

## Consequences

The `no-process-env` fence enforces the boundary by scanning contents (closing Iris's seam). `.env.example`
is placeholder-only; CI fails on live org domains/credentials (ADR-0017, charter #7).

## Revisit When

Config surface grows enough to warrant per-domain config slices, or a secrets manager (e.g. 1Password/KMS)
replaces env-sourced secrets.
