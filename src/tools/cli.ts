// The tooling role's entry-script composition root (prompt 2 section 3): bootstrap, the owned
// forward-only migration runner (5B.3), the labelled demonstration seed (5B.6), and the SBOM
// generator. verin_migrator owns every table; its credential never enters the runtime kernel. The
// seed names record_origin explicitly at every insert - never a column default.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { Client } from "pg";
import { maskAccountReference } from "../evidence/pii";
import { createGovernedRuntime, mintRequestId, requestCorrelation } from "../runtime/governed";
import { createAccessContext, signIn } from "../access/context";
import { POLICY_OPERATION_DEADLINE_MS, createPolicyVersionRegistry } from "../policy/registry";

const MIGRATIONS_DIR = "src/store/migrations";
const DEMO = [
  {
    org: "Meridian Wealth Partners",
    email: "advisor@firm-a.example",
    name: "Alex Rivera",
    role: "advisor",
    phrase: "meridian-slate-88",
    households: ["Henderson Family", "Delgado Household", "Okonkwo Trust", "Ashford Grantor Trust"],
  },
  { org: "Harbor Point Advisors", email: "advisor@firm-b.example", name: "Priya Nair", role: "advisor", phrase: "harbor-quartz-42", households: ["Vance Household", "Mensah Family"] },
];
// The labelled demonstration observations (prompt 3 deliverable 6): the present case, every kind
// observed and fresh. Account references enter ONLY through the PII module's masked factory; each
// row's origin is named at its insert, never a column default.
const masked = (display: string) => maskAccountReference(display).display;
type SeedObservation = { household: string; kind: string; subject: string; body: Record<string, string>; observedDaysAgo: number };
const HENDERSON: Omit<SeedObservation, "household">[] = [
  { kind: "people", subject: "person:margaret-henderson", body: { Name: "Margaret Henderson", Role: "Primary client", Born: "1958" }, observedDaysAgo: 6 },
  { kind: "people", subject: "person:robert-henderson", body: { Name: "Robert Henderson", Role: "Joint client", Born: "1956" }, observedDaysAgo: 6 },
  // The balance carries machine-usable keys (AvailableUsd, RegistrationClass) beside the worded
  // ones: the decision engine's fact extraction is strict and fail-closed, and a figure it cannot
  // read is a figure it refuses to decide on (slice 5; REVISED_BODIES repairs upgraded stores).
  {
    kind: "account-balance",
    subject: `account:${masked("ending 4821")}`,
    body: { Registration: "Joint brokerage", Account: masked("ending 4821"), Balance: "$412,000", AvailableUsd: "412000", RegistrationClass: "taxable" },
    observedDaysAgo: 6,
  },
  { kind: "bank-instruction", subject: "instruction:first-national", body: { Bank: "First National", Account: masked("ending 2210"), Standing: "verified on file" }, observedDaysAgo: 12 },
  {
    kind: "beneficiary-designation",
    subject: `account:${masked("ending 7753")}`,
    body: { Registration: "Traditional IRA", Primary: "Robert Henderson", Contingent: "Henderson Family Trust" },
    observedDaysAgo: 21,
  },
  // Slice 5 (vocabulary 1.1.0): the five decision-read classes, observed for the present-case
  // household so the present case stays absence-free and a LIVE proceed is reachable.
  { kind: "planned-withdrawals", subject: "schedule:henderson-household", body: { Schedule: "Recurring monthly withdrawals", MonthlyUsd: "8000" }, observedDaysAgo: 6 },
  { kind: "pending-actions", subject: "pending:henderson-household", body: { Standing: "No pending approved activity", PendingTotalUsd: "0" }, observedDaysAgo: 6 },
  {
    kind: "household-instruction",
    subject: "instruction:henderson-liquidity-preference",
    body: { InstructionKind: "liquidity-preference", Preference: "taxable-before-retirement", VersionId: "henderson-liquidity-preference@v1" },
    observedDaysAgo: 20,
  },
  { kind: "regulatory-status", subject: "status:henderson-household", body: { Standing: "No known restriction", HoldActive: "false" }, observedDaysAgo: 6 },
  { kind: "household-directory", subject: "directory:henderson-family", body: { Resolution: "Resolves uniquely in the advisor's book", CandidateCount: "1" }, observedDaysAgo: 6 },
];
// Bodies revised since an earlier seed shipped them. The repair rewrites the seed's OWN
// demonstration rows - matched by household, kind, subject AND the exact prior body, only at
// record_origin 'demo-seed' - so an upgraded store carries the same evidence a virgin one does.
// Its reach stops there: operator-entered rows are never touched, and a row already revised is a
// no-op because the per-row seed guard below matches on the exact current body.
const REVISED_BODIES: { household: string; kind: string; subject: string; from: Record<string, string>; to: Record<string, string> }[] = [
  {
    household: "Henderson Family",
    kind: "account-balance",
    subject: `account:${masked("ending 4821")}`,
    from: { Registration: "Joint brokerage", Account: masked("ending 4821"), Balance: "$412,000" },
    to: { Registration: "Joint brokerage", Account: masked("ending 4821"), Balance: "$412,000", AvailableUsd: "412000", RegistrationClass: "taxable" },
  },
];
// Delgado renders the receded states (prompt 3 PR-3b): one stale, one aging, two DISAGREEING
// bank-instruction observations of the SAME subject (both retained, never reconciled by recency),
// and beneficiary-designation left genuinely absent; Okonkwo carries nothing at all (the M-D state).
const DELGADO: Omit<SeedObservation, "household">[] = [
  { kind: "people", subject: "person:luis-delgado", body: { Name: "Luis Delgado", Role: "Primary client", Born: "1962" }, observedDaysAgo: 45 },
  { kind: "account-balance", subject: `account:${masked("ending 3377")}`, body: { Registration: "Individual brokerage", Account: masked("ending 3377"), Balance: "$188,000" }, observedDaysAgo: 140 },
  { kind: "bank-instruction", subject: "instruction:coastal-savings", body: { Bank: "Coastal Savings", Account: masked("ending 8845"), Standing: "verified on file" }, observedDaysAgo: 30 },
  { kind: "bank-instruction", subject: "instruction:coastal-savings", body: { Bank: "Coastal Savings", Account: masked("ending 9911"), Standing: "reported changed by client" }, observedDaysAgo: 8 },
];
// Ashford renders the PROHIBITED live state: clean figures, but an active legal hold - the stamp,
// zero affordances. Vance renders firm B's BLOCKED live state: a recently changed, unverified
// destination instruction under block-until-independently-verified (the Standing marking is the
// Delgado idiom, evergreen - no fixed date to decay stale).
const ASHFORD: Omit<SeedObservation, "household">[] = [
  {
    kind: "account-balance",
    subject: `account:${masked("ending 6612")}`,
    body: { Registration: "Trust brokerage", Account: masked("ending 6612"), Balance: "$620,000", AvailableUsd: "620000", RegistrationClass: "taxable" },
    observedDaysAgo: 3,
  },
  { kind: "planned-withdrawals", subject: "schedule:ashford-trust", body: { Schedule: "Recurring monthly withdrawals", MonthlyUsd: "12000" }, observedDaysAgo: 3 },
  {
    kind: "regulatory-status",
    subject: "status:ashford-trust",
    body: { Standing: "Active legal hold recorded by operations", HoldActive: "true", VersionId: "reg-distribution-holds@2026.02" },
    observedDaysAgo: 9,
  },
];
// Mensah renders the TYPED-SILENCE live state: clean verified evidence, so an over-threshold
// request meets firm B's not-stated approver role and requester rule - and refuses honestly, the
// ratified behavior (not-stated values produce honest refusals, never invented approvals).
const MENSAH: Omit<SeedObservation, "household">[] = [
  {
    kind: "account-balance",
    subject: `account:${masked("ending 9034")}`,
    body: { Registration: "Family brokerage", Account: masked("ending 9034"), Balance: "$910,000", AvailableUsd: "910000", RegistrationClass: "taxable" },
    observedDaysAgo: 5,
  },
  { kind: "planned-withdrawals", subject: "schedule:mensah-family", body: { Schedule: "Recurring monthly withdrawals", MonthlyUsd: "15000" }, observedDaysAgo: 5 },
  { kind: "bank-instruction", subject: "instruction:accra-first", body: { Bank: "Accra First", Account: masked("ending 3321"), Standing: "verified on file" }, observedDaysAgo: 10 },
];
const VANCE: Omit<SeedObservation, "household">[] = [
  {
    kind: "account-balance",
    subject: `account:${masked("ending 5540")}`,
    body: { Registration: "Joint brokerage", Account: masked("ending 5540"), Balance: "$530,000", AvailableUsd: "530000", RegistrationClass: "taxable" },
    observedDaysAgo: 4,
  },
  { kind: "planned-withdrawals", subject: "schedule:vance-household", body: { Schedule: "Recurring monthly withdrawals", MonthlyUsd: "9000" }, observedDaysAgo: 4 },
  { kind: "bank-instruction", subject: "instruction:harborside-bank", body: { Bank: "Harborside Bank", Account: masked("ending 7788"), Standing: "reported changed by client" }, observedDaysAgo: 2 },
];
const OBSERVATIONS: SeedObservation[] = [
  ...HENDERSON.map((o) => ({ household: "Henderson Family", ...o })),
  ...DELGADO.map((o) => ({ household: "Delgado Household", ...o })),
  ...ASHFORD.map((o) => ({ household: "Ashford Grantor Trust", ...o })),
  ...VANCE.map((o) => ({ household: "Vance Household", ...o })),
  ...MENSAH.map((o) => ({ household: "Mensah Family", ...o })),
];
// The two firm policy documents (deliverable 3): hand-authored re-expressions of the ratified matrix
// (DC-5; derivation in PR-4a's body); every matrix-silent field is the typed "not-stated".
const FIRM_POLICY: Record<string, string> = {
  "advisor@firm-a.example": `{"reserveHorizonMonths":6,"dualApproval":{"thresholdUsd":25000,"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"operations","requesterRule":"may-not-satisfy-both-approvals"},"bankInstructionChange":"specialist-review","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`,
  "advisor@firm-b.example": `{"reserveHorizonMonths":12,"dualApproval":{"thresholdUsd":100000,"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"not-stated","requesterRule":"not-stated"},"bankInstructionChange":"block-until-independently-verified","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`,
};
const url = (name: string, fallback: string) => process.env[name] ?? fallback;
async function withClient<T>(connectionString: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function bootstrap() {
  await withClient(url("VERIN_SUPER_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres"), async (c) => {
    for (const [role, phrase, extra] of [
      ["verin_migrator", "verin-migrator-local", "CREATEDB"],
      ["verin_app", "verin-app-local", ""],
    ] as const) {
      const exists = await c.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (!exists.rowCount) await c.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEROLE ${extra} PASSWORD '${phrase}'`);
    }
    const db = await c.query("SELECT 1 FROM pg_database WHERE datname = 'verin'");
    if (!db.rowCount) await c.query("CREATE DATABASE verin OWNER verin_migrator");
    console.log("bootstrap: roles verin_migrator (not superuser), verin_app (not superuser) and database verin are present");
  });
}
const migratorUrl = () => url("VERIN_MIGRATOR_DATABASE_URL", "postgresql://verin_migrator:verin-migrator-local@localhost:5432/verin");

async function migrate() {
  await withClient(migratorUrl(), async (c) => {
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const ledger = (await c.query("SELECT version, name FROM schema_migrations ORDER BY version")).rows as { version: number; name: string }[];
    // Preflight: the ledger must be an exact contiguous prefix of the shipped list, proven before any DDL runs.
    ledger.forEach((row, i) => {
      if (row.version !== i + 1 || files[i] !== row.name)
        throw new Error(
          `migration ledger diverges from the shipped list at position ${i + 1}: ledger has (${row.version}, ${row.name}), shipped list has (${i + 1}, ${files[i] ?? "nothing"}); refusing to run`,
        );
    });
    if (ledger.length > files.length) throw new Error(`the ledger records ${ledger.length} migrations but only ${files.length} are shipped; refusing to run`);
    console.log(`preflight: ledger is an exact contiguous prefix (${ledger.length} of ${files.length} shipped migrations applied)`);
    const pending = files.slice(ledger.length);
    await c.query("BEGIN");
    try {
      for (const f of pending) {
        await c.query(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"));
        await c.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [files.indexOf(f) + 1, f]);
        console.log(`applied ${files.indexOf(f) + 1} ${f}`);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    if (!pending.length) console.log("nothing pending; the store is at the shipped head");
  });
}

async function seed() {
  // The seed refuses a production deployment outright (prompt 3 deliverable 6): demonstration rows
  // never enter a store the flag says is real, and APP_ENV is the deployment flag (never NODE_ENV).
  if (process.env.APP_ENV === "production") throw new Error("seed: refusing to write demonstration rows into a production deployment (APP_ENV=production)");
  await withClient(migratorUrl(), async (c) => {
    for (const d of DEMO) {
      await c.query("BEGIN");
      await c.query("SELECT set_config('verin.login_email', $1, true)", [d.email]);
      const existing = await c.query("SELECT org_id FROM identity WHERE login_email = $1", [d.email]);
      const orgId = existing.rowCount ? (existing.rows[0] as { org_id: string }).org_id : randomUUID();
      await c.query("SELECT set_config('verin.org_id', $1, true)", [orgId]);
      if (!existing.rowCount) {
        const salt = randomBytes(16).toString("hex");
        await c.query("INSERT INTO org (id, name, record_origin) VALUES ($1, $2, 'demo-seed')", [orgId, d.org]);
        await c.query("INSERT INTO identity (id, org_id, login_email, display_name, role, credential_hash, credential_salt, record_origin) VALUES ($1, $2, $3, $4, $5, $6, $7, 'demo-seed')", [
          randomUUID(),
          orgId,
          d.email,
          d.name,
          d.role,
          scryptSync(d.phrase, salt, 32).toString("hex"),
          salt,
        ]);
      }
      // Households seed PER NAME, so an upgraded store receives a household a later slice adds.
      let households = 0;
      for (const h of d.households) {
        const have = await c.query("SELECT 1 FROM household WHERE org_id = $1 AND name = $2 LIMIT 1", [orgId, h]);
        if (have.rowCount) continue;
        await c.query("INSERT INTO household (id, org_id, name, record_origin, recorded_at) VALUES ($1, $2, $3, 'demo-seed', now())", [randomUUID(), orgId, h]);
        households += 1;
      }
      if (households) console.log(`seed: demonstration org '${d.org}', advisor ${d.email} and ${households} households written with record_origin='demo-seed'`);
      // Observations seed PER ROW: a row is written unless a row with the same household, kind,
      // subject and exact body already exists, so an upgraded store receives what it lacks (a new
      // vocabulary class, a revised body) without ever duplicating what it has - and the Delgado
      // conflict pair (same subject, two bodies) still seeds both sides. Revised bodies are
      // repaired FIRST, so the guard then matches the current bytes and writes nothing twice.
      let written = 0;
      for (const name of [...new Set(OBSERVATIONS.map((o) => o.household))]) {
        const home = await c.query("SELECT id FROM household WHERE org_id = $1 AND name = $2", [orgId, name]);
        if (!home.rowCount) continue;
        const homeId = (home.rows[0] as { id: string }).id;
        for (const r of REVISED_BODIES.filter((x) => x.household === name)) {
          const repaired = await c.query(
            "UPDATE observation SET body_json = $4::jsonb WHERE household_id = $1 AND kind = $2 AND subject = $3 AND body_json = $5::jsonb AND record_origin = 'demo-seed'",
            [homeId, r.kind, r.subject, JSON.stringify(r.to), JSON.stringify(r.from)],
          );
          if (repaired.rowCount) console.log(`seed: revised ${r.kind} body for '${name}' (${repaired.rowCount} demo-seed row repaired in place)`);
        }
        for (const o of OBSERVATIONS.filter((x) => x.household === name)) {
          const dup = await c.query("SELECT 1 FROM observation WHERE household_id = $1 AND kind = $2 AND subject = $3 AND body_json = $4::jsonb LIMIT 1", [
            homeId,
            o.kind,
            o.subject,
            JSON.stringify(o.body),
          ]);
          if (dup.rowCount) continue;
          await c.query(
            "INSERT INTO observation (id, org_id, household_id, kind, subject, body_json, source, observed_at, retrieved_at, record_origin) VALUES ($1, $2, $3, $4, $5, $6, 'house-record-store', now() - make_interval(days => $7), now(), 'demo-seed')",
            [randomUUID(), orgId, homeId, o.kind, o.subject, JSON.stringify(o.body), o.observedDaysAgo],
          );
          written += 1;
        }
      }
      if (written) console.log(`seed: ${written} demonstration observations written for '${d.org}' with record_origin='demo-seed'`);
      if (!households && !written) console.log(`seed: ${d.email} and its book already present; skipped`);
      await c.query("COMMIT");
    }
  });
  // Publish each firm's policy through the REAL publish path (deliverable 8), signed in as the
  // firm's advisor; tooling publishes carry record_origin='demo-seed', and a re-run is skipped.
  createGovernedRuntime("tooling");
  const access = createAccessContext();
  const registry = createPolicyVersionRegistry();
  for (const d of DEMO) {
    const c = requestCorrelation(mintRequestId());
    const session = await signIn(c, d.email, d.phrase);
    if (!session) throw new Error(`seed: could not sign in as ${d.email} to publish its firm policy`);
    const principal = await access.authenticate(c, session.cookieValue);
    const grant = await access.authorize(c, principal!, "policy.publish");
    try {
      const id = await registry.publish(c, grant!, new TextEncoder().encode(FIRM_POLICY[d.email]), { milliseconds: POLICY_OPERATION_DEADLINE_MS });
      console.log(`seed: published ${d.org}'s firm policy as fpd.v1:${id.digest} with record_origin='demo-seed'`);
    } catch (e) {
      if (!/already in this firm's sequence/.test(String(e))) throw e;
      console.log(`seed: ${d.org}'s firm policy is already on its shelf; skipped (no duplicate identities)`);
    }
  }
}

// The release subject's SBOM, generated deterministically from the frozen lockfile (bucket G): the
// component set is the lockfile's resolved set, sorted, no timestamps, so regeneration byte-matches.
async function sbom() {
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  const seen = new Set<string>();
  for (const m of lock.matchAll(/^ {2}'?\/?((?:@[\w.-]+\/)?[\w.-]+)@([\w.-]+(?:\([^)]*\))*)'?:\s*$/gm)) seen.add(`${m[1]}@${m[2].replace(/\(.*/, "")}`);
  const components = [...seen].sort().map((c) => {
    const at = c.lastIndexOf("@");
    return { type: "library", name: c.slice(0, at), version: c.slice(at + 1) };
  });
  const doc = { bomFormat: "CycloneDX", specVersion: "1.5", metadata: { component: { type: "application", name: "docs/evidence/verin-0.2.0.tgz", version: "0.2.0" } }, components };
  const bytes = JSON.stringify(doc, null, 2) + "\n";
  if (process.argv[3] === "--print") process.stdout.write(bytes);
  else {
    writeFileSync("docs/evidence/verin-0.2.0.cdx.json", bytes);
    console.log(`sbom: ${components.length} components from the frozen lockfile`);
  }
}

const cmd = process.argv[2];
const run = cmd === "bootstrap" ? bootstrap : cmd === "migrate" ? migrate : cmd === "seed" ? seed : cmd === "sbom" ? sbom : null;
if (!run) {
  console.error("usage: tsx src/tools/cli.ts bootstrap|migrate|seed|sbom");
  process.exit(2);
}
run().then(
  () => process.exit(0),
  (e) => {
    console.error(String(e));
    process.exit(1);
  },
);
