/**
 * Scheduled audit-chain integrity job (charter #13). Re-verifies every org's
 * hash-chain and exits non-zero on any break — producing dated evidence over time
 * (SOC 2 CC7.4). Wired as the `audit-chain-verify` CI gate.
 */
import { createDb } from "../src/infrastructure/store/db";
import { verifyOrgChain } from "../src/infrastructure/audit/audit-store";

async function main(): Promise<void> {
  const db = await createDb();
  const orgs = await db.query<{ id: string }>("SELECT id FROM orgs ORDER BY id");
  let broken = 0;
  for (const { id } of orgs.rows) {
    const v = await verifyOrgChain(db, id);
    const line = `org ${id}: ${v.ok ? "OK" : "BROKEN"} (${v.entriesChecked} entries${v.reason ? `, ${v.reason}` : ""})`;
    process.stdout.write(`${line}\n`);
    if (!v.ok) broken += 1;
  }
  await db.close();
  if (broken > 0) {
    process.stderr.write(`audit-chain-verify: ${broken} org chain(s) FAILED integrity\n`);
    process.exit(1);
  }
  process.stdout.write(`audit-chain-verify: all ${orgs.rows.length} org chain(s) verified\n`);
}

main().catch((e) => {
  process.stderr.write(`audit-chain-verify error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
