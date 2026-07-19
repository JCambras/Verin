/**
 * Minimal, clearly-labeled functional seed (captain D-005: port the feel, DEFER
 * the populated demo world). Seeds ONLY what the walking skeleton, its Playwright
 * specs, and the console need: one org, two demo users, and ONE audited seed
 * marker — so the audit-chain-verify gate has a real chain entry to verify
 * (charter #4: a gate that verifies zero entries is vacuous). Every row is labeled
 * source=verin-crm (charter #3). The demo password is a sacrificial DEMO credential
 * (ADR-0020), never a production secret. Idempotent.
 */
import { createDb } from "../src/infrastructure/store/db";
import { createUser, findUserByEmail } from "../src/infrastructure/identity/identity-store";
import { auditedWrite } from "../src/infrastructure/audit/audited-write";
import { getConfig } from "../src/infrastructure/config";

export const DEMO_ORG_ID = "org-verin-demo";
// DEMO ONLY (labeled local/CI seed) — not a production secret.
export const DEMO_PASSWORD = "verin-demo-pass-12345678"; // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password
export const DEMO_USERS = [
  { email: "principal@verin.test", displayName: "Priya Nair (Principal)", role: "principal" as const },
  { email: "advisor@verin.test", displayName: "Alex Rivera (Advisor)", role: "advisor" as const },
];

export async function seed(): Promise<void> {
  // The seed's demo credential is publicly committed: refuse production explicitly,
  // not merely transitively (today the postgres driver is deferred and throws, but
  // this guard must survive the day the production adapter lands).
  if (getConfig().appEnv === "production") {
    throw new Error("db-seed: refusing to run against APP_ENV=production (demo users carry a publicly committed password)");
  }
  const db = await createDb();
  const now = new Date().toISOString();
  await db.query(
    "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'verin-crm',$3,'high') ON CONFLICT (id) DO NOTHING",
    [DEMO_ORG_ID, "Verin Demo Firm", now],
  );
  for (const u of DEMO_USERS) {
    if (await findUserByEmail(db, u.email)) continue;
    await createUser(db, { orgId: DEMO_ORG_ID, email: u.email, displayName: u.displayName, role: u.role, password: DEMO_PASSWORD });
  }
  // Exactly-once (idempotency key): re-running the seed replays the cached result
  // instead of appending another entry.
  const audited = await auditedWrite({
    db,
    orgId: DEMO_ORG_ID,
    actor: "seed",
    action: "org.seed",
    entityType: "Org",
    entityId: DEMO_ORG_ID,
    idempotencyKey: `seed:${DEMO_ORG_ID}`,
    detail: `Seeded demo org with ${DEMO_USERS.length} demo users`,
    perform: async () => ({ users: DEMO_USERS.length }),
  });
  if (!audited.ok) throw new Error(`seed audit entry failed: ${audited.error.code} ${audited.error.message}`);
  await db.close();
}

seed()
  .then(() => {
    process.stdout.write(`seeded org ${DEMO_ORG_ID} with ${DEMO_USERS.length} demo users\n`);
  })
  .catch((e) => {
    process.stderr.write(`seed failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
