import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionRecordSchema } from "@contracts/decision-core/decision";
import { DecisionInputBundleSchema } from "@contracts/decision-core/evidence";
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
type DecisionFixture = Record<string, unknown> & {
  intentRef: ScopedRef;
  inputBundleRef: ScopedRef;
  createdBy: { firmId: string };
  precedenceTrace: Array<{ left: SourceRef; right: SourceRef }>;
  explanationTrace: ExplanationNode[];
  result: Record<string, unknown> & {
    kind: string;
    prohibition?: { source: SourceRef };
    executionPlan?: {
      steps: Array<{ preconditions: Array<{ requiredEvidenceSnapshotRefs: ScopedRef[] }> }>;
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
      policyVersionRef: { firmId: string };
      householdInstructionVersionRefs: Array<{ firmId: string }>;
      evidenceSnapshotRefs: Array<{ firmId: string }>;
    };
    const crossTenant = [
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

  it("enforces: prohibition and execution-precondition references belong to the decision tenant", () => {
    const prohibited = decisionFixture("decision-record-prohibited");
    const prohibition = prohibited.result.prohibition!;
    expect(
      DecisionRecordSchema.safeParse({
        ...prohibited,
        result: {
          ...prohibited.result,
          prohibition: {
            ...prohibition,
            source: crossTenantSource(prohibition.source),
          },
        },
      }).success,
    ).toBe(false);

    const proceed = decisionFixture("decision-record-proceed");
    const executionPlan = proceed.result.executionPlan!;
    const step = executionPlan.steps[0]!;
    const precondition = step.preconditions[0]!;
    expect(
      DecisionRecordSchema.safeParse({
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
      }).success,
    ).toBe(false);
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
