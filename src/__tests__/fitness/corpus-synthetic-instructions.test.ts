import { describe, expect, it } from "vitest";
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import { instructionConflictAnalysis } from "../../../scripts/corpus/instruction-conflicts";
import { realDerivedCaseProblems } from "../../../scripts/corpus/scrub-contract";
import { syntheticSemanticProblems } from "../../../scripts/corpus/synthetic-semantics";
import {
  ACCOUNT_REF,
  ACTOR_REF,
  FIRM_REF,
  HOUSEHOLD_REF,
  INSTRUCTION_REF,
  INSTRUCTION_REF_ALT,
  OWNER_REF,
  OWNER_REF_ALT,
  REQUEST_REF,
  treatmentOutcomes,
} from "./_corpus-case-fixtures";
import { realDerivedDefectCase } from "./_corpus-real-derived-fixtures";
import {
  classes,
  real,
} from "./_corpus-world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - synthetic instruction ownership,
 * tax semantics, reserve schedules, and the pending-availability authority the
 * two partitions share.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("instruction owner cardinality is target-specific for joint destinations", () => {
    const request = {
      firmRef: FIRM_REF,
      requestRef: REQUEST_REF,
      householdRef: HOUSEHOLD_REF,
      action: "distribution" as const,
      sourceAccountRef: ACCOUNT_REF,
      destinationRef: INSTRUCTION_REF,
      destinationSubjectRefs: [OWNER_REF_ALT, OWNER_REF],
    };
    const witness = (
      targetKind:
        | "source-account"
        | "destination-instruction"
        | "destination-subject"
        | "request",
      targetRef: string,
      polarity: "required" | "forbidden",
    ) => [{
      instructionRef: INSTRUCTION_REF_ALT,
      firmRef: FIRM_REF,
      householdRef: HOUSEHOLD_REF,
      term: {
        governedAction: "distribution" as const,
        sourceAccountRef: ACCOUNT_REF,
        targetKind,
        targetRef,
        polarity,
      },
    }];

    expect(
      instructionConflictAnalysis(
        request,
        witness("source-account", ACCOUNT_REF, "required"),
      ),
    ).toEqual({ present: false, problems: [] });
    expect(
      instructionConflictAnalysis(
        request,
        witness("destination-subject", OWNER_REF_ALT, "forbidden"),
      ),
    ).toEqual({ present: true, problems: [] });
    expect(
      instructionConflictAnalysis(
        request,
        witness("destination-subject", ACTOR_REF, "forbidden"),
      ),
    ).toEqual({ present: false, problems: [] });

    expect(
      instructionConflictAnalysis(
        {
          ...request,
          destinationSubjectRefs: [OWNER_REF, OWNER_REF],
        },
        witness("request", REQUEST_REF, "required"),
      ).problems,
    ).toContain("instruction conflict request is incomplete or ambiguous");

    const realDerivedJoint = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    );
    (
      (realDerivedJoint.replayPayload as Record<string, any>)
        .destination.ownerRefs as string[]
    ).push(OWNER_REF_ALT);
    (realDerivedJoint.subjects as string[]).push(OWNER_REF_ALT);
    expect(
      realDerivedCaseProblems(
        realDerivedJoint,
        classes,
        "real-derived/RD-joint-destination.json",
      ),
    ).toEqual([]);
  });

  it("the Mira prohibition resolves the exact request destination subject", () => {
    const item = structuredClone(
      real.cases.find(
        (candidate) =>
          candidate.caseId ===
            "CS-beneficiary-versus-destination-restriction",
      )!,
    ) as any;
    const restriction = item.records.restrictions.find(
      (entry: any) => entry.id === "restriction:smiths-destination",
    );
    const destination = item.records.referencedBankInstructions.find(
      (entry: any) => entry.id === item.request.destinationRef,
    );
    expect(restriction.term.targetRef).toBe("subject:mira-smith");
    expect(destination.titledTo).toBe("subject:mira-smith");
    expect(syntheticSemanticProblems([item])).toEqual([]);

    restriction.term.targetRef = "subject:robert-smith";
    expect(
      syntheticSemanticProblems([item]).join("\n"),
    ).toContain(
      "defect label lacks one matching expected-versus-observed treatment mismatch",
    );
  });

  it("synthetic tax semantics and defaults use all and only selected funding", () => {
    const item = structuredClone(
      real.cases.find(
        (candidate) => candidate.caseId === "CS-cross-household-signer",
      )!,
    );
    item.request.selectedFundingRefs.push("subject:smiths-ira");
    item.taxReviewState = "not-required";
    expect(
      syntheticSemanticProblems([item]).join("\n"),
    ).toContain(
      'active "tax-consequence-blindness" context lacks a typed treatment',
    );

    const spec = structuredClone(real.spec);
    const input = spec.cases.cases.find(
      (candidate) => candidate.key === "cross-household-signer",
    )!;
    input.request.selectedFundingRefs.push("smiths-ira");
    const generated = generateSyntheticCases(spec).find(
      (file) => file.relPath ===
        "synthetic/CS-cross-household-signer.json",
    )!.value as Record<string, unknown>;
    expect(generated.taxReviewState).toBe("completed");
  });

  it("synthetic reserve state comes from emitted schedules", () => {
    const item = structuredClone(
      real.cases.find(
        (candidate) =>
          candidate.caseId === "CS-absent-withdrawal-schedule",
      )!,
    );
    item.records.plannedWithdrawals.push({
      id: "withdrawal:contradiction",
      householdRef: item.request.householdRef,
      segments: [{ monthlyMinor: 1 }],
    });
    expect(
      syntheticSemanticProblems([item]).join("\n"),
    ).toContain("AS-12 contradicts emitted withdrawal schedules");

    const segmented = structuredClone(
      real.cases.find(
        (candidate) =>
          candidate.caseId === "CS-segmented-withdrawal-schedule",
      )!,
    );
    segmented.evidence = segmented.evidence.filter(
      (entry) => entry.kind !== "planned-withdrawals",
    );
    segmented.label = { kind: "clean-control" };
    const outcome = segmented.outcomes.find(
      (candidate) =>
        candidate.defectClassId === "liquidity-reserve-miscalculation",
    )!;
    outcome.expectedTreatment = "calculate-scalar-reserve";
    outcome.observedTreatment = "calculate-scalar-reserve";
    expect(
      syntheticSemanticProblems([segmented]).join("\n"),
    ).toContain(
      'outcome "liquidity-reserve-miscalculation" has no single treatment selector',
    );
  });

  it("a settling incoming transfer uses the shared nonreducing pending authority", () => {
    const item = realDerivedDefectCase(
      "pending-activity-miscount",
    );
    const action = (item.replayPayload as Record<string, any>).liquidity
      .pendingAction;
    Object.assign(action, {
      actionKind: "incoming-transfer",
      actionState: "settling",
      direction: "incoming",
      liquidityClass: "credit",
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: false,
    });
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-settling-incoming.json",
      ),
    ).toEqual([]);
  });

  it("reconciles zero-effect actions already reflected in reported availability", () => {
    const incoming = realDerivedDefectCase("pending-activity-miscount");
    const incomingPayload = incoming.replayPayload as Record<string, any>;
    Object.assign(incomingPayload.liquidity.pendingAction, {
      actionKind: "incoming-transfer",
      actionState: "settling",
      direction: "incoming",
      liquidityClass: "credit",
      availableMinorIncludesAction: true,
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: false,
    });
    incomingPayload.liquidity.sources[0].availableMinor = 11_000;
    incomingPayload.outcomes = treatmentOutcomes(
      incomingPayload,
      "pending-activity-miscount",
    );
    expect(
      realDerivedCaseProblems(
        incoming,
        classes,
        "real-derived/RD-included-settling-incoming.json",
      ).join("\n"),
    ).toContain("exact-once pending-action accounting");

    const outgoing = realDerivedDefectCase("pending-activity-miscount");
    const outgoingPayload = outgoing.replayPayload as Record<string, any>;
    outgoingPayload.liquidity.pendingAction.availableMinorIncludesAction = true;
    outgoingPayload.liquidity.sources[0].availableMinor = 10_500;
    expect(
      realDerivedCaseProblems(
        outgoing,
        classes,
        "real-derived/RD-included-blocked-outgoing.json",
      ),
    ).toEqual([]);

    const unknown = realDerivedDefectCase("pending-activity-miscount");
    const unknownPayload = unknown.replayPayload as Record<string, any>;
    Object.assign(unknownPayload.liquidity.pendingAction, {
      actionKind: "unknown",
      actionState: "blocked",
      direction: "unknown",
      liquidityClass: "unclassified",
      availableMinorIncludesAction: true,
    });
    unknownPayload.outcomes = treatmentOutcomes(
      unknownPayload,
      "pending-activity-miscount",
    );
    expect(
      realDerivedCaseProblems(
        unknown,
        classes,
        "real-derived/RD-included-unknown-direction.json",
      ).join("\n"),
    ).toContain("requires a known liquidity direction");
  });

  it("a settled incoming credit has a distinct availability treatment in both partitions", () => {
    const realDerived = realDerivedDefectCase("pending-activity-miscount");
    const payload = realDerived.replayPayload as Record<string, any>;
    Object.assign(payload.liquidity.pendingAction, {
      actionKind: "incoming-credit",
      actionState: "settled",
      direction: "incoming",
      liquidityClass: "credit",
      availableMinorIncludesAction: true,
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: true,
    });
    expect(
      realDerivedCaseProblems(
        realDerived,
        classes,
        "real-derived/RD-settled-incoming-generic.json",
      ).join("\n"),
    ).toContain(
      'outcome "pending-activity-miscount" is outside its closed treatment vocabulary',
    );
    payload.outcomes = treatmentOutcomes(
      payload,
      "pending-activity-miscount",
    );
    const realDerivedOutcome = payload.outcomes.find(
      (outcome: Record<string, string>) =>
        outcome.defectClassId === "pending-activity-miscount",
    );
    expect(realDerivedOutcome).toEqual({
      defectClassId: "pending-activity-miscount",
      expectedTreatment: "preserve-settled-incoming-availability",
      observedTreatment: "omit-settled-incoming-availability",
    });
    expect(
      realDerivedCaseProblems(
        realDerived,
        classes,
        "real-derived/RD-settled-incoming.json",
      ),
    ).toEqual([]);

    const synthetic = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-blocked-pending-action",
      )!,
    );
    const syntheticAction = synthetic.records.pendingActions.find(
      (action) => action.state === "blocked",
    )!;
    Object.assign(syntheticAction, {
      kind: "incoming-credit",
      state: "settled",
      direction: "incoming",
      liquidityClass: "credit",
      availableMinorIncludesAction: true,
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: true,
    });
    const syntheticOutcome = synthetic.outcomes.find(
      (outcome) => outcome.defectClassId === "pending-activity-miscount",
    )!;
    expect(syntheticSemanticProblems([synthetic]).join("\n")).toContain(
      'outcome "pending-activity-miscount" is outside its closed treatment vocabulary',
    );
    syntheticOutcome.expectedTreatment =
      "preserve-settled-incoming-availability";
    syntheticOutcome.observedTreatment =
      "omit-settled-incoming-availability";
    expect(syntheticSemanticProblems([synthetic])).toEqual([]);

    payload.liquidity.pendingAction.availableMinorIncludesAction = false;
    payload.outcomes = treatmentOutcomes(
      payload,
      "pending-activity-miscount",
    );
    expect(
      payload.outcomes.find(
        (outcome: Record<string, string>) =>
          outcome.defectClassId === "pending-activity-miscount",
      ),
    ).toEqual({
      defectClassId: "pending-activity-miscount",
      expectedTreatment: "credit-settled-incoming-availability",
      observedTreatment: "omit-settled-incoming-availability",
    });
    payload.liquidity.sources[0].availableMinor = 10_500;
    expect(
      realDerivedCaseProblems(
        realDerived,
        classes,
        "real-derived/RD-settled-credit-not-included.json",
      ),
    ).toEqual([]);
    payload.liquidity.pendingAction.availableMinorIncludesAction = true;
    payload.outcomes = treatmentOutcomes(
      payload,
      "pending-activity-miscount",
    );
    expect(
      realDerivedCaseProblems(
        realDerived,
        classes,
        "real-derived/RD-settled-credit-included.json",
      ).join("\n"),
    ).toContain("exact-once pending-action accounting");

    const ambiguous = structuredClone(realDerived);
    const ambiguousPayload = ambiguous.replayPayload as Record<string, any>;
    delete ambiguousPayload.liquidity.pendingAction
      .availableMinorIncludesAction;
    expect(
      realDerivedCaseProblems(
        ambiguous,
        classes,
        "real-derived/RD-settled-credit-ambiguous.json",
      ).join("\n"),
    ).toContain("schema validation failed");

    syntheticAction.availableMinorIncludesAction = false;
    syntheticOutcome.expectedTreatment =
      "credit-settled-incoming-availability";
    expect(syntheticSemanticProblems([synthetic])).toEqual([]);
  });
});
