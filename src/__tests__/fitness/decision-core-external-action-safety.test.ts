import { describe, expect, it } from "vitest";
import {
  CompensatingActionSchema,
  ExecutionPlanSchema,
  RetrySafeExternalActionSchema,
} from "@contracts/decision-core/execution";

const hash = "a".repeat(64);
const action = {
  targetRef: { firmId: "firm-a", id: "target:house-crm" },
  command: { commandType: "submit", payloadRef: "blob:submit", payloadHash: hash },
  idempotencyKey: "idem:submit",
  conflictKeys: ["conflict:liquidity"],
  reservationRefs: [{ firmId: "firm-a", id: "reservation:liquidity" }],
  preconditions: [
    {
      code: "evidence-still-fresh",
      requiredEvidenceSnapshotRefs: [{ firmId: "firm-a", id: "evidence:balance" }],
      mustStillHoldAtExecution: true,
    },
  ],
  verificationRuleRef: { firmId: "firm-a", id: "verification:submitted" },
};
const compensation = {
  ...action,
  command: { ...action.command, commandType: "cancel", payloadRef: "blob:cancel" },
  idempotencyKey: "idem:cancel",
  reasonCode: "later-step-failed",
};

describe("decision-core external-action safety fence", () => {
  it.each([
    "idempotencyKey",
    "conflictKeys",
    "reservationRefs",
    "preconditions",
    "verificationRuleRef",
  ] as const)("enforces: compensation requires %s", (key) => {
    const incomplete = Object.fromEntries(
      Object.entries(compensation).filter(([candidate]) => candidate !== key),
    );
    const parsed = CompensatingActionSchema.safeParse(incomplete);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === key)).toBe(true);
    }
  });

  it("enforces: conflict control and pre-execution revalidation cannot be empty or advisory", () => {
    expect(CompensatingActionSchema.safeParse({ ...compensation, conflictKeys: [] }).success).toBe(false);
    expect(CompensatingActionSchema.safeParse({ ...compensation, preconditions: [] }).success).toBe(false);
    expect(
      CompensatingActionSchema.safeParse({
        ...compensation,
        preconditions: [{ ...compensation.preconditions[0]!, mustStillHoldAtExecution: false }],
      }).success,
    ).toBe(false);
  });

  it("enforces: parent and compensation idempotency keys cannot alias", () => {
    const parsed = ExecutionPlanSchema.safeParse({
      id: "plan:1",
      steps: [
        {
          id: "step:1",
          ...action,
          dependsOn: [],
          compensatingAction: { ...compensation, idempotencyKey: action.idempotencyKey },
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.includes("compensatingAction"))).toBe(true);
    }
  });

  describe("detects (companion): complete retry-safe actions parse", () => {
    it("accepts the shared action, compensation, and execution-step shapes", () => {
      expect(RetrySafeExternalActionSchema.safeParse(action).success).toBe(true);
      expect(CompensatingActionSchema.safeParse(compensation).success).toBe(true);
      expect(
        ExecutionPlanSchema.safeParse({
          id: "plan:1",
          steps: [{ id: "step:1", ...action, dependsOn: [], compensatingAction: compensation }],
        }).success,
      ).toBe(true);
    });
  });
});
