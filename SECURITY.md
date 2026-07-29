# Security policy

Verin is built to an enterprise-security-review and SOC 2 Type II bar (see `CHARTER.md`). Security
controls are machine-enforced from commit #1, not bolted on.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Email the maintainer (see the repository owner)
with a description, reproduction steps, and impact. You will receive an acknowledgement within 3 business
days. Please allow coordinated disclosure before any public write-up.

## Controls in force (foundation)

- **Supply chain:** pinned lockfile; `pnpm audit` (high+, vulnerabilities) and a self-contained
  license audit (`pnpm license:audit` — reviewed allowlist, denies GPL/AGPL/unknown) as blocking CI
  gates; secret scanning (gitleaks) and SAST (semgrep) as blocking CI gates; SBOM on release.
  Install scripts are blocked by default (pnpm), allowed only for an explicit, reviewed list.
- **Secrets & tenancy hygiene:** `process.env` is read only in `src/infrastructure/config` (fenced);
  `.env.example` is placeholder-only; CI fails on any live org domain, username, or credential in
  committed files; tenant-row queries carry `org_id` scope, with exact reviewed capability/pre-auth/readiness
  escapes; ordinary repository/port calls require sealed tenant authority; no client-controlled role
  headers or secret fallbacks. Config secrets are sealed `SecretValue`s, revealed only through
  `revealSecret` in the allowlisted HMAC consumers (never a dump, log, trace, or exception).
- **Identity & authorization:** real authentication; server-side RBAC enforced at the port; per-action
  authorization (a sealed `ActionGrant`) on every governed action, not a bare role check; SSO/OIDC-ready session design.
- **PII & model boundary:** PII-bearing types cannot reach `src/infrastructure/llm/`; model-bound text and
  evidence must be scrubber-minted, deeply frozen `Tokenized<T>` values. Logs and traces admit only closed
  vocabularies; request-derived record UUIDs are emitted only as tenant- and field-scoped keyed digests.
- **Audit:** append-only, hash-chained, tamper-evident audit trail re-verified by a scheduled job.
- **Change control:** protected `main`, no direct pushes, no self-approval; every change through an
  independent gate review (CODEOWNERS + the no-mistakes pipeline + the persona board's fresh-context rule).

The full Trust Services Criteria mapping lives in `docs/compliance/controls.md`; the STRIDE threat model
in `docs/security/threat-model.md` (both land during the foundation build).
