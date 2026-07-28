import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMoneyMovementSetup } from "@app/demo/build-setup";
import {
  FIRMS,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
} from "@app/demo/data";
import { projectReserve } from "@domain/money-movement/reserve-projection";
import { REPO_ROOT } from "./_fence-utils";

/**
 * DEMO SEMANTIC-TRUTH FENCE
 *
 * The setup demo must consume the captain-signed golden facts instead of carrying
 * a second reserve or outcome truth. The signed monthly schedule and firm policy
 * horizons derive the displayed floors through the domain projection. The recent
 * bank-change comparison must preserve the signed GC-03/GC-04 dispositions and
 * execution reachability. Failures identify the implementation source with
 * file:line so the owner can remove drift instead of editing another constant.
 */

interface GoldenCase {
  readonly caseId: string;
  readonly firm: "firm-a" | "firm-b";
  readonly firmConfiguration: {
    readonly cashReserveMonths: number;
    readonly dualApprovalThresholdUsd: number;
    readonly bankInstructionChangeHandling:
      | "specialist-review"
      | "block-until-independently-verified";
  };
  readonly householdEvidence: readonly {
    readonly evidenceKind: string;
    readonly summary: string;
  }[];
  readonly expectedDisposition: "proceed" | "blocked" | "prohibited";
  readonly expectedExecutionEligibility: { readonly eligible: boolean };
  readonly signoff: { readonly status: string; readonly authority: string };
}

export interface SemanticTruth {
  readonly monthlyMinor: number;
  readonly firms: Record<
    "firm-a" | "firm-b",
    {
      readonly reserveMonths: number;
      readonly thresholdMinor: number;
      readonly bankChangeHandling: string;
      readonly recentDisposition: "proceed" | "blocked" | "prohibited";
      readonly recentExecutionEligible: boolean;
    }
  >;
}

export interface DemoSemanticFacts {
  readonly monthlyMinor: number;
  readonly firms: Record<
    "firm-a" | "firm-b",
    {
      readonly reserveMonths: number;
      readonly thresholdMinor: number;
      readonly bankChangeHandling: string;
      readonly displayedReserveMinor: number;
      readonly recentDisposition: string;
      readonly recentExecutionEligible: boolean;
    }
  >;
}

function sourceRef(relativePath: string, needle: string, occurrence = 0): string {
  const lines = readFileSync(join(REPO_ROOT, relativePath), "utf8").split("\n");
  let seen = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]!.includes(needle)) continue;
    if (seen === occurrence) return `${relativePath}:${index + 1}`;
    seen += 1;
  }
  return `${relativePath}:1`;
}

function loadGolden(name: string): GoldenCase {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, "fixtures/golden", name), "utf8"),
  ) as GoldenCase;
}

function signed(caseFile: GoldenCase): GoldenCase {
  if (
    caseFile.signoff.status !== "signed" ||
    caseFile.signoff.authority !== "captain"
  ) {
    throw new Error(`${caseFile.caseId} is not captain signed`);
  }
  return caseFile;
}

function monthlyMinorFrom(caseFile: GoldenCase): number {
  const summary = caseFile.householdEvidence.find(
    (evidence) => evidence.evidenceKind === "planned-withdrawals",
  )?.summary;
  const match = summary?.match(/(?:Recurring )?[Pp]lanned withdrawals (\d+) USD\/month/);
  if (!match) {
    throw new Error(
      `${caseFile.caseId} does not carry a parseable planned-withdrawals schedule`,
    );
  }
  return Number(match[1]) * 100;
}

export function goldenSemanticTruth(): SemanticTruth {
  const happyA = signed(loadGolden("GC-01-firm-a-happy-path.json"));
  const happyB = signed(loadGolden("GC-02-firm-b-happy-path.json"));
  const recentA = signed(loadGolden("GC-03-recent-bank-change-firm-a.json"));
  const recentB = signed(loadGolden("GC-04-recent-bank-change-firm-b.json"));
  const monthlyA = monthlyMinorFrom(happyA);
  const monthlyB = monthlyMinorFrom(happyB);
  if (monthlyA !== monthlyB) {
    throw new Error("signed happy-path cases disagree on the monthly schedule");
  }

  const firm = (
    happy: GoldenCase,
    recent: GoldenCase,
  ): SemanticTruth["firms"]["firm-a"] => ({
    reserveMonths: happy.firmConfiguration.cashReserveMonths,
    thresholdMinor: happy.firmConfiguration.dualApprovalThresholdUsd * 100,
    bankChangeHandling: recent.firmConfiguration.bankInstructionChangeHandling,
    recentDisposition: recent.expectedDisposition,
    recentExecutionEligible: recent.expectedExecutionEligibility.eligible,
  });

  return {
    monthlyMinor: monthlyA,
    firms: {
      "firm-a": firm(happyA, recentA),
      "firm-b": firm(happyB, recentB),
    },
  };
}

function initialOption(
  groupId: "reserve" | "bank-change",
  firmId: "firm-a" | "firm-b",
) {
  const group = buildMoneyMovementSetup().policyGroups.find(
    (candidate) => candidate.id === groupId,
  );
  const firm = group?.firms.find((candidate) => candidate.firmId === firmId);
  const option = firm?.options.find(
    (candidate) => candidate.id === firm.initialOptionId,
  );
  if (!option) throw new Error(`missing ${groupId} initial option for ${firmId}`);
  return option;
}

export function demoSemanticFacts(): DemoSemanticFacts {
  const firm = (
    firmId: "firm-a" | "firm-b",
  ): DemoSemanticFacts["firms"]["firm-a"] => {
    const data = FIRMS[firmId]!;
    const reserve = initialOption("reserve", firmId);
    const bank = initialOption("bank-change", firmId);
    const displayedReserveMinor = Number(reserve.reserveMetric?.value);
    return {
      reserveMonths: data.reserveMonths,
      thresholdMinor: data.dualApprovalThresholdMinor,
      bankChangeHandling: data.bankChangeHandling,
      displayedReserveMinor,
      recentDisposition: bank.smithsEffect.status.status,
      recentExecutionEligible: bank.smithsEffect.reachesAuthority === true,
    };
  };
  return {
    monthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    firms: { "firm-a": firm("firm-a"), "firm-b": firm("firm-b") },
  };
}

export function semanticTruthViolations(
  actual: DemoSemanticFacts,
  truth: SemanticTruth,
): string[] {
  const violations: string[] = [];
  if (actual.monthlyMinor !== truth.monthlyMinor) {
    violations.push(
      `${sourceRef("src/app/demo/data.ts", "export const PLANNED_WITHDRAWAL_MONTHLY_MINOR")} :: monthly schedule ${actual.monthlyMinor} differs from captain-signed ${truth.monthlyMinor}`,
    );
  }
  for (const [firmIndex, firmId] of (["firm-a", "firm-b"] as const).entries()) {
    const got = actual.firms[firmId];
    const expected = truth.firms[firmId];
    const prefix = `${firmId}`;
    if (got.reserveMonths !== expected.reserveMonths) {
      violations.push(
        `${sourceRef("src/app/demo/data.ts", "    reserveMonths:", firmIndex)} :: ${prefix} reserve horizon ${got.reserveMonths} differs from signed ${expected.reserveMonths}`,
      );
    }
    if (got.thresholdMinor !== expected.thresholdMinor) {
      violations.push(
        `${sourceRef("src/app/demo/data.ts", "    dualApprovalThresholdMinor:", firmIndex)} :: ${prefix} approval threshold ${got.thresholdMinor} differs from signed ${expected.thresholdMinor}`,
      );
    }
    if (got.bankChangeHandling !== expected.bankChangeHandling) {
      violations.push(
        `${sourceRef("src/app/demo/data.ts", "    bankChangeHandling:", firmIndex)} :: ${prefix} bank-change handling "${got.bankChangeHandling}" differs from signed "${expected.bankChangeHandling}"`,
      );
    }
    const derivedFloor = projectReserve({
      availableMinor: 0,
      pendingMinor: 0,
      requestMinor: 0,
      plannedMonthlyMinor: truth.monthlyMinor,
      reserveMonths: expected.reserveMonths,
    }).requiredReserveMinor;
    if (got.displayedReserveMinor !== derivedFloor) {
      violations.push(
        `${sourceRef("src/app/demo/build-setup.ts", "function reserveOption")} :: ${prefix} displayed reserve ${got.displayedReserveMinor} differs from derived signed floor ${derivedFloor}`,
      );
    }
    if (got.recentDisposition !== expected.recentDisposition) {
      violations.push(
        `${sourceRef("src/app/demo/build-setup.ts", "function bankOption")} :: ${prefix} recent-change disposition "${got.recentDisposition}" differs from signed "${expected.recentDisposition}"`,
      );
    }
    if (got.recentExecutionEligible !== expected.recentExecutionEligible) {
      violations.push(
        `${sourceRef("src/app/demo/build-setup.ts", "function bankOption")} :: ${prefix} execution reachability ${got.recentExecutionEligible} differs from signed ${expected.recentExecutionEligible}`,
      );
    }
  }
  return violations;
}

describe("demo semantic-truth fence", () => {
  it("enforces: setup reserve and comparison facts derive from captain-signed cases", () => {
    const violations = semanticTruthViolations(
      demoSemanticFacts(),
      goldenSemanticTruth(),
    );
    expect(
      violations,
      `setup/golden semantic drift:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("enforces: the bounded setup leaves requester participation unresolved", () => {
    const vm = buildMoneyMovementSetup();
    expect(vm.policyGroups).toHaveLength(5);
    expect(vm.policyGroups.map((group) => group.id)).not.toContain("requester");
    expect(vm.baseline.find((row) => row.label === "Requester participation")?.value)
      .toBe("Awaiting captain decision");
    expect(vm.activation.requesterDecisionNotice).toContain("unbound");
  });

  describe("detects (companion): drifted setup truth cannot pass", () => {
    it("flags a second monthly schedule with file:line", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        { ...actual, monthlyMinor: actual.monthlyMinor - 100 },
        goldenSemanticTruth(),
      );
      expect(violations[0]).toContain("src/app/demo/data.ts:");
      expect(violations[0]).toContain("monthly schedule");
    });

    it("flags a duplicated or drifted displayed reserve floor", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        {
          ...actual,
          firms: {
            ...actual.firms,
            "firm-b": {
              ...actual.firms["firm-b"],
              displayedReserveMinor:
                actual.firms["firm-b"].displayedReserveMinor + 1,
            },
          },
        },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("build-setup.ts:") &&
        violation.includes("displayed reserve"),
      )).toBe(true);
    });

    it("flags a winning-firm rewrite of the signed Firm B block", () => {
      const actual = demoSemanticFacts();
      const violations = semanticTruthViolations(
        {
          ...actual,
          firms: {
            ...actual.firms,
            "firm-b": {
              ...actual.firms["firm-b"],
              recentDisposition: "proceed",
              recentExecutionEligible: true,
            },
          },
        },
        goldenSemanticTruth(),
      );
      expect(violations.some((violation) =>
        violation.includes("firm-b") &&
        violation.includes("recent-change disposition"),
      )).toBe(true);
      expect(violations.some((violation) =>
        violation.includes("firm-b") &&
        violation.includes("execution reachability"),
      )).toBe(true);
    });
  });
});
