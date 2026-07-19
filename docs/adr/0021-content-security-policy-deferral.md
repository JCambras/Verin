# ADR-0021: Content-Security-Policy — deliberate deferral with a deployment trigger

**Status:** Accepted
**Date:** 2026-07-19
**Deciders:** Founding architect; captain (D-020)
**Relates to:** Charter non-negotiables #14, #15; OWASP ASVS 14.4

## Context

Every response already carries X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, and HSTS
(`next.config.ts`), but no Content-Security-Policy. Without CSP, any future XSS foothold executes
unrestricted against a session-cookie-authenticated compliance app. A REAL CSP in Next.js is not a
header one-liner: Next inlines scripts, so an effective policy needs a per-request nonce threaded
through middleware and the root layout (or a strict-dynamic hash strategy) — deliberate work that must
be built and e2e-verified, not pasted.

## Decision

DEFER shipping CSP; record the deferral here rather than shipping a decorative `unsafe-inline` policy
(a policy that permits inline script is compliance theater and would freeze a false sense of safety
into the header list). The current XSS surface is bounded meanwhile: React escapes by default, the app
renders no user-supplied HTML, and the session cookie is httpOnly.

**Un-defer trigger:** before the FIRST real (internet-facing) deployment, implement a nonce-based CSP
(middleware-generated nonce, `script-src 'nonce-…' 'strict-dynamic'`, `object-src 'none'`,
`frame-ancestors 'none'`) with an e2e assertion that every page loads clean under it.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Ship `script-src 'unsafe-inline'` now | Decorative; permits exactly the injection CSP exists to stop. |
| Nonce CSP this round | Real work competing with the review round's correctness fixes; the trigger is explicit. |

## Trade-offs and Costs

- **Gained:** an honest posture (no theater header) and a written trigger review cannot miss.
- **Sacrificed:** no CSP defence-in-depth until the trigger fires.

## Revisit When

The un-defer trigger fires (first internet-facing deployment), or any feature renders user-supplied
rich content (raises XSS surface — implement immediately).
