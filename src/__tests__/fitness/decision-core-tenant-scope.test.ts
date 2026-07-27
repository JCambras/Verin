import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Node, SyntaxKind } from "ts-morph";
import { describe, expect, it } from "vitest";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import {
  DecisionInputBundleSchema,
  EvidenceSnapshotRefSchema,
} from "@contracts/decision-core/evidence";
import { ApprovalTemplateSchema } from "@contracts/decision-core/authority";
import {
  AmbiguityRefSchema,
  IntentSchema,
} from "@contracts/decision-core/trigger";
import { REPO_ROOT, realProject } from "./_fence-utils";

const SCOPED_REFERENCE_COLLECTION_CONSTRAINTS = {
  "decision.ts:evidenceSnapshotRefs": "decision-record-recursive",
  "decision.ts:sourceRefs": "decision-record-recursive",
  "evidence.ts:evidenceSnapshotRefs": "bundle-enclosing-firm",
  "evidence.ts:householdInstructionVersionRefs": "bundle-enclosing-firm",
  "execution.ts:requiredEvidenceSnapshotRefs": "action-target-firm",
  "execution.ts:reservationRefs": "action-target-firm",
  "ids.ts:roleRefSet": "single-tenant-role-set",
  "trigger.ts:EvidenceSupplierSetSchema": "evidence-subject-firm",
  "trigger.ts:candidateRefs": "single-tenant-ambiguity",
} as const;

const discoveredScopedReferenceCollections = (): string[] => {
  const project = realProject();
  const decisionCoreFiles = project
    .getSourceFiles()
    .filter((sourceFile) =>
      sourceFile.getFilePath().includes("/src/contracts/decision-core/"),
    );
  const ids = decisionCoreFiles.find(
    (sourceFile) => basename(sourceFile.getFilePath()) === "ids.ts",
  )!;
  const scopedSchemas = new Set(
    ids
      .getVariableDeclarations()
      .filter((declaration) =>
        declaration.getInitializer()?.getText().startsWith(
          "tenantScopedReference(",
        ),
      )
      .map((declaration) => declaration.getName()),
  );
  scopedSchemas.add("VersionedSourceRefSchema");
  scopedSchemas.add("EvidenceSupplierSchema");

  return decisionCoreFiles
    .flatMap((sourceFile) =>
      sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .flatMap((call) => {
          const expression = call.getExpression();
          const argument = call.getArguments()[0];
          if (
            !Node.isPropertyAccessExpression(expression) ||
            expression.getName() !== "array" ||
            !Node.isIdentifier(argument) ||
            !scopedSchemas.has(argument.getText())
          ) {
            return [];
          }
          const property = call.getFirstAncestorByKind(
            SyntaxKind.PropertyAssignment,
          );
          const declaration = call.getFirstAncestorByKind(
            SyntaxKind.VariableDeclaration,
          );
          const owner = property?.getName() ?? declaration?.getName();
          return owner === undefined
            ? []
            : [`${basename(sourceFile.getFilePath())}:${owner}`];
        }),
    )
    .sort();
};

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(REPO_ROOT, "fixtures/decision-core", `${name}.json`), "utf8")) as Record<string, unknown>;

type ScopedRef = { firmId: string; id: string };
type RoleRef = ScopedRef;
type SourceRef = { sourceRef: ScopedRef; versionRef: ScopedRef };
type ExplanationNode = {
  evidenceSnapshotRefs: ScopedRef[];
  sourceRefs: SourceRef[];
  childNodes: ExplanationNode[];
};
type ExternalAction = {
  targetRef: ScopedRef;
  command: { payloadRef: ScopedRef };
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
    authority?: {
      mode: string;
      specialistRoleIds?: RoleRef[];
      stages?: Array<{
        templateRef: ScopedRef;
        requirements: Array<{ eligibleRoleIds: RoleRef[] }>;
        escalationPath: Array<{ roleIds: RoleRef[] }>;
      }>;
    };
    blockers?: Array<{
      resolvingEvidence: Array<{
        subjectRef: ScopedRef;
        suppliableBy: Array<string | RoleRef>;
      }>;
    }>;
    prohibition?: { source: SourceRef; scopeRef: ScopedRef };
    executionPlan?: {
      steps: ExternalAction[];
    };
  };
};

const decisionFixture = (name: string): DecisionFixture =>
  fixture(name) as DecisionFixture;

/** Re-tenants an entire subtree, producing a value that is COHERENT in another firm. */
const reTenant = <T>(value: T, firmId: string): T => {
  if (Array.isArray(value)) return value.map((item) => reTenant(item, firmId)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) =>
        key === "firmId" ? [key, firmId] : [key, reTenant(nested, firmId)],
      ),
    ) as T;
  }
  return value;
};

const crossTenantSource = (source: SourceRef): SourceRef => ({
  ...source,
  sourceRef: { ...source.sourceRef, firmId: "firm-b" },
  versionRef: { ...source.versionRef, firmId: "firm-b" },
});

describe("decision-core tenant-scope fence", () => {
  it("keeps the scoped-reference collection registry exhaustive", () => {
    const discovered = discoveredScopedReferenceCollections();
    expect(discovered).toContain("trigger.ts:candidateRefs");
    expect(discovered).toEqual(
      Object.keys(SCOPED_REFERENCE_COLLECTION_CONSTRAINTS).sort(),
    );
  });

  it("enforces: ambiguity candidates are duplicate-free and belong to one tenant", () => {
    const candidate = { firmId: "firm-a", id: "subject:a" };
    const legal = {
      slotName: "household",
      candidateRefs: [
        { firmId: "firm-a", id: "subject:b" },
        candidate,
      ],
      humanQuestionCode: "choose-household",
    };
    expect(AmbiguityRefSchema.safeParse(legal).success).toBe(true);
    expect(
      AmbiguityRefSchema.safeParse({
        ...legal,
        candidateRefs: [
          candidate,
          { firmId: "firm-b", id: "subject:b" },
        ],
      }).success,
    ).toBe(false);
    expect(
      AmbiguityRefSchema.safeParse({
        ...legal,
        candidateRefs: [candidate, candidate],
      }).success,
    ).toBe(false);
  });

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
        eventRef: { firmId: "firm-a", id: "event:1" },
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
      encryptedStorageRef: { firmId: "firm-a", id: "blob:1" },
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
          eligibleRoleIds: [{ firmId: "firm-a", id: "ops" }],
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
        trigger: {
          ...intent.trigger,
          eventRef: { ...intent.trigger.eventRef, firmId: "firm-b" },
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
        encryptedStorageRef: { ...snapshot.encryptedStorageRef, firmId: "firm-b" },
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
    expect(ApprovalTemplateSchema.safeParse({
      ...template,
      stages: [{
        ...template.stages[0]!,
        requirements: [{
          ...template.stages[0]!.requirements[0]!,
          eligibleRoleIds: [{ firmId: "firm-b", id: "ops" }],
        }],
      }],
    }).success).toBe(false);
    expect(ApprovalTemplateSchema.safeParse({
      ...template,
      stages: [{
        ...template.stages[0]!,
        escalationPath: [{
          after: "P1D",
          roleIds: [{ firmId: "firm-b", id: "operations-manager" }],
          reasonCode: "approval-stage-idle",
        }],
      }],
    }).success).toBe(false);
  });

  it("enforces: every direct decision reference belongs to the decision tenant", () => {
    const record = decisionFixture("decision-record-proceed");
    for (const value of [
      { ...record, intentRef: { ...record.intentRef, firmId: "firm-b" } },
      { ...record, inputBundleRef: { ...record.inputBundleRef, firmId: "firm-b" } },
      { ...record, createdBy: { ...record.createdBy, firmId: "firm-b" } },
      {
        ...record,
        createdBy: {
          firmId: "firm-a",
          actorId: "actor:advisor",
          roleIds: [{ firmId: "firm-b", id: "advisor" }],
        },
      },
      { ...record, derivedFromDecisionRef: { firmId: "firm-b", id: "dec:parent" } },
    ]) {
      expect(DecisionRecordSchema.safeParse(value).success).toBe(false);
    }
  });

  it("enforces: human request storage references belong to the request tenant", () => {
    const intent = {
      firmId: "firm-a",
      id: "intent:human:1",
      trigger: {
        kind: "human_request",
        requester: {
          firmId: "firm-a",
          actorId: "actor:advisor",
          roleIds: [{ firmId: "firm-a", id: "advisor" }],
        },
        requestRef: { firmId: "firm-a", id: "request:1" },
        maskedRequest: { value: "move tokenized amount", piiFree: true },
      },
      domainConfigVersionRef: { firmId: "firm-a", id: "config:1" },
      action: "primitive:move",
      slots: {},
      createdAt: "2026-07-26T13:30:00.000Z",
    };
    expect(IntentSchema.safeParse(intent).success).toBe(true);
    expect(
      IntentSchema.safeParse({
        ...intent,
        trigger: {
          ...intent.trigger,
          requestRef: { ...intent.trigger.requestRef, firmId: "firm-b" },
        },
      }).success,
    ).toBe(false);
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
      {
        ...blocked,
        result: {
          ...blocked.result,
          blockers: [{
            ...blocker,
            resolvingEvidence: [{
              ...request,
              suppliableBy: [{ firmId: "firm-a", id: "operations" }],
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
              requirements: [{
                ...stage.requirements[0]!,
                eligibleRoleIds: [{ firmId: "firm-b", id: "operations" }],
              }],
            }],
          },
        },
      },
      {
        ...proceed,
        result: {
          ...proceed.result,
          authority: {
            mode: "specialist_review",
            specialistRoleIds: [{ firmId: "firm-b", id: "cco" }],
            stages: authority.stages,
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
              escalationPath: [{
                ...stage.escalationPath[0]!,
                roleIds: [{ firmId: "firm-b", id: "operations-manager" }],
              }],
            }],
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
      // A plan that is INTERNALLY coherent in another firm: execution.ts's own
      // refinements are all satisfied, so the record-level step-target edge is the
      // only thing standing between a firm-a decision and a firm-b plan.
      {
        ...proceed,
        result: { ...proceed.result, executionPlan: reTenant(executionPlan, "firm-b") },
      },
      {
        ...proceed,
        result: {
          ...proceed.result,
          executionPlan: {
            ...executionPlan,
            steps: [{
              ...step,
              command: {
                ...step.command,
                payloadRef: { ...step.command.payloadRef, firmId: "firm-b" },
              },
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
