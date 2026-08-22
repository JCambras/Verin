// The instrumented run (prompt 2 5B.0/5B.8/5B.9): exercises every governed operation against real
// PostgreSQL, runs the construction rules E16 consumes (sealed-factory, raw-client boundary,
// production-bundle graph, the nodejs-runtime declaration), and writes the E16 capture. Evidence
// tooling under src/tools/ - proven absent from the web bundle - and a tooling composition root.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import {
  annotateOperation,
  createGovernedRuntime,
  decisionCorrelation,
  decisionIdFromOutcomeDigest,
  getGateway,
  mintRequestId,
  requestCorrelation,
  snapshotEvidence,
  type RequestCorrelation,
} from "../runtime/governed";
import { createAccessContext, renewSession, signIn, type ActionGrant, type Principal } from "../access/context";
import { NOT_STATED as POLICY_NOT_STATED, POLICY_OPERATION_DEADLINE_MS, assertSequenceSound, createPolicyVersionRegistry, parseFirmPolicy, parsePolicyVersionId } from "../policy/registry";
import { assembleEvidence, bundleDigest, renderableBundle, serializeBundle } from "../evidence/bundle";
import { ACCOUNT_REFERENCE_FORMS, OUTBOUND_PROJECTION_MODULES, maskAccountReference, refuseAccountReferences } from "../evidence/pii";
import { evidenceRetrievalConformance, type EvidenceRetrieval } from "./conformance";
import { NOT_STATED as DECISION_NOT_STATED, REFERENCE_FORMS, evaluate, outcomeDigest, serializeOutcome, serializeRequest } from "../decision/outcome";
import { createDecisionRecord } from "../record/decision-record";
import { buildReplayManifest, exactBytesIdentity, renderDecisionIdFromOutcomeBytes, type ReplaySourceSet } from "../record/canonical";
import { SAMPLE_INPUTS } from "./decision-samples";
import { COMPARISON_ARCHETYPES } from "../decision/comparison-archetypes";
import { engineIdentity } from "./decision-engine-identity";
import { computeManifestRows } from "./decision-replay-manifest";
import { createSignedQuantityReader, loadSignedCaseInputs, type TypedQuantity } from "./signed-cases";
import { compareProducibleBindingFields, loadSignedCaseExpectations } from "./signed-expectations";
import { KNOWN_KEY_DIVERGENCES_BEFORE_SIGNATURE, gradeAllCases, keyGrammarViolations, reconcile, runConformance } from "./signed-truth-conformance";

const KERNEL = "src/runtime/governed.ts";
const COMPOSITION_ROOTS = [KERNEL, "src/instrumentation.ts"];
const SEALED: Record<string, string> = {
  Principal: "src/access/context.ts",
  ActionGrant: "src/access/context.ts",
  TenantIdentity: "src/access/context.ts",
  RequestId: KERNEL,
  RequestCorrelation: KERNEL,
  DecisionId: KERNEL,
  DecisionCorrelation: KERNEL,
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
    expect(names).toEqual(["Ashford Grantor Trust", "Delgado Household", "Henderson Family", "Okonkwo Trust"]);
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
const APP_URL = process.env.VERIN_APP_DATABASE_URL ?? "postgresql://verin_app:verin-app-local@localhost:5432/verin";
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
    expect(bundle.observations.map((o) => o.kind)).toEqual([
      "account-balance",
      "bank-instruction",
      "beneficiary-designation",
      "household-directory",
      "household-instruction",
      "pending-actions",
      "people",
      "people",
      "planned-withdrawals",
      "regulatory-status",
    ]);
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
    expect(view.absent.map((a) => a.label)).toEqual([
      "People",
      "Account balance",
      "Bank instruction",
      "Beneficiary designation",
      "Planned withdrawals",
      "Pending actions",
      "Household instruction",
      "Regulatory status",
      "Household directory",
    ]);
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

const POLICY_DEADLINE = { milliseconds: POLICY_OPERATION_DEADLINE_MS };
const policyDoc = (months: number, thresholdUsd: number) =>
  `{"reserveHorizonMonths":${months},"dualApproval":{"thresholdUsd":${thresholdUsd},"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"operations","requesterRule":"may-not-satisfy-both-approvals"},"bankInstructionChange":"specialist-review","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`;
const enc = (s: string) => new TextEncoder().encode(s);
const sha256hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const freshThreshold = () => 10_000 + Math.floor(Math.random() * 900_000_000);
const withPolicyGrant = async <T>(action: "policy.read" | "policy.publish", fn: (c: RequestCorrelation, grant: ActionGrant) => Promise<T>): Promise<T> => {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  return getGateway().enterRoutePolicy(c, async () => {
    const p = await access.authenticate(c, cookieValue);
    const grant = await access.authorize(c, p!, action);
    return fn(c, grant!);
  });
};
async function replicaWrite(sql: string, params: unknown[]) {
  const su = new PgClient({ connectionString: SUPER_URL });
  await su.connect();
  try {
    await su.query("SET session_replication_role = replica");
    await su.query(sql, params);
  } finally {
    await su.end();
  }
}

describe("the policy version registry (prompt 4, PR-4a): content-addressed, immutable, fail-closed", () => {
  const appUrl = process.env.VERIN_APP_DATABASE_URL ?? "postgresql://verin_app:verin-app-local@localhost:5432/verin";
  it("publishes through the governed path, resolves byte-exactly by content address, and refuses a duplicate identity", async () => {
    const registry = createPolicyVersionRegistry();
    const bytes = enc(policyDoc(6, freshThreshold()));
    const id = await withPolicyGrant("policy.publish", (c, g) => registry.publish(c, g, bytes, POLICY_DEADLINE));
    expect(id.digest).toBe(sha256hex(bytes)); // the address IS the document's digest
    const out = await withPolicyGrant("policy.read", (c, g) => registry.resolveByHash(c, g, id, POLICY_DEADLINE));
    if (out.kind !== "policy-version") throw new Error("expected the published version to resolve");
    expect(out.policy.reserveHorizonMonths).toBe(6);
    expect(out.origin).toBe("demo-seed"); // the tooling role's publishes are demonstrations, named at the insert
    await expect(withPolicyGrant("policy.publish", (c, g) => registry.publish(c, g, bytes, POLICY_DEADLINE))).rejects.toThrow(/duplicate identity/);
    await expect(withPolicyGrant("policy.read", (c, g) => registry.resolveByHash(c, g, id, { milliseconds: 0 }))).rejects.toThrow(/deadline/); // stop 9
    await expect(withPolicyGrant("policy.publish", (c, g) => registry.resolveByHash(c, g, id, POLICY_DEADLINE))).rejects.toThrow(/requires a 'policy.read' grant/);
    await getGateway().enterPolicyResolveByHash(requestCorrelation(mintRequestId()), async () => {
      expect(() => annotateOperation({ documentDigest: `fpd.v1:${id.digest}` })).toThrow(/outside its declared digest domain/); // the prefixed identity string never enters telemetry
      expect(() => annotateOperation({ documentDigest: policyDoc(6, 25_000) })).toThrow(/outside its declared digest domain/); // nor whole document bytes - refused on cardinality
      expect(() => annotateOperation({ freeText: "anything" })).toThrow(/declares no attribute 'freeText'/);
      annotateOperation({ documentDigest: id.digest }); // the bare 64-hex digest is inside the declared domain
    });
    const sB = await signIn(requestCorrelation(mintRequestId()), "advisor@firm-b.example", "harbor-quartz-42");
    const cB = requestCorrelation(mintRequestId());
    const access = createAccessContext();
    const gB = await access.authorize(cB, (await access.authenticate(cB, sB!.cookieValue))!, "policy.read");
    expect((await registry.resolveByHash(cB, gB!, id, POLICY_DEADLINE)).kind).toBe("not-found"); // another firm's shelf is unreachable even by exact address (RLS)
  });
  it("M-A and M-D: bytes edited in place fail closed naming both digests, and the bound identity cannot be rebound by the app role or a superuser", async () => {
    const registry = createPolicyVersionRegistry();
    const threshold = freshThreshold();
    const original = enc(policyDoc(6, threshold));
    const id = await withPolicyGrant("policy.publish", (c, g) => registry.publish(c, g, original, POLICY_DEADLINE));
    const tampered = Buffer.from(policyDoc(9, threshold)); // six months quietly re-inked to nine
    await replicaWrite("UPDATE policy_document SET bytes = $1 WHERE digest = $2", [tampered, id.digest]);
    await expect(withPolicyGrant("policy.read", (c, g) => registry.resolveByHash(c, g, id, POLICY_DEADLINE))).rejects.toThrow(
      new RegExp(`refusing to parse fpd\\.v1:${id.digest}: the version's bytes were edited in place \\(declared digest ${id.digest}, stored bytes digest ${sha256hex(tampered)}\\)`),
    );
    await replicaWrite("UPDATE policy_document SET bytes = $1 WHERE digest = $2", [Buffer.from(original), id.digest]);
    const restored = await withPolicyGrant("policy.read", (c, g) => registry.resolveByHash(c, g, id, POLICY_DEADLINE));
    expect(restored.kind).toBe("policy-version"); // the exact original bytes resolve again
    // M-D, against the identity bound above - never a hardcoded string.
    const app = new PgClient({ connectionString: appUrl });
    await app.connect();
    try {
      await expect(app.query("UPDATE policy_document SET bytes = 'rebound' WHERE digest = $1", [id.digest])).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
    await expect(superQuery("UPDATE policy_document SET bytes = 'rebound' WHERE digest = $1", [id.digest])).rejects.toThrow(/immutable/);
    await expect(superQuery("DELETE FROM policy_document WHERE digest = $1", [id.digest])).rejects.toThrow(/immutable/);
  });
  it("M-C: a never-published hash returns the typed NotFound naming the identity and carrying no policy field at all", async () => {
    const registry = createPolicyVersionRegistry();
    const id = parsePolicyVersionId(`fpd.v1:${"e".repeat(64)}`)!;
    const out = await withPolicyGrant("policy.read", (c, g) => registry.resolveByHash(c, g, id, POLICY_DEADLINE));
    expect(out).toEqual({ kind: "not-found", reason: "version-not-found", subject: `fpd.v1:${"e".repeat(64)}` }); // not an empty policy, not a default - no policy field exists to go on
  });
  it("M-B: publishing nine months as a NEW version leaves every previously recorded identity resolving to its own bytes and figures", async () => {
    const registry = createPolicyVersionRegistry();
    const t = freshThreshold();
    const six = enc(policyDoc(6, t));
    const idSix = await withPolicyGrant("policy.publish", (c, g) => registry.publish(c, g, six, POLICY_DEADLINE));
    const recorded = await withPolicyGrant("policy.read", (c, g) => registry.history(c, g, POLICY_DEADLINE)); // recorded PolicyVersionIds alone - no decision exists and none is minted
    const idNine = await withPolicyGrant("policy.publish", (c, g) => registry.publish(c, g, enc(policyDoc(9, t)), POLICY_DEADLINE));
    const inForce = await withPolicyGrant("policy.read", (c, g) => registry.resolveInForce(c, g, new Date().toISOString(), POLICY_DEADLINE));
    expect("digest" in inForce ? inForce.digest : inForce).toBe(idNine.digest); // in-force is DERIVED from the sequence: the new version governs now
    const again = await withPolicyGrant("policy.read", (c, g) => registry.resolveByHash(c, g, idSix, POLICY_DEADLINE));
    if (again.kind !== "policy-version") throw new Error("the old identity must still resolve to its own bytes");
    expect(again.policy.reserveHorizonMonths).toBe(6); // its own derived figures, never the new version's
    for (const id of recorded) expect((await withPolicyGrant("policy.read", (c, g) => registry.resolveByHash(c, g, id, POLICY_DEADLINE))).kind).toBe("policy-version"); // every previously recorded identity keeps resolving
    const epoch = await withPolicyGrant("policy.read", (c, g) => registry.resolveInForce(c, g, "1970-01-01T00:00:00.000Z", POLICY_DEADLINE));
    expect(epoch).toEqual({ kind: "not-found", reason: "no-version-in-force", subject: expect.stringMatching(/^f[0-9a-f]{32}$/) }); // nothing was in force before the first publish - and nothing is invented
  });
  it("M-C and M-E: a deleted interior row is a NAMED gap, and the sequence checks refuse an empty history", async () => {
    const registry = createPolicyVersionRegistry();
    const before = await withPolicyGrant("policy.read", (c, g) => registry.history(c, g, POLICY_DEADLINE));
    expect(before.length).toBeGreaterThanOrEqual(3);
    const interior = (await superQuery("SELECT org_id, seq, digest, published_at, record_origin FROM policy_version WHERE digest = $1", [before[1].digest])).rows[0] as Record<string, unknown>;
    await superQuery("DELETE FROM policy_version WHERE org_id = $1 AND seq = $2", [interior.org_id, interior.seq]);
    try {
      await expect(withPolicyGrant("policy.read", (c, g) => registry.history(c, g, POLICY_DEADLINE))).rejects.toThrow(/sequence number 2 is missing \(a gap in the append-only sequence/);
      await expect(withPolicyGrant("policy.read", (c, g) => registry.resolveInForce(c, g, new Date().toISOString(), POLICY_DEADLINE))).rejects.toThrow(/a gap in the append-only sequence/);
    } finally {
      await superQuery("INSERT INTO policy_version (org_id, seq, digest, published_at, record_origin) VALUES ($1, $2, $3, $4, $5)", [
        interior.org_id,
        interior.seq,
        interior.digest,
        interior.published_at,
        interior.record_origin,
      ]);
    }
    expect((await withPolicyGrant("policy.read", (c, g) => registry.history(c, g, POLICY_DEADLINE))).map((i) => i.digest)).toEqual(before.map((i) => i.digest)); // restored whole
    expect(() => assertSequenceSound([])).toThrow(/refuses an empty history/); // M-E: a check that sees nothing must never report clean
  });
  it("M-C: a firm with no published versions resolves to NotFound naming the firm and carrying no policy", async () => {
    const registry = createPolicyVersionRegistry();
    const sB = await signIn(requestCorrelation(mintRequestId()), "advisor@firm-b.example", "harbor-quartz-42");
    const cB = requestCorrelation(mintRequestId());
    const access = createAccessContext();
    const pB = await access.authenticate(cB, sB!.cookieValue);
    const gB = await access.authorize(cB, pB!, "policy.read");
    const orgB = pB!.tenant.orgId;
    const saved = (await superQuery("SELECT seq, digest, published_at, record_origin FROM policy_version WHERE org_id = $1 ORDER BY seq", [orgB])).rows as Record<string, unknown>[];
    await superQuery("DELETE FROM policy_version WHERE org_id = $1", [orgB]);
    try {
      expect(await registry.resolveInForce(cB, gB!, new Date().toISOString(), POLICY_DEADLINE)).toEqual({ kind: "not-found", reason: "no-version-in-force", subject: `f${orgB.replaceAll("-", "")}` });
      expect(await registry.history(cB, gB!, POLICY_DEADLINE)).toEqual([]); // a typed empty shelf - no soundness claim over nothing
    } finally {
      for (const r of saved)
        await superQuery("INSERT INTO policy_version (org_id, seq, digest, published_at, record_origin) VALUES ($1, $2, $3, $4, $5)", [orgB, r.seq, r.digest, r.published_at, r.record_origin]);
    }
  });
  it("M-F: an expression, an unknown key, and an out-of-vocabulary value are each refused naming the offending path, before any store work", async () => {
    const registry = createPolicyVersionRegistry();
    const base = policyDoc(6, freshThreshold());
    const before = (await superQuery("SELECT count(*)::int AS n FROM policy_version")).rows[0] as { n: number };
    const refusals: [string, RegExp][] = [
      [base.replace('"reserveHorizonMonths":6', '"reserveHorizonMonths":"6 + 3"'), /refuses 'reserveHorizonMonths'/],
      [base.replace('"eligibleApproverRole":"operations"', '"eligibleApproverRole":"${process.env.HOME}"'), /refuses 'dualApproval\.eligibleApproverRole'/],
      [base.replace('"bankInstructionChange":"specialist-review"', '"bankInstructionChange":"specialist-review; SELECT pg_sleep(10)"'), /refuses 'bankInstructionChange'/],
      [base.replace('"reserveHorizonMonths":6', '"hook":"x","reserveHorizonMonths":6'), /refuses '\(document root\)':.*"hook"/],
    ];
    for (const [doc, re] of refusals) await expect(withPolicyGrant("policy.publish", (c, g) => registry.publish(c, g, enc(doc), POLICY_DEADLINE))).rejects.toThrow(re);
    expect((await superQuery("SELECT count(*)::int AS n FROM policy_version")).rows[0]).toEqual(before); // nothing reached the store
  });
});

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
      expect(unscoped).toEqual(["Ashford Grantor Trust", "Delgado Household", "Henderson Family", "Okonkwo Trust"]);
      const bypass = (await c.query("SELECT count(*)::int AS n FROM household WHERE org_id = $1 OR 1=1", [orgB])).rows[0] as { n: number };
      expect(Number(bypass.n)).toBe(4); // 'or 1=1' still sees only the scoped firm
      await expect(c.query("INSERT INTO household (id, org_id, name, record_origin) VALUES (gen_random_uuid(), $1, 'Smuggled Household', 'demo-seed')", [orgB])).rejects.toThrow(/row-level security/); // wrong-tenant write
      await expect(c.query("CREATE TABLE exfil (x int)")).rejects.toThrow(/permission denied/); // no DDL for the application role
    } finally {
      await c.end();
    }
  });
});

describe("the decision and atomic-record slices, exercised end to end", () => {
  // Each flow pins its policy by CONTENT ADDRESS (the seed's own firm documents, resolved by hash).
  const SEED_FIRM_A_POLICY = `{"reserveHorizonMonths":6,"dualApproval":{"thresholdUsd":25000,"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"operations","requesterRule":"may-not-satisfy-both-approvals"},"bankInstructionChange":"specialist-review","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`;
  const SEED_FIRM_B_POLICY = `{"reserveHorizonMonths":12,"dualApproval":{"thresholdUsd":100000,"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"not-stated","requesterRule":"not-stated"},"bankInstructionChange":"block-until-independently-verified","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`;
  const decide = async (cookie: string, householdName: string, amountUsd: number, policyDoc: string, recordTimes = 0, conflictingRetry = false) => {
    const requestId = mintRequestId();
    const c = requestCorrelation(requestId);
    const access = createAccessContext();
    const registry = createPolicyVersionRegistry();
    const digest = sha256hex(enc(policyDoc));
    return getGateway().enterRouteDecision(c, async () => {
      const p = await access.authenticate(c, cookie);
      const grant = (await access.authorize(c, p!, "decision.evaluate"))!;
      const policyGrant = (await access.authorize(c, p!, "policy.read"))!;
      const household = await access.withTenant(c, grant, async (tx) => (await tx.listHouseholds()).find((h) => h.name === householdName)!);
      const version = await registry.resolveByHash(c, policyGrant, { version: "fpd.v1", digest }, POLICY_DEADLINE);
      if (version.kind !== "policy-version") throw new Error("the seeded firm policy did not resolve by its content address");
      const asOf = new Date().toISOString();
      const evidence = await assembleEvidence(c, grant, { householdId: household.id }, asOf, { milliseconds: 2_000 });
      const local = createHash("sha256").update(`drq-ref|${household.id}|${amountUsd}`).digest("hex").slice(0, 15);
      const produced = evaluate({
        request: { requestRef: `req:r${local}`, householdSlug: householdName.toLowerCase().replaceAll(" ", "-"), amountUsd, purpose: "home-renovation", deadline: "2026-12-31" },
        evidenceBundle: evidence,
        policyDocument: { id: version.id, policy: version.policy },
        identities: {
          firm: `f${grant.principal.tenant.orgId.replaceAll("-", "")}`,
          household: `h${household.id.replaceAll("-", "")}`,
          requesterRole: `r${createHash("sha256").update("role|advisor").digest("hex").slice(0, 32)}`,
        },
        asOf,
      });
      // The first moment a decision identity CAN exist: after evaluate returns, from the outcome's own digest.
      const minted = decisionIdFromOutcomeDigest(outcomeDigest(produced));
      const dc = decisionCorrelation(requestId, minted);
      const rendered = await getGateway().enterDecisionRenderOutcome(dc, async () => ({ outcome: produced, decisionId: minted, bundle: evidence }));
      const records = [];
      if (recordTimes) {
        const recordGrant = (await access.authorize(c, p!, "decision.record"))!;
        const recordedAt = new Date().toISOString();
        const record = createDecisionRecord(dc, recordGrant);
        const material = {
          outcome: produced,
          evidence,
          policy: version,
          recordedAt,
          producer: { kind: "test" as const, id: "itest-suite", producedAt: recordedAt },
          recordOrigin: "test-fixture" as const,
        };
        for (let i = 0; i < recordTimes; i++) records.push(await record.record(material));
        if (conflictingRetry) {
          const shifted = new Date(Date.parse(recordedAt) + 1_000).toISOString();
          await record.record({ ...material, recordedAt: shifted, producer: { ...material.producer, producedAt: shifted } });
        }
      }
      return { ...rendered, records };
    });
  };
  it("records one exact decision atomically, refuses an unauthorized genesis, retries idempotently, and serializes concurrent appends", async () => {
    await expect(decide(cookieValue, "Henderson Family", 71_001, SEED_FIRM_A_POLICY, 1)).rejects.toThrow(/continuity-boundary-not-authorized/);
    const orgId = principal.tenant.orgId;
    const instant = new Date().toISOString();
    await superQuery(
      "INSERT INTO decision_continuity_authorization (org_id, lcm_digest, manifest_bytes, signature_bytes, authorizing_actor, authorized_at, producer_kind, producer_id, produced_at, record_origin) VALUES ($1, $2, $3, $4, 'test-fixture', $5, 'test', 'itest-suite', $5, 'test-fixture')",
      [orgId, `lcm.v1:${"1".repeat(64)}`, Buffer.from("test-only-continuity-manifest"), Buffer.from("test-only-not-a-product-signature"), instant],
    );
    const exact = await decide(cookieValue, "Henderson Family", 71_002, SEED_FIRM_A_POLICY, 2);
    expect(exact.records).toHaveLength(2);
    expect(exact.records[0].alreadyRecorded).toBe(false);
    expect(exact.records[1]).toEqual({ ...exact.records[0], alreadyRecorded: true });
    await expect(decide(cookieValue, "Henderson Family", 71_005, SEED_FIRM_A_POLICY, 1, true)).rejects.toThrow(/idempotency conflict/);
    const raced = await Promise.all([decide(cookieValue, "Henderson Family", 71_003, SEED_FIRM_A_POLICY, 1), decide(cookieValue, "Henderson Family", 71_004, SEED_FIRM_A_POLICY, 1)]);
    const sequences = raced.map((x) => x.records[0].sequence).sort((a, b) => a - b);
    expect(sequences[1]).toBe(sequences[0] + 1);
    const ledger = (await superQuery("SELECT seq::int, prev_hash, entry_hash FROM decision_ledger WHERE org_id = $1 ORDER BY seq", [orgId])).rows as {
      seq: number;
      prev_hash: string;
      entry_hash: string;
    }[];
    expect(ledger.map((x) => x.seq)).toEqual(ledger.map((_, i) => i));
    expect(ledger[0].prev_hash).toBe("dlh.v1:GENESIS");
    for (let i = 1; i < ledger.length; i++) expect(ledger[i].prev_hash).toBe(ledger[i - 1].entry_hash);
  });
  it("rolls every internal append stage back and enforces immutability for the application role and table owner", async () => {
    const otherSession = await signIn(requestCorrelation(mintRequestId()), "advisor@firm-b.example", "harbor-quartz-42");
    const access = createAccessContext();
    const otherPrincipal = await access.authenticate(requestCorrelation(mintRequestId()), otherSession!.cookieValue);
    const orgId = otherPrincipal!.tenant.orgId;
    const instant = new Date().toISOString();
    await superQuery(
      "INSERT INTO decision_continuity_authorization (org_id, lcm_digest, manifest_bytes, signature_bytes, authorizing_actor, authorized_at, producer_kind, producer_id, produced_at, record_origin) VALUES ($1, $2, $3, $4, 'test-fixture', $5, 'test', 'itest-suite', $5, 'test-fixture')",
      [orgId, `lcm.v1:${"2".repeat(64)}`, Buffer.from("test-only-second-continuity-manifest"), Buffer.from("test-only-not-a-product-signature"), instant],
    );
    const counts = async () =>
      (
        await superQuery(
          "SELECT (SELECT count(*)::int FROM decision_record_source WHERE org_id = $1) sources, (SELECT count(*)::int FROM decision_ledger WHERE org_id = $1) entries, (SELECT count(*)::int FROM decision_record_projection WHERE org_id = $1) projections, (SELECT count(*)::int FROM decision_chain_anchor WHERE org_id = $1) anchors",
          [orgId],
        )
      ).rows[0];
    await superQuery("CREATE OR REPLACE FUNCTION p6_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'p6 injected stage failure'; END $$");
    const stages = [
      ["source insert after anchor creation", "INSERT", "decision_record_source", ""],
      ["genesis insert after source insertion", "INSERT", "decision_ledger", "WHEN (NEW.seq = 0)"],
      ["decision insert after genesis", "INSERT", "decision_ledger", "WHEN (NEW.seq > 0)"],
      ["anchor update after decision insertion", "UPDATE", "decision_chain_anchor", ""],
      ["projection insert after anchor update", "INSERT", "decision_record_projection", ""],
    ] as const;
    try {
      for (let i = 0; i < stages.length; i++) {
        const [stage, operation, table, predicate] = stages[i];
        const before = await counts();
        await superQuery(`CREATE TRIGGER p6_test_abort_stage BEFORE ${operation} ON ${table} FOR EACH ROW ${predicate} EXECUTE FUNCTION p6_test_abort()`);
        try {
          await expect(decide(otherSession!.cookieValue, "Vance Household", 72_000 + i, SEED_FIRM_B_POLICY, 1)).rejects.toThrow(/p6 injected stage failure/);
        } finally {
          await superQuery(`DROP TRIGGER p6_test_abort_stage ON ${table}`);
        }
        expect(await counts(), `${stage} failure left partial decision-record rows`).toEqual(before);
      }
    } finally {
      await superQuery("DROP FUNCTION p6_test_abort() ");
    }
    const app = new PgClient({ connectionString: APP_URL });
    await app.connect();
    try {
      await app.query("SELECT set_config('verin.org_id', $1, false)", [principal.tenant.orgId]);
      for (const table of ["decision_record_source", "decision_ledger"]) {
        await expect(app.query(`UPDATE ${table} SET record_origin = record_origin WHERE org_id = $1`, [principal.tenant.orgId])).rejects.toThrow(/permission denied/);
        await expect(app.query(`DELETE FROM ${table} WHERE org_id = $1`, [principal.tenant.orgId])).rejects.toThrow(/permission denied/);
      }
    } finally {
      await app.end();
    }
    for (const table of ["decision_continuity_authorization", "decision_record_source", "decision_ledger"]) {
      const scoped = `SET ROLE verin_migrator; SELECT set_config('verin.org_id', '${principal.tenant.orgId}', false);`;
      await expect(superQuery(`${scoped} UPDATE ${table} SET record_origin = record_origin WHERE org_id = '${principal.tenant.orgId}'`)).rejects.toThrow(
        new RegExp(`${table} is append-only: UPDATE is forbidden`),
      );
      await expect(superQuery(`${scoped} DELETE FROM ${table} WHERE org_id = '${principal.tenant.orgId}'`)).rejects.toThrow(new RegExp(`${table} is append-only: DELETE is forbidden`));
      await expect(superQuery(`SET ROLE verin_migrator; TRUNCATE ${table}`)).rejects.toThrow(new RegExp(`${table} is append-only: TRUNCATE is forbidden`));
    }
  });
  it("refuses a same-identity source collision before any chain append", async () => {
    const outcome = evaluate(SAMPLE_INPUTS[0].input);
    const bytes = {
      request: serializeRequest(outcome.request),
      evidence: serializeBundle(SAMPLE_INPUTS[0].input.evidenceBundle),
      policy: SEED_FIRM_A_POLICY,
      engine: engineIdentity().bytes,
      outcome: serializeOutcome(outcome),
    };
    const sources = Object.fromEntries(
      (Object.keys(bytes) as (keyof typeof bytes)[]).map((kind) => [kind, { kind, identity: exactBytesIdentity(kind, bytes[kind]), bytes: bytes[kind] }]),
    ) as ReplaySourceSet;
    const manifest = buildReplayManifest(sources, SAMPLE_INPUTS[0].input.evidenceBundle.vocabulary, outcome.citations.asOf);
    const decisionId = renderDecisionIdFromOutcomeBytes(sources.outcome.bytes);
    const orgId = principal.tenant.orgId;
    await superQuery(
      "INSERT INTO decision_record_source (org_id, source_kind, identity, bytes, producer_kind, producer_id, produced_at, record_origin) VALUES ($1, 'request', $2, $3, 'test', 'itest-suite', $4, 'test-fixture')",
      [orgId, sources.request.identity, Buffer.from("wrong-bytes-under-declared-identity"), "2026-08-21T12:00:00.000Z"],
    );
    const requestId = mintRequestId();
    const rc = requestCorrelation(requestId);
    const dc = decisionCorrelation(requestId, decisionIdFromOutcomeDigest(sources.outcome.identity));
    try {
      await expect(
        getGateway().enterRouteDecision(rc, () =>
          getGateway().enterDecisionRecordRecord(dc, () =>
            getGateway().enterDecisionRecordAppend(dc, {
              orgId,
              decisionId,
              sources,
              manifest,
              recordedAt: outcome.citations.asOf,
              producer: { kind: "test", id: "itest-suite", producedAt: outcome.citations.asOf },
              recordOrigin: "test-fixture",
              projection: { requestRef: outcome.request.requestRef, householdSlug: outcome.request.householdSlug, disposition: outcome.disposition },
            }),
          ),
        ),
      ).rejects.toThrow(/source collision for 'request'/);
    } finally {
      await superQuery("ALTER TABLE decision_record_source DISABLE TRIGGER decision_source_immutable");
      await superQuery("DELETE FROM decision_record_source WHERE org_id = $1 AND source_kind = 'request' AND identity = $2", [orgId, sources.request.identity]);
      await superQuery("ALTER TABLE decision_record_source ENABLE TRIGGER decision_source_immutable");
    }
  });
  it("computes a LIVE proceed through the governed route: stages from the STATED block, the CD-4d key, the CD-4e ordering, every citation", async () => {
    const { outcome, decisionId, bundle } = await decide(cookieValue, "Henderson Family", 75_000, SEED_FIRM_A_POLICY);
    if (outcome.disposition !== "proceed") throw new Error(`Henderson at 75000 must proceed, got ${outcome.disposition}`);
    expect(outcome.authority.mode).toBe("approval");
    expect(outcome.authority.stages.map((st) => st.stageId)).toEqual(["operations-dual-approval"]);
    expect(outcome.execution.idempotencyKey).toMatch(/^idem:r[0-9a-f]{15}:henderson-family-75000-2026-12-31$/);
    expect(outcome.execution.ordering).toBe("reserve-only-after-authority-complete");
    expect(outcome.citations.evidenceBundle).toBe(bundleDigest(bundle));
    expect(outcome.citations.policy).toBe(`fpd.v1:${sha256hex(enc(SEED_FIRM_A_POLICY))}`);
    expect(`dov.v1:${decisionId.value}`).toBe(outcomeDigest(outcome));
  });
  it("blocks a LIVE breach with the arithmetic in the trace; refusals carry no authority and no plan, by type and by value", async () => {
    const { outcome } = await decide(cookieValue, "Henderson Family", 405_000, SEED_FIRM_A_POLICY);
    if (outcome.disposition !== "blocked") throw new Error(`Henderson at 405000 must block, got ${outcome.disposition}`);
    expect(outcome.blockers.map((x) => x.code)).toEqual(["cash-reserve-breach"]);
    expect(outcome.trace.find((x) => x.rule === "cash-reserve")?.figures?.["remainingUsd"]).toBe(7_000);
    expect(outcome.authority).toEqual({ mode: "none" });
    expect(outcome.execution).toBeNull();
  });
  it("prohibits a LIVE legal hold with regulatory precedence, and refuses conflicted material evidence - no side picked by recency", async () => {
    const hold = await decide(cookieValue, "Ashford Grantor Trust", 20_000, SEED_FIRM_A_POLICY);
    if (hold.outcome.disposition !== "prohibited") throw new Error(`Ashford must prohibit, got ${hold.outcome.disposition}`);
    expect(hold.outcome.prohibition.reasonCode).toBe("active-legal-hold");
    expect(hold.outcome.prohibition.source).toEqual({ sourceType: "regulatory", sourceId: "reg-distribution-holds", versionId: "reg-distribution-holds@2026.02" });
    expect(hold.outcome.execution).toBeNull();
    const conflicted = await decide(cookieValue, "Delgado Household", 10_000, SEED_FIRM_A_POLICY);
    if (conflicted.outcome.disposition !== "blocked") throw new Error(`Delgado must block on conflict, got ${conflicted.outcome.disposition}`);
    expect(conflicted.outcome.blockers.map((x) => x.code)).toEqual(["material-evidence-conflicting"]);
  });
  it("blocks firm B's recent unverified bank change from CONFIGURATION alone, and surfaces both contract silences as typed values", async () => {
    const sB = await signIn(requestCorrelation(mintRequestId()), "advisor@firm-b.example", "harbor-quartz-42");
    const { outcome } = await decide(sB!.cookieValue, "Vance Household", 50_000, SEED_FIRM_B_POLICY);
    if (outcome.disposition !== "blocked") throw new Error(`Vance under firm B must block, got ${outcome.disposition}`);
    expect(outcome.blockers.map((x) => x.code)).toEqual(["bank-instruction-change-unverified"]);
    expect(outcome.policyBasis.eligibleApproverRole).toBe("not-stated"); // the contract silences, carried as themselves (CD-4a)
    expect(outcome.policyBasis.requesterRule).toBe("not-stated");
    expect(outcome.explanations.map((x) => x.code)).toContain("blocked-until-independently-verified");
    // The ratified typed-silence behavior, LIVE: over firm B's threshold with clean evidence, the
    // not-stated approver role derives NO stage and the decision refuses honestly.
    const silent = await decide(sB!.cookieValue, "Mensah Family", 150_000, SEED_FIRM_B_POLICY);
    if (silent.outcome.disposition !== "blocked") throw new Error(`Mensah at 150000 must refuse on the typed silence, got ${silent.outcome.disposition}`);
    expect(silent.outcome.blockers.map((x) => x.code)).toEqual(["approval-authority-not-stated"]);
    expect(silent.outcome.blockers[0].resolvingEvidence).toEqual([]); // resolved by a policy version stating the value, never by evidence
  });
  it("CD-4c reads all 119 load-bearing values only from signed typed rows and fails closed on missing, ambiguous or wrongly typed rows", () => {
    const source = project.getSourceFileOrThrow("src/tools/signed-cases.ts");
    expect(source.getDescendantsOfKind(SyntaxKind.RegularExpressionLiteral), "the input reader executes no prose pattern").toEqual([]);
    expect(source.getText()).not.toMatch(/\.match(?:All)?\(|\.exec\(|\.test\(/);
    const inputs = loadSignedCaseInputs();
    expect(inputs.reduce((total, input) => total + input.typedQuantityCount, 0)).toBe(119);
    const row = (value: TypedQuantity["value"]): TypedQuantity => ({ ref: "trigger", field: "amountUsd", value, fromAssertedParse: "historical metadata only" });
    expect(() => createSignedQuantityReader("GC-test", []).number("trigger", "amountUsd")).toThrow(/missing signed typed quantity GC-test trigger\.amountUsd/);
    expect(() => createSignedQuantityReader("GC-test", [row(75_000), row(75_000)])).toThrow(/ambiguous signed typed quantity GC-test trigger\.amountUsd: found 2 rows/);
    expect(() => createSignedQuantityReader("GC-test", [row("75000")]).number("trigger", "amountUsd")).toThrow(
      /invalid signed typed quantity GC-test trigger\.amountUsd: expected number, received string/,
    );
  });
  it("the FOUR canonical cases match the signed truth EXACTLY on every producible binding field, through the recorded comparison vocabulary", () => {
    const canonical = ["GC-01-firm-a-happy-path", "GC-02-firm-b-happy-path", "GC-03-recent-bank-change-firm-a", "GC-04-recent-bank-change-firm-b"];
    const inputs = loadSignedCaseInputs().filter((x) => canonical.includes(x.caseId)); // PR-5c-i widened the reader to all sixteen; the exact-match bar stays on the canonical four
    const exps = loadSignedCaseExpectations();
    expect(inputs.map((x) => x.caseId)).toEqual(canonical);
    for (const { caseId, input, typedQuantityCount } of inputs) {
      const produced = evaluate(input);
      expect(typedQuantityCount, `${caseId} consumes its signed typed inputs directly`).toBeGreaterThan(0);
      const mismatches = compareProducibleBindingFields(
        exps.find((e) => e.caseId === caseId)!,
        produced,
      );
      expect(mismatches, `${caseId} must match the signed truth exactly`).toEqual([]);
    }
  });
  it("the committed sample cases: a proceed carries its plan and the CD-4d key grammar; a refusal carries neither, by type and by value", () => {
    const proceed = evaluate(SAMPLE_INPUTS[0].input);
    if (proceed.disposition !== "proceed") throw new Error(`sample-proceed produced ${proceed.disposition}`);
    expect(proceed.authority.mode).toBe("approval");
    expect(proceed.authority.stages.map((st) => st.stageId)).toEqual(["operations-dual-approval"]);
    expect(proceed.execution.idempotencyKey).toBe("idem:rsampleproceed01:sample-household-50000-2026-12-31");
    expect(proceed.execution.ordering).toBe("reserve-only-after-authority-complete");
    expect(proceed.sourceSelection.alternatives).toEqual([{ subjectRef: "account:sample-ira", rejectedBecause: "taxable-event-source" }]);
    const blocked = evaluate(SAMPLE_INPUTS[1].input);
    if (blocked.disposition !== "blocked") throw new Error(`sample-blocked produced ${blocked.disposition}`);
    expect(blocked.execution).toBeNull();
    expect(blocked.authority).toEqual({ mode: "none" });
  });
  it("M-I: outcome digests are byte-identical with telemetry capture on and off - a decision that changes when someone is watching is not deterministic", () => {
    const off = execFileSync("corepack", ["pnpm", "exec", "tsx", "src/tools/decision-determinism.ts"], { encoding: "utf8", env: { ...process.env, TZ: "America/New_York" } });
    for (const { name, input } of SAMPLE_INPUTS) {
      const on = evaluate(input); // this process's telemetry runtime is constructed and capturing
      expect(off.split("\n").find((l) => l.startsWith(name))).toContain(`outcome=${outcomeDigest(on)}`);
    }
  }, 120_000);
  it("M-H: the factories refuse a relabelled request identity and the gateway refuses the wrong correlation kind at runtime", async () => {
    const requestId = mintRequestId();
    expect(() => decisionIdFromOutcomeDigest(requestId.value)).toThrow(/carries no dov\.v1 domain/); // a request id relabelled as a decision id is the same lie told with better manners
    expect(() => decisionIdFromOutcomeDigest(`req:${requestId.value}`)).toThrow(/carries no dov\.v1 domain/);
    const c = requestCorrelation(requestId);
    const gw = getGateway() as unknown as Record<string, (cc: unknown, fn: () => Promise<unknown>) => Promise<unknown>>;
    await expect(gw["enterDecisionRenderOutcome"](c, async () => null)).rejects.toThrow(/requires correlation kind 'DecisionCorrelation'/);
    // The pre-evaluate arm is a CONSTRUCTION result (proof log): no factory exists to call.
  });
  it("PR-5b: the comparison route evaluates both archetypes over ONE bundle - one engine identity, two policy identities, each side its own decision correlation", async () => {
    const requestId = mintRequestId();
    const c = requestCorrelation(requestId);
    const access = createAccessContext();
    const result = await getGateway().enterRouteDecisionCompare(c, async () => {
      const p = await access.authenticate(c, cookieValue);
      const grant = (await access.authorize(c, p!, "decision.evaluate"))!;
      const household = await access.withTenant(c, grant, async (tx) => (await tx.listHouseholds()).find((h) => h.name === "Henderson Family")!);
      const asOf = new Date().toISOString();
      const bundle = await assembleEvidence(c, grant, { householdId: household.id }, asOf, { milliseconds: 2_000 });
      const request = { requestRef: "req:rcomparecase0001", householdSlug: "henderson-family", amountUsd: 150_000, purpose: "home-renovation" as const, deadline: "2026-12-31" };
      const identities = {
        firm: `f${grant.principal.tenant.orgId.replaceAll("-", "")}`,
        household: `h${household.id.replaceAll("-", "")}`,
        requesterRole: `r${createHash("sha256").update("role|advisor").digest("hex").slice(0, 32)}`,
      };
      const sides = [];
      for (const archetype of COMPARISON_ARCHETYPES) {
        const digest = sha256hex(enc(archetype.document));
        const outcome = evaluate({ request, evidenceBundle: bundle, policyDocument: { id: { version: "fpd.v1", digest }, policy: parseFirmPolicy(enc(archetype.document)) }, identities, asOf });
        const decisionId = decisionIdFromOutcomeDigest(outcomeDigest(outcome));
        sides.push(await getGateway().enterDecisionCompareSide(decisionCorrelation(requestId, decisionId), async () => ({ digest, outcome, decisionId })));
      }
      return sides;
    });
    const [a, b] = result;
    expect(a.digest).not.toBe(b.digest); // two policy content hashes differ (never assert the firms share one)
    expect(a.decisionId.value).not.toBe(b.decisionId.value); // each side its own decision identity
    expect(a.outcome.citations.evidenceBundle).toBe(b.outcome.citations.evidenceBundle); // ONE bundle
    expect(a.outcome.citations.request).toBe(b.outcome.citations.request); // ONE request
    expect(a.outcome.disposition).toBe("proceed"); // Firm A archetype: dual approval above its stated threshold
    if (a.outcome.disposition === "proceed") expect(a.outcome.authority.stages.map((st) => st.stageId)).toEqual(["operations-dual-approval"]);
    expect(b.outcome.disposition).toBe("blocked"); // Firm B archetype: over ITS threshold the not-stated approver role refuses honestly
    if (b.outcome.disposition === "blocked") expect(b.outcome.blockers.map((x) => x.code)).toEqual(["approval-authority-not-stated"]);
  });
  it("PR-5b: the den.v1 engine identity is the committed one, the archetypes are the seed's exact bytes, and every replay-manifest row recomputes exactly", () => {
    const committed = JSON.parse(readFileSync("src/decision/engine-identity.json", "utf8"));
    expect(engineIdentity()).toEqual(committed); // one mechanism, two uses, regenerable by anyone
    const seedSource = readFileSync("src/tools/cli.ts", "utf8");
    for (const archetype of COMPARISON_ARCHETYPES) expect(seedSource).toContain(archetype.document); // byte-equal to what the seed publishes per firm
    const manifest = JSON.parse(readFileSync("docs/evidence/decision-replay-manifest.json", "utf8"));
    expect(manifest.attestedTimeZones).toEqual(["America/New_York", "Asia/Tokyo"]);
    expect(computeManifestRows()).toEqual(manifest.rows); // every case's resolved identity set equals its manifest set exactly
    for (const row of manifest.rows) expect(row.engine).toBe(committed.engine);
  }, 120_000);
  it("the decision module's silence token and account-reference forms agree byte-for-byte with their authorities", () => {
    expect(DECISION_NOT_STATED).toBe(POLICY_NOT_STATED);
    expect(REFERENCE_FORMS.map(([n, r]) => [n, r.source])).toEqual(ACCOUNT_REFERENCE_FORMS.map(([n, r]) => [n, r.source]));
  });
  it("PR-5c-i: the GOVERNED conformance run equals the committed file exactly, and the reconciliation ledger closes in both directions", async () => {
    const grades = await runConformance(mintRequestId()); // exercises conformance.runner, sixteen readSignedCase module-operations, sixteen grade flow-steps under their own decision correlations
    const committed = JSON.parse(readFileSync("docs/evidence/decision-conformance.json", "utf8"));
    expect(JSON.parse(JSON.stringify(grades))).toEqual(committed.cases); // the register renders exactly what the governed run produces - the two paths cannot drift
    expect(grades).toHaveLength(16);
    const ledger = JSON.parse(readFileSync("docs/decision-reconciliation-ledger.json", "utf8"));
    expect(reconcile(grades, ledger)).toEqual([]); // every DIFFERS ruled, no stale entry
    const totals = { MATCHED: 0, DIFFERS: 0, "NOT-YET-PRODUCIBLE": 0 } as Record<string, number>;
    for (const g of grades) for (const v of g.verdicts) totals[v.verdict] += 1;
    expect(totals).toEqual(committed.totals);
    for (const g of grades) expect(g.disposition).toBe(loadSignedCaseExpectations().find((e) => e.caseId === g.caseId)!.expectedDisposition); // all sixteen dispositions re-derived exactly
  }, 120_000);
  it("M-D: the reconciler refuses an unledgered difference, a stale entry, and an entry without a captain ruling", async () => {
    const grades = gradeAllCases();
    const ledger: { id: string; caseId: string; field: string; ruling: "CD-4b"; note: string }[] = JSON.parse(readFileSync("docs/decision-reconciliation-ledger.json", "utf8"));
    const doctored = grades.map((g) =>
      g.caseId === "GC-01-firm-a-happy-path" ? { ...g, verdicts: [...g.verdicts, { field: "invented", verdict: "DIFFERS", ruling: null, signed: 1, produced: 2 } as const] } : g,
    );
    expect(reconcile(doctored, ledger).join("\n")).toContain("unledgered difference GC-01-firm-a-happy-path:invented");
    expect(reconcile(grades, [...ledger, { id: "GC-02-firm-b-happy-path:disposition", caseId: "GC-02-firm-b-happy-path", field: "disposition", ruling: "CD-4b", note: "stale" }]).join("\n")).toContain(
      "stale ledger entry GC-02-firm-b-happy-path:disposition",
    );
    expect(
      reconcile(
        grades,
        ledger.map((e, i) => (i === 0 ? { ...e, ruling: "editorial" as unknown as "CD-4b" } : e)),
      ).join("\n"),
    ).toContain("no captain ruling");
  });
  it("M-J: every produced idempotency key conforms to the CD-4d grammar, and among the SIGNED keys exactly the named pre-signature divergence deviates", () => {
    const { produced, signedDivergent } = keyGrammarViolations();
    expect(produced).toEqual([]);
    expect(signedDivergent).toEqual(KNOWN_KEY_DIVERGENCES_BEFORE_SIGNATURE); // after the pin moves to the signing commit this list must empty for the test to keep passing
  });
  it("PR-5c-i: the conformance route authenticates and authorizes conformance.read before anything renders", async () => {
    const c = requestCorrelation(mintRequestId());
    const access = createAccessContext();
    const view = await getGateway().enterRouteConformance(c, async () => {
      const p = await access.authenticate(c, cookieValue);
      if (!p) return null;
      return (await access.authorize(c, p, "conformance.read")) ? "granted" : "denied";
    });
    expect(view).toBe("granted");
    const anonymous = await getGateway().enterRouteConformance(requestCorrelation(mintRequestId()), async () => (await access.authenticate(c, undefined)) ?? "refused");
    expect(anonymous).toBe("refused");
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
    // The bounded-read rule (prompt 3 deliverable 1; prompt 4 tightens it to EVERY slice-4 read): a
    // slice-3 collection read, and every slice-4 store read of any cardinality, carries an explicit
    // limit in its SQL text; deleting the LIMIT fails here naming the statement.
    for (const r of ev.registry as { id: string; slice: number; class: string; semanticEffect?: { statementName: string; canonicalSql: string; cardinality: string } }[])
      if (r.slice >= 3 && r.class === "store" && (r.semanticEffect?.cardinality === "many" || (r.slice >= 4 && r.semanticEffect?.cardinality === "at-most-one")))
        expect(/\bLIMIT \d+\b/.test(r.semanticEffect!.canonicalSql), `store operation '${r.id}' ships an unbounded read: no LIMIT in '${r.semanticEffect!.statementName}'`).toBe(true);
  });
});
