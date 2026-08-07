import { describe, it, expect } from "vitest";
import { PRIMITIVE_SET_VERSION } from "@contracts/primitives/catalog";
import { loadPolicy, type PolicyLoadIssue } from "@domain/policy/load";
import {
  firmAPolicyDocument,
  firmBPolicyDocument,
  worldRegistries,
} from "../helpers/policy-world";

/**
 * Load-time gate tests (v3 prompt 9 required list): unknown operators and
 * paths rejected at load, injection inert, effect conflicts rejected by the
 * conservative prover (the §3.4 worked examples verbatim), stratification,
 * self-conflict, and the OQ rulings (reviewTemplateId, elapsed reservation,
 * day-or-finer freshness windows).
 */

const registries = worldRegistries();

const policyWith = (rules: readonly unknown[]): Record<string, unknown> => ({
  schemaVersion: "1.0.0",
  primitiveSetVersion: PRIMITIVE_SET_VERSION,
  rules,
});

const codesOf = (issues: readonly PolicyLoadIssue[]): string[] =>
  [...new Set(issues.map((issue) => issue.code))].sort();

const expectIssues = (document: Record<string, unknown>, ...codes: string[]): PolicyLoadIssue[] => {
  const loaded = loadPolicy(document, registries);
  expect(loaded.ok).toBe(false);
  if (loaded.ok) throw new Error("unreachable");
  for (const code of codes) {
    expect(codesOf(loaded.error), loaded.error.map((issue) => issue.message).join("\n")).toContain(code);
  }
  return [...loaded.error];
};

const setHorizon = (value: unknown) => ({
  kind: "set_parameter",
  primitiveId: "horizon-projection",
  parameter: "horizonMonths",
  value,
});

const constant = (value: unknown) => ({ kind: "constant", value });
const amountGt = (threshold: number) => ({
  op: "compare",
  comparator: "gt",
  left: { kind: "context", key: "intent.amount" },
  right: constant(threshold),
});
const amountLte = (threshold: number) => ({
  op: "compare",
  comparator: "lte",
  left: { kind: "context", key: "intent.amount" },
  right: constant(threshold),
});

describe("loadPolicy - grammar and closure", () => {
  it("loads both ratified firm policies and classifies phases", () => {
    for (const document of [firmAPolicyDocument(), firmBPolicyDocument()]) {
      const loaded = loadPolicy(document, registries);
      expect(loaded.ok, loaded.ok ? "" : loaded.error.map((issue) => issue.message).join("\n")).toBe(true);
      if (!loaded.ok) throw new Error("unreachable");
      const phases = new Map<string, string>(
        loaded.value.rules.map((rule) => [rule.id as string, rule.phase]),
      );
      expect(phases.get("rule-reserve-horizon")).toBe("configuration");
      // Reads sufficiency.* (primitive-published) -> Phase 2.
      expect(phases.get("rule-reserve-breach")).toBe("evaluation");
      // Reads only intent context -> Phase 0 territory even without config effects.
      expect(phases.get("rule-reserve-evidence-freshness")).toBe("configuration");
    }
  });

  it("rejects an unknown grammar version and an unknown operator at load time", () => {
    expectIssues({ ...firmAPolicyDocument(), schemaVersion: "2.0.0" }, "unknown-grammar-version");
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "regex_match", value: constant("x"), pattern: ".*" },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "grammar-parse",
    );
  });

  it("rejects unknown effects, comparators, and duplicate rule ids as parse failures", () => {
    expectIssues(
      policyWith([
        { id: "r", when: { op: "all", nodes: [] }, effects: [{ kind: "execute_shell", command: "rm" }] },
      ]),
      "grammar-parse",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "compare", comparator: "like", left: constant(1), right: constant(1) },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "grammar-parse",
    );
    const duplicated = policyWith([
      { id: "r", when: { op: "all", nodes: [] }, effects: [{ kind: "prohibit", prohibitionCode: "a" }] },
      { id: "r", when: { op: "all", nodes: [] }, effects: [{ kind: "prohibit", prohibitionCode: "b" }] },
    ]);
    expectIssues(duplicated, "grammar-parse");
  });

  it("rejects unknown paths at load time - including prototype-chain injection paths", () => {
    for (const path of ["balance", "__proto__", "constructor.prototype", "toString"]) {
      expectIssues(
        policyWith([
          {
            id: "r",
            when: {
              op: "compare",
              comparator: "eq",
              left: { kind: "evidence", evidenceKind: "account-balance", path },
              right: constant(1),
            },
            effects: [{ kind: "prohibit", prohibitionCode: "never" }],
          },
        ]),
        "unknown-evidence-path",
      );
    }
  });

  it("keeps executable strings inert as constants and rejects them as paths", () => {
    // As a CONSTANT the string is data: the policy loads; nothing interprets it.
    const inert = loadPolicy(
      policyWith([
        {
          id: "r",
          when: {
            op: "compare",
            comparator: "eq",
            left: { kind: "context", key: "intent.destinationType" },
            right: constant("require('child_process').execSync('true')"),
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      registries,
    );
    expect(inert.ok).toBe(true);
    // As a PATH it is simply absent from the registry.
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "exists",
            value: {
              kind: "evidence",
              evidenceKind: "account-balance",
              path: "amountMinor'); DROP TABLE decisions;--",
            },
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "unknown-evidence-path",
    );
  });

  it("rejects every unknown reference with its own precise code", () => {
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "is_fresh", evidenceKind: "no-such-kind", maxAge: "P7D" },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "unknown-evidence-kind",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "exists",
            value: { kind: "household_instruction", instructionKind: "no-such", path: "rank" },
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "unknown-instruction-kind",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "exists", value: { kind: "context", key: "no.such.key" } },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "unknown-context-key",
    );
    expectIssues(
      policyWith([
        { id: "r", when: { op: "all", nodes: [] }, effects: [{ ...setHorizon(constant(6)), primitiveId: "no-such-primitive" }] },
      ]),
      "unknown-primitive",
    );
    expectIssues(
      policyWith([
        { id: "r", when: { op: "all", nodes: [] }, effects: [{ ...setHorizon(constant(6)), parameter: "noSuchParameter" }] },
      ]),
      "unknown-parameter",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "all", nodes: [] },
          effects: [
            { kind: "select_candidate", primitiveId: "candidate-selection", strategy: "coin-flip" },
          ],
        },
      ]),
      "unknown-strategy",
    );
    expectIssues(
      policyWith([
        { id: "r", when: { op: "all", nodes: [] }, effects: [{ kind: "require_approval", templateId: "no-such-template" }] },
      ]),
      "unknown-approval-template",
    );
  });

  it("enforces the OQ-2 reviewTemplateId contract in both directions plus template kind", () => {
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "all", nodes: [] },
          effects: [
            { kind: "require_evidence", evidenceKind: "funding-candidates", absence: "specialist_review" },
          ],
        },
      ]),
      "grammar-parse",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "all", nodes: [] },
          effects: [
            {
              kind: "require_evidence",
              evidenceKind: "funding-candidates",
              absence: "block",
              reviewTemplateId: "tmpl-bank-change-specialist",
            },
          ],
        },
      ]),
      "grammar-parse",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "all", nodes: [] },
          effects: [
            {
              kind: "require_evidence",
              evidenceKind: "funding-candidates",
              absence: "specialist_review",
              reviewTemplateId: "tmpl-ops-dual",
            },
          ],
        },
      ]),
      "template-kind-mismatch",
    );
  });

  it("refuses the reserved elapsed op under 1.1.0 and parses it nowhere under 1.0.0", () => {
    const elapsedRule = {
      id: "r",
      when: {
        op: "elapsed",
        value: { kind: "evidence", evidenceKind: "bank-instruction-change", path: "changedAt" },
        minimumAge: "P30D",
      },
      effects: [{ kind: "prohibit", prohibitionCode: "never" }],
    };
    expectIssues({ ...policyWith([elapsedRule]), schemaVersion: "1.1.0" }, "reserved-op-not-evaluable");
    expectIssues(policyWith([elapsedRule]), "grammar-parse");
  });

  it("refuses calendar-granular and fractional freshness windows", () => {
    for (const maxAge of ["P1M", "P1Y", "P0.5D"]) {
      expectIssues(
        policyWith([
          {
            id: "r",
            when: { op: "is_fresh", evidenceKind: "account-balance", maxAge },
            effects: [{ kind: "prohibit", prohibitionCode: "never" }],
          },
        ]),
        maxAge === "P0.5D" ? "grammar-parse" : "duration-granularity-unsupported",
      );
    }
  });

  it("type-checks comparisons: mismatch, unorderable, non-integer, in-set hygiene", () => {
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "compare", comparator: "eq", left: { kind: "context", key: "intent.amount" }, right: constant("a-string") },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "type-mismatch",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "compare",
            comparator: "gt",
            left: { kind: "context", key: "intent.destinationType" },
            right: constant("external"),
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "unorderable-comparison",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "compare", comparator: "gt", left: { kind: "context", key: "intent.amount" }, right: constant(0.25) },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "non-integer-number-constant",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "in",
            value: { kind: "context", key: "intent.destinationType" },
            set: [constant("external"), constant("external")],
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "duplicate-in-member",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "in",
            value: { kind: "context", key: "intent.destinationType" },
            set: [constant("external"), constant(7)],
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "type-mismatch",
    );
    // A plain `string` REFERENCE never widens into a temporal type: nothing
    // proves its bytes are canonical, so the lexicographic order the comparator
    // would run is not chronological. Only a string CONSTANT widens.
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "compare",
            comparator: "gt",
            left: { kind: "context", key: "intent.destinationType" },
            right: { kind: "evidence", evidenceKind: "bank-instruction-change", path: "changedAt" },
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "type-mismatch",
    );
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "in",
            value: { kind: "evidence", evidenceKind: "bank-instruction-change", path: "changedAt" },
            set: [constant("2026-13-45T99:88:77.000Z")],
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "type-mismatch",
    );
    // A structured published value may be existence-checked but never compared.
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "compare",
            comparator: "eq",
            left: { kind: "context", key: "projection.horizon" },
            right: constant("x"),
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      "non-comparable-value",
    );
  });

  it("still ACCEPTS a canonical string constant against a temporal reference", () => {
    const changedAt = {
      kind: "evidence",
      evidenceKind: "bank-instruction-change",
      path: "changedAt",
    };
    const loaded = loadPolicy(
      policyWith([
        {
          id: "compares",
          when: { op: "compare", comparator: "gt", left: changedAt, right: constant("2026-07-01T00:00:00.000Z") },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
        {
          id: "member-of",
          when: { op: "in", value: changedAt, set: [constant("2026-02-28T23:59:59.999Z")] },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ]),
      registries,
    );
    expect(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.error)).toBe(true);
  });

  it("rejects a primitive-set version mismatch and inadmissible parameter constants", () => {
    expectIssues(
      { ...firmAPolicyDocument(), primitiveSetVersion: "9.9.9" },
      "primitive-set-version-mismatch",
    );
    expectIssues(
      policyWith([{ id: "r", when: { op: "all", nodes: [] }, effects: [setHorizon(constant(-4))] }]),
      "parameter-constant-invalid",
    );
    expectIssues(
      policyWith([{ id: "r", when: { op: "all", nodes: [] }, effects: [setHorizon(constant("six"))] }]),
      "parameter-constant-invalid",
    );
  });
});

describe("loadPolicy - effect-conflict rejection (the §3.4 worked examples)", () => {
  it("ACCEPTS interval-disjoint writers of one parameter", () => {
    const loaded = loadPolicy(
      policyWith([
        { id: "low", when: amountLte(1_000_000), effects: [setHorizon(constant(6))] },
        { id: "high", when: amountGt(1_000_000), effects: [setHorizon(constant(12))] },
      ]),
      registries,
    );
    expect(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.error)).toBe(true);
  });

  it("ACCEPTS two unconditional writers of different targets", () => {
    const loaded = loadPolicy(
      policyWith([
        { id: "a", when: { op: "all", nodes: [] }, effects: [setHorizon(constant(6))] },
        {
          id: "b",
          when: { op: "all", nodes: [] },
          effects: [
            {
              kind: "set_parameter",
              primitiveId: "candidate-selection",
              parameter: "ambiguityQuestionCode",
              value: constant("which-account"),
            },
          ],
        },
      ]),
      registries,
    );
    expect(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.error)).toBe(true);
  });

  it("REJECTS plainly co-satisfiable writers, naming both rules and the target", () => {
    const issues = expectIssues(
      policyWith([
        { id: "by-amount", when: amountGt(1_000_000), effects: [setHorizon(constant(6))] },
        {
          id: "by-destination",
          when: {
            op: "compare",
            comparator: "eq",
            left: { kind: "context", key: "intent.destinationType" },
            right: constant("external"),
          },
          effects: [setHorizon(constant(12))],
        },
      ]),
      "effect-conflict",
    );
    const conflict = issues.find((issue) => issue.code === "effect-conflict")!;
    expect(conflict.message).toContain("by-amount");
    expect(conflict.message).toContain("by-destination");
    expect(conflict.message).toContain("horizon-projection");
  });

  it("REJECTS the vacuous double-write (two unconditional writers of one target)", () => {
    expectIssues(
      policyWith([
        { id: "a", when: { op: "all", nodes: [] }, effects: [setHorizon(constant(6))] },
        { id: "b", when: { op: "all", nodes: [] }, effects: [setHorizon(constant(12))] },
      ]),
      "effect-conflict",
    );
  });

  it("REJECTS conservatively when no shared variable carries a contradiction", () => {
    expectIssues(
      policyWith([
        {
          id: "by-freshness",
          when: { op: "is_fresh", evidenceKind: "account-balance", maxAge: "P30D" },
          effects: [setHorizon(constant(6))],
        },
        {
          id: "by-balance",
          when: {
            op: "compare",
            comparator: "gt",
            left: { kind: "evidence", evidenceKind: "account-balance", path: "amountMinor" },
            right: constant(10_000_000),
          },
          effects: [setHorizon(constant(12))],
        },
      ]),
      "effect-conflict",
    );
  });

  it("REJECTS overlapping select_candidate writers keyed on the primitive alone", () => {
    expectIssues(
      policyWith([
        {
          id: "a",
          when: amountGt(0),
          effects: [
            { kind: "select_candidate", primitiveId: "candidate-selection", strategy: "preference-order" },
          ],
        },
        {
          id: "b",
          when: amountGt(1_000_000),
          effects: [
            { kind: "select_candidate", primitiveId: "candidate-selection", strategy: "single-eligible" },
          ],
        },
      ]),
      "effect-conflict",
    );
  });

  it("ACCEPTS freshness-window writers whose intervals provably contradict", () => {
    const loaded = loadPolicy(
      policyWith([
        {
          id: "fresh",
          when: { op: "is_fresh", evidenceKind: "account-balance", maxAge: "P7D" },
          effects: [setHorizon(constant(6))],
        },
        {
          id: "stale",
          when: {
            op: "not",
            node: { op: "is_fresh", evidenceKind: "account-balance", maxAge: "P30D" },
          },
          effects: [setHorizon(constant(12))],
        },
      ]),
      registries,
    );
    expect(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.error)).toBe(true);
  });

  it("REJECTS a too-complex predicate on a conflicting target instead of passing silently", () => {
    const wide = (offset: number, count: number) => ({
      op: "any",
      nodes: Array.from({ length: count }, (_, index) => amountGt(offset + index)),
    });
    expectIssues(
      policyWith([
        {
          id: "complex",
          when: { op: "all", nodes: [wide(0, 9), wide(100, 9)] },
          effects: [setHorizon(constant(6))],
        },
        { id: "other", when: amountGt(5), effects: [setHorizon(constant(12))] },
      ]),
      "predicate-too-complex",
    );
  });
});

describe("loadPolicy - stratification and self-conflict", () => {
  it("REJECTS a configuration rule reading a primitive-published key (OQ-6 strict)", () => {
    expectIssues(
      policyWith([
        {
          id: "r",
          when: {
            op: "compare",
            comparator: "eq",
            left: { kind: "context", key: "sufficiency.satisfied" },
            right: constant(false),
          },
          effects: [setHorizon(constant(6))],
        },
      ]),
      "configuration-rule-reads-primitive-key",
    );
    // The same rule via the set_parameter VALUE node (resolves in Phase 0,
    // before any primitive has run).
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "all", nodes: [] },
          effects: [setHorizon({ kind: "context", key: "projection.total" })],
        },
      ]),
      "configuration-rule-reads-primitive-key",
    );
  });

  it("REJECTS one rule writing one target twice (check 7)", () => {
    expectIssues(
      policyWith([
        {
          id: "r",
          when: { op: "all", nodes: [] },
          effects: [setHorizon(constant(6)), setHorizon(constant(12))],
        },
      ]),
      "self-conflict",
    );
  });
});
