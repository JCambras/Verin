import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  BlockedDecisionSchema,
  DecisionRecordSchema,
  DecisionResultSchema,
  ProceedDecisionSchema,
  ProhibitedDecisionSchema,
  ProhibitionSchema,
} from "@contracts/decision-core/decision";
import { AuthorityRequirementSchema } from "@contracts/decision-core/authority";
import { ResolvableBlockerSchema } from "@contracts/decision-core/trigger";
import { ExecutionPlanSchema } from "@contracts/decision-core/execution";

/**
 * DECISION-CORE ILLEGAL-STATES FENCE (v3 §5 / invariants 7–9; ADR-0029, D-040;
 * charter #1). The canonical type system makes the major distinctions STRUCTURAL:
 *  - inv 7: a proceed decision cannot exist without authority AND an execution plan;
 *  - inv 8: a blocked decision cannot carry authority or an execution plan;
 *  - inv 9: a prohibited decision cannot carry a resolving condition, authority,
 *    or an execution plan.
 * Disposition and authority are separate planes and never collapse. This fence is
 * the runnable mechanism registered for invariants 7–9 in v3-invariants.json -
 * every rejection here is a PARSE failure, not reviewer discipline.
 */

// Minimal VALID building blocks - the legal counterparts the companion proves parse.
const authority = { mode: "automatic" } as const;
const plan = {
  id: "plan:fence:1",
  steps: [
    {
      id: "step:fence:1",
      targetRef: { firmId: "firm-a", id: "target:house-crm" },
      command: { commandType: "submit", payloadRef: "blob:fence:1", payloadHash: "a".repeat(64) },
      idempotencyKey: "idem:fence:1",
      conflictKeys: ["conflict:fence:1"],
      reservationRefs: [],
      preconditions: [{
        code: "evidence-still-fresh",
        requiredEvidenceSnapshotRefs: [],
        mustStillHoldAtExecution: true,
      }],
      verificationRuleRef: { firmId: "firm-a", id: "vr:fence:1" },
      dependsOn: [],
    },
  ],
};
const recommendation = { code: "act", summary: "Act.", parameters: {}, alternatives: [] };
const blocker = {
  code: "cash-reserve-breach",
  explanation: "Reserve would be breached.",
  resolvingEvidence: [{
    evidenceKind: "account-balance",
    subjectRef: { firmId: "firm-a", id: "subject:x" },
    suppliableBy: ["external"],
  }],
};
const prohibition = {
  source: {
    sourceType: "regulatory",
    sourceRef: { firmId: "firm-a", id: "reg-holds" },
    versionRef: { firmId: "firm-a", id: "reg-holds@2026.02" },
  },
  scopeRef: { firmId: "firm-a", id: "scope:account:x" },
  reasonCode: "active-legal-hold",
  explanation: "Active legal hold.",
};
const proceed = { kind: "proceed", recommendation, authority, executionPlan: plan };
const blocked = { kind: "blocked", blockers: [blocker] };
const prohibited = { kind: "prohibited", prohibition };

const record = (result: unknown, over: Record<string, unknown> = {}) => ({
  firmId: "firm-a",
  id: "dec:fence:1",
  intentRef: { firmId: "firm-a", id: "intent:fence:1" },
  inputBundleRef: { firmId: "firm-a", id: "bundle:fence:1" },
  result,
  precedenceTrace: [],
  explanationTrace: [],
  riskClass: "medium",
  reversibility: "reversible",
  reevaluateWhen: [],
  decisionHash: "b".repeat(64),
  createdBy: { firmId: "firm-a", systemId: "verin-decision-engine" },
  createdAt: "2026-07-26T13:30:00.000Z",
  ...over,
});

const omit = (obj: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

/** Assert rejection AND that the failure names the offending path/key (file:line-grade evidence). */
function expectRejected(schema: z.ZodType, value: unknown, offendingKey: string) {
  const parsed = schema.safeParse(value);
  expect(parsed.success, `expected rejection naming "${offendingKey}"`).toBe(false);
  if (!parsed.success) {
    const evidence = parsed.error.issues.map((i) => `${i.path.join(".")}|${i.message}|${JSON.stringify((i as { keys?: string[] }).keys ?? [])}`).join("\n");
    expect(evidence).toContain(offendingKey);
  }
}

describe("decision-core illegal-states fence", () => {
  describe("enforces: invariant 7 - proceed requires authority and an execution plan", () => {
    it("rejects proceed without authority", () => {
      expectRejected(ProceedDecisionSchema, omit(proceed, "authority"), "authority");
    });
    it("rejects proceed without an execution plan", () => {
      expectRejected(ProceedDecisionSchema, omit(proceed, "executionPlan"), "executionPlan");
    });
    it("rejects proceed with an EMPTY execution plan (a plan-shaped void is still no plan)", () => {
      expectRejected(ProceedDecisionSchema, { ...proceed, executionPlan: { ...plan, steps: [] } }, "steps");
    });
    it("rejects a dependency cycle (an unusable graph is still no executable plan)", () => {
      const base = plan.steps[0]!;
      const cyclic = {
        id: "plan:fence:cycle",
        steps: [
          { ...base, id: "s1", idempotencyKey: "idem:s1", dependsOn: ["s2"] },
          {
            ...base,
            id: "s2",
            command: { ...base.command, payloadRef: "blob:fence:2" },
            idempotencyKey: "idem:s2",
            dependsOn: ["s1"],
          },
        ],
      };
      expectRejected(ExecutionPlanSchema, cyclic, "steps");
    });
    it("rejects an approval authority with zero stages (automatic wearing a costume)", () => {
      expectRejected(AuthorityRequirementSchema, { mode: "approval", stages: [] }, "stages");
    });
    it("rejects a specialist review with zero stages (the same costume, audit F7)", () => {
      expectRejected(AuthorityRequirementSchema, { mode: "specialist_review", specialistRoleIds: ["cco"], stages: [] }, "stages");
    });
  });

  describe("enforces: invariant 8 - blocked cannot carry authority or an execution plan", () => {
    it("rejects authority on a blocked result", () => {
      expectRejected(BlockedDecisionSchema, { ...blocked, authority }, "authority");
    });
    it("rejects an execution plan on a blocked result", () => {
      expectRejected(BlockedDecisionSchema, { ...blocked, executionPlan: plan }, "executionPlan");
    });
    it("rejects blocked with zero blockers (nothing to resolve is not a block)", () => {
      expectRejected(BlockedDecisionSchema, { kind: "blocked", blockers: [] }, "blockers");
    });
    it("rejects a 'resolvable' blocker with no resolving evidence (that shape is a prohibition)", () => {
      expectRejected(ResolvableBlockerSchema, { ...blocker, resolvingEvidence: [] }, "resolvingEvidence");
    });
  });

  describe("enforces: invariant 9 - prohibited carries no resolving condition, authority, or plan", () => {
    it("rejects authority on a prohibited result", () => {
      expectRejected(ProhibitedDecisionSchema, { ...prohibited, authority }, "authority");
    });
    it("rejects an execution plan on a prohibited result", () => {
      expectRejected(ProhibitedDecisionSchema, { ...prohibited, executionPlan: plan }, "executionPlan");
    });
    it("rejects resolving evidence smuggled into a prohibition", () => {
      expectRejected(ProhibitionSchema, { ...prohibition, resolvingEvidence: blocker.resolvingEvidence }, "resolvingEvidence");
    });
    it("rejects a prohibited record carrying revaluation conditions (the other resolving-condition channel)", () => {
      expectRejected(
        DecisionRecordSchema,
        record(prohibited, { reevaluateWhen: [{ kind: "policy_changed" }] }),
        "reevaluateWhen",
      );
    });
  });

  describe("enforces: disposition and authority never collapse", () => {
    it("rejects authority beside the disposition on the record (it lives only inside the proceed arm)", () => {
      expectRejected(DecisionRecordSchema, record(proceed, { authority }), "authority");
    });
    it("rejects an authority-like disposition kind", () => {
      expectRejected(DecisionResultSchema, { kind: "approved", recommendation, authority, executionPlan: plan }, "kind");
    });
  });

  describe("detects (companion): the LEGAL counterpart of every rejection parses - rejections are attributable to the violation, not a reject-everything schema", () => {
    it("accepts a complete proceed decision (authority + plan present)", () => {
      expect(ProceedDecisionSchema.safeParse(proceed).success).toBe(true);
    });
    it("accepts a blocked decision carrying only its resolvable blockers", () => {
      expect(BlockedDecisionSchema.safeParse(blocked).success).toBe(true);
    });
    it("accepts a prohibited decision carrying only its prohibition", () => {
      expect(ProhibitedDecisionSchema.safeParse(prohibited).success).toBe(true);
    });
    it("accepts all three dispositions on a full DecisionRecord (incl. a NON-prohibited record with revaluation conditions)", () => {
      for (const result of [proceed, blocked, prohibited]) {
        expect(DecisionRecordSchema.safeParse(record(result)).success).toBe(true);
      }
      const blockedWithRevaluation = record(blocked, {
        reevaluateWhen: [{
          kind: "evidence_changed",
          subjectRef: { firmId: "firm-a", id: "subject:x" },
          evidenceKind: "account-balance",
        }],
      });
      expect(DecisionRecordSchema.safeParse(blockedWithRevaluation).success).toBe(true);
    });
  });
});
