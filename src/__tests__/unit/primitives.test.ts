import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  PRIMITIVE_CATALOG,
  PRIMITIVE_CATALOG_IDS,
  PRIMITIVE_SET_PROVISIONAL,
  PRIMITIVE_SET_VERSION,
  candidateSelection,
  evidenceReconciliation,
  horizonProjection,
  netAvailability,
  restrictionScreen,
  sufficiencyCheck,
} from "@contracts/primitives/catalog";
import {
  IsoDateSchema,
  KeySegmentSchema,
  PublishedValueDescriptorSchema,
  addCalendarMonths,
} from "@contracts/primitives/values";

/**
 * Decision-primitive catalog tests (v3 prompt 8; ADR-0039; D-102). Three
 * families:
 *  - deterministic semantics anchored on the captain-signed golden-case
 *    arithmetic (GC references in comments cite docs/golden-cases.md);
 *  - determinism proper: same input twice and shuffled collection order give
 *    byte-identical published facts, and published keys are canonical;
 *  - FALSIFICATION GUARDS: each primitive's ratified kill criterion is
 *    asserted as currently-unrepresentable, so absorbing the falsifying case
 *    by quiet schema growth fails here and forces the declared version-bump
 *    path instead (docs/primitive-rationale.md).
 */

const ref = (id: string, firmId = "firm-a") => ({ firmId, id });
/** Golden-case dollars are integers; the catalog works in minor units. */
const usd = (dollars: number) => dollars * 100;

const evaluateParsed = <Def extends { inputSchema: z.ZodType; evaluate: (input: never) => unknown }>(
  definition: Def,
  raw: unknown,
): Record<string, unknown> => {
  const input = definition.inputSchema.parse(raw) as never;
  return definition.evaluate(input) as Record<string, unknown>;
};

const expectBytesEqual = (left: unknown, right: unknown) => {
  expect(JSON.stringify(left)).toBe(JSON.stringify(right));
};

describe("primitive catalog surface", () => {
  it("is version 1.0.0, provisional, and under fifteen primitives", () => {
    expect(PRIMITIVE_SET_VERSION).toBe("1.0.0");
    expect(PRIMITIVE_SET_PROVISIONAL).toBe(true);
    expect(PRIMITIVE_CATALOG.length).toBe(6);
    expect(PRIMITIVE_CATALOG.length).toBeLessThan(15);
  });

  it("lists ids uniquely in canonical order, all kebab-case", () => {
    const ids = [...PRIMITIVE_CATALOG_IDS];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
    for (const id of ids) expect(KeySegmentSchema.safeParse(id).success).toBe(true);
  });

  it("only candidate-selection declares strategies, and its vocabulary is closed", () => {
    for (const primitive of PRIMITIVE_CATALOG) {
      if (primitive.id === candidateSelection.id) {
        expect(primitive.allowedStrategies).toEqual([
          "exactly-one",
          "preference-order",
          "single-eligible",
        ]);
      } else {
        expect(primitive.allowedStrategies).toEqual([]);
      }
    }
  });

  it("every primitive carries a falsification test naming a real operating case", () => {
    for (const primitive of PRIMITIVE_CATALOG) {
      expect(primitive.falsification.operatingCase.length).toBeGreaterThan(40);
      expect(primitive.falsification.falsifiedResponse.length).toBeGreaterThan(20);
    }
  });
});

// ── net-availability ────────────────────────────────────────────────────────────

const availabilityParameters = {
  resourceEvidenceKind: "account-balance",
  claimEvidenceKinds: ["active-reservation", "pending-activity"],
  subjectScope: "subject-group",
};

const availabilityInput = (
  claims: readonly { claimKind: string; snapshotRef: object; amountMinor: number }[],
  grossMinor: number,
) => ({
  parameters: availabilityParameters,
  evidence: {
    resource: { snapshotRef: ref("snap-balance"), amountMinor: grossMinor },
    claims,
  },
  context: {},
});

describe("net-availability", () => {
  it("nets pending activity out of gross with a per-kind breakdown (GC-05)", () => {
    // GC-05: available 160,000 minus the pending approved 20,000 = 140,000.
    const published = evaluateParsed(
      netAvailability,
      availabilityInput(
        [{ claimKind: "pending-activity", snapshotRef: ref("snap-pending"), amountMinor: usd(20000) }],
        usd(160000),
      ),
    );
    expect(published).toEqual({
      "availability.claims.active-reservation": 0,
      "availability.claims.pending-activity": usd(20000),
      "availability.gross": usd(160000),
      "availability.net": usd(140000),
    });
  });

  it("makes a sibling reservation visible as its own claim kind (GC-11)", () => {
    // GC-11: the sibling's 75,000 reservation leaves effective liquidity 85,000.
    const published = evaluateParsed(
      netAvailability,
      availabilityInput(
        [{ claimKind: "active-reservation", snapshotRef: ref("snap-reservation"), amountMinor: usd(75000) }],
        usd(160000),
      ),
    );
    expect(published["availability.net"]).toBe(usd(85000));
    expect(published["availability.claims.active-reservation"]).toBe(usd(75000));
    expect(published["availability.claims.pending-activity"]).toBe(0);
  });

  it("is order-independent over the claims collection and repeatable", () => {
    const claims = [
      { claimKind: "pending-activity", snapshotRef: ref("snap-a"), amountMinor: usd(1000) },
      { claimKind: "active-reservation", snapshotRef: ref("snap-b"), amountMinor: usd(2000) },
      { claimKind: "pending-activity", snapshotRef: ref("snap-c"), amountMinor: usd(4000) },
    ];
    const forward = evaluateParsed(netAvailability, availabilityInput(claims, usd(50000)));
    const reversed = evaluateParsed(
      netAvailability,
      availabilityInput([...claims].reverse(), usd(50000)),
    );
    expectBytesEqual(forward, reversed);
    expectBytesEqual(forward, evaluateParsed(netAvailability, availabilityInput(claims, usd(50000))));
    expect(Object.keys(forward)).toEqual([...Object.keys(forward)].sort());
  });

  it("refuses a claim of an undeclared kind instead of summing or dropping it", () => {
    const result = netAvailability.inputSchema.safeParse(
      availabilityInput(
        [{ claimKind: "margin-facility", snapshotRef: ref("snap-x"), amountMinor: usd(1) }],
        usd(10),
      ),
    );
    expect(result.success).toBe(false);
  });

  it("refuses cross-tenant snapshots", () => {
    const result = netAvailability.inputSchema.safeParse(
      availabilityInput(
        [{ claimKind: "pending-activity", snapshotRef: ref("snap-p", "firm-b"), amountMinor: usd(1) }],
        usd(10),
      ),
    );
    expect(result.success).toBe(false);
  });

  it("FALSIFICATION GUARD: conditional claims and negative claims are unrepresentable", () => {
    // The ratified kill case: a pending buy that counts only after settlement.
    // A claim carrying a settlement condition must be a parse error - absorbing
    // it here would demand a claim classifier via a version bump instead.
    const conditional = netAvailability.inputSchema.safeParse(
      availabilityInput(
        [{
          claimKind: "pending-activity",
          snapshotRef: ref("snap-p"),
          amountMinor: usd(1),
          settlesOn: "2026-07-28",
        } as never],
        usd(10),
      ),
    );
    expect(conditional.success).toBe(false);
    // A margin/overdraft facility modeled as a NEGATIVE claim is the same kill
    // case wearing a sign bit.
    const negative = netAvailability.inputSchema.safeParse(
      availabilityInput(
        [{ claimKind: "pending-activity", snapshotRef: ref("snap-p"), amountMinor: -1 }],
        usd(10),
      ),
    );
    expect(negative.success).toBe(false);
  });

  it("FALSIFICATION GUARD: a binding with zero claim kinds is a plain read, not a primitive", () => {
    const result = netAvailability.parameterSchema.safeParse({
      ...availabilityParameters,
      claimEvidenceKinds: [],
    });
    expect(result.success).toBe(false);
  });
});

// ── horizon-projection ──────────────────────────────────────────────────────────

const monthlyFlows = (amountMinor: number) =>
  [8, 9, 10, 11, 12].map((month) => ({ dueOn: `2026-${String(month).padStart(2, "0")}-01`, amountMinor }))
    .concat([1, 2, 3, 4, 5, 6, 7].map((month) => ({ dueOn: `2027-0${month}-01`, amountMinor })));

const projectionInput = (horizonMonths: number, flows: readonly object[], anchorDate = "2026-07-26") => ({
  parameters: { seriesEvidenceKind: "planned-withdrawals", horizonMonths, direction: "forward" },
  evidence: { series: { snapshotRef: ref("snap-series"), flows } },
  context: { anchorDate },
});

describe("horizon-projection", () => {
  it("sums six and twelve months of an 8,000/month series to the signed reserve floors", () => {
    // GC-11 (Firm A): six months = 48,000. GC-05 (Firm B): twelve = 96,000.
    const six = evaluateParsed(horizonProjection, projectionInput(6, monthlyFlows(usd(8000))));
    expect(six["projection.total"]).toBe(usd(48000));
    const twelve = evaluateParsed(horizonProjection, projectionInput(12, monthlyFlows(usd(8000))));
    expect(twelve["projection.total"]).toBe(usd(96000));
    expect(twelve["projection.horizon"]).toEqual({
      startsOn: "2026-07-26",
      endsOnExclusive: "2027-07-26",
      months: 12,
    });
  });

  it("treats the window as half-open: anchor day counts, far edge does not", () => {
    const published = evaluateParsed(
      horizonProjection,
      projectionInput(
        1,
        [
          { dueOn: "2026-07-01", amountMinor: usd(1) },
          { dueOn: "2026-08-01", amountMinor: usd(10) },
        ],
        "2026-07-01",
      ),
    );
    expect(published["projection.total"]).toBe(usd(1));
  });

  it("clamps end-of-month arithmetic, honoring leap years", () => {
    expect(addCalendarMonths(IsoDateSchema.parse("2026-01-31"), 1)).toBe("2026-02-28");
    expect(addCalendarMonths(IsoDateSchema.parse("2028-01-31"), 1)).toBe("2028-02-29");
    expect(addCalendarMonths(IsoDateSchema.parse("2026-10-31"), 4)).toBe("2027-02-28");
    expect(addCalendarMonths(IsoDateSchema.parse("2026-08-31"), 1)).toBe("2026-09-30");
    const published = evaluateParsed(
      horizonProjection,
      projectionInput(1, [{ dueOn: "2026-02-28", amountMinor: usd(5) }], "2026-01-31"),
    );
    // Window [2026-01-31, 2026-02-28): the clamped edge is EXCLUSIVE.
    expect(published["projection.total"]).toBe(0);
  });

  it("is repeatable and order-independent over the flow series", () => {
    const flows = monthlyFlows(usd(8000));
    const forward = evaluateParsed(horizonProjection, projectionInput(12, flows));
    const reversed = evaluateParsed(horizonProjection, projectionInput(12, [...flows].reverse()));
    expectBytesEqual(forward, reversed);
    expect(Object.keys(forward)).toEqual([...Object.keys(forward)].sort());
  });

  it("FALSIFICATION GUARD: backward projection and non-sum aggregation are unrepresentable", () => {
    expect(
      horizonProjection.parameterSchema.safeParse({
        seriesEvidenceKind: "planned-withdrawals",
        horizonMonths: 6,
        direction: "backward",
      }).success,
    ).toBe(false);
    // Largest-monthly-gap style rules would need an aggregation selector; the
    // parameter surface refuses one so that case forces a sibling primitive.
    expect(
      horizonProjection.parameterSchema.safeParse({
        seriesEvidenceKind: "planned-withdrawals",
        horizonMonths: 6,
        direction: "forward",
        aggregation: "max-monthly-gap",
      }).success,
    ).toBe(false);
  });
});

// ── sufficiency-check ───────────────────────────────────────────────────────────

const floorParameters = {
  mode: "floor-preserving",
  available: { kind: "context", key: "availability.net" },
  draw: { kind: "context", key: "intent.amount" },
  bound: { kind: "context", key: "projection.total" },
};

const floorInput = (available: number, draw: number, bound: number) => ({
  parameters: floorParameters,
  evidence: {},
  context: { available, draw, bound },
});

describe("sufficiency-check", () => {
  it("reproduces GC-05's blocked arithmetic: 140,000 - 75,000 = 65,000 < 96,000", () => {
    const published = evaluateParsed(sufficiencyCheck, floorInput(usd(140000), usd(75000), usd(96000)));
    expect(published).toEqual({
      "sufficiency.headroom": 0,
      "sufficiency.satisfied": false,
      "sufficiency.shortfall": usd(31000),
    });
  });

  it("reproduces GC-11's joint shortfall: 85,000 - 75,000 = 10,000 < 48,000", () => {
    const published = evaluateParsed(sufficiencyCheck, floorInput(usd(85000), usd(75000), usd(48000)));
    expect(published["sufficiency.shortfall"]).toBe(usd(38000));
    expect(published["sufficiency.satisfied"]).toBe(false);
  });

  it("publishes headroom when the floor is preserved (GC-01)", () => {
    const published = evaluateParsed(sufficiencyCheck, floorInput(usd(140000), usd(75000), usd(48000)));
    expect(published).toEqual({
      "sufficiency.headroom": usd(17000),
      "sufficiency.satisfied": true,
      "sufficiency.shortfall": 0,
    });
  });

  it("supports the zero-constant draw for pure floor checks, proving resolution consistency", () => {
    const zeroDraw = {
      parameters: { ...floorParameters, draw: { kind: "constant", amountMinor: 0 } },
      evidence: {},
      context: { available: usd(100), draw: 0, bound: usd(60) },
    };
    const published = evaluateParsed(sufficiencyCheck, zeroDraw);
    expect(published["sufficiency.satisfied"]).toBe(true);
    // A resolved context value that disagrees with the constant binding is an
    // assembly error, not an evaluation input.
    expect(
      sufficiencyCheck.inputSchema.safeParse({
        ...zeroDraw,
        context: { ...zeroDraw.context, draw: usd(1) },
      }).success,
    ).toBe(false);
  });

  it("cap-limited mode caps the draw itself and cannot carry an available binding", () => {
    const capInput = {
      parameters: {
        mode: "cap-limited",
        draw: { kind: "context", key: "intent.amount" },
        bound: { kind: "constant", amountMinor: usd(50000) },
      },
      evidence: {},
      context: { draw: usd(30000), bound: usd(50000) },
    };
    expect(evaluateParsed(sufficiencyCheck, capInput)).toEqual({
      "sufficiency.headroom": usd(20000),
      "sufficiency.satisfied": true,
      "sufficiency.shortfall": 0,
    });
    expect(
      sufficiencyCheck.inputSchema.safeParse({
        ...capInput,
        parameters: { ...capInput.parameters, available: { kind: "context", key: "availability.net" } },
      }).success,
    ).toBe(false);
  });

  it("FALSIFICATION GUARD: ratio modes and percentage bounds are unrepresentable", () => {
    // The ratified kill case ("keep 110 percent of the floor") activates the
    // declared future primitive deviation-from-target, never a mode here.
    expect(
      sufficiencyCheck.parameterSchema.safeParse({ ...floorParameters, mode: "ratio-floor" }).success,
    ).toBe(false);
    expect(
      sufficiencyCheck.parameterSchema.safeParse({
        ...floorParameters,
        bound: { kind: "constant", percent: 110 },
      }).success,
    ).toBe(false);
    // Joint sufficiency across multiple resources: a second available binding
    // has no representable home.
    expect(
      sufficiencyCheck.parameterSchema.safeParse({
        ...floorParameters,
        secondAvailable: { kind: "context", key: "availability.other" },
      }).success,
    ).toBe(false);
  });
});

// ── candidate-selection ─────────────────────────────────────────────────────────

const selectionParameters = {
  candidateEvidenceKind: "eligible-source-accounts",
  subjectSlot: "source-account",
  exclusions: [{ classification: "taxable-event-on-distribution", reasonCode: "taxable-event-source" }],
  ambiguityQuestionCode: "which-subject",
};

const selectionInput = (
  candidates: readonly object[],
  strategy: string,
  overrides: { parameters?: object; preferenceRanking?: readonly object[] } = {},
) => ({
  parameters: { ...selectionParameters, ...overrides.parameters },
  evidence: { candidates, preferenceRanking: overrides.preferenceRanking ?? [] },
  context: { strategy },
});

describe("candidate-selection", () => {
  const taxable = { ref: ref("subject-smiths-joint-taxable"), classifications: [] };
  const deferred = {
    ref: ref("subject-smiths-retirement"),
    classifications: ["taxable-event-on-distribution"],
  };

  it("selects the preferred source and rejects the excluded alternative with its configured code (GC-01)", () => {
    const published = evaluateParsed(
      candidateSelection,
      selectionInput([taxable, deferred], "preference-order", {
        preferenceRanking: [taxable.ref],
      }),
    );
    expect(published["selection.source-account.outcome"]).toBe("selected");
    expect(published["selection.source-account.selectedRef"]).toEqual(taxable.ref);
    expect(published["selection.source-account.alternatives"]).toEqual([
      { ref: deferred.ref, rejectedBecause: "taxable-event-source" },
    ]);
  });

  it("ranks survivors by household preference and marks ranked-behind alternatives", () => {
    const first = { ref: ref("subject-a"), classifications: [] };
    const second = { ref: ref("subject-b"), classifications: [] };
    const published = evaluateParsed(
      candidateSelection,
      selectionInput([first, second], "preference-order", {
        parameters: { exclusions: [] },
        preferenceRanking: [second.ref],
      }),
    );
    expect(published["selection.source-account.selectedRef"]).toEqual(second.ref);
    expect(published["selection.source-account.alternatives"]).toEqual([
      { ref: first.ref, rejectedBecause: "ranked-behind-selection" },
    ]);
  });

  it("breaks unranked ties by canonical reference order - every strategy has a documented total order", () => {
    const later = { ref: ref("subject-z"), classifications: [] };
    const earlier = { ref: ref("subject-a"), classifications: [] };
    const published = evaluateParsed(
      candidateSelection,
      selectionInput([later, earlier], "preference-order", { parameters: { exclusions: [] } }),
    );
    expect(published["selection.source-account.selectedRef"]).toEqual(earlier.ref);
  });

  it("lands ambiguous with a typed human question on two raw candidates (GC-08)", () => {
    // GC-08: 'the Smiths' matches two households; the model NEVER guesses.
    const robertAna = { ref: ref("subject-smiths-robert-ana"), classifications: [] };
    const trust = { ref: ref("subject-smith-family-trust"), classifications: [] };
    const published = evaluateParsed(
      candidateSelection,
      selectionInput([robertAna, trust], "exactly-one", {
        parameters: { subjectSlot: "target-record", exclusions: [], ambiguityQuestionCode: "which-of-several" },
      }),
    );
    expect(published["selection.target-record.outcome"]).toBe("ambiguous");
    expect(published["selection.target-record.openQuestion"]).toEqual({
      candidateRefs: [robertAna.ref, trust.ref].sort((a, b) => a.id.localeCompare(b.id)),
      humanQuestionCode: "which-of-several",
    });
    expect("selection.target-record.selectedRef" in published).toBe(false);
  });

  it("single-eligible selects the sole survivor and goes ambiguous or empty otherwise", () => {
    const sole = evaluateParsed(candidateSelection, selectionInput([taxable, deferred], "single-eligible"));
    expect(sole["selection.source-account.outcome"]).toBe("selected");
    const two = evaluateParsed(
      candidateSelection,
      selectionInput(
        [{ ref: ref("subject-a"), classifications: [] }, { ref: ref("subject-b"), classifications: [] }],
        "single-eligible",
      ),
    );
    expect(two["selection.source-account.outcome"]).toBe("ambiguous");
    const none = evaluateParsed(candidateSelection, selectionInput([deferred], "single-eligible"));
    expect(none["selection.source-account.outcome"]).toBe("empty");
  });

  it("refuses exactly-one bindings that configure exclusions - a self-contradiction", () => {
    expect(
      candidateSelection.inputSchema.safeParse(selectionInput([taxable], "exactly-one")).success,
    ).toBe(false);
  });

  it("refuses duplicate and cross-tenant candidates", () => {
    expect(
      candidateSelection.inputSchema.safeParse(selectionInput([taxable, taxable], "single-eligible")).success,
    ).toBe(false);
    expect(
      candidateSelection.inputSchema.safeParse(
        selectionInput(
          [taxable, { ref: ref("subject-other", "firm-b"), classifications: [] }],
          "single-eligible",
        ),
      ).success,
    ).toBe(false);
  });

  it("is order-independent over candidate assembly order", () => {
    const candidates = [
      { ref: ref("subject-c"), classifications: [] },
      { ref: ref("subject-a"), classifications: [] },
      { ref: ref("subject-b"), classifications: ["taxable-event-on-distribution"] },
    ];
    const forward = evaluateParsed(candidateSelection, selectionInput(candidates, "preference-order"));
    const reversed = evaluateParsed(
      candidateSelection,
      selectionInput([...candidates].reverse(), "preference-order"),
    );
    expectBytesEqual(forward, reversed);
  });

  it("FALSIFICATION GUARD: quantity allocation and unknown strategies are unrepresentable", () => {
    // The ratified kill case: split 75,000 across two sources pro-rata. A
    // quantity-bearing candidate must fail to parse - that case belongs to the
    // declared future primitive allocation-vector.
    expect(
      candidateSelection.inputSchema.safeParse(
        selectionInput(
          [{ ref: ref("subject-a"), classifications: [], allocatableMinor: usd(75000) } as never],
          "preference-order",
        ),
      ).success,
    ).toBe(false);
    expect(
      candidateSelection.inputSchema.safeParse(selectionInput([taxable], "pro-rata-allocation")).success,
    ).toBe(false);
  });
});

// ── restriction-screen ──────────────────────────────────────────────────────────

const screenParameters = {
  restrictionKinds: [
    { kind: "destination-instructions", polarity: "allow-list" },
    { kind: "account-holds", polarity: "deny-list" },
  ],
  subjectsInScope: ["destination-instruction", "source-account"],
};

const householdList = (entryRefs: readonly object[]) => ({
  sourceType: "household_instruction",
  sourceRef: ref("smiths-destination-restriction"),
  versionRef: ref("smiths-destination-restriction-v2"),
  kind: "destination-instructions",
  polarity: "allow-list",
  appliesToSlot: "destination-instruction",
  entryRefs,
});

const regulatoryHold = (entryRefs: readonly object[]) => ({
  sourceType: "regulatory",
  sourceRef: ref("reg-distribution-holds"),
  versionRef: ref("reg-distribution-holds-2026-02"),
  kind: "account-holds",
  polarity: "deny-list",
  appliesToSlot: "source-account",
  entryRefs,
});

const screenInput = (
  restrictions: readonly object[],
  subjects: Record<string, object> = {
    "destination-instruction": ref("instr-contractor-business"),
    "source-account": ref("subject-smiths-joint-taxable"),
  },
) => ({
  parameters: screenParameters,
  evidence: { restrictions },
  context: { subjects },
});

describe("restriction-screen", () => {
  const titled = [ref("instr-household-checking"), ref("instr-household-savings")];

  it("matches an off-list destination against a household allow-list with full attribution (GC-06)", () => {
    const published = evaluateParsed(restrictionScreen, screenInput([householdList(titled)]));
    expect(published["restrictions.matched.destination-instructions"]).toBe(true);
    expect(published["restrictions.matched.account-holds"]).toBe(false);
    expect(published["restrictions.matches"]).toEqual([
      {
        appliesToSlot: "destination-instruction",
        kind: "destination-instructions",
        matchedEntryRef: null,
        polarity: "allow-list",
        sourceRef: ref("smiths-destination-restriction"),
        sourceType: "household_instruction",
        subjectRef: ref("instr-contractor-business"),
        versionRef: ref("smiths-destination-restriction-v2"),
      },
    ]);
  });

  it("passes an on-list destination silently", () => {
    const published = evaluateParsed(
      restrictionScreen,
      screenInput([householdList([...titled, ref("instr-contractor-business")])]),
    );
    expect(published["restrictions.matched.destination-instructions"]).toBe(false);
    expect(published["restrictions.matches"]).toEqual([]);
  });

  it("matches an active hold on the source account as a regulatory deny-list (GC-07)", () => {
    const published = evaluateParsed(
      restrictionScreen,
      screenInput([regulatoryHold([ref("subject-smiths-joint-taxable")])]),
    );
    expect(published["restrictions.matched.account-holds"]).toBe(true);
    const matches = published["restrictions.matches"] as readonly Record<string, unknown>[];
    expect(matches[0]).toMatchObject({
      sourceType: "regulatory",
      matchedEntryRef: ref("subject-smiths-joint-taxable"),
    });
  });

  it("refuses undeclared kinds, contradicted polarity, out-of-scope slots, and unbound subjects", () => {
    expect(
      restrictionScreen.inputSchema.safeParse(
        screenInput([{ ...householdList(titled), kind: "velocity-limits" }]),
      ).success,
    ).toBe(false);
    expect(
      restrictionScreen.inputSchema.safeParse(
        screenInput([{ ...householdList(titled), polarity: "deny-list" }]),
      ).success,
    ).toBe(false);
    expect(
      restrictionScreen.inputSchema.safeParse(
        screenInput([{ ...householdList(titled), appliesToSlot: "beneficiary" }]),
      ).success,
    ).toBe(false);
    expect(
      restrictionScreen.inputSchema.safeParse(
        screenInput([householdList(titled)], { "destination-instruction": ref("instr-x") }),
      ).success,
    ).toBe(false);
  });

  it("binds each governing plane to its own reference brand - and is order-independent", () => {
    const both = [regulatoryHold([ref("subject-smiths-joint-taxable")]), householdList(titled)];
    const forward = evaluateParsed(restrictionScreen, screenInput(both));
    const reversed = evaluateParsed(restrictionScreen, screenInput([...both].reverse()));
    expectBytesEqual(forward, reversed);
    const matches = forward["restrictions.matches"] as readonly Record<string, unknown>[];
    expect(matches.map((match) => match.sourceType)).toEqual([
      "regulatory",
      "household_instruction",
    ]);
  });

  it("FALSIFICATION GUARD: aggregate-based restrictions are unrepresentable", () => {
    // 'No more than two distributions per quarter' would smuggle aggregation
    // into matching; the declared future primitive windowed-event-count owns it.
    expect(
      restrictionScreen.inputSchema.safeParse(
        screenInput([{ ...householdList(titled), maxPerQuarter: 2 }]),
      ).success,
    ).toBe(false);
  });
});

// ── evidence-reconciliation ─────────────────────────────────────────────────────

const reconciliationParameters = (tolerance: number) => ({
  factKind: "recorded-balance",
  sourcesToReconcile: [ref("source-system-a"), ref("source-system-b")],
  tolerance,
});

const assertion = (snapshot: string, source: string, value: number | string) => ({
  snapshotRef: ref(snapshot),
  sourceRef: ref(source),
  value,
});

const reconciliationInput = (tolerance: number, assertions: readonly object[]) => ({
  parameters: reconciliationParameters(tolerance),
  evidence: { assertions },
  context: {},
});

describe("evidence-reconciliation", () => {
  it("agrees within the configured tolerance", () => {
    const published = evaluateParsed(
      evidenceReconciliation,
      reconciliationInput(usd(1), [
        assertion("snap-a", "source-system-a", usd(420000)),
        assertion("snap-b", "source-system-b", usd(420000) + 50),
      ]),
    );
    expect(published["reconciliation.recorded-balance.consistent"]).toBe(true);
    expect(published["reconciliation.recorded-balance.contradictions"]).toEqual([]);
  });

  it("emits a contradiction citing both snapshots - and never the values (PII discipline)", () => {
    const published = evaluateParsed(
      evidenceReconciliation,
      reconciliationInput(0, [
        assertion("snap-a", "source-system-a", usd(420000)),
        assertion("snap-b", "source-system-b", usd(421000)),
      ]),
    );
    expect(published["reconciliation.recorded-balance.consistent"]).toBe(false);
    expect(published["reconciliation.recorded-balance.contradictions"]).toEqual([
      {
        left: { snapshotRef: ref("snap-a"), sourceRef: ref("source-system-a") },
        right: { snapshotRef: ref("snap-b"), sourceRef: ref("source-system-b") },
      },
    ]);
    expect(JSON.stringify(published)).not.toContain(String(usd(420000)));
    expect(JSON.stringify(published)).not.toContain(String(usd(421000)));
  });

  it("requires exact equality for string facts and refuses mixed-type agreement", () => {
    const strings = evaluateParsed(
      evidenceReconciliation,
      reconciliationInput(usd(100), [
        assertion("snap-a", "source-system-a", "recorded-value-one"),
        assertion("snap-b", "source-system-b", "recorded-value-two"),
      ]),
    );
    expect(strings["reconciliation.recorded-balance.consistent"]).toBe(false);
    const mixed = evaluateParsed(
      evidenceReconciliation,
      reconciliationInput(usd(100), [
        assertion("snap-a", "source-system-a", usd(1)),
        assertion("snap-b", "source-system-b", "one-hundred"),
      ]),
    );
    expect(mixed["reconciliation.recorded-balance.consistent"]).toBe(false);
  });

  it("is vacuously consistent below two assertions - sufficiency belongs to validation", () => {
    const published = evaluateParsed(
      evidenceReconciliation,
      reconciliationInput(0, [assertion("snap-a", "source-system-a", usd(1))]),
    );
    expect(published["reconciliation.recorded-balance.consistent"]).toBe(true);
  });

  it("refuses undeclared sources, duplicate snapshots, and single-source bindings", () => {
    expect(
      evidenceReconciliation.inputSchema.safeParse(
        reconciliationInput(0, [assertion("snap-a", "source-system-c", usd(1))]),
      ).success,
    ).toBe(false);
    expect(
      evidenceReconciliation.inputSchema.safeParse(
        reconciliationInput(0, [
          assertion("snap-a", "source-system-a", usd(1)),
          assertion("snap-a", "source-system-b", usd(2)),
        ]),
      ).success,
    ).toBe(false);
    expect(
      evidenceReconciliation.parameterSchema.safeParse({
        ...reconciliationParameters(0),
        sourcesToReconcile: [ref("source-system-a")],
      }).success,
    ).toBe(false);
  });

  it("is order-independent over assertion order", () => {
    const assertions = [
      assertion("snap-c", "source-system-a", usd(3)),
      assertion("snap-a", "source-system-a", usd(1)),
      assertion("snap-b", "source-system-b", usd(2)),
    ];
    const forward = evaluateParsed(evidenceReconciliation, reconciliationInput(0, assertions));
    const reversed = evaluateParsed(
      evidenceReconciliation,
      reconciliationInput(0, [...assertions].reverse()),
    );
    expectBytesEqual(forward, reversed);
  });

  it("FALSIFICATION GUARD: trust hierarchies are unrepresentable", () => {
    // If contradictions were resolved by preferring a source, this would be
    // fixed machinery, not configurable judgment - the ratified demotion case.
    expect(
      evidenceReconciliation.parameterSchema.safeParse({
        ...reconciliationParameters(0),
        preferSource: ref("source-system-a"),
      }).success,
    ).toBe(false);
  });
});

// ── shared vocabulary + published-key discipline ───────────────────────────────

describe("published-key discipline", () => {
  it("key segments are kebab-case and dates are plain ISO dates", () => {
    expect(KeySegmentSchema.safeParse("pending-activity").success).toBe(true);
    expect(KeySegmentSchema.safeParse("Pending").success).toBe(false);
    expect(KeySegmentSchema.safeParse("a.b").success).toBe(false);
    expect(IsoDateSchema.safeParse("2026-07-26").success).toBe(true);
    expect(IsoDateSchema.safeParse("2026-07-26T00:00:00.000Z").success).toBe(false);
  });

  it("every declared key map is canonically ordered with valid descriptors, and outputs stay inside it", () => {
    const cases: readonly {
      keys: Record<string, unknown>;
      output: Record<string, unknown>;
    }[] = [
      {
        keys: netAvailability.publishedKeys(
          netAvailability.parameterSchema.parse(availabilityParameters),
        ),
        output: evaluateParsed(netAvailability, availabilityInput([], usd(1))),
      },
      {
        keys: horizonProjection.publishedKeys(),
        output: evaluateParsed(horizonProjection, projectionInput(1, [])),
      },
      {
        keys: sufficiencyCheck.publishedKeys(),
        output: evaluateParsed(sufficiencyCheck, floorInput(1, 0, 1)),
      },
      {
        keys: candidateSelection.publishedKeys(
          candidateSelection.parameterSchema.parse(selectionParameters),
        ),
        output: evaluateParsed(
          candidateSelection,
          selectionInput([{ ref: ref("subject-a"), classifications: [] }], "single-eligible"),
        ),
      },
      {
        keys: restrictionScreen.publishedKeys(
          restrictionScreen.parameterSchema.parse(screenParameters),
        ),
        output: evaluateParsed(restrictionScreen, screenInput([])),
      },
      {
        keys: evidenceReconciliation.publishedKeys(
          evidenceReconciliation.parameterSchema.parse(reconciliationParameters(0)),
        ),
        output: evaluateParsed(evidenceReconciliation, reconciliationInput(0, [])),
      },
    ];
    for (const { keys, output } of cases) {
      const declared = Object.keys(keys);
      expect(declared).toEqual([...declared].sort());
      for (const descriptor of Object.values(keys)) {
        expect(PublishedValueDescriptorSchema.safeParse(descriptor).success).toBe(true);
      }
      const alwaysKeys = declared.filter(
        (key) => (keys[key] as { presence: string }).presence === "always",
      );
      const produced = Object.keys(output);
      expect(produced).toEqual([...produced].sort());
      for (const key of produced) expect(declared).toContain(key);
      for (const key of alwaysKeys) expect(produced).toContain(key);
    }
  });
});
