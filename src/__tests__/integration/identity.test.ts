import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createUser, findUserByEmail, authenticate } from "@infra/identity/identity-store";

const ORG = "org-1";

describe("identity store email canonicalization (integration)", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'verin-crm',$3,'high')", [ORG, "Test Org", new Date().toISOString()]);
  });

  it("a user registered with a mixed-case email signs in with any casing (stored and matched canonically)", async () => {
    const created = await createUser(db, { orgId: ORG, email: "Alex@Firm.test", displayName: "Alex Rivera", role: "advisor", password: "correct-horse-battery" });
    expect(created.email).toBe("alex@firm.test");

    const found = await findUserByEmail(db, "ALEX@FIRM.TEST");
    expect(found?.id).toBe(created.id);

    const user = await authenticate(db, "alex@FIRM.test", "correct-horse-battery");
    expect(user?.id).toBe(created.id);
  });

  it("a case-variant of an existing mailbox cannot register a second identity in the org", async () => {
    await createUser(db, { orgId: ORG, email: "alex@firm.test", displayName: "Alex Rivera", role: "advisor", password: "correct-horse-battery" });
    await expect(
      createUser(db, { orgId: ORG, email: "ALEX@Firm.test", displayName: "Case Variant", role: "advisor", password: "another-password" }),
    ).rejects.toThrow();
  });
});
