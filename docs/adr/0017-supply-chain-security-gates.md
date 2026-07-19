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
- **Dependency vuln + license** — `pnpm audit --audit-level=high` (vulnerabilities) + a **self-contained
  license audit** (`scripts/license-audit.ts`, run as `pnpm license:audit`). It reads the installed tree via
  `pnpm licenses list --json` and fails on any license not on a reviewed allowlist (permissive + weak
  file-level copyleft MPL-2.0 + font/data licenses) or a documented per-package exception; **GPL/AGPL,
  proprietary, and unknown/missing licenses are denied by default**. The one copyleft exception is the
  `@img/sharp-libvips-*` native binary (LGPL, dynamically linked by Next's image optimizer). We do **not**
  use `actions/dependency-review-action`: it requires GitHub's server-side Dependency-graph feature and
  cannot run self-contained on every CI/host (it errors "Dependency review is not supported on this
  repository") — a brittleness the charter's "machine-enforced, not modeled" discipline rejects.
- **Secret scanning** — gitleaks with a repo config (`.gitleaks.toml`); `.env.example` is placeholder-only.
  The config allowlists one deliberately secret-shaped test fixture by its exact literal (not by file, so a
  real secret in that file is still caught).
- **SAST** — `semgrep scan` (`p/typescript p/react p/nodejsscan p/secrets`), `--error` (blocking; not
  `semgrep ci`, which targets the Semgrep AppSec Platform and needs a token). The purely syntactic
  `njsscan regex_dos` rule is excluded at the gate: it flags *every* `regexp.test(x)` and cannot tell user
  input from build-time source text or startup config, so it produced only false positives here. All other
  njsscan rules stay blocking; individual false positives are triaged in-code with
  `// nosemgrep: <rule> -- <reason>` (a labeled demo seed password; an in-memory test fake's token lookup).
- **SBOM** — CycloneDX generated on release.

A backstop `no-secret-fallback` fitness fence (Phase B) also catches secret fallbacks, live org domains,
and non-placeholder `.env.example` values locally so a leak fails fast even without the CI tool.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Advisory (`continue-on-error`) scans (Iris) | Charter #15: "none advisory." Advisory findings get ignored. |
| Grep-of-audit-output allowlist (Meridian) | Brittle; misfires on any format change (retro #28). |
| `dependency-review-action` for license/vuln | Needs GitHub's server-side Dependency-graph feature; not self-contained (fails "not supported on this repository"). Replaced by `pnpm license:audit`. |
| Allow install scripts globally | Supply-chain risk; pnpm blocks by default and we allow an explicit reviewed list. |

## Trade-offs and Costs

- **Gained:** a leaked secret, a high-severity vuln, a bad license, or a SAST finding fails the build.
- **Sacrificed:** occasional false positives block a PR (tuned via config); scan time in CI.

## Consequences

Charter-map id 15 (`secret-scan`, `sast`, `dependency-audit`, `.gitleaks.toml`). All gates live in
`.github/workflows/ci.yml` (the `dependency-audit` job runs both `pnpm audit` and `pnpm license:audit`).
SBOM on release job (Phase F).

## Deferred hardening (explicit, with a trigger — D-019)

**Pin CI actions + the semgrep image by SHA/digest.** Every `uses:` across ci/release/scheduled is a
mutable major tag (`actions/checkout@v4`) and the SAST container floats `semgrep/semgrep:latest`, so gate
behavior can change underneath us and a compromised tag is a supply-chain vector into the gates
themselves. Pin all of them to commit SHAs / image digests, with dependabot keeping the pins bumped.
**Trigger:** the SOC 2 Type II evidence-collection window opens, or the first production deploy —
whichever comes first.

## Revisit When

A false-positive rate makes a gate noisy (tune rules, never disable the gate), or a secrets manager / SCA
platform (Snyk/Vanta) replaces a tool.
