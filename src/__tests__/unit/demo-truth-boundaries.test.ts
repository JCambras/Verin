import { describe, expect, it } from "vitest";
import {
  bindExactSourceCase,
  resolveSourceCaseId,
  scenarioById,
  sourceCaseFor,
} from "@app/demo/data";
import { compareComparisonEvidence } from "@app/demo/comparison-evidence";
import { auditPositionFor } from "@app/demo/audit-position";
import { getJourney } from "@app/demo/journey";
import {
  SIGNED_CASE_IDS,
  type SignedCaseVariant,
} from "@app/demo/signed-cases";

describe("demo truth boundaries", () => {
  it("requires an explicit exact case whenever signed variants exist", () => {
    const scenario = scenarioById("permanent-prohibition");

    expect(
      resolveSourceCaseId(scenario, "firm-a", undefined),
    ).toBeNull();
    expect(
      resolveSourceCaseId(
        scenario,
        "firm-a",
        "GC-06-household-restriction",
      ),
    ).toBe("GC-06-household-restriction");
    expect(
      bindExactSourceCase(
        scenario,
        "firm-a",
        "GC-07-regulatory-prohibition",
      ).sourceCaseIdsByFirm?.["firm-a"],
    ).toEqual(["GC-07-regulatory-prohibition"]);
  });

  it("keeps a changed bank finding unavailable without post-review evidence", () => {
    const journey = getJourney(
      "recent-bank-change-block",
      "firm-a",
      "initial",
      "GC-03-recent-bank-change-firm-a",
    );
    const check = journey.safety?.checks.find((candidate) =>
      candidate.label.includes("Bank-instruction"),
    );

    expect(check).toMatchObject({
      label: "Bank-instruction revalidation not evaluated",
      status: "pending",
      statusLabel: "Post-review evidence unavailable",
    });
    expect(check?.detail).toContain("changed on 2026-07-22");
    expect(check?.detail).toContain(
      "Signed post-review bank-instruction evidence is absent",
    );
    expect(check?.detail).toContain(
      "Execution is withheld pending captain-signed evidence",
    );
    expect(journey.record.safety?.checks).toContainEqual(check);
    expect(journey.safety?.executionEligibility).toBeNull();
    expect(journey.safety?.reservationId).toBeNull();
    expect(journey.execution).toBeNull();
    expect(journey.verification).toBeNull();
    expect(journey.record.executionEligibility).toBeNull();
    expect(journey.record.execution).toBeNull();
    expect(journey.record.verification).toBeNull();
    expect(journey.record.lifecycle.map(({ type }) => type)).not.toContain(
      "ReservationCreated",
    );
    expect(journey.stopNote).toContain(
      "Execution is withheld pending captain-signed evidence",
    );
    expect(journey.evidence.rows).toContainEqual({
      kind: "missing",
      text:
        "Signed post-review bank-instruction evidence is absent. Execution is withheld pending captain-signed evidence.",
      fakeClass: "synthetic-fixture",
    });
  });

  it("treats a signed evidence summary change as a comparison difference", () => {
    const source = sourceCaseFor(
      scenarioById("safe-proceed"),
      "firm-a",
    )!;
    const same = {
      ...source,
      evidence: source.evidence.map((entry) => ({ ...entry })),
    };
    const changed = {
      ...same,
      evidence: same.evidence.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              summary:
                "The signed evidence now carries a materially different meaning.",
            }
          : entry,
      ),
    };

    expect(
      compareComparisonEvidence(source, same, "initial")
        .equivalent,
    ).toBe(true);
    expect(
      compareComparisonEvidence(source, changed, "initial"),
    ).toMatchObject({
      equivalent: false,
      changed: [
        "account-balance · subject:smiths-joint-taxable",
      ],
    });
  });

  it("compares every material non-policy input", () => {
    const source = sourceCaseFor(
      scenarioById("safe-proceed"),
      "firm-a",
    )!;
    const same = structuredClone(source);
    const mutations: Array<
      readonly [string, (value: SignedCaseVariant) => SignedCaseVariant]
    > = [
      [
        "signed request meaning",
        (value) => ({
          ...value,
          trigger: {
            ...value.trigger,
            description: "A materially different request",
          },
        }),
      ],
      [
        "signed requester",
        (value) => ({
          ...value,
          trigger: { ...value.trigger, requesterRole: "client" },
        }),
      ],
      [
        "signed request identity",
        (value) => ({
          ...value,
          trigger: { ...value.trigger, requestRef: "req:other" },
        }),
      ],
      [
        "signed request timing and amount",
        (value) => ({
          ...value,
          trigger: {
            ...value.trigger,
            requestAt: "2026-07-26T13:31:00.000Z",
          },
        }),
      ],
      [
        "signed money inputs",
        (value) => ({
          ...value,
          money: {
            ...value.money,
            plannedWithdrawalMonthlyMinor:
              (value.money.plannedWithdrawalMonthlyMinor ?? 0) + 1,
          },
        }),
      ],
      [
        "domain configuration authority",
        (value) => ({
          ...value,
          policyVersions: {
            ...value.policyVersions,
            domainConfigVersionId: "money-movement@different",
          },
        }),
      ],
      [
        "household instruction authority",
        (value) => ({
          ...value,
          householdInstructions: value.householdInstructions.map(
            (instruction, index) =>
              index === 0
                ? { ...instruction, summary: "Different instruction" }
                : instruction,
          ),
        }),
      ],
      [
        "regulatory authority",
        (value) => ({
          ...value,
          policyVersions: {
            ...value.policyVersions,
            regulatoryVersionId: "regulation@different",
          },
        }),
      ],
      [
        "non-firm prohibition authority",
        (value) => ({
          ...value,
          prohibition: {
            source: {
              sourceType: "regulatory",
              sourceId: "regulatory-hold",
              versionId: "regulation@different",
            },
            scope: "scope:distribution",
            reasonCode: "legal-hold",
            explanation: "A regulatory hold controls this request.",
          },
        }),
      ],
      [
        "signed authority completeness",
        (value) => ({
          ...value,
          authorityGap: {
            signedAt: "2026-07-26",
            requiredSince: "2026-07-28",
            status: "awaiting-captain-signature",
            execution: "withheld",
            reason: "Awaiting signed authority",
            missingAuthorities: ["verification-detail"],
          },
        }),
      ],
    ];

    expect(
      compareComparisonEvidence(source, same, "initial").equivalent,
    ).toBe(true);
    for (const [label, mutate] of mutations) {
      expect(
        compareComparisonEvidence(
          source,
          mutate(structuredClone(same)),
          "initial",
        ),
      ).toMatchObject({ equivalent: false, changed: [label] });
    }
  });

  it("binds verification proofs to causal events", () => {
    const submitted = getJourney(
      "safe-proceed",
      "firm-a",
      "initial",
      "GC-01-firm-a-happy-path",
    ).verification?.proves[0];
    const nigo = getJourney(
      "delayed-nigo",
      "firm-b",
      "initial",
      "GC-14-delayed-nigo",
    ).verification?.proves;

    expect(submitted?.ledgerEvent).toBe("ExecutionSucceeded");
    expect(submitted?.provenance.asOf).toBe(
      "2026-07-26T13:59:10.000Z",
    );
    expect(nigo?.[0]).toMatchObject({
      ledgerEvent: "ExecutionSucceeded",
      provenance: {
        asOf: "2026-07-26T21:44:10.000Z",
      },
    });
    expect(nigo?.[1]).toMatchObject({
      ledgerEvent: "StatusObserved",
      provenance: {
        asOf: "2026-07-28T21:44:00.000Z",
      },
    });
  });

  it("compares every signed evidence row and assigns real audit positions", () => {
    const firmA = getJourney(
      "safe-proceed",
      "firm-a",
      "initial",
      "GC-01-firm-a-happy-path",
    );
    const firmB = getJourney(
      "safe-proceed",
      "firm-b",
      "initial",
      "GC-02-firm-b-happy-path",
    );
    const gc07 = getJourney(
      "permanent-prohibition",
      "firm-a",
      "initial",
      "GC-07-regulatory-prohibition",
    );

    expect(firmA.comparison.description).toContain(
      "only Firm A includes account-balance · subject:smiths-ira",
    );
    expect(firmA.comparison.description).not.toContain(
      "driven by policy provenance",
    );
    expect(firmA.record.hashes.auditPosition.orgId).toBe("demo-org");
    expect(firmA.record.hashes.auditPosition.sequence).not.toBe(
      firmB.record.hashes.auditPosition.sequence,
    );
    expect(firmA.record.hashes.auditPosition.sequence).not.toBe(
      gc07.record.hashes.auditPosition.sequence,
    );
  });

  it("keeps prior audit positions stable when a signed case is appended", () => {
    const scenario = scenarioById("safe-proceed");
    const before = auditPositionFor(scenario, "firm-b", "initial");
    const mutableIds = SIGNED_CASE_IDS as unknown as string[];
    const appendedId = "GC-99-appended-case";

    mutableIds.push(appendedId);
    try {
      expect(auditPositionFor(scenario, "firm-b", "initial")).toEqual(
        before,
      );
    } finally {
      expect(mutableIds.pop()).toBe(appendedId);
    }
  });

  it("withholds policy approval until exact-case simulation is computed", () => {
    expect(
      getJourney(
        "permanent-prohibition",
        "firm-a",
        "initial",
        "GC-06-household-restriction",
      ).policyAuthoring.approval,
    ).toMatchObject({
      kind: "unavailable",
      reason: expect.stringContaining(
        "no signed planned-withdrawal schedule",
      ),
    });
    expect(
      getJourney(
        "safe-proceed",
        "firm-a",
        "initial",
        "GC-01-firm-a-happy-path",
      ).policyAuthoring.approval.kind,
    ).toBe("available");
  });
});
