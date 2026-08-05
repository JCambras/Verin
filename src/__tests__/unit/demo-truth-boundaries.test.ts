import { describe, expect, it } from "vitest";
import { actorRefOf, authorizeGovernedAction } from "@contracts/authz";
import { principalFromIdentity } from "@contracts/principal";
import { unwrap } from "@contracts/result";
import {
  bindExactSourceCase,
  firmById,
  resolveSourceCaseId,
  scenarioById,
  sourceCaseFor,
} from "@app/demo/data";
import { compareComparisonEvidence } from "@app/demo/comparison-evidence";
import { auditPositionFor } from "@app/demo/audit-position";
import { policyRerunDecisionBindingFor } from "@app/demo/decision-bindings";
import {
  executionEligibilityProof,
  isVerifiedPostReviewBankEvidence,
} from "@app/demo/execution-preconditions";
import { getJourney } from "@app/demo/journey";
import type { DemoPolicyApprovalEventVM } from "@app/demo/model";
import {
  demoPolicyApprovalEventFor,
  recordDemoPolicyApproval,
} from "@app/demo/policy-approval-events";
import { evaluatePolicyRerun } from "@app/demo/policy-rerun";
import {
  SIGNED_CASE_IDS,
  type SignedCaseVariant,
} from "@app/demo/signed-cases";
import { timelineFor } from "@app/demo/timeline";

function policyApprovalGrant(orgId: string) {
  const principal = principalFromIdentity({
    userId: `policy-approver-${orgId}`,
    orgId,
    role: "cco",
    actor: `policy-approver-${orgId}@example.test`,
    sessionId: `session-${orgId}`,
  });
  return unwrap(
    authorizeGovernedAction(actorRefOf(principal), "policy.approve"),
  );
}

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

  it("classifies incomplete signed approval bindings as an Authority stop", () => {
    const journey = getJourney(
      "safe-proceed",
      "firm-a",
      "initial",
      "GC-01-firm-a-happy-path",
    );

    expect(journey.stopNote).toMatch(
      /^This journey stopped at Authority: Missing signed approval actor identity, role, and requester bindings\./,
    );
    expect(journey.record.stopNote).toBe(journey.stopNote);
  });

  it("preserves approval chronology without signed actor bindings", () => {
    const scenario = bindExactSourceCase(
      scenarioById("safe-proceed"),
      "firm-a",
      "GC-01-firm-a-happy-path",
    );
    const firm = firmById("firm-a");
    const approvals = getJourney(
      scenario.id,
      firm.id,
      "initial",
      "GC-01-firm-a-happy-path",
    ).record.lifecycle.filter(({ type }) => type === "ApprovalRecorded");
    const timeline = timelineFor(scenario, firm);

    expect(approvals.map(({ timestampIso }) => timestampIso)).toEqual([
      timeline.approvalOneAt,
      timeline.approvalTwoAt,
    ]);
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
            kind: "system_event",
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

  it("compares pre-execution money on a revalidated pass", () => {
    const scenario = bindExactSourceCase(
      scenarioById("approval-invalidation"),
      "firm-a",
      "GC-15-approval-invalidation",
    );
    const source = sourceCaseFor(scenario, "firm-a")!;
    const same = structuredClone(source);
    const revalidation = source.money.preExecutionRevalidation!;
    const changed = {
      ...source,
      money: {
        ...source.money,
        preExecutionRevalidation: {
          ...revalidation,
          pendingLiquidityMinor: revalidation.pendingLiquidityMinor + 1,
        },
      },
    };

    expect(compareComparisonEvidence(source, same, "revalidated").equivalent).toBe(true);
    expect(compareComparisonEvidence(source, changed, "revalidated")).toMatchObject({
      equivalent: false,
      changed: ["signed money inputs"],
    });
  });

  it("requires semantic proof for every execution condition", () => {
    const scenario = bindExactSourceCase(
      scenarioById("safe-proceed"),
      "firm-a",
      "GC-01-firm-a-happy-path",
    );
    const firm = firmById("firm-a");
    const source = sourceCaseFor(scenario, firm.id)!;
    expect(executionEligibilityProof(scenario, firm, source, "initial")).toBe(false);
    let approvalIndex = 0;
    const bound = {
      ...source,
      ledgerEvents: source.ledgerEvents.map((event) => {
        if (event.type !== "ApprovalRecorded") return event;
        approvalIndex += 1;
        return {
          ...event,
          actorId: `actor-${approvalIndex}`,
          roleId: "operations",
          requesterId: "requester-1",
        };
      }),
    };
    expect(executionEligibilityProof(scenario, firm, bound, "initial")).toBe(true);

    const stale = {
      ...bound,
      evidence: bound.evidence.map((entry) =>
        entry.subjectRef === "subject:smiths-joint-taxable"
          ? { ...entry, freshness: "stale" }
          : entry,
      ),
    };
    expect(executionEligibilityProof(scenario, firm, stale, "initial")).toBe(false);

    const unbound = {
      ...bound,
      ledgerEvents: bound.ledgerEvents.filter(
        ({ type }) => type !== "ApprovalRecorded",
      ),
    };
    expect(executionEligibilityProof(scenario, firm, unbound, "initial")).toBe(false);

    for (const key of ["actorId", "roleId", "requesterId"] as const) {
      const missingBinding = {
        ...bound,
        ledgerEvents: bound.ledgerEvents.map((event) =>
          event.type === "ApprovalRecorded"
            ? { ...event, [key]: null }
            : event,
        ),
      };
      expect(
        executionEligibilityProof(scenario, firm, missingBinding, "initial"),
      ).toBe(false);
    }

    const duplicateActor = {
      ...bound,
      ledgerEvents: bound.ledgerEvents.map((event) =>
        event.type === "ApprovalRecorded"
          ? { ...event, actorId: "actor-1" }
          : event,
      ),
    };
    expect(
      executionEligibilityProof(scenario, firm, duplicateActor, "initial"),
    ).toBe(false);

    const ineligibleRole = {
      ...bound,
      ledgerEvents: bound.ledgerEvents.map((event) =>
        event.type === "ApprovalRecorded"
          ? { ...event, roleId: "requester" }
          : event,
      ),
    };
    expect(
      executionEligibilityProof(scenario, firm, ineligibleRole, "initial"),
    ).toBe(false);

    const lastApprovalIndex = bound.ledgerEvents.reduce(
      (last, { type }, index) => type === "ApprovalRecorded" ? index : last,
      -1,
    );
    const expired = {
      ...bound,
      ledgerEvents: [
        ...bound.ledgerEvents.slice(0, lastApprovalIndex + 1),
        {
          type: "ApprovalStageExpired",
          note: "The approved stage later expired.",
          stageId: "ops-dual-approval",
          lifecyclePass: "initial" as const,
          actorId: null,
          roleId: null,
          requesterId: null,
        },
        ...bound.ledgerEvents.slice(lastApprovalIndex + 1),
      ],
    };
    expect(
      executionEligibilityProof(scenario, firm, expired, "initial"),
    ).toBe(false);

    const executionIndex = bound.ledgerEvents.findIndex(
      ({ type }) => type === "ExecutionStarted",
    );
    const released = {
      ...bound,
      ledgerEvents: [
        ...bound.ledgerEvents.slice(0, executionIndex),
        {
          type: "ReservationReleased",
          note: "Reservation released before execution.",
          stageId: null,
          lifecyclePass: null,
          actorId: null,
          roleId: null,
          requesterId: null,
        },
        ...bound.ledgerEvents.slice(executionIndex),
      ],
    };
    expect(executionEligibilityProof(scenario, firm, released, "initial")).toBe(false);

    const unknown = {
      ...bound,
      executionEligibility: {
        ...bound.executionEligibility,
        preconditions: [
          ...bound.executionEligibility.preconditions,
          {
            code: "unknown-proof",
            requiredEvidence: [],
            mustStillHoldAtExecution: true,
          },
        ],
      },
    };
    expect(executionEligibilityProof(scenario, firm, unknown, "initial")).toBe(false);
  });

  it("requires positive fresh post-review bank verification meaning", () => {
    const source = sourceCaseFor(
      scenarioById("recent-bank-change-block"),
      "firm-a",
    )!;
    const bank = source.evidence.find(
      ({ evidenceKind }) => evidenceKind === "bank-instruction",
    )!;
    expect(isVerifiedPostReviewBankEvidence({
      ...bank,
      liquidityPhase: "pre-execution-revalidation",
      freshness: "fresh",
      summary: "Independent verification pending; the instruction is not yet verified.",
    })).toBe(false);
    expect(isVerifiedPostReviewBankEvidence({
      ...bank,
      liquidityPhase: "pre-execution-revalidation",
      freshness: "fresh",
      summary: "Bank instruction independently verified against the destination record.",
    })).toBe(true);
  });

  it("binds verification proofs to causal events", () => {
    const submitted = getJourney(
      "safe-proceed",
      "firm-b",
      "initial",
      "GC-02-firm-b-happy-path",
    ).verification?.proves[0];
    const unsignedStaged = getJourney(
      "safe-proceed",
      "firm-a",
      "initial",
      "GC-01-firm-a-happy-path",
    ).verification;
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
    expect(unsignedStaged).toBeNull();
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

  it("binds an activated policy rerun to its recomputed outcome", () => {
    const scenario = bindExactSourceCase(
      scenarioById("competing-liquidity"),
      "firm-a",
      "GC-10-simultaneous-distributions-first",
    );
    const firm = firmById("firm-a");
    const policyVersion = "firm-a-policy@2026.08-demo-approved";
    const rerun = evaluatePolicyRerun(
      scenario,
      firm,
      "initial",
      policyVersion,
    )!;
    expect(rerun).toMatchObject({
      disposition: "blocked",
      headroomMinor: 6_400_000,
      executionEligible: false,
      executionPlan: null,
    });
    expect(rerun.explanations).toContainEqual({
      code: "activated-reserve-insufficient-liquidity",
      summary: expect.stringContaining(
        "activated twelve-month reserve leaves 6400000 minor units of headroom for a 7500000 minor-unit request",
      ),
    });

    const policyApproval: DemoPolicyApprovalEventVM = {
      eventId: "policy-event-gc10",
      actorId: "demo-policy-admin",
      actorRole: "policy-admin",
      tenantOrgId: "org-demo",
      approvedAt: "Aug 5, 2026, 10:00:00 AM EDT",
      approvedAtIso: "2026-08-05T14:00:00.000Z",
      decisionRecordedAt: "Aug 5, 2026, 10:00:00 AM EDT",
      decisionRecordedAtIso: "2026-08-05T14:00:00.001Z",
      policyHash: "policy-hash-gc10",
      fromVersion: firm.policyVersion,
      toVersion: policyVersion,
      reserveMonths: 12,
      rerun,
      fakeClass: "deterministic-engine-output",
      watermark: "DEMONSTRATION - NOT PRODUCTION DATA",
    };
    const record = getJourney(
      scenario.id,
      firm.id,
      "initial",
      "GC-10-simultaneous-distributions-first",
      policyApproval,
    ).record;
    expect(record.disposition.kind).toBe("blocked");
    expect(record.policyApproval?.rerun).toEqual(rerun);
    expect(record.executionEligibility).toBeNull();
    expect(record.execution).toBeNull();
    expect(record.verification).toBeNull();

    const binding = {
      eventId: policyApproval.eventId,
      policyVersion,
      reserveMonths: policyApproval.reserveMonths,
      recordedAtIso: policyApproval.decisionRecordedAtIso,
      rerun,
    };
    const blockedBinding = policyRerunDecisionBindingFor(
      scenario,
      firm,
      "initial",
      binding,
    );
    const proceedBinding = policyRerunDecisionBindingFor(
      scenario,
      firm,
      "initial",
      {
        ...binding,
        rerun: {
          ...rerun,
          disposition: "proceed",
          executionEligible: true,
          executionReason: "Candidate plan available.",
          executionPlan: {
            action: "money-movement",
            sourceCaseId: "GC-10-simultaneous-distributions-first",
            requestRef: "request:gc10-first",
            amountMinor: 7_500_000,
            policyVersion,
          },
        },
      },
    );
    expect(proceedBinding.bundleHash).toBe(blockedBinding.bundleHash);
    expect(proceedBinding.decisionHash).not.toBe(blockedBinding.decisionHash);
    const staleExplanationBinding = policyRerunDecisionBindingFor(
      scenario,
      firm,
      "initial",
      {
        ...binding,
        rerun: {
          ...rerun,
          explanations: sourceCaseFor(scenario, firm.id)!.explanations,
        },
      },
    );
    expect(staleExplanationBinding.bundleHash).toBe(blockedBinding.bundleHash);
    expect(staleExplanationBinding.decisionHash).not.toBe(
      blockedBinding.decisionHash,
    );
    expect(record.decisionBindings.at(-1)).toMatchObject({
      kind: "derived",
      ...blockedBinding,
    });
  });

  it("retains policy approval authority independently per tenant", () => {
    const request = {
      scenarioId: "competing-liquidity",
      firmId: "firm-a",
      sourceCaseId: "GC-10-simultaneous-distributions-first",
      pass: "initial" as const,
    };
    const runId = Date.now().toString(36);
    const tenantA = `retention-a-${runId}`;
    const tenantB = `retention-b-${runId}`;
    const retained = unwrap(
      recordDemoPolicyApproval(policyApprovalGrant(tenantA), request),
    );
    const firstEvicted = unwrap(
      recordDemoPolicyApproval(policyApprovalGrant(tenantB), request),
    );
    let newest = firstEvicted;
    for (let index = 0; index < 256; index += 1) {
      newest = unwrap(
        recordDemoPolicyApproval(policyApprovalGrant(tenantB), request),
      );
    }

    expect(
      demoPolicyApprovalEventFor(retained.eventId, tenantA, request),
    ).toEqual(retained);
    expect(
      demoPolicyApprovalEventFor(firstEvicted.eventId, tenantB, request),
    ).toBeNull();
    expect(
      demoPolicyApprovalEventFor(newest.eventId, tenantB, request),
    ).toEqual(newest);
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
    const firmAAudit = firmA.record.hashes.auditPosition;
    const firmBAudit = firmB.record.hashes.auditPosition;
    const gc07Audit = gc07.record.hashes.auditPosition;
    expect(firmAAudit).not.toBeNull();
    expect(firmBAudit).not.toBeNull();
    expect(gc07Audit).not.toBeNull();
    expect(firmAAudit?.orgId).toBe("demo-org");
    expect(firmAAudit?.sequence).not.toBe(
      firmBAudit?.sequence,
    );
    expect(firmAAudit?.sequence).not.toBe(
      gc07Audit?.sequence,
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
    const simulation = getJourney(
      "safe-proceed",
      "firm-a",
      "initial",
      "GC-01-firm-a-happy-path",
    ).policyAuthoring.simulationDelta;
    expect(simulation).toContainEqual({
      label: "Demo-corpus impact",
      before: { display: "Unavailable - no explicit replay corpus was loaded" },
      after: { display: "Unavailable - no explicit replay corpus was loaded" },
    });
    expect(simulation.some(({ label }) => label.includes("households newly"))).toBe(false);
  });
});
