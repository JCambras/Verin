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
- **Retention (per record class):** `audit_log` retained ≥ 6 years (SEC 17 CFR 275.204-2 / 17a-4 floor);
  the append-only + hash-chain invariant is preserved for the whole window. A WORM archive tier (e.g. S3
  Object Lock) for 17a-4(f) is a design contract (un-defer trigger below). A DSAR/right-to-delete request
  can never override the 204-2 retention hold; deletion cites the regulatory basis per record class.
- **Examiner-export path:** a script/endpoint exports an org's audit trail (with chain verification) for an
  examiner.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Paper DR plan, never drilled (Meridian) | The charter demands an *executed* drill; untested backups fail when needed. |
| Delete-on-request without a retention hold | Violates SEC 204-2; deletion must honor the record-class hold. |

## Trade-offs and Costs

- **Gained:** verified restore, defined RPO/RTO, examiner-ready retention + export, DSAR that respects holds.
- **Sacrificed:** retention storage cost; the drill must be re-run periodically.

## Consequences

Charter-map id 11 (`backup-and-restore` runbook). The executed drill's evidence goes in FOUNDATION.md.
The WORM archive + full DSAR workflow are deferred design contracts with triggers.

## Revisit When

The first Tier-1 audit entry nears 6 years (forces the WORM archive), a regulated customer requires
17a-4(f) WORM immediately, or a real restore incident produces a postmortem.
