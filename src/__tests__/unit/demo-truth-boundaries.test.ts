import { describe, expect, it } from "vitest";
import {
  bindExactSourceCase,
  resolveSourceCaseId,
  scenarioById,
} from "@app/demo/data";
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
      "No exact signed post-review result was recorded",
    );
    expect(journey.record.safety?.checks).toContainEqual(check);
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
