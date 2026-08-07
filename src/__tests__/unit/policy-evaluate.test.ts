import { describe, it, expect } from "vitest";
import { PRIMITIVE_SET_VERSION } from "@contracts/primitives/catalog";
import { unwrap } from "@contracts/result";
import { loadPolicy, type LoadedPolicy } from "@domain/policy/load";
import { evaluatePolicy } from "@domain/policy/evaluate";
import { compareProhibitions } from "@domain/policy/trace";
import {
  canonicalDigest,
  firmAPolicyDocument,
  firmBPolicyDocument,
  worldFacts,
  worldInvocations,
  worldRegistries,
} from "../helpers/policy-world";

/**
 * Evaluator semantics against the ratified §3.8 compiled policies: the Firm
 * A/B walkthrough (approval by threshold, automatic by absence, specialist on
 * recent change, block on the same facts under Firm B, reserve breach with the
 * shortfall arithmetic in the published trace), fail-closed unevaluable rules,
 * the prohibition lattice, and the Phase-1 machinery (canonical dependency
 * order, collisions, duplicate invocations).
 */

const registries = worldRegistries();

const load = (document: Record<string, unknown>): LoadedPolicy =>
  unwrap(loadPolicy(document, registries)) as LoadedPolicy;

const firmA = load(firmAPolicyDocument());
const firmB = load(firmBPolicyDocument());

const evaluate = (
  policy: LoadedPolicy,
  facts = worldFacts(),
  invocations = worldInvocations(),
) => unwrap(evaluatePolicy(policy, { facts, invocations }, registries));

describe("evaluatePolicy - the Firm A / Firm B walkthrough", () => {
  it("GC-01 shape: $75k under Firm A proceeds pending dual approval", () => {
    const trace = evaluate(firmA);
    expect(trace.disposition).toEqual({
      kind: "proceed",
      authority: {
        mode: "approval",
        approvalTemplateIds: ["tmpl-ops-dual"],
        specialistTemplateIds: [],
      },
    });
    const horizon = trace.primitiveExecutions.find((e) => e.primitiveId === "horizon-projection")!;
    expect(horizon.published!["projection.total"]).toBe(4_800_000);
    const sufficiency = trace.primitiveExecutions.find((e) => e.primitiveId === "sufficiency-check")!;
    expect(sufficiency.published!["sufficiency.satisfied"]).toBe(true);
    expect(trace.parameterResolutions).toEqual([
      {
        primitiveId: "horizon-projection",
        parameter: "horizonMonths",
        value: 6,
        ruleId: "rule-reserve-horizon",
      },
    ]);
  });

  it("GC-02 shape: $75k under Firm B is automatic BY ABSENCE of fired effects", () => {
    const trace = evaluate(firmB);
    expect(trace.disposition).toEqual({
      kind: "proceed",
      authority: { mode: "automatic", approvalTemplateIds: [], specialistTemplateIds: [] },
    });
    const threshold = trace.ruleOutcomes.find((o) => o.ruleId === "rule-dual-approval-over-100k")!;
    expect(threshold.outcome).toBe("not-fired");
    // Firm B's 12-month horizon: same invocations, different published floor.
    const horizon = trace.primitiveExecutions.find((e) => e.primitiveId === "horizon-projection")!;
    expect(horizon.published!["projection.total"]).toBe(9_600_000);
  });

  it("GC-03 shape: a 4-day-old bank change under Firm A forces specialist review", () => {
    const trace = evaluate(firmA, worldFacts({ recentBankChange: true }));
    expect(trace.disposition.kind).toBe("proceed");
    if (trace.disposition.kind !== "proceed") throw new Error("unreachable");
    expect(trace.disposition.authority.mode).toBe("specialist_review");
    expect(trace.disposition.authority.specialistTemplateIds).toEqual(["tmpl-bank-change-specialist"]);
    expect(trace.disposition.authority.approvalTemplateIds).toEqual(["tmpl-ops-dual"]);
  });

  it("GC-04 shape: the SAME when-clause under Firm B blocks with resolving evidence", () => {
    const trace = evaluate(firmB, worldFacts({ recentBankChange: true }));
    expect(trace.disposition).toEqual({
      kind: "blocked",
      blockerCodes: ["bank-instruction-change-unverified"],
    });
    expect(trace.blockers).toEqual([
      {
        code: "bank-instruction-change-unverified",
        resolvingEvidenceKinds: ["bank-instruction-independent-verification"],
        ruleIds: ["rule-recent-bank-change-block"],
      },
    ]);
    // Supplying the verification evidence resolves it: the rule stops firing.
    const verified = evaluate(firmB, worldFacts({ recentBankChange: true, bankChangeVerified: true }));
    expect(verified.disposition.kind).toBe("proceed");
  });

  it("GC-05 shape: insufficient liquidity blocks with the shortfall in the trace", () => {
    const trace = evaluate(
      firmB,
      worldFacts(),
      worldInvocations({ grossMinor: 16_000_000, pendingClaimMinor: 2_000_000 }),
    );
    expect(trace.disposition).toEqual({ kind: "blocked", blockerCodes: ["cash-reserve-breach"] });
    const sufficiency = trace.primitiveExecutions.find((e) => e.primitiveId === "sufficiency-check")!;
    // $140k available - $75k draw - $96k floor = -$31k: the explainable arithmetic.
    expect(sufficiency.published!["sufficiency.shortfall"]).toBe(3_100_000);
    expect(sufficiency.published!["sufficiency.satisfied"]).toBe(false);
  });

  it("GC-11 shape: a sibling reservation claim flips the blocker code", () => {
    const trace = evaluate(
      firmB,
      worldFacts(),
      worldInvocations({ grossMinor: 16_000_000, pendingClaimMinor: 0, reservationClaimMinor: 7_500_000 }),
    );
    expect(trace.disposition).toEqual({
      kind: "blocked",
      blockerCodes: ["liquidity-reserved-by-sibling"],
    });
    const availability = trace.primitiveExecutions.find((e) => e.primitiveId === "net-availability")!;
    expect(availability.published!["availability.claims.reservation"]).toBe(7_500_000);
    expect(availability.published!["availability.net"]).toBe(8_500_000);
  });

  it("GC-09 shape: stale reserve evidence blocks through the freshness rule", () => {
    const trace = evaluate(firmA, worldFacts({ withdrawalsObservedAt: "2026-06-01T09:00:00.000Z" }));
    expect(trace.disposition).toEqual({ kind: "blocked", blockerCodes: ["reserve-evidence-stale"] });
  });

  it("select_candidate configures the selection strategy and the winner is published", () => {
    const trace = evaluate(firmA, worldFacts(), worldInvocations({ includeSelection: true }));
    expect(trace.strategyResolutions).toEqual([
      {
        primitiveId: "candidate-selection",
        strategy: "preference-order",
        ruleId: "rule-source-selection",
      },
    ]);
    const selection = trace.primitiveExecutions.find((e) => e.primitiveId === "candidate-selection")!;
    expect(selection.published!["selection.source-account.outcome"]).toBe("selected");
  });
});

describe("evaluatePolicy - determinism and canonical ordering", () => {
  it("same inputs produce byte-identical traces", () => {
    const first = canonicalDigest(evaluate(firmA));
    const second = canonicalDigest(evaluate(firmA));
    expect(first).toBe(second);
  });

  it("rule, invocation, and fact insertion order never change the trace bytes", () => {
    const document = firmAPolicyDocument();
    const reversed = {
      ...document,
      rules: [...(document["rules"] as unknown[])].reverse(),
    };
    const baseline = canonicalDigest(evaluate(firmA));
    expect(canonicalDigest(evaluate(load(reversed)))).toBe(baseline);
    expect(canonicalDigest(evaluate(firmA, worldFacts(), [...worldInvocations()].reverse()))).toBe(
      baseline,
    );
  });
});

describe("evaluatePolicy - fail-closed totality", () => {
  it("a rule reading missing evidence in a value position synthesizes a blocker", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "reads-missing",
          when: {
            op: "compare",
            comparator: "gt",
            left: { kind: "evidence", evidenceKind: "reservation", path: "amountMinor" },
            right: { kind: "constant", value: 0 },
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never-reached" }],
        },
      ],
    });
    const trace = unwrap(evaluatePolicy(policy, { facts: worldFacts(), invocations: [] }, registries));
    expect(trace.ruleOutcomes[0]!.outcome).toBe("unevaluable");
    expect(trace.disposition).toEqual({
      kind: "blocked",
      blockerCodes: ["rule-unevaluable:reads-missing"],
    });
    expect(trace.blockers[0]!.resolvingEvidenceKinds).toEqual(["reservation"]);
    // The prohibition did NOT fire - a restrictive rule is never silently
    // skipped, and a missing read never silently escalates either.
    expect(trace.prohibitions).toEqual([]);
  });

  it("an exists-guard makes the same absence a plain not-fired (optional behavior)", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "guarded",
          when: {
            op: "all",
            nodes: [
              {
                op: "exists",
                value: { kind: "evidence", evidenceKind: "reservation", path: "amountMinor" },
              },
              {
                op: "compare",
                comparator: "gt",
                left: { kind: "evidence", evidenceKind: "reservation", path: "amountMinor" },
                right: { kind: "constant", value: 0 },
              },
            ],
          },
          effects: [{ kind: "block", blockerCode: "reserved", resolvingEvidenceKinds: [] }],
        },
      ],
    });
    const trace = unwrap(evaluatePolicy(policy, { facts: worldFacts(), invocations: [] }, registries));
    expect(trace.ruleOutcomes[0]!.outcome).toBe("not-fired");
    expect(trace.disposition.kind).toBe("proceed");
  });

  it("require_evidence(block) blocks exactly when the kind is absent", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "needs-candidates",
          when: { op: "all", nodes: [] },
          effects: [
            { kind: "require_evidence", evidenceKind: "funding-candidates", absence: "block" },
          ],
        },
      ],
    });
    const absent = unwrap(evaluatePolicy(policy, { facts: worldFacts(), invocations: [] }, registries));
    expect(absent.disposition).toEqual({
      kind: "blocked",
      blockerCodes: ["evidence-required:funding-candidates"],
    });
    expect(absent.evidenceRequirements[0]!.outcome).toBe("absent");
  });

  it("require_evidence(specialist_review) escalates authority instead of blocking", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "needs-verification",
          when: { op: "all", nodes: [] },
          effects: [
            {
              kind: "require_evidence",
              evidenceKind: "bank-instruction-independent-verification",
              absence: "specialist_review",
              reviewTemplateId: "tmpl-bank-change-specialist",
            },
          ],
        },
      ],
    });
    const trace = unwrap(evaluatePolicy(policy, { facts: worldFacts(), invocations: [] }, registries));
    expect(trace.disposition).toEqual({
      kind: "proceed",
      authority: {
        mode: "specialist_review",
        approvalTemplateIds: [],
        specialistTemplateIds: ["tmpl-bank-change-specialist"],
      },
    });
  });

  it("prohibitions outrank blockers and the primary is code-lexicographic (OQ-5)", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "blocks",
          when: { op: "all", nodes: [] },
          effects: [{ kind: "block", blockerCode: "some-blocker", resolvingEvidenceKinds: [] }],
        },
        {
          id: "prohibits-b",
          when: { op: "all", nodes: [] },
          effects: [{ kind: "prohibit", prohibitionCode: "b-prohibition" }],
        },
        {
          id: "prohibits-a",
          when: { op: "all", nodes: [] },
          effects: [{ kind: "prohibit", prohibitionCode: "a-prohibition" }],
        },
      ],
    });
    const trace = unwrap(evaluatePolicy(policy, { facts: worldFacts(), invocations: [] }, registries));
    expect(trace.disposition).toEqual({
      kind: "prohibited",
      primaryProhibitionCode: "a-prohibition",
      primaryProhibitionSource: "firm_policy",
    });
    // Everything fired stays in the trace - the lattice picks, it never erases.
    expect(trace.prohibitions.map((p) => p.code)).toEqual(["a-prohibition", "b-prohibition"]);
    expect(trace.blockers.map((b) => b.code)).toEqual(["some-blocker"]);
  });
});

describe("primary-prohibition ranking (OQ-5)", () => {
  it("ranks regulatory over firm policy over household instruction, then by code", () => {
    const at = (source: "regulatory" | "firm_policy" | "household_instruction", code: string) => ({
      code,
      source,
      ruleIds: [],
    });
    expect(compareProhibitions(at("regulatory", "z"), at("firm_policy", "a"))).toBeLessThan(0);
    expect(compareProhibitions(at("firm_policy", "z"), at("household_instruction", "a"))).toBeLessThan(0);
    expect(compareProhibitions(at("firm_policy", "a"), at("firm_policy", "b"))).toBeLessThan(0);
    expect(compareProhibitions(at("firm_policy", "a"), at("firm_policy", "a"))).toBe(0);
  });
});

describe("evaluatePolicy - Phase 1 machinery", () => {
  it("orders primitives by dataflow: sufficiency runs after its producers", () => {
    const trace = evaluate(firmA);
    const sufficiency = trace.primitiveExecutions.find((e) => e.primitiveId === "sufficiency-check")!;
    expect(sufficiency.outcome).toBe("published");
    // Its inputs came from the other two primitives' published facts.
    expect(sufficiency.published!["sufficiency.headroom"]).toBe(5_700_000);
  });

  it("a missing producer makes the consumer unevaluable, then blocks dependent rules", () => {
    const withoutProducers = worldInvocations().filter(
      (invocation) => invocation.primitiveId === "sufficiency-check",
    );
    const trace = unwrap(
      evaluatePolicy(firmA, { facts: worldFacts(), invocations: withoutProducers }, registries),
    );
    const sufficiency = trace.primitiveExecutions.find((e) => e.primitiveId === "sufficiency-check")!;
    expect(sufficiency.outcome).toBe("unevaluable");
    // The reserve rules read sufficiency.satisfied and are now unevaluable ->
    // synthesized blockers, never a silent proceed.
    expect(trace.disposition.kind).toBe("blocked");
    if (trace.disposition.kind !== "blocked") throw new Error("unreachable");
    expect(trace.disposition.blockerCodes).toContain("rule-unevaluable:rule-reserve-breach");
  });

  it("refuses duplicate identical invocations and published-key collisions", () => {
    const base = worldInvocations();
    const duplicated = evaluatePolicy(
      firmA,
      { facts: worldFacts(), invocations: [...base, base[0]!] },
      registries,
    );
    expect(duplicated.ok).toBe(false);
    if (duplicated.ok) throw new Error("unreachable");
    expect(duplicated.error.code).toBe("duplicate-invocation");

    const colliding = evaluatePolicy(
      firmA,
      {
        facts: worldFacts(),
        invocations: [
          ...base,
          {
            ...base[0]!,
            parameters: {
              resourceEvidenceKind: "account-balance",
              claimEvidenceKinds: ["pending-activity"],
              subjectScope: "bound-subject",
            },
            evidence: {
              resource: { snapshotRef: { firmId: "firm-a", id: "snap-balance" }, amountMinor: 1 },
              claims: [],
            },
          },
        ],
      },
      registries,
    );
    expect(colliding.ok).toBe(false);
    if (colliding.ok) throw new Error("unreachable");
    expect(colliding.error.code).toBe("published-key-collision");
  });

  it("refuses an invocation naming a primitive outside the pinned catalog", () => {
    const refused = evaluatePolicy(
      firmA,
      {
        facts: worldFacts(),
        invocations: [{ primitiveId: "no-such-primitive", parameters: {}, evidence: {} }],
      },
      registries,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.error.code).toBe("unknown-primitive-invocation");
  });

  it("an inert executable-string constant compares as plain data", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "inert",
          when: {
            op: "compare",
            comparator: "eq",
            left: { kind: "context", key: "intent.destinationType" },
            right: { kind: "constant", value: "require('child_process').execSync('true')" },
          },
          effects: [{ kind: "prohibit", prohibitionCode: "never" }],
        },
      ],
    });
    const trace = unwrap(evaluatePolicy(policy, { facts: worldFacts(), invocations: [] }, registries));
    // The string never matches the fact and never executes anything.
    expect(trace.ruleOutcomes[0]!.outcome).toBe("not-fired");
    expect(trace.disposition.kind).toBe("proceed");
  });
});
