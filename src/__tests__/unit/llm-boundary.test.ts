import { describe, it, expect } from "vitest";
import { REDACTED } from "@contracts/pii";
import type { Tokenized } from "@contracts/tokenized";
import { tokenizeText, tokenizeRecord, isSealedTokenized } from "@infra/pii/tokenize";
import { parseMaskedLlmRequest, type MaskedLlmRequest } from "@infra/llm/request-schema";
import { projectForLlm } from "@infra/pii/llm-projection";
import {
  hasUnresolvedProjectionEvidence,
  hasUnresolvedProjectionText,
  trustedStaticProjectionText,
} from "@domain/pii/projection-resolution";

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
const SLOT_1 = "slot_0001";
const SLOT_2 = "slot_0002";
const identitySpan = (requestText: string, rawText: string, slotId = SLOT_1) => {
  const start = requestText.indexOf(rawText);
  return { slotId, start, end: start + rawText.length };
};

describe("the Tokenized factory scrubs by construction", () => {
  it("tokenizeText redacts PII-shaped values and seals the result", () => {
    // Labels stay lowercase on purpose: an all-caps run is person-shaped to the
    // detector and fails closed unless a span binds it, exactly as a title-case one does.
    const t = tokenizeText(`Move $5,000 for ${RAW.email}, ssn ${RAW.ssn}, call ${RAW.phone}`);
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
  it("refuses the reserved slot_0000 id", () => {
    expect(parseMaskedLlmRequest({ ...good(), slots: [{ slotId: "slot_0000", slotType: "subject" }] }).ok).toBe(false);
  });
});

describe("the evidence-to-LLM projection scrubs at the boundary", () => {
  it("refuses an unclassified leading title-case token", () => {
    expect(projectForLlm({
      purpose: "intent-shaping",
      requestText: "Alice requested a transfer",
      slots: [],
      evidence: {},
    }).ok).toBe(false);
  });
  it("refuses an unclassified multi-token leading name", () => {
    expect(projectForLlm({
      purpose: "intent-shaping",
      requestText: "Alice Morgan requested a transfer",
      slots: [],
      evidence: {},
    }).ok).toBe(false);
  });
  it("masks a leading identity only when its exact span binds a declared slot", () => {
    const requestText = "Alice requested a transfer";
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText,
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      identitySpans: [identitySpan(requestText, "Alice")],
      evidence: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe("{{slot_0001}} requested a transfer");
    }
  });
  it("keeps an exact trusted static-template span visible", () => {
    const template = trustedStaticProjectionText("review-transaction-request");
    const result = projectForLlm({
      purpose: "intent-shaping",
      ...template,
      slots: [],
      evidence: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe(template.requestText);
    }
  });
  it("refuses forged and stale trusted safe-text spans", () => {
    const template = trustedStaticProjectionText("review-transaction-request");
    expect(projectForLlm({
      purpose: "intent-shaping",
      requestText: template.requestText,
      trustedSafeText: [{
        source: "static-template",
        sourceId: "review-transaction-request",
        text: "Review",
        start: 0,
        end: 6,
      }],
      slots: [],
      evidence: {},
    } as never).ok).toBe(false);
    expect(projectForLlm({
      purpose: "intent-shaping",
      requestText: `${template.requestText} today`,
      trustedSafeText: template.trustedSafeText,
      slots: [],
      evidence: {},
    }).ok).toBe(false);
  });
  it("accepts ordinary lowercase non-PII prose without metadata", () => {
    expect(projectForLlm({
      purpose: "intent-shaping",
      requestText: "please review the requested transfer",
      slots: [],
      evidence: {},
    }).ok).toBe(true);
  });

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
      requestText: `wire $12,000 from ${RAW.name}'s retirement account, reach her at ${RAW.email} / ${RAW.phone}`,
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
  it("masks a short name only as a complete occurrence", () => {
    const requestText = "Ann requested an annual review";
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText,
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      identitySpans: [identitySpan(requestText, "Ann")],
      evidence: { firstName: "Ann" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe("{{slot_0001}} requested an annual review");
    }
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
      identitySpans: [identitySpan("Alice wants account", "Alice")],
      evidence: { firstName: "Alice" },
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
      evidence: { firstName: "Alice" },
    });
    expect(result.ok).toBe(false);
  });
  it("refuses an account binding that leaves an unbound person name", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Wire 401 to Ira Bennett",
      slots: [{ slotId: SLOT_1, slotType: "account-ref" }],
      evidence: {},
    });
    expect(result.ok).toBe(false);
  });
  it("refuses masked evidence outside the plain-data shape", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Review Alice",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: { load: () => "raw record" },
    });
    expect(result.ok).toBe(false);
  });
  it.each([
    new Date("2026-01-01T00:00:00.000Z"),
    new Map([["status", "ready"]]),
    new (class ProjectionEvidence { readonly status = "ready"; })(),
  ])("refuses non-plain evidence before masking", (evidence) => {
    expect(projectForLlm({
      purpose: "intent-shaping",
      requestText: "please review the request",
      slots: [],
      evidence: { value: evidence },
    }).ok).toBe(false);
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
  it("accepts realistic non-fixture prose once its sensitive spans are tokenized", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "please transfer funds to the client's Roth",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: { requestKind: "withdrawal", plannedWithdrawals: 4200 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maskedText.value).toBe(
      "please transfer funds to the client's {{slot_0001}}",
    );
    expect(JSON.stringify(result.value.context.value)).toContain("4200");
  });
  it("resolution is a STRUCTURAL rule, not an enumerated vocabulary", () => {
    // Prose the closed word list refused; nothing here is on any allowlist.
    for (const resolved of [
      "please transfer funds to the client's {{slot_0001}}",
      "reconcile the quarterly custodial statement and note any variance",
      "escalate before the 2026 filing deadline",
    ]) {
      expect(hasUnresolvedProjectionText(resolved), resolved).toBe(false);
    }
    // Structurally sensitive spans stay unresolved whatever surrounds them.
    for (const unresolved of [
      "call Adaeze Okonkwo-Blackwood today",
      "wire to account 941000517334",
      "ping zeph.okonkwo@example.test",
      "ssn 078-05-1120 on file",
      "escalate to Compliance", // shape, not a name dictionary
    ]) {
      expect(hasUnresolvedProjectionText(unresolved), unresolved).toBe(true);
    }
    // Evidence is machine data: a bound placeholder key and plain business data
    // resolve; any surviving title-case key or sensitive-length number does not.
    expect(hasUnresolvedProjectionEvidence({
      "{{slot_0001}}": REDACTED,
      plannedWithdrawals: 4200,
      requestKind: "withdrawal",
    })).toBe(false);
    expect(hasUnresolvedProjectionEvidence({ Bennett: REDACTED })).toBe(true);
    expect(hasUnresolvedProjectionEvidence({ reference: 941000517334 })).toBe(true);
  });
  it("refuses a leading name without exact identity metadata", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Alice uses account",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: {},
    });
    expect(result.ok).toBe(false);
    expect(hasUnresolvedProjectionText("Alice uses account")).toBe(true);
    const bound = projectForLlm({
      purpose: "intent-shaping",
      requestText: "Alice uses account",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      identitySpans: [identitySpan("Alice uses account", "Alice")],
      evidence: { firstName: "Alice" },
    });
    expect(bound.ok).toBe(true);
    if (bound.ok) expect(bound.value.maskedText.value).toBe("{{slot_0001}} uses account");
  });
  it("binds an exact multi-word leading identity span whole", () => {
    const requestText = `${RAW.name} wants to open an account`;
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText,
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      identitySpans: [identitySpan(requestText, RAW.name)],
      evidence: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maskedText.value).toBe("{{slot_0001}} wants to open an account");
    expect(result.value.maskedText.value).not.toContain("Adaeze");
    expect(result.value.maskedText.value).not.toContain("Okonkwo");
  });
  it("an account-ref candidate is EXACTLY what the residual check refuses (9-18 digits)", () => {
    // Ordinary numbers are not account references: no slot is required, and the
    // caller does not have to re-run the extractor to guess how many to declare.
    const year = projectForLlm({
      purpose: "intent-shaping",
      requestText: "escalate before the 2026 filing deadline",
      slots: [],
      evidence: { requestKind: "escalation", plannedWithdrawals: 4200 },
    });
    expect(year.ok).toBe(true);
    if (year.ok) {
      expect(year.value.maskedText.value).toBe("escalate before the 2026 filing deadline");
    }
    // A 9-18 digit run with no declared account-ref slot is still refused.
    const account = projectForLlm({
      purpose: "intent-shaping",
      requestText: "wire to 941000517334 today",
      slots: [],
      evidence: {},
    });
    expect(account.ok).toBe(false);
    // ...and IS satisfiable once the caller declares the slot the residual check
    // demands — even alongside a redacted phone, which needs no slot of its own.
    const bound = projectForLlm({
      purpose: "intent-shaping",
      requestText: `wire to 941000517334 today, reach the desk at ${RAW.phone}`,
      slots: [{ slotId: SLOT_1, slotType: "account-ref" }],
      evidence: {},
    });
    expect(bound.ok).toBe(true);
    if (bound.ok) {
      expect(bound.value.maskedText.value).toContain("{{slot_0001}}");
      expect(bound.value.maskedText.value).not.toContain("941000517334");
      expect(bound.value.maskedText.value).toContain(REDACTED);
    }
  });
  it("extracts account candidates on the SAME basis the residual check reads", () => {
    // Masking a name inserts slot digits that break the labeled-SSN pattern's
    // label-to-digits window, so a run redaction removed BEFORE masking can
    // survive AFTER it. Extracting from the raw text therefore produced a
    // refusal with nothing to declare: zero candidates, one refusing digit run.
    const unsatisfiable = projectForLlm({
      purpose: "intent-shaping",
      requestText: "ssn Bob 123456789",
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      evidence: {},
    });
    expect(unsatisfiable.ok).toBe(false);
    const satisfied = projectForLlm({
      purpose: "intent-shaping",
      requestText: "ssn Bob 123456789",
      slots: [
        { slotId: SLOT_1, slotType: "subject" },
        { slotId: SLOT_2, slotType: "account-ref" },
      ],
      evidence: {},
    });
    expect(satisfied.ok).toBe(true);
    if (satisfied.ok) {
      expect(satisfied.value.maskedText.value).not.toContain("Bob");
      expect(satisfied.value.maskedText.value).not.toContain("123456789");
    }
  });
  it("masks resolved entity values retained in evidence keys", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "please review Alice",
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
      requestText: `please review ${RAW.name}`,
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
      requestText: "review account 941000517334",
      slots: [{ slotId: SLOT_1, slotType: "account-ref" }],
      evidence: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe("review account {{slot_0001}}");
    }
  });
});

/**
 * ALL-CAPS person shapes. A capital-then-lowercase test structurally cannot see
 * them, so before this every detector on the path (the candidate walk, the masker,
 * the residual check, and the adapter ingress gate) was blind to "SMITH, JOHN" -
 * an ordinary CRM rendering - and projectForLlm would seal the raw name into a
 * Tokenized value carrying piiFree: true. They resolve through the SAME
 * span-specific provenance contract as title-case names: bound to a slot and
 * masked, or refused. There is no acronym allowlist and no caller-supplied
 * "this is safe" flag.
 */
describe("all-caps person shapes fail closed without span provenance", () => {
  for (const requestText of [
    "ALICE SMITH requested a wire transfer",
    "SMITH, JOHN requested a wire transfer",
    "please contact SMITH about the transfer",
    "ALICE Smith requested a wire transfer",
    "Alice SMITH requested a wire transfer",
  ]) {
    it(`refuses ${JSON.stringify(requestText)} when no slot binds the span`, () => {
      const result = projectForLlm({
        purpose: "intent-shaping",
        requestText,
        slots: [],
        evidence: {},
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("PII_VIOLATION");
      // The refusal must not quote what it refused.
      expect(result.error.message).not.toContain("SMITH");
      expect(result.error.message).not.toContain("ALICE");
    });
  }

  it("refuses a leading all-caps surname the way it refuses a leading title-case one", () => {
    for (const requestText of ["SMITH requested a transfer", "Smith requested a transfer"]) {
      expect(projectForLlm({
        purpose: "intent-shaping",
        requestText,
        slots: [],
        evidence: {},
      }).ok).toBe(false);
    }
  });

  it("refuses an all-caps name carried only in evidence", () => {
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "review the request",
      slots: [],
      evidence: { note: "ALICE SMITH requested a wire transfer" },
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an all-caps run bound to a span the projection does not actually mask", () => {
    // A span whose bounds do not match the run leaves the name visible; the
    // resolver refuses rather than emitting a partially masked request.
    const requestText = "ALICE SMITH requested a wire transfer";
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText,
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      identitySpans: [{ slotId: SLOT_1, start: 0, end: 5 }],
      evidence: {},
    });
    expect(result.ok).toBe(false);
  });

  it("PASSES an all-caps name whose exact span is bound to a slot and masked", () => {
    const requestText = "ALICE SMITH requested a wire transfer";
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText,
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      identitySpans: [identitySpan(requestText, "ALICE SMITH")],
      evidence: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maskedText.value).toBe("{{slot_0001}} requested a wire transfer");
    expect(result.value.maskedText.value).not.toContain("ALICE");
    expect(result.value.maskedText.value).not.toContain("SMITH");
  });

  it("PASSES a single all-caps surname whose exact span is bound and masked", () => {
    const requestText = "SMITH requested a wire transfer";
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText,
      slots: [{ slotId: SLOT_1, slotType: "subject" }],
      identitySpans: [identitySpan(requestText, "SMITH")],
      evidence: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maskedText.value).toBe("{{slot_0001}} requested a wire transfer");
    }
  });

  it("PASSES safe machine-token lookalikes: the redaction sentinel and slot placeholders", () => {
    // Both are all-caps-shaped and both are the scrubber's OWN output, so the
    // detector must not refuse the very text it just made safe.
    expect(hasUnresolvedProjectionText(`${REDACTED} requested a wire transfer`)).toBe(false);
    expect(hasUnresolvedProjectionText("{{slot_0001}} requested a wire transfer")).toBe(false);
    expect(hasUnresolvedProjectionEvidence({ note: `${REDACTED} / {{slot_0001}}` })).toBe(false);
    const t = tokenizeText(`${REDACTED} requested a wire transfer`);
    expect(t.piiFree).toBe(true);
  });

  it("PASSES ordinary lowercase prose (the widened shape adds no false positive)", () => {
    expect(hasUnresolvedProjectionText("review the requested transfer for 2024")).toBe(false);
    const result = projectForLlm({
      purpose: "intent-shaping",
      requestText: "review the requested transfer",
      slots: [],
      evidence: { plannedWithdrawals: 12000 },
    });
    expect(result.ok).toBe(true);
  });

  it("PASSES a trusted static-template token that stays visible", () => {
    const trusted = trustedStaticProjectionText("review-transaction-request");
    expect(hasUnresolvedProjectionText(trusted.requestText, trusted.trustedSafeText)).toBe(false);
  });

  it("refuses an all-caps run the residual check sees after projection", () => {
    expect(hasUnresolvedProjectionText("ALICE SMITH requested a wire transfer")).toBe(true);
    expect(hasUnresolvedProjectionText("SMITH, JOHN")).toBe(true);
    expect(hasUnresolvedProjectionText("{{slot_0001}} sends to SMITH")).toBe(true);
    expect(hasUnresolvedProjectionEvidence({ note: "SMITH" })).toBe(true);
    expect(hasUnresolvedProjectionEvidence({ SMITH: "requested" })).toBe(true);
  });

  it("refuses a name a CALLER-SUPPLIED redaction sentinel is hiding behind", () => {
    // Neutralizing the sentinel by blanking it to WHITESPACE also erased the
    // "something precedes this" signal the embedded-name check reads, so a name
    // sitting directly after a sentinel the caller typed itself sealed as piiFree
    // with the raw name intact - while the identical "wire to Alice" was refused.
    // The stand-in has to be content without being a word.
    for (const text of [
      `${REDACTED} Alice`,
      `${REDACTED}Alice`,
      `${REDACTED} SMITH`,
      `${REDACTED}SMITH`,
      `${REDACTED} sends to ${REDACTED} Alice`,
    ]) {
      expect(hasUnresolvedProjectionText(text), text).toBe(true);
      expect(() => tokenizeText(text), text).toThrow(/PII_VIOLATION/);
    }
    // ...and the scrubber's own output still passes: the sentinel alone, and a
    // sentinel followed by ordinary lowercase prose.
    expect(hasUnresolvedProjectionText(REDACTED)).toBe(false);
    expect(hasUnresolvedProjectionText(`${REDACTED} requested a transfer`)).toBe(false);
    expect(tokenizeText(`${REDACTED} requested a transfer`).piiFree).toBe(true);
  });
});
