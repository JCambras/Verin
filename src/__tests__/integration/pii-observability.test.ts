import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { startAccountOpening, resumeAccountOpeningByToken } from "@infra/wire";
import { loggerOptions, safeReason } from "@infra/observability/logger";
import { recentSpans, withSpan } from "@infra/observability/tracer";
import { REDACTED } from "@contracts/pii";
import { principalFromIdentity } from "@contracts/principal";
import { actorRefOf, authorizeGovernedAction } from "@contracts/authz";
import { observabilityId, registerTestSpanName } from "@domain/observability/safe-values";

/**
 * PII-safe observability (v3 §15.4): raw names and account numbers do not
 * appear in logs or traces. The log half exercises the REAL production
 * redaction options (loggerOptions is the exact object `log` is built from)
 * plus the sanctioned exception-text helper; the trace half runs the REAL
 * account-opening flow end-to-end and scans every recorded span.
 */
// Test-only span vocabulary (the production allowlist carries no test names).
for (const name of ["test.backstop", "test.keyrule", "test.ambiguous", "test.single-name"]) {
  registerTestSpanName(name);
}

const ORG = "org-pii";
const advisorPrincipal = principalFromIdentity({ userId: "u-pii", orgId: ORG, role: "advisor", actor: "advisor@firm.test", sessionId: "s-pii" });
const advisorAuthorization = authorizeGovernedAction(actorRefOf(advisorPrincipal), "execution.initiate");
if (!advisorAuthorization.ok) throw new Error("advisor should hold execution.initiate");
const advisor = advisorAuthorization.value;
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
  it("safeReason replaces PII-shaped exception text wholesale", () => {
    expect(safeReason(new Error(`duplicate key value: (${FIXTURES.email}) already exists`))).toBe("unexpected-error");
    expect(safeReason(new Error(`password leaked for ${FIXTURES.householdName} account ${FIXTURES.accountNumber}`))).toBe("unexpected-error");
    expect(safeReason({ code: "23505", message: FIXTURES.email })).toBe("driver-error:23505");
    expect(safeReason({ code: "ALICE", message: "caller-controlled" })).toBe("unexpected-error");
    expect(safeReason({ code: "ABCDE", message: "caller-controlled" })).toBe("unexpected-error");
  });
  it("the production logger scrubs ambiguous values even under generic keys", () => {
    const { lines, logger } = makeSink();
    logger.error(
      {
        customer: FIXTURES.householdName,
        reference: FIXTURES.accountNumber,
        apiKey: "not-a-real-api-key",
        connection: "postgres://dbuser:dbpassword@database.internal/verin",
      },
      "test line",
    );
    const out = lines.join("");
    expect(out).not.toContain(FIXTURES.householdName);
    expect(out).not.toContain(FIXTURES.accountNumber);
    expect(out).not.toContain("not-a-real-api-key");
    expect(out).not.toContain("dbpassword");
    expect(out).toContain(REDACTED);
  });
  it("the production logger rejects single names under generic keys", () => {
    const { lines, logger } = makeSink();
    logger.info({ customer: "Alice" }, "Alice");
    const out = lines.join("");
    expect(out).not.toContain("Alice");
    expect(out).toContain(REDACTED);
    expect(out).toContain("log event");
  });
  it("closed semantic fields reject name and account-number smuggling", () => {
    const { lines, logger } = makeSink();
    logger.info(
      { action: "alice", entityId: FIXTURES.accountNumber },
      "test line",
    );
    const out = lines.join("");
    expect(out).not.toContain("alice");
    expect(out).not.toContain(FIXTURES.accountNumber);
    expect(out).toContain(REDACTED);
  });
  it("sealed opaque identifiers preserve reviewed machine ids only", () => {
    expect(() =>
      observabilityId("entityId", FIXTURES.accountNumber)
    ).toThrow(/opaque/);
    const { lines, logger } = makeSink();
    logger.info(
      {
        entityId: observabilityId(
          "entityId",
          "123e4567-e89b-12d3-a456-123456789012",
        ),
      },
      "test line",
    );
    expect(lines.join("")).toContain("123e4567-e89b-12d3-a456-123456789012");
  });
  it("accepts every real machine id shape and still refuses name- and account-shaped values", () => {
    for (const value of [
      "3F2504E0-4F89-11D3-9A0C-0305E82C3301", // uppercase-hex UUID (the route accepts these)
      "org", // the backup-restore drill's org id
      "o",
      "esign-webhook",
      "seed",
      "household:3f1f9c2e-8f7a-4b6e-9e2d-1a2b3c4d5e6f",
    ]) {
      expect(observabilityId("orgId", value).value, value).toBe(value);
    }
    for (const value of [
      "Alice", // a person-name shape
      "Okonkwo-Blackwood",
      FIXTURES.accountNumber,
      FIXTURES.email,
      "078-05-1120",
    ]) {
      expect(() => observabilityId("entityId", value), value).toThrow(/opaque/);
    }
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
      [advisor.actorId, ORG, advisorPrincipal.actor, now],
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
    await withSpan(
      "test.backstop",
      {
        contact: FIXTURES.email,
        phone: FIXTURES.phone,
        orgId: observabilityId("orgId", ORG),
        entityId: [FIXTURES.email, observabilityId("entityId", ORG)],
      },
      async () => undefined,
    );
    const span = [...recentSpans()].reverse().find((s) => s.name === "test.backstop");
    expect(span).toBeTruthy();
    expect(span!.attributes.contact).toBe(REDACTED);
    expect(span!.attributes.phone).toBe(REDACTED);
    expect(span!.attributes.orgId).toBe(ORG); // identifiers survive
    expect(span!.attributes.entityId).toEqual([REDACTED, ORG]); // array values are scrubbed element-wise
  });

  it("a PII-NAMED attribute KEY is redacted regardless of value type (numbers included)", async () => {
    await withSpan(
      "test.keyrule",
      {
        phone: 2125550142,
        accountNumber: 941000517334,
        orgId: observabilityId("orgId", ORG),
        actor: observabilityId("actor", advisor.actorId),
      },
      async () => undefined,
    );
    const span = [...recentSpans()].reverse().find((s) => s.name === "test.keyrule");
    expect(span).toBeTruthy();
    expect(span!.attributes.phone).toBe(REDACTED);
    expect(span!.attributes.accountNumber).toBe(REDACTED);
    expect(span!.attributes.orgId).toBe(ORG); // identifier keys survive
    expect(span!.attributes.actor).toBe(advisor.actorId);
  });

  it("generic trace keys cannot carry unresolved names or bare account numbers", async () => {
    await withSpan(
      "test.ambiguous",
      {
        customer: FIXTURES.householdName,
        reference: FIXTURES.accountNumber,
        apiKey: "not-a-real-api-key",
      },
      async () => undefined,
    );
    const span = [...recentSpans()].reverse().find((s) => s.name === "test.ambiguous");
    expect(span!.attributes.customer).toBe(REDACTED);
    expect(span!.attributes.reference).toBe(REDACTED);
    expect(span!.attributes.apiKey).toBe(REDACTED);
  });

  it("generic trace keys cannot carry single names", async () => {
    await withSpan("test.single-name", { customer: "Alice" }, async () => undefined);
    const span = [...recentSpans()].reverse().find((s) => s.name === "test.single-name");
    expect(span!.attributes.customer).toBe(REDACTED);
  });

  it("dynamic trace names are statically mapped", async () => {
    await withSpan("Alice", {}, async () => undefined);
    expect(recentSpans().at(-1)?.name).toBe("operation");
  });
});
