import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
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
import {
  isShippedSourceFilePath,
  REPO_ROOT,
  walk,
} from "./_fence-utils";

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

const moduleInventoryMismatch = (
  discovered: readonly string[],
  registered: readonly string[],
): string[] => {
  const discoveredSet = new Set(discovered);
  const registeredSet = new Set(registered);
  return [
    ...discovered.filter((file) => !registeredSet.has(file)),
    ...registered.filter((file) => !discoveredSet.has(file)),
  ].sort();
};

const isSchema = (value: unknown): value is z.ZodType =>
  value instanceof z.ZodType;

const schemaAccepts = (schema: z.ZodType, value: unknown): boolean => {
  try {
    return schema.safeParse(value).success;
  } catch {
    return false;
  }
};

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

const unsupportedSchemaStructure = (
  definition: SchemaDefinition,
  detail: string,
): never => {
  throw new Error(
    `unsupported Zod schema structure for ${definition.type}: ${detail}`,
  );
};

const schemaPathsIn = (
  value: unknown,
  rootPath = "",
): string[] => {
  const paths: string[] = [];
  const pending: Array<{ path: string; value: unknown }> = [
    { path: rootPath, value },
  ];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (isSchema(next.value)) {
      paths.push(next.path);
      continue;
    }
    if (next.value === null || typeof next.value !== "object") continue;
    if (seen.has(next.value)) continue;
    seen.add(next.value);
    for (const [key, child] of Object.entries(next.value)) {
      pending.push({
        path: next.path === "" ? key : `${next.path}.${key}`,
        value: child,
      });
    }
  }
  return paths;
};

const assertKnownSchemaChildren = (
  definition: SchemaDefinition,
  knownPaths: ReadonlySet<string>,
): void => {
  const unknownPaths = schemaPathsIn(definition).filter(
    (path) => !knownPaths.has(path),
  );
  if (unknownPaths.length > 0) {
    unsupportedSchemaStructure(
      definition,
      `unrecognized schema children at ${unknownPaths.sort().join(", ")}`,
    );
  }
};

const unwrapSchema = (schema: z.ZodType): z.ZodType => {
  let current = schema;
  const seen = new Set<z.ZodType>();
  while (!seen.has(current)) {
    seen.add(current);
    const definition = schemaDefinition(current);
    if (!TRANSPARENT_SCHEMA_TYPES.has(definition.type)) break;
    const inner = definition.innerType;
    if (!isSchema(inner)) {
      unsupportedSchemaStructure(definition, "innerType is not a schema");
    } else {
      assertKnownSchemaChildren(definition, new Set(["innerType"]));
      current = inner;
    }
  }
  return current;
};

const schemaEdges = (schema: z.ZodType): SchemaEdge[] => {
  const definition = schemaDefinition(unwrapSchema(schema));
  const knownPaths = new Set<string>();
  const edge = (
    path: string,
    segment: string,
    value: unknown,
  ): SchemaEdge => {
    if (isSchema(value)) {
      knownPaths.add(path);
      return { segment, schema: value };
    }
    return unsupportedSchemaStructure(definition, `${path} is not a schema`);
  };
  const optionalEdge = (
    path: string,
    segment: string,
    value: unknown,
  ): SchemaEdge[] =>
    value === null || value === undefined
      ? []
      : [edge(path, segment, value)];
  const array = (path: string, value: unknown): unknown[] => {
    return Array.isArray(value)
      ? value
      : unsupportedSchemaStructure(definition, `${path} is not an array`);
  };
  const checkEdges: SchemaEdge[] = [];
  if (definition.checks !== undefined) {
    for (const [index, check] of array("checks", definition.checks).entries()) {
      const traits =
        check !== null &&
        typeof check === "object" &&
        "_zod" in check &&
        typeof check._zod === "object" &&
        check._zod !== null &&
        "traits" in check._zod &&
        check._zod.traits instanceof Set
          ? check._zod.traits
          : undefined;
      if (traits?.has("$ZodCheck") !== true) {
        unsupportedSchemaStructure(
          definition,
          `checks.${index} is not a Zod check`,
        );
      }
      if (isSchema(check)) {
        checkEdges.push(
          edge(`checks.${index}`, `check[${index}]`, check),
        );
      }
    }
  }
  let edges: SchemaEdge[];
  switch (definition.type) {
    case "object":
      if (
        definition.shape === null ||
        typeof definition.shape !== "object" ||
        Array.isArray(definition.shape) ||
        isSchema(definition.shape)
      ) {
        unsupportedSchemaStructure(definition, "shape is not an object");
      }
      edges = Object.entries(
        definition.shape as Record<string, unknown>,
      ).map(([segment, value]) =>
        edge(`shape.${segment}`, segment, value),
      );
      edges.push(...optionalEdge("catchall", "{*}", definition.catchall));
      break;
    case "array":
      edges = [edge("element", "[]", definition.element)];
      break;
    case "record":
      edges = [
        edge("keyType", "{key}", definition.keyType),
        edge("valueType", "{}", definition.valueType),
      ];
      break;
    case "tuple":
      edges = [
        ...array("items", definition.items).map((value, index) =>
          edge(`items.${index}`, `[${index}]`, value),
        ),
        ...optionalEdge("rest", "[]", definition.rest),
      ];
      break;
    case "set":
      edges = [edge("valueType", "[]", definition.valueType)];
      break;
    case "map":
      edges = [
        edge("keyType", "{}", definition.keyType),
        edge("valueType", "{}", definition.valueType),
      ];
      break;
    case "union":
      edges = array("options", definition.options).map((value, index) =>
        edge(`options.${index}`, "", value),
      );
      break;
    case "intersection":
      edges = [
        edge("left", "", definition.left),
        edge("right", "", definition.right),
      ];
      break;
    case "lazy":
      if (typeof definition.getter !== "function") {
        unsupportedSchemaStructure(definition, "getter is not a function");
      }
      {
        const resolved = (definition.getter as () => unknown)();
        if (definition._cachedInner !== undefined) {
          knownPaths.add("_cachedInner");
          if (!isSchema(definition._cachedInner)) {
            unsupportedSchemaStructure(
              definition,
              "_cachedInner is not a schema",
            );
          }
        }
        edges = [edge("", "", resolved)];
      }
      break;
    case "pipe":
      edges = [
        edge("in", "", definition.in),
        edge("out", "", definition.out),
      ];
      break;
    case "promise":
      edges = [edge("innerType", "", definition.innerType)];
      break;
    case "function":
      edges = [
        edge("input", "input", definition.input),
        edge("output", "output", definition.output),
      ];
      break;
    case "template_literal":
      edges = array("parts", definition.parts).flatMap((value, index) => {
        if (typeof value === "string") return [];
        return [edge(`parts.${index}`, `[${index}]`, value)];
      });
      break;
    default:
      if (!LEAF_SCHEMA_TYPES.has(definition.type)) {
        unsupportedSchemaType(definition);
      }
      edges = [];
  }
  edges.push(...checkEdges);
  assertKnownSchemaChildren(definition, knownPaths);
  return edges;
};

const isScopedReferenceSchema = (schema: z.ZodType): boolean => {
  const definition = schemaDefinition(unwrapSchema(schema));
  if (definition.type !== "object") return false;
  const shape = definition.shape as Record<string, unknown>;
  return (
    isSchema(shape.firmId) &&
    isSchema(shape.id)
  );
};

const isTenantAnchorSchema = (schema: z.ZodType): boolean => {
  const definition = schemaDefinition(unwrapSchema(schema));
  if (definition.type !== "object") return false;
  const shape = definition.shape as Record<string, unknown>;
  return isSchema(shape.firmId) && !isSchema(shape.id);
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
    const definition = schemaDefinition(current);
    const catchallContainsScopedReference =
      definition.type === "object" &&
      isSchema(definition.catchall) &&
      schemaContainsScopedReference(definition.catchall);
    if (
      (COLLECTION_SCHEMA_TYPES.has(definition.type) &&
        schemaContainsScopedReference(current)) ||
      catchallContainsScopedReference
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
  const pendingAncestors: Array<ReadonlySet<z.ZodType>> = [new Set()];
  while (pending.length > 0) {
    const next = pending.pop()!;
    const ancestors = pendingAncestors.pop()!;
    const current = unwrapSchema(next.schema);
    if (ancestors.has(current)) continue;
    if (OPAQUE_SCHEMA_TYPES.has(schemaDefinition(current).type)) {
      entries.push({ path: next.path, node: current });
    }
    const nextAncestors = new Set(ancestors).add(current);
    const children = schemaEdges(current).map((edge) => ({
        schema: edge.schema,
        path: edge.segment === "" ? next.path : `${next.path}.${edge.segment}`,
      }));
    pending.push(...children);
    pendingAncestors.push(
      ...children.map(() => nextAncestors),
    );
  }
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
};

const ALLOWED_OPAQUE_SCHEMA_NODE_PATHS = [
  "actor.ts:ActorRefSchema.check[0]",
  "actor.ts:ActorRefSchema.roleIds.check[1]",
  "actor.ts:ActorRefSchema.roleIds.check[2]",
  "actor.ts:TokenizedPayloadSchema.value.{}",
  "authority.ts:EscalationStepSchema.after.check[0]",
  "authority.ts:EscalationStepSchema.roleIds.check[1]",
  "authority.ts:EscalationStepSchema.roleIds.check[2]",
  "decision.ts:BlockedDecisionSchema.blockers.[].resolvingEvidence.[].check[0]",
  "decision.ts:BlockedDecisionSchema.blockers.[].resolvingEvidence.[].suppliableBy.check[1]",
  "decision.ts:DecisionRecordSchema.check[0]",
  "decision.ts:DecisionRecordSchema.check[1]",
  "decision.ts:DecisionRecordSchema.check[2]",
  "decision.ts:DecisionRecordSchema.check[4]",
  "decision.ts:DecisionRecordSchema.check[5]",
  "decision.ts:ExplanationNodeSchema.evidenceSnapshotRefs.check[0]",
  "decision.ts:ExplanationNodeSchema.sourceRefs.[].check[0]",
  "decision.ts:ExplanationNodeSchema.sourceRefs.check[0]",
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.conflictKeys.check[1]",
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.check[1]",
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.reservationRefs.check[0]",
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].dependsOn.check[0]",
  "decision.ts:PrecedenceStepSchema.check[0]",
  "decision.ts:ProhibitionSchema.check[0]",
  "decision.ts:RevaluationConditionSchema.check[0]",
  "evidence.ts:DecisionInputBundleSchema.evidenceSnapshotRefs.check[0]",
  "evidence.ts:DecisionInputBundleSchema.householdInstructionVersionRefs.check[0]",
  "evidence.ts:DecisionInputBundleSchema.timeZone",
  "trigger.ts:AmbiguityRefSchema.candidateRefs.check[1]",
  "trigger.ts:AmbiguityRefSchema.candidateRefs.check[2]",
] as const;

const ALLOWED_OPAQUE_SCHEMA_OCCURRENCES: Readonly<
  Record<(typeof ALLOWED_OPAQUE_SCHEMA_NODE_PATHS)[number], readonly string[]>
> = {
  "actor.ts:ActorRefSchema.check[0]": [
    "actor.ts:ActorRefSchema.check[0]",
    "actor.ts:AnyActorRefSchema.check[0]",
    "decision.ts:DecisionRecordSchema.createdBy.check[0]",
    "trigger.ts:IntentSchema.trigger.requester.check[0]",
    "trigger.ts:TriggerSchema.requester.check[0]",
  ],
  "actor.ts:ActorRefSchema.roleIds.check[1]": [
    "actor.ts:ActorRefSchema.roleIds.check[1]",
    "actor.ts:AnyActorRefSchema.roleIds.check[1]",
    "decision.ts:DecisionRecordSchema.createdBy.roleIds.check[1]",
    "ids.ts:RoleRefSetSchema.check[1]",
    "trigger.ts:IntentSchema.trigger.requester.roleIds.check[1]",
    "trigger.ts:TriggerSchema.requester.roleIds.check[1]",
  ],
  "actor.ts:ActorRefSchema.roleIds.check[2]": [
    "actor.ts:ActorRefSchema.roleIds.check[2]",
    "actor.ts:AnyActorRefSchema.roleIds.check[2]",
    "decision.ts:DecisionRecordSchema.createdBy.roleIds.check[2]",
    "ids.ts:RoleRefSetSchema.check[2]",
    "trigger.ts:IntentSchema.trigger.requester.roleIds.check[2]",
    "trigger.ts:TriggerSchema.requester.roleIds.check[2]",
  ],
  "actor.ts:TokenizedPayloadSchema.value.{}": [
    "actor.ts:TokenizedPayloadSchema.value.{}",
    "trigger.ts:IntentSchema.trigger.tokenizedPayload.value.{}",
    "trigger.ts:TriggerSchema.tokenizedPayload.value.{}",
  ],
  "authority.ts:EscalationStepSchema.after.check[0]": [
    "authority.ts:ApprovalStageSchema.escalationPath.[].after.check[0]",
    "authority.ts:ApprovalStageTemplateSchema.escalationPath.[].after.check[0]",
    "authority.ts:ApprovalStageTemplateSchema.expiresAfter.check[0]",
    "authority.ts:ApprovalTemplateSchema.stages.[].escalationPath.[].after.check[0]",
    "authority.ts:ApprovalTemplateSchema.stages.[].expiresAfter.check[0]",
    "authority.ts:AuthorityRequirementSchema.stages.[].escalationPath.[].after.check[0]",
    "authority.ts:EscalationStepSchema.after.check[0]",
    "decision.ts:DecisionRecordSchema.result.authority.stages.[].escalationPath.[].after.check[0]",
    "decision.ts:DecisionResultSchema.authority.stages.[].escalationPath.[].after.check[0]",
    "decision.ts:ProceedDecisionSchema.authority.stages.[].escalationPath.[].after.check[0]",
  ],
  "authority.ts:EscalationStepSchema.roleIds.check[1]": [
    "authority.ts:ApprovalRequirementSchema.eligibleRoleIds.check[1]",
    "authority.ts:ApprovalStageSchema.escalationPath.[].roleIds.check[1]",
    "authority.ts:ApprovalStageSchema.requirements.[].eligibleRoleIds.check[1]",
    "authority.ts:ApprovalStageTemplateSchema.escalationPath.[].roleIds.check[1]",
    "authority.ts:ApprovalStageTemplateSchema.requirements.[].eligibleRoleIds.check[1]",
    "authority.ts:ApprovalTemplateSchema.stages.[].escalationPath.[].roleIds.check[1]",
    "authority.ts:ApprovalTemplateSchema.stages.[].requirements.[].eligibleRoleIds.check[1]",
    "authority.ts:AuthorityRequirementSchema.stages.[].escalationPath.[].roleIds.check[1]",
    "authority.ts:AuthorityRequirementSchema.specialistRoleIds.check[1]",
    "authority.ts:AuthorityRequirementSchema.stages.[].requirements.[].eligibleRoleIds.check[1]",
    "authority.ts:EscalationStepSchema.roleIds.check[1]",
    "decision.ts:DecisionRecordSchema.result.authority.specialistRoleIds.check[1]",
    "decision.ts:DecisionRecordSchema.result.authority.stages.[].escalationPath.[].roleIds.check[1]",
    "decision.ts:DecisionRecordSchema.result.authority.stages.[].requirements.[].eligibleRoleIds.check[1]",
    "decision.ts:DecisionResultSchema.authority.specialistRoleIds.check[1]",
    "decision.ts:DecisionResultSchema.authority.stages.[].escalationPath.[].roleIds.check[1]",
    "decision.ts:DecisionResultSchema.authority.stages.[].requirements.[].eligibleRoleIds.check[1]",
    "decision.ts:ProceedDecisionSchema.authority.specialistRoleIds.check[1]",
    "decision.ts:ProceedDecisionSchema.authority.stages.[].escalationPath.[].roleIds.check[1]",
    "decision.ts:ProceedDecisionSchema.authority.stages.[].requirements.[].eligibleRoleIds.check[1]",
    "ids.ts:NonEmptyRoleRefSetSchema.check[1]",
  ],
  "authority.ts:EscalationStepSchema.roleIds.check[2]": [
    "authority.ts:ApprovalRequirementSchema.eligibleRoleIds.check[2]",
    "authority.ts:ApprovalStageSchema.escalationPath.[].roleIds.check[2]",
    "authority.ts:ApprovalStageSchema.requirements.[].eligibleRoleIds.check[2]",
    "authority.ts:ApprovalStageTemplateSchema.escalationPath.[].roleIds.check[2]",
    "authority.ts:ApprovalStageTemplateSchema.requirements.[].eligibleRoleIds.check[2]",
    "authority.ts:ApprovalTemplateSchema.stages.[].escalationPath.[].roleIds.check[2]",
    "authority.ts:ApprovalTemplateSchema.stages.[].requirements.[].eligibleRoleIds.check[2]",
    "authority.ts:AuthorityRequirementSchema.stages.[].escalationPath.[].roleIds.check[2]",
    "authority.ts:AuthorityRequirementSchema.specialistRoleIds.check[2]",
    "authority.ts:AuthorityRequirementSchema.stages.[].requirements.[].eligibleRoleIds.check[2]",
    "authority.ts:EscalationStepSchema.roleIds.check[2]",
    "decision.ts:DecisionRecordSchema.result.authority.specialistRoleIds.check[2]",
    "decision.ts:DecisionRecordSchema.result.authority.stages.[].escalationPath.[].roleIds.check[2]",
    "decision.ts:DecisionRecordSchema.result.authority.stages.[].requirements.[].eligibleRoleIds.check[2]",
    "decision.ts:DecisionResultSchema.authority.specialistRoleIds.check[2]",
    "decision.ts:DecisionResultSchema.authority.stages.[].escalationPath.[].roleIds.check[2]",
    "decision.ts:DecisionResultSchema.authority.stages.[].requirements.[].eligibleRoleIds.check[2]",
    "decision.ts:ProceedDecisionSchema.authority.specialistRoleIds.check[2]",
    "decision.ts:ProceedDecisionSchema.authority.stages.[].escalationPath.[].roleIds.check[2]",
    "decision.ts:ProceedDecisionSchema.authority.stages.[].requirements.[].eligibleRoleIds.check[2]",
    "ids.ts:NonEmptyRoleRefSetSchema.check[2]",
  ],
  "decision.ts:BlockedDecisionSchema.blockers.[].resolvingEvidence.[].check[0]": [
    "decision.ts:BlockedDecisionSchema.blockers.[].resolvingEvidence.[].check[0]",
    "decision.ts:DecisionRecordSchema.result.blockers.[].resolvingEvidence.[].check[0]",
    "decision.ts:DecisionResultSchema.blockers.[].resolvingEvidence.[].check[0]",
    "trigger.ts:EvidenceRequestSchema.check[0]",
    "trigger.ts:ResolutionStateSchema.gaps.[].check[0]",
    "trigger.ts:ResolvableBlockerSchema.resolvingEvidence.[].check[0]",
  ],
  "decision.ts:BlockedDecisionSchema.blockers.[].resolvingEvidence.[].suppliableBy.check[1]": [
    "decision.ts:BlockedDecisionSchema.blockers.[].resolvingEvidence.[].suppliableBy.check[1]",
    "decision.ts:DecisionRecordSchema.result.blockers.[].resolvingEvidence.[].suppliableBy.check[1]",
    "decision.ts:DecisionResultSchema.blockers.[].resolvingEvidence.[].suppliableBy.check[1]",
    "trigger.ts:EvidenceRequestSchema.suppliableBy.check[1]",
    "trigger.ts:ResolutionStateSchema.gaps.[].suppliableBy.check[1]",
    "trigger.ts:ResolvableBlockerSchema.resolvingEvidence.[].suppliableBy.check[1]",
  ],
  "decision.ts:DecisionRecordSchema.check[0]": [
    "decision.ts:DecisionRecordSchema.check[0]",
  ],
  "decision.ts:DecisionRecordSchema.check[1]": [
    "decision.ts:DecisionRecordSchema.check[1]",
  ],
  "decision.ts:DecisionRecordSchema.check[2]": [
    "decision.ts:DecisionRecordSchema.check[2]",
  ],
  "decision.ts:DecisionRecordSchema.check[4]": [
    "decision.ts:DecisionRecordSchema.check[4]",
  ],
  "decision.ts:DecisionRecordSchema.check[5]": [
    "decision.ts:DecisionRecordSchema.check[5]",
  ],
  "decision.ts:ExplanationNodeSchema.evidenceSnapshotRefs.check[0]": [
    "decision.ts:DecisionRecordSchema.explanationTrace.[].evidenceSnapshotRefs.check[0]",
    "decision.ts:ExplanationNodeSchema.evidenceSnapshotRefs.check[0]",
    "explanation.ts:ExplanationNodeSchema.evidenceSnapshotRefs.check[0]",
  ],
  "decision.ts:ExplanationNodeSchema.sourceRefs.[].check[0]": [
    "decision.ts:DecisionRecordSchema.precedenceTrace.[].left.check[0]",
    "decision.ts:DecisionRecordSchema.precedenceTrace.[].right.check[0]",
    "decision.ts:DecisionRecordSchema.result.prohibition.source.check[0]",
    "decision.ts:DecisionRecordSchema.explanationTrace.[].sourceRefs.[].check[0]",
    "decision.ts:DecisionResultSchema.prohibition.source.check[0]",
    "decision.ts:ExplanationNodeSchema.sourceRefs.[].check[0]",
    "decision.ts:PrecedenceStepSchema.left.check[0]",
    "decision.ts:PrecedenceStepSchema.right.check[0]",
    "decision.ts:ProhibitedDecisionSchema.prohibition.source.check[0]",
    "decision.ts:ProhibitionSchema.source.check[0]",
    "decision.ts:VersionedSourceRefSchema.check[0]",
    "explanation.ts:ExplanationNodeSchema.sourceRefs.[].check[0]",
    "explanation.ts:PrecedenceStepSchema.left.check[0]",
    "explanation.ts:PrecedenceStepSchema.right.check[0]",
    "explanation.ts:VersionedSourceRefSchema.check[0]",
  ],
  "decision.ts:ExplanationNodeSchema.sourceRefs.check[0]": [
    "decision.ts:DecisionRecordSchema.explanationTrace.[].sourceRefs.check[0]",
    "decision.ts:ExplanationNodeSchema.sourceRefs.check[0]",
    "explanation.ts:ExplanationNodeSchema.sourceRefs.check[0]",
  ],
  "decision.ts:ProhibitionSchema.check[0]": [
    "decision.ts:DecisionRecordSchema.result.prohibition.check[0]",
    "decision.ts:DecisionResultSchema.prohibition.check[0]",
    "decision.ts:ProhibitedDecisionSchema.prohibition.check[0]",
    "decision.ts:ProhibitionSchema.check[0]",
  ],
  "decision.ts:PrecedenceStepSchema.check[0]": [
    "decision.ts:DecisionRecordSchema.precedenceTrace.[].check[0]",
    "decision.ts:PrecedenceStepSchema.check[0]",
    "explanation.ts:PrecedenceStepSchema.check[0]",
  ],
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.conflictKeys.check[1]": [
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].conflictKeys.check[1]",
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].compensatingAction.conflictKeys.check[1]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].conflictKeys.check[1]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].compensatingAction.conflictKeys.check[1]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].conflictKeys.check[1]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.conflictKeys.check[1]",
    "execution.ts:CompensatingActionSchema.conflictKeys.check[1]",
    "execution.ts:ExecutionPlanSchema.steps.[].conflictKeys.check[1]",
    "execution.ts:ExecutionPlanSchema.steps.[].compensatingAction.conflictKeys.check[1]",
    "execution.ts:ExecutionStepSchema.conflictKeys.check[1]",
    "execution.ts:ExecutionStepSchema.compensatingAction.conflictKeys.check[1]",
    "execution.ts:RetrySafeExternalActionSchema.conflictKeys.check[1]",
  ],
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[1]": [
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "execution.ts:CompensatingActionSchema.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "execution.ts:ExecutionPlanSchema.steps.[].preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "execution.ts:ExecutionPlanSchema.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "execution.ts:ExecutionPreconditionSchema.requiredEvidenceSnapshotRefs.check[1]",
    "execution.ts:ExecutionStepSchema.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "execution.ts:ExecutionStepSchema.compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
    "execution.ts:RetrySafeExternalActionSchema.preconditions.[].requiredEvidenceSnapshotRefs.check[1]",
  ],
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[2]": [
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "execution.ts:CompensatingActionSchema.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "execution.ts:ExecutionPlanSchema.steps.[].preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "execution.ts:ExecutionPlanSchema.steps.[].compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "execution.ts:ExecutionPreconditionSchema.requiredEvidenceSnapshotRefs.check[2]",
    "execution.ts:ExecutionStepSchema.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "execution.ts:ExecutionStepSchema.compensatingAction.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
    "execution.ts:RetrySafeExternalActionSchema.preconditions.[].requiredEvidenceSnapshotRefs.check[2]",
  ],
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.check[1]": [
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].preconditions.check[1]",
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].compensatingAction.preconditions.check[1]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].preconditions.check[1]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].compensatingAction.preconditions.check[1]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].preconditions.check[1]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.preconditions.check[1]",
    "execution.ts:CompensatingActionSchema.preconditions.check[1]",
    "execution.ts:ExecutionPlanSchema.steps.[].preconditions.check[1]",
    "execution.ts:ExecutionPlanSchema.steps.[].compensatingAction.preconditions.check[1]",
    "execution.ts:ExecutionStepSchema.preconditions.check[1]",
    "execution.ts:ExecutionStepSchema.compensatingAction.preconditions.check[1]",
    "execution.ts:RetrySafeExternalActionSchema.preconditions.check[1]",
  ],
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.reservationRefs.check[0]": [
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].reservationRefs.check[0]",
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].compensatingAction.reservationRefs.check[0]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].reservationRefs.check[0]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].compensatingAction.reservationRefs.check[0]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].reservationRefs.check[0]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].compensatingAction.reservationRefs.check[0]",
    "execution.ts:CompensatingActionSchema.reservationRefs.check[0]",
    "execution.ts:ExecutionPlanSchema.steps.[].reservationRefs.check[0]",
    "execution.ts:ExecutionPlanSchema.steps.[].compensatingAction.reservationRefs.check[0]",
    "execution.ts:ExecutionStepSchema.reservationRefs.check[0]",
    "execution.ts:ExecutionStepSchema.compensatingAction.reservationRefs.check[0]",
    "execution.ts:RetrySafeExternalActionSchema.reservationRefs.check[0]",
  ],
  "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].dependsOn.check[0]": [
    "decision.ts:DecisionRecordSchema.result.executionPlan.steps.[].dependsOn.check[0]",
    "decision.ts:DecisionResultSchema.executionPlan.steps.[].dependsOn.check[0]",
    "decision.ts:ProceedDecisionSchema.executionPlan.steps.[].dependsOn.check[0]",
    "execution.ts:ExecutionPlanSchema.steps.[].dependsOn.check[0]",
    "execution.ts:ExecutionStepSchema.dependsOn.check[0]",
  ],
  "decision.ts:RevaluationConditionSchema.check[0]": [
    "decision.ts:DecisionRecordSchema.reevaluateWhen.[].check[0]",
    "decision.ts:RevaluationConditionSchema.check[0]",
  ],
  "evidence.ts:DecisionInputBundleSchema.evidenceSnapshotRefs.check[0]": [
    "evidence.ts:DecisionInputBundleSchema.evidenceSnapshotRefs.check[0]",
  ],
  "evidence.ts:DecisionInputBundleSchema.householdInstructionVersionRefs.check[0]": [
    "evidence.ts:DecisionInputBundleSchema.householdInstructionVersionRefs.check[0]",
  ],
  "evidence.ts:DecisionInputBundleSchema.timeZone": [
    "evidence.ts:DecisionInputBundleSchema.timeZone",
  ],
  "trigger.ts:AmbiguityRefSchema.candidateRefs.check[1]": [
    "trigger.ts:AmbiguityRefSchema.candidateRefs.check[1]",
    "trigger.ts:ResolutionStateSchema.ambiguous.[].candidateRefs.check[1]",
  ],
  "trigger.ts:AmbiguityRefSchema.candidateRefs.check[2]": [
    "trigger.ts:AmbiguityRefSchema.candidateRefs.check[2]",
    "trigger.ts:ResolutionStateSchema.ambiguous.[].candidateRefs.check[2]",
  ],
};

const opaqueSchemaEntriesByPath = new Map<string, OpaqueSchemaEntry>();
for (const [file, moduleExports] of DECISION_CORE_SCHEMA_MODULES) {
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (!isSchema(value)) continue;
    for (const entry of opaqueSchemaNodeEntries(
      value,
      `${file}:${exportName}`,
    )) {
      opaqueSchemaEntriesByPath.set(entry.path, entry);
    }
  }
}
const ALLOWED_OPAQUE_SCHEMA_ENTRIES = Object.entries(
  ALLOWED_OPAQUE_SCHEMA_OCCURRENCES,
).flatMap(([canonicalPath, occurrencePaths]) => {
  const canonical = opaqueSchemaEntriesByPath.get(canonicalPath);
  if (canonical === undefined) {
    throw new Error(`missing allowed opaque schema node: ${canonicalPath}`);
  }
  return occurrencePaths.map((path) => {
    const entry = opaqueSchemaEntriesByPath.get(path);
    if (entry === undefined || entry.node !== canonical.node) {
      throw new Error(`invalid allowed opaque schema entry: ${path}`);
    }
    return entry;
  });
});

const unsafeOpaqueSchemaBoundaries = (
  modules: readonly SchemaModule[],
  allowed: readonly OpaqueSchemaEntry[],
): string[] => {
  const allowedByPath = new Map(
    allowed.map((entry) => [entry.path, entry.node]),
  );
  const unsafe: string[] = [];
  for (const [file, exports] of modules) {
    for (const [exportName, value] of Object.entries(exports)) {
      if (
        isSchema(value) &&
        opaqueSchemaNodeEntries(value, `${file}:${exportName}`).some(
          (entry) => allowedByPath.get(entry.path) !== entry.node,
        )
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
        (schemaContainsScopedReferenceCollection(value) ||
          tenantScopeOccurrencePaths(value).size >= 2)
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
type SourceRef = {
  sourceType: string;
  sourceRef: ScopedRef;
  versionRef: ScopedRef;
};
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

type ValuePath = readonly (string | number)[];

const PROBE_CASES = Symbol("probe-cases");
type ProbeSet = {
  readonly [PROBE_CASES]: true;
  readonly cases: readonly unknown[];
};

const probeSet = (...cases: readonly unknown[]): ProbeSet => ({
  [PROBE_CASES]: true,
  cases,
});

const probeCases = (probe: unknown): readonly unknown[] =>
  probe !== null &&
    typeof probe === "object" &&
    PROBE_CASES in probe &&
    (probe as Partial<ProbeSet>)[PROBE_CASES] === true
    ? (probe as ProbeSet).cases
    : [probe];

const proceedBoundary = decisionFixture("decision-record-proceed");
const blockedBoundary = decisionFixture("decision-record-blocked");
const prohibitedBoundary = decisionFixture("decision-record-prohibited");
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
const specialistAuthorityRequirement = {
  mode: "specialist_review",
  specialistRoleIds: [
    { firmId: "firm-a", id: "compliance-specialist" },
    { firmId: "firm-a", id: "operations-specialist" },
  ],
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
const systemActorRef = {
  firmId: "firm-a",
  systemId: "engine",
};
const explanationNode = {
  ...proceedBoundary.explanationTrace[0]!,
  evidenceSnapshotRefs: [
    { firmId: "firm-a", id: "evidence:one" },
    { firmId: "firm-a", id: "evidence:two" },
  ],
  childNodes: [],
};
const instructionSource = {
  sourceType: "household_instruction",
  sourceRef: { firmId: "firm-a", id: "instruction:distribution" },
  versionRef: { firmId: "firm-a", id: "instruction:distribution@2026.07" },
};
const regulatorySource = prohibitedBoundary.result.prohibition!.source;
const instructionExplanationNode = {
  ...explanationNode,
  sourceRefs: [instructionSource],
};
const regulatoryExplanationNode = {
  ...explanationNode,
  sourceRefs: [regulatorySource],
};
const policySource = explanationNode.sourceRefs[0]!;
const versionedSources = [policySource, instructionSource, regulatorySource];
const precedenceSteps = versionedSources.map((source) => ({
  ...proceedBoundary.precedenceTrace[0]!,
  left: source,
  right: source,
}));
const prohibitions = versionedSources.map((source) => ({
  ...prohibitedBoundary.result.prohibition!,
  source,
}));
const prohibitedDecisions = prohibitions.map((prohibition) => ({
  kind: "prohibited",
  prohibition,
}));
const recursiveExplanationNodes = [
  explanationNode,
  instructionExplanationNode,
  regulatoryExplanationNode,
].map((child) => ({ ...explanationNode, childNodes: [child] }));
const recommendation = {
  ...proceedResult.recommendation!,
  parameters: {
    firstSubject: { firmId: "firm-a", id: "subject:one" },
    secondSubject: { firmId: "firm-a", id: "subject:two" },
  },
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
const probedExecutionStep = {
  ...executionStep,
  compensatingAction,
};
const probedExecutionPlan = {
  ...proceedResult.executionPlan!,
  steps: [probedExecutionStep],
};
const probedProceedResult = {
  ...proceedResult,
  recommendation,
  authority: authorityRequirement,
  executionPlan: probedExecutionPlan,
};
const specialistProceedResult = {
  ...probedProceedResult,
  authority: specialistAuthorityRequirement,
};
const prohibitedWithInstructionSource = {
  ...prohibitedBoundary.result,
  prohibition: {
    ...prohibitedBoundary.result.prohibition!,
    source: instructionSource,
  },
};
const prohibitedWithPolicySource = {
  ...prohibitedBoundary.result,
  prohibition: {
    ...prohibitedBoundary.result.prohibition!,
    source: explanationNode.sourceRefs[0],
  },
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
  "actor.ts:AnyActorRefSchema": probeSet(actorRef, systemActorRef),
  "authority.ts:ApprovalRequirementSchema": approvalRequirement,
  "authority.ts:ApprovalStageSchema": probedApprovalStage,
  "authority.ts:ApprovalStageTemplateSchema": approvalStageTemplate,
  "authority.ts:ApprovalTemplateSchema": approvalTemplate,
  "authority.ts:AuthorityRequirementSchema": probeSet(
    authorityRequirement,
    specialistAuthorityRequirement,
  ),
  "authority.ts:EscalationStepSchema": escalationStep,
  "decision.ts:BlockedDecisionSchema": {
    kind: "blocked",
    blockers: [resolvableBlocker],
  },
  "decision.ts:DecisionRecordSchema": proceedBoundary,
  "decision.ts:DecisionResultSchema": probeSet(
    probedProceedResult,
    specialistProceedResult,
    blockedBoundary.result,
    prohibitedBoundary.result,
    prohibitedWithInstructionSource,
    prohibitedWithPolicySource,
  ),
  "decision.ts:ExplanationNodeSchema": probeSet(
    explanationNode,
    instructionExplanationNode,
    regulatoryExplanationNode,
    ...recursiveExplanationNodes,
  ),
  "decision.ts:PrecedenceStepSchema": probeSet(...precedenceSteps),
  "decision.ts:ProceedDecisionSchema": probeSet(
    probedProceedResult,
    specialistProceedResult,
  ),
  "decision.ts:ProhibitedDecisionSchema": probeSet(...prohibitedDecisions),
  "decision.ts:ProhibitionSchema": probeSet(...prohibitions),
  "decision.ts:RecommendationSchema": recommendation,
  "decision.ts:VersionedSourceRefSchema": probeSet(...versionedSources),
  "evidence.ts:DecisionInputBundleSchema":
    fixture("decision-input-bundle"),
  "execution.ts:CompensatingActionSchema": compensatingAction,
  "execution.ts:ExecutionPlanSchema": probedExecutionPlan,
  "execution.ts:ExecutionPreconditionSchema": executionPrecondition,
  "execution.ts:ExecutionStepSchema": probedExecutionStep,
  "execution.ts:RetrySafeExternalActionSchema": externalAction,
  "explanation.ts:ExplanationNodeSchema": probeSet(
    explanationNode,
    instructionExplanationNode,
    regulatoryExplanationNode,
    ...recursiveExplanationNodes,
  ),
  "explanation.ts:PrecedenceStepSchema": probeSet(...precedenceSteps),
  "explanation.ts:VersionedSourceRefSchema": probeSet(...versionedSources),
  "ids.ts:NonEmptyRoleRefSetSchema": roleRefSet,
  "ids.ts:RoleRefSetSchema": roleRefSet,
  "trigger.ts:AmbiguityRefSchema": ambiguityRef,
  "trigger.ts:EvidenceRequestSchema": evidenceRequest,
  "trigger.ts:IntentSchema": intent,
  "trigger.ts:ResolutionStateSchema": resolutionState,
  "trigger.ts:ResolvableBlockerSchema": resolvableBlocker,
  "trigger.ts:TriggerSchema": probeSet(trigger, {
    kind: "system_event",
    firmId: "firm-a",
    sourceRef: { firmId: "firm-a", id: "evidence-source:probe" },
    eventType: "evidence-updated",
    eventRef: { firmId: "firm-a", id: "event:probe" },
    tokenizedPayload: { value: { status: "received" }, piiFree: true },
  }),
};

const occurrenceEdges = (
  schema: z.ZodType,
): Array<SchemaEdge & { readonly occurrenceSegment: string }> => {
  const current = unwrapSchema(schema);
  const type = schemaDefinition(current).type;
  const edges = schemaEdges(current);
  const segmentCounts = new Map<string, number>();
  for (const edge of edges) {
    segmentCounts.set(edge.segment, (segmentCounts.get(edge.segment) ?? 0) + 1);
  }
  return edges.map((edge, index) => ({
    ...edge,
    occurrenceSegment:
      edge.segment === "" || segmentCounts.get(edge.segment)! > 1
        ? `<${type}:${index}>${edge.segment}`
        : edge.segment,
  }));
};

const appendOccurrencePath = (path: string, segment: string): string =>
  `${path}.${segment}`;

const tenantScopeOccurrencePaths = (
  schema: z.ZodType,
): ReadonlySet<string> => {
  const paths = new Set<string>();
  const pending: Array<{
    readonly schema: z.ZodType;
    readonly path: string;
    readonly ancestors: ReadonlyMap<z.ZodType, number>;
  }> = [{ schema, path: "$", ancestors: new Map() }];
  while (pending.length > 0) {
    const next = pending.pop()!;
    const current = unwrapSchema(next.schema);
    const visits = next.ancestors.get(current) ?? 0;
    if (visits >= 2) continue;
    if (isScopedReferenceSchema(current)) {
      paths.add(next.path);
      continue;
    }
    if (isTenantAnchorSchema(current)) {
      paths.add(appendOccurrencePath(next.path, "firmId"));
    }
    const ancestors = new Map(next.ancestors).set(current, visits + 1);
    for (const edge of occurrenceEdges(current)) {
      pending.push({
        schema: edge.schema,
        path: appendOccurrencePath(next.path, edge.occurrenceSegment),
        ancestors,
      });
    }
  }
  return paths;
};

const isScopedReferenceValue = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.hasOwn(value, "firmId") &&
  Object.hasOwn(value, "id") &&
  typeof (value as Record<string, unknown>).firmId === "string" &&
  typeof (value as Record<string, unknown>).id === "string";

const coveredTenantScopePaths = (
  schema: z.ZodType,
  legal: unknown,
): ReadonlySet<string> => {
  const covered = new Set<string>();
  const visit = (
    candidate: z.ZodType,
    value: unknown,
    path: string,
    ancestors: ReadonlyMap<z.ZodType, number>,
  ): void => {
    const current = unwrapSchema(candidate);
    const visits = ancestors.get(current) ?? 0;
    if (visits >= 2) return;
    if (isScopedReferenceSchema(current)) {
      if (isScopedReferenceValue(value)) covered.add(path);
      return;
    }
    if (
      isTenantAnchorSchema(current) &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).firmId === "string"
    ) {
      covered.add(appendOccurrencePath(path, "firmId"));
    }
    const nextAncestors = new Map(ancestors).set(current, visits + 1);
    const definition = schemaDefinition(current);
    const edges = occurrenceEdges(current);
    const descend = (edge: typeof edges[number], child: unknown): void =>
      visit(
        edge.schema,
        child,
        appendOccurrencePath(path, edge.occurrenceSegment),
        nextAncestors,
      );
    if (definition.type === "object") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return;
      }
      const record = value as Record<string, unknown>;
      const shape = definition.shape as Record<string, unknown>;
      for (const edge of edges) {
        if (edge.segment === "{*}") {
          for (const [key, child] of Object.entries(record)) {
            if (!(key in shape)) descend(edge, child);
          }
        } else if (Object.hasOwn(record, edge.segment)) {
          descend(edge, record[edge.segment]);
        }
      }
      return;
    }
    if (definition.type === "array") {
      if (!Array.isArray(value)) return;
      for (const child of value) descend(edges[0]!, child);
      return;
    }
    if (definition.type === "record") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        descend(edges[0]!, key);
        descend(edges[1]!, child);
      }
      return;
    }
    if (definition.type === "tuple") {
      if (!Array.isArray(value)) return;
      const fixed = edges.filter((edge) => edge.segment !== "[]");
      fixed.forEach((edge, index) => descend(edge, value[index]));
      const rest = edges.find((edge) => edge.segment === "[]");
      if (rest !== undefined) {
        value.slice(fixed.length).forEach((child) => descend(rest, child));
      }
      return;
    }
    if (definition.type === "set") {
      if (!(value instanceof Set)) return;
      for (const child of value) descend(edges[0]!, child);
      return;
    }
    if (definition.type === "map") {
      if (!(value instanceof Map)) return;
      for (const [key, child] of value) {
        descend(edges[0]!, key);
        descend(edges[1]!, child);
      }
      return;
    }
    if (definition.type === "union") {
      const selected = edges.find((edge) => schemaAccepts(edge.schema, value));
      if (selected !== undefined) descend(selected, value);
      return;
    }
    if (definition.type === "intersection") {
      edges.forEach((edge) => descend(edge, value));
      return;
    }
    if (definition.type === "pipe") {
      const input = edges[0];
      const output = edges[1];
      if (input === undefined || output === undefined) return;
      descend(input, value);
      const parsed = input.schema.safeParse(value);
      if (parsed.success) descend(output, parsed.data);
      return;
    }
    edges.forEach((edge) => descend(edge, value));
  };
  visit(schema, legal, "$", new Map());
  return covered;
};

const mixedTenantProbes = (legal: unknown): unknown[] => {
  const tenantFirmIdPaths: ValuePath[] = [];
  let hasScopedReference = false;
  const pending: Array<{ path: ValuePath; value: unknown }> = [
    { path: [], value: legal },
  ];
  while (pending.length > 0) {
    const { path, value } = pending.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (
      !Array.isArray(value) &&
      Object.hasOwn(value, "firmId") &&
      typeof (value as Record<string, unknown>).firmId === "string"
    ) {
      tenantFirmIdPaths.push([...path, "firmId"]);
      hasScopedReference ||= Object.hasOwn(value, "id") &&
        typeof (value as Record<string, unknown>).id === "string";
    }
    if (Array.isArray(value)) {
      for (const [index, child] of value.entries()) {
        pending.push({ path: [...path, index], value: child });
      }
    } else {
      for (const [key, child] of Object.entries(value)) {
        pending.push({ path: [...path, key], value: child });
      }
    }
  }
  if (tenantFirmIdPaths.length < 2) {
    if (!hasScopedReference) return [];
    throw new Error("tenant boundary probes require at least two scoped references");
  }
  const groups = new Map<string, readonly ValuePath[]>();
  const addGroup = (paths: readonly ValuePath[]): void => {
    const key = paths.map((path) => JSON.stringify(path)).sort().join("|");
    groups.set(key, paths);
  };
  tenantFirmIdPaths.forEach((path) => addGroup([path]));
  for (const path of tenantFirmIdPaths) {
    for (let length = 1; length < path.length; length += 1) {
      const prefix = path.slice(0, length);
      const grouped = tenantFirmIdPaths.filter((candidate) =>
        prefix.every((segment, index) => candidate[index] === segment)
      );
      if (grouped.length > 1 && grouped.length < tenantFirmIdPaths.length) {
        addGroup(grouped);
      }
    }
  }
  return [...groups.values()].map((paths) => {
    let mixed = structuredClone(legal);
    for (const path of paths) {
      const update = (value: unknown, index: number): unknown => {
        const segment = path[index]!;
        if (Array.isArray(value)) {
          if (typeof segment !== "number") throw new Error("invalid array path");
          const copy = [...value];
          if (index === path.length - 1) {
            copy[segment] = copy[segment] === "firm-b" ? "firm-a" : "firm-b";
          } else {
            copy[segment] = update(copy[segment], index + 1);
          }
          return copy;
        }
        if (typeof segment !== "string") throw new Error("invalid object path");
        const copy = { ...(value as Record<string, unknown>) };
        if (index === path.length - 1) {
          copy[segment] = copy[segment] === "firm-b"
              ? "firm-a"
              : "firm-b";
        } else {
          copy[segment] = update(copy[segment], index + 1);
        }
        return copy;
      };
      mixed = update(mixed, 0);
    }
    return mixed;
  });
};

const tenantBoundaryAudit = (
  modules: readonly SchemaModule[],
  probes: Readonly<Record<string, unknown>>,
  allowedOpaqueEntries: readonly OpaqueSchemaEntry[] =
    ALLOWED_OPAQUE_SCHEMA_ENTRIES,
): {
  readonly missing: string[];
  readonly stale: string[];
  readonly failed: string[];
  readonly uncovered: string[];
  readonly unsafe: string[];
} => {
  const boundaries = discoveredScopedReferenceBoundaries(modules);
  const boundaryNames = [...boundaries.keys()].sort();
  const probeNames = Object.keys(probes).sort();
  const missing = boundaryNames.filter((name) => !(name in probes));
  const stale = probeNames.filter((name) => !boundaries.has(name));
  const boundariesWithUncoveredPaths = new Set<string>();
  const uncovered = boundaryNames.flatMap((name) => {
    const schema = boundaries.get(name)!;
    const cases = probeCases(probes[name]);
    const coveredPaths = new Set(
      cases.flatMap((legal) => [...coveredTenantScopePaths(schema, legal)]),
    );
    const paths = [...tenantScopeOccurrencePaths(schema)]
      .filter((path) => !coveredPaths.has(path));
    if (paths.length > 0) boundariesWithUncoveredPaths.add(name);
    return paths.map((path) => `${name}:${path}`);
  }).sort();
  const failed = probeNames.filter((name) => {
    const schema = boundaries.get(name);
    if (schema === undefined) return false;
    const cases = probeCases(probes[name]);
    return (
      cases.length === 0 ||
      boundariesWithUncoveredPaths.has(name) ||
      cases.some((legal) =>
        !schema.safeParse(legal).success ||
        mixedTenantProbes(legal).some(
          (mixed) => schema.safeParse(mixed).success,
        )
      )
    );
  });
  const unsafe = unsafeOpaqueSchemaBoundaries(
    modules,
    allowedOpaqueEntries,
  );
  return { missing, stale, failed, uncovered, unsafe };
};

describe("decision-core tenant-scope fence", () => {
  it("keeps every exported scoped-reference boundary behaviorally verified", () => {
    const decisionCoreRoot = join(REPO_ROOT, "src/contracts/decision-core");
    expect(
      walk(decisionCoreRoot, isShippedSourceFilePath)
        .map((file) => relative(decisionCoreRoot, file))
        .sort(),
    ).toEqual(
      DECISION_CORE_SCHEMA_MODULES.map(([file]) => file).sort(),
    );
    expect(tenantBoundaryAudit(
      DECISION_CORE_SCHEMA_MODULES,
      SCOPED_REFERENCE_BOUNDARY_PROBES,
    )).toEqual({
      missing: [],
      stale: [],
      failed: [],
      uncovered: [],
      unsafe: [],
    });
  });

  it.each([
    "nested/probe.ts",
    "probe.tsx",
    "probe.mts",
    "nested/probe.cts",
  ])("rejects an unregistered shipped module at %s", (added) => {
    const registered = DECISION_CORE_SCHEMA_MODULES.map(([file]) => file);
    expect(moduleInventoryMismatch(
      [...registered, added],
      registered,
    )).toEqual([added]);
    expect(moduleInventoryMismatch(registered, registered)).toEqual([]);
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

  it("detects a scoped-reference collection carried by an object catchall", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    const Added = z.object({}).catchall(reference);
    expect(tenantBoundaryAudit(
      [["probe.ts", { Added }]],
      {},
    ).missing).toEqual(["probe.ts:Added"]);
  });

  it("detects scoped references with additional owned fields", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
      kind: z.string(),
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

  it("finds an opaque schema used as a check", () => {
    const CheckedOpaque = z.string().check(z.custom(() => true));
    expect(tenantBoundaryAudit(
      [["probe.ts", { CheckedOpaque }]],
      {},
    ).unsafe).toEqual(["probe.ts:CheckedOpaque"]);
  });

  it("accepts a type-preserving check without schema children", () => {
    const CheckedString = z.string().check(z.minLength(1));
    expect(tenantBoundaryAudit(
      [["probe.ts", { CheckedString }]],
      {},
    ).unsafe).toEqual([]);
  });

  it.each([
    ["object shape", z.object({ value: z.string() }), "shape"],
    ["array element", z.array(z.string()), "element"],
    ["record key", z.record(z.string(), z.number()), "keyType"],
    ["record value", z.record(z.string(), z.number()), "valueType"],
    ["tuple items", z.tuple([z.string()]), "items"],
    ["set value", z.set(z.string()), "valueType"],
    ["map key", z.map(z.string(), z.number()), "keyType"],
    ["map value", z.map(z.string(), z.number()), "valueType"],
    ["union options", z.union([z.string(), z.number()]), "options"],
    ["intersection left", z.intersection(z.string(), z.string()), "left"],
    ["intersection right", z.intersection(z.string(), z.string()), "right"],
    ["lazy getter", z.lazy(() => z.string()), "getter"],
    ["pipe input", z.string().pipe(z.string()), "in"],
    ["pipe output", z.string().pipe(z.string()), "out"],
    ["promise inner type", z.promise(z.string()), "innerType"],
    [
      "function input",
      z.function({ input: [z.string()], output: z.number() }),
      "input",
    ],
    [
      "function output",
      z.function({ input: [z.string()], output: z.number() }),
      "output",
    ],
    [
      "template literal parts",
      z.templateLiteral(["value-", z.string()]),
      "parts",
    ],
  ])("fails closed when the %s representation drifts", (_name, Drifted, key) => {
    Object.defineProperty(Drifted._zod.def, key, {
      configurable: true,
      enumerable: true,
      value: undefined,
      writable: true,
    });
    expect(() => tenantBoundaryAudit(
      [["probe.ts", { Drifted }]],
      {},
    )).toThrow(/unsupported Zod schema structure/);
  });

  it("fails closed on an unrecognized schema-valued child of a known node", () => {
    const DriftedString = z.string();
    Object.assign(DriftedString._zod.def, { futureChild: z.any() });
    expect(() => tenantBoundaryAudit(
      [["probe.ts", { DriftedString }]],
      {},
    )).toThrow(/unrecognized schema children/);
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
    const allowedPaths = new Set(
      Object.values(ALLOWED_OPAQUE_SCHEMA_OCCURRENCES).flat(),
    );
    expect(
      [...opaqueSchemaEntriesByPath.keys()]
        .filter((path) => !allowedPaths.has(path))
        .sort(),
    ).toEqual([]);
    expect(
      ALLOWED_OPAQUE_SCHEMA_ENTRIES.map((entry) => entry.path).sort(),
    ).toEqual(
      Object.values(ALLOWED_OPAQUE_SCHEMA_OCCURRENCES)
        .flat()
        .sort(),
    );
    expect(new Set(
      ALLOWED_OPAQUE_SCHEMA_ENTRIES.map((entry) => entry.node),
    ).size).toBe(
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
      [],
    ).unsafe).toEqual(["probe.ts:FrozenPayload"]);
    expect(tenantBoundaryAudit(
      modules,
      {},
      opaqueSchemaNodeEntries(
        FrozenPayload,
        "probe.ts:FrozenPayload",
      ),
    ).unsafe).toEqual([]);
  });

  it("does not extend an opaque allowance to a second exported path", () => {
    const opaque = z.any();
    const modules: readonly SchemaModule[] = [[
      "probe.ts",
      {
        First: z.strictObject({ value: opaque }),
        Second: z.strictObject({ value: opaque }),
      },
    ]];
    expect(unsafeOpaqueSchemaBoundaries(
      modules,
      opaqueSchemaNodeEntries(
        modules[0]![1].First as z.ZodType,
        "probe.ts:First",
      ),
    )).toEqual(["probe.ts:Second"]);
  });

  it("does not deduplicate shared opaque nodes within one export", () => {
    const opaque = z.any();
    const Reused = z.strictObject({
      added: opaque,
      allowed: opaque,
    });
    expect(unsafeOpaqueSchemaBoundaries(
      [["probe.ts", { Reused }]],
      [{
        path: "probe.ts:Reused.allowed",
        node: opaque,
      }],
    )).toEqual(["probe.ts:Reused"]);
  });

  it("terminates cyclic schema traversal without hiding safe siblings", () => {
    const opaque = z.any();
    const Recursive: z.ZodType = z.lazy(() =>
      z.strictObject({
        next: Recursive.optional(),
        value: opaque,
      }),
    );
    expect(opaqueSchemaNodeEntries(
      Recursive,
      "probe.ts:Recursive",
    ).map((entry) => entry.path)).toEqual([
      "probe.ts:Recursive.value",
    ]);
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

  it("detects an exported object with multiple direct scoped references", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    const DirectBoundary = z.strictObject({
      sourceRef: reference,
      scopeRef: reference,
    });
    expect(tenantBoundaryAudit(
      [["probe.ts", { DirectBoundary }]],
      {},
    ).missing).toEqual(["probe.ts:DirectBoundary"]);
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

  it("mutates every scoped-reference edge in a boundary probe", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    const PartiallyConstrained = z.strictObject({
      constrained: z.array(reference).refine((refs) =>
        refs.every((ref) => ref.firmId === refs[0]?.firmId),
      ),
      unconstrained: z.array(reference),
    });
    const legal = {
      constrained: [
        { firmId: "firm-a", id: "constrained:one" },
        { firmId: "firm-a", id: "constrained:two" },
      ],
      unconstrained: [
        { firmId: "firm-a", id: "unconstrained:one" },
        { firmId: "firm-a", id: "unconstrained:two" },
      ],
    };
    expect(tenantBoundaryAudit(
      [["probe.ts", { PartiallyConstrained }]],
      { "probe.ts:PartiallyConstrained": legal },
    ).failed).toEqual(["probe.ts:PartiallyConstrained"]);
  });

  it("requires probes to cover optional scoped-reference edges", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    const OptionalUnconstrained = z.strictObject({
      constrained: z.array(reference).refine((refs) =>
        refs.every((ref) => ref.firmId === refs[0]?.firmId),
      ),
      optionalUnconstrained: z.array(reference).optional(),
    });
    const legal = {
      constrained: [
        { firmId: "firm-a", id: "constrained:one" },
        { firmId: "firm-a", id: "constrained:two" },
      ],
    };
    expect(tenantBoundaryAudit(
      [["probe.ts", { OptionalUnconstrained }]],
      { "probe.ts:OptionalUnconstrained": legal },
    ).failed).toEqual(["probe.ts:OptionalUnconstrained"]);
  });

  it("requires probes to cover every scoped-reference union branch", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    const UnionBoundary = z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("constrained"),
        refs: z.array(reference).refine((refs) =>
          refs.every((ref) => ref.firmId === refs[0]?.firmId),
        ),
      }),
      z.strictObject({
        kind: z.literal("unconstrained"),
        refs: z.array(reference),
      }),
    ]);
    const legal = {
      kind: "constrained",
      refs: [
        { firmId: "firm-a", id: "constrained:one" },
        { firmId: "firm-a", id: "constrained:two" },
      ],
    };
    const audit = tenantBoundaryAudit(
      [["probe.ts", { UnionBoundary }]],
      { "probe.ts:UnionBoundary": legal },
    );
    expect(audit.failed).toEqual(["probe.ts:UnionBoundary"]);
    expect(audit.uncovered).toEqual([
      "probe.ts:UnionBoundary:$.<union:1>.refs.[]",
    ]);
  });

  it("assigns distinct occurrence paths to repeated container edges", () => {
    const reference = z.strictObject({
      firmId: z.string(),
      id: z.string(),
    });
    expect([...tenantScopeOccurrencePaths(z.map(reference, reference))].sort())
      .toEqual(["$.<map:0>{}", "$.<map:1>{}"]);
  });

  it("requires recursive probes to cover child scoped references", () => {
    const audit = tenantBoundaryAudit(
      [["probe.ts", { Recursive: explanationSchemas.ExplanationNodeSchema }]],
      { "probe.ts:Recursive": explanationNode },
    );
    expect(audit.failed).toEqual(["probe.ts:Recursive"]);
    expect(audit.uncovered.some((path) => path.includes("childNodes"))).toBe(true);
  });

  it("enforces one tenant across a recursive explanation tree", () => {
    expect(explanationSchemas.ExplanationNodeSchema.safeParse({
      ...explanationNode,
      childNodes: [{
        ...explanationNode,
        evidenceSnapshotRefs: explanationNode.evidenceSnapshotRefs.map(
          (reference) => ({ ...reference, firmId: "firm-b" }),
        ),
        sourceRefs: explanationNode.sourceRefs.map((source) => ({
          ...source,
          sourceRef: { ...source.sourceRef, firmId: "firm-b" },
          versionRef: { ...source.versionRef, firmId: "firm-b" },
        })),
      }],
    }).success).toBe(false);
  });

  it("enforces one tenant across a prohibition source and scope", () => {
    const prohibition = prohibitedBoundary.result.prohibition!;
    expect(decisionSchemas.ProhibitionSchema.safeParse({
      ...prohibition,
      scopeRef: { ...prohibition.scopeRef, firmId: "firm-b" },
    }).success).toBe(false);
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
