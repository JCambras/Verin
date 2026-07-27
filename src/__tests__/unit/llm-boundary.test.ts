import { describe, it, expect } from "vitest";
import { REDACTED } from "@contracts/pii";
import type { Tokenized } from "@contracts/tokenized";
import { tokenizeText, tokenizeRecord, isSealedTokenized } from "@infra/pii/tokenize";
import { parseMaskedLlmRequest, slotId, type MaskedLlmRequest } from "@infra/llm/request-schema";
import { projectForLlm } from "@infra/pii/llm-projection";

/**
 * The runtime half of v3 invariant 1: the Tokenized factory scrubs by
 * construction, and the LLM adapter ingress gate refuses everything else —
 * "PII cannot reach LLM request schemas" even via a compiler evasion.
 */
const RAW = {
  name: "Adaeze Okonkwo-Blackwood",
  ssn: "078-05-1120",
  email: "adaeze@example.test",
  phone: "(212) 555-0142",
};
const SLOT_1 = slotId(1);
const SLOT_2 = slotId(2);

describe("the Tokenized factory scrubs by construction", () => {
  it("tokenizeText redacts PII-shaped values and seals the result", () => {
    const t = tokenizeText(`Move $5,000 for ${RAW.email}, SSN ${RAW.ssn}, call ${RAW.phone}`);
    expect(t.piiFree).toBe(true);
    expect(t.value).not.toContain(RAW.email);
    expect(t.value).not.toContain(RAW.ssn);
    expect(t.value).toContain(REDACTED);
    expect(isSealedTokenized(t)).toBe(true);
    expect(Object.isFrozen(t)).toBe(true);
  });
  it("tokenizeRecord deep-scrubs PII fields, nested containers, and numeric PII", () => {
    const t = tokenizeRecord({
      household: { name: RAW.name, contacts: [{ firstName: "Adaeze", email: RAW.email }] },
      phone: 2125550142,
      accountValue: 812_000,
    });
    const json = JSON.stringify(t.value);
    expect(json).not.toContain("Adaeze");
    expect(json).not.toContain(RAW.email);
    expect(json).toContain(REDACTED);
    // Non-PII business values survive the scrub.
    expect(json).toContain("812000");
    expect(isSealedTokenized(t)).toBe(true);
  });
  it("deep-freezes structured payloads after sealing", () => {
    const source = { nested: { notes: ["safe"] } };
    const token = tokenizeRecord(source);
    expect(Object.isFrozen(token.value)).toBe(true);
    expect(Object.isFrozen(token.value.nested)).toBe(true);
    expect(Object.isFrozen(token.value.nested.notes)).toBe(true);
    expect(() => {
      (token.value.nested.notes as unknown as string[]).push("Alice account 941000517334");
    }).toThrow(TypeError);
    source.nested.notes[0] = "changed-after-tokenization";
    expect(token.value.nested.notes[0]).toBe("safe");
    expect(isSealedTokenized(token)).toBe(true);
  });
  it("a structural impostor literal is NOT sealed (the runtime check behind the fence)", () => {
    const impostor = { value: RAW.name, piiFree: true } as Tokenized<string>;
    expect(isSealedTokenized(impostor)).toBe(false);
    expect(isSealedTokenized(Object.create(tokenizeText("safe text")))).toBe(false);
  });
  it("fails closed on unresolved names and bare account-number text", () => {
    expect(() => tokenizeText("John Smith account 941000517334")).toThrow(/PII_VIOLATION/);
    expect(() => tokenizeRecord({ note: "John Smith account 941000517334" })).toThrow(/PII_VIOLATION/);
    expect(() => tokenizeRecord({ "John Smith": "requested a review" })).toThrow(/PII_VIOLATION/);
  });
});

describe("the LLM adapter ingress gate (parseMaskedLlmRequest)", () => {
  const good = (): MaskedLlmRequest => ({
    purpose: "intent-shaping",
    maskedText: tokenizeText("Open an account for {{slot_0001}}"),
    slots: [{ slotId: SLOT_1, slotType: "subject" }],
    context: tokenizeRecord({ requestKind: "account-opening" }),
  });

  it("accepts a factory-built masked request", () => {
    const r = parseMaskedLlmRequest(good());
    expect(r.ok).toBe(true);
  });
  it("refuses an unsealed Tokenized impostor carrying raw PII", () => {
    const evil = { ...good(), maskedText: { value: `SSN ${RAW.ssn}`, piiFree: true } as Tokenized<string> };
    const r = parseMaskedLlmRequest(evil);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("PII_VIOLATION");
      // The refusal must not leak what it refused.
      expect(r.error.message).not.toContain(RAW.ssn);
    }
  });
  it("refuses a sealed-looking record whose payload smuggles PII (defense in depth)", () => {
    const smuggled = { ...good(), context: { value: { note: RAW.email }, piiFree: true } as unknown as Tokenized<Readonly<Record<string, unknown>>> };
    expect(parseMaskedLlmRequest(smuggled).ok).toBe(false);
  });
  it("refuses noncanonical slot ids and unknown purposes or slot types", () => {
    expect(parseMaskedLlmRequest({ ...good(), slots: [{ slotId: `call ${RAW.name}`, slotType: "subject" }] }).ok).toBe(false);
    expect(parseMaskedLlmRequest({ ...good(), slots: [{ slotId: "Alice", slotType: "subject" }] }).ok).toBe(false);
    expect(parseMaskedLlmRequest({ ...good(), purpose: "chat" }).ok).toBe(false);
    expect(parseMaskedLlmRequest({ ...good(), slots: [{ slotId: "s1", slotType: "raw-record" }] }).ok).toBe(false);
  });
  it("refuses non-objects and garbage", () => {
    for (const v of [null, undefined, "text", 42, []]) expect(parseMaskedLlmRequest(v).ok).toBe(false);
  });
  it("generates canonical opaque slot ids and rejects invalid indices", () => {
    expect(slotId(1)).toBe("slot_0001");
    expect(slotId(9999)).toBe("slot_9999");
    for (const index of [0, -1, 1.5, 10_000]) {
      expect(() => slotId(index)).toThrow();
    }
  });
});

describe("the evidence-to-LLM projection scrubs at the boundary", () => {
  it("rejects malformed projection input", () => {
    const base = {
      purpose: "intent-shaping" as const,
      requestText: `Open an account for ${RAW.name}`,
      slots: [{ slotId: SLOT_1, slotType: "subject" as const }],
      evidence: {},
    };
    for (const input of [
      { ...base, requestText: null },
      { ...base, slots: [null] },
      { ...base, evidence: null },
    ]) {
      const result = projectForLlm(input as never);
      expect(result.ok).toBe(false);
    }
  });

  it("derives sensitive entities into slot placeholders and scrubs the rest (v3 §15.1 stage 1)", () => {
    const r = projectForLlm({
      purpose: "intent-shaping",
      requestText: `Wire $12,000 from ${RAW.name}'s IRA — reach her at ${RAW.email} / ${RAW.phone}`,
      slots: [{ slotId: SLOT_1, slotType: "subject" }, { slotId: SLOT_2, slotType: "amount" }],
      evidence: { household: { name: RAW.name }, ssn: RAW.ssn, plannedWithdrawals: 12000 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const flat = JSON.stringify({ text: r.value.maskedText.value, ctx: r.value.context.value });
    for (const raw of Object.values(RAW)) expect(flat).not.toContain(raw);
    expect(r.value.maskedText.value).toContain("{{slot_0001}}"); // the name became its typed placeholder
    expect(flat).toContain(REDACTED); // pattern PII (ssn/email/phone) redacted
    expect(flat).toContain("12000"); // non-PII business data survives
  });
  it("masking is case-insensitive (a lowercased name cannot slip past)", () => {
    const r = projectForLlm({
      purpose: "intent-shaping",
      requestText: `follow up with ${RAW.name.toLowerCase()}`,
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: { household: { name: RAW.name } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.maskedText.value).not.toContain(RAW.name.toLowerCase());
    expect(r.value.maskedText.value).toContain("{{slot_0001}}");
  });
  it("refuses a non-machine-name mask slotId fail-closed (a '$&' slotId cannot re-insert the entity)", () => {
    const r = projectForLlm({
      purpose: "intent-shaping",
      requestText: `follow up with ${RAW.name}`,
      slots: [{ slotId: "$&", slotType: "subject" }],
      evidence: {},
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("PII_VIOLATION");
    expect(r.error.message).not.toContain(RAW.name);
    expect(r.error.message).not.toContain("$&");
  });
  it("overlapping masks are applied longest-first (a shorter mask cannot leave a partial name behind)", () => {
    const r = projectForLlm({
      purpose: "intent-shaping",
      requestText: `schedule a call with ${RAW.name}`,
      slots: [
        { slotId: SLOT_1, slotType: "subject" },
        { slotId: SLOT_2, slotType: "subject" },
      ],
      evidence: { name: RAW.name, firstName: "Adaeze" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.maskedText.value).not.toContain("Okonkwo-Blackwood");
    expect(r.value.maskedText.value).not.toContain("Adaeze");
    expect(r.value.maskedText.value).toContain("{{slot_0001}}");
  });
  it("refuses unresolved sensitive text when a caller omits the required masks", () => {
    const r = projectForLlm({
      purpose: "intent-shaping",
      requestText: "John Smith account 941000517334",
      slots: [],
      evidence: { note: "John Smith account 941000517334" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("PII_VIOLATION");
      expect(r.error.message).not.toContain("John Smith");
      expect(r.error.message).not.toContain("941000517334");
    }
  });
  it("refuses dummy masks and missing masks for sensitive slots", () => {
    const base = {
      purpose: "intent-shaping" as const,
      requestText: "review the requested account",
      slots: [{ slotId: SLOT_1, slotType: "subject" as const }],
      evidence: {},
    };
    expect(projectForLlm(base).ok).toBe(false);
    expect(projectForLlm({
      ...base,
      resolvedEntities: [{
        slotId: SLOT_1,
        slotType: "subject",
        rawValues: ["unrelated person"],
      }],
    } as never).ok).toBe(false);
  });
  it("refuses incomplete or type-inconsistent resolution and masks single-word names", () => {
    const base = {
      purpose: "intent-shaping" as const,
      requestText: "Alice wants account",
      slots: [{ slotId: SLOT_1, slotType: "subject" as const }],
      evidence: {},
    };
    expect(projectForLlm({
      ...base,
      slots: [{ slotId: SLOT_1, slotType: "account-ref" }],
    }).ok).toBe(false);
    expect(projectForLlm({
      ...base,
      slots: [],
    }).ok).toBe(false);
    expect(projectForLlm({
      ...base,
      masks: [{ slotId: SLOT_1, rawText: "account" }],
    } as never).ok).toBe(false);

    const result = projectForLlm(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe("{{slot_0001}} wants account");
    }
  });
  it("refuses an incomplete trusted binding set that leaves other names unresolved", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Alice sends to Bob account",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: {},
    });
    expect(result.ok).toBe(false);
  });
  it("refuses an account binding that leaves a resolver-ambiguous person name", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Ira wants 401",
      slots: [{ slotId: SLOT_1, slotType: "account-ref" }],
      evidence: {},
    });
    expect(result.ok).toBe(false);
  });
  it("refuses unclassified numeric evidence leaves", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Review Alice",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: { reference: 941000517334 },
    });
    expect(result.ok).toBe(false);
  });
  it("refuses sensitive-length numbers under an otherwise safe evidence key", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Review Alice",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: { plannedWithdrawals: 941000517334 },
    });
    expect(result.ok).toBe(false);
  });
  it("refuses an omitted lowercase entity outside the closed residual vocabulary", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "alice wants Bob account",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: {},
    });
    expect(result.ok).toBe(false);
  });
  it("refuses an innocuous subject binding that leaves a leading name unresolved", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Alice uses account",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: {},
    });
    expect(result.ok).toBe(false);
  });
  it("masks resolved entity values retained in evidence keys", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Review Alice",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: { Alice: "requested review" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value.context.value)).toEqual(["{{slot_0001}}"]);
    }
  });
  it("masks known entities in untyped evidence values before tokenization", () => {
    const r = projectForLlm({
      purpose: "intent-shaping",
      requestText: `Review ${RAW.name}`,
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: { note: `${RAW.name} requested a review` },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.value.context.value)).not.toContain(RAW.name);
      expect(JSON.stringify(r.value.context.value)).toContain("{{slot_0001}}");
    }
  });
  it("derives account references from the complete payload", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Review account 401",
      slots: [{ slotId: SLOT_1, slotType: "account-ref" }],
      evidence: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe("Review account {{slot_0001}}");
    }
  });
});
