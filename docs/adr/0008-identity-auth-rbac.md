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

Build real credential + server-side session auth now, **behind an identity port** (captain D-002; today
the `src/infrastructure/identity` module boundary; a named `IdentityPort` interface is extracted with
the first alternative provider), so a
WorkOS/Auth0 swap later is an adapter change. Passwords hashed with Node `crypto.scrypt` (D-007). Sessions
are server-side records keyed by an opaque id in a **secure, httpOnly, SameSite** cookie HMAC-signed
with `SESSION_SECRET` (32+ chars, no fallback); sessions have server-enforced **expiry**, a **revocation**
list (logout), and **sliding renewal with id rotation** (below). Identity is resolved in exactly one place
(`resolveSession`) from the cookie, never from a client-supplied role/identity header. **RBAC is enforced
server-side at the port**: the roles enum lives in `contracts/roles.ts`; port calls check `requireRole`.
Design is SSO/OIDC-ready (the port abstracts credential vs. federated identity).

### Session lifecycle: expiry + revocation + sliding renewal with rotation (charter #12 "rotation")

Charter #12 names "secure cookies, **rotation**, expiry"; the walking-skeleton shipped expiry + revocation
but not rotation/renewal (deep-review r6 finding #8 - an unrecorded gap, closed here). The single
identity-read chokepoint now does all three:

- **Sliding renewal.** When a resolved session has passed the halfway mark of its TTL, `expires_at` is
  extended by a fresh full TTL and the cookie is re-set (`maxAge` refreshed). An active user never hits a
  hard 60-minute logout mid-workday; an idle one still expires on schedule. Half-TTL is the trigger:
  frequent enough to always stay ahead of expiry, rare enough that the vast majority of requests do zero
  extra writes. The decision is driven off the already-selected `expires_at` + config TTL, so the pinned
  identity-read SELECT is unchanged (the org-id-required reviewed escape holds without an edit).
- **Rotation on renewal.** Each renewal issues a NEW opaque session id in one atomic `UPDATE` (id +
  `expires_at` together; nothing references `sessions.id`, so rotating the PK is safe), mitigating session
  fixation. `created_at` is preserved so the original login instant survives a rotation (a future
  absolute-lifetime cap). Login already mints a fresh id, so fixation at the privilege boundary was
  already covered; this satisfies the charter's periodic-rotation word.
- **Where.** Read-only callers that cannot set a cookie (the server-component `/app` guard, logout) use
  `resolveSession` and never rotate. The mutating/API chokepoint (`requirePrincipal`) uses
  `resolveAndRenewSession`, which returns the rotated cookie for the app layer to persist on the response
  (`cookies().set`, valid in a Route Handler / Server Action). Renewal + rotation stay entirely inside the
  identity chokepoint, so the auth-enforcement / org-id-required / audited-write fences hold unchanged.
- **Opportunistic cleanup.** A rotation also sweeps sessions that expired or were revoked more than one TTL
  ago (`deleteDeadSessions`, backed by the `sessions(expires_at)` index, migration v2), so dead rows do
  not accumulate forever. Cleanup rides the (infrequent) rotation event rather than every request.

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
no fallback role), no-client-role-header, org-id-required. Sliding renewal + rotation + cleanup are locked
by `src/__tests__/integration/session-lifecycle.test.ts` (real PGlite; adversarial proof PF-022). Step-up
auth for sensitive actions is a later flow concern. SSO/OIDC adapter is deferred with a trigger.

## Deferred hardening (explicit, with triggers)

- **Login rate limiting / lockout / per-IP throttling (D-015).** Failed authentications ARE audited now
  (`session.login_failed`, attributed to the matched account's org and userId; unknown emails are
  logged without the email AFTER the same audit-pipeline work runs and is discarded —
  `discardedAuditEventWork` keeps both failure branches at constant DB cost, so the failure-path audit
  is not a user-enumeration timing oracle), so credential-stuffing attempts leave a record — but online
  guessing is bounded only by scrypt cost. **Trigger:** before the first pilot with real users.
- **Concurrent-rotation grace window (deep-review r6 #8).** Rotation replaces the id in place, so a request
  still in flight with the pre-rotation cookie would 404 its session ("not found") if it arrives after the
  rotation commits. The app makes no concurrent same-cookie Route-Handler requests today (the `/app` guard
  is a read-only server component that never rotates; client fetches are sequential and user-driven), so
  the window is not reachable. A high-concurrency client (multi-tab, parallel XHR) is the real trigger; the
  fix is a short overlap window where the pre-rotation id still resolves for a few seconds after rotation.
  **Trigger:** the first client that issues concurrent authenticated requests, or a polling surface.
- **Rotation is not separately audited.** `session.create` (login) and `session.revoke` (logout) are
  audited; the intervening rotations are silent to avoid an audit entry every half-TTL per active user. The
  create/revoke pair still brackets the login episode by user + org + time. **Trigger:** a forensic
  requirement to trace an individual rotated id back to its login.
- **Org-qualified login (Sable F3).** `findUserByEmail` resolves deterministically (oldest account
  wins, `ORDER BY created_at, id`) so an email collision across orgs cannot lock out the original
  user; a login that carries the org explicitly is the real fix. Emails are canonicalized (trim +
  lowercase) at write and lookup (D-023), so a case-variant of one mailbox cannot split into two
  identities or destabilize this resolution. **Trigger:** the first customer org whose users share
  emails with another org.

## Revisit When

The first enterprise customer requires SAML/SSO (build the federated adapter behind the identity port), or a
password-policy/MFA requirement lands (extend the credential adapter).
