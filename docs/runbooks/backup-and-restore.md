# Runbook: backup & restore (ADR-0019, charter #11)

**RPO ≤ 24h · RTO ≤ 4h** (foundation targets). In production the house-CRM store is managed Postgres with
PITR; in dev/CI it is PGlite (portable Postgres) behind the same `StorePort`, so the procedure is identical
in shape.

## Executed drill (not a paper plan)

`scripts/backup-restore-drill.ts` is run in CI (`.github/workflows/scheduled.yml`) and on demand
(`pnpm exec tsx scripts/backup-restore-drill.ts`). It:

1. seeds an org, performs real operational audit writes, and records a synthetic decision;
2. records row counts + verifies both independent audit-class chains;
3. **backs up** the store (`store.dump()`);
4. **restores** to a FRESH instance (`createDbFromDump()`);
5. asserts row counts and both chains' integrity **survive the restore**.

### Latest local run (2026-08-06)

```
=== Verin backup-restore drill ===
households: 5 -> 5
audit entries: 5 -> 5
audit chain after restore: VERIFIED
decision entries: 5 -> 5
decision chain after restore: L1-L4 + 10 SOURCES VERIFIED
backup: 27ms | restore: 120ms | total drill: 953ms
RESULT: PASS
```

Both chains re-verify after restore - a backup that silently corrupted either tamper-evident trail would
fail this drill (SEC 17a-4 / SOC 2 CC7.4).

## Production procedure

1. **Backup:** managed Postgres automated backups + PITR (RPO ≤ 24h). Verify the latest backup timestamp.
2. **Restore:** provision a fresh instance from the target snapshot/PITR point (RTO ≤ 4h).
3. **Verify:** run `pnpm audit:chain` against the restored store; confirm both per-org chains verify and row
   counts match expectations. Confirm `/ready` returns ready.
4. **Repair derived state (only if needed):** if the restore predates a decision-projection write, run
   `pnpm ledger:rebuild` to discard derived decision state and replay the immutable ledger into it. It
   refuses any org whose chain does not verify, so it can never launder a corrupted source into
   derived state; immutable rows are never touched.
5. **Cut over:** point the stateless app tier at the restored store (a deployment config change — the app
   tier holds no state).

## Revisit

Re-run the drill quarterly and after any store-engine change (ADR-0019). A real restore incident produces a
postmortem (`docs/postmortem-template.md` — to be added with the incident-response runbook set).
