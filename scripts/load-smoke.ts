/**
 * Load smoke / p95 regression gate (charter #11, ADR-0018, D-010). Seeds a
 * DETERMINISTIC pilot-scale dataset (1,000 households x ~2,000 accounts total) and
 * asserts p95 read latency under a threshold. A regression fails CI — the latency
 * budget is owned, not modeled (ADR-0014). Deterministic (no Math.random / Date.now
 * in the data), so results are reproducible.
 */
import { createMemoryDb } from "../src/infrastructure/store/db";

const HOUSEHOLDS = 1000;
const ACCOUNTS = 2000;
const P95_THRESHOLD_MS = 250;
const ORG = "org-load";

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const db = await createMemoryDb();
  const t0 = "2026-01-01T00:00:00.000Z";
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Load Firm',$2,'verin-crm',$2,'high')", [ORG, t0]);

  const seedStart = performance.now();
  await db.transaction(async (tx) => {
    for (let i = 0; i < HOUSEHOLDS; i++) {
      await tx.query(
        "INSERT INTO households (id,org_id,name,primary_contact_id,advisor_user_id,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,NULL,NULL,'active',$4,'verin-crm',$4,'high')",
        [`hh-${i}`, ORG, `Household ${i}`, t0],
      );
    }
    for (let i = 0; i < ACCOUNTS; i++) {
      await tx.query(
        "INSERT INTO financial_accounts (id,org_id,household_id,account_type,custodian,balance_minor_units,currency,status,open_date,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'individual',NULL,$4,'USD','open',NULL,$5,'verin-crm',$5,'high')",
        [`acct-${i}`, ORG, `hh-${i % HOUSEHOLDS}`, (i + 1) * 1000, t0],
      );
    }
  });
  const seedMs = performance.now() - seedStart;

  const durations: number[] = [];
  const RUNS = 300;
  for (let i = 0; i < RUNS; i++) {
    const hh = `hh-${i % HOUSEHOLDS}`;
    const s = performance.now();
    await db.query("SELECT * FROM households WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50", [ORG]);
    await db.query("SELECT * FROM financial_accounts WHERE org_id = $1 AND household_id = $2", [ORG, hh]);
    durations.push(performance.now() - s);
  }
  await db.close();

  durations.sort((a, b) => a - b);
  const p50 = pct(durations, 50).toFixed(1);
  const p95 = pct(durations, 95);
  process.stdout.write(
    `load-smoke: seeded ${HOUSEHOLDS} households + ${ACCOUNTS} accounts in ${seedMs.toFixed(0)}ms | read p50=${p50}ms p95=${p95.toFixed(1)}ms (threshold ${P95_THRESHOLD_MS}ms)\n`,
  );
  if (p95 > P95_THRESHOLD_MS) {
    process.stderr.write(`load-smoke: p95 ${p95.toFixed(1)}ms exceeds ${P95_THRESHOLD_MS}ms — latency regression\n`);
    process.exit(1);
  }
  process.stdout.write("load-smoke: PASS\n");
}

main().catch((e) => {
  process.stderr.write(`load-smoke error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
