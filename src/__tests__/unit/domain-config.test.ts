import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { bindDomainConfig, firmIdentityPaths, type FirmRegistry } from "@domain/config/bind";
import { canonicalConfigJson } from "@domain/config/document";
import { diffDomainConfigs, EMPTY_CONFIG_BASELINE } from "@domain/config/diff";
import { intakeFormOf } from "@domain/config/intake";
import { domainLabelsOf } from "@domain/config/labels";
import { loadDomainConfig, type LoadedDomainConfig } from "@domain/config/load";
import { compileFlowDefinition, EXECUTION_SCOPE_KEY } from "@domain/config/plan-compiler";
import { policyRegistriesFor } from "@domain/config/registries";
import { bucketOf, renderTemplate, templateIsInert } from "@domain/config/segments";

/**
 * THE DOMAIN-CONFIGURATION ACCEPTANCE TESTS (v3 prompt 10; ADR-0056).
 *
 * The ratified acceptance criterion is "both domains parse and bind against the
 * same engine contracts". These tests prove that against the SHIPPED files, and
 * then prove the properties that make the claim mean something: binding differs
 * between two firms only by firmId (invariant 26 as a property, not a promise),
 * file order is inert, loading is total, and every load-time check REJECTS a
 * real violation of itself.
 */
const DOMAINS = ["account-opening", "money-movement"] as const;

type Mutable = Record<string, unknown>;

function documentOf(domain: string): Mutable {
  const text = readFileSync(`config/domains/${domain}.yaml`, "utf8");
  return parseDocument(text, { merge: false }).toJS() as Mutable;
}

function loadedOf(domain: string): LoadedDomainConfig {
  const result = loadDomainConfig(documentOf(domain));
  if (!result.ok) {
    throw new Error(`${domain} failed to load: ${JSON.stringify(result.error, null, 2)}`);
  }
  return result.value;
}

/** A firm registry that supplies every class either shipped document references. */
function registryFor(firmId: string): FirmRegistry {
  return {
    firmId,
    executionTargets: new Map([
      ["custodian-transfer", `${firmId}-custodian`],
      ["house-crm", `${firmId}-crm`],
      ["esign", `${firmId}-esign`],
    ]),
    evidenceSources: new Map([
      ["house-crm", `${firmId}-crm-source`],
      ["applicant-identity", `${firmId}-identity-source`],
    ]),
    approvalTemplates: new Map([
      ["ops-dual-approval", `${firmId}-ops-dual`],
      ["bank-change-specialist", `${firmId}-bank-specialist`],
      ["elevated-approval", `${firmId}-elevated`],
      ["new-account-review", `${firmId}-new-account-review`],
    ]),
    roles: new Map([
      ["operations", "operations"],
      ["advisor", "advisor"],
      ["bank-change-specialist", "bank-change-specialist"],
    ]),
  };
}

/** A JSON view of a binding, so two firms' results can be compared byte for byte. */
function boundProjection(domain: string, firmId: string): string {
  const bound = bindDomainConfig(loadedOf(domain), registryFor(firmId));
  if (!bound.ok) throw new Error(`${domain} failed to bind for ${firmId}: ${JSON.stringify(bound.error)}`);
  const value = bound.value;
  return JSON.stringify({
    firmId: value.firmId,
    versionRef: value.domainConfigVersionRef,
    executionTargets: [...value.executionTargets].sort(),
    verificationRules: [...value.verificationRules].sort(),
    approvalTemplates: [...value.approvalTemplates].sort(),
    reservations: [...value.reservations].sort(),
    evidenceSupplierRoles: [...value.evidenceSupplierRoles].sort(),
    boundParameters: [...value.boundParameters].sort(),
  });
}

/** Deep clone through JSON: the document is plain data by construction. */
function clone(value: Mutable): Mutable {
  return JSON.parse(JSON.stringify(value)) as Mutable;
}

function section<T>(document: Mutable, key: string): T {
  return document[key] as T;
}

describe("domain configuration: the shipped documents", () => {
  it.each(DOMAINS)("enforces: %s parses against the one engine schema", (domain) => {
    const loaded = loadedOf(domain);
    expect(loaded.domainConfigVersionId).toMatch(/^[a-z][a-z0-9-]*@\d{4}\.\d{2}\.\d+$/);
    expect(loaded.intents.size).toBeGreaterThan(0);
  });

  it("enforces: money movement loads to the version all sixteen signed fixtures pin", () => {
    expect(loadedOf("money-movement").domainConfigVersionId).toBe("money-movement@2026.07.0");
  });

  it.each(DOMAINS)("enforces: %s binds for a firm, and the document carries no firm identity", (domain) => {
    const loaded = loadedOf(domain);
    expect(firmIdentityPaths(loaded.document)).toEqual([]);
    const bound = bindDomainConfig(loaded, registryFor("firm-a"));
    expect(bound.ok, JSON.stringify(bound.ok ? [] : bound.error)).toBe(true);
  });

  it.each(DOMAINS)("enforces (P-1): binding %s for two firms differs ONLY by firmId", (domain) => {
    // Deliberately distinctive firm ids: substituting a firm id that also occurs
    // inside the document's OWN vocabulary would let a real divergence hide.
    const a = boundProjection(domain, "tenant-one");
    const b = boundProjection(domain, "tenant-two");
    expect(a).not.toEqual(b);
    expect(b.split("tenant-two").join("FIRM")).toEqual(a.split("tenant-one").join("FIRM"));
  });

  it.each(DOMAINS)("enforces (P-2): %s file order is inert - shuffling every list changes nothing", (domain) => {
    const original = loadedOf(domain);
    const shuffled = clone(documentOf(domain));
    for (const key of ["intents", "evidence", "primitiveBindings", "verification", "prohibitions", "blockers"]) {
      const list = section<unknown[]>(shuffled, key);
      if (Array.isArray(list)) list.reverse();
    }
    const reloaded = loadDomainConfig(shuffled);
    expect(reloaded.ok, JSON.stringify(reloaded.ok ? [] : reloaded.error)).toBe(true);
    if (!reloaded.ok) return;
    for (const [id, intent] of original.intents) {
      expect(reloaded.value.intents.get(id)?.bindingOrder).toEqual(intent.bindingOrder);
    }
  });

  it.each(DOMAINS)("enforces: %s serializes to stable canonical bytes", (domain) => {
    const first = canonicalConfigJson(loadedOf(domain).document);
    const second = canonicalConfigJson(loadedOf(domain).document);
    expect(first.ok && second.ok && first.value === second.value).toBe(true);
  });

  it.each(DOMAINS)("enforces: %s declares the change its own bytes show", (domain) => {
    const document = loadedOf(domain).document;
    const computed = diffDomainConfigs(EMPTY_CONFIG_BASELINE, document as unknown as Mutable);
    const declared = document.authorship.changeFromParent.map((entry) => `${entry.op}:${entry.section}`);
    expect([...declared].sort()).toEqual(computed.map((entry) => `${entry.op}:${entry.section}`).sort());
  });

  it("enforces: account opening compiles to the five-step plan the shipped flow runs", () => {
    const compiled = compileFlowDefinition(loadedOf("account-opening"), "open-account");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.id).toBe("account-opening");
    expect(compiled.value.steps.map((step) => step.id)).toEqual([
      "household",
      "contact",
      "application",
      "esign",
      "finalize",
    ]);
  });

  it("enforces: a decision-hash idempotency key is REFUSED by the interim substrate, never faked", () => {
    const compiled = compileFlowDefinition(loadedOf("money-movement"), "distribute-cash");
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.message).toContain("decision hash");
  });

  it("enforces: the intake form projects the trigger fields the shipped route validates", () => {
    const form = intakeFormOf(loadedOf("account-opening"));
    expect(form.ok).toBe(true);
    if (!form.ok) return;
    expect(form.value.fields.map((field) => field.field)).toEqual([
      "householdName",
      "firstName",
      "lastName",
      "email",
      "accountType",
    ]);
    expect(form.value.fields.find((field) => field.field === "accountType")?.options).toContain("ira-roth");
  });

  it("enforces: the label projection carries the configured demo vocabulary", () => {
    const bound = bindDomainConfig(loadedOf("money-movement"), registryFor("firm-a"));
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    const labels = domainLabelsOf(bound.value);
    expect(labels.firmId).toBe("firm-a");
    expect(labels.intents["distribute-cash"]).toBe("Move money");
    expect(labels.evidenceKinds["account-balance"]).toBe("Available cash across household accounts");
  });

  it("enforces: prompt 9's registries derive from the configuration, never by hand", () => {
    const registries = policyRegistriesFor(loadedOf("money-movement"), "distribute-cash");
    expect(registries.ok).toBe(true);
    if (!registries.ok) return;
    expect(registries.value.evidence.get("account-balance")?.paths.get("availableMinorUnits")?.valueType)
      .toBe("integer");
    expect(registries.value.contextKeys.get("availability.net")?.origin)
      .toEqual({ source: "primitive", primitiveId: "net-availability" });
    expect(registries.value.contextKeys.get("amount")?.origin).toEqual({ source: "intent" });
    expect(registries.value.approvalTemplates.get("bank-change-specialist")?.kind).toBe("specialist_review");
  });
});

describe("detects (companion): a configuration that is wrong in any of the seven stages CANNOT load", () => {
  const rejects = (mutate: (document: Mutable) => void, code: string, domain = "money-movement"): void => {
    const document = clone(documentOf(domain));
    mutate(document);
    const result = loadDomainConfig(document);
    expect(result.ok, "the mutated document must NOT load").toBe(false);
    if (result.ok) return;
    expect(result.error.map((error) => error.code)).toContain(code);
  };

  it("flags a document that is not a plain data record", () => {
    for (const input of [null, undefined, "text", 42, [], new Map()]) {
      const result = loadDomainConfig(input);
      expect(result.ok).toBe(false);
    }
  });

  it("flags an unknown key (stage 2: strict grammar)", () => {
    rejects((document) => {
      document["unexpected"] = true;
    }, "grammar");
  });

  it("flags an unknown primitive (stage 3: reference closure)", () => {
    rejects((document) => {
      section<Mutable[]>(document, "primitiveBindings")[0]!["primitiveId"] = "no-such-primitive";
    }, "unknown-reference");
  });

  it("flags a strategy the primitive does not admit", () => {
    rejects((document) => {
      const bindings = section<Mutable[]>(document, "primitiveBindings");
      bindings.find((entry) => entry["id"] === "source-selection")!["defaultStrategy"] = "coin-flip";
    }, "unknown-reference");
  });

  it("flags an evidence kind no intent requires (stage 5: no dead configuration)", () => {
    rejects((document) => {
      const intents = section<Mutable[]>(document, "intents");
      const required = intents[0]!["requiresEvidence"] as string[];
      required.splice(required.indexOf("account-restriction"), 1);
    }, "incoherent");
  });

  it("flags a policy write to a KEY-SHAPING parameter (D-184)", () => {
    rejects((document) => {
      const slot = section<Mutable>(document, "policy")["slots"] as Mutable[];
      (slot[0]!["settableParameters"] as Mutable[]).push({
        binding: "liquidity",
        parameter: "claimEvidenceKinds",
        describes: "would republish the derived key space",
      });
    }, "incoherent");
  });

  it("flags a text slot used inside a conflict key (a coordination identity must be stable)", () => {
    rejects((document) => {
      const keys = section<Mutable[]>(document, "conflictKeys");
      (keys[0]!["segments"] as Mutable[]).push({ kind: "value", source: { from: "slot", slot: "purpose" } });
    }, "type-mismatch");
  });

  it("flags a bucket segment over a source that is not date-typed", () => {
    rejects((document) => {
      const keys = section<Mutable[]>(document, "conflictKeys");
      const segments = keys[0]!["segments"] as Mutable[];
      segments[segments.length - 1] = {
        kind: "bucket",
        source: { from: "slot", slot: "amount" },
        granularity: "month",
      };
    }, "type-mismatch");
  });

  it("flags an emittable code with no presentation copy (stage 6, forward direction)", () => {
    rejects((document) => {
      delete (section<Mutable>(document, "presentation")["copy"] as Mutable & { reasonCodes: Mutable })
        .reasonCodes["cash-reserve-breach"];
    }, "incomplete");
  });

  it("flags presentation copy for a code the domain cannot emit (stage 6, reverse direction)", () => {
    rejects((document) => {
      const copy = section<Mutable>(document, "presentation")["copy"] as Mutable & { reasonCodes: Mutable };
      copy.reasonCodes["invented-code"] = { title: "t", body: "b", resolution: "r" };
    }, "incomplete");
  });

  it("flags a copy template that is not inert", () => {
    rejects((document) => {
      const copy = section<Mutable>(document, "presentation")["copy"] as Mutable & { reasonCodes: Mutable };
      (copy.reasonCodes["cash-reserve-breach"] as Mutable)["body"] = "Moving ${process.env.SECRET}";
    }, "not-inert");
  });

  it("flags a copy placeholder naming something the domain does not publish", () => {
    rejects((document) => {
      const copy = section<Mutable>(document, "presentation")["copy"] as Mutable & { reasonCodes: Mutable };
      (copy.reasonCodes["cash-reserve-breach"] as Mutable)["body"] = "{slot:no-such-slot}";
    }, "unknown-reference");
  });

  it("flags a primitive-set version the loaded catalog does not supply (stage 7: identity)", () => {
    rejects((document) => {
      document["primitiveSetVersion"] = "9.9.9";
    }, "identity");
  });

  it("flags a change record its own bytes do not support (stage 7: authorship provenance)", () => {
    rejects((document) => {
      (document["authorship"] as Mutable & { changeFromParent: Mutable[] }).changeFromParent.push({
        op: "remove",
        section: "reservations",
        describes: "a change this version did not make",
      });
    }, "identity");
  });

  it("flags a required trigger-supplied slot the intake form cannot collect", () => {
    rejects((document) => {
      const form = section<Mutable>(document, "presentation")["form"] as Mutable & { fields: Mutable[] };
      form.fields = form.fields.filter((field) => field["slot"] !== "household-name");
    }, "incomplete", "account-opening");
  });

  it("flags a firm binding the firm does not supply", () => {
    const bound = bindDomainConfig(loadedOf("money-movement"), {
      ...registryFor("firm-a"),
      executionTargets: new Map(),
    });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.error.map((error) => error.code)).toContain("firm-binding");
  });

  it("flags a document that carries firm identity anywhere in its graph", () => {
    const loaded = loadedOf("money-movement");
    const poisoned = { ...loaded, document: { ...loaded.document, firmId: "firm-a" } } as LoadedDomainConfig;
    const bound = bindDomainConfig(poisoned, registryFor("firm-a"));
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.error.some((error) => error.message.includes("firm identity"))).toBe(true);
  });

  it("flags a prototype-shaped path as simply unknown, never as traversal", () => {
    const result = loadDomainConfig({ __proto__: { polluted: true }, formatVersion: "domain-config/1.0.0" });
    expect(result.ok).toBe(false);
    expect((globalThis as unknown as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("enforces (P-3): loading is TOTAL - fuzzed documents return a typed error, never a throw", () => {
    const base = documentOf("money-movement");
    const keys = Object.keys(base);
    for (let seed = 0; seed < keys.length * 3; seed += 1) {
      const fuzzed = clone(base);
      const key = keys[seed % keys.length]!;
      const mutation = seed % 3;
      if (mutation === 0) delete fuzzed[key];
      else if (mutation === 1) fuzzed[key] = null;
      else fuzzed[key] = { unexpected: "shape" };
      expect(() => loadDomainConfig(fuzzed)).not.toThrow();
    }
  });

  it("flags a non-canonical date in a bucket segment rather than truncating it", () => {
    expect(bucketOf("2026-08-01", "month")).toBe("2026-08");
    expect(bucketOf("2026-08-01T12:00:00.000Z", "month")).toBe("2026-08");
    expect(bucketOf("2026-8-1", "month")).toBeNull();
    expect(bucketOf("2026-08-01T12:00:00+02:00", "day")).toBeNull();
  });

  it("flags any interpolation that is not one of the two closed placeholder forms", () => {
    expect(templateIsInert("Fund the new {slot:registration-type} account")).toBe(true);
    expect(templateIsInert("Fund ${accountType}")).toBe(false);
    expect(templateIsInert("Fund {{accountType}}")).toBe(false);
    const rendered = renderTemplate(
      "Fund the new {slot:registration-type} account",
      { slot: () => "ira-roth", context: () => null },
      "test",
    );
    expect(rendered.ok && rendered.value).toBe("Fund the new ira-roth account");
  });

  it("flags a compiled step whose execution scope never resolved", async () => {
    const compiled = compileFlowDefinition(loadedOf("account-opening"), "open-account");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const step = compiled.value.steps[0]!;
    const result = await step.execute(
      { householdName: "Household" },
      { invoke: () => Promise.resolve({ id: "hh-1" }) },
      { orgId: "org" } as never,
    );
    expect(result.kind).toBe("fail");
    const withScope = await step.execute(
      { householdName: "Household", [EXECUTION_SCOPE_KEY]: "exec-1" },
      { invoke: () => Promise.resolve({ id: "hh-1" }) },
      { orgId: "org" } as never,
    );
    expect(withScope).toEqual({ kind: "continue", patch: { householdId: "hh-1" } });
  });
});
