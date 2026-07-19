import { describe, it, expect } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createContact, createHousehold } from "@infra/crm/house-crm";
import { unwrap } from "@contracts/result";
import { looksLikePIIValue, isPIIField } from "@contracts/pii";
import { scrub } from "@infra/pii/scrub";
import type { Principal } from "@contracts/principal";

/**
 * NO-PII-IN-AUDIT-STORE FENCE (ADR-0006, charter #3/#13, STRIDE T-I1). PII entered
 * into the house CRM (the system of record) must be SCRUBBED before it lands in the
 * audit trail — the audit boundary never stores raw SSN/DOB/email/phone/NAME, in
 * before/after snapshots OR the free-text detail (Sable F1: the earlier fence only
 * checked email/phone and never scanned `detail`, so it passed vacuously).
 */
const p: Principal = { userId: "u", orgId: "o", role: "advisor", actor: "a@t", sessionId: "s" };

// Distinctive tokens that must NOT survive into the audit store.
const PII_TOKENS = ["Zephyrine", "Okonkwo-Blackwood", "zeph@example.com", "212-555-0142", "The Okonkwo-Blackwood Family"];

async function seed(): Promise<SqlDb> {
  const db = await createMemoryDb();
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ('o','O','t','verin-crm','t','high')");
  return db;
}

describe("no-pii-in-audit-store fence", () => {
  it("enforces: contact/household PII is scrubbed from EVERY audit field (before/after AND detail)", async () => {
    const db = await seed();
    const hh = unwrap(await createHousehold(db, p, { name: "The Okonkwo-Blackwood Family" }));
    unwrap(await createContact(db, p, { householdId: hh.id, firstName: "Zephyrine", lastName: "Okonkwo-Blackwood", email: "zeph@example.com", phone: "212-555-0142" }));

    const audit = await db.query<{ before_json: string | null; after_json: string | null; detail: string }>(
      "SELECT before_json, after_json, detail FROM audit_log WHERE org_id = 'o'",
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const row of audit.rows) {
      for (const field of [row.before_json, row.after_json, row.detail]) {
        if (!field) continue;
        expect(looksLikePIIValue(field), `PII value pattern in audit: ${field}`).toBe(false);
        for (const token of PII_TOKENS) {
          expect(field.includes(token), `raw PII "${token}" found in audit field: ${field}`).toBe(false);
        }
      }
    }
  });

  describe("detects (companion): scrub actually redacts PII names + values (not vacuous)", () => {
    it("name fields are recognized as PII and redacted", () => {
      expect(isPIIField("firstName")).toBe(true);
      expect(isPIIField("lastName")).toBe(true);
      expect(isPIIField("name")).toBe(true);
      const scrubbed = JSON.stringify(scrub({ firstName: "Zephyrine", lastName: "Okonkwo-Blackwood", email: "zeph@example.com" }));
      for (const token of ["Zephyrine", "Okonkwo-Blackwood", "zeph@example.com"]) {
        expect(scrubbed.includes(token)).toBe(false);
      }
      expect(scrubbed.includes("[REDACTED]")).toBe(true);
    });
    it("a raw email is detected as a PII value", () => {
      expect(looksLikePIIValue("reach me at zeph@example.com")).toBe(true);
    });
  });
});
