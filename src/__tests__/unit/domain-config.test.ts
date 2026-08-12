import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { bindDomainConfig, firmIdentityPaths, type FirmRegistry } from "@domain/config/bind";
import { canonicalConfigJson } from "@domain/config/document";
import { diffDomainConfigs, EMPTY_CONFIG_BASELINE } from "@domain/config/diff";
import { intakeFormOf } from "@domain/config/intake";
import {
  admitIntakeSubmission,
  optionalIntakeValue,
  requiredIntakeValue,
  unmappedIntakeFields,
} from "@domain/config/intake-view";
import { domainLabelsOf } from "@domain/config/labels";
import { loadDomainConfig, type LoadedDomainConfig } from "@domain/config/load";
import { compileFlowDefinition, EXECUTION_SCOPE_KEY, INITIATING_ACTOR_KEY } from "@domain/config/plan-compiler";
import { RESERVED_TRIGGER_FIELDS } from "@domain/config/vocabulary";
import { policyRegistriesFor } from "@domain/config/registries";
import {
  bucketOf,
  renderKeySegments,
  renderTemplate,
  templateIsInert,
  type KeySegment,
} from "@domain/config/segments";

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

  it("enforces: the diff reads CANONICAL bytes, so authoring key order is not a change", () => {
    const document = loadedOf("money-movement").document as unknown as Mutable;
    // The same sections, authored in a different key order at every depth: a
    // parent reserialized by the persisted registry and an author-ordered
    // candidate are the SAME document, and a diff that said otherwise would force
    // an author to declare changes that did not happen.
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value !== null && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>)
                .reverse()
                .map(([key, entry]) => [key, reverseKeys(entry)]),
            )
          : value;
    const reordered = reverseKeys(document) as Mutable;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(document));
    expect(diffDomainConfigs(document, reordered)).toEqual([]);
    expect(diffDomainConfigs(document, { ...document, blockers: [] }).map((entry) => entry.section)).toEqual([
      "blockers",
    ]);
  });

  it("enforces: account opening compiles to the five-step plan the shipped flow runs", () => {
    const compiled = compileFlowDefinition(loadedOf("account-opening"), "open-account");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.definition.id).toBe("account-opening");
    expect(compiled.value.definition.steps.map((step) => step.id)).toEqual([
      "household",
      "contact",
      "application",
      "esign",
      "finalize",
    ]);
  });

  it("enforces: the awaited rule is emitted PER compiled step, not scanned in document order", () => {
    const compiled = compileFlowDefinition(loadedOf("account-opening"), "open-account");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    // The engine advances the cursor past the suspending step before persisting,
    // so a replay reads `awaitingByStep[cursor - 1]`. Only the e-sign step awaits.
    expect(compiled.value.awaitingByStep).toEqual([
      undefined,
      undefined,
      undefined,
      "esign-signature",
      undefined,
    ]);
    expect(compiled.value.awaitingByStep).toHaveLength(compiled.value.definition.steps.length);
  });

  it("REFUSES a plan template with no runnable order instead of compiling a partial plan", () => {
    const document = documentOf("account-opening");
    const execution = document["execution"] as Mutable;
    const template = (execution["planTemplates"] as Mutable[])[0]!;
    // Two steps waiting on each other: no step ever becomes ready.
    template["steps"] = [
      { id: "household", capability: "household-create", dependsOn: ["contact"] },
      { id: "contact", capability: "contact-create", dependsOn: ["household"] },
    ];
    const loaded = loadDomainConfig(document);
    // The loader's acyclicity check refuses this document outright, which is why
    // the compiler's own refusal is the backstop rather than the only guard.
    expect(loaded.ok).toBe(false);
    const compiled = compileFlowDefinition(
      { ...loadedOf("account-opening"), document: document as never },
      "open-account",
    );
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.error.message).toContain("no runnable order");
  });

  /**
   * THE EXACTLY-ONCE REGRESSION (charter #16). The finalize step's idempotency
   * key is the ONLY guard against a doubly-fired e-sign webhook opening a second
   * financial account and a second funding task: the house-CRM adapter derives
   * `account:`, `task:` and `complete:` sub-keys from it and persists those in
   * `crm_write_cache`. Its bytes are therefore pinned by something outside the
   * configuration - `createApplication` records `finalize:<applicationId>` in
   * `account_opening_applications.idempotency_key` - so a rendering that merely
   * "looks reasonable" is not good enough. This assertion is the one that would
   * have caught the escape-everywhere round silently re-keying finalize.
   */
  it("PINS the shipped finalize idempotency key to the bytes the application row records", async () => {
    const compiled = compileFlowDefinition(loadedOf("account-opening"), "open-account");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const finalize = compiled.value.definition.steps.at(-1)!;
    expect(finalize.id).toBe("finalize");
    const applicationId = "8b0f2a44-1c3e-4d55-9a77-2f1c9b0e4d21";
    const invoked: { key?: string } = {};
    await finalize.execute(
      {
        applicationId,
        householdId: "hh-1",
        accountType: "individual",
        [INITIATING_ACTOR_KEY]: "u1",
        signedAt: "2026-08-11T00:00:00.000Z",
      },
      {
        invoke: (command) => {
          invoked.key = command.idempotencyKey;
          return Promise.resolve({ applicationId });
        },
      },
      { orgId: "org" } as never,
    );
    // The pre-branch hand-coded flow passed `createApplication`'s minted key
    // through verbatim; these are those exact bytes.
    expect(invoked.key).toBe(`finalize:${applicationId}`);
    // ...and the sub-keys the finalize adapter derives from it. The integration
    // suite proves the same bytes against the ROW's recorded column and the
    // `crm_write_cache` entries, so this pin cannot drift from the store's mint.
    expect([`account:${invoked.key}`, `task:${invoked.key}`, `complete:${invoked.key}`]).toEqual([
      `account:finalize:${applicationId}`,
      `task:finalize:${applicationId}`,
      `complete:finalize:${applicationId}`,
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
    // The limits the API boundary enforces are the ones the document declares.
    expect(form.value.fields.map((field) => field.maxLength)).toEqual([200, 100, 100, 320, undefined]);
    // The journey's progress rail is the declared stations, in declared order.
    expect(form.value.surfaces.map((surface) => surface.label)).toEqual([
      "Client & account details",
      "Client e-signature",
      "Open account & finalize",
    ]);
  });

  it("enforces: the journey's live stations are the document's own, never an ordinal", () => {
    const form = intakeFormOf(loadedOf("account-opening"));
    expect(form.ok).toBe(true);
    if (!form.ok) return;
    const declared = form.value.surfaces.map((surface) => surface.id);
    // The screen looks its stations up by these ids, so both must BE declared
    // stations - a rail bound to position 0 and 1 would still "pass" here.
    expect(declared).toContain(form.value.stations.form);
    expect(declared).toContain(form.value.stations.awaiting);
    expect(form.value.stations.form).not.toBe(form.value.stations.awaiting);
  });

  describe("the intake boundary admits exactly what the configuration declares", () => {
    const form = (): ReturnType<typeof intakeFormOf> => intakeFormOf(loadedOf("account-opening"));
    const submit = (payload: Record<string, unknown>) => {
      const projected = form();
      if (!projected.ok) throw new Error("the account-opening intake form must project");
      return admitIntakeSubmission(projected.value, payload);
    };
    const VALID = {
      householdName: "Smith Family",
      firstName: "Ada",
      lastName: "Smith",
      email: "ada@example.com",
      accountType: "ira-roth",
    };

    it("admits the shipped payload and carries an absent optional field as null", () => {
      expect(submit(VALID)).toEqual({ ok: true, value: { ...VALID } });
      const withoutEmail = submit({ ...VALID, email: "" });
      expect(withoutEmail.ok && withoutEmail.value["email"]).toBeNull();
    });

    it("names an admitted field the shipped start input cannot carry, instead of dropping it", () => {
      const admitted = submit(VALID);
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;
      // The five shipped fields all land; a sixth configured slot would not, and
      // the route refuses it by name rather than losing it at a later step whose
      // predecessors have already committed (D-210).
      expect(unmappedIntakeFields(admitted.value, Object.keys(VALID))).toEqual([]);
      expect(
        unmappedIntakeFields({ ...admitted.value, advisorNote: "x", branchCode: null }, Object.keys(VALID)),
      ).toEqual(["advisorNote", "branchCode"]);
    });

    it("refuses a value longer than the slot's DECLARED maximum, at that exact length", () => {
      expect(submit({ ...VALID, householdName: "x".repeat(200) }).ok).toBe(true);
      const tooLong = submit({ ...VALID, householdName: "x".repeat(201) });
      expect(tooLong.ok).toBe(false);
      if (tooLong.ok) return;
      expect(tooLong.error.code).toBe("VALIDATION");
      expect(tooLong.error.message).toContain("200 characters");
    });

    it("accepts EVERY registration the document declares, and nothing else", () => {
      const projected = form();
      expect(projected.ok).toBe(true);
      if (!projected.ok) return;
      const declared = projected.value.fields.find((field) => field.field === "accountType")?.options ?? [];
      expect(declared).toHaveLength(7);
      for (const accountType of declared) {
        expect(submit({ ...VALID, accountType }).ok, accountType).toBe(true);
      }
      expect(submit({ ...VALID, accountType: "not-a-registration" }).ok).toBe(false);
    });

    it("refuses a blank or non-string value for a required slot", () => {
      for (const value of ["", "   ", 7, null]) {
        expect(submit({ ...VALID, firstName: value }).ok, JSON.stringify(value)).toBe(false);
      }
    });

    it("reads admitted values back by DECLARED field, refusing an undeclared one rather than defaulting", () => {
      const projected = form();
      const admitted = submit(VALID);
      expect(projected.ok && admitted.ok).toBe(true);
      if (!projected.ok || !admitted.ok) return;
      const declared = projected.value;
      const supplied = admitted.value;
      const householdName = requiredIntakeValue(declared, supplied, "householdName");
      expect(householdName.ok && householdName.value).toBe("Smith Family");
      // A trigger field the document no longer declares is a DEPLOYMENT defect,
      // reported as INTERNAL - never the empty string the boundary's own
      // required-field check just excluded, and never client-error noise.
      const renamed = requiredIntakeValue(declared, supplied, "household_name");
      expect(renamed.ok).toBe(false);
      if (renamed.ok) return;
      expect(renamed.error.code).toBe("INTERNAL");
      // An optional field is null when absent, and refused when UNDECLARED - the
      // two cases a `?? null` default cannot tell apart.
      const withoutEmail = submit({ ...VALID, email: "" });
      expect(withoutEmail.ok).toBe(true);
      if (!withoutEmail.ok) return;
      expect(optionalIntakeValue(declared, withoutEmail.value, "email")).toEqual({ ok: true, value: null });
      const undeclared = optionalIntakeValue(declared, withoutEmail.value, "emailAddress");
      expect(undeclared.ok).toBe(false);
      if (undeclared.ok) return;
      expect(undeclared.error.code).toBe("INTERNAL");
    });

    it("separates an undeclared field from a DECLARED one the submission left absent", () => {
      const projected = form();
      const admitted = submit({ ...VALID, email: "" });
      expect(projected.ok && admitted.ok).toBe(true);
      if (!projected.ok || !admitted.ok) return;
      // `email` IS declared, just optional and omitted. A caller that requires it
      // gets the friendly required-field 400 worded from the DECLARED label - the
      // same message an omitted required field produces - rather than the
      // misleading "this domain declares no ... field" a bare lookup returned.
      const absent = requiredIntakeValue(projected.value, admitted.value, "email");
      expect(absent.ok).toBe(false);
      if (absent.ok) return;
      expect(absent.error.code).toBe("VALIDATION");
      expect(absent.error.message).toBe("Email is required.");
    });

    it("refuses an inherited property name rather than handing back a prototype member", () => {
      const projected = form();
      const admitted = submit(VALID);
      expect(projected.ok && admitted.ok).toBe(true);
      if (!projected.ok || !admitted.ok) return;
      // `toString` is a valid camelCase trigger field, so a document could name
      // one; the admitted map is a plain literal, so an `in` check would walk
      // Object.prototype and return a FUNCTION through a Result<string|null>.
      for (const inherited of ["toString", "constructor", "valueOf"]) {
        const optional = optionalIntakeValue(projected.value, admitted.value, inherited);
        expect(optional.ok, inherited).toBe(false);
        const required = requiredIntakeValue(projected.value, admitted.value, inherited);
        expect(required.ok, inherited).toBe(false);
      }
    });

    it("treats an OPTIONAL field named after a prototype member as absent, not as inherited text", () => {
      const projected = form();
      expect(projected.ok).toBe(true);
      if (!projected.ok) return;
      // The submitted payload is a plain literal too, so reading it with a bare
      // index would resolve `toString` to Object.prototype's function - which is
      // not absent and not a string, so the boundary would answer "must be
      // supplied as text" for a field the requester was entitled to omit.
      const declared = {
        ...projected.value,
        fields: [...projected.value.fields, { field: "toString", label: "Trace", type: "text", required: false }],
      } as const;
      const admitted = admitIntakeSubmission(declared, VALID);
      expect(admitted.ok, admitted.ok ? "" : admitted.error.message).toBe(true);
      expect(admitted.ok && admitted.value["toString"]).toBeNull();
    });
  });

  it.each([
    ["a blank firm id", { firmId: "" }],
    ["a blank mapped execution-target id", { executionTargets: new Map([["house-crm", ""], ["esign", ""]]) }],
    ["a blank mapped role id", { roles: new Map([["operations", ""], ["advisor", ""]]) }],
  ])("binding stays TOTAL with %s: a typed refusal, never a throw", (_case, override) => {
    const bound = bindDomainConfig(loadedOf("account-opening"), {
      ...registryFor("firm-a"),
      ...(override as Partial<FirmRegistry>),
    });
    expect(bound.ok).toBe(false);
    if (bound.ok) return;
    expect(bound.error.every((error) => error.code === "firm-binding")).toBe(true);
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

  it("flags a policy write to a parameter reached only through Object.prototype", () => {
    rejects((document) => {
      const slot = section<Mutable>(document, "policy")["slots"] as Mutable[];
      (slot[0]!["settableParameters"] as Mutable[]).push({
        binding: "liquidity",
        parameter: "constructor",
        describes: "a name the primitive never declared",
      });
    }, "unknown-reference");
  });

  /**
   * Flow data has TWO writers. The slot side has refused a reserved name since
   * D-205; these are the same hazard through a capability's publication alias,
   * which the compiler merges into the very same namespace.
   */
  const publishesAs = (document: Mutable, alias: string): void => {
    const capabilities = section<Mutable>(document, "execution")["capabilities"] as Mutable[];
    (capabilities[0]!["publishes"] as Mutable[]).push({ output: "extraOutput", as: alias });
  };

  it("flags a publication alias that would overwrite the platform's execution scope", () => {
    rejects((document) => publishesAs(document, "executionScope"), "grammar", "account-opening");
  });

  it("flags a publication alias that would overwrite a slot's own submitted value", () => {
    rejects((document) => publishesAs(document, "householdName"), "grammar", "account-opening");
  });

  it("flags one publication alias claimed by two capabilities", () => {
    rejects((document) => publishesAs(document, "applicationId"), "grammar", "account-opening");
  });

  /**
   * The THIRD writer into flow data: the fields of the observation that closes an
   * awaited rule. The engine merges the webhook payload UNDER the stored flow
   * data, so a stored key of the same name wins silently - and the shipped
   * `signedAt` read is `optional`, so nothing would report the substitution. The
   * finalized account would take its open date from what the advisor typed.
   */
  it("flags a publication alias that would shadow an awaited observation's field", () => {
    rejects((document) => publishesAs(document, "signedAt"), "grammar", "account-opening");
  });

  it("flags a trigger field that would shadow an awaited observation's field", () => {
    rejects((document) => {
      const slots = section<Mutable[]>(document, "intents")[0]!["slots"] as Mutable[];
      slots.find((slot) => slot["id"] === "email")!["triggerField"] = "signedAt";
    }, "grammar", "account-opening");
  });

  const capabilityNamed = (document: Mutable, id: string): Mutable =>
    (section<Mutable>(document, "execution")["capabilities"] as Mutable[]).find(
      (entry) => entry["id"] === id,
    )!;

  /**
   * A source that EXISTS is not a source that is AVAILABLE. `contact-create` runs
   * second, so the `application` step has published nothing when its payload
   * resolves - and the household write has ALREADY committed by then, which is
   * the partial write a load-time refusal exists to prevent.
   */
  it("flags a payload sourcing a step the consuming step does not depend on", () => {
    rejects((document) => {
      (capabilityNamed(document, "contact-create")["payload"] as Mutable[]).push({
        kind: "value",
        field: "applicationId",
        source: { from: "step-output", step: "application", output: "id" },
        optional: false,
      });
    }, "unknown-reference", "account-opening");
  });

  it("admits a step output the consuming step TRANSITIVELY depends on", () => {
    // The same edit one direction the other way: `finalize` runs after `contact`,
    // so the rule is rejecting the unavailable reference rather than the arm.
    const document = clone(documentOf("account-opening"));
    (capabilityNamed(document, "application-finalize")["payload"] as Mutable[]).push({
      kind: "value",
      field: "contactId",
      source: { from: "step-output", step: "contact", output: "id" },
      optional: false,
    });
    const result = loadDomainConfig(document);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.error)).toBe(true);
  });

  it("flags an observation read by a step no externally-gated step precedes", () => {
    rejects((document) => {
      (capabilityNamed(document, "household-create")["payload"] as Mutable[]).push({
        kind: "value",
        field: "signedAt",
        source: { from: "await-observation", field: "signedAt" },
        optional: true,
      });
    }, "unknown-reference", "account-opening");
  });

  it("flags a conflict key reading a step output, which resolves before the plan runs", () => {
    rejects((document) => {
      const intents = section<Mutable[]>(document, "intents");
      (intents[0]!["conflictKeys"] as string[]).push("post-hoc-key");
      section<Mutable[]>(document, "conflictKeys").push({
        id: "post-hoc-key",
        describes: "would key coordination on a value no decision can have yet",
        segments: [
          { kind: "literal", value: "transfer" },
          { kind: "value", source: { from: "step-output", step: "instruct", output: "handleId" } },
        ],
      });
    }, "unknown-reference");
  });

  it("flags a form control over a slot the requester does not supply (stage 6)", () => {
    rejects((document) => {
      const intents = section<Mutable[]>(document, "intents");
      const slots = intents[0]!["slots"] as Mutable[];
      const supplied = slots.find((slot) => slot["resolution"] === "supplied-by-trigger")!;
      delete supplied["triggerField"];
      supplied["resolution"] = "derived";
    }, "incomplete", "account-opening");
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

  /**
   * THE LOAD-CLEAN-THEN-FAIL-MID-PLAN CLASS, closed for the last arm that had
   * it. A `{from: context}` source names a key the DECISION's context plane
   * publishes; the interim substrate resolves sources out of flow data, which
   * carries only transport fields, the platform's reserved keys and publication
   * aliases. Admitted, it would close cleanly here and fail at the step that
   * consumes it - after earlier steps have committed real records.
   */
  it("flags a value source reading the context plane the interim substrate has no way to resolve", () => {
    rejects((document) => {
      const keys = section<Mutable[]>(document, "conflictKeys");
      (keys[0]!["segments"] as Mutable[]).push({
        kind: "value",
        source: { from: "context", key: "availability.net" },
      });
    }, "unknown-reference");
  });

  it("flags COMMAND TEXT reading the context plane, which is rendered mid-plan the same way", () => {
    rejects((document) => {
      const copy = section<Mutable>(document, "presentation")["copy"] as Mutable & { commandText: Mutable };
      const key = Object.keys(copy.commandText)[0]!;
      copy.commandText[key] = "Fund the {context:amount} movement";
    }, "unknown-reference", "account-opening");
  });

  /**
   * A closed vocabulary nothing enforces is not closed. `$ref.kind` is checked
   * at LOAD, where the message names the offending kind - not at bind, where the
   * class silently drops out of the checklist a surface builds its registry from
   * and the failure lands on a live screen.
   */
  it("flags a deferred parameter reference whose kind is not in the closed vocabulary", () => {
    const badRefs = [
      { kind: "evidence-sources", class: "house-crm" },
      { kind: "evidenceSource", class: "house-crm" },
      { kind: "evidence-source" },
      "house-crm",
    ];
    for (const badRef of badRefs) {
      rejects((document) => {
        const bindings = section<Mutable[]>(document, "primitiveBindings");
        const owner = bindings.find((entry) => entry["id"] === "identity-reconciliation")!;
        (owner["parameters"] as Mutable)["sourcesToReconcile"] = [
          { $ref: badRef },
          { $ref: { kind: "evidence-source", class: "house-crm" } },
        ];
      }, "unknown-reference", "account-opening");
    }
    // The unmutated document still loads, so the four refusals above are the
    // check biting rather than the document being broken another way.
    expect(loadDomainConfig(clone(documentOf("account-opening"))).ok).toBe(true);
  });

  /**
   * REACHABILITY AND TYPE CHECKING MUST HAVE THE SAME SCOPE. A conflict key a
   * CAPABILITY names is live configuration (the no-dead-configuration rule says
   * so), so it owes the same segment type check a key the intent lists owes.
   * Scoping the check to the intent's own lists left the difference reachable
   * and unchecked.
   */
  it("flags a text slot inside a conflict key reachable only through a CAPABILITY", () => {
    rejects((document) => {
      const keys = section<Mutable[]>(document, "conflictKeys");
      keys.push({
        id: "capability-only-key",
        describes: "reachable from a capability, never listed on the intent",
        segments: [
          { kind: "literal", value: "movement" },
          { kind: "value", source: { from: "slot", slot: "purpose" } },
        ],
      });
      (capabilityNamed(document, "funds-transfer")["conflictKeys"] as string[]).push("capability-only-key");
    }, "type-mismatch");
  });

  it("flags a reservation reachable only through a CAPABILITY whose quantity is not integer-typed", () => {
    rejects((document) => {
      const reservations = section<Mutable[]>(document, "reservations");
      const model = clone(reservations[0]!);
      model["id"] = "capability-only-reservation";
      model["quantity"] = { from: "slot", slot: "purpose" };
      reservations.push(model);
      (capabilityNamed(document, "funds-transfer")["reservations"] as string[]).push(
        "capability-only-reservation",
      );
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

  it("flags two slots reading ONE transport field (a duplicate control id, not two values)", () => {
    rejects((document) => {
      const slots = section<Mutable[]>(document, "intents")[0]!["slots"] as Mutable[];
      slots[1]!["triggerField"] = slots[0]!["triggerField"];
    }, "grammar", "account-opening");
  });

  it("flags a slot reading a RESERVED platform key, which would fill it silently", () => {
    // The platform writes these into flow data after the caller's own values, so
    // this is the one slot mistake that would resolve to the wrong value rather
    // than to no value at all.
    for (const reserved of RESERVED_TRIGGER_FIELDS) {
      const document = clone(documentOf("account-opening"));
      const slots = section<Mutable[]>(document, "intents")[0]!["slots"] as Mutable[];
      const supplied = slots.find((slot) => slot["triggerField"] !== undefined)!;
      supplied["triggerField"] = reserved;
      const result = loadDomainConfig(document);
      expect(result.ok, `"${reserved}" must not load as a trigger field`).toBe(false);
    }
  });

  it("flags a DUPLICATE id in every identified top-level section, which would silently shadow", () => {
    // A duplicate does not fail on its own: the loader keys these sections by id,
    // so the later entry wins there while `find` keeps returning the earlier one -
    // which is how one `verification` id can load as "awaits nothing" and compile
    // as "awaits externally", suspending a step whose write already committed.
    const SECTIONS = [
      ["intents", []],
      ["evidence", []],
      ["primitiveBindings", []],
      ["policy", ["slots"]],
      ["instructionKinds", []],
      ["prohibitions", []],
      ["blockers", []],
      ["authority", ["templates"]],
      ["execution", ["capabilities"]],
      ["execution", ["planTemplates"]],
      ["conflictKeys", []],
      ["reservations", []],
      ["verification", []],
    ] as const;
    for (const [top, nested] of SECTIONS) {
      const document = clone(documentOf("money-movement"));
      let entries = section<unknown>(document, top) as Mutable[] | Mutable;
      for (const key of nested) entries = (entries as Mutable)[key] as Mutable[];
      const list = entries as Mutable[];
      expect(list.length, `money-movement must declare a ${top} entry to duplicate`).toBeGreaterThan(0);
      list.push(clone(list[0]!));
      const result = loadDomainConfig(document);
      const path = [top, ...nested].join(".");
      expect(result.ok, `a duplicate ${path} id must NOT load`).toBe(false);
      if (result.ok) continue;
      // Refused FOR the duplication, not incidentally by some other stage.
      expect(result.error.some((error) => error.message.includes("twice")), path).toBe(true);
    }
  });

  it("flags a form standing on a station the document does not declare", () => {
    rejects((document) => {
      const form = section<Mutable>(document, "presentation")["form"] as Mutable;
      form["surface"] = "no-such-station";
    }, "grammar", "account-opening");
    rejects((document) => {
      const form = section<Mutable>(document, "presentation")["form"] as Mutable;
      form["awaitingSurface"] = "no-such-station";
    }, "grammar", "account-opening");
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

  /**
   * A conflict key is what makes two individually valid operations contend when
   * they must, so the rendered bytes have to identify the segment tuple UNIQUELY.
   * A bare join did not: both subject slots of `bank-instruction-key` are read
   * straight from the caller's transport, so a colon inside one moved the segment
   * boundary and two unrelated subjects shared one coordination identity.
   */
  const renderTuple = (parts: readonly string[]): string => {
    const segments: KeySegment[] = parts.map((_, index) => ({
      kind: "value",
      source: { from: "context", key: `k${index}` },
    }));
    const rendered = renderKeySegments(
      segments,
      (source) =>
        source.from === "context"
          ? { kind: "value", value: parts[Number(source.key.slice(1))]! }
          : { kind: "absent" },
      "test",
    );
    if (!rendered.ok) throw new Error(`render failed: ${JSON.stringify(rendered.error)}`);
    return rendered.value;
  };

  it("flags the segment-boundary collision a bare join admitted", () => {
    expect(renderTuple(["h1:x", "d"])).not.toBe(renderTuple(["h1", "x:d"]));
    // Every value free of the separator and the escape byte renders exactly as
    // it did before, so no shipped key is re-keyed by the encoding.
    expect(renderTuple(["household", "3f2b-9c11"])).toBe("household:3f2b-9c11");
    expect(renderTuple(["liquidity", "smiths", "2026-08"])).toBe("liquidity:smiths:2026-08");
  });

  it("enforces (P-4): rendering a key is INJECTIVE over the resolved segment tuple", () => {
    const part = fc.string({ unit: fc.constantFrom("a", "b", ":", "\\"), maxLength: 5 });
    const tuple = fc.array(part, { minLength: 1, maxLength: 4 });
    fc.assert(
      fc.property(tuple, tuple, (left, right) => {
        const same = left.length === right.length && left.every((value, index) => value === right[index]);
        return same === (renderTuple(left) === renderTuple(right));
      }),
      { numRuns: 3000 },
    );
  });

  /**
   * CROSS-ARITY, stated on its own because it is the case a "pass the lone
   * segment through raw" encoding cannot satisfy: a one-segment value carrying
   * the separator would render exactly what the two-segment tuple around that
   * separator renders, and two capabilities whose keys share a namespace would
   * silently dedupe against each other. Escaping EVERY segment is what keeps the
   * arity recoverable from the bytes, which is why the shipped finalize key
   * composes `finalize` and the application id as two SEGMENTS rather than
   * carrying one pre-joined value.
   */
  it("enforces (P-4): no ONE-segment rendering can equal any MULTI-segment rendering", () => {
    const part = fc.string({ unit: fc.constantFrom("a", "b", ":", "\\"), maxLength: 6 });
    fc.assert(
      fc.property(part, fc.array(part, { minLength: 2, maxLength: 4 }), (single, many) =>
        renderTuple([single]) !== renderTuple(many),
      ),
      { numRuns: 3000 },
    );
    // The exact collision a raw pass-through would admit, spelled out.
    expect(renderTuple(["finalize:abc"])).not.toBe(renderTuple(["finalize", "abc"]));
    expect(renderTuple(["household:exec-1"])).not.toBe(renderTuple(["household", "exec-1"]));
    // A lone segment free of both bytes still renders exactly as it did before.
    expect(renderTuple(["3f2b-9c11"])).toBe("3f2b-9c11");
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
    const step = compiled.value.definition.steps[0]!;
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
