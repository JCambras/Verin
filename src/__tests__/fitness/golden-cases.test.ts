import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DecisionRecordSchema,
  type DecisionRecord,
} from "@contracts/decision-core/decision";
import {
  canonicalJson,
  decisionHashPreimage,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { unwrap } from "@contracts/result";
import { REPO_ROOT } from "./_fence-utils";
import {
  AMENDMENT_AWAITING,
  GOLDEN_DOC,
  REQUIRED_SPEC_NAMES,
  goldenContentHash,
  loadGoldenCases,
  loadScenarioRefs,
  loadSignedScope,
  validateGoldenCases,
  type LoadedCase,
  type ScenarioRefs,
} from "../../../scripts/golden-cases.lib";

/**
 * GOLDEN-CASES FENCE (v3 build-sequence prompt 2; charter #1/#4). The golden
 * cases are the truth set the engine is later judged against, so an INCOMPLETE
 * or DISHONEST case is a build failure, not a doc nit:
 *  (a) every case states every required field, populated (trigger, firm config,
 *      household evidence, policy versions, household instructions, expected
 *      disposition / authority stages / execution eligibility / explanation
 *      nodes / ledger events / verification state, signoff);
 *  (b) vocabulary aligns with the LIVE config/demo/scenarios.yaml (firm ids,
 *      scenario ids, state vocabulary, provenance labels, deferral status) and
 *      ledger events with the v3 core-contracts LedgerEntry types;
 *  (c) structural consistency: blocked/prohibited cases carry no authority,
 *      no execution eligibility, no reached verification (v3 invariants 8/9);
 *      the partial-Salesforce case carries the deferred-pending-sandbox marking;
 *  (d) signoff honesty: pending-captain (unsigned) or signed-with-attribution;
 *      an agent-invented in-between state cannot pass; expected results remain
 *      product truth subject to captain signoff, never agent invention;
 *  (e) doc/fixture sync in BOTH directions: every fixture caseId appears in
 *      docs/golden-cases.md AND every full case id the doc names exists as a
 *      fixture; all twelve spec-enumerated cases are covered; at least twelve.
 * The validator core is shared with scripts/golden-cases-validate.ts (the
 * `golden-cases` CI job), so the enforced check and the proven check are the
 * same code. The companion below feeds violating cases and proves they CANNOT
 * pass (charter #4: detection is not verification).
 */
const realCases = loadGoldenCases();
const realRefs = loadScenarioRefs();
const realScope = loadSignedScope();
const realDoc = readFileSync(GOLDEN_DOC, "utf8");
const goldenGc07 = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      "fixtures/golden/GC-07-regulatory-prohibition.json",
    ),
    "utf8",
  ),
) as {
  firm: string;
  trigger: { asOf: string };
  expectedDisposition: string;
  policyVersions: {
    firmPolicyVersionId: string;
  };
  prohibition: {
    source: {
      sourceType: string;
      sourceId: string;
      versionId: string;
    };
    scope: string;
    reasonCode: string;
    explanation: string;
    precedenceTrace: Array<{
      order: number;
      left: {
        sourceType: string;
        sourceId: string;
        versionId: string;
      };
      resolution: string;
      reasonCode: string;
      right: {
        sourceType: string;
        sourceId: string;
        versionId: string;
      };
    }>;
  };
};
const proceedRecordFixture = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      "fixtures/decision-core/decision-record-proceed.json",
    ),
    "utf8",
  ),
) as unknown;
const executionPayloadFixtureBytes = readFileSync(
  join(
    REPO_ROOT,
    "fixtures/decision-core/execution-payload-proceed.json",
  ),
  "utf8",
);
const executionPayloadFixture = JSON.parse(
  executionPayloadFixtureBytes,
) as {
  amountMinor: number;
  commandType: string;
  currency: string;
  destinationInstructionRef: {
    firmId: string;
    id: string;
  };
  schemaVersion: string;
  sourceSubjectRef: {
    firmId: string;
    id: string;
  };
};
const prohibitedRecordFixture = JSON.parse(
  readFileSync(
    join(
      REPO_ROOT,
      "fixtures/decision-core/decision-record-prohibited.json",
    ),
    "utf8",
  ),
) as unknown;

function decisionHashFor(record: DecisionRecord): string {
  return createHash("sha256")
    .update(
      unwrap(canonicalJson(decisionHashPreimage(record))),
      "utf8",
    )
    .digest("hex");
}

function executionPayloadHash(payload: typeof executionPayloadFixture): string {
  const serialized = canonicalJson(payload as JsonValue);
  if (!serialized.ok) throw new Error(serialized.error.message);
  return createHash("sha256")
    .update(serialized.value, "utf8")
    .digest("hex");
}

function executionPayloadByteProblems(
  payload: typeof executionPayloadFixture,
  bytes: string,
): string[] {
  const serialized = canonicalJson(payload as JsonValue);
  if (!serialized.ok) return [serialized.error.message];
  return bytes === `${serialized.value}\n`
    ? []
    : [
        "GC-01 secure execution payload must be committed in canonical byte form",
      ];
}

function executionPayloadProblems(
  recordValue: unknown,
  payload: typeof executionPayloadFixture,
): string[] {
  const parsed = DecisionRecordSchema.safeParse(recordValue);
  if (!parsed.success)
    return ["GC-01 canonical record must satisfy DecisionRecordSchema"];
  const record = parsed.data;
  if (record.result.kind !== "proceed")
    return ["GC-01 canonical record must be a proceed decision"];
  const result = record.result;
  const steps = result.executionPlan.steps;
  if (steps.length !== 1) {
    return ["GC-01 canonical record must carry exactly one execution step"];
  }
  const command = steps[0]!.command;
  const sourceSubject =
    result.recommendation.parameters.sourceSubject;
  const expectedKeys = [
    "amountMinor",
    "commandType",
    "currency",
    "destinationInstructionRef",
    "schemaVersion",
    "sourceSubjectRef",
  ];
  const actualKeys = Object.keys(payload).sort();
  const sourceKeys = Object.keys(payload.sourceSubjectRef).sort();
  const destinationKeys = Object.keys(
    payload.destinationInstructionRef,
  ).sort();
  return [
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    JSON.stringify(sourceKeys) ===
      JSON.stringify(["firmId", "id"]) &&
    JSON.stringify(destinationKeys) ===
      JSON.stringify(["firmId", "id"])
      ? null
      : "GC-01 secure execution payload must use the complete versioned shape",
    payload.schemaVersion ===
    "money-movement-execution-payload/1.0.0"
      ? null
      : "GC-01 secure execution payload schemaVersion must be pinned",
    payload.commandType === command.commandType
      ? null
      : "GC-01 secure execution payload command type must equal the execution command",
    payload.amountMinor ===
    Number(result.recommendation.parameters.amountUsd) * 100
      ? null
      : "GC-01 secure execution payload amount must equal the recommendation amount",
    payload.currency === "USD"
      ? null
      : "GC-01 secure execution payload currency must be USD",
    payload.sourceSubjectRef.firmId === record.firmId &&
    payload.sourceSubjectRef.id ===
      "subject:smiths-family-taxable"
      ? null
      : "GC-01 secure execution payload source must be Smith Family Taxable",
    JSON.stringify(payload.sourceSubjectRef) ===
    JSON.stringify(sourceSubject)
      ? null
      : "GC-01 secure execution payload source must equal the recommendation source",
    payload.destinationInstructionRef.firmId === record.firmId &&
    payload.destinationInstructionRef.id ===
      "subject:smiths-verified-bank-instruction"
      ? null
      : "GC-01 secure execution payload destination must bind the verified bank instruction",
    command.payloadRef.id === "blob:GC-01:distribution"
      ? null
      : "GC-01 execution command must retain the canonical secure blob reference",
    command.payloadHash === executionPayloadHash(payload)
      ? null
      : "GC-01 execution command payloadHash must hash the exact secure payload",
    record.decisionHash === decisionHashFor(record)
      ? null
      : "GC-01 canonical record decisionHash must match its canonical preimage",
  ].filter((problem): problem is string => problem !== null);
}

function gc07PrecedenceProjection(record: DecisionRecord) {
  return record.precedenceTrace.map((step, index) => ({
    order: index + 1,
    left: {
      sourceType: step.left.sourceType,
      sourceId: step.left.sourceRef.id,
      versionId: step.left.versionRef.id,
    },
    resolution: step.resolution,
    reasonCode: step.reasonCode,
    right: {
      sourceType: step.right.sourceType,
      sourceId: step.right.sourceRef.id,
      versionId: step.right.versionRef.id,
    },
  }));
}

function gc07MirrorProblems(
  golden: typeof goldenGc07,
  recordValue: unknown,
): string[] {
  const parsed = DecisionRecordSchema.safeParse(recordValue);
  if (!parsed.success) {
    return ["GC-07 canonical record must satisfy DecisionRecordSchema"];
  }
  const record = parsed.data;
  if (record.result.kind !== "prohibited") {
    return [
      "GC-07 canonical record result.kind must equal golden expectedDisposition",
    ];
  }
  const prohibition = record.result.prohibition;
  return [
    record.firmId === golden.firm
      ? null
      : "GC-07 canonical record firmId must equal golden firm",
    record.createdAt ===
    new Date(golden.trigger.asOf).toISOString()
      ? null
      : "GC-07 canonical record createdAt must equal golden trigger.asOf",
    record.result.kind === golden.expectedDisposition
      ? null
      : "GC-07 canonical record result.kind must equal golden expectedDisposition",
    prohibition.scopeRef.id === golden.prohibition.scope
      ? null
      : "GC-07 canonical record prohibition scope must equal golden prohibition scope",
    prohibition.reasonCode === golden.prohibition.reasonCode
      ? null
      : "GC-07 canonical record prohibition reason must equal golden prohibition reason",
    prohibition.explanation === golden.prohibition.explanation
      ? null
      : "GC-07 canonical record prohibition explanation must equal golden prohibition explanation",
    prohibition.source.sourceType ===
    golden.prohibition.source.sourceType
      ? null
      : "GC-07 canonical record prohibition source type must equal golden source",
    prohibition.source.sourceRef.id ===
    golden.prohibition.source.sourceId
      ? null
      : "GC-07 canonical record prohibition source id must equal golden source",
    prohibition.source.versionRef.id ===
    golden.prohibition.source.versionId
      ? null
      : "GC-07 canonical record prohibition version must equal golden source",
    JSON.stringify(gc07PrecedenceProjection(record)) ===
    JSON.stringify(golden.prohibition.precedenceTrace)
      ? null
      : "GC-07 canonical record precedence trace must exactly equal the ordered golden projection",
    record.decisionHash === decisionHashFor(record)
      ? null
      : "GC-07 canonical record decisionHash must match its canonical preimage",
  ].filter((problem): problem is string => problem !== null);
}

interface MutableVersionedSource {
  sourceType: string;
  sourceRef: { firmId: string; id: string };
  versionRef: { firmId: string; id: string };
}

interface MutablePrecedenceStep {
  left: MutableVersionedSource;
  resolution: string;
  reasonCode: string;
  right: MutableVersionedSource;
}

interface MutableGc07Record {
  decisionHash: string;
  precedenceTrace: MutablePrecedenceStep[];
}

function hashValidGc07Mutation(
  mutate: (record: MutableGc07Record) => void,
): MutableGc07Record {
  const record = structuredClone(
    prohibitedRecordFixture,
  ) as MutableGc07Record;
  mutate(record);
  record.decisionHash = decisionHashFor(
    DecisionRecordSchema.parse(record),
  );
  return record;
}

describe("golden-cases fence", () => {
  it("enforces: every golden case is complete, aligned, consistent, and signoff-gated", () => {
    const problems = validateGoldenCases(realCases, realRefs, realDoc, realScope);
    expect(problems, `golden-case problems:\n${problems.join("\n")}`).toEqual([]);
  });

  it("enforces: the truth set covers all twelve spec-enumerated cases with at least twelve fixtures", () => {
    expect(realCases.length).toBeGreaterThanOrEqual(12);
    expect(REQUIRED_SPEC_NAMES.length).toBe(12);
  });

  it("enforces: the canonical GC-07 record exactly mirrors its golden prohibition", () => {
    expect(
      gc07MirrorProblems(goldenGc07, prohibitedRecordFixture),
    ).toEqual([]);
  });

  it("enforces: the GC-01 execution command hashes a source-bound secure payload", () => {
    expect(
      executionPayloadByteProblems(
        executionPayloadFixture,
        executionPayloadFixtureBytes,
      ),
    ).toEqual([]);
    expect(
      executionPayloadProblems(
        proceedRecordFixture,
        executionPayloadFixture,
      ),
    ).toEqual([]);
  });
});

describe("detects (companion): an incomplete, drifted, or prematurely signed case CANNOT pass", () => {
  // Real fixtures as the base so the companion exercises the same shape CI sees.
  const clone = (): LoadedCase[] => JSON.parse(JSON.stringify(realCases)) as LoadedCase[];
  const caseById = (cases: LoadedCase[], id: string): Record<string, unknown> => {
    const found = cases.find((c) => (c.data as Record<string, unknown>).caseId === id);
    if (!found) throw new Error(`fixture ${id} missing`);
    return found.data as Record<string, unknown>;
  };
  const run = (cases: LoadedCase[], doc = realDoc) =>
    validateGoldenCases(cases, realRefs, doc, realScope);

  it("flags a missing required field (expectedDisposition removed)", () => {
    const cases = clone();
    delete caseById(cases, "GC-01-firm-a-happy-path").expectedDisposition;
    expect(run(cases).some((p) => p.includes("GC-01") && p.includes("expectedDisposition"))).toBe(true);
  });

  it("flags a present-but-unpopulated field (empty explanation nodes, blank trigger description)", () => {
    const cases = clone();
    caseById(cases, "GC-02-firm-b-happy-path").expectedExplanationNodes = [];
    (caseById(cases, "GC-03-recent-bank-change-firm-a").trigger as Record<string, unknown>).description = "  ";
    const problems = run(cases);
    expect(problems.some((p) => p.includes("GC-02") && p.includes("expectedExplanationNodes"))).toBe(true);
    expect(problems.some((p) => p.includes("GC-03") && p.includes("trigger.description"))).toBe(true);
  });

  it("flags an AGENT-SIGNED case: signed without attribution, and a status outside the two legal shapes", () => {
    const cases = clone();
    const signoff = caseById(cases, "GC-01-firm-a-happy-path").signoff as Record<string, unknown>;
    signoff.status = "signed"; // with attribution stripped below - the dishonest middle
    signoff.signedBy = null;
    signoff.signedAt = null;
    const problems = run(cases);
    expect(problems.some((p) => p.includes("signoff.signedBy must name the signer"))).toBe(true);

    const cases2 = clone();
    (caseById(cases2, "GC-02-firm-b-happy-path").signoff as Record<string, unknown>).status = "approved-by-agent";
    expect(run(cases2).some((p) => p.includes('signoff.status must be "pending-captain" or "signed"'))).toBe(true);
  });

  it("flags vocabulary drift: unknown firm, scenario, disposition, provenance, and ledger type", () => {
    const cases = clone();
    const c = caseById(cases, "GC-01-firm-a-happy-path");
    c.firm = "firm-c";
    c.scenarioRef = "a-branch-nobody-pinned";
    c.expectedDisposition = "vetoed";
    c.provenance = "totally-real-data";
    (c.expectedLedgerEvents as Array<Record<string, unknown>>)[0]!.type = "SomethingHappened";
    const problems = run(cases);
    expect(problems.some((p) => p.includes("firm must be a scenarios.yaml firm id"))).toBe(true);
    expect(problems.some((p) => p.includes("scenarioRef must be null or a scenarios.yaml scenario id"))).toBe(true);
    expect(problems.some((p) => p.includes("expectedDisposition must be one of proceed|blocked|prohibited"))).toBe(true);
    expect(problems.some((p) => p.includes("provenance must be a scenarios.yaml provenance label"))).toBe(true);
    expect(problems.some((p) => p.includes("must be a v3 LedgerEntry type"))).toBe(true);
  });

  it("flags an execution state outside the pinned vocabulary even when scenarios.yaml appends it", () => {
    // The matrix's stability contract is append-only, so a later-appended state
    // (e.g. the deliberately-excluded 'rejected') must still be refused by the
    // EXECUTION_STATES pin - the yaml alone cannot widen the golden vocabulary.
    const widened: ScenarioRefs = { ...realRefs, executionStates: new Set([...realRefs.executionStates, "rejected"]) };
    const cases = clone();
    (caseById(cases, "GC-01-firm-a-happy-path").expectedVerificationState as Record<string, unknown>).observedStatus = "rejected";
    const problems = validateGoldenCases(cases, widened, realDoc, realScope);
    expect(problems.some((p) => p.includes("observedStatus must be one of submitted|in-flight|completed|nigo|unknown"))).toBe(true);

    // And the reverse: a pinned state the live matrix no longer defines fails too.
    const narrowed: ScenarioRefs = { ...realRefs, executionStates: new Set([...realRefs.executionStates].filter((s) => s !== "submitted")) };
    const drifted = validateGoldenCases(clone(), narrowed, realDoc, realScope);
    expect(drifted.some((p) => p.includes('observedStatus "submitted" is not a scenarios.yaml execution-class state'))).toBe(true);
  });

  it("flags structural contradictions: a blocked case carrying authority/execution, a proceed case with none", () => {
    const cases = clone();
    const blocked = caseById(cases, "GC-04-recent-bank-change-firm-b");
    (blocked.expectedAuthority as Record<string, unknown>).mode = "approval";
    (blocked.expectedExecutionEligibility as Record<string, unknown>).eligible = true;
    (blocked.expectedVerificationState as Record<string, unknown>).reached = true;
    const problems = run(cases);
    expect(problems.some((p) => p.includes("a blocked decision carries no authority"))).toBe(true);
    expect(problems.some((p) => p.includes("a blocked decision is not execution-eligible"))).toBe(true);
    expect(problems.some((p) => p.includes("a blocked decision never reaches execution"))).toBe(true);

    const cases2 = clone();
    (caseById(cases2, "GC-01-firm-a-happy-path").expectedAuthority as Record<string, unknown>).mode = "none";
    expect(run(cases2).some((p) => p.includes('a proceed decision must state an authority mode other than "none"'))).toBe(true);
  });

  it("flags a partial-Salesforce case that dropped its deferred-pending-sandbox marking", () => {
    const cases = clone();
    caseById(cases, "GC-13-partial-salesforce-success").deferred = null;
    expect(run(cases).some((p) => p.includes("partial-Salesforce case must carry"))).toBe(true);
  });

  it("flags doc/fixture drift and a dropped spec-required case", () => {
    const cases = clone();
    expect(run(cases, realDoc.replaceAll("GC-05-insufficient-liquidity", "GC-05-renamed")).some((p) => p.includes("not referenced anywhere in docs/golden-cases.md"))).toBe(true);

    const fewer = clone().filter((c) => (c.data as Record<string, unknown>).caseId !== "GC-09-stale-evidence");
    expect(run(fewer).some((p) => p.includes('required spec case "stale evidence" is not covered'))).toBe(true);
  });

  it("flags a doc-only reference: a deleted fixture whose doc rows remain CANNOT pass", () => {
    // GC-15's spec name is not in REQUIRED_SPEC_NAMES and 15 cases still satisfy
    // the >=12 floor, so only the doc->fixture direction can catch this deletion.
    const fewer = clone().filter((c) => (c.data as Record<string, unknown>).caseId !== "GC-15-approval-invalidation");
    expect(
      run(fewer).some((p) => p.includes('references case id "GC-15-approval-invalidation"') && p.includes("no such fixture")),
    ).toBe(true);
  });

  it("flags a truth set below twelve cases and a duplicated caseId", () => {
    const four = clone().slice(0, 4);
    expect(run(four).some((p) => p.includes("the spec requires at least twelve"))).toBe(true);

    const doubled = clone();
    doubled.push({ rel: doubled[0]!.rel, data: JSON.parse(JSON.stringify(doubled[0]!.data)) as unknown });
    expect(run(doubled).some((p) => p.includes("duplicate caseId"))).toBe(true);
  });

  it("flags recorded-silence abuse: empty household instructions WITHOUT the recorded note", () => {
    const cases = clone();
    const c = caseById(cases, "GC-08-ambiguous-household");
    delete c.householdInstructionsNote;
    const problems = run(cases);
    expect(problems.some((p) => p.includes("householdInstructions is empty with no householdInstructionsNote"))).toBe(true);
    expect(problems.some((p) => p.includes("householdInstructionVersionIds is empty with no householdInstructionsNote"))).toBe(true);
  });

  it("flags stale-vocabulary injection via the refs themselves (a gutted scenarios.yaml cannot pass vacuously)", () => {
    const gutted = loadScenarioRefs("contract:\n  id: verin-demo-contract\n");
    const problems = validateGoldenCases(realCases, gutted, realDoc, realScope);
    expect(problems.some((p) => p.includes("firm must be a scenarios.yaml firm id"))).toBe(true);
  });

  it("accepts the real, honest truth set (cannot pass by always-failing)", () => {
    expect(validateGoldenCases(realCases, realRefs, realDoc, realScope)).toEqual([]);
  });

  it("flags amended bytes with no amendment block, and an amendment whose hashes do not describe them", () => {
    // The renamed subjectRef is real amended content: strip the amendment block and
    // the signed-status claim now covers bytes the captain never saw.
    const stripped = clone();
    delete caseById(stripped, "GC-09-stale-evidence").amendment;
    expect(
      run(stripped).some(
        (p) =>
          p.includes("GC-09") &&
          p.includes("differs from the captain-signed scope") &&
          p.includes("no amendment block"),
      ),
    ).toBe(true);

    // A stale amendment (describing bytes that no longer exist) cannot pass either.
    const stale = clone();
    const staleCase = caseById(stale, "GC-09-stale-evidence");
    (staleCase.trigger as Record<string, unknown>).requestRef = "req:GC-09-changed";
    expect(
      run(stale).some((p) =>
        p.includes("amendment.amendedContentHash must equal the CURRENT content hash"),
      ),
    ).toBe(true);

    // A forged signed-scope hash is refused against the ledger.
    const forged = clone();
    (caseById(forged, "GC-09-stale-evidence").amendment as Record<string, unknown>).signedContentHash =
      "0".repeat(64);
    expect(
      run(forged).some((p) => p.includes("amendment.signedContentHash must equal the ledger")),
    ).toBe(true);

    // An amendment that claims anything other than awaiting-countersignature fails.
    const promoted = clone();
    (caseById(promoted, "GC-09-stale-evidence").amendment as Record<string, unknown>).status =
      "signed";
    expect(run(promoted).some((p) => p.includes("amendment.status must be"))).toBe(true);

    // And an incomplete amendment - no ruling, no stated change - fails.
    const thin = clone();
    const thinAmendment = caseById(thin, "GC-09-stale-evidence").amendment as Record<string, unknown>;
    delete thinAmendment.ruling;
    thinAmendment.changes = [];
    const thinProblems = run(thin);
    expect(thinProblems.some((p) => p.includes("amendment.ruling must name"))).toBe(true);
    expect(thinProblems.some((p) => p.includes("amendment.changes must state"))).toBe(true);
  });

  it("flags an amendment block on unamended content, and a case missing from the signed-scope ledger", () => {
    const unamended = clone();
    const gc08 = caseById(unamended, "GC-08-ambiguous-household");
    gc08.amendment = {
      status: AMENDMENT_AWAITING,
      amendedAt: "2026-08-05",
      ruling: "none",
      changes: ["nothing actually changed"],
      signedContentHash: realScope["GC-08-ambiguous-household"],
      amendedContentHash: goldenContentHash(gc08),
    };
    expect(
      run(unamended).some((p) => p.includes("nothing was amended")),
    ).toBe(true);

    const noLedger = validateGoldenCases(clone(), realRefs, realDoc, {});
    expect(noLedger.some((p) => p.includes("no signed-scope entry for"))).toBe(true);
  });

  it("accepts a properly attributed captain signature (the future signing PR stays green)", () => {
    const cases = clone();
    const signoff = caseById(cases, "GC-01-firm-a-happy-path").signoff as Record<string, unknown>;
    signoff.status = "signed";
    signoff.signedBy = "captain";
    signoff.signedAt = "2026-08-01T09:00:00-04:00";
    expect(run(cases)).toEqual([]);
  });

  it("sanity: the fixtures live where the loader looks (join is real, not mocked)", () => {
    expect(realCases.length).toBeGreaterThan(0);
    expect(realCases[0]!.rel.startsWith("fixtures/golden/")).toBe(true);
    expect(readFileSync(join(REPO_ROOT, realCases[0]!.rel), "utf8").length).toBeGreaterThan(0);
  });

  it("flags a hash-valid GC-07 record that drifts from the golden prohibition", () => {
    const mutated = structuredClone(
      prohibitedRecordFixture,
    ) as {
      decisionHash: string;
      result: {
        prohibition: {
          scopeRef: { id: string };
          explanation: string;
        };
      };
    };
    mutated.result.prohibition.scopeRef.id =
      "scope:account:subject:smiths-joint-taxable";
    mutated.result.prohibition.explanation =
      "A different prohibition explanation.";
    mutated.decisionHash = decisionHashFor(
      DecisionRecordSchema.parse(mutated),
    );
    const problems = gc07MirrorProblems(goldenGc07, mutated);
    expect(
      problems.some((problem) => problem.includes("scope")),
    ).toBe(true);
    expect(
      problems.some((problem) =>
        problem.includes("explanation"),
      ),
    ).toBe(true);
    expect(
      problems.some((problem) =>
        problem.includes("decisionHash"),
      ),
    ).toBe(false);
  });

  it("flags every hash-valid GC-07 precedence drift, including a missing household row", () => {
    const mutations: Array<
      (record: MutableGc07Record) => void
    > = [
      (record) => {
        record.precedenceTrace.reverse();
      },
      (record) => {
        record.precedenceTrace[0]!.resolution = "right_wins";
      },
      (record) => {
        record.precedenceTrace[0]!.reasonCode =
          "changed-precedence-reason";
      },
      (record) => {
        record.precedenceTrace[0]!.left.sourceType =
          "firm_policy";
      },
      (record) => {
        record.precedenceTrace[0]!.left.sourceRef.id =
          "different-regulatory-source";
      },
      (record) => {
        record.precedenceTrace[0]!.left.versionRef.id =
          "different-regulatory-version";
      },
      (record) => {
        record.precedenceTrace[1]!.right.sourceType =
          "firm_policy";
      },
      (record) => {
        record.precedenceTrace[1]!.right.sourceRef.id =
          "different-household-source";
      },
      (record) => {
        record.precedenceTrace[1]!.right.versionRef.id =
          "different-household-version";
      },
      (record) => {
        record.precedenceTrace.push(
          structuredClone(record.precedenceTrace[0]!),
        );
      },
      (record) => {
        record.precedenceTrace.pop();
      },
    ];
    for (const mutate of mutations) {
      const problems = gc07MirrorProblems(
        goldenGc07,
        hashValidGc07Mutation(mutate),
      );
      expect(
        problems.some((problem) =>
          problem.includes("precedence trace"),
        ),
      ).toBe(true);
      expect(
        problems.some((problem) =>
          problem.includes("decisionHash"),
        ),
      ).toBe(false);
    }
  });

  it("flags a hash-valid execution command whose secure payload names the wrong source", () => {
    const payload = structuredClone(executionPayloadFixture);
    payload.sourceSubjectRef.id =
      "subject:smiths-joint-taxable";
    const record = structuredClone(proceedRecordFixture) as {
      decisionHash: string;
      result: {
        executionPlan: {
          steps: Array<{
            command: { payloadHash: string };
          }>;
        };
      };
    };
    record.result.executionPlan.steps[0]!.command.payloadHash =
      executionPayloadHash(payload);
    record.decisionHash = decisionHashFor(
      DecisionRecordSchema.parse(record),
    );
    const problems = executionPayloadProblems(record, payload);
    expect(
      problems.some((problem) =>
        problem.includes("source must be Smith Family Taxable"),
      ),
    ).toBe(true);
    expect(
      problems.some((problem) =>
        problem.includes("source must equal the recommendation"),
      ),
    ).toBe(true);
    expect(
      problems.some((problem) =>
        problem.includes("payloadHash"),
      ),
    ).toBe(false);
    expect(
      problems.some((problem) =>
        problem.includes("decisionHash"),
      ),
    ).toBe(false);
  });

  it("flags noncanonical secure payload bytes without changing their parsed value", () => {
    expect(
      executionPayloadByteProblems(
        executionPayloadFixture,
        `${JSON.stringify(executionPayloadFixture, null, 2)}\n`,
      ),
    ).toEqual([
      "GC-01 secure execution payload must be committed in canonical byte form",
    ]);
  });
});
