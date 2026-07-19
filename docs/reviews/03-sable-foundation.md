# 03 — Sable (security red-team, STRIDE) — foundation audit

Fresh-context review. Method + attack checklist in `docs/personas/sable.md`. Sable confirmed the core
controls HOLD, then found real gaps (below). Dispositions reflect the Phase-G pass.

## Controls confirmed holding (with citations in the report)

No client-trusted identity/role; signed session cookie with server-side expiry + revocation; constant-time
webhook HMAC; exactly-once resume via idempotency keys; append-only triggers + hash chain with session-
threaded actor (never `"system"`); parameterized SQL (no injection); `toResponse` leaks no internals;
`.env.example` placeholder-only; the auth-enforcement allowlist is correct; CSRF mitigated by httpOnly +
SameSite=Lax + the Server-Action Origin check.

## Findings

| # | Severity | CWE | Finding | Disposition |
|---|----------|-----|---------|-------------|
| F1 | Medium | 532/359 | Customer names leak into the audit trail (scrubber omits name fields; `detail` never scrubbed); the fence passed vacuously | **Fixed** — names added to PII detection; `detail` PII-minimized + scrubbed; fail-closed `assertNoPIIValues` backstop; fence now asserts names + scans `detail`. (= Vale V2/V3.) |
| F2 | Medium | 400 | Unbounded request body — the T-D1 size-limit control did not exist | **Fixed** — `readJsonBody` (bounded reader) in every body-reading route + `bounded-request-body` fence. |
| F3 | Low | 287/639 | Login not org-qualified; nondeterministic `LIMIT 1` across tenants | **Deferred** — latent (no self-registration; users are operator/seed-provisioned). **Trigger:** multi-org email collision / a self-registration route → qualify login by org. |
| F4 | Low | 345 | `verifyChain` blind to tail-truncation / full deletion | **Fixed** — out-of-band anchor + BEFORE TRUNCATE trigger (= Vale V1). |
| F5 | Low | 639 | `simulate-sign` has no org binding to the token | **Fixed** — verifies `app.org_id === principal.orgId` before signing. |
| F6 | Low | — | Auth events outside the audit chain | **Fixed** — login/logout recorded via `auditEvent`. |

**Falsifier pointers Sable flagged (now covered):** re-attack the audit chain with **truncation/emptying**
(not just row-edit) — now detected by the anchor + tested; the mid-finalize transient failure is now
retry-safe (Vale V7) and tested. Three load-bearing comments that asserted protections the code lacked
(name redaction, unknown-user password check, wired `assertNoPII`) have all been made true.
