// The tooling role's entry-script composition root (prompt 2 section 3): bootstrap, the owned
// forward-only migration runner (5B.3), the labelled demonstration seed (5B.6), and the SBOM
// generator. verin_migrator owns every table; its credential never enters the runtime kernel. The
// seed names record_origin explicitly at every insert - never a column default.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { Client } from "pg";

const MIGRATIONS_DIR = "src/store/migrations";
const DEMO = [
  { org: "Meridian Wealth Partners", email: "advisor@firm-a.example", name: "Alex Rivera", role: "advisor", phrase: "meridian-slate-88", households: ["Henderson Family", "Delgado Household", "Okonkwo Trust"] },
  { org: "Harbor Point Advisors", email: "advisor@firm-b.example", name: "Priya Nair", role: "advisor", phrase: "harbor-quartz-42", households: ["Vance Household", "Mensah Family"] },
];
const url = (name: string, fallback: string) => process.env[name] ?? fallback;
async function withClient<T>(connectionString: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function bootstrap() {
  await withClient(url("VERIN_SUPER_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres"), async (c) => {
    for (const [role, phrase, extra] of [["verin_migrator", "verin-migrator-local", "CREATEDB"], ["verin_app", "verin-app-local", ""]] as const) {
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
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const ledger = (await c.query("SELECT version, name FROM schema_migrations ORDER BY version")).rows as { version: number; name: string }[];
    // Preflight: the ledger must be an exact contiguous prefix of the shipped list, proven before any DDL runs.
    ledger.forEach((row, i) => {
      if (row.version !== i + 1 || files[i] !== row.name)
        throw new Error(`migration ledger diverges from the shipped list at position ${i + 1}: ledger has (${row.version}, ${row.name}), shipped list has (${i + 1}, ${files[i] ?? "nothing"}); refusing to run`);
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
    } catch (e) { await c.query("ROLLBACK"); throw e; }
    if (!pending.length) console.log("nothing pending; the store is at the shipped head");
  });
}

async function seed() {
  await withClient(migratorUrl(), async (c) => {
    for (const d of DEMO) {
      await c.query("BEGIN");
      await c.query("SELECT set_config('verin.login_email', $1, true)", [d.email]);
      const existing = await c.query("SELECT org_id FROM identity WHERE login_email = $1", [d.email]);
      let orgId = existing.rowCount ? (existing.rows[0] as { org_id: string }).org_id : randomUUID();
      await c.query("SELECT set_config('verin.org_id', $1, true)", [orgId]);
      if (!existing.rowCount) {
        const salt = randomBytes(16).toString("hex");
        await c.query("INSERT INTO org (id, name, record_origin) VALUES ($1, $2, 'demo-seed')", [orgId, d.org]);
        await c.query("INSERT INTO identity (id, org_id, login_email, display_name, role, credential_hash, credential_salt, record_origin) VALUES ($1, $2, $3, $4, $5, $6, $7, 'demo-seed')",
          [randomUUID(), orgId, d.email, d.name, d.role, scryptSync(d.phrase, salt, 32).toString("hex"), salt]);
      }
      const have = await c.query("SELECT 1 FROM household WHERE org_id = $1 LIMIT 1", [orgId]);
      if (have.rowCount) { await c.query("ROLLBACK"); console.log(`seed: ${d.email} and its households already present; skipped`); continue; }
      for (const h of d.households)
        await c.query("INSERT INTO household (id, org_id, name, record_origin) VALUES ($1, $2, $3, 'demo-seed')", [randomUUID(), orgId, h]);
      await c.query("COMMIT");
      console.log(`seed: demonstration org '${d.org}', advisor ${d.email} and ${d.households.length} households written with record_origin='demo-seed'`);
    }
  });
}

// The release subject's SBOM, generated deterministically from the frozen lockfile (bucket G): the
// component set is the lockfile's resolved set, sorted, no timestamps, so regeneration byte-matches.
async function sbom() {
  const lock = readFileSync("pnpm-lock.yaml", "utf8");
  const seen = new Set<string>();
  for (const m of lock.matchAll(/^ {2}'?\/?((?:@[\w.-]+\/)?[\w.-]+)@([\w.-]+(?:\([^)]*\))*)'?:\s*$/gm)) seen.add(`${m[1]}@${m[2].replace(/\(.*/, "")}`);
  const components = [...seen].sort().map((c) => { const at = c.lastIndexOf("@"); return { type: "library", name: c.slice(0, at), version: c.slice(at + 1) }; });
  const doc = { bomFormat: "CycloneDX", specVersion: "1.5", metadata: { component: { type: "application", name: "docs/evidence/verin-0.2.0.tgz", version: "0.2.0" } }, components };
  const bytes = JSON.stringify(doc, null, 2) + "\n";
  if (process.argv[3] === "--print") process.stdout.write(bytes);
  else { writeFileSync("docs/evidence/verin-0.2.0.cdx.json", bytes); console.log(`sbom: ${components.length} components from the frozen lockfile`); }
}

const cmd = process.argv[2];
const run = cmd === "bootstrap" ? bootstrap : cmd === "migrate" ? migrate : cmd === "seed" ? seed : cmd === "sbom" ? sbom : null;
if (!run) { console.error("usage: tsx src/tools/cli.ts bootstrap|migrate|seed|sbom"); process.exit(2); }
run().catch((e) => { console.error(String(e)); process.exit(1); });
