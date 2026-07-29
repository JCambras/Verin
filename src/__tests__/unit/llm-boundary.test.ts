import { describe, expect, it } from "vitest";
import {
  hasSensitiveAccountReference,
  REDACTED,
  sensitiveAccountReferences,
} from "@contracts/pii";
import type { Tokenized } from "@contracts/tokenized";
import {
  isSealedTokenized,
  tokenizeRecord,
  tokenizeText,
} from "@infra/pii/tokenize";
import {
  parseMaskedLlmRequest,
  type MaskedLlmRequest,
  type SlotPlaceholder,
} from "@infra/llm/request-schema";
import { projectForLlm } from "@infra/pii/llm-projection";
import {
  hasUnresolvedProjectionEvidence,
  hasUnresolvedProjectionText,
  trustedStaticProjectionText,
  type StaticProjectionTemplateId,
  type TrustedProjectionText,
  type TrustedProjectionValue,
} from "@domain/pii/projection-resolution";

const RAW = {
  name: "Adaeze Okonkwo-Blackwood",
  ssn: "078-05-1120",
  email: "adaeze@example.test",
  phone: "(212) 555-0142",
};
const SLOT_1 = "slot_0001";
const SLOT_2 = "slot_0002";

function projectionValue(
  slotId: string,
  slotType: TrustedProjectionValue["slotType"],
  value: string,
): TrustedProjectionValue {
  return { slotId, slotType, value };
}

function request(
  sourceId: StaticProjectionTemplateId,
  values: readonly TrustedProjectionValue[] = [],
): TrustedProjectionText {
  return trustedStaticProjectionText(sourceId, values);
}

function project(
  trustedRequest: TrustedProjectionText,
  evidence: Readonly<Record<string, unknown>> = {},
  slots: readonly SlotPlaceholder[] = trustedRequest.sensitiveSpans.map((span) => ({
    slotId: span.slotId,
    slotType: span.slotType,
  })),
) {
  return projectForLlm({
    purpose: "intent-shaping",
    request: trustedRequest,
    slots,
    evidence,
  });
}

describe("the Tokenized factory scrubs by construction", () => {
  it("redacts PII-shaped values and seals text", () => {
    const token = tokenizeText(
      `move funds for ${RAW.email}, ssn ${RAW.ssn}, call ${RAW.phone}`,
    );
    expect(token.piiFree).toBe(true);
    expect(token.value).not.toContain(RAW.email);
    expect(token.value).not.toContain(RAW.ssn);
    expect(token.value).toContain(REDACTED);
    expect(isSealedTokenized(token)).toBe(true);
    expect(Object.isFrozen(token)).toBe(true);
  });

  it("deep-scrubs and freezes records", () => {
    const source = {
      household: {
        name: RAW.name,
        contacts: [{ firstName: "Adaeze", email: RAW.email }],
      },
      notes: ["safe"],
      phone: 2125550142,
      accountValue: 812_000,
    };
    const token = tokenizeRecord(source);
    const json = JSON.stringify(token.value);
    expect(json).not.toContain("Adaeze");
    expect(json).not.toContain(RAW.email);
    expect(json).toContain(REDACTED);
    expect(json).not.toContain("2125550142");
    expect(json).toContain("812000");
    expect(isSealedTokenized(token)).toBe(true);
    expect(Object.isFrozen(token.value)).toBe(true);
    expect(Object.isFrozen(token.value.household)).toBe(true);
    expect(Object.isFrozen(token.value.household.contacts)).toBe(true);
    expect(Object.isFrozen(token.value.household.contacts[0])).toBe(true);
    expect(Object.isFrozen(token.value.notes)).toBe(true);
    expect(() => {
      (token.value.notes as unknown as string[]).push("Alice");
    }).toThrow(TypeError);
    source.notes[0] = "changed";
    expect(token.value.notes[0]).toBe("safe");
  });

  it("rejects unsealed structural impostors", () => {
    const impostor = { value: RAW.name, piiFree: true } as Tokenized<string>;
    expect(isSealedTokenized(impostor)).toBe(false);
    expect(isSealedTokenized(Object.create(tokenizeText("safe text")))).toBe(false);
  });

  it("fails closed on recognized raw names and account references", () => {
    expect(() => tokenizeText("John Smith account 941000517334")).toThrow(
      /PII_VIOLATION/,
    );
    expect(() =>
      tokenizeRecord({ note: "John Smith account 941000517334" })
    ).toThrow(/PII_VIOLATION/);
  });
});

describe("the LLM adapter ingress gate", () => {
  const good = (): MaskedLlmRequest => ({
    purpose: "intent-shaping",
    maskedText: tokenizeText("open an account for {{slot_0001}}"),
    slots: [{ slotId: SLOT_1, slotType: "subject" }],
    context: tokenizeRecord({ requestKind: "account-opening" }),
  });

  it("accepts a factory-built masked request", () => {
    expect(parseMaskedLlmRequest(good()).ok).toBe(true);
  });

  it("refuses unsealed Tokenized values", () => {
    const maskedText = {
      value: `ssn ${RAW.ssn}`,
      piiFree: true,
    } as Tokenized<string>;
    const result = parseMaskedLlmRequest({ ...good(), maskedText });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain(RAW.ssn);
    const context = {
      value: { note: RAW.email },
      piiFree: true,
    } as unknown as Tokenized<Readonly<Record<string, unknown>>>;
    expect(parseMaskedLlmRequest({ ...good(), context }).ok).toBe(false);
  });

  it("refuses noncanonical slots, purposes, and input shapes", () => {
    expect(parseMaskedLlmRequest({
      ...good(),
      slots: [{ slotId: "Alice", slotType: "subject" }],
    }).ok).toBe(false);
    expect(parseMaskedLlmRequest({
      ...good(),
      slots: [{ slotId: "slot_0000", slotType: "subject" }],
    }).ok).toBe(false);
    expect(parseMaskedLlmRequest({
      ...good(),
      slots: [{ slotId: SLOT_1, slotType: "raw-record" }],
    }).ok).toBe(false);
    expect(parseMaskedLlmRequest({ ...good(), purpose: "chat" }).ok).toBe(false);
    for (const value of [null, undefined, "text", 42, []]) {
      expect(parseMaskedLlmRequest(value).ok).toBe(false);
    }
  });
});

describe("reviewed projection templates own request-text provenance", () => {
  it("accepts an exact factory-minted static request", () => {
    const trusted = request("review-transaction-request");
    const result = project(trusted);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.maskedText.value).toBe(trusted.maskedText);
  });

  it.each([
    "Alice requested a transfer",
    "Alice Morgan requested a transfer",
    "alice must approve the transfer",
    "please review the requested transfer",
    "SMITH requested a transfer",
    "Smith requested a transfer",
    "ALICE SMITH requested a transfer",
    "ALICE Smith requested a transfer",
    "Alice SMITH requested a transfer",
  ])("refuses arbitrary request text even when it looks harmless: %s", (requestText) => {
    const forged = {
      sourceId: "review-transaction-request",
      requestText,
      maskedText: requestText,
      sensitiveSpans: [],
    } as never;
    expect(projectForLlm({
      purpose: "intent-shaping",
      request: forged,
      slots: [],
      evidence: {},
    }).ok).toBe(false);
  });

  it("refuses stale, caller-constructed, unused, and overlapping provenance", () => {
    const trusted = request(
      "subject-transfer-request",
      [projectionValue(SLOT_1, "subject", "alice")],
    );
    const stale = { ...trusted, requestText: `${trusted.requestText} today` };
    const overlapping = {
      ...trusted,
      sensitiveSpans: [
        ...trusted.sensitiveSpans,
        { slotId: SLOT_2, slotType: "subject", start: 0, end: 3 },
      ],
    };
    for (const untrusted of [stale, overlapping]) {
      expect(projectForLlm({
        purpose: "intent-shaping",
        request: untrusted as never,
        slots: [{ slotId: SLOT_1, slotType: "subject" }],
        evidence: {},
      }).ok).toBe(false);
    }
    expect(project(trusted, {}, [])).toMatchObject({ ok: false });
    expect(project(
      trusted,
      {},
      [{ slotId: SLOT_1, slotType: "account-ref" }],
    )).toMatchObject({ ok: false });
  });

  it("refuses malformed projection input", () => {
    const trusted = request("review-transaction-request");
    for (const input of [
      null,
      { purpose: "intent-shaping", request: null, slots: [], evidence: {} },
      { purpose: "intent-shaping", request: trusted, slots: null, evidence: {} },
      { purpose: "intent-shaping", request: trusted, slots: [], evidence: null },
    ]) {
      expect(projectForLlm(input as never).ok).toBe(false);
    }
  });

  it("refuses invalid factory values and duplicate slot ownership", () => {
    expect(() =>
      trustedStaticProjectionText("missing-template" as never)
    ).toThrow("Projection template values do not match the reviewed structure.");
    expect(() =>
      trustedStaticProjectionText("review-transaction-request", null as never)
    ).toThrow("Projection template values do not match the reviewed structure.");
    expect(() =>
      request("subject-transfer-request", [
        projectionValue("Alice", "subject", "alice"),
      ])
    ).toThrow();
    expect(() =>
      request("account-transfer-request", [
        projectionValue(SLOT_1, "account-ref", "12345678"),
      ])
    ).toThrow();
    expect(() =>
      request("subject-account-transfer-request", [
        projectionValue(SLOT_1, "subject", "alice"),
        projectionValue(SLOT_1, "account-ref", "123456789"),
      ])
    ).toThrow();
  });

  it.each([
    "Alice",
    "alice",
    "SMITH",
    "ALICE SMITH",
    "SMITH, JOHN",
    "ALICE Smith",
    "Alice SMITH",
    RAW.name,
  ])(
    "masks the exact trusted subject span: %s",
    (subject) => {
      const trusted = request(
        "subject-transfer-request",
        [projectionValue(SLOT_1, "subject", subject)],
      );
      const result = project(trusted);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.maskedText.value).toBe(
          "{{slot_0001}} requested a transfer",
        );
        expect(result.value.maskedText.value).not.toContain(subject);
      }
    },
  );

  it("masks lowercase identity text without a suffix heuristic", () => {
    const trusted = request(
      "subject-approval-request",
      [projectionValue(SLOT_1, "subject", "alice")],
    );
    const result = project(trusted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe(
        "{{slot_0001}} must approve the transfer",
      );
    }
  });

  it("masks a short name only at complete occurrences", () => {
    const trusted = request(
      "subject-annual-review-request",
      [projectionValue(SLOT_1, "subject", "Ann")],
    );
    const result = project(trusted, { firstName: "Ann" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe(
        "{{slot_0001}} requested an annual review",
      );
    }
  });

  it("masks case variants across reviewed evidence", () => {
    const trusted = request(
      "review-subject-request",
      [projectionValue(SLOT_1, "subject", "Adaeze")],
    );
    const result = project(trusted, { firstName: "adaeze" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.stringify(result.value.context.value)).not.toContain("adaeze");
    }
  });
});

describe("account-reference classification is shared and separator-aware", () => {
  it.each([
    "123456789",
    "1234 5678 9012",
    "1234-5678-9012",
  ])("classifies and masks %s", (account) => {
    const references = sensitiveAccountReferences(account);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ valid: true });
    expect(hasSensitiveAccountReference(account)).toBe(true);
    const trusted = request(
      "account-transfer-request",
      [projectionValue(SLOT_1, "account-ref", account)],
    );
    const result = project(trusted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe(
        "wire to {{slot_0001}} today",
      );
    }
  });

  it.each([
    "x123456789",
    "123456789x",
    "1234  56789",
    "1234-5678 9012",
    "1234567890123456789",
  ])("fails closed on ambiguous account-like text: %s", (account) => {
    const references = sensitiveAccountReferences(account);
    expect(references.length).toBeGreaterThan(0);
    expect(references.some((reference) => !reference.valid)).toBe(true);
    expect(hasUnresolvedProjectionText(account)).toBe(true);
  });

  it.each(["12345678", "1234 5678"])(
    "does not classify a below-boundary near miss: %s",
    (account) => {
      expect(sensitiveAccountReferences(account)).toEqual([]);
      expect(hasSensitiveAccountReference(account)).toBe(false);
    },
  );

  it("uses one canonical account identity across formatting variants", () => {
    const trusted = request(
      "account-transfer-request",
      [projectionValue(SLOT_1, "account-ref", "1234 5678 9012")],
    );
    const result = project(
      trusted,
      { accountNumber: "123456789012" },
      [{ slotId: SLOT_1, slotType: "account-ref" }],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = JSON.stringify(result.value);
      expect(payload).not.toContain("1234 5678 9012");
      expect(payload).not.toContain("123456789012");
    }
  });
});

describe("projection evidence is plain, reviewed, and complete", () => {
  it("masks reviewed subject and account fields", () => {
    const trusted = request("review-transaction-request");
    const result = project(
      trusted,
      {
        household: { name: RAW.name },
        accountNumber: "1234-5678-9012",
      },
      [
        { slotId: SLOT_1, slotType: "subject" },
        { slotId: SLOT_2, slotType: "account-ref" },
      ],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = JSON.stringify(result.value.context.value);
      expect(payload).not.toContain(RAW.name);
      expect(payload).not.toContain("1234-5678-9012");
    }
  });

  it("redacts reviewed pattern-PII fields and retains numeric business data", () => {
    const result = project(request("review-transaction-request"), {
      email: RAW.email,
      phone: RAW.phone,
      ssn: RAW.ssn,
      plannedWithdrawals: 4200,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = JSON.stringify(result.value.context.value);
      for (const raw of [RAW.email, RAW.phone, RAW.ssn]) {
        expect(payload).not.toContain(raw);
      }
      expect(payload).toContain(REDACTED);
      expect(payload).toContain("4200");
    }
  });

  it.each([
    { note: "alice must approve the transfer" },
    { requestKind: "withdrawal" },
    { alice: REDACTED },
    { firstName: "Alice" },
    { firstName: "SMITH" },
    { plannedWithdrawals: 941000517334 },
  ])("refuses unreviewed or ambiguous evidence: %j", (evidence) => {
    expect(project(request("review-transaction-request"), evidence).ok).toBe(false);
  });

  it.each([
    new Date("2026-01-01T00:00:00.000Z"),
    new Map([["name", RAW.name]]),
    new (class ProjectionEvidence {
      readonly name = RAW.name;
    })(),
  ])("refuses non-plain evidence before masking", (value) => {
    expect(project(request("review-transaction-request"), {
      household: value,
    }).ok).toBe(false);
  });

  it("refuses cyclic evidence and retains the post-mask plain-data invariant", () => {
    const household: Record<string, unknown> = {};
    household.household = household;
    expect(project(request("review-transaction-request"), {
      household,
    }).ok).toBe(false);
    expect(hasUnresolvedProjectionEvidence({
      household: { name: "{{slot_0001}}" },
      plannedWithdrawals: 4200,
    })).toBe(false);
    expect(hasUnresolvedProjectionEvidence({
      household: { name: "alice must approve" },
    })).toBe(true);
  });
});

describe("post-mask residual checks remain fail closed", () => {
  it("accepts only the exact masked form of a sealed request template", () => {
    const trusted = request(
      "subject-transfer-request",
      [projectionValue(SLOT_1, "subject", "alice")],
    );
    expect(hasUnresolvedProjectionText(trusted.maskedText, trusted)).toBe(false);
    expect(hasUnresolvedProjectionText(
      `${trusted.maskedText} Alice`,
      trusted,
    )).toBe(true);
    expect(hasUnresolvedProjectionText(
      trusted.maskedText,
      { ...trusted } as never,
    )).toBe(true);
  });

  it.each([
    "John Smith requested a transfer",
    "ALICE SMITH requested a transfer",
    "wire to 1234 5678 9012",
    `${REDACTED} Alice`,
    `${REDACTED}Alice`,
    `${REDACTED} ${REDACTED} SMITH`,
  ])("refuses unresolved residual text: %s", (value) => {
    expect(hasUnresolvedProjectionText(value)).toBe(true);
  });

  it("accepts the scrubber's own sentinels", () => {
    expect(hasUnresolvedProjectionText(REDACTED)).toBe(false);
    expect(hasUnresolvedProjectionText("{{slot_0001}}")).toBe(false);
    expect(hasUnresolvedProjectionEvidence({
      household: { name: "{{slot_0001}}" },
      email: REDACTED,
    })).toBe(false);
  });
});
