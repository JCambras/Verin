import { describe, expect, it } from "vitest";
import {
  realDerivedCaseProblems,
  realDerivedSemanticContractProblems,
} from "../../../scripts/corpus/scrub-contract";
import {
  ACTOR_REF_ALT,
  treatmentOutcomes,
} from "./_corpus-case-fixtures";
import {
  realDerivedCase,
  realDerivedDefectCase,
} from "./_corpus-real-derived-fixtures";
import { classes } from "./_corpus-world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - closed replay treatments:
 * retirement review, reserve schedules, the signed threshold comparator, and the
 * restriction lifecycle recomputed from effective instants.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("retirement treatment requires a completed review or an explicit mismatch", () => {
    const defect = realDerivedDefectCase("tax-consequence-blindness");
    expect(
      realDerivedCaseProblems(
        defect,
        classes,
        "real-derived/RD-tax-pending.json",
      ),
    ).toEqual([]);

    const contradicted = structuredClone(defect);
    (contradicted.replayPayload as Record<string, any>).taxReviewState =
      "completed";
    expect(
      realDerivedCaseProblems(
        contradicted,
        classes,
        "real-derived/RD-tax-completed-mismatch.json",
      ).join("\n"),
    ).toContain("claims a defect treatment without its required context");

    const impossible = structuredClone(defect);
    (impossible.replayPayload as Record<string, any>).taxReviewState =
      "not-required";
    expect(
      realDerivedCaseProblems(
        impossible,
        classes,
        "real-derived/RD-tax-not-required.json",
      ).join("\n"),
    ).toContain("selected retirement funding cannot declare tax review not required");
  });

  it("reserve treatments distinguish scalar, segmented, and missing schedules", () => {
    const segmented = realDerivedDefectCase(
      "liquidity-reserve-miscalculation",
    );
    const segmentedOutcome = (
      (segmented.replayPayload as Record<string, any>).outcomes as Array<
        Record<string, string>
      >
    ).find(
      (outcome) =>
        outcome.defectClassId === "liquidity-reserve-miscalculation",
    )!;
    expect(segmentedOutcome).toMatchObject({
      expectedTreatment: "calculate-segmented-reserve",
      observedTreatment: "calculate-scalar-reserve",
    });
    expect(
      realDerivedCaseProblems(
        segmented,
        classes,
        "real-derived/RD-segmented-reserve.json",
      ),
    ).toEqual([]);

    const missing = structuredClone(segmented);
    const missingPayload = missing.replayPayload as Record<string, any>;
    missingPayload.liquidity.reserveState = "missing";
    missingPayload.liquidity.reserveRequiredMinor = null;
    missingPayload.liquidity.withdrawalSegmentsMinor = [];
    missingPayload.outcomes = treatmentOutcomes(
      missingPayload,
      "liquidity-reserve-miscalculation",
    );
    expect(
      missingPayload.outcomes.find(
        (outcome: Record<string, string>) =>
          outcome.defectClassId === "liquidity-reserve-miscalculation",
      ),
    ).toMatchObject({
      expectedTreatment: "mark-reserve-unavailable",
      observedTreatment: "invent-reserve-from-missing-schedule",
    });
    expect(
      realDerivedCaseProblems(
        missing,
        classes,
        "real-derived/RD-missing-reserve.json",
      ),
    ).toEqual([]);
  });

  it("threshold treatment follows the signed strict or inclusive comparator", () => {
    const strict = realDerivedDefectCase("threshold-boundary-error");
    const strictPayload = strict.replayPayload as Record<string, any>;
    expect(
      strictPayload.outcomes.find(
        (outcome: Record<string, string>) =>
          outcome.defectClassId === "threshold-boundary-error",
      ),
    ).toMatchObject({
      expectedTreatment: "apply-strict-threshold-boundary",
      observedTreatment: "apply-inclusive-threshold-boundary",
    });
    expect(
      realDerivedCaseProblems(
        strict,
        classes,
        "real-derived/RD-strict-threshold.json",
      ),
    ).toEqual([]);

    const inclusive = structuredClone(strict);
    const inclusivePayload = inclusive.replayPayload as Record<string, any>;
    inclusivePayload.policy.thresholdComparator = "inclusive";
    inclusivePayload.outcomes = treatmentOutcomes(
      inclusivePayload,
      "threshold-boundary-error",
    );
    expect(
      inclusivePayload.outcomes.find(
        (outcome: Record<string, string>) =>
          outcome.defectClassId === "threshold-boundary-error",
      ),
    ).toMatchObject({
      expectedTreatment: "apply-inclusive-threshold-boundary",
      observedTreatment: "apply-strict-threshold-boundary",
    });
    expect(
      realDerivedCaseProblems(
        inclusive,
        classes,
        "real-derived/RD-inclusive-threshold.json",
      ),
    ).toEqual([]);

    const unsignedComparator = structuredClone(strict);
    delete (unsignedComparator.replayPayload as Record<string, any>).policy
      .thresholdComparator;
    expect(
      realDerivedCaseProblems(
        unsignedComparator,
        classes,
        "real-derived/RD-missing-threshold-comparator.json",
      ).join("\n"),
    ).toContain("schema validation failed");
  });

  it("the real-derived semantic registry exactly covers the signed taxonomy", () => {
    expect(realDerivedSemanticContractProblems(classes)).toEqual([]);
    const missing = new Set(classes);
    missing.delete("destination-integrity-defect");
    expect(realDerivedSemanticContractProblems(missing).join("\n")).toContain(
      "reference unknown defect class",
    );
    expect(
      realDerivedSemanticContractProblems(
        new Set([...classes, "invented-defect"]),
      ).join("\n"),
    ).toContain("missing defect class");
  });

  it("a semantically clean real-derived control is accepted", () => {
    const control = realDerivedCase({
      label: {
        kind: "clean-control",
        controlRationaleId: "no-defect-present",
      },
    });
    ((control.replayPayload as Record<string, any>).destination).discriminatorState =
      "unique";
    expect(
      realDerivedCaseProblems(
        control,
        classes,
        "real-derived/RD-clean.json",
      ),
    ).toEqual([]);
  });

  it.each([...classes])(
    "the %s signature is live and cannot pass as a clean control",
    (defectClassId) => {
      const defect = realDerivedDefectCase(defectClassId);
      expect(
        realDerivedCaseProblems(
          defect,
          classes,
          `real-derived/RD-${defectClassId}.json`,
        ),
      ).toEqual([]);
      const control = structuredClone(defect);
      control.label = {
        kind: "clean-control",
        controlRationaleId: "defect-class-absent",
      };
      expect(
        realDerivedCaseProblems(
          control,
          classes,
          `real-derived/RD-${defectClassId}-control.json`,
        ).join("\n"),
      ).toContain("clean-control carries replay defect signatures");
    },
  );

  it("recomputes restriction lifecycle from effective instants", () => {
    const defect = realDerivedDefectCase("restriction-lifecycle-error");
    const policy = (defect.replayPayload as Record<string, any>).policy;
    policy.restrictionEffectiveFrom = "2026-01-01T00:00:00.000Z";
    policy.restrictionEffectiveTo = null;
    expect(
      realDerivedCaseProblems(
        defect,
        classes,
        "real-derived/RD-forged-restriction-state.json",
      ).join("\n"),
    ).toContain("restriction lifecycle state");
  });

  it("replay states require coherent supporting facts", () => {
    const uniqueWithTwoCandidates = realDerivedCase();
    (uniqueWithTwoCandidates.replayPayload as Record<string, any>)
      .identity.candidateRefs.push(ACTOR_REF_ALT);

    const ambiguousWithOneCandidate = realDerivedCase();
    (ambiguousWithOneCandidate.replayPayload as Record<string, any>)
      .identity.resolution = "ambiguous";

    const authorityWithoutGrant = realDerivedCase();
    Object.assign(
      (authorityWithoutGrant.replayPayload as Record<string, any>).authority,
      { grantRef: null, validFrom: null },
    );

    const absentHoldWithScope = realDerivedCase();
    (absentHoldWithScope.replayPayload as Record<string, any>)
      .policy.legalHoldScope = "position";

    const missingReserveWithSchedule = realDerivedCase();
    (missingReserveWithSchedule.replayPayload as Record<string, any>)
      .liquidity.reserveState = "missing";

    const segmentedReserveWithoutSegments = realDerivedCase();
    Object.assign(
      (segmentedReserveWithoutSegments.replayPayload as Record<string, any>)
        .liquidity,
      { reserveState: "modeled-segmented", withdrawalSegmentsMinor: [] },
    );

    for (const candidate of [
      uniqueWithTwoCandidates,
      ambiguousWithOneCandidate,
      authorityWithoutGrant,
      absentHoldWithScope,
      missingReserveWithSchedule,
      segmentedReserveWithoutSegments,
    ]) {
      expect(
        realDerivedCaseProblems(
          candidate,
          classes,
          "real-derived/RD-incoherent-state.json",
        ).join("\n"),
      ).toContain("schema validation failed");
    }
  });
});
