import { describe, expect, it } from "vitest";
import {
  CompensatingActionSchema,
  ExecutionPlanSchema,
  ExecutionStepSchema,
  RetrySafeExternalActionSchema,
} from "@contracts/decision-core/execution";

const hash = "a".repeat(64);
const action = {
  targetRef: { firmId: "firm-a", id: "target:house-crm" },
  command: {
    commandType: "submit",
    payloadRef: { firmId: "firm-a", id: "blob:submit" },
    payloadHash: hash,
  },
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
  command: {
    ...action.command,
    commandType: "cancel",
    payloadRef: { firmId: "firm-a", id: "blob:cancel" },
  },
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

  // ExecutionStepSchema re-declares its OWN strictObject around the shared action shape,
  // so a key overridden AFTER that spread is invisible to the compensation matrix above
  // and to the shared-shape matrices below. v3-invariants.json registers this fence as
  // the live mechanism for "every external execution STEP has an idempotency key and
  // verification rule", so the STEP itself has to be parsed here (D-057).
  it.each([
    "id",
    "targetRef",
    "command",
    "idempotencyKey",
    "conflictKeys",
    "reservationRefs",
    "preconditions",
    "verificationRuleRef",
    "dependsOn",
  ] as const)("enforces: execution step requires %s", (key) => {
    const step = { id: "step:1", ...action, dependsOn: [] };
    const incomplete = Object.fromEntries(
      Object.entries(step).filter(([candidate]) => candidate !== key),
    );
    const parsed = ExecutionStepSchema.safeParse(incomplete);
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
        preconditions: [{
          ...compensation.preconditions[0]!,
          requiredEvidenceSnapshotRefs: [],
        }],
      }).success,
    ).toBe(false);
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

  it.each([
    ["conflictKeys", { conflictKeys: ["conflict:liquidity", "conflict:liquidity"] }],
    [
      "reservationRefs",
      {
        reservationRefs: [
          { firmId: "firm-a", id: "reservation:liquidity" },
          { firmId: "firm-a", id: "reservation:liquidity" },
        ],
      },
    ],
    [
      "precondition evidence refs",
      {
        preconditions: [{
          ...action.preconditions[0]!,
          requiredEvidenceSnapshotRefs: [
            { firmId: "firm-a", id: "evidence:balance" },
            { firmId: "firm-a", id: "evidence:balance" },
          ],
        }],
      },
    ],
    [
      "preconditions",
      {
        preconditions: [action.preconditions[0]!, action.preconditions[0]!],
      },
    ],
  ])("enforces: %s are duplicate-free", (_name, override) => {
    expect(RetrySafeExternalActionSchema.safeParse({ ...action, ...override }).success).toBe(false);
  });

  it("enforces: execution preconditions are canonically ordered semantic sets", () => {
    const first = { ...action.preconditions[0]!, code: "a-still-fresh" };
    const second = { ...action.preconditions[0]!, code: "z-still-fresh" };
    const forward = RetrySafeExternalActionSchema.parse({
      ...action,
      preconditions: [first, second],
    });
    const reversed = RetrySafeExternalActionSchema.parse({
      ...action,
      preconditions: [second, first],
    });
    expect(reversed.preconditions).toEqual(forward.preconditions);
    expect(forward.preconditions.map((precondition) => precondition.code)).toEqual([
      "a-still-fresh",
      "z-still-fresh",
    ]);
    expect(forward.preconditions).toHaveLength(2);
  });

  it.each([
    [
      "payload",
      {
        command: {
          ...action.command,
          payloadRef: { ...action.command.payloadRef, firmId: "firm-b" },
        },
      },
    ],
    [
      "reservation",
      {
        reservationRefs: [
          { ...action.reservationRefs[0]!, firmId: "firm-b" },
        ],
      },
    ],
    [
      "precondition evidence",
      {
        preconditions: [{
          ...action.preconditions[0]!,
          requiredEvidenceSnapshotRefs: [
            {
              ...action.preconditions[0]!.requiredEvidenceSnapshotRefs[0]!,
              firmId: "firm-b",
            },
          ],
        }],
      },
    ],
    [
      "verification rule",
      {
        verificationRuleRef: {
          ...action.verificationRuleRef,
          firmId: "firm-b",
        },
      },
    ],
  ])("enforces: standalone actions reject a cross-tenant %s reference", (_name, override) => {
    expect(
      RetrySafeExternalActionSchema.safeParse({
        ...action,
        ...override,
      }).success,
    ).toBe(false);
  });

  it("enforces: every step and compensation in one plan shares a tenant", () => {
    const firmBAction = {
      ...action,
      targetRef: { firmId: "firm-b", id: "target:house-crm" },
      command: {
        ...action.command,
        payloadRef: { firmId: "firm-b", id: "blob:firm-b" },
      },
      idempotencyKey: "idem:firm-b",
      reservationRefs: [{ firmId: "firm-b", id: "reservation:firm-b" }],
      preconditions: [{
        ...action.preconditions[0]!,
        requiredEvidenceSnapshotRefs: [
          { firmId: "firm-b", id: "evidence:firm-b" },
        ],
      }],
      verificationRuleRef: { firmId: "firm-b", id: "verification:firm-b" },
    };
    expect(
      ExecutionPlanSchema.safeParse({
        id: "plan:mixed",
        steps: [
          { id: "step:firm-a", ...action, dependsOn: [] },
          { id: "step:firm-b", ...firmBAction, dependsOn: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({
        id: "plan:mixed-compensation",
        steps: [{
          id: "step:firm-a",
          ...action,
          dependsOn: [],
          compensatingAction: {
            ...firmBAction,
            idempotencyKey: "idem:firm-b-compensation",
            reasonCode: "later-step-failed",
          },
        }],
      }).success,
    ).toBe(false);
  });

  describe("detects (companion): complete retry-safe actions parse", () => {
    it("accepts the shared action, compensation, and execution-step shapes", () => {
      expect(RetrySafeExternalActionSchema.safeParse(action).success).toBe(true);
      expect(CompensatingActionSchema.safeParse(compensation).success).toBe(true);
      expect(ExecutionStepSchema.safeParse({ id: "step:1", ...action, dependsOn: [] }).success).toBe(true);
      expect(
        ExecutionPlanSchema.safeParse({
          id: "plan:1",
          steps: [{ id: "step:1", ...action, dependsOn: [], compensatingAction: compensation }],
        }).success,
      ).toBe(true);
    });
  });
});
