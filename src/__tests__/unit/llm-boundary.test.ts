import { describe, it, expect } from "vitest";
import { REDACTED } from "@contracts/pii";
import type { Tokenized } from "@contracts/tokenized";
import { tokenizeText, tokenizeRecord, isSealedTokenized } from "@infra/pii/tokenize";
import { parseMaskedLlmRequest, type MaskedLlmRequest } from "@infra/llm/request-schema";
import { projectForLlm } from "@infra/llm/projection";

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
  it("a structural impostor literal is NOT sealed (the runtime check behind the fence)", () => {
    const impostor = { value: RAW.name, piiFree: true } as Tokenized<string>;
    expect(isSealedTokenized(impostor)).toBe(false);
  });
});

describe("the LLM adapter ingress gate (parseMaskedLlmRequest)", () => {
  const good = (): MaskedLlmRequest => ({
    purpose: "intent-shaping",
    maskedText: tokenizeText("Open an account for SUBJECT_1"),
    slots: [{ slotName: "subject_1", slotType: "subject" }],
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
    const smuggled = { ...good(), context: { value: { note: RAW.email }, piiFree: true } as Tokenized<Readonly<Record<string, unknown>>> };
    expect(parseMaskedLlmRequest(smuggled).ok).toBe(false);
  });
  it("refuses free-text slot names and unknown purposes/slot types", () => {
    expect(parseMaskedLlmRequest({ ...good(), slots: [{ slotName: `call ${RAW.name}`, slotType: "subject" }] }).ok).toBe(false);
    expect(parseMaskedLlmRequest({ ...good(), purpose: "chat" }).ok).toBe(false);
    expect(parseMaskedLlmRequest({ ...good(), slots: [{ slotName: "s1", slotType: "raw-record" }] }).ok).toBe(false);
  });
  it("refuses non-objects and garbage", () => {
    for (const v of [null, undefined, "text", 42, []]) expect(parseMaskedLlmRequest(v).ok).toBe(false);
  });
});

describe("the evidence-to-LLM projection scrubs at the boundary", () => {
  it("masks known entities into slot placeholders and scrubs the rest (v3 §15.1 stage 1)", () => {
    const r = projectForLlm({
      purpose: "intent-shaping",
      requestText: `Wire $12,000 from ${RAW.name}'s IRA — reach her at ${RAW.email} / ${RAW.phone}`,
      slots: [{ slotName: "subject_1", slotType: "subject" }, { slotName: "amount_1", slotType: "amount" }],
      masks: [{ slotName: "subject_1", rawText: RAW.name }],
      evidence: { household: { name: RAW.name }, ssn: RAW.ssn, plannedWithdrawals: 12000 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const flat = JSON.stringify({ text: r.value.maskedText.value, ctx: r.value.context.value });
    for (const raw of Object.values(RAW)) expect(flat).not.toContain(raw);
    expect(r.value.maskedText.value).toContain("{{subject_1}}"); // the name became its typed placeholder
    expect(flat).toContain(REDACTED); // pattern PII (ssn/email/phone) redacted
    expect(flat).toContain("12000"); // non-PII business data survives
  });
  it("masking is case-insensitive (a lowercased name cannot slip past)", () => {
    const r = projectForLlm({
      purpose: "intent-shaping",
      requestText: `follow up with ${RAW.name.toLowerCase()}`,
      slots: [{ slotName: "subject_1", slotType: "subject" }],
      masks: [{ slotName: "subject_1", rawText: RAW.name }],
      evidence: {},
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.maskedText.value).not.toContain(RAW.name.toLowerCase());
    expect(r.value.maskedText.value).toContain("{{subject_1}}");
  });
});
