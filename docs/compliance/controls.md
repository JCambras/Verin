# SOC 2 control matrix (as code)

Maps each AICPA Trust Services Criterion to its **implementing mechanism** — a fitness fence, a CI gate, or
a documented procedure — and names its **evidence source**, automated wherever possible. A control with no
mechanism and no evidence source is listed as an **explicit gap** with an owner and a date (never omitted).

**Scope claimed at foundation:** Security, Confidentiality, Availability, Privacy (Processing Integrity is
implicit, not formally claimed at v0.x). **Status:** SOC 2 Type II-**ready** (controls operating and
evidenced over time), pre-audit. A control is "ready" when its Code / Test / Doc / Op columns are filled.

Legend: **Code** = implementing code · **Test** = the fence/test that proves it · **Doc** = the ADR/runbook
· **Op** = the operating/evidence source.

## Separation of duties — the founder-led, agent-built answer (CC1/CC8)

Verin is built by a solo founder with AI agents. The compensating control for "no self-approval":

1. **Protected `main`, no direct pushes** — all changes via PR (branch protection; `.github/` + the
   change-control ADR). 2. **Independent gate review** — the no-mistakes pipeline runs review + all CI gates
   before merge; the persona board's **fresh-context rule** means a session that authored code never reviews
   it inline (review runs as a separate context). 3. **CODEOWNERS** requires owner review; **no self-approval**
   is a branch-protection setting. 4. **The Part-2 independent falsification session** re-verifies every claim
   from artifacts alone — an out-of-line-of-reporting check. Residual (a solo founder can technically alter
   branch protection) is an explicit gap below with an owner + date.

## Common Criteria

| TSC | Requirement | Code | Test | Doc | Op / Evidence |
|-----|-------------|------|------|-----|---------------|
| CC1.1 | Integrity & governance | `CHARTER.md`, `charter-map.json` | `charter-drift` fence | AGENTS.md, PLAN.md | CI run history |
| CC2.1 | Information & communication | AGENTS.md, ADRs | — | `docs/adr/` | commit/PR history |
| CC3.1 | Risk assessment | STRIDE model | red-team persona round | `docs/security/threat-model.md` | audit-round findings in `docs/reviews/` |
| CC4.1 | Monitoring | OTel + health/ready | `observability-coverage` | ADR-0013 | traces/metrics; audit-chain-verify job log |
| CC5.x | Control activities | the fitness-fence suite | `pnpm test:fitness` | ADR-0016 | CI gate results + `docs/fences/proof-log.md` |
| **CC6.1** | Logical access | auth + RBAC at port | `auth-enforcement` | ADR-0008 | session records; CI |
| CC6.2/6.3 | Access provisioning/removal | session revocation, RBAC | `auth-enforcement` | ADR-0008 | revoked-sessions store |
| CC6.6 | Boundary protection | security headers, CSRF | none yet (explicit gap below) | `next.config.ts` | CI |
| CC6.7 | Confidentiality of data | PII boundary | PII fences | ADR-0006 | scrub coverage; CI |
| CC7.1/7.2 | Detect anomalies | OTel metrics/logs | `observability-coverage` | ADR-0013 | telemetry |
| **CC7.4** | Records integrity | append-only + hash chain | `audited-write-required`, `audit-chain-verify` | ADR-0007 | scheduled chain-verify evidence |
| CC8.1 | Change management | protected main, PR template, CODEOWNERS | CI gates block merge | this doc; `.github/` | PR/merge history; no-mistakes runs |
| CC9.1 | Risk mitigation (vendors/supply chain) | pinned lockfile, scanners | `secret-scan`, `sast`, `dependency-audit` | ADR-0017 | CI; SBOM on release |

## Availability

| TSC | Requirement | Code | Test | Doc | Op / Evidence |
|-----|-------------|------|------|-----|---------------|
| A1.1 | Capacity / performance | load seed + p95 gate | `load-smoke` | ADR-0014, ADR-0018 | load-gate results |
| A1.2 | Backup / recovery | store dump/restore | executed drill (Phase F) | ADR-0019, runbook | drill evidence in FOUNDATION.md |
| A1.3 | Recovery testing | restore drill | executed drill | `docs/runbooks/backup-and-restore.md` | drill log |

## Confidentiality & Privacy

| TSC | Requirement | Code | Test | Doc | Op / Evidence |
|-----|-------------|------|------|-----|---------------|
| C1.x | Confidential data protected | PII boundary, org scoping | PII + `org-id-required` fences | ADR-0006 | CI |
| P1-P8 | Privacy (notice, retention, disposal) | retention hold, DSAR contract | retention design | ADR-0019 | retention schedule (design contract) |

## Explicit gaps (owner + date)

| Gap | Criterion | Owner | Target date / trigger |
|-----|-----------|-------|-----------------------|
| Branch protection can be altered by the solo founder | CC8.1 | founder | Add a second human reviewer or an external attestation before first paying customer |
| Field-level PII-at-rest encryption | CC6.7 | red-team persona | WISP technical control (pre-launch) |
| Full DSAR/erasure workflow (retention hold is defined) | P4 | compliance persona | design contract; build before first customer PII at scale |
| WORM archive for 17a-4(f) | CC7.4 / P | founder | scale-ladder trigger: first Tier-1 entry nears 6 years |
| Formal org-policy set (12 policies) & vendor risk register | CC1/CC9 | founder | pre-audit (Vanta/Drata/Secureframe templates) |
| Per-tenant rate limiting | A1.1 | red-team persona | scale-ladder trigger (ADR-0015) |
| Alerting rules as code | CC7.2 | founder | deploy-target selection (ADR-0003/0013) |
| Security-headers test (declared in `next.config.ts`, asserted nowhere) | CC6.6 | founder | pre-audit |

Gaps are tracked here, not hidden. Each closes into a Code/Test/Doc/Op row when implemented.
