import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import * as actorSchemas from "@contracts/decision-core/actor";
import * as authoritySchemas from "@contracts/decision-core/authority";
import * as decisionSchemas from "@contracts/decision-core/decision";
import * as evidenceSchemas from "@contracts/decision-core/evidence";
import * as executionSchemas from "@contracts/decision-core/execution";
import * as explanationSchemas from "@contracts/decision-core/explanation";
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
  ["explanation.ts", explanationSchemas],
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

const LEAF_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "int",
  "bigint",
  "boolean",
  "date",
  "symbol",
  "undefined",
  "null",
  "any",
  "unknown",
  "never",
  "void",
  "literal",
  "enum",
  "custom",
  "transform",
  "nan",
  "file",
]);

const unsupportedSchemaType = (definition: SchemaDefinition): never => {
  throw new Error(`unsupported Zod schema type: ${definition.type}`);
};

const unwrapSchema = (schema: z.ZodType): z.ZodType => {
  let current = schema;
  const seen = new Set<z.ZodType>();
  while (!seen.has(current)) {
    seen.add(current);
    const definition = schemaDefinition(current);
    if (!TRANSPARENT_SCHEMA_TYPES.has(definition.type)) break;
    const inner = definition.innerType;
    if (isSchema(inner)) {
      current = inner;
    } else {
      unsupportedSchemaType(definition);
    }
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
      return [
        ...edge("{key}", definition.keyType),
        ...edge("{}", definition.valueType),
      ];
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
    case "promise":
      return edge("", definition.innerType);
    case "function":
      return [
        ...edge("input", definition.input),
        ...edge("output", definition.output),
      ];
    case "template_literal":
      return (definition.parts as unknown[]).flatMap((value, index) =>
        edge(`[${index}]`, value),
      );
    default:
      return LEAF_SCHEMA_TYPES.has(definition.type)
        ? []
        : unsupportedSchemaType(definition);
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

const schemaContainsScopedReferenceCollection = (
  schema: z.ZodType,
): boolean => {
  const pending = [schema];
  const seen = new Set<z.ZodType>();
  while (pending.length > 0) {
    const current = unwrapSchema(pending.pop()!);
    if (seen.has(current)) continue;
    seen.add(current);
    if (
      COLLECTION_SCHEMA_TYPES.has(schemaDefinition(current).type) &&
      schemaContainsScopedReference(current)
    ) {
      return true;
    }
    pending.push(...schemaEdges(current).map((edge) => edge.schema));
  }
  return false;
};

const OPAQUE_SCHEMA_TYPES = new Set([
  "any",
  "unknown",
  "custom",
  "transform",
]);

type OpaqueSchemaEntry = {
  readonly path: string;
  readonly node: z.ZodType;
};

/** Every opaque node under `schema`, each keyed by its shape path from `rootPath`. */
const opaqueSchemaNodeEntries = (
  schema: z.ZodType,
  rootPath: string,
): OpaqueSchemaEntry[] => {
  const entries: OpaqueSchemaEntry[] = [];
  const pending: Array<{ schema: z.ZodType; path: string }> = [
    { schema, path: rootPath },
  ];
  const seen = new Set<z.ZodType>();
  while (pending.length > 0) {
    const next = pending.pop()!;
    const current = unwrapSchema(next.schema);
    if (seen.has(current)) continue;
    seen.add(current);
    if (OPAQUE_SCHEMA_TYPES.has(schemaDefinition(current).type)) {
      entries.push({ path: next.path, node: current });
    }
    pending.push(
      ...schemaEdges(current).map((edge) => ({
        schema: edge.schema,
        path: edge.segment === "" ? next.path : `${next.path}.${edge.segment}`,
      })),
    );
  }
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
};

const opaqueSchemaNodes = (schema: z.ZodType): ReadonlySet<z.ZodType> =>
  new Set(opaqueSchemaNodeEntries(schema, "").map((entry) => entry.node));

/*
 * These exact internal nodes have behavior that JSON Schema cannot express:
 * TokenizedPayload deep-freezes already-validated JSON and DecisionInputBundle
 * canonicalizes a time-zone spelling before its enum check. ExplanationNode is
 * seeded too because its iterative z.unknown recursion is the next candidate,
 * though it contributes no opaque node today.
 *
 * The seed GRAPHS are shared (DecisionInputBundle reaches TenantContext's leaves),
 * so traversing them would silently bless any opaque node later added anywhere
 * inside them. The resolved inventory is therefore PINNED by path below: a new
 * opaque node - inside a seed graph or outside it - fails the pin instead of
 * joining the allowlist.
 */
const ALLOWED_OPAQUE_SCHEMA_NODE_PATHS = [
  "DecisionInputBundleSchema.timeZone",
  "TokenizedPayloadSchema.value.{}",
] as const;

const ALLOWED_OPAQUE_SCHEMA_ENTRIES: readonly OpaqueSchemaEntry[] = [
  ...opaqueSchemaNodeEntries(
    actorSchemas.TokenizedPayloadSchema,
    "TokenizedPayloadSchema",
  ),
  ...opaqueSchemaNodeEntries(
    explanationSchemas.ExplanationNodeSchema,
    "ExplanationNodeSchema",
  ),
  ...opaqueSchemaNodeEntries(
    evidenceSchemas.DecisionInputBundleSchema,
    "DecisionInputBundleSchema",
  ),
];

const ALLOWED_OPAQUE_SCHEMA_NODES = new Set<z.ZodType>(
  ALLOWED_OPAQUE_SCHEMA_ENTRIES.map((entry) => entry.node),
);

const unsafeOpaqueSchemaBoundaries = (
  modules: readonly SchemaModule[],
  allowed: ReadonlySet<z.ZodType>,
): string[] => {
  const unsafe: string[] = [];
  for (const [file, exports] of modules) {
    for (const [exportName, value] of Object.entries(exports)) {
      if (
        isSchema(value) &&
        [...opaqueSchemaNodes(value)].some((node) => !allowed.has(node))
      ) {
        unsafe.push(`${file}:${exportName}`);
      }
    }
  }
  return unsafe.sort();
};

const discoveredScopedReferenceBoundaries = (
  modules: readonly SchemaModule[],
): Map<string, z.ZodType> => {
  const boundaries = new Map<string, z.ZodType>();
  for (const [file, exports] of modules) {
    for (const [exportName, value] of Object.entries(exports)) {
      if (
        isSchema(value) &&
        schemaContainsScopedReferenceCollection(value)
      ) {
        boundaries.set(`${file}:${exportName}`, value);
      }
    }
  }
  return boundaries;
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

const proceedBoundary = decisionFixture("decision-record-proceed");
const proceedResult = proceedBoundary.result;
const executionStep = proceedResult.executionPlan!.steps[0]!;
const approvalStage = proceedResult.authority!.stages![0]!;
const approvalRequirement = {
  ...approvalStage.requirements[0]!,
  eligibleRoleIds: [
    { firmId: "firm-a", id: "operations" },
    { firmId: "firm-a", id: "advisor" },
  ],
};
const escalationStep = {
  ...approvalStage.escalationPath[0]!,
  roleIds: [
    { firmId: "firm-a", id: "operations-manager" },
    { firmId: "firm-a", id: "compliance-manager" },
  ],
};
const probedApprovalStage = {
  stageId: "stage:probe",
  order: 0,
  executionMode: "parallel",
  requirements: [approvalRequirement],
  escalationPath: [escalationStep],
  templateRef: { firmId: "firm-a", id: "template:probe" },
  expiresAt: "2026-07-29T13:30:00.000Z",
};
const approvalStageTemplate = {
  stageId: probedApprovalStage.stageId,
  order: probedApprovalStage.order,
  executionMode: probedApprovalStage.executionMode,
  requirements: probedApprovalStage.requirements,
  escalationPath: probedApprovalStage.escalationPath,
  expiresAfter: "P1D",
};
const approvalTemplate = {
  firmId: "firm-a",
  id: "template:probe",
  stages: [approvalStageTemplate],
};
const authorityRequirement = {
  mode: "approval",
  stages: [probedApprovalStage],
};
const actorRef = {
  firmId: "firm-a",
  actorId: "actor:probe",
  roleIds: [
    { firmId: "firm-a", id: "advisor" },
    { firmId: "firm-a", id: "operations" },
  ],
};
const explanationNode = {
  ...proceedBoundary.explanationTrace[0]!,
  evidenceSnapshotRefs: [
    { firmId: "firm-a", id: "evidence:one" },
    { firmId: "firm-a", id: "evidence:two" },
  ],
  childNodes: [],
};
const recommendation = {
  ...proceedResult.recommendation!,
  parameters: {
    firstSubject: { firmId: "firm-a", id: "subject:one" },
    secondSubject: { firmId: "firm-a", id: "subject:two" },
  },
};
const probedProceedResult = {
  ...proceedResult,
  recommendation,
  authority: authorityRequirement,
};
const externalAction = {
  targetRef: executionStep.targetRef,
  command: executionStep.command,
  idempotencyKey: executionStep.idempotencyKey,
  conflictKeys: executionStep.conflictKeys,
  reservationRefs: executionStep.reservationRefs,
  preconditions: executionStep.preconditions,
  verificationRuleRef: executionStep.verificationRuleRef,
};
const compensatingAction = {
  ...externalAction,
  idempotencyKey: "idem:compensation:probe",
  reasonCode: "later-step-failed",
};
const executionPrecondition = {
  ...executionStep.preconditions[0]!,
  requiredEvidenceSnapshotRefs: [
    { firmId: "firm-a", id: "evidence:one" },
    { firmId: "firm-a", id: "evidence:two" },
  ],
};
const roleRefSet = [
  { firmId: "firm-a", id: "advisor" },
  { firmId: "firm-a", id: "operations" },
];
const ambiguityRef = {
  slotName: "household",
  candidateRefs: [
    { firmId: "firm-a", id: "subject:one" },
    { firmId: "firm-a", id: "subject:two" },
  ],
  humanQuestionCode: "choose-household",
};
const evidenceRequest = {
  evidenceKind: "account-balance",
  subjectRef: { firmId: "firm-a", id: "subject:one" },
  suppliableBy: [
    { firmId: "firm-a", id: "advisor" },
    { firmId: "firm-a", id: "operations" },
  ],
};
const resolvableBlocker = {
  code: "missing-balance",
  explanation: "Balance evidence is required.",
  resolvingEvidence: [evidenceRequest],
};
const resolutionState = {
  bound: [],
  ambiguous: [ambiguityRef],
  gaps: [evidenceRequest],
};
const trigger = {
  kind: "human_request",
  requester: actorRef,
  requestRef: { firmId: "firm-a", id: "request:probe" },
  maskedRequest: { value: "tokenized request", piiFree: true },
};
const intent = {
  firmId: "firm-a",
  id: "intent:probe",
  trigger,
  domainConfigVersionRef: {
    firmId: "firm-a",
    id: "domain-config:probe",
  },
  action: "primitive:probe",
  slots: {},
  createdAt: "2026-07-26T13:30:00.000Z",
};

const SCOPED_REFERENCE_BOUNDARY_PROBES: Readonly<
  Record<string, unknown>
> = {
  "actor.ts:ActorRefSchema": actorRef,
  "actor.ts:AnyActorRefSchema": actorRef,
  "authority.ts:ApprovalRequirementSchema": approvalRequirement,
  "authority.ts:ApprovalStageSchema": probedApprovalStage,
  "authority.ts:ApprovalStageTemplateSchema": approvalStageTemplate,
  "authority.ts:ApprovalTemplateSchema": approvalTemplate,
  "authority.ts:AuthorityRequirementSchema": authorityRequirement,
  "authority.ts:EscalationStepSchema": escalationStep,
  "decision.ts:BlockedDecisionSchema": {
    kind: "blocked",
    blockers: [resolvableBlocker],
  },
  "decision.ts:DecisionRecordSchema": proceedBoundary,
  "decision.ts:DecisionResultSchema": probedProceedResult,
  "decision.ts:ExplanationNodeSchema": explanationNode,
  "decision.ts:ProceedDecisionSchema": probedProceedResult,
  "decision.ts:RecommendationSchema": recommendation,
  "evidence.ts:DecisionInputBundleSchema":
    fixture("decision-input-bundle"),
  "execution.ts:CompensatingActionSchema": compensatingAction,
  "execution.ts:ExecutionPlanSchema": proceedResult.executionPlan,
  "execution.ts:ExecutionPreconditionSchema": executionPrecondition,
  "execution.ts:ExecutionStepSchema": executionStep,
  "execution.ts:RetrySafeExternalActionSchema": externalAction,
  "explanation.ts:ExplanationNodeSchema": explanationNode,
  "ids.ts:NonEmptyRoleRefSetSchema": roleRefSet,
  "ids.ts:RoleRefSetSchema": roleRefSet,
  "trigger.ts:AmbiguityRefSchema": ambiguityRef,
  "trigger.ts:EvidenceRequestSchema": evidenceRequest,
  "trigger.ts:IntentSchema": intent,
  "trigger.ts:ResolutionStateSchema": resolutionState,
  "trigger.ts:ResolvableBlockerSchema": resolvableBlocker,
  "trigger.ts:TriggerSchema": trigger,
};

const mixedTenantProbe = (legal: unknown): unknown => {
  const mixed = structuredClone(legal);
  const scopedReferences: Array<Record<string, unknown>> = [];
  const pending = [mixed];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    if (
      !Array.isArray(value) &&
      Object.hasOwn(value, "firmId") &&
      Object.hasOwn(value, "id") &&
      typeof (value as Record<string, unknown>).firmId === "string" &&
      typeof (value as Record<string, unknown>).id === "string"
    ) {
      scopedReferences.push(value as Record<string, unknown>);
    }
    pending.push(...Object.values(value));
  }
  if (scopedReferences.length < 2) {
    throw new Error("tenant boundary probes require at least two scoped references");
  }
  const selected = scopedReferences.at(-1)!;
  selected.firmId = selected.firmId === "firm-b" ? "firm-a" : "firm-b";
  return mixed;
};

const tenantBoundaryAudit = (
  modules: readonly SchemaModule[],
  probes: Readonly<Record<string, unknown>>,
  allowedOpaqueNodes: ReadonlySet<z.ZodType> =
    ALLOWED_OPAQUE_SCHEMA_NODES,
): {
  readonly missing: string[];
  readonly stale: string[];
  readonly failed: string[];
  readonly unsafe: string[];
} => {
  const boundaries = discoveredScopedReferenceBoundaries(modules);
  const boundaryNames = [...boundaries.keys()].sort();
  const probeNames = Object.keys(probes).sort();
  const missing = boundaryNames.filter((name) => !(name in probes));
  const stale = probeNames.filter((name) => !boundaries.has(name));
  const failed = probeNames.filter((name) => {
    const schema = boundaries.get(name);
    if (schema === undefined) return false;
    const legal = probes[name];
    return (
      !schema.safeParse(legal).success ||
      schema.safeParse(mixedTenantProbe(legal)).success
    );
  });
  const unsafe = unsafeOpaqueSchemaBoundaries(
    modules,
    allowedOpaqueNodes,
  );
  return { missing, stale, failed, unsafe };
};

describe("decision-core tenant-scope fence", () => {
  it("keeps every exported scoped-reference boundary behaviorally verified", () => {
    expect(
      readdirSync(join(REPO_ROOT, "src/contracts/decision-core"))
        .filter((file) => file.endsWith(".ts"))
        .sort(),
    ).toEqual(
      DECISION_CORE_SCHEMA_MODULES.map(([file]) => file).sort(),
    );
    expect(tenantBoundaryAudit(
      DECISION_CORE_SCHEMA_MODULES,
      SCOPED_REFERENCE_BOUNDARY_PROBES,
    )).toEqual({ missing: [], stale: [], failed: [], unsafe: [] });
  });

  it("detects an exported boundary without a Schema suffix", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    const Added = z.array(reference);
    expect(tenantBoundaryAudit(
      [["probe.ts", { Added }]],
      {},
    ).missing).toEqual(["probe.ts:Added"]);
  });

  it("fails closed on an exported type-changing opaque tenant schema", () => {
    const OpaqueOwner = z
      .any()
      .transform((value): ScopedRef => value as ScopedRef);
    const audit = tenantBoundaryAudit(
      [["probe.ts", { OpaqueOwner }]],
      {},
    );
    expect(audit.missing).toEqual([]);
    expect(audit.unsafe).toEqual(["probe.ts:OpaqueOwner"]);
  });

  it.each([
    ["promise", z.promise(z.any())],
    [
      "function",
      z.function({ input: [z.string()], output: z.unknown() }),
    ],
  ])("finds opaque nodes inside a %s schema", (_name, WrappedOpaque) => {
    expect(tenantBoundaryAudit(
      [["probe.ts", { WrappedOpaque }]],
      {},
    ).unsafe).toEqual(["probe.ts:WrappedOpaque"]);
  });

  it("accepts a recognized child-bearing schema with transparent children", () => {
    expect(tenantBoundaryAudit(
      [["probe.ts", { SafePromise: z.promise(z.string()) }]],
      {},
    ).unsafe).toEqual([]);
  });

  it("fails closed on an unknown child-bearing schema node", () => {
    const FutureWrapper = z.any();
    Object.assign(FutureWrapper._zod.def, {
      type: "future-wrapper",
      innerType: z.any(),
    });
    expect(() => tenantBoundaryAudit(
      [["probe.ts", { FutureWrapper }]],
      {},
    )).toThrow(/unsupported Zod schema type/);
  });

  it("pins the exact opaque nodes the allowlist blesses", () => {
    expect(
      ALLOWED_OPAQUE_SCHEMA_ENTRIES.map((entry) => entry.path).sort(),
    ).toEqual([...ALLOWED_OPAQUE_SCHEMA_NODE_PATHS]);
    expect(ALLOWED_OPAQUE_SCHEMA_NODES.size).toBe(
      ALLOWED_OPAQUE_SCHEMA_NODE_PATHS.length,
    );
  });

  it("detects an opaque node newly grown inside an already-blessed graph", () => {
    const Grown = z.strictObject({
      value: z.record(z.string().min(1), z.json().transform(Object.freeze)),
      added: z.any(),
    });
    const grownPaths = opaqueSchemaNodeEntries(
      Grown,
      "TokenizedPayloadSchema",
    ).map((entry) => entry.path);
    expect(grownPaths).toContain("TokenizedPayloadSchema.added");
    expect(grownPaths).not.toEqual([...ALLOWED_OPAQUE_SCHEMA_NODE_PATHS]);
  });

  it("requires an exact node allowlist for intentional opaque behavior", () => {
    const FrozenPayload = z.strictObject({
      value: z.json().transform(Object.freeze),
    });
    const modules: readonly SchemaModule[] = [[
      "probe.ts",
      { FrozenPayload },
    ]];
    expect(tenantBoundaryAudit(
      modules,
      {},
      new Set(),
    ).unsafe).toEqual(["probe.ts:FrozenPayload"]);
    expect(tenantBoundaryAudit(
      modules,
      {},
      opaqueSchemaNodes(FrozenPayload),
    ).unsafe).toEqual([]);
  });

  it("does not confuse a type-preserving overwrite with an opaque transform", () => {
    const CanonicalOwner = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    }).overwrite((value) => value);
    expect(tenantBoundaryAudit(
      [["probe.ts", { CanonicalOwner }]],
      {},
    ).unsafe).toEqual([]);
  });

  it("detects an unconstrained wrapper that reuses a registered collection", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    const RegisteredSchema = z
      .array(reference)
      .refine((refs) =>
        refs.every((ref) => ref.firmId === refs[0]?.firmId),
      );
    const UnconstrainedWrapper = z.strictObject({
      refs: RegisteredSchema,
      ownerRef: reference,
    });
    const legal = [
      { firmId: "firm-a", id: "one" },
      { firmId: "firm-a", id: "two" },
    ];
    const audit = tenantBoundaryAudit(
      [["probe.ts", { RegisteredSchema, UnconstrainedWrapper }]],
      { "probe.ts:RegisteredSchema": legal },
    );
    expect(audit.missing).toEqual(["probe.ts:UnconstrainedWrapper"]);
  });

  it("executes each probe instead of trusting its registry label", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    const UnconstrainedWrapper = z.strictObject({
      refs: z.array(reference),
    });
    const legal = {
      refs: [
        { firmId: "firm-a", id: "one" },
        { firmId: "firm-a", id: "two" },
      ],
    };
    expect(tenantBoundaryAudit(
      [["probe.ts", { UnconstrainedWrapper }]],
      { "probe.ts:UnconstrainedWrapper": legal },
    ).failed).toEqual(["probe.ts:UnconstrainedWrapper"]);
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
