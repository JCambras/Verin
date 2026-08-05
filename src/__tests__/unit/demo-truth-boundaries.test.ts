import { describe, expect, it } from "vitest";
import {
  bindExactSourceCase,
  resolveSourceCaseId,
  scenarioById,
  sourceCaseFor,
} from "@app/demo/data";
import { compareComparisonEvidence } from "@app/demo/comparison-evidence";
import { getJourney } from "@app/demo/journey";

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
