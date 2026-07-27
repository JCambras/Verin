import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import * as actorSchemas from "@contracts/decision-core/actor";
import * as authoritySchemas from "@contracts/decision-core/authority";
import * as decisionSchemas from "@contracts/decision-core/decision";
import * as evidenceSchemas from "@contracts/decision-core/evidence";
import * as executionSchemas from "@contracts/decision-core/execution";
import * as idSchemas from "@contracts/decision-core/ids";
import * as normalizationSchemas from "@contracts/decision-core/normalization";
import * as serializationSchemas from "@contracts/decision-core/serialization";
import * as triggerSchemas from "@contracts/decision-core/trigger";
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
import { REPO_ROOT } from "./_fence-utils";

const SCOPED_REFERENCE_COLLECTION_CONSTRAINTS = {
  "authority.ts:ApprovalStageSchema.escalationPath": "authority-stage-tenant",
  "authority.ts:ApprovalStageSchema.requirements": "authority-stage-tenant",
  "authority.ts:ApprovalTemplateSchema.stages": "template-enclosing-firm",
  "authority.ts:AuthorityRequirementSchema.stages": "authority-stage-tenant",
  "decision.ts:DecisionRecordSchema.explanationTrace": "decision-record-recursive",
  "decision.ts:DecisionRecordSchema.precedenceTrace": "decision-record-recursive",
  "decision.ts:DecisionRecordSchema.reevaluateWhen": "decision-record-recursive",
  "decision.ts:DecisionResultSchema.blockers": "decision-record-recursive",
  "decision.ts:ExplanationNodeSchema.childNodes": "decision-record-recursive",
  "decision.ts:ExplanationNodeSchema.evidenceSnapshotRefs": "decision-record-recursive",
  "decision.ts:ExplanationNodeSchema.sourceRefs": "decision-record-recursive",
  "decision.ts:RecommendationSchema.parameters": "decision-record-recursive",
  "evidence.ts:DecisionInputBundleSchema.evidenceSnapshotRefs": "bundle-enclosing-firm",
  "evidence.ts:DecisionInputBundleSchema.householdInstructionVersionRefs": "bundle-enclosing-firm",
  "execution.ts:CompensatingActionSchema.preconditions": "action-target-firm",
  "execution.ts:CompensatingActionSchema.reservationRefs": "action-target-firm",
  "execution.ts:ExecutionPlanSchema.steps": "execution-plan-single-tenant",
  "execution.ts:ExecutionPreconditionSchema.requiredEvidenceSnapshotRefs": "action-target-firm",
  "ids.ts:NonEmptyRoleRefSetSchema": "single-tenant-role-set",
  "ids.ts:RoleRefSetSchema": "single-tenant-role-set",
  "trigger.ts:AmbiguityRefSchema.candidateRefs": "single-tenant-ambiguity",
  "trigger.ts:EvidenceRequestSchema.suppliableBy": "evidence-subject-firm",
  "trigger.ts:ResolutionStateSchema.ambiguous": "element-tenant-constraint",
  "trigger.ts:ResolutionStateSchema.gaps": "element-tenant-constraint",
  "trigger.ts:ResolvableBlockerSchema.resolvingEvidence": "element-tenant-constraint",
} as const;

type SchemaModule = readonly [file: string, exports: Record<string, unknown>];
type SchemaDefinition = {
  readonly type: string;
  readonly [key: string]: unknown;
};
type SchemaEdge = {
  readonly segment: string;
  readonly schema: z.ZodType;
};

const DECISION_CORE_SCHEMA_MODULES: readonly SchemaModule[] = [
  ["actor.ts", actorSchemas],
  ["authority.ts", authoritySchemas],
  ["decision.ts", decisionSchemas],
  ["evidence.ts", evidenceSchemas],
  ["execution.ts", executionSchemas],
  ["ids.ts", idSchemas],
  ["normalization.ts", normalizationSchemas],
  ["serialization.ts", serializationSchemas],
  ["trigger.ts", triggerSchemas],
];

const isSchema = (value: unknown): value is z.ZodType =>
  value instanceof z.ZodType;

const schemaDefinition = (schema: z.ZodType): SchemaDefinition =>
  schema._zod.def as SchemaDefinition;

const TRANSPARENT_SCHEMA_TYPES = new Set([
  "readonly",
  "optional",
  "nullable",
  "default",
  "prefault",
  "catch",
  "nonoptional",
  "success",
]);

const unwrapSchema = (schema: z.ZodType): z.ZodType => {
  let current = schema;
  const seen = new Set<z.ZodType>();
  while (!seen.has(current)) {
    seen.add(current);
    const definition = schemaDefinition(current);
    if (!TRANSPARENT_SCHEMA_TYPES.has(definition.type)) break;
    if (!isSchema(definition.innerType)) break;
    current = definition.innerType;
  }
  return current;
};

const schemaEdges = (schema: z.ZodType): SchemaEdge[] => {
  const definition = schemaDefinition(unwrapSchema(schema));
  const edge = (segment: string, value: unknown): SchemaEdge[] =>
    isSchema(value) ? [{ segment, schema: value }] : [];
  switch (definition.type) {
    case "object":
      return Object.entries(
        definition.shape as Record<string, unknown>,
      ).flatMap(([segment, value]) => edge(segment, value));
    case "array":
      return edge("[]", definition.element);
    case "record":
      return edge("{}", definition.valueType);
    case "tuple":
      return [
        ...(definition.items as unknown[]).flatMap((value, index) =>
          edge(`[${index}]`, value),
        ),
        ...edge("[]", definition.rest),
      ];
    case "set":
      return edge("[]", definition.valueType);
    case "map":
      return [
        ...edge("{}", definition.keyType),
        ...edge("{}", definition.valueType),
      ];
    case "union":
      return (definition.options as unknown[]).flatMap((value) =>
        edge("", value),
      );
    case "intersection":
      return [
        ...edge("", definition.left),
        ...edge("", definition.right),
      ];
    case "lazy":
      return edge("", (definition.getter as () => unknown)());
    case "pipe":
      return [
        ...edge("", definition.in),
        ...edge("", definition.out),
      ];
    default:
      return [];
  }
};

const isScopedReferenceSchema = (schema: z.ZodType): boolean => {
  const definition = schemaDefinition(unwrapSchema(schema));
  if (definition.type !== "object") return false;
  const shape = definition.shape as Record<string, unknown>;
  return (
    Object.keys(shape).length === 2 &&
    isSchema(shape.firmId) &&
    isSchema(shape.id)
  );
};

const schemaContainsScopedReference = (schema: z.ZodType): boolean => {
  const pending = [schema];
  const seen = new Set<z.ZodType>();
  while (pending.length > 0) {
    const current = unwrapSchema(pending.pop()!);
    if (seen.has(current)) continue;
    seen.add(current);
    if (isScopedReferenceSchema(current)) return true;
    pending.push(...schemaEdges(current).map((candidate) => candidate.schema));
  }
  return false;
};

const COLLECTION_SCHEMA_TYPES = new Set([
  "array",
  "record",
  "tuple",
  "set",
  "map",
]);

const discoveredScopedReferenceCollections = (
  modules: readonly SchemaModule[],
): string[] => {
  const pathsByCollection = new Map<z.ZodType, string[]>();
  for (const [file, exports] of modules) {
    for (const [exportName, value] of Object.entries(exports)) {
      if (!exportName.endsWith("Schema") || !isSchema(value)) continue;
      const pending: Array<{ schema: z.ZodType; path: string }> = [{
        schema: value,
        path: `${file}:${exportName}`,
      }];
      const seen = new Set<z.ZodType>();
      while (pending.length > 0) {
        const candidate = pending.pop()!;
        const schema = unwrapSchema(candidate.schema);
        if (seen.has(schema)) continue;
        seen.add(schema);
        const definition = schemaDefinition(schema);
        if (
          COLLECTION_SCHEMA_TYPES.has(definition.type) &&
          schemaContainsScopedReference(schema)
        ) {
          const paths = pathsByCollection.get(schema) ?? [];
          paths.push(candidate.path);
          pathsByCollection.set(schema, paths);
        }
        for (const child of schemaEdges(schema)) {
          pending.push({
            schema: child.schema,
            path:
              child.segment === ""
                ? candidate.path
                : `${candidate.path}.${child.segment}`,
          });
        }
      }
    }
  }
  return [...pathsByCollection.values()]
    .map((paths) =>
      paths.sort(
        (left, right) =>
          left.length - right.length || left.localeCompare(right),
      )[0]!,
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
    expect(
      readdirSync(join(REPO_ROOT, "src/contracts/decision-core"))
        .filter((file) => file.endsWith(".ts"))
        .sort(),
    ).toEqual(
      DECISION_CORE_SCHEMA_MODULES.map(([file]) => file).sort(),
    );
    const discovered = discoveredScopedReferenceCollections(
      DECISION_CORE_SCHEMA_MODULES,
    );
    expect(discovered).toContain(
      "trigger.ts:AmbiguityRefSchema.candidateRefs",
    );
    expect(discovered).toContain(
      "decision.ts:RecommendationSchema.parameters",
    );
    expect(discovered).toEqual(
      Object.keys(SCOPED_REFERENCE_COLLECTION_CONSTRAINTS).sort(),
    );
  });

  it.each([
    [
      "alias",
      (reference: z.ZodType) => z.array(reference),
    ],
    [
      "wrapper",
      (reference: z.ZodType) => reference.readonly().array(),
    ],
    [
      "composite",
      (reference: z.ZodType) =>
        z.array(z.strictObject({ reference })),
    ],
    [
      "record",
      (reference: z.ZodType) =>
        z.record(z.string(), z.union([z.string(), reference])),
    ],
    [
      "wrapper factory",
      (reference: z.ZodType) => {
        const wrap = (schema: z.ZodType) =>
          z.tuple([z.string(), schema]).readonly();
        return wrap(reference);
      },
    ],
  ] as const)(
    "discovers a scoped-reference collection through a %s",
    (_name, buildCollection) => {
      const reference = z
        .strictObject({ firmId: z.string(), id: z.string() })
        .readonly();
      expect(
        discoveredScopedReferenceCollections([
          ["probe.ts", { AddedSchema: buildCollection(reference) }],
        ]),
      ).toEqual([
        "probe.ts:AddedSchema",
      ]);
    },
  );

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
