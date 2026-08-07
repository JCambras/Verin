import { describe, expect, it } from "vitest";
import { evidenceObservationAuthorityProblems } from "../../../scripts/corpus/evidence-observation";
import { realDerivedCaseProblems } from "../../../scripts/corpus/scrub-contract";
import {
  ACCOUNT_REF,
  ACCOUNT_REF_ALT,
  ACTOR_REF,
  EVIDENCE_SOURCE_REF,
  EVIDENCE_SOURCE_REF_ALT,
  FIRM_REF_ALT,
  HOUSEHOLD_REF,
  HOUSEHOLD_REF_ALT,
  INSTRUCTION_REF_ALT,
  observedEvidence,
  OWNER_REF,
  semanticContract,
  TOKEN_ALT,
} from "./_corpus-case-fixtures";
import {
  realDerivedCase,
  realDerivedDefectCase,
} from "./_corpus-real-derived-fixtures";
import { classes } from "./_corpus-world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - real-derived ownership edges: exact
 * firm scope, minor-unit funding arithmetic, evidence observation planes, and
 * request-bound pending actions.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("request source accounts and evidence tuples resolve at their exact ownership edges", () => {
    const missingSource = realDerivedCase();
    (missingSource.replayPayload as Record<string, any>).request.sourceAccountRef =
      ACCOUNT_REF_ALT;
    expect(
      realDerivedCaseProblems(
        missingSource,
        classes,
        "real-derived/RD-missing-source.json",
      ).join("\n"),
    ).toContain("sourceAccountRef resolves to 0");

    const foreignSource = realDerivedCase() as any;
    const foreignPayload = foreignSource.replayPayload as Record<string, any>;
    foreignPayload.liquidity.sources[0].householdRef = HOUSEHOLD_REF_ALT;
    foreignPayload.liquidity.sources.push({
      accountRef: ACCOUNT_REF_ALT,
      householdRef: HOUSEHOLD_REF,
      ownerRefs: [OWNER_REF],
      evidenceSourceRef: EVIDENCE_SOURCE_REF_ALT,
      availableMinor: 20_000,
      sourceTaxClass: "taxable",
    });
    foreignPayload.liquidity.selectedFundingRefs = [ACCOUNT_REF_ALT];
    foreignSource.subjects.push(ACCOUNT_REF_ALT);
    foreignSource.evidence.push(
      observedEvidence(
        "balance",
        ACCOUNT_REF_ALT,
        EVIDENCE_SOURCE_REF_ALT,
        TOKEN_ALT,
      ) as any,
    );
    foreignPayload.evidenceRefs = foreignSource.evidence.map(
      (entry: Record<string, unknown>) => entry.id,
    );
    expect(
      realDerivedCaseProblems(
        foreignSource,
        classes,
        "real-derived/RD-foreign-source-household.json",
      ).join("\n"),
    ).toContain("request source account must belong to the request household");

    for (const mutate of [
      (evidence: Record<string, unknown>) => {
        evidence.evidenceKind = "request";
        evidence.id = `evs:${TOKEN_ALT}:request`;
      },
      (evidence: Record<string, unknown>) => {
        evidence.subjectRef = INSTRUCTION_REF_ALT;
      },
      (evidence: Record<string, unknown>) => {
        evidence.sourceRef = EVIDENCE_SOURCE_REF_ALT;
      },
    ]) {
      const item = realDerivedCase();
      const evidence = (
        item.evidence as Array<Record<string, unknown>>
      ).find((entry) => entry.evidenceKind === "bank-instruction")!;
      mutate(evidence);
      (item.replayPayload as Record<string, any>).evidenceRefs = (
        item.evidence as Array<Record<string, unknown>>
      ).map((entry) => entry.id);
      if (evidence.subjectRef === INSTRUCTION_REF_ALT) {
        (item.subjects as string[]).push(INSTRUCTION_REF_ALT);
      }
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-mismatched-evidence.json",
        ).join("\n"),
      ).toContain("destination evidence");
    }

    const authority = realDerivedCase();
    (
      authority.evidence as Array<Record<string, unknown>>
    ).find((entry) => entry.evidenceKind === "authority")!.subjectRef =
      ACTOR_REF;
    expect(
      realDerivedCaseProblems(
        authority,
        classes,
        "real-derived/RD-wrong-authority-subject.json",
      ).join("\n"),
    ).toContain("authority evidence");
  });

  it.each([
    ["request", "request"],
    ["balance", "liquidity-source"],
    ["identity-resolution", "identity"],
  ])(
    "missing %s evidence cannot support a concrete replay plane",
    (evidenceKind, plane) => {
      const item = realDerivedCase();
      const evidence = (
        item.evidence as Array<Record<string, unknown>>
      ).find((entry) => entry.evidenceKind === evidenceKind)!;
      evidence.observationState = "missing";
      evidence.observedAt = null;
      evidence.freshness = "unknown";
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-missing-material-evidence.json",
        ).join("\n"),
      ).toContain(`${plane} evidence requires observed support`);
    },
  );

  it("real-derived cases require one exact firm scope across case, request, and reservations", () => {
    const absent = realDerivedCase();
    delete (absent as Record<string, unknown>).firmRef;
    expect(
      realDerivedCaseProblems(
        absent,
        classes,
        "real-derived/RD-missing-firm.json",
      ).join("\n"),
    ).toContain("firmRef");

    const mismatchedRequest = realDerivedCase();
    (
      mismatchedRequest.replayPayload as Record<string, any>
    ).request.firmRef = FIRM_REF_ALT;
    expect(
      realDerivedCaseProblems(
        mismatchedRequest,
        classes,
        "real-derived/RD-mismatched-request-firm.json",
      ).join("\n"),
    ).toContain("request firmRef must equal the case firmRef");

    const crossFirmReservation = realDerivedCase();
    (
      crossFirmReservation.reservations as Array<Record<string, unknown>>
    )[0]!.firmRef = FIRM_REF_ALT;
    expect(
      realDerivedCaseProblems(
        crossFirmReservation,
        classes,
        "real-derived/RD-cross-firm-reservation.json",
      ).join("\n"),
    ).toContain("every reservation firmRef must equal the case firmRef");

    const impactedSubject = realDerivedDefectCase(
      "instruction-conflict-unresolved",
    );
    (
      impactedSubject.replayPayload as Record<string, any>
    ).instructionConflict.impactedSubjectRefs = [FIRM_REF_ALT];
    expect(
      realDerivedCaseProblems(
        impactedSubject,
        classes,
        "real-derived/RD-firm-impacted-subject.json",
      ).join("\n"),
    ).toContain("schema validation failed");

    const subjectInventory = realDerivedCase();
    (subjectInventory.subjects as string[]).push(FIRM_REF_ALT);
    expect(
      realDerivedCaseProblems(
        subjectInventory,
        classes,
        "real-derived/RD-firm-subject-inventory.json",
      ).join("\n"),
    ).toContain("schema validation failed");
  });

  it("real-derived funding aggregates preserve exact minor-unit arithmetic", () => {
    const precision = realDerivedCase();
    const payload = precision.replayPayload as Record<string, any>;
    payload.request.amountMinor = Number.MAX_SAFE_INTEGER;
    payload.liquidity.reserveRequiredMinor = 2;
    payload.liquidity.withdrawalSegmentsMinor = [2];
    payload.liquidity.sources[0].availableMinor =
      Number.MAX_SAFE_INTEGER;
    payload.liquidity.sources.push({
      ...payload.liquidity.sources[0],
      accountRef: ACCOUNT_REF_ALT,
      availableMinor: 1,
    });
    payload.liquidity.selectedFundingRefs.push(ACCOUNT_REF_ALT);
    (precision.subjects as string[]).push(ACCOUNT_REF_ALT);
    (precision.evidence as Array<Record<string, unknown>>).push(
      observedEvidence("balance", ACCOUNT_REF_ALT, EVIDENCE_SOURCE_REF, TOKEN_ALT),
    );
    payload.evidenceRefs = (
      precision.evidence as Array<Record<string, unknown>>
    ).map((entry) => entry.id);
    expect(
      realDerivedCaseProblems(
        precision,
        classes,
        "real-derived/RD-exact-funding.json",
      ).join("\n"),
    ).toContain(
      "selected funding aggregate does not cover request and reserve after exact-once pending-action accounting",
    );

    const expectUnsafe = (
      mutate: (payload: Record<string, any>) => void,
    ): void => {
      const unsafe = realDerivedCase();
      mutate(unsafe.replayPayload as Record<string, any>);
      expect(
        realDerivedCaseProblems(
          unsafe,
          classes,
          "real-derived/RD-unsafe-funding.json",
        ).join("\n"),
      ).toContain("schema validation failed");
    };
    const unsafeMinor = Number.MAX_SAFE_INTEGER + 1;
    expectUnsafe((item) => { item.request.amountMinor = unsafeMinor; });
    expectUnsafe((item) => {
      item.liquidity.sources[0].availableMinor = unsafeMinor;
    });
    expectUnsafe((item) => {
      item.liquidity.reserveRequiredMinor = unsafeMinor;
    });
    expectUnsafe((item) => {
      item.liquidity.withdrawalSegmentsMinor = [unsafeMinor];
    });
    expectUnsafe((item) => {
      item.liquidity.pendingAction.amountMinor = unsafeMinor;
    });
  });

  it("every semantic evidence plane has an explicit observation-state authority", () => {
    expect(
      evidenceObservationAuthorityProblems(
        semanticContract.evidencePlanes.map((entry) => entry.plane),
      ),
    ).toEqual([]);
    expect(
      evidenceObservationAuthorityProblems([
        ...semanticContract.evidencePlanes.map((entry) => entry.plane),
        "later-material-plane",
      ]).join("\n"),
    ).toContain(
      'evidence plane "later-material-plane" has no observation-state authority',
    );
  });

  it("pending actions bind to the request household, selected account, and exact evidence", () => {
    const mutations: Array<(item: Record<string, any>) => void> = [
      (item) => {
        item.replayPayload.liquidity.pendingAction.householdRef =
          HOUSEHOLD_REF_ALT;
        item.subjects.push(HOUSEHOLD_REF_ALT);
      },
      (item) => {
        item.replayPayload.liquidity.pendingAction.accountRef =
          ACCOUNT_REF_ALT;
        item.subjects.push(ACCOUNT_REF_ALT);
      },
      (item) => {
        const evidence = item.evidence.find(
          (entry: Record<string, unknown>) =>
            entry.evidenceKind === "pending-actions",
        );
        evidence.subjectRef = ACCOUNT_REF;
      },
      (item) => {
        const evidence = item.evidence.find(
          (entry: Record<string, unknown>) =>
            entry.evidenceKind === "pending-actions",
        );
        evidence.sourceRef = EVIDENCE_SOURCE_REF_ALT;
      },
    ];
    for (const mutate of mutations) {
      const item = realDerivedDefectCase(
        "pending-activity-miscount",
      ) as Record<string, any>;
      mutate(item);
      expect(
        realDerivedCaseProblems(
          item,
          classes,
          "real-derived/RD-invalid-pending-topology.json",
        ).join("\n"),
      ).toMatch(/pending action|pending-action evidence/);
    }
  });
});
