import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { startAccountOpening, resumeAccountOpeningByToken } from "@infra/wire";
import { loggerOptions, piiSafe, safeReason } from "@infra/observability/logger";
import { recentSpans, withSpan } from "@infra/observability/tracer";
import { REDACTED } from "@contracts/pii";
import type { Principal } from "@contracts/principal";

/**
 * PII-safe observability (v3 §15.4): raw names and account numbers do not
 * appear in logs or traces. The log half exercises the REAL production
 * redaction options (loggerOptions is the exact object `log` is built from)
 * plus the sanctioned free-form helpers; the trace half runs the REAL
 * account-opening flow end-to-end and scans every recorded span.
 */
const ORG = "org-pii";
const advisor: Principal = { userId: "u-pii", orgId: ORG, role: "advisor", actor: "advisor@firm.test", sessionId: "s-pii" };
const FIXTURES = {
  householdName: "Okonkwo-Blackwood Household",
  firstName: "Zephyrine",
  lastName: "Okonkwo-Blackwood",
  email: "zeph.okonkwo@example.test",
  accountNumber: "941000517334",
  phone: "(212) 555-0142",
};

function makeSink(): { lines: string[]; logger: pino.Logger } {
  const lines: string[] = [];
  // The production redact OPTIONS under test; only the level is forced to
  // "info" (test env pins LOG_LEVEL higher, which would drop the lines).
  const logger = pino({ ...loggerOptions, level: "info" }, { write: (line: string) => void lines.push(line) });
  return { lines, logger };
}

describe("logs never carry raw names or account numbers", () => {
  it("the production redaction options redact PII field names, including account/routing numbers", () => {
    const { lines, logger } = makeSink();
    logger.info(
      { firstName: FIXTURES.firstName, lastName: FIXTURES.lastName, email: FIXTURES.email, accountNumber: FIXTURES.accountNumber, household: { name: FIXTURES.householdName } },
      "test line",
    );
    const out = lines.join("");
    for (const raw of [FIXTURES.firstName, FIXTURES.lastName, FIXTURES.email, FIXTURES.accountNumber, FIXTURES.householdName]) {
      expect(out).not.toContain(raw);
    }
    expect(out).toContain(REDACTED);
  });
  it("piiSafe deep-scrubs structures BEYOND the redactor's depth/name limits", () => {
    const { lines, logger } = makeSink();
    logger.info(piiSafe({ a: { b: { c: { d: { e: { name: FIXTURES.lastName, note: `call ${FIXTURES.phone}` } } } } } }), "deep");
    const out = lines.join("");
    expect(out).not.toContain(FIXTURES.lastName);
    expect(out).not.toContain(FIXTURES.phone);
  });
  it("safeReason replaces PII-shaped exception text wholesale", () => {
    expect(safeReason(new Error(`duplicate key value: (${FIXTURES.email}) already exists`))).toBe(REDACTED);
    expect(safeReason(new Error("connection refused"))).toContain("connection refused");
  });
});

describe("traces never carry raw names or account numbers", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    const now = new Date().toISOString();
    await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')", [ORG, now]);
    await db.query(
      "INSERT INTO users (id,org_id,email,display_name,role,status,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,$2,$3,'Advisor','advisor','active',$4,'verin-crm',$4,'high')",
      [advisor.userId, ORG, advisor.actor, now],
    );
  });

  it("the REAL account-opening flow (start → webhook resume) emits spans free of the client's PII", async () => {
    const before = recentSpans().length;
    const started = await startAccountOpening(db, advisor, {
      householdName: FIXTURES.householdName,
      firstName: FIXTURES.firstName,
      lastName: FIXTURES.lastName,
      email: FIXTURES.email,
      accountType: "individual",
    });
    expect(started.status).toBe("suspended");
    await resumeAccountOpeningByToken(db, started.token!, { signedAt: new Date().toISOString() });

    const emitted = recentSpans().slice(before);
    expect(emitted.length).toBeGreaterThan(3); // the flow really traced
    const flat = JSON.stringify(emitted);
    for (const raw of Object.values(FIXTURES)) {
      expect(flat, `span payload leaked ${raw}`).not.toContain(raw);
    }
  });

  it("a PII-shaped attribute VALUE is scrubbed at the span boundary (backstop)", async () => {
    await withSpan("test.backstop", { contact: FIXTURES.email, phone: FIXTURES.phone, orgId: ORG }, async () => undefined);
    const span = [...recentSpans()].reverse().find((s) => s.name === "test.backstop");
    expect(span).toBeTruthy();
    expect(span!.attributes.contact).toBe(REDACTED);
    expect(span!.attributes.phone).toBe(REDACTED);
    expect(span!.attributes.orgId).toBe(ORG); // identifiers survive
  });
});
