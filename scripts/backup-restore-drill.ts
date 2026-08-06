/**
 * Backup-restore drill (ADR-0019, charter #11): an ACTUALLY-EXECUTED drill, not a
 * paper plan. Seeds data + a real audited (hash-chained) write, dumps the store,
 * restores to a FRESH instance, and asserts row counts AND audit-chain integrity
 * survive the restore. Runs in CI (scheduled.yml) so the evidence is dated.
 */
import { createMemoryDb, createDbFromDump } from "../src/infrastructure/store/db";
import { auditedWrite } from "../src/infrastructure/audit/audited-write";
import { countOrgChain, verifyOrgChain } from "../src/infrastructure/audit/audit-store";
import { systemWriteActor } from "../src/contracts/principal";
import { errorMessage } from "./error-message";
import {
  verifyDecisionLedgerIntegrity,
} from "../src/infrastructure/ledger/ledger-verification";
import { systemTenant } from "../src/contracts/tenant";
import { seedDecisionLedger } from "./seed-decision-ledger";

/**
 * The drill seeds the decision ledger, whose immutable-source boundary accepts a
 * tenant id only as a UUID, a hash, or a reviewed shipped identifier. A UUID keeps
 * the drill's tenant out of that production vocabulary entirely.
 */
const DRILL_ORG_ID = "d7c3a1f2-4b6e-4a89-9f2c-1e5b8d0a63c7";

async function main(): Promise<void> {
  const t0 = performance.now();
  const src = await createMemoryDb();
  const actor = systemWriteActor("backup-restore-drill", DRILL_ORG_ID);
  const tenant = actor.tenant;
  const now = "2026-07-19T00:00:00.000Z";
  await src.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($2,'Firm',$1,'verin-crm',$1,'high')", [now, DRILL_ORG_ID]);

  // Generate a few real audited (hash-chained) writes.
  for (let i = 0; i < 5; i++) {
    await auditedWrite({
      db: src, actor, action: "household.create", entityType: "Household", entityId: `hh-${i}`,
      detail: `household ${i}`,
      perform: async (tx) => {
        await tx.query(
          "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$4,$2,NULL,NULL,'active',$3,'verin-crm',$3,'high')",
          [`hh-${i}`, `H${i}`, now, DRILL_ORG_ID],
        );
        return { id: `hh-${i}` };
      },
    });
  }
  await seedDecisionLedger(src, DRILL_ORG_ID);

  const beforeHouseholds = Number((await src.query<{ n: string }>("SELECT count(*) AS n FROM households")).rows[0]!.n);
  const beforeChain = await verifyOrgChain(src, tenant);
  const beforeAudit = await countOrgChain(src, tenant);
  const beforeTenant = systemTenant("backup-restore-drill", DRILL_ORG_ID);
  const beforeDecisionChain = await verifyDecisionLedgerIntegrity(src, beforeTenant);
  const beforeDecision = beforeDecisionChain.ledger.entriesStored;
  if (!beforeChain.ok || !beforeDecisionChain.ok) {
    throw new Error("pre-backup audit-class chain invalid");
  }

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
  const afterAudit = await countOrgChain(restored, tenant);
  const afterChain = await verifyOrgChain(restored, tenant);
  const afterTenant = systemTenant("backup-restore-drill", DRILL_ORG_ID);
  const afterDecisionChain = await verifyDecisionLedgerIntegrity(restored, afterTenant);
  const afterDecision = afterDecisionChain.ledger.entriesStored;
  await restored.close();

  const ok =
    afterHouseholds === beforeHouseholds &&
    afterAudit === beforeAudit &&
    afterDecision === beforeDecision &&
    afterChain.ok &&
    afterDecisionChain.ok;
  process.stdout.write(
    [
      "=== Verin backup-restore drill ===",
      `households: ${beforeHouseholds} -> ${afterHouseholds}`,
      `audit entries: ${beforeAudit} -> ${afterAudit}`,
      `audit chain after restore: ${afterChain.ok ? "VERIFIED" : "BROKEN — " + afterChain.reason}`,
      `decision entries: ${beforeDecision} -> ${afterDecision}`,
      `decision chain after restore: ${afterDecisionChain.ok ? `L1-L4 + ${afterDecisionChain.replaySourcesChecked} SOURCES VERIFIED` : `BROKEN - ${afterDecisionChain.replaySourceReason ?? "unknown"}`}`,
      `backup: ${backupMs.toFixed(0)}ms | restore: ${restoreMs.toFixed(0)}ms | total drill: ${(performance.now() - t0).toFixed(0)}ms`,
      `RESULT: ${ok ? "PASS" : "FAIL"}`,
    ].join("\n") + "\n",
  );
  if (!ok) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`backup-restore drill error: ${errorMessage(e)}\n`);
  process.exit(1);
});
