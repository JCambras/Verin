import { describe, it, expect } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createContact, createHousehold } from "@infra/crm/house-crm";
import { unwrap } from "@contracts/result";
import { looksLikePIIValue } from "@contracts/pii";
import { scrub } from "@infra/pii/scrub";
import type { Principal } from "@contracts/principal";

/**
 * NO-PII-IN-AUDIT-STORE FENCE (ADR-0006, charter #3/#13, STRIDE T-I1). PII entered
 * into the house CRM (the system of record) must be SCRUBBED before it lands in the
 * audit trail — the audit boundary never stores raw SSN/DOB/email/phone.
 */
const p: Principal = { userId: "u", orgId: "o", role: "advisor", actor: "a@t", sessionId: "s" };

async function seed(): Promise<SqlDb> {
  const db = await createMemoryDb();
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ('o','O','t','verin-crm','t','high')");
  return db;
}

describe("no-pii-in-audit-store fence", () => {
  it("enforces: contact PII (email) is scrubbed out of the audit trail", async () => {
    const db = await seed();
    const hh = unwrap(await createHousehold(db, p, { name: "House" }));
    unwrap(await createContact(db, p, { householdId: hh.id, firstName: "Ada", lastName: "Okafor", email: "ada@example.com", phone: "212-555-0100" }));

    const audit = await db.query<{ before_json: string | null; after_json: string | null }>("SELECT before_json, after_json FROM audit_log WHERE org_id = 'o'");
    for (const row of audit.rows) {
      for (const blob of [row.before_json, row.after_json]) {
        if (!blob) continue;
        expect(looksLikePIIValue(blob), `raw PII found in audit blob: ${blob}`).toBe(false);
        expect(blob.includes("ada@example.com")).toBe(false);
        expect(blob.includes("212-555-0100")).toBe(false);
      }
    }
  });

  describe("detects (companion): scrub actually redacts PII (not vacuous)", () => {
    it("scrub redacts an email value; the raw email IS detected as PII", () => {
      expect(looksLikePIIValue("reach me at ada@example.com")).toBe(true);
      const scrubbed = JSON.stringify(scrub({ email: "ada@example.com", note: "call 212-555-0100" }));
      expect(scrubbed.includes("ada@example.com")).toBe(false);
      expect(scrubbed.includes("212-555-0100")).toBe(false);
      expect(scrubbed.includes("[REDACTED]")).toBe(true);
    });
  });
});
