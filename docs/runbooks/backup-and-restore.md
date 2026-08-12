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

**Steps 3 and 4 are gated on the managed-Postgres adapter, which is deferred (D-006/ADR-0004).**
`getConfig()` requires `store.driver=postgres` under `APP_ENV=production` and `createDb` refuses that
driver with `STORE_UNAVAILABLE`, so `pnpm audit:chain` and `pnpm ledger:rebuild <org-id>` cannot open a
production store today - they exercise this procedure against PGlite in dev/CI and staging. Both are
written to work unchanged once the adapter lands; until then, treat the verification steps below as
the procedure the adapter must satisfy, not as commands to run against a production instance.

1. **Backup:** managed Postgres automated backups + PITR (RPO ≤ 24h). Verify the latest backup timestamp.
2. **Restore:** provision a fresh instance from the target snapshot/PITR point (RTO ≤ 4h).
3. **Verify:** run `pnpm audit:chain` against the restored store; confirm both per-org chains verify and row
   counts match expectations. Confirm `/ready` returns ready. Also run `pnpm fixture:check` against the
   restored store: it fails on the first demonstration-origin row, so a restore that pulled in a seeded
   snapshot is caught here rather than discovered in the book (ADR-0057, `docs/world.md`).
4. **Repair derived state (only if needed):** if the restore predates a decision-projection write, run
   `pnpm ledger:rebuild <org-id>` to preview the replay for the affected tenant, then
   `pnpm ledger:rebuild <org-id> --apply` to commit it. The repair is per-tenant and opt-in: there is no
   fleet-wide form, and without `--apply` the identical one-transaction replay runs and is rolled back,
   so the preview is exactly what applying would write. It refuses any org whose chain does not verify -
   before the replay and again after it - so it can never launder a corrupted source into derived state;
   immutable rows are never touched.
5. **Cut over:** point the stateless app tier at the restored store (a deployment config change — the app
   tier holds no state).

## Revisit

Re-run the drill quarterly and after any store-engine change (ADR-0019). A real restore incident produces a
postmortem (`docs/postmortem-template.md` — to be added with the incident-response runbook set).
