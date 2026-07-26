import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  DurationSchema,
  HashSchema,
  TimestampSchema,
} from "@contracts/decision-core/ids";
import { IntentSchema } from "@contracts/decision-core/trigger";
import { DecisionInputBundleSchema, EvidenceSnapshotRefSchema } from "@contracts/decision-core/evidence";
import { DecisionRecordSchema, DecisionResultSchema, RevaluationConditionSchema } from "@contracts/decision-core/decision";
import { ExecutionPlanSchema } from "@contracts/decision-core/execution";
import {
  CANONICAL_SERIALIZER_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { unwrap } from "@contracts/result";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Decision-core schema tests (v3 §5; ADR-0029, D-036). The illegal-state fence
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
    requestRef: "req:u:1",
    maskedRequest: { value: "distribute 75000 USD (tokenized)", piiFree: true },
  },
  domainConfigVersionId: "dcv:money-movement:1",
  action: "primitive:distribute-cash",
  slots: { amount: "slot:amount:u:1" },
  createdAt: timestamp,
};

const validSnapshot = {
  firmId: "firm-a",
  id: "evs:u:1",
  kind: "account-balance",
  sourceId: "src:house-crm",
  subjectRef: "subject:smiths-joint-taxable",
  observedAt: timestamp,
  retrievedAt: timestamp,
  attribution: "house-crm nightly sync",
  schemaVersion: "1",
  encryptedStorageRef: "blob:u:1",
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
  domainConfigVersionId: "dcv:money-movement:1",
  policyVersionId: "pv:firm-a:1",
  householdInstructionVersionIds: ["hiv:smiths:1"],
  evidenceSnapshotIds: ["evs:u:1"],
  asOf: timestamp,
  timeZone: "America/New_York",
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
  });

  it("rejects cross-tenant attribution on a DecisionRecord", () => {
    const fixture = JSON.parse(readFixture("decision-record-proceed")) as { createdBy: { firmId: string } };
    fixture.createdBy = { ...fixture.createdBy, firmId: "firm-b" };
    expect(DecisionRecordSchema.safeParse(fixture).success).toBe(false);
  });
});

function readFixture(name: string): string {
  return readFileSync(join(ROOT, "fixtures/decision-core", `${name}.json`), "utf8").replace(/\n$/, "");
}

describe("canonical serialization (replay metadata, v3 §5 / prompt 19 groundwork)", () => {
  it.each(["decision-record-proceed", "decision-record-blocked", "decision-record-prohibited"])(
    "fixture %s parses through DecisionRecordSchema and round-trips byte-identically",
    (name) => {
      const text = readFixture(name);
      const value = JSON.parse(text) as JsonValue;
      expect(DecisionRecordSchema.safeParse(value).success).toBe(true);
      expect(unwrap(canonicalJson(value))).toBe(text);
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
});

describe("vocabulary locks - aligned with what is on main", () => {
  it("DecisionResult kinds are EXACTLY the scenarios.yaml disposition vocabulary", () => {
    const yaml = parseYaml(readFileSync(join(ROOT, "config/demo/scenarios.yaml"), "utf8")) as {
      state_vocabulary: Array<{ id: string; class: string }>;
    };
    const dispositions = yaml.state_vocabulary.filter((s) => s.class === "disposition").map((s) => s.id);
    const kinds = DecisionResultSchema.options.map((o) => o.shape.kind.value);
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
  it("Timestamp admits ONLY canonical UTC (Z) instants - the store's byte-exact ISO discipline", () => {
    expect(TimestampSchema.safeParse(timestamp).success).toBe(true);
    expect(TimestampSchema.safeParse("2026-07-26T09:30:00-04:00").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26T09:30:00").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-26").success).toBe(false);
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
    targetId: "target:house-crm",
    command: { commandType: "submit", payloadRef: `blob:${id}`, payloadHash: hash },
    idempotencyKey: `idem:${id}`,
    conflictKeys: [],
    reservationRefs: [],
    preconditions: [],
    verificationRuleId: "vr:u:1",
    dependsOn: [],
    ...over,
  });

  it("accepts a dependency-ordered plan; rejects duplicate ids, duplicate idempotency keys, unknown and self dependencies", () => {
    const good = { id: "plan:u:1", steps: [step("s1"), step("s2", { dependsOn: ["s1"] })] };
    expect(ExecutionPlanSchema.safeParse(good).success).toBe(true);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:2", steps: [step("s1"), step("s1")] }).success).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse({ id: "plan:u:3", steps: [step("s1"), step("s2", { idempotencyKey: "idem:s1" })] }).success,
    ).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:4", steps: [step("s1", { dependsOn: ["ghost"] })] }).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ id: "plan:u:5", steps: [step("s1", { dependsOn: ["s1"] })] }).success).toBe(false);
  });

  it("deadline_reached requires a deadline; other kinds do not", () => {
    expect(RevaluationConditionSchema.safeParse({ kind: "deadline_reached", deadline: timestamp }).success).toBe(true);
    expect(RevaluationConditionSchema.safeParse({ kind: "deadline_reached" }).success).toBe(false);
    expect(RevaluationConditionSchema.safeParse({ kind: "approval_expired" }).success).toBe(true);
  });
});
