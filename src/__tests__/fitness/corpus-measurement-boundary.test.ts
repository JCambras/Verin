import { describe, expect, it } from "vitest";
import { taxonomyExerciseProblems } from "../../../scripts/corpus/defects";
import { generatedSignatureProblems } from "../../../scripts/corpus/manifest";
import * as corpusReportRuntime from "../../../scripts/corpus/report";
import {
  renderCorpusReport,
  type RealDerivedCaseOutcome,
} from "../../../scripts/corpus/report";
import { realDerivedCaseProblems } from "../../../scripts/corpus/scrub-contract";
import { semanticTreatment } from "../../../scripts/corpus/semantic-contract";
import { labelProblems } from "../../../scripts/corpus/validate";
import {
  HOUSEHOLD_REF_ALT,
  semanticContract,
} from "./_corpus-case-fixtures";
import {
  realDerivedCase,
  realDerivedDefectCase,
} from "./_corpus-real-derived-fixtures";
import {
  inventoryOf,
  outcomes,
  reportExportProblems,
  reportInput,
  signedSignoff,
} from "./_corpus-report-fixtures";
import {
  classes,
  goldenIds,
  real,
  refs,
} from "./_corpus-world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - the measurement boundary: coverage
 * beside false positives, withheld figures with reason codes, signed-inventory
 * binding, and the real-derived label semantics the figures are computed from.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("a defect class carried by NO case is flagged (an unexercised class is decoration)", () => {
    const orphaned = real.taxonomy.defectClasses[0]!.id;
    const withoutIt = {
      ...real.spec.cases,
      cases: real.spec.cases.cases.filter(
        (entry) => entry.label.kind !== "defect" || entry.label.defectClassId !== orphaned,
      ),
    };
    const problems = taxonomyExerciseProblems(real.taxonomy, withoutIt);
    expect(problems.some((p) => p.includes(orphaned) && p.includes("unexercised class is decoration"))).toBe(true);
    expect(taxonomyExerciseProblems(real.taxonomy, real.spec.cases)).toEqual([]);
  });

  it("a corpus with NO clean controls is flagged (coverage without false positives is not a measurement)", () => {
    const onlyDefects = real.cases.filter((item) => item.label.kind === "defect").slice(0, 3);
    const problems = labelProblems(onlyDefects, real.taxonomy, refs.provenanceLabels, goldenIds);
    expect(problems.some((p) => p.includes("no labeled clean controls"))).toBe(true);
  });

  it("a POPULATED real-derived partition DOES produce a detectionRate (null is a real branch, not a stub)", () => {
    const realDerivedOutcomes: RealDerivedCaseOutcome[] = [
      {
        caseId: "RD-a",
        attributedDefectClassIds: ["test-defect"],
        provenance: "real-derived-fixture",
      },
      {
        caseId: "RD-b",
        attributedDefectClassIds: [],
        provenance: "real-derived-fixture",
      },
      {
        caseId: "RD-c",
        attributedDefectClassIds: [],
        provenance: "real-derived-fixture",
      },
    ];
    const report = renderCorpusReport(
      reportInput(outcomes(2, 1, true), realDerivedOutcomes),
    );
    expect(report).toContain("detectionRate            50.00%");
    expect(report).toContain("falsePositiveRate        0.00%");
    expect(report).toContain(
      "The detection rate above is claimed only for the real-derived partition",
    );
    expect(report).not.toContain("No detection rate is claimed");
  });

  it("a detector that flags EVERYTHING cannot claim success: 1.0 coverage arrives with 1.0 false positives", () => {
    const report = renderCorpusReport(reportInput(outcomes(5, 5, true)));
    expect(report).toContain("syntheticDefectCoverage  100.00%");
    expect(report).toContain("falsePositiveRate        100.00%");
  });

  it("coverage credits only the exact signed defect class attribution", () => {
    const exact = outcomes(2, 1, false);
    exact[0] = {
      ...exact[0]!,
      attributedDefectClassIds: ["test-defect"],
    };
    const report = renderCorpusReport(reportInput(exact));
    expect(report).toContain("syntheticDefectCoverage  50.00%");

    const contradictory = outcomes(2, 1, false);
    contradictory[0] = {
      ...contradictory[0]!,
      attributedDefectClassIds: ["other-defect"],
    };
    contradictory[1] = {
      ...contradictory[1]!,
      attributedDefectClassIds: ["other-defect"],
    };
    const inventory = inventoryOf(contradictory).map((entry) =>
      entry.caseId === "d1" ? { ...entry, labelId: "other-defect" } : entry,
    );
    expect(() =>
      renderCorpusReport(
        reportInput(contradictory, [], { inventory }),
      ),
    ).toThrow("contradicts its signed defect label");

    const unknown = outcomes(1, 1, false);
    unknown[0] = {
      ...unknown[0]!,
      attributedDefectClassIds: ["unknown-defect"],
    };
    expect(() => renderCorpusReport(reportInput(unknown))).toThrow(
      "attributes unknown defect class",
    );

    const extraAttribution = outcomes(2, 1, false);
    extraAttribution[0] = {
      ...extraAttribution[0]!,
      attributedDefectClassIds: ["test-defect", "other-defect"],
    };
    const extraInventory = inventoryOf(extraAttribution).map((entry) =>
      entry.caseId === "d1"
        ? { ...entry, labelId: "other-defect" }
        : entry,
    );
    expect(() =>
      renderCorpusReport(
        reportInput(extraAttribution, [], {
          inventory: extraInventory,
        }),
      ),
    ).toThrow("must be empty or the exact signed defect singleton");
  });

  it("an unsigned corpus and an unevaluated corpus both withhold every figure with a reason code", () => {
    const evaluated = outcomes(5, 5, true);
    const unsigned = renderCorpusReport(
      reportInput(evaluated, [], {
        signoff: {
          corpusVersion: "x",
          status: "pending-captain",
          signedBy: null,
          signedAt: null,
          signedDigest: null,
        },
      }),
    );
    expect(unsigned).toContain("syntheticDefectCoverage  null (corpus-signoff-pending)");
    const unevaluated = renderCorpusReport(
      reportInput(outcomes(5, 5, null)),
    );
    expect(unevaluated).toContain("syntheticDefectCoverage  null (detector-outcomes-absent)");
  });

  it("a partially evaluated corpus withholds both figures instead of reporting the favorable subset", () => {
    const partial = outcomes(2, 2, null);
    partial[0] = { ...partial[0]!, attributedDefectClassIds: ["test-defect"] };
    partial[2] = { ...partial[2]!, attributedDefectClassIds: [] };
    const report = renderCorpusReport(reportInput(partial));
    expect(report).toContain("syntheticDefectCoverage  null (detector-outcomes-incomplete)");
    expect(report).toContain("falsePositiveRate        null (detector-outcomes-incomplete)");
  });

  it("omitting unevaluated manifest cases cannot turn a favorable subset into a complete run", () => {
    const completeInventory = outcomes(2, 2, true);
    const favorableSubset = [completeInventory[0]!, completeInventory[2]!];
    const report = renderCorpusReport(
      reportInput(favorableSubset, [], {
        inventory: inventoryOf(completeInventory),
      }),
    );
    expect(report).toContain("cases 4  defects 2  clean controls 2  evaluated 2");
    expect(report).toContain("syntheticDefectCoverage  null (detector-outcomes-incomplete)");
  });

  it("duplicate or non-inventoried outcomes are rejected at the measurement boundary", () => {
    const complete = outcomes(1, 1, true);
    expect(() =>
      renderCorpusReport(
        reportInput(
          [complete[0]!, complete[0]!, complete[1]!],
          [],
          { inventory: inventoryOf(complete) },
        ),
      ),
    ).toThrow("duplicate outcome");
    expect(() =>
      renderCorpusReport(
        reportInput(
          [
            ...complete,
            {
              caseId: "not-in-manifest",
              attributedDefectClassIds: ["test-defect"],
              provenance: "synthetic-fixture",
            },
          ],
          [],
          { inventory: inventoryOf(complete) },
        ),
      ),
    ).toThrow("absent from the signed manifest inventory");
  });

  it("the signed corpus digest binds the exact inventory supplied to reporting", () => {
    const input = reportInput(outcomes(2, 2, true));
    expect(() =>
      renderCorpusReport({
        ...input,
        inventory: input.inventory.slice(0, 2),
        syntheticOutcomes: input.syntheticOutcomes.slice(0, 2),
      }),
    ).toThrow("manifest inventory digest");
  });

  it("the report validates signoff instead of trusting a caller-supplied signed flag", () => {
    expect(() =>
      renderCorpusReport(
        reportInput(outcomes(1, 1, true), [], {
          signoff: {
            ...signedSignoff(),
            signedDigest: "not-the-corpus-digest",
          },
        }),
      ),
    ).toThrow("invalid signoff");
  });

  it("coverage measured with NO clean controls is marked uninterpretable", () => {
    const report = renderCorpusReport(reportInput(outcomes(4, 0, true)));
    expect(report).toContain("syntheticDefectCoverage  100.00%");
    expect(report).toContain("falsePositiveRate        null (no-clean-controls)");
  });

  it("the structured builder cannot be acquired through any module syntax", () => {
    expect("buildCorpusReport" in corpusReportRuntime).toBe(false);
    expect(
      reportExportProblems(["renderCorpusReport", "buildCorpusReport"]),
    ).toEqual(["buildCorpusReport"]);
  });

  it("the measurement boundary rejects outcomes from the wrong provenance partition", () => {
    expect(() =>
      renderCorpusReport(
        reportInput(
          [
          {
            caseId: "RD-wrong",
            attributedDefectClassIds: ["test-defect"],
            provenance: "real-derived-fixture",
          },
          ] as any,
        ),
      ),
    ).toThrow("received 1 outcome(s) from another provenance partition");
  });

  it("recursive signature keys are rejected in actual generated artifacts", () => {
    const key = "signedBy";
    const value = {
      nested: {
        [key]: "captain",
        ...{ signedAt: "2026-07-28T12:00:00.000Z" },
      },
      signedDigest: null,
    };
    expect(
      generatedSignatureProblems([
        {
          relPath: "synthetic/CS-signature.json",
          bytes: JSON.stringify(value),
          value: value as any,
        },
      ]),
    ).toHaveLength(3);
  });

  it("a VALID real-derived case is accepted (the intake contract is not a blanket reject)", () => {
    expect(realDerivedCaseProblems(realDerivedCase(), classes, "real-derived/RD-ok.json")).toEqual([]);
  });

  it("a real-derived time-zone boundary is derived from replayable rule facts", () => {
    const item = realDerivedDefectCase("temporal-rendering-defect");
    const temporal = (item.replayPayload as Record<string, any>).temporal;
    temporal.eventAt = "2026-04-28T12:00:00.000Z";
    temporal.eventAtLocal = "2026-04-28T08:00:00.000-04:00";
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-arbitrary-boundary.json",
      ).join("\n"),
    ).toContain("temporal transition state must match replayable time-zone rules");

    const wrongLocal = realDerivedCase();
    ((wrongLocal.replayPayload as Record<string, any>).temporal).eventAtLocal =
      "2026-04-28T08:00:00.000-05:00";
    expect(
      realDerivedCaseProblems(
        wrongLocal,
        classes,
        "real-derived/RD-wrong-local-rendering.json",
      ).join("\n"),
    ).toContain("temporal transition state must match replayable time-zone rules");

    const unordered = realDerivedCase();
    ((unordered.replayPayload as Record<string, any>).temporal)
      .timeZoneTransitions.reverse();
    expect(
      realDerivedCaseProblems(
        unordered,
        classes,
        "real-derived/RD-unordered-zone-rules.json",
      ).join("\n"),
    ).toContain("temporal transition state must match replayable time-zone rules");

    const unknownRegistry = realDerivedCase();
    const unknownTemporal = (
      unknownRegistry.replayPayload as Record<string, any>
    ).temporal;
    unknownTemporal.timeZone = "Mars/Olympus";
    unknownTemporal.timeZoneDataVersion = "iana-tzdb/9999z";
    expect(
      realDerivedCaseProblems(
        unknownRegistry,
        classes,
        "real-derived/RD-unknown-zone-registry.json",
      ).join("\n"),
    ).toContain("time zone must belong to its recorded tzdb registry");
  });

  it("a real-derived defect label must match its closed replay semantics", () => {
    const mislabeled = realDerivedCase();
    ((mislabeled.replayPayload as Record<string, any>).destination).discriminatorState =
      "unique";
    const problems = realDerivedCaseProblems(
      mislabeled,
      classes,
      "real-derived/RD-mislabeled-defect.json",
    );
    expect(problems.join("\n")).toContain(
      "label.defectClassId does not match replay expected-versus-observed semantics",
    );
  });

  it("a real-derived defect label must equal the only semantic defect", () => {
    const item = realDerivedDefectCase("destination-integrity-defect");
    const payload = item.replayPayload as Record<string, any>;
    payload.request.amountMinor = payload.policy.thresholdMinor;
    payload.policy.thresholdComparison = "equal";
    const thresholdRule = semanticContract.defectRules.find(
      (rule) => rule.id === "threshold-boundary-error",
    )!;
    const thresholdTreatment = semanticTreatment(thresholdRule, "strict");
    const thresholdOutcome = payload.outcomes.find(
      (outcome: Record<string, string>) =>
        outcome.defectClassId === "threshold-boundary-error",
    );
    thresholdOutcome.observedTreatment =
      thresholdTreatment.defectTreatment;
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-extra-semantic-defect.json",
      ).join("\n"),
    ).toContain("exactly one replay semantic defect");
  });

  it("awkward context is clean when the recorded treatment is correct", () => {
    const control = realDerivedCase({
      label: {
        kind: "clean-control",
        controlRationaleId: "no-defect-present",
      },
    });
    const payload = control.replayPayload as Record<string, any>;
    payload.destination.discriminatorState = "unique";
    payload.destination.householdRef = HOUSEHOLD_REF_ALT;
    payload.destination.ownership = "cross-household";
    (control.subjects as string[]).push(HOUSEHOLD_REF_ALT);
    expect(
      realDerivedCaseProblems(
        control,
        classes,
        "real-derived/RD-correct-cross-household.json",
      ),
    ).toEqual([]);
  });

  it("a defect claim requires a typed expected-versus-observed mismatch", () => {
    const contextOnly = realDerivedDefectCase(
      "destination-integrity-defect",
    );
    const outcome = (
      (contextOnly.replayPayload as Record<string, any>).outcomes as Array<
        Record<string, string>
      >
    ).find(
      (candidate) =>
        candidate.defectClassId === "destination-integrity-defect",
    )!;
    outcome.observedTreatment = outcome.expectedTreatment!;
    expect(
      realDerivedCaseProblems(
        contextOnly,
        classes,
        "real-derived/RD-context-only.json",
      ).join("\n"),
    ).toContain("expected-versus-observed");
  });

  it.each([...classes])(
    "%s context remains clean under its expected treatment",
    (defectClassId) => {
      const control = realDerivedDefectCase(defectClassId);
      control.label = {
        kind: "clean-control",
        controlRationaleId: "resolved-before-execution",
      };
      const outcome = (
        (control.replayPayload as Record<string, any>).outcomes as Array<
          Record<string, string>
        >
      ).find((candidate) => candidate.defectClassId === defectClassId)!;
      outcome.observedTreatment = outcome.expectedTreatment!;
      expect(
        realDerivedCaseProblems(
          control,
          classes,
          `real-derived/RD-${defectClassId}-correct-treatment.json`,
        ),
      ).toEqual([]);
    },
  );
});
