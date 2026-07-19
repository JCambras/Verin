# ADR-0008: Real identity — credential+session auth behind an identity port, RBAC at the port

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect; captain (D-002, D-007)
**Relates to:** Charter non-negotiable #12; SOC 2 CC6
**Informed by:** retro-r7 don't-again #19 (RBAC role from client `x-user-role` header), #41 (RBAC only in demo mode, phantom role); missing-prompt #10

## Context

The charter requires real authentication in the walking skeleton — no transitional session bootstrap, no
password constants, no secret fallbacks — with server-side RBAC at the port and identity never
client-trusted. Iris trusted a client-controlled role header and had RBAC that "existed only in demo mode."

## Decision

Build real credential + server-side session auth now, **behind an `IdentityPort`** (captain D-002), so a
WorkOS/Auth0 swap later is an adapter change. Passwords hashed with Node `crypto.scrypt` (D-007). Sessions
are server-side records keyed by an opaque id in a **secure, httpOnly, SameSite** cookie signed/encrypted
with `SESSION_SECRET` (32+ chars, no fallback); sessions have server-enforced **expiry + rotation** and a
**revocation** list (logout). Identity is resolved in exactly one place (`resolveSession`) from the cookie,
never from a client-supplied role/identity header. **RBAC is enforced server-side at the port**: the roles
enum lives in `contracts/roles.ts`; port calls check `requireRole`. Design is SSO/OIDC-ready (the port
abstracts credential vs. federated identity).

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Adopt WorkOS/Auth0 now | External dependency + cost before an enterprise SSO customer exists; the port keeps it a clean later swap. |
| Client-supplied role header (Iris) | Forgeable; a tenancy/authz bypass. Rejected outright. |
| Demo/transitional auth in the skeleton | Charter #12 forbids it; the falsifier will attempt an authz bypass. |

## Trade-offs and Costs

- **Gained:** real auth from day one; no vendor lock-in for the PoC; RBAC that holds under an authz-bypass attempt.
- **Sacrificed:** we own session/credential code now (built to be swappable).

## Consequences

Fences (Phase B/E): auth-enforcement (every exported HTTP handler AND Server Action resolves a session;
no fallback role), no-client-role-header, org-id-required. Step-up auth for sensitive actions is a later
flow concern. SSO/OIDC adapter is deferred with a trigger.

## Deferred hardening (explicit, with triggers)

- **Login rate limiting / lockout / per-IP throttling (D-015).** Failed authentications ARE audited now
  (`session.login_failed`, attributed to the matched account's org and userId; unknown emails are
  logged without the email), so credential-stuffing attempts leave a record — but online guessing is
  bounded only by scrypt cost. **Trigger:** before the first pilot with real users.
- **Org-qualified login (Sable F3).** `findUserByEmail` resolves deterministically (oldest account
  wins, `ORDER BY created_at, id`) so an email collision across orgs cannot lock out the original
  user; a login that carries the org explicitly is the real fix. **Trigger:** the first customer org
  whose users share emails with another org.

## Revisit When

The first enterprise customer requires SAML/SSO (build the federated adapter behind `IdentityPort`), or a
password-policy/MFA requirement lands (extend the credential adapter).
