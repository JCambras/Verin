/**
 * Backup-restore drill (ADR-0019, charter #11): an ACTUALLY-EXECUTED drill, not a
 * paper plan. Seeds data + a real audited (hash-chained) write, dumps the store,
 * restores to a FRESH instance, and asserts row counts AND audit-chain integrity
 * survive the restore. Runs in CI (scheduled.yml) so the evidence is dated.
 */
import { createMemoryDb, createDbFromDump } from "../src/infrastructure/store/db";
import { auditedWrite } from "../src/infrastructure/audit/audited-write";
import { verifyOrgChain, listOrgChain } from "../src/infrastructure/audit/audit-store";

async function main(): Promise<void> {
  const t0 = performance.now();
  const src = await createMemoryDb();
  const now = "2026-07-19T00:00:00.000Z";
  await src.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ('org','Firm',$1,'verin-crm',$1,'high')", [now]);

  // Generate a few real audited (hash-chained) writes.
  for (let i = 0; i < 5; i++) {
    await auditedWrite({
      db: src, orgId: "org", actor: "drill@verin", action: "household.create", entityType: "Household", entityId: `hh-${i}`,
      detail: `household ${i}`,
      perform: async (tx) => {
        await tx.query(
          "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'org',$2,NULL,NULL,'active',$3,'verin-crm',$3,'high')",
          [`hh-${i}`, `H${i}`, now],
        );
        return { id: `hh-${i}` };
      },
    });
  }

  const beforeHouseholds = Number((await src.query<{ n: string }>("SELECT count(*) AS n FROM households")).rows[0]!.n);
  const beforeChain = await verifyOrgChain(src, "org");
  const beforeAudit = (await listOrgChain(src, "org")).length;
  if (!beforeChain.ok) throw new Error("pre-backup chain invalid");

  // --- BACKUP ---
  const tBackup = performance.now();
  const dump = await src.dump();
  const backupMs = performance.now() - tBackup;
  await src.close();

  // --- RESTORE to a fresh instance ---
  const tRestore = performance.now();
  const restored = await createDbFromDump(dump);
  const restoreMs = performance.now() - tRestore;

  // --- VERIFY ---
  const afterHouseholds = Number((await restored.query<{ n: string }>("SELECT count(*) AS n FROM households")).rows[0]!.n);
  const afterAudit = (await listOrgChain(restored, "org")).length;
  const afterChain = await verifyOrgChain(restored, "org");
  await restored.close();

  const ok = afterHouseholds === beforeHouseholds && afterAudit === beforeAudit && afterChain.ok;
  process.stdout.write(
    [
      "=== Verin backup-restore drill ===",
      `households: ${beforeHouseholds} -> ${afterHouseholds}`,
      `audit entries: ${beforeAudit} -> ${afterAudit}`,
      `audit chain after restore: ${afterChain.ok ? "VERIFIED" : "BROKEN — " + afterChain.reason}`,
      `backup: ${backupMs.toFixed(0)}ms | restore: ${restoreMs.toFixed(0)}ms | total drill: ${(performance.now() - t0).toFixed(0)}ms`,
      `RESULT: ${ok ? "PASS" : "FAIL"}`,
    ].join("\n") + "\n",
  );
  if (!ok) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`backup-restore drill error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
