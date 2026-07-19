# Architecture Decision Records

Decisions are documented, not debated. Every architectural decision is an ADR here; the charter is
amended only by an ADR referenced in the PR that changes `CHARTER.md`.

Each ADR follows [`0000-template.md`](./0000-template.md): **Context → Decision → Alternatives Rejected
→ Trade-offs (Gained / Sacrificed) → Consequences → Revisit When**. Every ADR names a `Revisit When`
regret-trigger so a deferral is never silent. ADRs that close a documented failure of a prior build
(Meridian / Iris) cite the governing report finding.

Status values: `Proposed`, `Accepted`, `Accepted (design contract — implementation deferred)`,
`Superseded by NNNN`.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](./0001-clean-architecture-dependency-rule.md) | Clean architecture with a fitness-enforced dependency rule | Accepted |
| [0002](./0002-result-error-strategy.md) | Result<T,E> over thrown exceptions, typed AppError taxonomy | Accepted |
| [0003](./0003-config-module.md) | One Zod-validated config module, fail-at-boot, no process.env outside it | Accepted |
| [0004](./0004-system-of-record-house-crm-store-port.md) | House CRM as system of record, behind a CRM/Store port, on PostgreSQL | Accepted |
| [0005](./0005-canonical-schema-provenance.md) | Canonical schema + provenance dictionary, scoped to declared need | Accepted |
| [0006](./0006-pii-boundary.md) | PII boundary at the use-case layer | Accepted |
| [0007](./0007-tamper-evident-audit-trail.md) | Tamper-evident, hash-chained audit trail | Accepted |
| [0008](./0008-identity-auth-rbac.md) | Real identity — credential+session auth behind an identity port, RBAC at the port | Accepted |
| [0009](./0009-idempotent-external-writes.md) | Idempotent, retry-safe external writes; audited-write helper | Accepted |
| [0010](./0010-workflow-engine-generic-renderer.md) | A generic workflow engine + generic renderer | Accepted |
| [0011](./0011-flowstep-suspend-resume.md) | Human-in-the-loop — FlowStep suspend / await-external / resume | Accepted |
| [0012](./0012-presentation-tier-and-budgets.md) | Presentation tier as first-class product surface; demo world deferred | Accepted |
| [0013](./0013-observability.md) | Observability from commit #1 — OpenTelemetry | Accepted |
| [0014](./0014-slo-error-budget.md) | SLOs and the error-budget policy | Accepted |
| [0015](./0015-scale-ladder.md) | The scale ladder — what breaks at 10x/100x and the trigger | Accepted |
| [0016](./0016-testing-strategy.md) | Testing strategy — fences, unit, integration, E2E from flow #1, axe | Accepted |
| [0017](./0017-supply-chain-security-gates.md) | Supply-chain and security scanning as blocking CI gates | Accepted |
| [0018](./0018-line-budgets-ratchet.md) | Line budgets — ratchet-down platform, separate presentation budget, load gate | Accepted |
| [0019](./0019-backup-dr-audit-retention.md) | Backup/DR (RPO/RTO) and audit-log retention (SEC 17a-4 aware) | Accepted (design contract) |
| [0020](./0020-sacrificial-components.md) | Sacrificial-component discipline with a written register | Accepted |
| [0021](./0021-content-security-policy-deferral.md) | Content-Security-Policy — deliberate deferral with a deployment trigger | Accepted |

Related governance: [`../security/threat-model.md`](../security/threat-model.md) (STRIDE),
[`../compliance/controls.md`](../compliance/controls.md) (SOC 2 matrix),
[`../sacrificial-components.md`](../sacrificial-components.md).
