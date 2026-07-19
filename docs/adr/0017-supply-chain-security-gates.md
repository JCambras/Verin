# ADR-0017: Supply-chain and security scanning as blocking CI gates

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect (D-012)
**Relates to:** Charter non-negotiable #15, #7
**Informed by:** retro-r7 don't-again #28 (CI vuln gate was a brittle grep allowlist); Iris (CodeQL/dependency-review shipped `continue-on-error` — advisory)

## Context

The charter: pinned lockfile; dependency vulnerability + license audit; secret scanning (gitleaks-class);
SAST (semgrep-class); SBOM on release — **all failing gates, none advisory**. Iris shipped its SAST and
dependency-review as `continue-on-error` (advisory), and Meridian's vuln gate was a brittle grep allowlist.

## Decision

All security gates are **blocking** (no `continue-on-error`):

- **Pinned lockfile** — `pnpm-lock.yaml` committed; CI installs `--frozen-lockfile`. Install scripts are
  blocked by default (pnpm); only an explicit `onlyBuiltDependencies` list may run them.
- **Dependency vuln + license** — `pnpm audit --audit-level=high` + `dependency-review-action` (fail on high;
  license allowlist: MIT/Apache-2.0/BSD/ISC/…).
- **Secret scanning** — gitleaks with a repo config (`.gitleaks.toml`); `.env.example` is placeholder-only.
- **SAST** — semgrep (`p/typescript p/react p/nodejsscan p/secrets`), `--error`.
- **SBOM** — CycloneDX generated on release.

A backstop `no-secrets` fitness fence (Phase B) also catches key-shaped strings locally so a leak fails fast
even without the CI tool.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Advisory (`continue-on-error`) scans (Iris) | Charter #15: "none advisory." Advisory findings get ignored. |
| Grep-of-audit-output allowlist (Meridian) | Brittle; misfires on any format change (retro #28). |
| Allow install scripts globally | Supply-chain risk; pnpm blocks by default and we allow an explicit reviewed list. |

## Trade-offs and Costs

- **Gained:** a leaked secret, a high-severity vuln, a bad license, or a SAST finding fails the build.
- **Sacrificed:** occasional false positives block a PR (tuned via config); scan time in CI.

## Consequences

Charter-map id 15 (`secret-scan`, `sast`, `dependency-audit`, `.gitleaks.toml`). `.github/workflows/ci.yml`
+ `dependency-review.yml`. SBOM on release job (Phase F).

## Revisit When

A false-positive rate makes a gate noisy (tune rules, never disable the gate), or a secrets manager / SCA
platform (Snyk/Vanta) replaces a tool.
