import { describe, expect, it } from "vitest";
import { syntheticSemanticProblems } from "../../../scripts/corpus/synthetic-semantics";
import { specReferenceProblems } from "../../../scripts/corpus/world";
import { real } from "./_corpus-world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - synthetic structural context:
 * selected funding, identity bindings, pending semantics, instruction conflicts,
 * DST transitions, and blast radius.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("synthetic selected funding is explicit, unique, and owned by the request household", () => {
    for (const item of real.cases) {
      const selected = (item.request as Record<string, unknown>)
        .selectedFundingRefs;
      expect(Array.isArray(selected)).toBe(true);
      expect((selected as string[]).length).toBeGreaterThan(0);
      expect(new Set(selected as string[]).size).toBe(
        (selected as string[]).length,
      );
      for (const accountRef of selected as string[]) {
        expect(
          item.records.accounts.filter(
            (account) =>
              account.id === accountRef &&
              account.householdRef === item.request.householdRef,
          ),
        ).toHaveLength(1);
      }
    }

    const duplicate = structuredClone(real.spec.cases) as Record<
      string,
      any
    >;
    duplicate.cases[0].request.selectedFundingRefs = [
      "smiths-joint-taxable",
      "smiths-joint-taxable",
    ];
    expect(
      specReferenceProblems(real.spec.world, duplicate as any).join("\n"),
    ).toContain("selectedFundingRefs: duplicate reference");

    const crossHousehold = structuredClone(real.spec.cases) as Record<
      string,
      any
    >;
    crossHousehold.cases[0].request.selectedFundingRefs = ["mira-roth"];
    expect(
      specReferenceProblems(
        real.spec.world,
        crossHousehold as any,
      ).join("\n"),
    ).toContain("selected funding account belongs to household");
  });

  it("synthetic identity context derives from exact emitted inputs and bindings", () => {
    const ambiguous = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-identity-trust-name-collision",
      )!,
    ) as any;
    expect(ambiguous.identityInput.candidates).toHaveLength(2);
    expect(
      ambiguous.records.referencedHouseholds,
    ).toContainEqual({
      id: "subject:smith-mira",
      relationshipReasons: ["identity-candidate"],
    });
    expect(syntheticSemanticProblems([ambiguous])).toEqual([]);

    const assumptionOnly = structuredClone(ambiguous);
    delete assumptionOnly.identityInput;
    expect(
      syntheticSemanticProblems([assumptionOnly]).join("\n"),
    ).toContain("identity context requires typed identity input");

    const singleCandidate = structuredClone(ambiguous);
    singleCandidate.identityInput.candidates.pop();
    expect(
      syntheticSemanticProblems([singleCandidate]).join("\n"),
    ).toContain("must resolve to multiple exact candidates");

    const unboundCandidate = structuredClone(ambiguous);
    unboundCandidate.identityInput.candidates[1].householdRef =
      "subject:unknown-household";
    expect(
      syntheticSemanticProblems([unboundCandidate]).join("\n"),
    ).toContain("resolve to its bound household entity");

    const mismatchedSpec = structuredClone(real.spec.cases) as any;
    const identityCase = mismatchedSpec.cases.find(
      (item: Record<string, unknown>) =>
        item.key === "identity-trust-name-collision",
    );
    identityCase.identityInput.candidates[1] = {
      entityKind: "party",
      entityRef: "mira-smith",
      householdRef: "smiths",
      rawUtf8Hex: "536d697468",
    };
    expect(
      specReferenceProblems(
        real.spec.world,
        mismatchedSpec,
      ).join("\n"),
    ).toContain("party candidate is not a member");

    const canonical = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-non-ascii-roster-identity",
      )!,
    ) as any;
    expect(canonical.identityInput.unresolvedRawUtf8Hex).not.toBe(
      canonical.identityInput.candidates[0].rawUtf8Hex,
    );
    expect(canonical.identityInput.canonicalValue).toBe(
      canonical.identityInput.candidates[0].canonicalValue,
    );
    expect(syntheticSemanticProblems([canonical])).toEqual([]);

    canonical.identityInput.candidates[0].rawUtf8Hex =
      canonical.identityInput.unresolvedRawUtf8Hex;
    expect(
      syntheticSemanticProblems([canonical]).join("\n"),
    ).toContain("do not reproduce a canonical collision");
  });

  it("synthetic pending semantics use only the exact selected funding set", () => {
    const pendingAction = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-blocked-pending-action",
      )!,
    );
    pendingAction.records.pendingActions.find(
      (row) => row.id === "pending:smiths-blocked-transfer",
    )!.accountRef = "subject:smiths-ira";
    expect(
      syntheticSemanticProblems([pendingAction]).join("\n"),
    ).toContain("selected funding");

    const pendingModel = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-pending-rebalance-during-evaluation",
      )!,
    );
    pendingModel.records.modelAssignments.find(
      (row) => row.pendingRebalance,
    )!.accountRef = "subject:smiths-ira";
    expect(
      syntheticSemanticProblems([pendingModel]).join("\n"),
    ).toContain("selected funding");

    const liveOutgoing = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-segmented-withdrawal-schedule",
      )!,
    );
    liveOutgoing.records.pendingActions.find(
      (row) => row.id === "pending:smiths-transfer",
    )!.accountRef = "subject:smiths-ira";
    expect(
      syntheticSemanticProblems([liveOutgoing]).join("\n"),
    ).toContain("selected funding");
  });

  it("synthetic instruction conflicts derive only from request-bound typed terms", () => {
    const conflict = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-joint-owners-conflicting-instructions",
      )!,
    ) as any;
    expect(syntheticSemanticProblems([conflict])).toEqual([]);

    const assumptionOnly = structuredClone(conflict);
    for (const restriction of assumptionOnly.records.restrictions) {
      restriction.term = null;
    }
    expect(
      syntheticSemanticProblems([assumptionOnly]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const unconnected = structuredClone(conflict);
    for (const restriction of unconnected.records.restrictions) {
      if (restriction.term !== null) {
        restriction.term.sourceAccountRef = "subject:smiths-ira";
      }
    }
    expect(
      syntheticSemanticProblems([unconnected]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const expired = structuredClone(conflict);
    for (const restriction of expired.records.restrictions) {
      restriction.inForceAtAsOf = false;
    }
    expect(
      syntheticSemanticProblems([expired]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const governed = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-clean-in-force-instruction",
      )!,
    );
    expect(syntheticSemanticProblems([governed])).toEqual([]);
  });

  it("synthetic DST context requires exact zone-bound records crossing a declared transition", () => {
    const original = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId === "CS-dst-straddling-observations",
    )!,
    ) as any;
    expect(syntheticSemanticProblems([original])).toEqual([]);
    expect(original.trigger.timeZoneTransitions).toEqual(
      real.spec.world.clock.transitions,
    );

    const sameOffset = structuredClone(original);
    const standard = sameOffset.trigger.timeZoneTransitions.find(
      (transition: any) =>
        transition.at === "2025-11-02T06:00:00.000Z",
    );
    standard.offsetMinutes = -240;
    sameOffset.evidence.find(
      (evidence: any) =>
        evidence.subjectRef === "change:smiths-review-est",
    ).recordChangedAtLocal = "2025-11-02T05:00:00.000-04:00";
    expect(
      syntheticSemanticProblems([sameOffset]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const missingZone = structuredClone(original);
    delete missingZone.evidence.find(
      (evidence: any) => evidence.kind === "recent-change",
    ).localZone;
    expect(
      syntheticSemanticProblems([missingZone]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const assumptionOnly = structuredClone(original);
    assumptionOnly.evidence = assumptionOnly.evidence.filter(
      (evidence: any) => evidence.kind !== "recent-change",
    );
    assumptionOnly.records.recentChanges = [];
    expect(
      syntheticSemanticProblems([assumptionOnly]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );
  });

  it("synthetic blast radius requires one cited changed instruction with multiple governed accounts", () => {
    const original = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId ===
            "CS-shared-instruction-change-blast-radius",
      )!,
    ) as any;
    expect(syntheticSemanticProblems([original])).toEqual([]);

    const unconnected = structuredClone(original);
    unconnected.records.bankInstructions.find(
      (instruction: any) =>
        instruction.id === unconnected.request.destinationRef,
    ).accountRefs = [unconnected.request.sourceAccountRef];
    expect(
      syntheticSemanticProblems([unconnected]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const distinctInstruction = structuredClone(original);
    distinctInstruction.records.recentChanges[0].subjectRef =
      "bank-instruction:smiths-trust-alt";
    expect(
      syntheticSemanticProblems([distinctInstruction]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const mismatchedChange = structuredClone(original);
    mismatchedChange.records.bankInstructions.find(
      (instruction: any) =>
        instruction.id === mismatchedChange.request.destinationRef,
    ).changedAt = "2026-07-21T18:12:00.000Z";
    expect(
      syntheticSemanticProblems([mismatchedChange]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );

    const correctlyTreated = structuredClone(original);
    correctlyTreated.label = {
      kind: "clean-control",
      controlRationale: "all impacted accounts are reevaluated",
    };
    correctlyTreated.outcomes[0].observedTreatment =
      correctlyTreated.outcomes[0].expectedTreatment;
    expect(syntheticSemanticProblems([correctlyTreated])).toEqual([]);
  });
});
