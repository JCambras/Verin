import { z } from "zod";
import {
  canonicalJson,
  type JsonValue,
} from "../../src/contracts/decision-core/serialization";
import type { GeneratedFile } from "./generate";
import {
  canonicalIntakeFilenameRule,
  caseJsonSchema,
  isCanonicalIntakePath,
  schemaFromSpec,
} from "./intake-filename";
import { deriveRealDerivedFreshness } from "./real-derived-policy";
import {
  pendingActionProblems,
  realDerivedOutcomeProblems,
  realDerivedSemanticContractProblems,
  realDerivedSemanticDefects,
  realDerivedTopologyProblems,
} from "./real-derived-semantics";
import type {
  RealDerivedCase,
  ReplayPayload,
} from "./real-derived-types";
import { parseStrictJson } from "./strict-json";
import { readTree } from "./tree";
import { REAL_DERIVED_DIR } from "./world";

const REPLAY_SCHEMA_FILE = "real-derived-replay-schema.json";

type JsonSchemaNode = {
  readonly $ref?: unknown;
  readonly additionalProperties?: unknown;
  readonly items?: unknown;
  readonly allOf?: unknown;
  readonly anyOf?: unknown;
  readonly oneOf?: unknown;
  readonly properties?: unknown;
  readonly const?: unknown;
  readonly uniqueItems?: unknown;
};

const replayJsonSchema = schemaFromSpec(REPLAY_SCHEMA_FILE);

function resolveSchema(
  schema: JsonSchemaNode,
  root: Record<string, unknown>,
): JsonSchemaNode {
  if (
    typeof schema.$ref !== "string" ||
    !schema.$ref.startsWith("#/$defs/")
  ) {
    return schema;
  }
  const name = schema.$ref.slice("#/$defs/".length);
  const definitions = root.$defs;
  if (
    definitions === null ||
    typeof definitions !== "object" ||
    Array.isArray(definitions)
  ) {
    return schema;
  }
  return (definitions as Record<string, JsonSchemaNode>)[name] ?? schema;
}

function branchMatches(value: unknown, schema: JsonSchemaNode): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const properties =
    schema.properties !== null &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? schema.properties as Record<string, JsonSchemaNode>
      : {};
  const discriminators = Object.entries(properties).filter(
    ([, property]) => property.const !== undefined,
  );
  return discriminators.length > 0 &&
    discriminators.every(
      ([key, property]) =>
        (value as Record<string, unknown>)[key] === property.const,
    );
}

function closedSchemaPaths(
  value: unknown,
  unresolved: JsonSchemaNode,
  root: Record<string, unknown>,
  path: Array<string | number> = [],
): Array<Array<string | number>> {
  const schema = resolveSchema(unresolved, root);
  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as JsonSchemaNode[]).filter((branch) =>
      branchMatches(value, branch),
    );
    return matches.length === 1
      ? closedSchemaPaths(value, matches[0]!, root, path)
      : [];
  }
  if (Array.isArray(value)) {
    return schema.items !== null && typeof schema.items === "object"
      ? value.flatMap((entry, index) =>
          closedSchemaPaths(
            entry,
            schema.items as JsonSchemaNode,
            root,
            [...path, index],
          ),
        )
      : [];
  }
  if (value === null || typeof value !== "object") return [];
  const properties =
    schema.properties !== null &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? schema.properties as Record<string, JsonSchemaNode>
      : {};
  const record = value as Record<string, unknown>;
  const extra = schema.additionalProperties === false
    ? Object.keys(record)
        .filter((key) => properties[key] === undefined)
        .map(() => [...path, "(redacted)"])
    : [];
  return [
    ...extra,
    ...Object.entries(properties).flatMap(([key, child]) =>
      Object.hasOwn(record, key)
        ? closedSchemaPaths(record[key], child, root, [...path, key])
        : [],
    ),
  ];
}

function duplicateSchemaPaths(
  value: unknown,
  unresolved: JsonSchemaNode,
  root: Record<string, unknown>,
  path: Array<string | number> = [],
): Array<Array<string | number>> {
  const schema = resolveSchema(unresolved, root);
  const composed = Array.isArray(schema.allOf)
    ? schema.allOf as JsonSchemaNode[]
    : [];
  const alternatives = [schema.oneOf, schema.anyOf].flatMap((branches) =>
    Array.isArray(branches)
      ? (branches as JsonSchemaNode[]).filter((branch) =>
          branchMatches(value, branch)
        )
      : []
  );
  const nested = [...composed, ...alternatives].flatMap((branch) =>
    duplicateSchemaPaths(value, branch, root, path)
  );
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const duplicates = schema.uniqueItems === true
      ? value.flatMap((entry, index) => {
          const serialized = canonicalJson(entry as JsonValue);
          const key = serialized.ok ? serialized.value : `invalid:${index}`;
          if (seen.has(key)) return [[...path, index]];
          seen.add(key);
          return [];
        })
      : [];
    const children =
      schema.items !== null && typeof schema.items === "object"
        ? value.flatMap((entry, index) =>
            duplicateSchemaPaths(
              entry,
              schema.items as JsonSchemaNode,
              root,
              [...path, index],
            )
          )
        : [];
    return [...nested, ...duplicates, ...children];
  }
  if (value === null || typeof value !== "object") return nested;
  const properties =
    schema.properties !== null &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? schema.properties as Record<string, JsonSchemaNode>
      : {};
  return [
    ...nested,
    ...Object.entries(properties).flatMap(([key, child]) =>
      Object.hasOwn(value, key)
        ? duplicateSchemaPaths(
            (value as Record<string, unknown>)[key],
            child,
            root,
            [...path, key],
          )
        : [],
    ),
  ];
}

const ReplayPayloadSchema = z.fromJSONSchema(replayJsonSchema) as z.ZodType<ReplayPayload>;
const ParsedCaseSchema = z.fromJSONSchema(caseJsonSchema)
  .superRefine((value, context) => {
    const replayValue = (value as { replayPayload?: unknown }).replayPayload;
    const replay = ReplayPayloadSchema.safeParse(replayValue);
    if (!replay.success) {
      for (const issue of replay.error.issues)
        context.addIssue({ ...issue, path: ["replayPayload", ...issue.path] });
    }
  });
const ClosedRawCaseSchema = z.unknown().superRefine((value, context) => {
  const paths = closedSchemaPaths(value, caseJsonSchema, caseJsonSchema);
  const duplicatePaths = duplicateSchemaPaths(
    value,
    caseJsonSchema,
    caseJsonSchema,
  );
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const replayValue = (value as Record<string, unknown>).replayPayload;
    paths.push(
      ...closedSchemaPaths(
        replayValue,
        replayJsonSchema,
        replayJsonSchema,
        ["replayPayload"],
      ),
    );
    duplicatePaths.push(
      ...duplicateSchemaPaths(
        replayValue,
        replayJsonSchema,
        replayJsonSchema,
        ["replayPayload"],
      ),
    );
  }
  for (const path of paths) {
    context.addIssue({
      code: "custom",
      path,
      message: "unrecognized field",
    });
  }
  for (const path of duplicatePaths) {
    context.addIssue({
      code: "custom",
      path,
      message: "must contain unique items",
    });
  }
});
export const RealDerivedCaseSchema = ClosedRawCaseSchema
  .pipe(ParsedCaseSchema) as unknown as z.ZodType<RealDerivedCase>;

export { realDerivedSemanticContractProblems };

export function realDerivedCaseProblems(
  value: unknown,
  defectClassIds: ReadonlySet<string>,
  where: string,
): string[] {
  const parsed = RealDerivedCaseSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => {
      const path = issue.path.map((part) =>
        typeof part === "number" || /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(String(part))
          ? String(part) : "(redacted)");
      return `${where}: ${path.join(".") || "(root)"} - schema validation failed`;
    });
  }
  const attestation = parsed.data.scrubAttestation;
  const problems: string[] = [];
  const reject = (invalid: boolean, message: string): void => {
    if (invalid) problems.push(`${where}: ${message}`);
  };
  reject(attestation.recordsAfter > attestation.recordsBefore, "scrubAttestation.recordsAfter exceeds recordsBefore - scrubbing cannot add records");
  reject(attestation.scrubbedBy === attestation.reviewedBy, "scrubAttestation.reviewedBy must differ from scrubbedBy - review is a second pair of eyes");
  const chronology = [
    ["occurredAt", parsed.data.occurredAt],
    ["scrubAttestation.extractedAt", attestation.extractedAt],
    ["scrubAttestation.scrubbedAt", attestation.scrubbedAt],
    ["scrubAttestation.reviewedAt", attestation.reviewedAt],
  ] as const;
  for (let index = 1; index < chronology.length; index += 1) {
    const previous = chronology[index - 1]!;
    const current = chronology[index]!;
    reject(previous[1] > current[1], `${previous[0]} must not postdate ${current[0]}`);
  }
  const subjectCounts = new Map<string, number>();
  for (const subject of parsed.data.subjects) {
    subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
  }
  const evidenceIds = new Set<string>();
  for (const evidence of parsed.data.evidence) {
    const subjectCount = subjectCounts.get(evidence.subjectRef) ?? 0;
    reject(subjectCount !== 1, `evidence ${evidence.id} subjectRef resolves to ${subjectCount} subjects, expected exactly one`);
    reject(evidenceIds.has(evidence.id), `duplicate evidence id "${evidence.id}"`);
    evidenceIds.add(evidence.id);
    reject(!evidence.id.endsWith(`:${evidence.evidenceKind}`), `evidence ${evidence.id} does not match evidenceKind "${evidence.evidenceKind}"`);
    reject(evidence.retrievedAt > parsed.data.evaluation.asOf, `evidence ${evidence.id} retrievedAt must not postdate evaluation.asOf`);
    reject(
      evidence.observationState === "observed" &&
        evidence.observedAt > evidence.retrievedAt,
      `evidence ${evidence.id} observedAt must not postdate retrievedAt`,
    );
    const expectedFreshness = deriveRealDerivedFreshness(
      parsed.data.evaluation.freshnessPolicyVersion,
      evidence.evidenceKind,
      parsed.data.evaluation.asOf,
      evidence.observedAt,
    );
    reject(evidence.freshness !== expectedFreshness, `evidence ${evidence.id} freshness "${evidence.freshness}" does not match derived "${expectedFreshness}"`);
  }
  for (const reservation of parsed.data.reservations) {
    reject(!reservation.conflictKey.endsWith(`:${reservation.family}`), `conflictKey ${reservation.conflictKey} does not match family "${reservation.family}"`);
  }
  const payload = parsed.data.replayPayload;
  const payloadProblem = (path: string, invalid: boolean): void => {
    reject(invalid, `replayPayload.${path} is inconsistent`);
  };
  problems.push(
    ...[
      ...pendingActionProblems(parsed.data),
      ...realDerivedTopologyProblems(parsed.data),
      ...realDerivedOutcomeProblems(parsed.data),
    ].map((problem) => `${where}: ${problem}`),
  );
  const expectedThreshold =
    payload.request.amountMinor < payload.policy.thresholdMinor
      ? "below"
      : payload.request.amountMinor === payload.policy.thresholdMinor
        ? "equal"
        : "above";
  payloadProblem("threshold comparison", payload.policy.thresholdComparison !== expectedThreshold);
  payloadProblem(
    "event chronology",
    parsed.data.occurredAt > parsed.data.evaluation.asOf ||
      payload.temporal.eventAt > parsed.data.evaluation.asOf,
  );
  const authority = payload.authority;
  if (authority.authorityState !== "missing") {
    const expectedAuthority =
      authority.authorityScope === "other"
        ? "wrong-scope"
        : authority.validFrom! > parsed.data.evaluation.asOf
          ? "not-yet-effective"
          : authority.validTo !== null &&
              authority.validTo <= parsed.data.evaluation.asOf
            ? "expired"
            : "effective";
    payloadProblem(
      "authority state",
      authority.authorityState !== expectedAuthority ||
        (authority.validTo !== null && authority.validTo < authority.validFrom!),
    );
  }
  const evidenceRefs = new Set(payload.evidenceRefs);
  reject(
    evidenceRefs.size !== evidenceIds.size ||
      [...evidenceIds].some((id) => !evidenceRefs.has(id)),
    "replayPayload evidenceRefs must exactly match evidence ids",
  );
  const reservationKeys = new Set(payload.execution.reservationKeys);
  const emittedKeys = new Set(parsed.data.reservations.map((entry) => entry.conflictKey));
  reject(
    reservationKeys.size !== emittedKeys.size ||
      [...emittedKeys].some((key) => !reservationKeys.has(key)),
    "replayPayload reservationKeys must exactly match reservations",
  );
  reject(parsed.data.label.kind === "defect" && !defectClassIds.has(parsed.data.label.defectClassId), "label.defectClassId is not in the closed defect taxonomy");
  const semanticDefects = realDerivedSemanticDefects(parsed.data);
  if (parsed.data.label.kind === "defect") {
    reject(
      semanticDefects.length !== 1 ||
        semanticDefects[0] !== parsed.data.label.defectClassId,
      "label.defectClassId does not match replay expected-versus-observed semantics: expected exactly one replay semantic defect",
    );
  } else {
    reject(
      semanticDefects.length > 0,
      `clean-control carries replay defect signatures: ${semanticDefects.join(", ")}`,
    );
  }
  return problems;
}

export interface RealDerivedDelivery {
  readonly deliveredPaths: readonly string[];
  readonly files: readonly GeneratedFile[];
  readonly problems: readonly string[];
}

export function loadRealDerivedDelivery(
  dir: string = REAL_DERIVED_DIR,
): RealDerivedDelivery {
  const tree = readTree(dir, "real-derived");
  const readme = tree.find(
    (entry) => entry.relPath === "real-derived/README.md",
  );
  const invalidRoot = tree.some(
    (entry) => entry.relPath === "real-derived" && entry.kind === "unsupported",
  );
  const entries = tree.filter(
    (entry) =>
      entry.relPath !== "real-derived" &&
      entry.relPath !== "real-derived/README.md",
  );
  const files: GeneratedFile[] = [];
  const problems: string[] = invalidRoot
    ? ["real-derived intake root must be a regular directory"]
    : readme === undefined
      ? [
        "real-derived/README.md is missing - the intake contract must ship with the empty partition",
      ]
      : readme.kind !== "file" || readme.bytes === null
        ? ["real-derived/README.md must be a regular file"]
        : [];
  for (const [index, entry] of entries.entries()) {
    const delivery = `real-derived delivery ${index + 1}`;
    if (!isCanonicalIntakePath(entry.relPath)) {
      problems.push(`${delivery}: ${canonicalIntakeFilenameRule()}`);
      continue;
    }
    if (entry.kind !== "file" || entry.bytes === null) {
      problems.push(
        `${delivery}: unsupported filesystem entry in real-derived intake`,
      );
      continue;
    }
    try {
      const value = parseStrictJson(entry.bytes, delivery) as JsonValue;
      const canonical = canonicalJson(value);
      if (!canonical.ok || entry.bytes !== `${canonical.value}\n`) {
        problems.push(
          `${entry.relPath}: input must be canonical JSON with unique object keys`,
        );
        continue;
      }
      files.push({
        relPath: entry.relPath,
        bytes: entry.bytes,
        value,
      });
    } catch (error) {
      problems.push(
        error instanceof Error && error.message.includes("duplicate object key")
          ? `${entry.relPath}: input must be canonical JSON with unique object keys`
          : `${entry.relPath}: invalid JSON`,
      );
    }
  }
  return {
    deliveredPaths: entries.map((entry) => entry.relPath),
    files,
    problems,
  };
}
