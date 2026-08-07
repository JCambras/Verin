import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PRIMITIVE_SET_VERSION } from "@contracts/primitives/catalog";
import { parameterSchemaKeys } from "@contracts/primitives/values";
import { unwrap } from "@contracts/result";
import { loadPolicy } from "@domain/policy/load";
import { evaluatePolicy } from "@domain/policy/evaluate";
import type { PolicyEvaluationFacts } from "@domain/policy/facts";
import {
  canonicalDigest,
  worldInvocations,
  worldRegistries,
} from "../helpers/policy-world";

/**
 * The prompt-9 property families (ratified design §3.6, fast-check):
 *  A. order independence - shuffled rules, effects, facts, and invocations
 *     produce byte-identical canonical traces;
 *  B. conflict-rejection soundness - co-satisfiable-by-construction pairs are
 *     rejected, provably-disjoint pairs are accepted, and (the charter-#4
 *     companion) no ACCEPTED policy ever double-writes a target at runtime;
 *  C. totality - fuzzed policies and bundles never throw: a typed trace or a
 *     typed refusal, always;
 *  D. purity - identical inputs twice under poisoned Date.now/Math.random;
 *  E. most-restrictive monotonicity - adding a cumulative-effect rule never
 *     weakens the disposition or the authority mode;
 *  F. fail-closed - an unguarded read of absent evidence yields blocked,
 *     never a silent proceed;
 *  G. published-key-space stability - a write the loader ACCEPTS never changes
 *     the keys an invocation publishes, so the derived context-key vocabulary
 *     and the runtime key space stay the same vocabulary (ruling
 *     p9-key-shaping-params).
 */

const registries = worldRegistries();

// ── Generators ──────────────────────────────────────────────────────────────────

const intConstant = fc.integer({ min: -1_000_000, max: 50_000_000 });
const stringConstant = fc.constantFrom("external", "internal", "own-firm");
const comparator = fc.constantFrom("gt", "gte", "lt", "lte", "eq", "neq");

const amountLeaf = fc
  .tuple(comparator, intConstant)
  .map(([op, value]) => ({
    op: "compare",
    comparator: op,
    left: { kind: "context", key: "intent.amount" },
    right: { kind: "constant", value },
  }));

const destinationLeaf = fc
  .tuple(fc.constantFrom("eq", "neq"), stringConstant)
  .map(([op, value]) => ({
    op: "compare",
    comparator: op,
    left: { kind: "context", key: "intent.destinationType" },
    right: { kind: "constant", value },
  }));

const balanceLeaf = fc
  .tuple(fc.constantFrom("gt", "lte"), intConstant)
  .map(([op, value]) => ({
    op: "compare",
    comparator: op,
    left: { kind: "evidence", evidenceKind: "account-balance", path: "amountMinor" },
    right: { kind: "constant", value },
  }));

const freshnessLeaf = fc
  .tuple(
    fc.constantFrom("account-balance", "planned-withdrawals", "bank-instruction-change"),
    fc.integer({ min: 1, max: 60 }),
  )
  .map(([kind, days]) => ({ op: "is_fresh", evidenceKind: kind, maxAge: `P${days}D` }));

const existsLeaf = fc
  .constantFrom("reservation", "bank-instruction-independent-verification")
  .map((kind) => ({
    op: "exists",
    value: { kind: "evidence", evidenceKind: kind, path: kind === "reservation" ? "amountMinor" : "verifiedAt" },
  }));

const membershipLeaf = fc
  .uniqueArray(stringConstant, { minLength: 1, maxLength: 3 })
  .map((values) => ({
    op: "in",
    value: { kind: "context", key: "intent.destinationType" },
    set: values.map((value) => ({ kind: "constant", value })),
  }));

const leaf = fc.oneof(amountLeaf, destinationLeaf, balanceLeaf, freshnessLeaf, existsLeaf, membershipLeaf);

const predicate = fc.letrec((tie) => ({
  node: fc.oneof(
    { maxDepth: 3, withCrossShrink: true },
    leaf,
    fc.array(tie("node"), { maxLength: 3 }).map((nodes) => ({ op: "all", nodes })),
    fc.array(tie("node"), { maxLength: 3 }).map((nodes) => ({ op: "any", nodes })),
    tie("node").map((node) => ({ op: "not", node })),
  ),
})).node;

const cumulativeEffect = fc.oneof(
  fc
    .tuple(fc.constantFrom("hold-a", "hold-b", "hold-c"), fc.constantFrom("account-balance", "reservation-release"))
    .map(([code, kind]) => ({ kind: "block", blockerCode: code, resolvingEvidenceKinds: [kind] })),
  fc.constantFrom("stop-a", "stop-b").map((code) => ({ kind: "prohibit", prohibitionCode: code })),
  fc
    .constantFrom("tmpl-ops-dual", "tmpl-dual-approval-b", "tmpl-bank-change-specialist")
    .map((templateId) => ({ kind: "require_approval", templateId })),
  fc
    .constantFrom("funding-candidates", "reservation")
    .map((evidenceKind) => ({ kind: "require_evidence", evidenceKind, absence: "block" })),
);

const cumulativeRules = fc
  .array(fc.tuple(predicate, fc.array(cumulativeEffect, { minLength: 1, maxLength: 3 })), {
    minLength: 1,
    maxLength: 6,
  })
  .map((entries) =>
    entries.map(([when, effects], index) => ({ id: `rule-${index}`, when, effects })),
  );

const policyOf = (rules: readonly unknown[]) => ({
  schemaVersion: "1.0.0",
  primitiveSetVersion: PRIMITIVE_SET_VERSION,
  rules,
});

/** Deterministic Fisher-Yates over a small LCG so shuffles are replayable. */
const permute = <T>(values: readonly T[], seed: number): T[] => {
  const output = [...values];
  let state = (seed >>> 0) || 1;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const pick = state % (index + 1);
    [output[index], output[pick]] = [output[pick]!, output[index]!];
  }
  return output;
};

const scalar = fc.oneof(
  fc.integer({ min: -100_000_000, max: 100_000_000 }),
  fc.constant(Number.MAX_SAFE_INTEGER),
  fc.string({ maxLength: 12 }),
  fc.boolean(),
  fc.constant(null),
);

const OBSERVED_AT = [
  "2026-07-31T12:00:00.000Z",
  "2026-07-20T12:00:00.000Z",
  "2026-05-01T12:00:00.000Z",
] as const;

/** Fuzzed facts: kinds appear or not, values may be wrong-typed or extreme. */
const factsArb: fc.Arbitrary<PolicyEvaluationFacts> = fc
  .record({
    amount: fc.oneof(intConstant, fc.constant(7_500_000)),
    destination: stringConstant,
    kinds: fc.dictionary(
      fc.constantFrom(
        "account-balance",
        "pending-activity",
        "reservation",
        "planned-withdrawals",
        "bank-instruction-change",
        "bank-instruction-independent-verification",
      ),
      fc.record({
        observedAt: fc.constantFrom(...OBSERVED_AT),
        value: scalar,
      }),
      { maxKeys: 6 },
    ),
  })
  .map(({ amount, destination, kinds }) => ({
    asOf: "2026-08-01T12:00:00.000Z",
    evidence: new Map(
      Object.entries(kinds).map(([kind, snapshot]) => [
        kind,
        {
          observedAt: snapshot.observedAt,
          values: {
            amountMinor: snapshot.value,
            monthlyAmountMinor: snapshot.value,
            changedAt: snapshot.observedAt,
            verifiedAt: snapshot.observedAt,
          },
        },
      ]),
    ),
    instructions: new Map(),
    intent: new Map<string, string | number | boolean | null>([
      ["intent.amount", amount],
      ["intent.destinationType", destination],
    ]),
  }));

const loadOk = (document: Record<string, unknown>) => {
  const loaded = loadPolicy(document, registries);
  expect(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.error)).toBe(true);
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.value;
};

// ── A. Order independence ───────────────────────────────────────────────────────

describe("property A - order independence", () => {
  it("shuffling rules, effects, facts, and invocations never changes the trace bytes", () => {
    fc.assert(
      fc.property(cumulativeRules, factsArb, fc.integer(), (rules, facts, seed) => {
        const baseline = unwrap(
          evaluatePolicy(loadOk(policyOf(rules)), { facts, invocations: worldInvocations() }, registries),
        );
        const shuffledRules = permute(rules, seed).map((rule) => ({
          ...rule,
          effects: permute(rule.effects, seed ^ 0x9e3779b9),
        }));
        const shuffledFacts: PolicyEvaluationFacts = {
          ...facts,
          evidence: new Map(permute([...facts.evidence.entries()], seed ^ 0x5bd1e995)),
          intent: new Map(permute([...facts.intent.entries()], seed ^ 0x27d4eb2f)),
        };
        const shuffled = unwrap(
          evaluatePolicy(
            loadOk(policyOf(shuffledRules)),
            { facts: shuffledFacts, invocations: permute(worldInvocations(), seed) },
            registries,
          ),
        );
        expect(canonicalDigest(shuffled)).toBe(canonicalDigest(baseline));
      }),
    );
  });
});

// ── B. Conflict-rejection soundness ─────────────────────────────────────────────

describe("property B - conflict rejection", () => {
  const writer = (id: string, when: unknown, months: number) => ({
    id,
    when,
    effects: [
      {
        kind: "set_parameter",
        primitiveId: "horizon-projection",
        parameter: "horizonMonths",
        value: { kind: "constant", value: months },
      },
    ],
  });

  it("co-satisfiable-by-construction writer pairs are ALWAYS rejected", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (a, b) => {
          // Two positive lower bounds always overlap above max(a, b).
          const document = policyOf([
            writer("w-a", { op: "compare", comparator: "gt", left: { kind: "context", key: "intent.amount" }, right: { kind: "constant", value: a } }, 6),
            writer("w-b", { op: "compare", comparator: "gt", left: { kind: "context", key: "intent.amount" }, right: { kind: "constant", value: b } }, 12),
          ]);
          const loaded = loadPolicy(document, registries);
          expect(loaded.ok).toBe(false);
          if (loaded.ok) throw new Error("unreachable");
          expect(loaded.error.some((issue) => issue.code === "effect-conflict")).toBe(true);
        },
      ),
    );
  });

  it("threshold-split writer pairs are ALWAYS accepted, and (companion) no accepted policy double-writes at runtime", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), factsArb, (threshold, facts) => {
        const document = policyOf([
          writer("w-low", { op: "compare", comparator: "lte", left: { kind: "context", key: "intent.amount" }, right: { kind: "constant", value: threshold } }, 6),
          writer("w-high", { op: "compare", comparator: "gt", left: { kind: "context", key: "intent.amount" }, right: { kind: "constant", value: threshold } }, 12),
        ]);
        const loaded = loadOk(document);
        const evaluated = evaluatePolicy(loaded, { facts, invocations: worldInvocations() }, registries);
        // The prover's soundness, asserted at runtime (charter #4): a target is
        // written at most once, and the duplicate-write refusal is unreachable.
        expect(evaluated.ok, evaluated.ok ? "" : JSON.stringify(evaluated.error)).toBe(true);
        if (!evaluated.ok) throw new Error("unreachable");
        const targets = evaluated.value.parameterResolutions.map(
          (resolution) => `${resolution.primitiveId}:${resolution.parameter}`,
        );
        expect(new Set(targets).size).toBe(targets.length);
      }),
    );
  });
});

// ── C. Totality ─────────────────────────────────────────────────────────────────

describe("property C - totality", () => {
  it("fuzzed valid policies over fuzzed bundles never throw", () => {
    fc.assert(
      fc.property(cumulativeRules, factsArb, fc.boolean(), (rules, facts, withInvocations) => {
        const evaluated = evaluatePolicy(
          loadOk(policyOf(rules)),
          { facts, invocations: withInvocations ? worldInvocations() : [] },
          registries,
        );
        if (evaluated.ok) {
          expect(["proceed", "blocked", "prohibited"]).toContain(evaluated.value.disposition.kind);
        } else {
          expect(typeof evaluated.error.code).toBe("string");
        }
      }),
    );
  });

  it("loadPolicy never throws on arbitrary JSON", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (document) => {
        const loaded = loadPolicy(document, registries);
        if (!loaded.ok) expect(loaded.error.length).toBeGreaterThan(0);
      }),
    );
  });
});

// ── D. Purity ───────────────────────────────────────────────────────────────────

describe("property D - purity under poisoned ambient sources", () => {
  it("identical inputs twice produce identical bytes while Date.now and Math.random throw", () => {
    const realNow = Date.now;
    const realRandom = Math.random;
    const poison = (name: string) => () => {
      throw new Error(`${name} reached the policy interpreter`);
    };
    try {
      Date.now = poison("Date.now");
      Math.random = poison("Math.random");
      fc.assert(
        fc.property(cumulativeRules, factsArb, (rules, facts) => {
          const loaded = loadOk(policyOf(rules));
          const first = unwrap(
            evaluatePolicy(loaded, { facts, invocations: worldInvocations() }, registries),
          );
          const second = unwrap(
            evaluatePolicy(loaded, { facts, invocations: worldInvocations() }, registries),
          );
          expect(canonicalDigest(first)).toBe(canonicalDigest(second));
        }),
      );
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
  });
});

// ── E. Most-restrictive monotonicity ────────────────────────────────────────────

const DISPOSITION_RANK = { proceed: 0, blocked: 1, prohibited: 2 } as const;
const MODE_RANK = { automatic: 0, approval: 1, specialist_review: 2 } as const;

/**
 * Scope: `cumulativeEffect` generates no `set_parameter`, so this family never
 * reaches the atomic unwind - which by ruled design MAY move `prohibited` to
 * `blocked` when the rule that prohibited turns out unevaluable. That is a
 * rank DECREASE, and it is the one documented exception to the monotonicity
 * asserted here; widening the generator to write parameters must state it.
 */
describe("property E - most-restrictive monotonicity", () => {
  it("adding a cumulative-effect rule never weakens disposition or authority", () => {
    fc.assert(
      fc.property(
        cumulativeRules,
        predicate,
        fc.array(cumulativeEffect, { minLength: 1, maxLength: 2 }),
        factsArb,
        (rules, extraWhen, extraEffects, facts) => {
          const base = unwrap(
            evaluatePolicy(loadOk(policyOf(rules)), { facts, invocations: worldInvocations() }, registries),
          );
          const extended = unwrap(
            evaluatePolicy(
              loadOk(policyOf([...rules, { id: "rule-extra", when: extraWhen, effects: extraEffects }])),
              { facts, invocations: worldInvocations() },
              registries,
            ),
          );
          expect(DISPOSITION_RANK[extended.disposition.kind]).toBeGreaterThanOrEqual(
            DISPOSITION_RANK[base.disposition.kind],
          );
          if (base.disposition.kind === "proceed" && extended.disposition.kind === "proceed") {
            expect(MODE_RANK[extended.disposition.authority.mode]).toBeGreaterThanOrEqual(
              MODE_RANK[base.disposition.authority.mode],
            );
          }
        },
      ),
    );
  });
});

// ── F. Fail-closed ──────────────────────────────────────────────────────────────

describe("property F - fail-closed on absent evidence in value positions", () => {
  it("an unguarded read of an absent kind yields blocked, never silent proceed", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("reservation", "pending-activity", "account-balance"),
        fc.boolean(),
        factsArb,
        (kind, negate, facts) => {
          const read = {
            op: "compare",
            comparator: "gt",
            left: { kind: "evidence", evidenceKind: kind, path: "amountMinor" },
            right: { kind: "constant", value: 0 },
          };
          const document = policyOf([
            {
              id: "unguarded",
              when: negate ? { op: "not", node: read } : read,
              effects: [{ kind: "prohibit", prohibitionCode: "should-not-matter" }],
            },
          ]);
          const strippedFacts: PolicyEvaluationFacts = {
            ...facts,
            evidence: new Map([...facts.evidence.entries()].filter(([name]) => name !== kind)),
          };
          const trace = unwrap(
            evaluatePolicy(loadOk(document), { facts: strippedFacts, invocations: [] }, registries),
          );
          expect(trace.disposition.kind).toBe("blocked");
          if (trace.disposition.kind !== "blocked") throw new Error("unreachable");
          expect(trace.disposition.blockerCodes).toContain("rule-unevaluable:unguarded");
          expect(
            trace.blockers.find((blocker) => blocker.code === "rule-unevaluable:unguarded")!
              .resolvingEvidenceKinds,
          ).toContain(kind);
        },
      ),
    );
  });
});

// ── G. Published-key-space stability ────────────────────────────────────────────

describe("property G - an accepted policy never reshapes a published key space", () => {
  const ref = (id: string) => ({ firmId: "firm-a", id });

  /** One configured parameter object per catalog primitive - what a binding supplies. */
  const CONFIGURED: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    "net-availability": {
      resourceEvidenceKind: "account-balance",
      claimEvidenceKinds: ["pending-activity", "reservation"],
      subjectScope: "subject-group",
    },
    "horizon-projection": {
      seriesEvidenceKind: "planned-withdrawals",
      horizonMonths: 6,
      direction: "forward",
    },
    "sufficiency-check": {
      mode: "floor-preserving",
      available: { kind: "context", key: "availability.net" },
      draw: { kind: "context", key: "intent.amount" },
      bound: { kind: "context", key: "projection.total" },
    },
    "candidate-selection": {
      candidateEvidenceKind: "funding-candidates",
      subjectSlot: "source-account",
      exclusions: [],
      ambiguityQuestionCode: "which-source-account",
    },
    "evidence-reconciliation": {
      factKind: "balance-fact",
      sourcesToReconcile: [ref("src-one"), ref("src-two")],
      tolerance: 0,
    },
    "restriction-screen": {
      restrictionKinds: [{ kind: "regulatory-hold", polarity: "deny-list" }],
      subjectsInScope: ["source-account"],
    },
  };

  /** The published key set, or null when the parameters do not parse at all. */
  const keysOf = (primitiveId: string, parameters: unknown): readonly string[] | null => {
    const primitive = registries.primitives.get(primitiveId)!;
    const parsed = primitive.parameterSchema.safeParse(parameters);
    if (!parsed.success) return null;
    return Object.keys(
      (primitive.publishedKeys as (p: unknown) => Record<string, unknown>)(parsed.data),
    ).sort();
  };

  const TARGETS = [...registries.primitives.values()].flatMap((primitive) =>
    [...parameterSchemaKeys(primitive.parameterSchema)].map(
      (parameter) => [primitive.id as string, parameter] as const,
    ),
  );

  it("covers every parameter of every catalog primitive (charter #4: no vacuous pass)", () => {
    expect(TARGETS.length).toBeGreaterThanOrEqual(19);
    expect(new Set(TARGETS.map(([id]) => id)).size).toBe(registries.primitives.size);
    for (const primitiveId of registries.primitives.keys()) {
      expect(keysOf(primitiveId, CONFIGURED[primitiveId]), primitiveId).not.toBeNull();
    }
  });

  it("no write the loader ACCEPTS can shift the keys the primitive publishes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TARGETS),
        fc.oneof(
          fc.integer({ min: -8, max: 36 }),
          fc.constantFrom("other-slot", "other-kind", "forward", "cap-limited", "bound-subject"),
          fc.boolean(),
          fc.constant(null),
        ),
        ([primitiveId, parameter], value) => {
          const document = policyOf([
            {
              id: "w",
              when: { op: "all", nodes: [] },
              effects: [
                {
                  kind: "set_parameter",
                  primitiveId,
                  parameter,
                  value: { kind: "constant", value },
                },
              ],
            },
          ]);
          // A refused write cannot desync anything - that is the whole point of
          // the key-shaping check, and the load tests pin which names it names.
          if (!loadPolicy(document, registries).ok) return;
          const configured = CONFIGURED[primitiveId]!;
          const after = keysOf(primitiveId, { ...configured, [parameter]: value });
          // An override the primitive's own schema refuses never runs it, so it
          // publishes nothing (fail-closed) - only a PARSING override could
          // shift the vocabulary `deriveContextKeys` closed over.
          if (after === null) return;
          expect(after, `${primitiveId}.${parameter}`).toEqual(keysOf(primitiveId, configured));
        },
      ),
      { numRuns: 500 },
    );
  });
});
