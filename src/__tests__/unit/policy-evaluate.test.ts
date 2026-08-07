import { describe, it, expect } from "vitest";
import { PRIMITIVE_SET_VERSION } from "@contracts/primitives/catalog";
import { unwrap } from "@contracts/result";
import { loadPolicy, type LoadedPolicy } from "@domain/policy/load";
import { evaluatePolicy } from "@domain/policy/evaluate";
import { compareProhibitions } from "@domain/policy/trace";
import type { PolicyEvaluationFacts } from "@domain/policy/facts";
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
  it("an impossible instant refuses rather than parsing, landing the rule unevaluable", () => {
    // 2026 is not a leap year and February never has 31 days: the Timestamp
    // brand rejects these bytes, so the freshness read must too rather than
    // rolling over into some other instant's epoch value.
    const trace = evaluate(firmA, worldFacts({ withdrawalsObservedAt: "2026-02-31T09:00:00.000Z" }));
    expect(trace.disposition).toEqual({
      kind: "blocked",
      blockerCodes: ["rule-unevaluable:rule-reserve-evidence-freshness"],
    });
    const rule = trace.ruleOutcomes.find((o) => o.ruleId === "rule-reserve-evidence-freshness")!;
    expect(rule.outcome).toBe("unevaluable");
  });

  it("an observation dated AFTER asOf is unevaluable, never maximally fresh", () => {
    // A negative age satisfies every window, so a `not(is_fresh(...))` guard
    // would silently not fire on impossible-in-time data. Age is undefined
    // here, and the fail-closed answer is the blocker every content failure
    // gets - not the freshest possible reading.
    const trace = evaluate(firmA, worldFacts({ withdrawalsObservedAt: "2026-08-02T09:00:00.000Z" }));
    expect(trace.disposition).toEqual({
      kind: "blocked",
      blockerCodes: ["rule-unevaluable:rule-reserve-evidence-freshness"],
    });
    expect(trace.blockers[0]!.resolvingEvidenceKinds).toEqual(["planned-withdrawals"]);
    expect(
      trace.ruleOutcomes.find((o) => o.ruleId === "rule-reserve-evidence-freshness")!.missing,
    ).toEqual(["is_fresh:planned-withdrawals (observation after asOf)"]);
  });

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

describe("evaluatePolicy - a rejected policy-resolved parameter unwinds its rule ATOMICALLY", () => {
  // horizon-projection declares horizonMonths as 1..1200, so a rule that writes
  // an account balance into it is refused by the primitive's own schema in
  // Phase 1 - AFTER Phase 0 already applied every one of that rule's effects.
  const outOfRangeHorizon = {
    kind: "set_parameter",
    primitiveId: "horizon-projection",
    parameter: "horizonMonths",
    value: { kind: "evidence", evidenceKind: "account-balance", path: "amountMinor" },
  };

  const rejectedRule = (effects: readonly unknown[]) => ({
    id: "rule-out-of-range-horizon",
    when: { op: "all", nodes: [] },
    effects: [outOfRangeHorizon, ...effects],
  });

  it("contributes NOTHING to the trace except its own rule-unevaluable blocker", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        rejectedRule([
          { kind: "select_candidate", primitiveId: "candidate-selection", strategy: "preference-order" },
          { kind: "require_approval", templateId: "tmpl-ops-dual" },
          { kind: "prohibit", prohibitionCode: "unwound-prohibition" },
          { kind: "block", blockerCode: "unwound-blocker", resolvingEvidenceKinds: ["account-balance"] },
          { kind: "require_evidence", evidenceKind: "funding-candidates", absence: "block" },
        ]),
      ],
    });
    const trace = evaluate(policy);
    expect(trace.ruleOutcomes).toEqual([
      {
        ruleId: "rule-out-of-range-horizon",
        phase: "configuration",
        outcome: "unevaluable",
        missing: ["set_parameter rejected by horizon-projection"],
      },
    ]);
    // Every Phase-0 contribution is gone: the primitive never ran with that
    // value, and no surviving accumulator names an unevaluable rule.
    expect(trace.parameterResolutions).toEqual([]);
    expect(trace.strategyResolutions).toEqual([]);
    expect(trace.approvalRequirements).toEqual([]);
    expect(trace.prohibitions).toEqual([]);
    expect(trace.evidenceRequirements).toEqual([]);
    expect(trace.blockers).toEqual([
      {
        code: "rule-unevaluable:rule-out-of-range-horizon",
        resolvingEvidenceKinds: [],
        ruleIds: ["rule-out-of-range-horizon"],
      },
    ]);
    // The disposition stays fail-closed: the synthesized blocker carries it.
    // Dropping the unwound prohibition DOES move `prohibited` to `blocked` -
    // the ruled consequence of atomicity, not an accident - and that is safe
    // because the blocker offers no resolving evidence to clear it with.
    expect(trace.disposition).toEqual({
      kind: "blocked",
      blockerCodes: ["rule-unevaluable:rule-out-of-range-horizon"],
    });
    const horizon = trace.primitiveExecutions.find((e) => e.primitiveId === "horizon-projection")!;
    expect(horizon.outcome).toBe("unevaluable");
  });

  it("leaves a co-contributor's blocker intact, carrying only the survivor's resolving kinds", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        rejectedRule([
          { kind: "block", blockerCode: "shared-blocker", resolvingEvidenceKinds: ["account-balance"] },
        ]),
        {
          id: "rule-surviving",
          when: { op: "all", nodes: [] },
          effects: [
            { kind: "block", blockerCode: "shared-blocker", resolvingEvidenceKinds: ["reservation"] },
          ],
        },
      ],
    });
    const trace = evaluate(policy);
    expect(trace.blockers).toEqual([
      {
        code: "rule-unevaluable:rule-out-of-range-horizon",
        resolvingEvidenceKinds: [],
        ruleIds: ["rule-out-of-range-horizon"],
      },
      {
        code: "shared-blocker",
        resolvingEvidenceKinds: ["reservation"],
        ruleIds: ["rule-surviving"],
      },
    ]);
  });

  it("cascades to the OTHER primitive the same rule configured, so nothing published survives on a deleted write", () => {
    // One rule, two targets: net-availability accepts its write and would run,
    // horizon-projection refuses its own. Unwinding the rule deletes BOTH
    // writes, so net-availability may not keep a result computed from one.
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        rejectedRule([
          {
            kind: "set_parameter",
            primitiveId: "net-availability",
            parameter: "subjectScope",
            value: { kind: "constant", value: "bound-subject" },
          },
        ]),
      ],
    });
    const trace = evaluate(policy);
    expect(trace.parameterResolutions).toEqual([]);
    const outcomeOf = (primitiveId: string) =>
      trace.primitiveExecutions.find((e) => e.primitiveId === primitiveId)!;
    expect(outcomeOf("horizon-projection").outcome).toBe("unevaluable");
    expect(outcomeOf("net-availability")).toEqual({
      primitiveId: "net-availability",
      outcome: "unevaluable",
      missing: ["configured by unevaluable rule rule-out-of-range-horizon"],
    });
    // Its facts are absent, so its dependent falls out unevaluable too - no
    // published value anywhere in the trace rests on the deleted write.
    expect(outcomeOf("sufficiency-check")).toEqual({
      primitiveId: "sufficiency-check",
      outcome: "unevaluable",
      missing: ["context:availability.net", "context:projection.total"],
    });
    expect(trace.primitiveExecutions.every((e) => e.outcome === "unevaluable")).toBe(true);
    expect(trace.disposition.kind).toBe("blocked");
  });

  it("blames only the rule whose OWN written parameter the schema refused", () => {
    // Two writers on one primitive: the horizonMonths write is refused, the
    // direction write is fine - and its rule's effects must survive intact.
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        rejectedRule([]),
        {
          id: "rule-innocent-writer",
          when: { op: "all", nodes: [] },
          effects: [
            {
              kind: "set_parameter",
              primitiveId: "horizon-projection",
              parameter: "direction",
              value: { kind: "constant", value: "forward" },
            },
            { kind: "prohibit", prohibitionCode: "innocent-prohibition" },
          ],
        },
      ],
    });
    const trace = evaluate(policy);
    expect(trace.ruleOutcomes.find((o) => o.ruleId === "rule-innocent-writer")!.outcome).toBe("fired");
    expect(trace.prohibitions).toEqual([
      { code: "innocent-prohibition", source: "firm_policy", ruleIds: ["rule-innocent-writer"] },
    ]);
    // Its own write survives too: it resolved, nothing refused it, and no
    // published result rests on it - the refused primitive published nothing.
    expect(trace.parameterResolutions).toEqual([
      {
        primitiveId: "horizon-projection",
        parameter: "direction",
        value: "forward",
        ruleId: "rule-innocent-writer",
      },
    ]);
    expect(trace.blockers.map((b) => b.code)).toEqual([
      "rule-unevaluable:rule-out-of-range-horizon",
    ]);
  });

  it("refuses structurally when the refused parameter is the harness default, not a policy write", () => {
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "rule-valid-write",
          when: { op: "all", nodes: [] },
          effects: [
            {
              kind: "set_parameter",
              primitiveId: "net-availability",
              parameter: "subjectScope",
              value: { kind: "constant", value: "bound-subject" },
            },
          ],
        },
      ],
    });
    const malformed = worldInvocations().map((invocation) =>
      invocation.primitiveId === "net-availability"
        ? { ...invocation, parameters: { ...invocation.parameters, claimEvidenceKinds: [] } }
        : invocation,
    );
    const refused = evaluatePolicy(policy, { facts: worldFacts(), invocations: malformed }, registries);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.error.code).toBe("invalid-invocation-parameters");
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

  it("resolves one context key the SAME way for an AST read and a primitive binding", () => {
    // `deriveContextKeys` refuses a published/intent collision, so this shape
    // cannot come out of a derived registry - it is here to pin the ONE
    // precedence both resolution paths share if some future derivation ever
    // admits one: published facts win, in the AST plane and the binding plane
    // alike. A split here would resolve the same key two ways in one run.
    const base = worldFacts();
    const collided: PolicyEvaluationFacts = {
      ...base,
      intent: new Map([...base.intent, ["availability.net", 1]]),
    };
    const policy = load({
      schemaVersion: "1.0.0",
      primitiveSetVersion: PRIMITIVE_SET_VERSION,
      rules: [
        {
          id: "reads-collided-key",
          when: {
            op: "compare",
            comparator: "eq",
            left: { kind: "context", key: "availability.net" },
            right: { kind: "constant", value: 18_000_000 },
          },
          effects: [{ kind: "block", blockerCode: "read-published", resolvingEvidenceKinds: [] }],
        },
      ],
    });
    const trace = unwrap(
      evaluatePolicy(policy, { facts: collided, invocations: worldInvocations() }, registries),
    );
    expect(trace.ruleOutcomes[0]!.outcome).toBe("fired");
    // The binding plane agrees: headroom is computed from 18,000,000, not 1.
    const sufficiency = trace.primitiveExecutions.find((e) => e.primitiveId === "sufficiency-check")!;
    expect(sufficiency.published!["sufficiency.headroom"]).toBe(9_700_000);
  });

  it("refuses a harness context entry that disagrees with a CONSTANT binding", () => {
    const invocations = worldInvocations().map((invocation) =>
      invocation.primitiveId === "sufficiency-check"
        ? {
            ...invocation,
            parameters: { ...invocation.parameters, bound: { kind: "constant", amountMinor: 4_800_000 } },
            context: { bound: 1 },
          }
        : invocation,
    );
    const refused = evaluatePolicy(firmA, { facts: worldFacts(), invocations }, registries);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.error.code).toBe("context-assembly-conflict");
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
