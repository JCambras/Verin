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
 * A COUNTERPARTY'S NAME IS AUTHORIZED LIKE ANY OTHER, AND A WITHHELD ONE IS
 * WITHHELD WHOLE (ADR-0057, v3 §15.3).
 *
 * A cross-household link names a second household, and that name is the same
 * client PII the subject's is. The Wave 0 evidence adapter serves one world to
 * everyone - the tenant-scoped CRM read is the ONLY thing scoping this path - so
 * a counterparty resolved straight from the port would hand a caller a household
 * name from outside its book the day that adapter becomes a real EvidenceSource.
 *
 * The assertion below is the CONDITION, not one symptom of it. Checking that the
 * counterparty's exact display name was absent passed while its world KEY -
 * `<surname>-<given name>` by construction - shipped in the name's place, which
 * discloses the same party at lower fidelity to the same reader. So the whole
 * serialized response is scanned for every word of every party in the withheld
 * household, as a fragment and in any casing, plus each party's words in
 * reversed order and with every separator - minus the words the SUBJECT itself
 * publishes, because two Whitfield households share that surname on purpose and
 * a word the reader is already authorized to see discriminates nothing.
 */
const cookieStore = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const TEST_SYSTEM_ACTOR = registerTestSystemActor("test");
const ORG = "org-counterparty";
const globalStore = globalThis as unknown as { __verinDb?: Promise<SqlDb> };

const world = generateWorld(loadWorldSpec(), WORLD_SEED);
const DIGEST = String((world.manifest.value as Record<string, unknown>).worldDigest);
const byKey = (key: string): WorldHousehold =>
  world.households.find((household) => household.key === key)!;

/** The two hand-authored households the world deliberately links to each other. */
const CORDELIA = byKey("whitfield-cordelia");
const NATHANIEL = byKey("whitfield-nathaniel");

const wordsOf = (value: string): string[] =>
  value.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 2);

/** Every name a household publishes for a PARTY of its own: the household, its
 * people, and whoever is designated or authorized on its accounts. */
const partyNames = (household: WorldHousehold): string[] => [
  household.displayName,
  household.key,
  ...household.members.flatMap((member) => [member.displayName, member.key]),
  ...household.accounts.flatMap((account) => [
    ...account.beneficiaries.map((beneficiary) => beneficiary.displayName),
    ...account.signers.map((signer) => signer.displayName),
  ]),
];

/** What the SUBJECT household publishes about itself - words a reader holding
 * this household is authorized to see, whoever else happens to share them. */
const subjectWords = (household: WorldHousehold): Set<string> =>
  new Set([
    ...partyNames(household),
    household.surname, household.city, household.advisorName,
    ...household.entities.map((entity) => entity.name),
    ...household.accounts.flatMap((account) => [account.title, account.custodian]),
    ...household.bankInstructions.flatMap((instruction) => [instruction.bank, instruction.titledTo]),
  ].flatMap(wordsOf));

/** Words that could only have come from the WITHHELD household. */
function discriminatingWords(withheld: WorldHousehold, subject: WorldHousehold): string[] {
  const authorized = subjectWords(subject);
  return [...new Set(partyNames(withheld).flatMap(wordsOf))].filter((word) => !authorized.has(word));
}

/** Each withheld party's words in order and REVERSED, joined every way an
 * identifier in this world is joined. */
function discriminatingForms(withheld: WorldHousehold, subject: WorldHousehold): string[] {
  const discriminating = new Set(discriminatingWords(withheld, subject));
  const forms = [...discriminating];
  for (const name of partyNames(withheld)) {
    const words = wordsOf(name);
    if (words.length < 2 || !words.some((word) => discriminating.has(word))) continue;
    for (const ordered of [words, [...words].reverse()]) {
      forms.push(ordered.join(" "), ordered.join("-"), ordered.join(""));
    }
  }
  return [...new Set(forms)];
}

/** Every withheld form the payload actually carries - a fragment match, so a
 * lower-fidelity rendering is caught rather than only the exact string. */
const disclosuresIn = (payload: string, forms: readonly string[]): string[] => {
  const haystack = payload.toLowerCase();
  return forms.filter((form) => haystack.includes(form));
};

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
  it("names a counterparty that IS in this firm's book, and links to it", async () => {
    await seedBook([CORDELIA, NATHANIEL]);
    const { status, body } = await detail(CORDELIA.key);
    expect(status).toBe(200);
    const link = JSON.parse(body).household.crossHouseholdLinks[0];
    expect(link.counterpartyKey).toBe(NATHANIEL.key);
    expect(link.counterpartyLabel).toBe(NATHANIEL.displayName);
  });

  for (const [subject, withheld] of [[CORDELIA, NATHANIEL], [NATHANIEL, CORDELIA]] as const) {
    it(`withholds every part of the counterparty's identity from ${subject.key}`, async () => {
      await seedBook([subject]);
      const { status, body } = await detail(subject.key);
      expect(status).toBe(200);

      const link = JSON.parse(body).household.crossHouseholdLinks[0];
      expect(link.counterpartyKey, "a withheld counterparty is not linkable").toBeNull();
      expect(link.counterpartyLabel, "the copy names no party").toBe("That household is not in this firm's book.");
      expect(link.reference, "the stand-in is an opaque ordinal, never a name").toMatch(/^counterparty-\d+$/);

      const forms = discriminatingForms(withheld, subject);
      expect(forms.length, "nothing distinguishes the withheld household - the scan would prove nothing")
        .toBeGreaterThan(1);
      const disclosed = disclosuresIn(body, forms);
      expect(disclosed, `these parts of ${withheld.key} reached the client:\n${disclosed.join("\n")}`).toEqual([]);
    });
  }

  it("detects (companion): the scan CATCHES the world key it used to pass through", async () => {
    // The shape this route shipped: the counterparty's key as its label. It is
    // `<surname>-<given name>`, so a reader learns the party at lower fidelity -
    // and the display-name check that guarded this path never fired.
    const forms = discriminatingForms(NATHANIEL, CORDELIA);
    const asShipped = JSON.stringify({ counterpartyKey: NATHANIEL.key, counterpartyName: NATHANIEL.key });
    expect(disclosuresIn(asShipped, forms).length, "a key-shaped disclosure must fail the scan").toBeGreaterThan(0);
    expect(disclosuresIn(asShipped, forms)).toContain(NATHANIEL.key);
    // ...and the shared surname alone is NOT treated as a disclosure, because
    // the subject household publishes it too.
    expect(forms).not.toContain(CORDELIA.surname.toLowerCase());
  });

  it("the counterparty itself is still a 404 for this firm, so the link is not a way around the guard", async () => {
    await seedBook([CORDELIA]);
    const { status } = await detail(NATHANIEL.key);
    expect(status).toBe(404);
  });
});
