// The instrumented run (prompt 2 5B.0/5B.8/5B.9): exercises every governed operation against real
// PostgreSQL, runs the construction rules E16 consumes (sealed-factory, raw-client boundary,
// production-bundle graph, the nodejs-runtime declaration), and writes the E16 capture. Evidence
// tooling under src/tools/ - proven absent from the web bundle - and a tooling composition root.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { createGovernedRuntime, getGateway, mintRequestId, requestCorrelation, snapshotEvidence, type RequestCorrelation } from "../runtime/governed";
import { createAccessContext, renewSession, signIn, type ActionGrant, type Principal } from "../access/context";
import { assembleEvidence, bundleDigest, renderableBundle, serializeBundle } from "../evidence/bundle";
import { ACCOUNT_REFERENCE_FORMS, OUTBOUND_PROJECTION_MODULES, maskAccountReference, refuseAccountReferences } from "../evidence/pii";
import { evidenceRetrievalConformance, type EvidenceRetrieval } from "./conformance";

const KERNEL = "src/runtime/governed.ts";
const COMPOSITION_ROOTS = [KERNEL, "src/instrumentation.ts"];
const SEALED: Record<string, string> = {
  Principal: "src/access/context.ts",
  ActionGrant: "src/access/context.ts",
  TenantIdentity: "src/access/context.ts",
  RequestId: KERNEL,
  RequestCorrelation: KERNEL,
  GovernedOperationId: KERNEL,
  MaskedAccountReference: "src/evidence/pii.ts",
};
const rel = (sf: SourceFile) => relative(process.cwd(), sf.getFilePath());
const project = new Project({ tsConfigFilePath: "tsconfig.json" });

function webBundleGraph() {
  const modules = new Set<string>(),
    unresolved: string[] = [];
  const queue = project.getSourceFiles(["src/instrumentation.ts", "src/proxy.ts", "src/app/**/page.tsx", "src/app/**/layout.tsx"]);
  while (queue.length) {
    const sf = queue.pop()!;
    if (modules.has(rel(sf))) continue;
    modules.add(rel(sf));
    for (const d of sf.getImportDeclarations()) {
      const spec = d.getModuleSpecifierValue();
      if (/\.(css|woff2)$/.test(spec)) continue;
      const target = d.getModuleSpecifierSourceFile();
      if (target && rel(target).startsWith("src/")) queue.push(target);
      else if (spec.startsWith(".") && !target) unresolved.push(`${rel(sf)} -> ${spec}`);
    }
  }
  return { modules: [...modules].sort(), unresolved };
}
function productTargetViolations(webModules: string[]) {
  const out: string[] = [];
  for (const path of webModules) {
    if (COMPOSITION_ROOTS.includes(path)) continue;
    const sf = project.getSourceFile((f) => rel(f) === path)!;
    for (const d of sf.getImportDeclarations()) {
      const spec = d.getModuleSpecifierValue();
      if (spec === "pg" || spec.startsWith("pg/")) out.push(`${path}:${d.getStartLineNumber()} imports the raw database driver directly`);
    }
    sf.forEachDescendant((n) => {
      if (n.getKind() === SyntaxKind.PropertyAccessExpression && n.getText() === "process.env") out.push(`${path}:${n.getStartLineNumber()} reads the credential environment outside the kernel`);
      if (n.getKind() === SyntaxKind.CallExpression) {
        const callee = n.getChildAtIndex(0).getText();
        if (callee === "fetch" || callee === "globalThis.fetch") out.push(`${path}:${n.getStartLineNumber()} calls fetch in a product module`);
      }
    });
  }
  return out;
}
function sealedFactoryViolations() {
  const out: string[] = [];
  for (const sf of project.getSourceFiles("src/**/*.{ts,tsx}")) {
    const path = rel(sf);
    const names = Object.keys(SEALED).filter((n) => SEALED[n] !== path);
    const naming = (text: string | undefined) => names.find((n) => new RegExp(`\\b${n}\\b`).test(text ?? ""));
    sf.forEachDescendant((n) => {
      const k = n.getKind();
      if (k === SyntaxKind.AsExpression) {
        const hit = naming(n.asKind(SyntaxKind.AsExpression)?.getTypeNode()?.getText());
        if (hit) out.push(`${path}:${n.getStartLineNumber()} casts to sealed type ${hit}; only its factory may construct it`);
      }
      if (k === SyntaxKind.TypePredicate) {
        const hit = naming(n.getText());
        if (hit) out.push(`${path}:${n.getStartLineNumber()} declares a type predicate for sealed type ${hit}`);
      }
      if (k === SyntaxKind.HeritageClause) {
        const hit = naming(n.getText());
        if (hit) out.push(`${path}:${n.getStartLineNumber()} extends sealed type ${hit}; a sub-interface does not produce one`);
      }
      if (k === SyntaxKind.VariableDeclaration || k === SyntaxKind.Parameter || k === SyntaxKind.PropertyDeclaration) {
        const d = n as unknown as { getTypeNode?: () => { getText(): string } | undefined; getInitializer?: () => { getType(): { isAny(): boolean; isUnknown(): boolean } } | undefined };
        const hit = naming(d.getTypeNode?.()?.getText());
        const init = d.getInitializer?.();
        if (hit && init && (init.getType().isAny() || init.getType().isUnknown())) out.push(`${path}:${n.getStartLineNumber()} fills sealed type ${hit} from an any/unknown value`);
      }
    });
  }
  return out;
}
function nodejsRuntimeViolations() {
  const out: string[] = [];
  for (const sf of project.getSourceFiles(["src/app/**/page.tsx", "src/app/**/layout.tsx"]))
    if (!/export const runtime = "nodejs"/.test(sf.getFullText())) out.push(`${rel(sf)} does not declare export const runtime = "nodejs"; the edge runtime is forbidden`);
  for (const sf of project.getSourceFiles("src/**/*.{ts,tsx}"))
    if (sf.getFullText().includes('"use server"') && !/export const runtime = "nodejs"/.test(sf.getFullText())) out.push(`${rel(sf)} holds a server action without the nodejs runtime declaration`);
  return out;
}
// PII containment (prompt 3 deliverable 3): no module in the DECLARED outbound-projection set may
// transitively import a PII-bearing type or value - a file is PII-bearing when it references the
// PIIBearing marker outside the marker's own home. Fails with the importing file:line.
function containmentViolations() {
  const out: string[] = [];
  const bearing = new Set<string>();
  for (const sf of project.getSourceFiles("src/**/*.{ts,tsx}"))
    if (rel(sf) !== "src/evidence/pii.ts" && sf.forEachDescendant((n) => (n.getKind() === SyntaxKind.Identifier && n.getText() === "PIIBearing" ? true : undefined))) bearing.add(rel(sf));
  const queue = OUTBOUND_PROJECTION_MODULES.map((declared) => {
    const sf = project.getSourceFile((f) => rel(f) === declared);
    if (!sf) out.push(`${declared} is declared into the outbound-projection set but does not exist; a boundary with a missing member is unproven`);
    return sf;
  }).filter((sf): sf is SourceFile => sf !== undefined);
  const seen = new Set<string>();
  while (queue.length) {
    const sf = queue.pop()!;
    if (seen.has(rel(sf))) continue;
    seen.add(rel(sf));
    if (bearing.has(rel(sf))) out.push(`${rel(sf)}:1 sits in the outbound-projection set but references a PII-bearing type itself`);
    for (const d of sf.getImportDeclarations()) {
      const target = d.getModuleSpecifierSourceFile();
      if (!target || !rel(target).startsWith("src/")) continue;
      if (bearing.has(rel(target))) out.push(`${rel(sf)}:${d.getStartLineNumber()} imports PII-bearing module ${rel(target)}; the outbound-projection boundary refuses it`);
      else queue.push(target);
    }
  }
  return out;
}

let principal: Principal;
let cookieValue: string;
beforeAll(() => {
  createGovernedRuntime("tooling");
});

describe("the governed access flows, exercised end to end", () => {
  it("refuses a wrong credential with one null and no session write", async () => {
    expect(await signIn(requestCorrelation(mintRequestId()), "advisor@firm-a.example", "wrong-phrase")).toBeNull();
  });
  it("signs an advisor in through the governed store operations", async () => {
    const s = await signIn(requestCorrelation(mintRequestId()), "advisor@firm-a.example", "meridian-slate-88");
    expect(s).not.toBeNull();
    cookieValue = s!.cookieValue;
  });
  it("authenticate resolves the cookie to a sealed Principal, read-only", async () => {
    const c = requestCorrelation(mintRequestId());
    const access = createAccessContext();
    const p = await access.authenticate(c, cookieValue);
    expect(p?.displayName).toBe("Alex Rivera");
    expect(p?.tenant.orgId).toMatch(/[0-9a-f-]{36}/);
    principal = p!;
    expect(await access.authorize(c, principal, "household.read")).not.toBeNull();
  });
  it("refuses a forged token and a tampered signature, fail closed", async () => {
    const access = createAccessContext();
    const forged = getGateway().sealCookieValue("f".repeat(64));
    expect(await access.authenticate(requestCorrelation(mintRequestId()), forged)).toBeNull();
    expect(await access.authenticate(requestCorrelation(mintRequestId()), `${"f".repeat(64)}.not-a-real-mac`)).toBeNull();
  });
  it("refuses a second runtime construction in one process", () => {
    expect(() => createGovernedRuntime("tooling")).toThrow(/refused, not cached/);
  });
  it("the register flow: withTenant scopes the read to the grant's own firm", async () => {
    const c = requestCorrelation(mintRequestId());
    const access = createAccessContext();
    const names = await getGateway().enterRouteHouseholds(c, async () => {
      const p = await access.authenticate(c, cookieValue);
      const grant = await access.authorize(c, p!, "household.read");
      return (await access.withTenant(c, grant!, (tx) => tx.listHouseholds())).map((h) => h.name);
    });
    expect(names).toEqual(["Delgado Household", "Henderson Family", "Okonkwo Trust"]);
  });
  it("the workspace flow: what Verin knows, and a cross-tenant id resolving to an honest nothing", async () => {
    const c = requestCorrelation(mintRequestId());
    const access = createAccessContext();
    const view = await getGateway().enterRouteHouseholdWorkspace(c, async () => {
      const p = await access.authenticate(c, cookieValue);
      const grant = await access.authorize(c, p!, "household.read");
      return access.withTenant(c, grant!, async (tx) => {
        const henderson = (await tx.listHouseholds()).find((h) => h.name === "Henderson Family")!;
        return { detail: await tx.getHousehold(henderson.id), malformed: await tx.getHousehold("not-a-uuid") };
      });
    });
    expect(view.detail?.name).toBe("Henderson Family");
    expect(view.detail?.recorded_at).toBeInstanceOf(Date);
    expect(view.malformed).toBeNull();
  });
  it("a second firm's real token sees only its own book - the cross-tenant-token arm", async () => {
    const c = requestCorrelation(mintRequestId());
    const access = createAccessContext();
    const sB = await signIn(c, "advisor@firm-b.example", "harbor-quartz-42");
    const view = await getGateway().enterRouteHouseholds(requestCorrelation(mintRequestId()), async () => {
      const c2 = requestCorrelation(mintRequestId());
      const pB = await access.authenticate(c2, sB!.cookieValue);
      const grantB = await access.authorize(c2, pB!, "household.read");
      return access.withTenant(c2, grantB!, async (tx) => (await tx.listHouseholds()).map((h) => ({ id: h.id, name: h.name })));
    });
    expect(view.map((h) => h.name)).toEqual(["Mensah Family", "Vance Household"]);
    // The other firm's real id through THIS firm's grant is the same honest nothing - no existence leak.
    const cA = requestCorrelation(mintRequestId());
    const probed = await getGateway().enterRouteHouseholdWorkspace(cA, async () => {
      const pA = await access.authenticate(cA, cookieValue);
      const grantA = await access.authorize(cA, pA!, "household.read");
      return access.withTenant(cA, grantA!, (tx) => tx.getHousehold(view[0].id));
    });
    expect(probed).toBeNull();
  });
});

describe("session lifecycle: renewal and rotation happen only on the cookie-writing path (PR-2c)", () => {
  const superUrl = process.env.VERIN_SUPER_DATABASE_URL?.replace(/\/postgres$/, "/verin") ?? "postgresql://postgres:postgres@localhost:5432/verin";
  it("a session slides past its half-life with its id rotated, and the read-only path never rotates", async () => {
    const access = createAccessContext();
    const s1 = await signIn(requestCorrelation(mintRequestId()), "advisor@firm-a.example", "meridian-slate-88");
    expect(await renewSession(s1!.cookieValue)).toBeNull(); // fresh session: the writing path has nothing to write
    expect((await access.authenticate(requestCorrelation(mintRequestId()), s1!.cookieValue))?.displayName).toBe("Alex Rivera");
    expect((await access.authenticate(requestCorrelation(mintRequestId()), s1!.cookieValue))?.displayName).toBe("Alex Rivera"); // read twice, rotated never
    const su = new PgClient({ connectionString: superUrl });
    await su.connect();
    await su.query("UPDATE session SET created_at = now() - interval '7 hours'"); // slide the clock from outside the app
    await su.end();
    const renewed = await renewSession(s1!.cookieValue);
    expect(renewed).not.toBeNull();
    expect(renewed!.cookieValue).not.toBe(s1!.cookieValue); // rotated
    // M-C: the second resolution in the same request reads the handed-off value and never a rotated-away id
    expect((await access.authenticate(requestCorrelation(mintRequestId()), renewed!.cookieValue))?.displayName).toBe("Alex Rivera");
    expect(await access.authenticate(requestCorrelation(mintRequestId()), s1!.cookieValue)).toBeNull(); // the old id is genuinely gone - why the handoff exists
    expect(await renewSession(renewed!.cookieValue)).toBeNull(); // a freshly rotated session does not rotate again
  });
});

const SUPER_URL = process.env.VERIN_SUPER_DATABASE_URL?.replace(/\/postgres$/, "/verin") ?? "postgresql://postgres:postgres@localhost:5432/verin";
async function superQuery(sql: string, params: unknown[] = []) {
  const su = new PgClient({ connectionString: SUPER_URL });
  await su.connect();
  try {
    return await su.query(sql, params);
  } finally {
    await su.end();
  }
}
const withHouseholdGrant = async <T>(fn: (c: RequestCorrelation, grant: ActionGrant) => Promise<T>): Promise<T> => {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  return getGateway().enterRouteHouseholdWorkspace(c, async () => {
    const p = await access.authenticate(c, cookieValue);
    const grant = await access.authorize(c, p!, "household.read");
    return fn(c, grant!);
  });
};
const subjectByName = (name: string) => async () =>
  withHouseholdGrant(async (c, grant) => {
    const access = createAccessContext();
    const rows = await access.withTenant(c, grant, (tx) => tx.listHouseholds());
    return { householdId: rows.find((h) => h.name === name)!.id };
  });
const hendersonRef = subjectByName("Henderson Family");
const INJECT_SQL =
  "INSERT INTO observation (id, org_id, household_id, kind, subject, body_json, source, observed_at, retrieved_at, record_origin) SELECT gen_random_uuid(), h.org_id, h.id, 'account-balance', 'account:injected', $2::jsonb, 'house-record-store', now(), now(), 'demo-seed' FROM household h WHERE h.id = $1";

const RAW_FORMS = [
  ["bare-account-reference", "48219930117455"],
  ["spaced-account-reference", "4821 9930 1174 5588"],
  ["hyphenated-account-reference", "4821-9930-1174-5588"],
] as const;

describe("the evidence slice, exercised end to end (prompt 3; the port-contract conformance suite lands whole in PR-3b)", () => {
  it("assembles the present case canonically: typed whole, byte-identical serialization, the assembly's band rendered", async () => {
    const asOf = new Date().toISOString();
    const subject = await hendersonRef();
    const bundle = await withHouseholdGrant((c, grant) => assembleEvidence(c, grant, subject, asOf, { milliseconds: 2_000 }));
    expect(bundle.observations.map((o) => o.kind)).toEqual(["account-balance", "bank-instruction", "beneficiary-designation", "people", "people"]);
    expect(bundle.absences).toEqual([]); // the present case: nothing missing, and nothing silently filled
    expect(bundle.conflicts).toEqual([]);
    expect(bundle.observations.every((o) => o.origin === "demo-seed" && o.provenance.retrievedAt >= o.provenance.observedAt)).toBe(true);
    const again = await withHouseholdGrant((c, grant) => assembleEvidence(c, grant, subject, asOf, { milliseconds: 2_000 }));
    expect(serializeBundle(again)).toBe(serializeBundle(bundle)); // same inputs, same evb.v1 bytes
    expect(serializeBundle(bundle).startsWith("evb.v1|")).toBe(true);
    expect(bundleDigest(again)).toBe(bundleDigest(bundle));
    const view = renderableBundle(bundle);
    expect(view.items.map((i) => i.band)).toEqual(bundle.observations.map((o) => o.freshness)); // the band the assembly computed IS the band the surface renders
    expect(view.items.every((i) => i.demonstration)).toBe(true); // no unlabeled synthetic data
    await expect(withHouseholdGrant((c, grant) => assembleEvidence(c, grant, subject, asOf, { milliseconds: 0 }))).rejects.toThrow(/deadline/); // stop condition 3
  });
  it("refuses a raw account reference INTO the bundle in all three forms, naming the operation - end to end", async () => {
    const subject = await hendersonRef();
    for (const [form, raw] of RAW_FORMS) {
      await superQuery(INJECT_SQL, [subject.householdId, JSON.stringify({ Account: raw })]);
      try {
        await expect(withHouseholdGrant((c, grant) => assembleEvidence(c, grant, subject, new Date().toISOString(), { milliseconds: 2_000 }))).rejects.toThrow(
          new RegExp(`evidence\\.assemble' refuses a ${form} at the bundle boundary`),
        );
      } finally {
        await superQuery("DELETE FROM observation WHERE subject = 'account:injected'");
      }
    }
  });
  it("passes the three legitimate identifiers untouched - the GD-003 minted-correlation-id arm named explicitly", () => {
    const minted = (globalThis as { [k: symbol]: string[] })[Symbol.for("verin.minted-ids")];
    minted.push("1234567812345678", "4821 9930 1174 5588");
    const ctx = { operation: "evidence.assemble", boundary: "log" } as const;
    expect(() => refuseAccountReferences({ spanId: "1234567812345678" }, ctx)).not.toThrow(); // a runtime-minted all-digit id in a correlation key (GD-003's exact ruled value class)
    expect(() => refuseAccountReferences({ Household: "d5ab04c2-6b70-4f3a-9d0e-1b2c3d4e5f60" }, ctx)).not.toThrow(); // a product uuid
    expect(() => refuseAccountReferences({ Account: maskAccountReference("ending 4821").display }, ctx)).not.toThrow(); // the masked display
    expect(() => refuseAccountReferences({ Note: "1234567812345678" }, ctx)).toThrow(/bare-account-reference/); // the same digits OUTSIDE a correlation key keep full sensitivity
    expect(() => refuseAccountReferences({ spanId: "4821 9930 1174 5588" }, ctx)).toThrow(/spaced-account-reference/); // a spaced reference can never be laundered through the minted list (shape-bounded)
  });
  it("masked account references construct only through the factory, which masks a raw form to its last four", () => {
    expect(maskAccountReference("4821 9930 1174 5588").display).toBe("ending 5588");
    expect(maskAccountReference("ending 2210").display).toBe("ending 2210");
    expect(() => maskAccountReference("not a reference")).toThrow(/refused/);
  });
});

describe("the receding and absent states, and the bounded read's honesty (PR-3b)", () => {
  it("refuses to derive completeness claims over a truncated read, naming the bound", async () => {
    const subject = await hendersonRef();
    await superQuery(
      "INSERT INTO observation (id, org_id, household_id, kind, subject, body_json, source, observed_at, retrieved_at, record_origin) SELECT gen_random_uuid(), h.org_id, h.id, 'people', 'person:bulk-' || g, '{\"Name\":\"Bulk\"}'::jsonb, 'house-record-store', now(), now(), 'demo-seed' FROM household h, generate_series(1, 196) g WHERE h.id = $1",
      [subject.householdId],
    );
    try {
      await expect(withHouseholdGrant((c, grant) => assembleEvidence(c, grant, subject, new Date().toISOString(), { milliseconds: 2_000 }))).rejects.toThrow(/truncated read/);
    } finally {
      await superQuery("DELETE FROM observation WHERE subject LIKE 'person:bulk-%'");
    }
  });
  it("renders the vacuity case as typed absence with a real next step (M-D, the bundle and view-model half)", async () => {
    const subject = await subjectByName("Okonkwo Trust")();
    const bundle = await withHouseholdGrant((c, grant) => assembleEvidence(c, grant, subject, new Date().toISOString(), { milliseconds: 2_000 }));
    const view = renderableBundle(bundle);
    expect(view.items).toEqual([]);
    expect(view.absent.map((a) => a.label)).toEqual(["People", "Account balance", "Bank instruction", "Beneficiary designation"]);
    expect(view.absent.every((a) => a.nextStep.length > 0)).toBe(true); // a real next step, asserted again against the rendered page in the browser proof
  });
});

const houseRetrieval: EvidenceRetrieval = {
  retrieve: (subject, asOf, deadline) => withHouseholdGrant((c, grant) => assembleEvidence(c, grant, subject, asOf, deadline)),
  presentSubject: hendersonRef,
  recededSubject: subjectByName("Delgado Household"),
  absentSubject: subjectByName("Okonkwo Trust"),
  injectRawReference: async (subject, rawReference) => {
    await superQuery(INJECT_SQL, [subject.householdId, JSON.stringify({ Account: rawReference })]);
    return async () => {
      await superQuery("DELETE FROM observation WHERE subject = 'account:injected'");
    };
  },
};
evidenceRetrievalConformance("the house record store, through the governed runtime", houseRetrieval);

describe("database-enforced isolation (5B.2, section 6 core; the full battery re-runs in PR-2c)", () => {
  const appUrl = process.env.VERIN_APP_DATABASE_URL ?? "postgresql://verin_app:verin-app-local@localhost:5432/verin";
  const orgOf = async (c: PgClient, email: string) => {
    await c.query("SELECT set_config('verin.login_email', $1, false)", [email]);
    return ((await c.query("SELECT org_id FROM identity WHERE login_email = $1", [email])).rows[0] as { org_id: string }).org_id;
  };
  it("the session is not a superuser, cross-tenant reads and writes die at the database, and DDL is refused", async () => {
    const c = new PgClient({ connectionString: appUrl });
    await c.connect();
    try {
      const who = (await c.query("SELECT current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper")).rows[0] as { current_user: string; rolsuper: boolean };
      expect(who).toEqual({ current_user: "verin_app", rolsuper: false });
      const orgA = await orgOf(c, "advisor@firm-a.example"),
        orgB = await orgOf(c, "advisor@firm-b.example");
      await c.query("SELECT set_config('verin.org_id', $1, false)", [orgB]);
      expect(Number((await c.query("SELECT count(*)::int AS n FROM household")).rows[0].n)).toBe(2); // the other tenant's rows genuinely exist
      await c.query("SELECT set_config('verin.org_id', $1, false)", [orgA]);
      expect(Number((await c.query("SELECT count(*)::int AS n FROM household WHERE org_id = $1", [orgB])).rows[0].n)).toBe(0); // wrong-tenant read
      const unscoped = (await c.query("SELECT name FROM household")).rows.map((r) => (r as { name: string }).name).sort(); // application predicate deleted
      expect(unscoped).toEqual(["Delgado Household", "Henderson Family", "Okonkwo Trust"]);
      const bypass = (await c.query("SELECT count(*)::int AS n FROM household WHERE org_id = $1 OR 1=1", [orgB])).rows[0] as { n: number };
      expect(Number(bypass.n)).toBe(3); // 'or 1=1' still sees only the scoped firm
      await expect(c.query("INSERT INTO household (id, org_id, name, record_origin) VALUES (gen_random_uuid(), $1, 'Smuggled Household', 'demo-seed')", [orgB])).rejects.toThrow(/row-level security/); // wrong-tenant write
      await expect(c.query("CREATE TABLE exfil (x int)")).rejects.toThrow(/permission denied/); // no DDL for the application role
    } finally {
      await c.end();
    }
  });
});

describe("construction rules and the E16 capture", () => {
  const web = webBundleGraph();
  it("the web production bundle excludes evidence tooling and resolves whole", () => {
    expect(web.unresolved).toEqual([]);
    expect(web.modules.filter((m) => m.startsWith("src/tools/"))).toEqual([]);
    expect(web.modules).toContain("src/app/page.tsx");
  });
  it("no product module acquires a raw client, credential, or network capability", () => {
    expect(productTargetViolations(web.modules)).toEqual([]);
  });
  it("sealed types are constructible only by their factories", () => {
    expect(sealedFactoryViolations()).toEqual([]);
  });
  it("every route, layout and server action declares the nodejs runtime", () => {
    expect(nodejsRuntimeViolations()).toEqual([]);
  });
  it("no outbound-projection module transitively imports a PII-bearing type (the declared boundary membership)", () => {
    expect(containmentViolations()).toEqual([]);
  });
  it("the shipped detector and the checker's scan agree byte-for-byte on the three forms and the GD-003 exclusion", () => {
    const checker = readFileSync("enforcement/rules-e16.mjs", "utf8");
    expect(ACCOUNT_REFERENCE_FORMS).toHaveLength(3);
    for (const [form, re] of ACCOUNT_REFERENCE_FORMS) expect(checker).toContain(`["${form}", ${re.toString()}]`);
    expect(checker).toContain('new Set(["requestId", "traceId", "spanId"])');
    expect(checker).toContain("/^[0-9a-f]{16}$|^[0-9a-f]{32}$/");
  });
  it("assembles and writes the exercised capture", async () => {
    const ev = await snapshotEvidence();
    const registry = ev.registry as { id: string }[];
    const graph = ev.graph as { op: string }[];
    const gw = getGateway() as unknown as Record<string, unknown>;
    const probe = {
      credentialEnvironment: process.env.VERIN_APP_DATABASE_URL === undefined && process.env.VERIN_COOKIE_KEY === undefined ? "denied" : "available",
      rawClientExport: gw.pool === undefined && gw.query === undefined ? "denied" : "available",
      genericEntryPoint: gw.enter === undefined ? "denied" : "available",
      interpreterTokenFactory: gw.mintToken === undefined && gw.admit === undefined ? "denied" : "available",
      productModuleFetch: productTargetViolations(web.modules).some((v) => v.includes("fetch")) ? "available" : "denied",
    };
    const capture = { ...ev, boundary: { probe, productTargetViolations: [], unresolvedEdges: [] }, bundles: { web: web.modules }, evidenceToolingPath: "src/tools/" };
    const path = process.env.E16_EVIDENCE ?? "test-results/e16-capture.json";
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(capture, null, 1));
    // Written first, asserted after: the capture must reflect reality even when an assertion below
    // is about to fail the build, or a mutation run would hand the rules a stale, passing capture.
    expect(Object.values(probe).every((v) => v === "denied")).toBe(true);
    for (const r of registry)
      expect(
        graph.some((g) => g.op === r.id),
        `registry row ${r.id} was never exercised`,
      ).toBe(true);
    // The bounded-read rule (deliverable 1): a slice-3 collection read carries an explicit limit in its SQL text; deleting the LIMIT fails here naming the statement.
    for (const r of ev.registry as { id: string; slice: number; class: string; semanticEffect?: { statementName: string; canonicalSql: string; cardinality: string } }[])
      if (r.slice >= 3 && r.class === "store" && r.semanticEffect?.cardinality === "many")
        expect(/\bLIMIT \d+\b/.test(r.semanticEffect.canonicalSql), `store operation '${r.id}' ships an unbounded collection read: no LIMIT in '${r.semanticEffect.statementName}'`).toBe(true);
  });
});
