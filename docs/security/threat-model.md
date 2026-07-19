# Verin STRIDE threat model (foundation)

**Owner:** the security red-team persona (`docs/personas/` — maintained, attacked each audit round).
**Scope:** the walking-skeleton foundation — identity/sessions, RBAC/authz at the port, the tamper-evident
audit chain, the simulated e-sign webhook, the house-CRM store, and config/secrets. Updated when a new
entry point or asset is added. Every High/Critical threat names a concrete exploit (attacker, entry point,
payload, result) and the control + the fence/gate that enforces it. If a threat has no enforcing mechanism,
it is listed as an explicit gap with an owner and date (never omitted).

## Assets & trust boundaries

- **Identity/session** — session cookie ↔ server-side session record (`resolveSession` is the only reader).
- **Authorization** — RBAC checked server-side at the port; `org_id` scoping on every query.
- **Audit chain** — append-only, hash-chained `audit_log`; the "prove it wasn't edited" asset.
- **e-sign webhook** — an unauthenticated-by-network external callback that resumes a suspended flow.
- **House-CRM store** — the system of record (identity PII lives here).
- **Config/secrets** — `SESSION_SECRET`, `ESIGN_WEBHOOK_SECRET`, DB DSN.

Trust boundaries: client → app (never trust client identity/role); app → store (org-scoped); external
e-sign → webhook (verify signature); operator → house-CRM console (RBAC + audited).

## STRIDE analysis

### S — Spoofing
- **T-S1 (High): forge identity by supplying a role/identity header.** *Exploit:* attacker sends
  `x-user-role: principal` or a crafted identity header to a port call. *Control:* identity resolved only
  from the signed/encrypted server-side session; no client-supplied role/identity is ever trusted
  (ADR-0008). *Fence:* `no-client-role-header`, `auth-enforcement`.
- **T-S2 (High): forge/replay a session cookie.** *Exploit:* attacker crafts or replays a cookie.
  *Control:* cookie signed/encrypted with `SESSION_SECRET`; server-side session record with expiry,
  rotation, and a revocation list; opaque id. *Fence:* `auth-enforcement`.
- **T-S3 (High): spoof the e-sign webhook.** *Exploit:* attacker POSTs a fake "signed" callback to finalize
  a flow. *Control:* webhook verifies an HMAC signature over the payload with `ESIGN_WEBHOOK_SECRET`;
  resume token must match a suspended flow. *Fence:* webhook-signature test (Phase E).

### T — Tampering
- **T-T1 (Critical): edit/delete an audit record.** *Exploit:* attacker/insider `UPDATE`/`DELETE`s
  `audit_log` to hide an action. *Control:* Postgres append-only triggers (`RAISE EXCEPTION`) + hash chain;
  a scheduled job re-verifies the chain and fails on any break. *Fence:* `audited-write-required`,
  `audit-chain-verify` gate, tampered-chain-detected companion (ADR-0007).
- **T-T2 (High): bypass the audited-write helper.** *Exploit:* a new mutation writes without an audit entry.
  *Control:* the anti-fork fence — a mutation must route through `auditedWrite`, and audit calls may appear
  only inside the helper. *Fence:* `audited-write-required` (+ anti-fork).
- **T-T3 (Medium): SQL injection via inputs.** *Control:* parameterized queries only (every adapter binds
  `$n` placeholders). *Fence:* none yet; an injection-defense fence is an explicit gap (see Gaps).

### R — Repudiation
- **T-R1 (High): "I didn't make that change."** *Control:* every write records `org_id` + `actor` (threaded
  from the session, never `"system"`) + before/after; the chain proves ordering and integrity. *Fence:*
  `audited-write-required` (actor asserted).

### I — Information disclosure
- **T-I1 (High): PII leaks into logs/audit/API bodies.** *Control:* PII boundary — scrub at audit + response
  boundaries; logs via pino with scrubbing; raw `console.*` banned. *Fence:* PII-not-in-audit-store,
  no-console (ADR-0006).
- **T-I2 (High): cross-tenant read.** *Exploit:* org A reads org B's rows. *Control:* `org_id` filter on
  every query + access scope. *Fence:* `org-id-required` (Phase B).
- **T-I3 (Medium): internal error detail leaks to clients.** *Control:* `toResponse` returns code+message
  only, no stack/context (ADR-0002).
- **T-I4 (High): a secret is committed or a live org domain ships in a doc.** *Control:* gitleaks + the
  no-secret-fallback/no-live-org-domain fence + placeholder-only `.env.example`. *Fence:* `secret-scan`,
  `no-secret-fallback`.

### D — Denial of service
- **T-D1 (Medium): unbounded request body / query.** *Control:* request size limits; bounded queries;
  step/flow timeouts. *Gap (owner: red-team; date: Phase E):* per-tenant rate limiting is a scale-ladder
  item (ADR-0015) — documented, not silently deferred.
- **T-D2 (Medium): webhook flood resumes/replays.** *Control:* idempotency (exactly-once resume) blunts
  replay effect; signature required. *Fence:* idempotency-exactly-once.

### E — Elevation of privilege
- **T-E1 (High): a low-privilege actor performs a high-privilege action.** *Exploit:* an `advisor` calls a
  `principal`-only port. *Control:* server-side RBAC at the port (`requireRole`); roles enum in contracts.
  *Fence:* `auth-enforcement` (routes resolve a session and check role).
- **T-E2 (High): demo/seed affordance reachable in production.** *Control:* the config fail-closed guards
  refuse a non-postgres driver or placeholder secrets in production (ADR-0003); the populated demo world
  is deferred (D-005), so no demo affordance ships yet. *Fence:* the config superRefine guards; a
  dedicated demo-mode fence lands with the demo milestone.

## Gaps (explicit, owned, dated)

| Gap | Owner | Target | Note |
|-----|-------|--------|------|
| Per-tenant rate limiting | red-team persona | scale-ladder trigger | ADR-0015; blunted by idempotency + size limits now. |
| Field-level PII-at-rest encryption | red-team persona | WISP technical control | House-CRM PII relies on transport + access control now. |
| Full DSAR workflow | compliance persona | design contract | ADR-0019 retention hold defined; workflow deferred. |
| Injection-defense fence (T-T3: ban string-built SQL) | founder | next adapter / query surface | Parameterized-only today; not machine-enforced. |

## Attack-round checklist (each audit)

Attempt: (1) an authz bypass (forge role, cross-tenant read); (2) an audit-chain edit (UPDATE/DELETE, then
re-verify); (3) a webhook forgery/replay (bad signature; double-fire → assert exactly-once); (4) a secret
leak (planted secret must fail gitleaks + the fence). Findings → `docs/reviews/` and become regression fences.
