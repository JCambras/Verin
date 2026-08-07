import { describe, expect, it } from "vitest";
import { realDerivedCaseProblems } from "../../../scripts/corpus/scrub-contract";
import {
  ACCOUNT_REF,
  ACCOUNT_REF_ALT,
  ACTOR_REF_ALT,
  EVIDENCE_SOURCE_REF,
  EVIDENCE_SOURCE_REF_ALT,
  FIRM_REF,
  FIRM_REF_ALT,
  HOUSEHOLD_REF,
  HOUSEHOLD_REF_ALT,
  INSTRUCTION_REF,
  INSTRUCTION_REF_ALT,
  observedEvidence,
  OPAQUE,
  OWNER_REF,
  OWNER_REF_ALT,
  TOKEN_ALT,
  treatmentOutcomes,
} from "./_corpus-case-fixtures";
import {
  realDerivedCase,
  realDerivedDefectCase,
} from "./_corpus-real-derived-fixtures";
import { classes } from "./_corpus-world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - real-derived replay topology:
 * entity-kind-scoped references, identity resolution, instruction conflicts, and
 * explicit selected funding.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("a material replay plane requires evidence with matching kind, subject, and source", () => {
    const item = realDerivedCase();
    item.evidence = (item.evidence as Array<Record<string, unknown>>).filter(
      (entry) => entry.evidenceKind !== "bank-instruction",
    );
    (item.replayPayload as Record<string, any>).evidenceRefs = (
      item.evidence as Array<Record<string, unknown>>
    ).map((entry) => entry.id);
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-unsupported-destination.json",
      ).join("\n"),
    ).toContain("destination evidence");
  });

  it("entity-kind-scoped references prevent one token from satisfying the replay topology", () => {
    const item = realDerivedCase();
    (item.replayPayload as Record<string, any>).request.requestRef = OPAQUE;
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-token-reuse.json",
      ).join("\n"),
    ).toContain("schema validation failed");
  });

  it("unique identity resolution binds its sole candidate to the resolved subject", () => {
    const item = realDerivedCase();
    const payload = item.replayPayload as Record<string, any>;
    payload.identity.candidateRefs = [ACTOR_REF_ALT];
    (item.subjects as string[]).push(ACTOR_REF_ALT);
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-unrelated-identity-candidate.json",
      ).join("\n"),
    ).toContain("unique identity candidate must equal identity.subjectRef");

    const empty = realDerivedCase();
    (empty.replayPayload as Record<string, any>).identity.candidateRefs = [];
    expect(
      realDerivedCaseProblems(
        empty,
        classes,
        "real-derived/RD-empty-identity-candidate.json",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("instruction conflicts bind to the governed request and its actual subjects", () => {
    const item = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    );
    const payload = item.replayPayload as Record<string, any>;
    payload.instructionConflict.instructions = [
      {
        instructionRef: INSTRUCTION_REF_ALT,
        firmRef: FIRM_REF,
        householdRef: HOUSEHOLD_REF,
        term: {
          governedAction: "distribution",
          sourceAccountRef: ACCOUNT_REF,
          targetKind: "destination-instruction",
          targetRef: INSTRUCTION_REF,
          polarity: "required",
        },
      },
      {
        instructionRef: `instruction:tok:0011223344556677`,
        firmRef: FIRM_REF,
        householdRef: HOUSEHOLD_REF,
        term: {
          governedAction: "distribution",
          sourceAccountRef: ACCOUNT_REF,
          targetKind: "destination-instruction",
          targetRef: INSTRUCTION_REF,
          polarity: "forbidden",
        },
      },
    ];
    payload.instructionConflict.impactedSubjectRefs = [OWNER_REF_ALT];
    (item.subjects as string[]).push(
      `instruction:tok:0011223344556677`,
      OWNER_REF_ALT,
    );
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-disconnected-conflict.json",
      ).join("\n"),
    ).toContain("instruction conflict");
  });

  it("instruction conflict topology rejects wrong request, household, and instruction ownership", () => {
    const mutations: Array<(item: Record<string, any>) => void> = [
      (item) => {
        item.replayPayload.instructionConflict.requestRef =
          "request:tok:0011223344556677";
        item.subjects.push("request:tok:0011223344556677");
      },
      (item) => {
        item.replayPayload.instructionConflict.householdRef =
          HOUSEHOLD_REF_ALT;
        item.subjects.push(HOUSEHOLD_REF_ALT);
      },
      (item) => {
        item.replayPayload.instructionConflict.instructions[0].householdRef =
          HOUSEHOLD_REF_ALT;
        item.subjects.push(HOUSEHOLD_REF_ALT);
      },
      (item) => {
        item.replayPayload.instructionConflict.instructions[0].firmRef =
          FIRM_REF_ALT;
      },
    ];
    for (const mutate of mutations) {
      const item = realDerivedDefectCase(
        "instruction-conflict-unresolved",
      ) as Record<string, any>;
      mutate(item);
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-wrong-conflict-topology.json",
        ).join("\n"),
      ).toContain("instruction conflict");
    }
  });

  it("real-derived instruction conflict truth requires connected typed terms", () => {
    const termless = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    ) as Record<string, any>;
    delete termless.replayPayload.instructionConflict.instructions[0].term;
    expect(
      realDerivedCaseProblems(
        termless,
        classes,
        "real-derived/RD-termless-conflict.json",
      ).join("\n"),
    ).toContain("instructionConflict.instructions.0.term");

    const unconnected = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    ) as Record<string, any>;
    for (const instruction of unconnected.replayPayload
      .instructionConflict.instructions) {
      instruction.term.sourceAccountRef = ACCOUNT_REF_ALT;
    }
    unconnected.subjects.push(ACCOUNT_REF_ALT);
    expect(
      realDerivedCaseProblems(
        unconnected,
        classes,
        "real-derived/RD-unconnected-conflict.json",
      ).join("\n"),
    ).toContain(
      "instruction conflict state does not match the signed typed instruction terms",
    );

    const governed = realDerivedCase({
      label: {
        kind: "clean-control",
        controlRationaleId: "no-defect-present",
      },
    }) as Record<string, any>;
    governed.replayPayload.destination.discriminatorState = "unique";
    governed.replayPayload.instructionConflict.instructions = [{
      instructionRef: INSTRUCTION_REF_ALT,
      firmRef: FIRM_REF,
      householdRef: HOUSEHOLD_REF,
      term: {
        governedAction: "distribution",
        sourceAccountRef: ACCOUNT_REF,
        targetKind: "destination-instruction",
        targetRef: INSTRUCTION_REF,
        polarity: "required",
      },
    }];
    governed.subjects.push(INSTRUCTION_REF_ALT);
    (governed.evidence as Array<Record<string, unknown>>).find(
      (entry) => entry.evidenceKind === "household-instruction",
    )!.subjectRef = INSTRUCTION_REF_ALT;
    governed.replayPayload.outcomes = treatmentOutcomes(
      governed.replayPayload,
    );
    expect(
      realDerivedCaseProblems(
        governed,
        classes,
        "real-derived/RD-governed-instruction.json",
      ),
    ).toEqual([]);
  });

  it("selected funding is explicit and aggregate sufficiency supports tax outcome attribution", () => {
    const defect = realDerivedDefectCase("tax-consequence-blindness");
    const payload = defect.replayPayload as Record<string, any>;
    payload.taxReviewState = "required-pending";
    payload.liquidity.sources = [
      {
        accountRef: ACCOUNT_REF,
        householdRef: HOUSEHOLD_REF,
        ownerRefs: [OWNER_REF],
        evidenceSourceRef: EVIDENCE_SOURCE_REF,
        availableMinor: 6_000,
        sourceTaxClass: "retirement",
      },
      {
        accountRef: ACCOUNT_REF_ALT,
        householdRef: HOUSEHOLD_REF,
        ownerRefs: [OWNER_REF],
        evidenceSourceRef: EVIDENCE_SOURCE_REF_ALT,
        availableMinor: 6_000,
        sourceTaxClass: "retirement",
      },
    ];
    payload.liquidity.selectedFundingRefs = [ACCOUNT_REF, ACCOUNT_REF_ALT];
    (defect.subjects as string[]).push(ACCOUNT_REF_ALT);
    const evidence = defect.evidence as Array<Record<string, unknown>>;
    evidence.push(
      observedEvidence(
        "balance",
        ACCOUNT_REF_ALT,
        EVIDENCE_SOURCE_REF_ALT,
        TOKEN_ALT,
      ),
    );
    payload.evidenceRefs = evidence.map((entry) => entry.id);
    expect(
      realDerivedCaseProblems(
        defect,
        classes,
        "real-derived/RD-aggregate-funding.json",
      ),
    ).toEqual([]);
  });

  it("selected funding rejects missing, duplicate, unsupported, insufficient, cross-household, and unknown-tax selections", () => {
    const invalid = [
      (payload: Record<string, any>) => {
        delete payload.liquidity.selectedFundingRefs;
      },
      (payload: Record<string, any>) => {
        payload.liquidity.selectedFundingRefs.push(ACCOUNT_REF);
      },
      (payload: Record<string, any>) => {
        payload.liquidity.selectedFundingRefs = [ACCOUNT_REF_ALT];
      },
      (payload: Record<string, any>) => {
        payload.liquidity.sources[0].availableMinor = 10;
      },
      (payload: Record<string, any>) => {
        payload.liquidity.sources[0].householdRef = HOUSEHOLD_REF_ALT;
      },
      (payload: Record<string, any>) => {
        payload.liquidity.sources[0].sourceTaxClass = "unknown";
      },
    ];
    for (const mutate of invalid) {
      const item = realDerivedCase();
      mutate(item.replayPayload as Record<string, any>);
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-invalid-funding.json",
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it("selected funding rejects an additional source owned outside the request source ownership", () => {
    const item = realDerivedCase();
    const payload = item.replayPayload as Record<string, any>;
    payload.liquidity.sources.push({
      accountRef: ACCOUNT_REF_ALT,
      householdRef: HOUSEHOLD_REF,
      ownerRefs: [OWNER_REF_ALT],
      evidenceSourceRef: EVIDENCE_SOURCE_REF_ALT,
      availableMinor: 10_000,
      sourceTaxClass: "taxable",
    });
    payload.liquidity.selectedFundingRefs.push(ACCOUNT_REF_ALT);
    (item.subjects as string[]).push(ACCOUNT_REF_ALT, OWNER_REF_ALT);
    (item.evidence as Array<Record<string, unknown>>).push(
      observedEvidence(
        "balance",
        ACCOUNT_REF_ALT,
        EVIDENCE_SOURCE_REF_ALT,
        TOKEN_ALT,
      ),
    );
    payload.evidenceRefs = (item.evidence as Array<Record<string, unknown>>)
      .map((entry) => entry.id);
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-cross-owner.json",
      ).join("\n"),
    ).toContain(
      "selected funding sources must share an owner with the request source account",
    );
  });
});
