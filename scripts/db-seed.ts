/**
 * The functional seed. Seeds the firm itself — one org, two demo users, and ONE
 * audited seed marker, so the audit-chain-verify gate has a real chain entry to
 * verify (charter #4: a gate that verifies zero entries is vacuous) — and then
 * the POPULATED WORLD (ADR-0057): a hundred named households and their people,
 * every row carrying record_origin=world-fixture, which is what the clean-slate
 * check counts - the ROW's origin never moves, while the provenance of a value
 * in it does the moment somebody edits it. Their values land source=fixture
 * while the firm's own rows stay source=verin-crm; the world's do not pretend to
 * be records this firm produced (charter #3). The demo password is a sacrificial
 * DEMO credential (ADR-0020), never a production secret. Idempotent throughout.
 */
import { createDb } from "../src/infrastructure/store/db";
import { createUser, findUserByEmail } from "../src/infrastructure/identity/identity-store";
import { auditedWrite } from "../src/infrastructure/audit/audited-write";
import { getConfig } from "../src/infrastructure/config";
import { systemTenant } from "../src/contracts/tenant";
import { systemWriteActor } from "../src/contracts/principal";
import { seedWorldIntoCrm } from "../src/infrastructure/crm/world-seed";
import type { SqlDb } from "../src/infrastructure/store/db";
import type { WriteActor } from "../src/contracts/principal";
import { generateWorld } from "./world/generate";
import { loadWorldSpec, WORLD_SEED } from "./world/spec";
import { errorMessage } from "./error-message";
import { seedDecisionLedger } from "./seed-decision-ledger";

export const DEMO_ORG_ID = "org-verin-demo";
// DEMO ONLY (labeled local/CI seed) — not a production secret.
export const DEMO_PASSWORD = "verin-demo-pass-12345678"; // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password
export const DEMO_USERS = [
  { email: "principal@verin.test", displayName: "Priya Nair (Principal)", role: "principal" as const },
  { email: "advisor@verin.test", displayName: "Alex Rivera (Advisor)", role: "advisor" as const },
];

export async function seed(): Promise<string> {
  // The seed's demo credential is publicly committed: refuse production explicitly,
  // not merely transitively (today the postgres driver is deferred and throws, but
  // this guard must survive the day the production adapter lands).
  if (getConfig().appEnv === "production") {
    throw new Error("db-seed: refusing to run against APP_ENV=production (demo users carry a publicly committed password)");
  }
  const db = await createDb();
  const tenant = systemTenant("seed", DEMO_ORG_ID);
  const seedActor = systemWriteActor("seed", DEMO_ORG_ID);
  const now = new Date().toISOString();
  await db.query(
    "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'verin-crm',$3,'high') ON CONFLICT (id) DO NOTHING",
    [DEMO_ORG_ID, "Verin Demo Firm", now],
  );
  for (const u of DEMO_USERS) {
    if (await findUserByEmail(db, u.email)) continue;
    await createUser(db, tenant, { email: u.email, displayName: u.displayName, role: u.role, password: DEMO_PASSWORD });
  }
  // Exactly-once (idempotency key): re-running the seed replays the cached result
  // instead of appending another entry.
  const audited = await auditedWrite({
    db,
    actor: seedActor,
    action: "org.seed",
    entityType: "Org",
    entityId: DEMO_ORG_ID,
    idempotencyKey: `seed:${DEMO_ORG_ID}`,
    detail: `Seeded demo org with ${DEMO_USERS.length} demo users`,
    perform: async () => ({ users: DEMO_USERS.length }),
  });
  if (!audited.ok) throw new Error(`seed audit entry failed: ${audited.error.code} ${audited.error.message}`);
  await seedDecisionLedger(db, DEMO_ORG_ID);
  const world = await seedWorld(db, seedActor);
  await db.close();
  return world;
}

/**
 * Load the world from the GENERATOR rather than from the committed fixture
 * files. The generator is the declared source of truth (ADR-0057) and
 * `pnpm world:validate` proves the committed tree equals its output byte for
 * byte, so seeding from it needs no second reader - and the runtime evidence
 * port stays what it should be: a `pii.view`-governed read for authorized
 * request handlers, not something a build-time script can reach around.
 */
async function seedWorld(db: SqlDb, actor: WriteActor): Promise<string> {
  const spec = loadWorldSpec();
  const world = generateWorld(spec, WORLD_SEED);
  const digest = String((world.manifest.value as Record<string, unknown>).worldDigest);
  const loaded = await seedWorldIntoCrm(db, actor, world.households, digest);
  if (!loaded.ok) throw new Error(`world seed failed: ${loaded.error.code} ${loaded.error.message}`);
  const { households, contacts, tasks } = loaded.value;
  return `${households} households, ${contacts} people, ${tasks} open items written (world ${spec.roster.worldVersion}, labeled fixture)`;
}

seed()
  .then((world) => {
    process.stdout.write(`seeded org ${DEMO_ORG_ID} with ${DEMO_USERS.length} demo users\n  world: ${world}\n`);
  })
  .catch((e) => {
    process.stderr.write(`seed failed: ${errorMessage(e)}\n`);
    process.exit(1);
  });
