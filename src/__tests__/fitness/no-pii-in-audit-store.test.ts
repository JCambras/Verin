import { describe, it, expect } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createContact, createHousehold } from "@infra/crm/house-crm";
import { unwrap } from "@contracts/result";
import { looksLikePIIValue, isPIIField, assertNoPIIValues, REDACTED } from "@contracts/pii";
import { scrub } from "@infra/pii/scrub";
import type { WriteActor } from "@contracts/principal";

/**
 * NO-PII-IN-AUDIT-STORE FENCE (ADR-0006, charter #3/#13, STRIDE T-I1). PII entered
 * into the house CRM (the system of record) must be SCRUBBED before it lands in the
 * audit trail — the audit boundary never stores raw SSN/DOB/email/phone/NAME, in
 * before/after snapshots OR the free-text detail (Sable F1: the earlier fence only
 * checked email/phone and never scanned `detail`, so it passed vacuously).
 */
const p: WriteActor = { orgId: "o", actorUserId: "u" };

// Distinctive tokens that must NOT survive into the audit store.
const PII_TOKENS = ["Zephyrine", "Okonkwo-Blackwood", "zeph@example.com", "212-555-0142", "The Okonkwo-Blackwood Family"];

async function seed(): Promise<SqlDb> {
  const db = await createMemoryDb();
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ('o','O','2026-01-01T00:00:00.000Z','verin-crm','2026-01-01T00:00:00.000Z','high')");
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
    it("phones need a phone-ish context: separated and E.164 forms match, a bare 10-digit ID does not", () => {
      expect(looksLikePIIValue("212-555-0142")).toBe(true);
      expect(looksLikePIIValue("+12125550142")).toBe(true);
      expect(looksLikePIIValue("external ref 2125550142")).toBe(false);
    });
    it("NON-STRING values under a PII key are redacted ({ phone: 5551234567 } cannot survive)", () => {
      expect(scrub({ phone: 5551234567 })).toEqual({ phone: REDACTED });
      expect(scrub({ dob: true })).toEqual({ dob: REDACTED });
    });
    it("keyIsPII propagates through nested OBJECTS and ARRAYS under a PII key", () => {
      expect(scrub({ name: { first: "John", suffix: 3 } })).toEqual({ name: { first: REDACTED, suffix: REDACTED } });
      expect(scrub({ phones: [5551234567, "212-555-0142"] })).toEqual({ phones: [REDACTED, REDACTED] });
    });
    it("the fail-closed backstop THROWS on non-string PII that a bypassed scrubber would leak", () => {
      expect(() => assertNoPIIValues({ phone: 5551234567 }, "audit")).toThrow(/PII_VIOLATION/);
      expect(() => assertNoPIIValues({ firstName: "John" }, "audit")).toThrow(/PII_VIOLATION/);
      // …and accepts the legitimately-scrubbed shape.
      expect(() => assertNoPIIValues({ firstName: REDACTED, phone: null, note: "id 42" }, "audit")).not.toThrow();
    });
  });
});
