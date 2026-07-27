import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import {
  DecisionInputBundleSchema,
  EvidenceSnapshotRefSchema,
} from "@contracts/decision-core/evidence";
import { ApprovalTemplateSchema } from "@contracts/decision-core/authority";
import { IntentSchema } from "@contracts/decision-core/trigger";
import { REPO_ROOT } from "./_fence-utils";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(REPO_ROOT, "fixtures/decision-core", `${name}.json`), "utf8")) as Record<string, unknown>;

type ScopedRef = { firmId: string; id: string };
type SourceRef = { sourceRef: ScopedRef; versionRef: ScopedRef };
type ExplanationNode = {
  evidenceSnapshotRefs: ScopedRef[];
  sourceRefs: SourceRef[];
  childNodes: ExplanationNode[];
};
type ExternalAction = {
  targetRef: ScopedRef;
  command: unknown;
  idempotencyKey: string;
  conflictKeys: string[];
  reservationRefs: ScopedRef[];
  preconditions: Array<{ requiredEvidenceSnapshotRefs: ScopedRef[] }>;
  verificationRuleRef: ScopedRef;
  compensatingAction?: ExternalAction;
};
type DecisionFixture = Record<string, unknown> & {
  intentRef: ScopedRef;
  inputBundleRef: ScopedRef;
  createdBy: { firmId: string };
  precedenceTrace: Array<{ left: SourceRef; right: SourceRef }>;
  explanationTrace: ExplanationNode[];
  reevaluateWhen: Array<{ subjectRef?: ScopedRef }>;
  result: Record<string, unknown> & {
    kind: string;
    recommendation?: { parameters: Record<string, unknown> };
    authority?: { mode: string; stages?: Array<{ templateRef: ScopedRef }> };
    blockers?: Array<{ resolvingEvidence: Array<{ subjectRef: ScopedRef }> }>;
    prohibition?: { source: SourceRef; scopeRef: ScopedRef };
    executionPlan?: {
      steps: ExternalAction[];
    };
  };
};

const decisionFixture = (name: string): DecisionFixture =>
  fixture(name) as DecisionFixture;

const crossTenantSource = (source: SourceRef): SourceRef => ({
  ...source,
  sourceRef: { ...source.sourceRef, firmId: "firm-b" },
  versionRef: { ...source.versionRef, firmId: "firm-b" },
});

describe("decision-core tenant-scope fence", () => {
  it("enforces: every immutable bundle reference belongs to the bundle tenant", () => {
    const bundle = fixture("decision-input-bundle") as {
      firmId: string;
      domainConfigVersionRef: { firmId: string };
      policyVersionRef: { firmId: string };
      householdInstructionVersionRefs: Array<{ firmId: string }>;
      evidenceSnapshotRefs: Array<{ firmId: string }>;
    };
    const crossTenant = [
      {
        ...bundle,
        domainConfigVersionRef: { ...bundle.domainConfigVersionRef, firmId: "firm-b" },
      },
      { ...bundle, policyVersionRef: { ...bundle.policyVersionRef, firmId: "firm-b" } },
      {
        ...bundle,
        householdInstructionVersionRefs: [
          { ...bundle.householdInstructionVersionRefs[0]!, firmId: "firm-b" },
        ],
      },
      {
        ...bundle,
        evidenceSnapshotRefs: [{ ...bundle.evidenceSnapshotRefs[0]!, firmId: "firm-b" }],
      },
    ];
    for (const value of crossTenant) expect(DecisionInputBundleSchema.safeParse(value).success).toBe(false);
  });

  it("enforces: prompt-5 configuration, source, and subject links are tenant-scoped", () => {
    const intent = {
      firmId: "firm-a",
      id: "intent:1",
      trigger: {
        kind: "system_event",
        firmId: "firm-a",
        sourceRef: { firmId: "firm-a", id: "source:crm" },
        eventType: "changed",
        eventRef: "event:1",
        tokenizedPayload: { value: {}, piiFree: true },
      },
      domainConfigVersionRef: { firmId: "firm-a", id: "config:1" },
      action: "primitive:act",
      slots: {},
      createdAt: "2026-07-26T13:30:00.000Z",
    };
    const snapshot = {
      firmId: "firm-a",
      id: "evidence:1",
      kind: "account-balance",
      sourceRef: { firmId: "firm-a", id: "source:crm" },
      subjectRef: { firmId: "firm-a", id: "subject:household" },
      observedAt: "2026-07-26T13:30:00.000Z",
      retrievedAt: "2026-07-26T13:30:00.000Z",
      attribution: "crm",
      schemaVersion: "1",
      encryptedStorageRef: "blob:1",
      contentHash: "a".repeat(64),
      freshness: "fresh",
    };
    const template = {
      firmId: "firm-a",
      id: "template:1",
      stages: [{
        stageId: "stage:1",
        order: 0,
        executionMode: "sequential",
        requirements: [{
          eligibleRoleIds: ["ops"],
          approvalsRequired: 1,
          distinctActorsRequired: true,
          requesterMayApprove: false,
          priorExecutorMayApprove: false,
          reasonRequiredOnOverride: false,
        }],
        escalationPath: [],
        expiresAfter: "P1D",
      }],
    };
    expect(IntentSchema.safeParse(intent).success).toBe(true);
    expect(EvidenceSnapshotRefSchema.safeParse(snapshot).success).toBe(true);
    expect(ApprovalTemplateSchema.safeParse(template).success).toBe(true);
    expect(
      IntentSchema.safeParse({
        ...intent,
        trigger: {
          ...intent.trigger,
          sourceRef: { ...intent.trigger.sourceRef, firmId: "firm-b" },
        },
      }).success,
    ).toBe(false);
    expect(
      IntentSchema.safeParse({
        ...intent,
        domainConfigVersionRef: { ...intent.domainConfigVersionRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
    expect(
      EvidenceSnapshotRefSchema.safeParse({
        ...snapshot,
        sourceRef: { ...snapshot.sourceRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
    expect(
      EvidenceSnapshotRefSchema.safeParse({
        ...snapshot,
        subjectRef: { ...snapshot.subjectRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
    const unscopedTemplate = Object.fromEntries(
      Object.entries(template).filter(([key]) => key !== "firmId"),
    );
    expect(ApprovalTemplateSchema.safeParse(unscopedTemplate).success).toBe(false);
  });

  it("enforces: every direct decision reference belongs to the decision tenant", () => {
    const record = decisionFixture("decision-record-proceed");
    for (const value of [
      { ...record, intentRef: { ...record.intentRef, firmId: "firm-b" } },
      { ...record, inputBundleRef: { ...record.inputBundleRef, firmId: "firm-b" } },
      { ...record, createdBy: { ...record.createdBy, firmId: "firm-b" } },
      { ...record, derivedFromDecisionRef: { firmId: "firm-b", id: "dec:parent" } },
    ]) {
      expect(DecisionRecordSchema.safeParse(value).success).toBe(false);
    }
  });

  it("enforces: precedence and explanation references belong to the decision tenant recursively", () => {
    const record = decisionFixture("decision-record-proceed");
    const precedence = record.precedenceTrace[0]!;
    const explanation = record.explanationTrace[0]!;
    const child = explanation.childNodes[0]!;
    const crossTenant = [
      {
        ...record,
        precedenceTrace: [{
          ...precedence,
          left: crossTenantSource(precedence.left),
        }],
      },
      {
        ...record,
        precedenceTrace: [{
          ...precedence,
          right: crossTenantSource(precedence.right),
        }],
      },
      {
        ...record,
        explanationTrace: [{
          ...explanation,
          sourceRefs: [crossTenantSource(explanation.sourceRefs[0]!)],
        }],
      },
      {
        ...record,
        explanationTrace: [{
          ...explanation,
          childNodes: [{
            ...child,
            evidenceSnapshotRefs: [
              { ...child.evidenceSnapshotRefs[0]!, firmId: "firm-b" },
            ],
          }],
        }],
      },
    ];
    for (const value of crossTenant) {
      expect(DecisionRecordSchema.safeParse(value).success).toBe(false);
    }
  });

  it("enforces: blocker, revaluation, and prohibition subject or scope references belong to the decision tenant", () => {
    const blocked = decisionFixture("decision-record-blocked");
    const condition = blocked.reevaluateWhen.find((candidate) => candidate.subjectRef)!;
    const blocker = blocked.result.blockers![0]!;
    const request = blocker.resolvingEvidence[0]!;
    for (const value of [
      {
        ...blocked,
        reevaluateWhen: [
          { ...condition, subjectRef: { ...condition.subjectRef!, firmId: "firm-a" } },
        ],
      },
      {
        ...blocked,
        result: {
          ...blocked.result,
          blockers: [{
            ...blocker,
            resolvingEvidence: [{
              ...request,
              subjectRef: { ...request.subjectRef, firmId: "firm-a" },
            }],
          }],
        },
      },
    ]) {
      expect(DecisionRecordSchema.safeParse(value).success).toBe(false);
    }

    const prohibited = decisionFixture("decision-record-prohibited");
    const prohibition = prohibited.result.prohibition!;
    for (const value of [
      {
        ...prohibited,
        result: {
          ...prohibited.result,
          prohibition: {
            ...prohibition,
            source: crossTenantSource(prohibition.source),
          },
        },
      },
      {
        ...prohibited,
        result: {
          ...prohibited.result,
          prohibition: {
            ...prohibition,
            scopeRef: { ...prohibition.scopeRef, firmId: "firm-b" },
          },
        },
      },
    ]) {
      expect(DecisionRecordSchema.safeParse(value).success).toBe(false);
    }
  });

  it("enforces: approval and external-action references belong to the decision tenant recursively", () => {
    const proceed = decisionFixture("decision-record-proceed");
    const executionPlan = proceed.result.executionPlan!;
    const step = executionPlan.steps[0]!;
    const precondition = step.preconditions[0]!;
    const recommendation = proceed.result.recommendation!;
    const sourceSubject = recommendation.parameters.sourceSubject as ScopedRef;
    const authority = proceed.result.authority!;
    const stage = authority.stages![0]!;
    const compensation = {
      targetRef: step.targetRef,
      command: step.command,
      idempotencyKey: "idem:compensate",
      conflictKeys: step.conflictKeys,
      reservationRefs: step.reservationRefs,
      preconditions: step.preconditions,
      verificationRuleRef: step.verificationRuleRef,
      reasonCode: "later-step-failed",
    };
    const crossTenant = [
      {
        ...proceed,
        result: {
          ...proceed.result,
          recommendation: {
            ...recommendation,
            parameters: {
              ...recommendation.parameters,
              sourceSubject: { ...sourceSubject, firmId: "firm-b" },
            },
          },
        },
      },
      {
        ...proceed,
        result: {
          ...proceed.result,
          authority: {
            ...authority,
            stages: [{
              ...stage,
              templateRef: { ...stage.templateRef, firmId: "firm-b" },
            }],
          },
        },
      },
      {
        ...proceed,
        result: {
          ...proceed.result,
          executionPlan: {
            ...executionPlan,
            steps: [{ ...step, targetRef: { ...step.targetRef, firmId: "firm-b" } }],
          },
        },
      },
      {
        ...proceed,
        result: {
          ...proceed.result,
          executionPlan: {
            ...executionPlan,
            steps: [{
              ...step,
              reservationRefs: [{ ...step.reservationRefs[0]!, firmId: "firm-b" }],
            }],
          },
        },
      },
      {
        ...proceed,
        result: {
          ...proceed.result,
          executionPlan: {
            ...executionPlan,
            steps: [{
              ...step,
              verificationRuleRef: { ...step.verificationRuleRef, firmId: "firm-b" },
            }],
          },
        },
      },
      {
        ...proceed,
        result: {
          ...proceed.result,
          executionPlan: {
            ...executionPlan,
            steps: [{
              ...step,
              preconditions: [{
                ...precondition,
                requiredEvidenceSnapshotRefs: [
                  { ...precondition.requiredEvidenceSnapshotRefs[0]!, firmId: "firm-b" },
                ],
              }],
            }],
          },
        },
      },
      {
        ...proceed,
        result: {
          ...proceed.result,
          executionPlan: {
            ...executionPlan,
            steps: [{
              ...step,
              compensatingAction: {
                ...compensation,
                targetRef: { ...compensation.targetRef, firmId: "firm-b" },
              },
            }],
          },
        },
      },
    ];
    for (const value of crossTenant) {
      expect(DecisionRecordSchema.safeParse(value).success).toBe(false);
    }
  });

  describe("detects (companion): legal tenant-scoped counterparts parse", () => {
    it("accepts bundle and decision fixtures whose nested firm IDs match their enclosing firm", () => {
      expect(DecisionInputBundleSchema.safeParse(fixture("decision-input-bundle")).success).toBe(true);
      for (const name of [
        "decision-record-proceed",
        "decision-record-blocked",
        "decision-record-prohibited",
      ]) {
        expect(DecisionRecordSchema.safeParse(fixture(name)).success).toBe(true);
      }
    });
  });
});
