import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  DurationSchema,
  HashSchema,
  TimestampSchema,
} from "@contracts/decision-core/ids";
import { TokenizedPayloadSchema } from "@contracts/decision-core/actor";
import { IntentSchema } from "@contracts/decision-core/trigger";
import {
  DecisionInputBundleSchema,
  EvidenceSnapshotRefSchema,
  TIME_ZONE_DATA_VERSION,
  TimeZoneSchema,
} from "@contracts/decision-core/evidence";
import { DecisionRecordSchema, DecisionResultSchema, RevaluationConditionSchema } from "@contracts/decision-core/decision";
import { ApprovalTemplateSchema, AuthorityRequirementSchema } from "@contracts/decision-core/authority";
import { ExecutionPlanSchema } from "@contracts/decision-core/execution";
import {
  BUNDLE_HASH_PAYLOAD_KEYS,
  BUNDLE_HASH_PREIMAGE_VERSION,
  CANONICAL_SERIALIZER_VERSION,
  DECISION_HASH_PAYLOAD_KEYS,
  DECISION_HASH_PREIMAGE_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
  HASH_PROJECTION_SCHEMA_FINGERPRINTS,
  bundleHashPreimage,
  canonicalJson,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { unwrap } from "@contracts/result";
import {
  CANONICAL_IANA_TIME_ZONES,
  IANA_TIME_ZONE_DATA_VERSION,
  IANA_TIME_ZONE_REGISTRY_SHA256,
} from "@contracts/time-zone";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Decision-core schema tests (v3 §5; ADR-0029, D-040). The illegal-state fence
 * (fitness/decision-core-illegal-states.test.ts) owns invariants 7–9; this suite
 * covers the rest of the prompt-5 contract: tenant scoping of persisted records,
 * canonical-serialization fixtures, vocabulary locks against the demo matrix,
 * and the structural-integrity refinements.
 */

const timestamp = "2026-07-26T13:30:00.000Z";
const hash = "c".repeat(64);

const validIntent = {
  firmId: "firm-a",
  id: "intent:u:1",
  trigger: {
    kind: "human_request",
    requester: { firmId: "firm-a", actorId: "actor:u:1", roleIds: ["advisor"] },
    requestRef: { firmId: "firm-a", id: "req:u:1" },
    maskedRequest: { value: "distribute 75000 USD (tokenized)", piiFree: true },
  },
  domainConfigVersionRef: { firmId: "firm-a", id: "dcv:money-movement:1" },
  action: "primitive:distribute-cash",
  slots: { amount: "slot:amount:u:1" },
  createdAt: timestamp,
};

const validSnapshot = {
  firmId: "firm-a",
  id: "evs:u:1",
  kind: "account-balance",
  sourceRef: { firmId: "firm-a", id: "src:house-crm" },
  subjectRef: { firmId: "firm-a", id: "subject:smiths-joint-taxable" },
  observedAt: timestamp,
  retrievedAt: timestamp,
  attribution: "house-crm nightly sync",
  schemaVersion: "1",
  encryptedStorageRef: { firmId: "firm-a", id: "blob:u:1" },
  contentHash: hash,
  freshness: "fresh",
};

const validBundle = {
  firmId: "firm-a",
  id: "bundle:u:1",
  schemaVersion: DECISION_CORE_SCHEMA_VERSION,
  canonicalSerializerVersion: CANONICAL_SERIALIZER_VERSION,
  engineVersion: "0.0.0",
  primitiveSetVersion: "0",
  domainConfigVersionRef: { firmId: "firm-a", id: "dcv:money-movement:1" },
  policyVersionRef: { firmId: "firm-a", id: "pv:firm-a:1" },
  householdInstructionVersionRefs: [{ firmId: "firm-a", id: "hiv:smiths:1" }],
  evidenceSnapshotRefs: [{ firmId: "firm-a", id: "evs:u:1" }],
  asOf: timestamp,
  timeZone: "America/New_York",
  timeZoneDataVersion: TIME_ZONE_DATA_VERSION,
  bundleHash: hash,
};

describe("tenant scoping - unscoped persisted records are unrepresentable (v3 invariant 2)", () => {
  it("rejects each persisted record without firmId", () => {
    for (const [schema, value] of [
      [IntentSchema, validIntent],
      [EvidenceSnapshotRefSchema, validSnapshot],
      [DecisionInputBundleSchema, validBundle],
    ] as const) {
      const unscoped = Object.fromEntries(Object.entries(value).filter(([k]) => k !== "firmId"));
      expect(schema.safeParse(value).success, "the scoped counterpart must parse").toBe(true);
      const parsed = schema.safeParse(unscoped);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.some((i) => i.path[0] === "firmId")).toBe(true);
    }
  });

  it("rejects a cross-tenant intent (trigger from another firm)", () => {
    const crossTenant = {
      ...validIntent,
      trigger: {
        ...validIntent.trigger,
        requester: { ...validIntent.trigger.requester, firmId: "firm-b" },
      },
    };
    expect(IntentSchema.safeParse(crossTenant).success).toBe(false);
    expect(
      IntentSchema.safeParse({
        ...validIntent,
        domainConfigVersionRef: { ...validIntent.domainConfigVersionRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
  });

  it("rejects cross-tenant evidence source and subject references", () => {
    expect(EvidenceSnapshotRefSchema.safeParse(validSnapshot).success).toBe(true);
    for (const value of [
      { ...validSnapshot, sourceRef: { ...validSnapshot.sourceRef, firmId: "firm-b" } },
      { ...validSnapshot, subjectRef: { ...validSnapshot.subjectRef, firmId: "firm-b" } },
    ]) {
      expect(EvidenceSnapshotRefSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects cross-tenant attribution on a DecisionRecord", () => {
    const fixture = JSON.parse(readFixture("decision-record-proceed")) as { createdBy: { firmId: string } };
    fixture.createdBy = { ...fixture.createdBy, firmId: "firm-b" };
    expect(DecisionRecordSchema.safeParse(fixture).success).toBe(false);
  });

  it("requires tenant-scoped bundle references and rejects every cross-tenant link", () => {
    expect(DecisionInputBundleSchema.safeParse(validBundle).success).toBe(true);
    for (const crossTenant of [
      {
        ...validBundle,
        domainConfigVersionRef: { ...validBundle.domainConfigVersionRef, firmId: "firm-b" },
      },
      { ...validBundle, policyVersionRef: { ...validBundle.policyVersionRef, firmId: "firm-b" } },
      {
        ...validBundle,
        householdInstructionVersionRefs: [
          { ...validBundle.householdInstructionVersionRefs[0]!, firmId: "firm-b" },
        ],
      },
      {
        ...validBundle,
        evidenceSnapshotRefs: [{ ...validBundle.evidenceSnapshotRefs[0]!, firmId: "firm-b" }],
      },
    ]) {
      expect(DecisionInputBundleSchema.safeParse(crossTenant).success).toBe(false);
    }
  });

  it("requires tenant-scoped intent and bundle references on DecisionRecord", () => {
    const fixture = JSON.parse(readFixture("decision-record-proceed")) as {
      intentRef: { firmId: string };
      inputBundleRef: { firmId: string };
    };
    expect(DecisionRecordSchema.safeParse(fixture).success).toBe(true);
    expect(
      DecisionRecordSchema.safeParse({
        ...fixture,
        intentRef: { ...fixture.intentRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
    expect(
      DecisionRecordSchema.safeParse({
        ...fixture,
        inputBundleRef: { ...fixture.inputBundleRef, firmId: "firm-b" },
      }).success,
    ).toBe(false);
  });
});

function readFixture(name: string): string {
  return readFileSync(join(ROOT, "fixtures/decision-core", `${name}.json`), "utf8").replace(/\n$/, "");
}

describe("canonical serialization (replay metadata, v3 §5 / prompt 19 groundwork)", () => {
  it("keeps every schema key, including optional keys, classified in its hash projection", () => {
    const bundleKeys = Object.keys(DecisionInputBundleSchema.unwrap().shape).filter(
      (key) => key !== "id" && key !== "bundleHash",
    );
    const decisionKeys = Object.keys(DecisionRecordSchema.unwrap().shape).filter((key) => key !== "decisionHash");
    expect([...BUNDLE_HASH_PAYLOAD_KEYS].sort()).toEqual(bundleKeys.sort());
    expect([...DECISION_HASH_PAYLOAD_KEYS].sort()).toEqual(decisionKeys.sort());
    expect(DECISION_HASH_PAYLOAD_KEYS).toContain("derivedFromDecisionRef");
  });

  it("rejects replay metadata versions without a matching implementation", () => {
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, schemaVersion: "2.0.0" }).success).toBe(false);
    expect(
      DecisionInputBundleSchema.safeParse({ ...validBundle, canonicalSerializerVersion: "2.0.0" }).success,
    ).toBe(false);
  });

  it("uses a version-pinned time-zone registry independent of host ICU data", () => {
    expect(TIME_ZONE_DATA_VERSION).toBe(IANA_TIME_ZONE_DATA_VERSION);
    expect(
      createHash("sha256").update(CANONICAL_IANA_TIME_ZONES.join("\n")).digest("hex"),
    ).toBe(IANA_TIME_ZONE_REGISTRY_SHA256);
    for (const timeZone of CANONICAL_IANA_TIME_ZONES) {
      expect(TimeZoneSchema.safeParse(timeZone).success).toBe(true);
    }
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "Not/AZone" }).success).toBe(false);
    expect(DecisionInputBundleSchema.safeParse(validBundle).success).toBe(true);
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "US/Eastern" }).success).toBe(false);
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "Europe/London" }).success).toBe(true);
    expect(DecisionInputBundleSchema.safeParse({ ...validBundle, timeZone: "America/Chicago" }).success).toBe(true);
    expect(
      DecisionInputBundleSchema.parse({ ...validBundle, timeZone: "america/new_york" }).timeZone,
    ).toBe("America/New_York");
    expect(
      DecisionInputBundleSchema.safeParse({
        ...validBundle,
        timeZoneDataVersion: "decision-core-time-zones/2.0.0",
      }).success,
    ).toBe(false);
    const original = Intl.DateTimeFormat;
    Reflect.set(Intl, "DateTimeFormat", () => {
      throw new Error("host ICU unavailable");
    });
    try {
      expect(DecisionInputBundleSchema.safeParse(validBundle).success).toBe(true);
    } finally {
      Reflect.set(Intl, "DateTimeFormat", original);
    }
  });

  it.each(["householdInstructionVersionRefs", "evidenceSnapshotRefs"] as const)(
    "rejects duplicate replay IDs in %s",
    (key) => {
      const ref = validBundle[key][0]!;
      const parsed = DecisionInputBundleSchema.safeParse({ ...validBundle, [key]: [ref, ref] });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.path[0] === key)).toBe(true);
    },
  );

  it("canonicalizes set-like replay collections in parsed evaluator input", () => {
    const fixture = JSON.parse(readFixture("decision-input-bundle")) as typeof validBundle;
    const canonical = DecisionInputBundleSchema.parse(fixture);
    const reversed = DecisionInputBundleSchema.parse({
      ...fixture,
      householdInstructionVersionRefs: [...fixture.householdInstructionVersionRefs].reverse(),
      evidenceSnapshotRefs: [...fixture.evidenceSnapshotRefs].reverse(),
    });
    expect(reversed.householdInstructionVersionRefs).toEqual(canonical.householdInstructionVersionRefs);
    expect(reversed.evidenceSnapshotRefs).toEqual(canonical.evidenceSnapshotRefs);
  });

  it("freezes parsed replay inputs and their nested collections", () => {
    const bundle = DecisionInputBundleSchema.parse(validBundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.policyVersionRef)).toBe(true);
    expect(Object.isFrozen(bundle.householdInstructionVersionRefs)).toBe(true);
    expect(Object.isFrozen(bundle.evidenceSnapshotRefs)).toBe(true);
    expect(Reflect.set(bundle.policyVersionRef, "id", "pv:mutated")).toBe(false);
    expect(Reflect.set(bundle.evidenceSnapshotRefs, 0, { firmId: "firm-a", id: "evs:mutated" })).toBe(false);
  });

  it.each(["decision-record-proceed", "decision-record-blocked", "decision-record-prohibited"])(
    "deep-freezes every hash-bound object and collection in %s",
    (name) => {
      const record = DecisionRecordSchema.parse(JSON.parse(readFixture(name)));
      expectDeepFrozen(record);
      expect(Reflect.set(record, "result", {})).toBe(false);
      if (record.result.kind === "proceed") {
        expect(Reflect.set(record.result.executionPlan, "steps", [])).toBe(false);
        expect(Reflect.set(record.result.executionPlan.steps, 0, {})).toBe(false);
      }
    },
  );

  it("deep-freezes other parsed decision-core boundary outputs", () => {
    for (const value of [
      IntentSchema.parse(validIntent),
      EvidenceSnapshotRefSchema.parse(validSnapshot),
      DecisionInputBundleSchema.parse(validBundle),
      TokenizedPayloadSchema.parse({
        value: { nested: { values: [1, 2, 3] } },
        piiFree: true,
      }),
    ]) {
      expectDeepFrozen(value);
    }
  });

  it("binds each preimage version to its complete recursive projection schema", () => {
    expect(projectionSchemaFingerprint(DecisionInputBundleSchema, ["id", "bundleHash"])).toBe(
      HASH_PROJECTION_SCHEMA_FINGERPRINTS[BUNDLE_HASH_PREIMAGE_VERSION],
    );
    expect(projectionSchemaFingerprint(DecisionRecordSchema, ["decisionHash"])).toBe(
      HASH_PROJECTION_SCHEMA_FINGERPRINTS[DECISION_HASH_PREIMAGE_VERSION],
    );
  });

  it("changes the projection fingerprint when an optional nested field is added", () => {
    const before = z.strictObject({ nested: z.strictObject({ required: z.string() }) });
    const after = z.strictObject({
      nested: z.strictObject({ required: z.string(), newlyOptional: z.string().optional() }),
    });
    expect(projectionSchemaFingerprint(before, [])).not.toBe(projectionSchemaFingerprint(after, []));
  });

  it("locks the versioned, non-self-referential bundle hash preimage and digest", () => {
    const text = readFixture("decision-input-bundle");
    const bundle = DecisionInputBundleSchema.parse(JSON.parse(text));
    expect(unwrap(canonicalJson(JSON.parse(text) as JsonValue))).toBe(text);
    expect(hashPreimage(bundleHashPreimage(bundle))).toBe(bundle.bundleHash);
    const reidentified = DecisionInputBundleSchema.parse({
      ...bundle,
      id: "bundle:reidentified",
      bundleHash: "f".repeat(64),
    });
    expect(hashPreimage(bundleHashPreimage(reidentified))).toBe(bundle.bundleHash);
    expect(
      hashPreimage(
        bundleHashPreimage({
          ...bundle,
          householdInstructionVersionRefs: [...bundle.householdInstructionVersionRefs].reverse(),
          evidenceSnapshotRefs: [...bundle.evidenceSnapshotRefs].reverse(),
        }),
      ),
    ).toBe(bundle.bundleHash);
  });

  it.each(["decision-record-proceed", "decision-record-blocked", "decision-record-prohibited"])(
    "fixture %s round-trips byte-identically and locks its non-self-referential decision digest",
    (name) => {
      const text = readFixture(name);
      const value = JSON.parse(text) as JsonValue;
      const record = DecisionRecordSchema.parse(value);
      expect(unwrap(canonicalJson(value))).toBe(text);
      expect(hashPreimage(decisionHashPreimage(record))).toBe(record.decisionHash);
      const changedStoredHash = DecisionRecordSchema.parse({ ...record, decisionHash: "f".repeat(64) });
      expect(hashPreimage(decisionHashPreimage(changedStoredHash))).toBe(record.decisionHash);
    },
  );

  it("is key-order independent: permuted insertion order yields identical bytes", () => {
    const a = { b: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, b: 1 };
    expect(unwrap(canonicalJson(a))).toBe(unwrap(canonicalJson(b)));
    expect(unwrap(canonicalJson(a))).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it("refuses values JSON cannot round-trip instead of silently coercing them", () => {
    expect(canonicalJson(Number.NaN).ok).toBe(false);
    expect(canonicalJson(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(canonicalJson({ a: undefined } as unknown as JsonValue).ok).toBe(false);
    expect(canonicalJson(new Date() as unknown as JsonValue).ok).toBe(false);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(canonicalJson(circular as JsonValue).ok).toBe(false);
  });

  it("refuses sparse arrays instead of colliding with dense arrays or emitting invalid JSON", () => {
    expect(canonicalJson(Array(1) as JsonValue).ok).toBe(false);
    expect(canonicalJson(Array(2) as JsonValue).ok).toBe(false);
    expect(unwrap(canonicalJson([]))).toBe("[]");
  });

  it("hashes every schema-valid decision even when optional keys were explicitly undefined", () => {
    const value = JSON.parse(readFixture("decision-record-proceed")) as {
      result: { executionPlan: { steps: Array<Record<string, unknown>> } };
      reevaluateWhen: Array<Record<string, unknown>>;
    };
    value.result.executionPlan.steps[0]!.compensatingAction = undefined;
    value.reevaluateWhen = [{ kind: "evidence_changed", subjectRef: undefined }];
    const record = DecisionRecordSchema.parse(value);
    expect(canonicalJson(decisionHashPreimage(record)).ok).toBe(true);
  });
});

function hashPreimage(value: Parameters<typeof canonicalJson>[0]): string {
  return createHash("sha256").update(unwrap(canonicalJson(value)), "utf8").digest("hex");
}

function projectionSchemaFingerprint(schema: z.ZodType, excludedRootKeys: readonly string[]): string {
  const document = structuredClone(z.toJSONSchema(schema)) as Record<string, unknown>;
  delete document.$schema;
  const properties = document.properties as Record<string, unknown>;
  for (const key of excludedRootKeys) delete properties[key];
  if (Array.isArray(document.required)) {
    document.required = document.required.filter((key) => !excludedRootKeys.includes(String(key)));
  }
  return createHash("sha256")
    .update(unwrap(canonicalJson(document as JsonValue)), "utf8")
    .digest("hex");
}

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
}

describe("vocabulary locks - aligned with what is on main", () => {
  it("DecisionResult kinds are EXACTLY the scenarios.yaml disposition vocabulary", () => {
    const yaml = parseYaml(readFileSync(join(ROOT, "config/demo/scenarios.yaml"), "utf8")) as {
      state_vocabulary: Array<{ id: string; class: string }>;
    };
    const dispositions = yaml.state_vocabulary.filter((s) => s.class === "disposition").map((s) => s.id);
    const kinds = DecisionResultSchema.unwrap().options.map((o) => o.shape.kind.value);
    expect([...kinds].sort()).toEqual([...dispositions].sort());
  });

  it("evidence freshness matches the golden truth set's vocabulary", () => {
    for (const freshness of ["fresh", "stale", "unknown"]) {
      expect(EvidenceSnapshotRefSchema.safeParse({ ...validSnapshot, freshness }).success).toBe(true);
    }
    expect(EvidenceSnapshotRefSchema.safeParse({ ...validSnapshot, freshness: "expired" }).success).toBe(false);
  });
});

describe("temporal + integrity primitives", () => {
  it("Timestamp admits ONLY the toISOString() byte form - the store's byte-exact ISO discipline", () => {
    expect(TimestampSchema.safeParse(timestamp).success).toBe(true);
    expect(TimestampSchema.safeParse("2026-07-26T09:30:00-04:00").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T09:30:00").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T13:30Z").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T13:30:00Z").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T13:30:00.5Z").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T13:30:00.0000Z").success).toBe(false);
  });

  it("Hash admits only sha256 lowercase hex", () => {
    expect(HashSchema.safeParse(hash).success).toBe(true);
    expect(HashSchema.safeParse(hash.toUpperCase()).success).toBe(false);
    expect(HashSchema.safeParse("c".repeat(63)).success).toBe(false);
  });

  it("Duration admits ISO-8601 durations (the truth set's expiresAfter vocabulary)", () => {
    expect(DurationSchema.safeParse("P3D").success).toBe(true);
    expect(DurationSchema.safeParse("PT30M").success).toBe(true);
    expect(DurationSchema.safeParse("3 days").success).toBe(false);
  });
});

describe("structural-integrity refinements", () => {
  const step = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    targetRef: { firmId: "firm-a", id: "target:house-crm" },
    command: {
      commandType: "submit",
      payloadRef: { firmId: "firm-a", id: `blob:${id}` },
      payloadHash: hash,
    },
    idempotencyKey: `idem:${id}`,
    conflictKeys: [`conflict:${id}`],
    reservationRefs: [],
    preconditions: [{
      code: "evidence-still-fresh",
      requiredEvidenceSnapshotRefs: [],
      mustStillHoldAtExecution: true,
    }],
    verificationRuleRef: { firmId: "firm-a", id: "vr:u:1" },
    dependsOn: [],
    ...over,
  });

  it("accepts dependency graphs; rejects duplicate ids, duplicate idempotency keys, unknown, self, and cyclic dependencies", () => {
    const good = { id: "plan:u:1", steps: [step("s1"), step("s2", { dependsOn: ["s1"] })] };
    const diamond = {
      id: "plan:u:diamond",
      steps: [step("s1"), step("s2", { dependsOn: ["s1"] }), step("s3", { dependsOn: ["s1"] }), step("s4", { dependsOn: ["s2", "s3"] })],
    };
    expect(ExecutionPlanSchema.safeParse(good).success).toBe(true);
    expect(ExecutionPlanSchema.safeParse(diamond).success).toBe(true);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:2", steps: [step("s1"), step("s1")] }).success).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({ id: "plan:u:3", steps: [step("s1"), step("s2", { idempotencyKey: "idem:s1" })] }).success,
    ).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:4", steps: [step("s1", { dependsOn: ["ghost"] })] }).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:5", steps: [step("s1", { dependsOn: ["s1"] })] }).success).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({
        id: "plan:u:6",
        steps: [step("s1", { dependsOn: ["s2"] }), step("s2", { dependsOn: ["s1"] })],
      }).success,
    ).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({
        id: "plan:u:7",
        steps: [
          step("s1", { dependsOn: ["s3"] }),
          step("s2", { dependsOn: ["s1"] }),
          step("s3", { dependsOn: ["s2"] }),
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    ["dependsOn", { dependsOn: ["s0", "s0"] }],
    ["conflictKeys", { conflictKeys: ["conflict:s1", "conflict:s1"] }],
    [
      "reservationRefs",
      {
        reservationRefs: [
          { firmId: "firm-a", id: "reservation:s1" },
          { firmId: "firm-a", id: "reservation:s1" },
        ],
      },
    ],
    [
      "requiredEvidenceSnapshotRefs",
      {
        preconditions: [{
          code: "evidence-still-fresh",
          requiredEvidenceSnapshotRefs: [
            { firmId: "firm-a", id: "evidence:s1" },
            { firmId: "firm-a", id: "evidence:s1" },
          ],
          mustStillHoldAtExecution: true,
        }],
      },
    ],
  ] as const)("rejects duplicate set-like execution collection %s", (_name, over) => {
    const plan = {
      id: "plan:u:duplicates",
      steps: [
        step("s0"),
        step("s1", over),
      ],
    };
    expect(ExecutionPlanSchema.safeParse(plan).success).toBe(false);
  });

  const stageBase = (stageId: string, order: number) => ({
    stageId,
    order,
    executionMode: "sequential",
    requirements: [
      {
        eligibleRoleIds: ["operations-manager"],
        approvalsRequired: 1,
        distinctActorsRequired: true,
        requesterMayApprove: false,
        priorExecutorMayApprove: true,
        reasonRequiredOnOverride: true,
      },
    ],
    escalationPath: [],
  });
  const approvalStage = (stageId: string, order: number) => ({
    ...stageBase(stageId, order),
    templateRef: { firmId: "firm-a", id: "apt:u:1" },
    expiresAt: timestamp,
  });
  const templateStage = (stageId: string, order: number) => ({
    ...stageBase(stageId, order),
    expiresAfter: "P3D",
  });

  it("accepts distinct approval stages; rejects a duplicate stageId and a duplicate order in every stage-carrying shape", () => {
    const distinct = [approvalStage("stg:ops", 0), approvalStage("stg:manager", 1)];
    const dupId = [approvalStage("stg:ops", 0), approvalStage("stg:ops", 1)];
    const dupOrder = [approvalStage("stg:ops", 0), approvalStage("stg:manager", 0)];
    expect(AuthorityRequirementSchema.safeParse({ mode: "approval", stages: distinct }).success).toBe(true);
    expect(AuthorityRequirementSchema.safeParse({ mode: "approval", stages: dupId }).success).toBe(false);
    expect(AuthorityRequirementSchema.safeParse({ mode: "approval", stages: dupOrder }).success).toBe(false);
    const review = (stages: unknown) => ({ mode: "specialist_review", specialistRoleIds: ["cco"], stages });
    expect(AuthorityRequirementSchema.safeParse(review(distinct)).success).toBe(true);
    expect(AuthorityRequirementSchema.safeParse(review(dupId)).success).toBe(false);
    expect(AuthorityRequirementSchema.safeParse(review(dupOrder)).success).toBe(false);
    const template = (stages: unknown) => ({ firmId: "firm-a", id: "apt:u:1", stages });
    expect(ApprovalTemplateSchema.safeParse(template([templateStage("stg:ops", 0), templateStage("stg:manager", 1)])).success).toBe(true);
    expect(ApprovalTemplateSchema.safeParse(template([templateStage("stg:ops", 0), templateStage("stg:ops", 1)])).success).toBe(false);
    expect(ApprovalTemplateSchema.safeParse(template([templateStage("stg:ops", 0), templateStage("stg:manager", 0)])).success).toBe(false);
  });

  it("deadline_reached requires a deadline; other kinds do not", () => {
    expect(RevaluationConditionSchema.safeParse({ kind: "deadline_reached", deadline: timestamp }).success).toBe(true);
    expect(RevaluationConditionSchema.safeParse({ kind: "deadline_reached" }).success).toBe(false);
    expect(RevaluationConditionSchema.safeParse({ kind: "approval_expired" }).success).toBe(true);
  });
});
