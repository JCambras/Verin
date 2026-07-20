/**
 * Load smoke / p95 regression gate (charter #11, ADR-0014, ADR-0018, D-010). Seeds
 * a DETERMINISTIC pilot-scale dataset (1,000 households x ~2,000 accounts total)
 * then measures the paths the SLO actually promises (ADR-0014: "Flow step latency:
 * p95 < 2s"), not just the cheapest read. Three measured workloads:
 *
 *  1. Store-read p95 (kept) - the original narrow read check.
 *  2. Flow-step p95 - N account-opening flows driven end-to-end through
 *     startAccountOpening / resumeAccountOpeningByToken. Each interactive step
 *     (form submit -> suspend, e-sign webhook -> finalize) runs the REAL hot path:
 *     audited writes (~7 SQL each) + a full outbox drain + the tamper-evident hash
 *     chain. A regression there - a slower audited write, a hash-chain cost, a
 *     broken idempotency cache - would sail through the old two-SELECT check but now
 *     fails CI, asserted against the ADR-0014 2s budget.
 *  3. Concurrent-contention p95 - a batch of C concurrent flows + reads exercises
 *     the single-connection serialize mutex (db.ts). A sequential loop never queues
 *     on that lock, so a lock-hold or outbox-fanout regression only surfaces under
 *     concurrency; this batch surfaces it, also asserted against the 2s budget.
 *
 * The SEED stays deterministic and reproducible (no Math.random / Date.now in the
 * seeded rows). The flow-execution workload deliberately uses the real
 * (randomUUID-keyed, timestamped) write path - that IS the path the SLO measures.
 */
import { createMemoryDb } from "../src/infrastructure/store/db";
import { startAccountOpening, resumeAccountOpeningByToken } from "../src/infrastructure/wire";
import type { Principal } from "../src/contracts/principal";

const HOUSEHOLDS = 1000;
const ACCOUNTS = 2000;
const READ_P95_THRESHOLD_MS = 250;
// ADR-0014 SLO: interactive flow-step p95 < 2s. The load gate is that SLO's
// enforcement boundary (charter #11) - the budget is owned, not modeled.
const STEP_P95_BUDGET_MS = 2000;
const FLOWS = 50; // sequential account-opening flows (2 interactive steps each)
const CONCURRENCY = 16; // simultaneous flows/reads contending on the serialize mutex
const ORG = "org-load";
// A session-derived principal (never fabricated per-write - D-028); the flow
// attributes its audited writes to this advisor's opaque userId.
const ADVISOR: Principal = { userId: "u-load", orgId: ORG, role: "advisor", actor: "load@firm.test", sessionId: "s-load" };

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/**
 * Drive ONE account-opening flow end-to-end and return its two interactive-step
 * latencies. The start call runs create-household -> add-contact -> open-application
 * -> request-e-sign then SUSPENDS (fire-and-return); the resume call runs finalize
 * (the audited, exactly-once account-open write) on the webhook. Each is one
 * user-perceived step; both go through auditedWrite + outbox drain + hash chain.
 */
async function runFlow(db: Awaited<ReturnType<typeof createMemoryDb>>, i: number): Promise<{ startMs: number; resumeMs: number }> {
  const s0 = performance.now();
  const started = await startAccountOpening(db, ADVISOR, {
    householdName: `Load Household ${i}`,
    firstName: "Load",
    lastName: `Contact ${i}`,
    email: null,
    accountType: "individual",
  });
  const startMs = performance.now() - s0;
  if (started.status !== "suspended" || !started.token) {
    throw new Error(`flow ${i} did not suspend at e-sign (status=${started.status})`);
  }

  const r0 = performance.now();
  const resumed = await resumeAccountOpeningByToken(db, started.token, { signedAt: "2026-01-02T00:00:00.000Z" });
  const resumeMs = performance.now() - r0;
  if (!("status" in resumed) || resumed.status !== "completed") {
    throw new Error(`flow ${i} did not finalize on resume (status=${"status" in resumed ? resumed.status : "not-found"})`);
  }
  return { startMs, resumeMs };
}

async function main(): Promise<void> {
  const db = await createMemoryDb();
  const t0 = "2026-01-01T00:00:00.000Z";
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Load Firm',$2,'verin-crm',$2,'high')", [ORG, t0]);
  // The advisor whose session drives the measured flows (users.org_id -> orgs FK).
  await db.query(
    "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,'load@firm.test','Load Advisor','advisor','active',$3,'verin-crm',$3,'high')",
    [ADVISOR.userId, ORG, t0],
  );

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

  // 1) Store-read p95 (kept): the original narrow read check.
  const readDurations: number[] = [];
  const RUNS = 300;
  for (let i = 0; i < RUNS; i++) {
    const hh = `hh-${i % HOUSEHOLDS}`;
    const s = performance.now();
    await db.query("SELECT * FROM households WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50", [ORG]);
    await db.query("SELECT * FROM financial_accounts WHERE org_id = $1 AND household_id = $2", [ORG, hh]);
    readDurations.push(performance.now() - s);
  }

  // 2) Flow-step p95: N sequential account-opening flows through the real write
  // hot path. Both interactive steps (start, resume) are recorded as step samples.
  const stepDurations: number[] = [];
  const flowStart = performance.now();
  for (let i = 0; i < FLOWS; i++) {
    const { startMs, resumeMs } = await runFlow(db, i);
    stepDurations.push(startMs, resumeMs);
  }
  const flowWallMs = performance.now() - flowStart;

  // 3) Concurrent-contention p95: fire a batch of concurrent starts, reads, then
  // resumes. The serialize mutex (db.ts) queues them, so each step's latency now
  // includes lock-wait a sequential loop never incurs - contention made visible.
  const concStepDurations: number[] = [];
  const concStart = performance.now();
  const started = await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, i) => {
      const s = performance.now();
      const r = await startAccountOpening(db, ADVISOR, {
        householdName: `Concurrent Household ${i}`,
        firstName: "Concurrent",
        lastName: `Contact ${i}`,
        email: null,
        accountType: "individual",
      });
      concStepDurations.push(performance.now() - s);
      if (r.status !== "suspended" || !r.token) throw new Error(`concurrent start ${i} did not suspend (status=${r.status})`);
      return r;
    }),
  );
  // Concurrent reads interleaved against the same lock as the writes above.
  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      db.query("SELECT * FROM financial_accounts WHERE org_id = $1 AND household_id = $2", [ORG, `hh-${i}`]),
    ),
  );
  // Concurrent resumes: the finalize write path (3 audited writes each) under contention.
  await Promise.all(
    started.map(async (st) => {
      const s = performance.now();
      const resumed = await resumeAccountOpeningByToken(db, st.token!, { signedAt: "2026-01-03T00:00:00.000Z" });
      concStepDurations.push(performance.now() - s);
      if (!("status" in resumed) || resumed.status !== "completed") {
        throw new Error(`concurrent resume did not finalize (status=${"status" in resumed ? resumed.status : "not-found"})`);
      }
    }),
  );
  const concWallMs = performance.now() - concStart;

  await db.close();

  readDurations.sort((a, b) => a - b);
  stepDurations.sort((a, b) => a - b);
  concStepDurations.sort((a, b) => a - b);
  const readP50 = pct(readDurations, 50).toFixed(1);
  const readP95 = pct(readDurations, 95);
  const stepP50 = pct(stepDurations, 50).toFixed(1);
  const stepP95 = pct(stepDurations, 95);
  const concP50 = pct(concStepDurations, 50).toFixed(1);
  const concP95 = pct(concStepDurations, 95);

  process.stdout.write(
    `load-smoke: seeded ${HOUSEHOLDS} households + ${ACCOUNTS} accounts in ${seedMs.toFixed(0)}ms\n` +
      `  read (300x2 SELECT):        p50=${readP50}ms p95=${readP95.toFixed(1)}ms (threshold ${READ_P95_THRESHOLD_MS}ms)\n` +
      `  flow step (${FLOWS} flows, ${stepDurations.length} steps in ${flowWallMs.toFixed(0)}ms): p50=${stepP50}ms p95=${stepP95.toFixed(1)}ms (budget ${STEP_P95_BUDGET_MS}ms, ADR-0014)\n` +
      `  concurrent step (C=${CONCURRENCY}, ${concStepDurations.length} steps in ${concWallMs.toFixed(0)}ms): p50=${concP50}ms p95=${concP95.toFixed(1)}ms (budget ${STEP_P95_BUDGET_MS}ms, ADR-0014)\n`,
  );

  const failures: string[] = [];
  if (readP95 > READ_P95_THRESHOLD_MS) failures.push(`read p95 ${readP95.toFixed(1)}ms exceeds ${READ_P95_THRESHOLD_MS}ms`);
  if (stepP95 > STEP_P95_BUDGET_MS) failures.push(`flow-step p95 ${stepP95.toFixed(1)}ms exceeds ${STEP_P95_BUDGET_MS}ms (ADR-0014)`);
  if (concP95 > STEP_P95_BUDGET_MS) failures.push(`concurrent-step p95 ${concP95.toFixed(1)}ms exceeds ${STEP_P95_BUDGET_MS}ms (ADR-0014)`);
  if (failures.length > 0) {
    process.stderr.write(`load-smoke: latency regression - ${failures.join("; ")}\n`);
    process.exit(1);
  }
  process.stdout.write("load-smoke: PASS\n");
}

main().catch((e) => {
  process.stderr.write(`load-smoke error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
