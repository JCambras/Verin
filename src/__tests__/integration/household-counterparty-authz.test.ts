import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { registerTestSystemActor, systemTenant } from "@contracts/tenant";
import { systemWriteActor } from "@contracts/principal";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { runMigrations } from "@infra/store/migrations";
import { createUser } from "@infra/identity/identity-store";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";
import { seedWorldIntoCrm } from "@infra/crm/world-seed";
import type { WorldHousehold } from "@domain/world/household-world";
import { generateWorld } from "../../../scripts/world/generate";
import { loadWorldSpec, WORLD_SEED } from "../../../scripts/world/spec";

/**
 * A COUNTERPARTY'S NAME IS AUTHORIZED LIKE ANY OTHER (ADR-0057, v3 §15.3).
 *
 * A cross-household link names a second household, and that name is the same
 * client PII the subject's is. The Wave 0 evidence adapter serves one world to
 * everyone - the tenant-scoped CRM read is the ONLY thing scoping this path - so
 * a counterparty resolved straight from the port would hand a caller a household
 * name from outside its book the day that adapter becomes a real EvidenceSource.
 * The subject is authorized; the counterparty is authorized identically, and an
 * unauthorized one keeps its slug rather than disclosing a name.
 */
const cookieStore = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const TEST_SYSTEM_ACTOR = registerTestSystemActor("test");
const ORG = "org-counterparty";
const SUBJECT = "whitfield-cordelia";
const COUNTERPARTY = "whitfield-nathaniel";
const COUNTERPARTY_NAME = "Nathaniel & Perrine Whitfield";
const globalStore = globalThis as unknown as { __verinDb?: Promise<SqlDb> };

const world = generateWorld(loadWorldSpec(), WORLD_SEED);
const DIGEST = String((world.manifest.value as Record<string, unknown>).worldDigest);
const byKey = (key: string): WorldHousehold =>
  world.households.find((household) => household.key === key)!;

let db: SqlDb;

async function seedBook(households: readonly WorldHousehold[]): Promise<void> {
  const loaded = await seedWorldIntoCrm(db, systemWriteActor("seed", ORG), households, DIGEST);
  expect(loaded.ok, "the book must seed before the route can be asked about it").toBe(true);
}

async function detail(key: string): Promise<{ status: number; body: string }> {
  const req = new NextRequest(`http://localhost/api/households/${key}`);
  req.cookies.set(SESSION_COOKIE, signSessionCookie("s-counterparty"));
  const { GET } = await import("@app/api/households/[key]/route");
  const response = await GET(req, { params: Promise.resolve({ key }) });
  return { status: response.status, body: await response.text() };
}

beforeEach(async () => {
  cookieStore.set.mockClear();
  db = await createMemoryDb();
  await runMigrations(db);
  globalStore.__verinDb = Promise.resolve(db);
  const now = new Date().toISOString();
  await db.query(
    "INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Counterparty Firm',$2,'verin-crm',$2,'high')",
    [ORG, now],
  );
  const user = await createUser(db, systemTenant(TEST_SYSTEM_ACTOR, ORG), {
    email: "advisor-counterparty@firm.test",
    displayName: "Counterparty Advisor",
    role: "advisor",
    password: "correct-horse-battery",
  });
  await db.query(
    "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ('s-counterparty',$1,$2,'advisor',$3,$4,NULL)",
    [user.id, ORG, now, new Date(Date.now() + 50 * 60_000).toISOString()],
  );
});

describe("GET /api/households/[key] cross-household counterparties", () => {
  it("names a counterparty that IS in this firm's book", async () => {
    await seedBook([byKey(SUBJECT), byKey(COUNTERPARTY)]);
    const { status, body } = await detail(SUBJECT);
    expect(status).toBe(200);
    const link = JSON.parse(body).household.crossHouseholdLinks[0];
    expect(link.counterpartyKey).toBe(COUNTERPARTY);
    expect(link.counterpartyName).toBe(COUNTERPARTY_NAME);
  });

  it("withholds the name of a counterparty that is NOT in this firm's book", async () => {
    await seedBook([byKey(SUBJECT)]);
    const { status, body } = await detail(SUBJECT);
    expect(status).toBe(200);
    const link = JSON.parse(body).household.crossHouseholdLinks[0];
    expect(link.counterpartyKey).toBe(COUNTERPARTY);
    expect(link.counterpartyName, "an unauthorized counterparty keeps its slug").toBe(COUNTERPARTY);
    expect(body, "no unauthorized household name may reach the client").not.toContain(COUNTERPARTY_NAME);
  });

  it("the counterparty itself is still a 404 for this firm, so the link is not a way around the guard", async () => {
    await seedBook([byKey(SUBJECT)]);
    const { status } = await detail(COUNTERPARTY);
    expect(status).toBe(404);
  });
});
