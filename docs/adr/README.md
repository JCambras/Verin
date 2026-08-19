# Architecture Decision Records

Decisions are documented, not debated. Every architectural decision is an ADR here; the charter is
amended only by an ADR referenced in the PR that changes `CHARTER.md`.

Each ADR follows [`0000-template.md`](./0000-template.md): **Context → Decision → Alternatives Rejected
→ Trade-offs (Gained / Sacrificed) → Consequences → Revisit When**. Every ADR names a `Revisit When`
regret-trigger so a deferral is never silent. ADRs that close a documented failure of a prior build
(Meridian / Iris) cite the governing report finding.

Status values: `Proposed`, `Accepted`, `Accepted (design contract — implementation deferred)`,
`Accepted (charter amendment)`, `Accepted (deferral with trigger)`, `Accepted (amends ADR-NNNN)`,
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
| [0022](./0022-derived-compliance-artifacts-demonstration.md) | Charter #3 extension — derived compliance artifacts are demonstrations (watermarked, excluded from examiner-export) | Accepted (charter amendment) |
| [0023](./0023-adopt-v3-decision-layer-direction.md) | Adopt the v3 direction — Verin as the governed decision and execution layer; §3/§17 phase-gated commitments | Accepted (charter amendment) |
| [0024](./0024-salesforce-acceleration-deferred.md) | Salesforce acceleration DEFERRED — fakes carry every wave; trigger = sandbox access granted | Accepted (deferral with trigger) |
| [0025](./0025-money-movement-phase1-vertical.md) | Money movement is the Phase 1 vertical | Accepted |
| [0026](./0026-stack-deviations-from-v3.md) | Stack deviations from v3 §18 — Postgres, Next.js, ts-morph fences; FirmId ≡ org_id | Accepted |
| [0027](./0027-demo-first-wave0-labeled-fakes.md) | Demo-first Wave 0 on labeled fakes — charter #5 extension, no mock theater | Accepted (charter amendment) |
| [0028](./0028-demo-design-language.md) | Demo design language — the established Verin design system is normative | Accepted |
| [0029](./0029-decision-core-contracts.md) | Decision-core canonical contracts (v3 prompt 5) as Zod schemas in `contracts/`; ceiling re-baseline 600→3500 | Accepted (amends ADR-0018) |
| [0030](./0030-line-budget-prompt-6-review-hardening.md) | Line-budget amendment for prompt-6 review hardening | Accepted (amends ADR-0018) |
| [0031](./0031-llm-projection-boundary-ahead-of-first-caller.md) | The evidence-to-LLM projection boundary lands ahead of its first caller — a reviewed charter #5 exception | Accepted |
| [0032](./0032-line-budget-wave-a-security-boundaries.md) | Line-budget amendment for Wave A security boundaries (prompt 6) | Accepted (amends ADR-0018) |
| [0033](./0033-line-budget-honest-headroom.md) | Line-budget ceilings carry bounded, measured headroom; ADR-0030's stated basis corrected | Accepted (amends ADR-0030/0032) |
| [0034](./0034-line-budget-infrastructure-headroom.md) | Infrastructure ceiling 3,300→3,400 on a re-measured baseline; the fence's own headroom comment corrected | Accepted (amends ADR-0033) |
| [0035](./0035-line-budget-contracts-error-snapshots.md) | Contracts ceiling 4,000 to 4,050 for normalized error snapshots | Accepted (amends ADR-0033) |
| [0036](./0036-line-budget-infrastructure-provenance-snapshots.md) | Infrastructure ceiling 3,400 to 3,450 for provenance and failure snapshots | Accepted (amends ADR-0034) |
| [0037](./0037-line-budget-domain-resume-seal.md) | Domain ceiling 1,250 to 1,300 for pre-load resume validation | Accepted (amends ADR-0033) |
| [0038](./0038-line-budget-observability-identifier-provenance.md) | Domain and infrastructure ceilings for observability identifier provenance | Accepted (amends ADR-0033/0036) |
| [0039](./0039-primitive-vocabulary.md) | Decision-primitive vocabulary (v3 prompt 8): six-primitive catalog in `contracts/primitives`, versioned + provisional + falsification-tested | Accepted |
| [0040](./0040-line-budget-primitive-vocabulary.md) | Contracts ceiling 4,050 to 5,460 for the primitive catalog | Accepted (amends ADR-0035) |
| [0041](./0041-sibling-decision-ledger.md) | Sibling append-only decision ledger and replay storage | Accepted (amends ADR-0007, ADR-0018, and ADR-0019) |
| [0042](./0042-line-budget-ledger-review-hardening.md) | Infrastructure line budget for ledger review hardening | Accepted (amends ADR-0018 and ADR-0041) |
| [0043](./0043-line-budget-ledger-retention-hardening.md) | Infrastructure line budget for ledger retention hardening | Accepted (amends ADR-0018 and ADR-0042) |
| [0044](./0044-ledger-verification-source-trust-and-batched-replay.md) | Ledger verification, source trust, and batched replay | Accepted (amends ADR-0018, ADR-0041, and ADR-0043) |
| [0045](./0045-ledger-history-authority-hardening.md) | Ledger history authority and bounded disclosure hardening | Accepted (amends ADR-0018 and ADR-0044) |
| [0046](./0046-ledger-full-chain-register-verification.md) | Full-chain register verification with bounded disclosure | Accepted (amends ADR-0041 and ADR-0045) |
| [0047](./0047-ledger-codecs-and-register-availability.md) | Frozen ledger codecs and register availability | Accepted (amends ADR-0018, ADR-0041, and ADR-0046) |
| [0048](./0048-line-budget-restores-compressed-migration-prose.md) | The infrastructure ceiling absorbs restored migration prose | Accepted (amends ADR-0018 and ADR-0047) |
| [0049](./0049-per-file-pin-headroom.md) | The per-file pin gets the same bounded headroom as the layer ceiling | Accepted (amends ADR-0018 and ADR-0048) |
| [0050](./0050-ledger-store-per-file-pin.md) | The ledger's write chokepoint is pinned rather than compressed | Accepted (amends ADR-0018 and ADR-0049) |
| [0051](./0051-line-budget-ledger-preview-and-counted-provenance.md) | Contracts and infrastructure ceilings for the scoped rebuild and counted provenance | Accepted (amends ADR-0018, ADR-0048, and ADR-0050) |
| [0052](./0052-synthetic-corpus-and-provenance-split.md) | Replay corpus: deterministic synthetic substrate, fenced provenance split, honestly empty real-derived partition, digest-bound signoff; `scripts/**` becomes a measured `tooling` budget | Accepted (amends ADR-0018) |
| [0053](./0053-policy-ast-and-interpreter.md) | The constrained policy AST and deterministic four-phase interpreter (v3 prompt 9): closed grammar, seven-check loader, conservative effect-conflict prover, fail-closed evaluation; invariant 16 activates | Accepted |
| [0054](./0054-line-budget-policy-ast.md) | Contracts ceiling 6,650 and domain ceiling 4,550 for the policy AST and interpreter | Accepted (amends ADR-0041 and ADR-0051) |
| [0055](./0055-gate-a-invariant-ordering.md) | Gate A owns invariants 1, 2, 4, 5 and requires prompt-5 guarantees 7, 8, 9; invariant 3 is gated at B | Accepted (amends ADR-0023) |
| [0056](./0056-presentation-foundation-named-deferrals.md) | A presentation foundation primitive lands ahead of its first caller only under a named deferral that expires at the prompt it cites | Accepted (amends ADR-0012) |
| [0057](./0057-populated-world.md) | The populated world is a deterministic fixture generated once, served as evidence through a port, and provably absent from production | Accepted (amends ADR-0018) |
| [0060](./0060-controlled-fourth-implementation-generation.md) | One controlled fourth implementation generation; current Verin becomes the read-only legacy oracle, destructive replacement and dual external effects are prohibited, and there is no fifth rewrite | Accepted (charter amendment) |

Related governance: [`../security/threat-model.md`](../security/threat-model.md) (STRIDE),
[`../compliance/controls.md`](../compliance/controls.md) (SOC 2 matrix),
[`../sacrificial-components.md`](../sacrificial-components.md),
[`../v3/README.md`](../v3/README.md) (the ratified v3 architecture direction, ADR-0023..0029 and ADR-0055).
