import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unwrap } from "@contracts/result";
import { policyAstSchemaFor } from "@contracts/decision-core/policy";
import { loadPolicy } from "@domain/policy/load";
import { evaluatePolicy, type PolicyPrimitiveInvocation } from "@domain/policy/evaluate";
import type { EvidenceFactSnapshot, PolicyEvaluationFacts } from "@domain/policy/facts";
import { canonicalDigest, worldRegistries } from "../helpers/policy-world";

/**
 * The AST migration fixture (v3 prompt 9 required test; ratified design §3.7):
 * a committed policy authored at grammar 1.0.0 must load to an IDENTICAL
 * canonical form and evaluate to an IDENTICAL trace under grammar 1.1.0 (the
 * additive minor that adds only the reserved `elapsed` op), hash-equal against
 * pinned digests. This is the template every future grammar bump re-proves.
 */

type Fixture = {
  readonly policy: Record<string, unknown>;
  readonly bundle: {
    readonly asOf: string;
    readonly intent: Readonly<Record<string, string | number | boolean | null>>;
    readonly evidence: Readonly<Record<string, EvidenceFactSnapshot>>;
    readonly invocations: readonly PolicyPrimitiveInvocation[];
  };
  readonly expectations: {
    readonly loadedCanonicalDigest: string;
    readonly traceCanonicalDigest: string;
  };
};

const FIXTURE_PATH = join(__dirname, "..", "..", "..", "fixtures", "policy", "migration-1.0.0.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const registries = worldRegistries();

const fixtureFacts = (): PolicyEvaluationFacts => ({
  asOf: fixture.bundle.asOf,
  evidence: new Map(Object.entries(fixture.bundle.evidence)),
  instructions: new Map(),
  intent: new Map(Object.entries(fixture.bundle.intent)),
});

/** Version-stamp-free canonical projections: what additive minors must preserve. */
const loadedProjection = (document: Record<string, unknown>) => {
  const loaded = unwrap(loadPolicy(document, registries));
  return { primitiveSetVersion: loaded.primitiveSetVersion, rules: loaded.rules };
};

const traceProjection = (document: Record<string, unknown>) => {
  const loaded = unwrap(loadPolicy(document, registries));
  const trace = unwrap(
    evaluatePolicy(
      loaded,
      { facts: fixtureFacts(), invocations: fixture.bundle.invocations },
      registries,
    ),
  );
  const rest: Record<string, unknown> = { ...trace };
  delete rest["grammarVersion"];
  return rest;
};

describe("policy AST migration fixture (grammar 1.0.0 -> 1.1.0)", () => {
  const asDeclared = fixture.policy;
  const under110 = { ...fixture.policy, schemaVersion: "1.1.0" };

  it("the 1.0.0 document parses under BOTH grammar schemas", () => {
    expect(policyAstSchemaFor("1.0.0").safeParse(asDeclared).success).toBe(true);
    expect(policyAstSchemaFor("1.1.0").safeParse(under110).success).toBe(true);
  });

  it("loads to an identical canonical form under both grammars, matching the pin", () => {
    const digest100 = canonicalDigest(loadedProjection(asDeclared));
    const digest110 = canonicalDigest(loadedProjection(under110));
    expect(digest110).toBe(digest100);
    expect(digest100).toBe(fixture.expectations.loadedCanonicalDigest);
  });

  it("evaluates the pinned bundle to an identical trace under both grammars, matching the pin", () => {
    const digest100 = canonicalDigest(traceProjection(asDeclared));
    const digest110 = canonicalDigest(traceProjection(under110));
    expect(digest110).toBe(digest100);
    expect(digest100).toBe(fixture.expectations.traceCanonicalDigest);
  });

  it("the pinned bundle exercises a real decision: dual approval on a satisfied reserve", () => {
    const trace = unwrap(
      evaluatePolicy(
        unwrap(loadPolicy(asDeclared, registries)),
        { facts: fixtureFacts(), invocations: fixture.bundle.invocations },
        registries,
      ),
    );
    expect(trace.disposition).toEqual({
      kind: "proceed",
      authority: {
        mode: "approval",
        approvalTemplateIds: ["tmpl-ops-dual"],
        specialistTemplateIds: [],
      },
    });
  });

  it("1.1.0 stays GRAMMAR-ONLY: a document using elapsed parses but never loads", () => {
    const usingElapsed = {
      ...under110,
      rules: [
        {
          id: "rule-uses-elapsed",
          when: {
            op: "elapsed",
            value: { kind: "evidence", evidenceKind: "planned-withdrawals", path: "monthlyAmountMinor" },
            minimumAge: "P30D",
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ],
    };
    expect(policyAstSchemaFor("1.1.0").safeParse(usingElapsed).success).toBe(true);
    const loaded = loadPolicy(usingElapsed, registries);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) throw new Error("unreachable");
    expect(loaded.error[0]!.code).toBe("reserved-op-not-evaluable");
  });
});
