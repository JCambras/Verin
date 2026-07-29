# ADR-0019: Backup/DR (RPO/RTO) and audit-log retention (SEC 17a-4 aware)

**Status:** Accepted (design contract — drill executed in Phase F)
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #11, #13
**Informed by:** Iris ADR-0028/0029; retro-r7 missing-prompt #8 (no backup verification, no DR plan)

## Context

The charter: RPO/RTO defined; one actually-executed backup-restore drill, documented; per-record-class
retention (SEC 17a-4 aware) and an examiner-export path. Meridian had no DR plan or backup verification.

## Decision

- **RPO ≤ 24h, RTO ≤ 4h** for the house-CRM store (foundation targets; managed Postgres PITR in production).
- **One executed backup-restore drill** in the foundation (Phase F): dump the store, restore to a fresh
  instance, verify row counts + **audit-chain integrity survives the restore**, document the runbook
  (`docs/runbooks/backup-and-restore.md`). Not a paper plan — actually run.
- **Retention (per record class):** `audit_log`, `decision_ledger`,
  `evidence_snapshots`, `decision_input_bundles` and their evidence membership,
  `decision_records`, `decision_replay_source_provenance` bindings, and
  `decision_provenance_traces` are retained
  ≥ 6 years (SEC 17 CFR 275.204-2 / 17a-4 floor);
  both append-only hash-chain invariants are preserved for the whole window. A WORM archive tier (e.g. S3
  Object Lock) for 17a-4(f) is a design contract (un-defer trigger below). A DSAR/right-to-delete request
  can never override the 204-2 retention hold; deletion cites the regulatory basis per record class.
  No retention, archival, or pruning path may preserve replay-source bytes while
  discarding the provenance binding required to verify them. The same rule forbids
  preserving a computed ledger row while discarding its retained derivation trace,
  or preserving that trace while discarding any retained ledger input it names.
- **Shipped register surfaces:** `/app/audit` verifies the operational audit
  chain and returns its latest 200 entries. `/app/ledger` verifies and replays
  a bounded window of at most 200 decision events, returns recent decision
  summaries, truncates displayed hashes, and omits immutable replay-source
  payloads. These RBAC-gated surfaces support operations and integrity
  diagnosis. Neither is an examiner export.
- **Examiner export is deferred:** the unbounded full-source export required by
  the charter is later work. Its authorization policy, streaming or pagination
  protocol, generated-export retention, and resource-bounding behavior remain
  unresolved and must be designed together instead of inferred from the
  operational registers. The `audit-chain-verify` gate performs unbounded
  integrity verification for operating evidence; it does not export records.
  **Un-defer trigger:** before Verin represents an examiner export as available
  to a regulated customer or external examiner.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Paper DR plan, never drilled (Meridian) | The charter demands an *executed* drill; untested backups fail when needed. |
| Delete-on-request without a retention hold | Violates SEC 204-2; deletion must honor the record-class hold. |

## Trade-offs and Costs

- **Gained:** verified restore, defined RPO/RTO, examiner-aware retention, honest bounded registers, and DSAR handling that respects holds.
- **Sacrificed:** retention storage cost; the drill must be re-run periodically; the full-source examiner export remains unshipped.

## Consequences

Charter-map id 11 (`backup-and-restore` runbook). The executed drill's evidence goes in FOUNDATION.md.
The WORM archive, full DSAR workflow, and full-source examiner export are
deferred design contracts with triggers.

## Revisit When

The first Tier-1 audit entry nears 6 years (forces the WORM archive), a regulated
customer requires 17a-4(f) WORM immediately, an examiner export is required for
external use, or a real restore incident produces a postmortem.
