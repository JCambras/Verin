/**
 * Audit-chain integrity verifier (charter #13). Re-verifies every org's hash-chain
 * in the configured store and exits non-zero on any break. Wired as the
 * `audit-chain-verify` CI gate and the scheduled job — both run it against a store
 * SEEDED in the same job, so today it proves the verifier EXECUTES correctly, not
 * the integrity of any long-lived store. Producing dated SOC 2 CC7.4 evidence for
 * a persistent store is a recorded deferral (D-017, trigger = managed Postgres).
 */
import { createDb } from "../src/infrastructure/store/db";
import { verifyOrgChain } from "../src/infrastructure/audit/audit-store";

async function main(): Promise<void> {
  const db = await createDb();
  const orgs = await db.query<{ id: string }>("SELECT id FROM orgs ORDER BY id");
  // Detection is not verification (charter #4): a run that verifies nothing must
  // FAIL, not pass — an empty store means the gate was pointed at the wrong data
  // or the seed never ran.
  if (orgs.rows.length === 0) {
    await db.close();
    process.stderr.write("audit-chain-verify: no orgs found — nothing was verified (did db:seed run against this store?)\n");
    process.exit(1);
  }
  let broken = 0;
  let entriesTotal = 0;
  for (const { id } of orgs.rows) {
    const v = await verifyOrgChain(db, id);
    const line = `org ${id}: ${v.ok ? "OK" : "BROKEN"} (${v.entriesChecked} entries${v.reason ? `, ${v.reason}` : ""})`;
    process.stdout.write(`${line}\n`);
    if (!v.ok) broken += 1;
    entriesTotal += v.entriesChecked;
  }
  await db.close();
  if (broken > 0) {
    process.stderr.write(`audit-chain-verify: ${broken} org chain(s) FAILED integrity\n`);
    process.exit(1);
  }
  if (entriesTotal === 0) {
    process.stderr.write("audit-chain-verify: 0 audit entries across all orgs — a chain verification that checked nothing is vacuous (the seed writes an audited entry)\n");
    process.exit(1);
  }
  process.stdout.write(`audit-chain-verify: all ${orgs.rows.length} org chain(s) verified (${entriesTotal} entries)\n`);
}

main().catch((e) => {
  process.stderr.write(`audit-chain-verify error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
