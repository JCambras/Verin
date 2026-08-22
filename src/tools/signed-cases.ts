// The typed signed-case INPUTS reader (prompt 5; PR-6-pre closes CD-4c's direct-input intent). It reads the oracle's signed bytes at the PINNED head through git, verifies each blob
// against enforcement/signed-truth-pins.json BEFORE a single byte is parsed (refusing on mismatch
// naming both digests), and produces typed DecisionInputs: trigger, firm configuration, household
// evidence and instructions. It reads NO answer-key field: the schema below names only input-side
// keys, and the answer-key reader is the SEPARATE module src/tools/signed-expectations.ts, which
// the decision module's closure structurally excludes. Every formerly prose-derived value now comes
// directly from the signed typedQuantities table. Summary prose is not admitted by this schema.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { PURPOSES } from "../decision/outcome";
import type { DecisionIdentities, DecisionInput, DecisionRequest, Purpose } from "../decision/outcome";
import type { EvidenceBundle, EvidenceObservation } from "../evidence/bundle";
import { KIND_PII_CLASS, OBSERVATION_KINDS, freshnessBand, type ObservationKind } from "../evidence/vocabulary";
import { formatObservationDate } from "../evidence/projection";
import { parseFirmPolicy } from "../policy/registry";

// prettier-ignore
const SCOPE = [
  "GC-01-firm-a-happy-path", "GC-02-firm-b-happy-path", "GC-03-recent-bank-change-firm-a", "GC-04-recent-bank-change-firm-b",
  "GC-05-insufficient-liquidity", "GC-06-household-restriction", "GC-07-regulatory-prohibition", "GC-08-ambiguous-household",
  "GC-09-stale-evidence", "GC-10-simultaneous-distributions-first", "GC-11-simultaneous-distributions-second", "GC-12-duplicate-retry",
  "GC-13-partial-salesforce-success", "GC-14-delayed-nigo", "GC-15-approval-invalidation", "GC-16-specialist-review-expiration",
] as const;
const PINS_PATH = "enforcement/signed-truth-pins.json";
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function readSignedBytes(path: string): Buffer {
  const pins = JSON.parse(readFileSync(PINS_PATH, "utf8")) as { oracleHead: string; pins: Record<string, string> };
  const pinned = pins.pins[path];
  if (!pinned) throw new Error(`${path} has no signed-truth pin; an unpinned oracle path is never parsed`);
  const bytes = execFileSync("git", ["cat-file", "blob", `${pins.oracleHead}:${path}`], { maxBuffer: 1 << 24 });
  const read = sha256(bytes);
  if (read !== pinned) throw new Error(`refusing to parse ${path}: signed truth changed before parsing (pinned sha256 ${pinned}, read ${read})`);
  return bytes;
}

// Input-side fields ONLY. zod strips unknown keys, so the answer-key sections never enter this
// module's values; the M-A battery greps this path for answer-key reads and asserts zero.
const evidenceRow = z.object({ evidenceKind: z.string(), subjectRef: z.string(), observedAt: z.string(), retrievedAt: z.string(), source: z.string() });
// The CD-4c amendment's signed input table. fromAssertedParse records historical derivation metadata;
// it is never executed. The typed value is the sole authority used to construct DecisionInput.
const typedQuantityRow = z.object({ ref: z.string(), field: z.string(), value: z.union([z.number(), z.string(), z.boolean()]), fromAssertedParse: z.string().min(1) });
export type TypedQuantity = z.infer<typeof typedQuantityRow>;
const fixtureInputs = z.object({
  typedQuantities: z.array(typedQuantityRow).default([]),
  caseId: z.string(),
  firm: z.string(),
  trigger: z.object({ kind: z.string(), requesterRole: z.string(), requestRef: z.string(), asOf: z.string() }),
  firmConfiguration: z.object({
    firmId: z.string(),
    cashReserveMonths: z.number().int(),
    dualApprovalThresholdUsd: z.number().int(),
    approvalsRequired: z.number().int(),
    distinctActorsRequired: z.boolean(),
    eligibleRole: z.string().nullable(),
    requesterConstraint: z.string().nullable(),
    bankInstructionChangeHandling: z.string(),
  }),
  householdEvidence: z.array(evidenceRow),
  policyVersions: z.object({ domainConfigVersionId: z.string(), firmPolicyVersionId: z.string(), householdInstructionVersionIds: z.array(z.string()), regulatoryVersionId: z.string().nullable() }),
});
type FixtureInputs = z.infer<typeof fixtureInputs>;

type QuantityValue = TypedQuantity["value"];
const quantityKey = (ref: string, field: string) => `${ref}\u0000${field}`;
const quantityName = (caseId: string, ref: string, field: string) => `${caseId} ${ref}.${field}`;

export function createSignedQuantityReader(caseId: string, rows: readonly TypedQuantity[]) {
  const byKey = new Map<string, TypedQuantity[]>();
  for (const row of rows) byKey.set(quantityKey(row.ref, row.field), [...(byKey.get(quantityKey(row.ref, row.field)) ?? []), row]);
  for (const group of byKey.values())
    if (group.length !== 1) throw new Error(`ambiguous signed typed quantity ${quantityName(caseId, group[0].ref, group[0].field)}: found ${group.length} rows; failing closed`);
  const consumed = new Set<string>();
  const take = (ref: string, field: string, required: boolean): QuantityValue | undefined => {
    const key = quantityKey(ref, field),
      row = byKey.get(key)?.[0];
    if (!row) {
      if (required) throw new Error(`missing signed typed quantity ${quantityName(caseId, ref, field)}; failing closed`);
      return undefined;
    }
    consumed.add(key);
    return row.value;
  };
  const typed = <T extends "string" | "number" | "boolean">(ref: string, field: string, kind: T, required: boolean): QuantityValue | undefined => {
    const value = take(ref, field, required);
    if (value !== undefined && typeof value !== kind) throw new Error(`invalid signed typed quantity ${quantityName(caseId, ref, field)}: expected ${kind}, received ${typeof value}; failing closed`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`invalid signed typed quantity ${quantityName(caseId, ref, field)}: number is not finite; failing closed`);
    return value;
  };
  return {
    scalar: (ref: string, field: string) => take(ref, field, true)!,
    string: (ref: string, field: string) => typed(ref, field, "string", true) as string,
    optionalString: (ref: string, field: string) => typed(ref, field, "string", false) as string | undefined,
    number: (ref: string, field: string) => typed(ref, field, "number", true) as number,
    optionalNumber: (ref: string, field: string) => typed(ref, field, "number", false) as number | undefined,
    boolean: (ref: string, field: string) => typed(ref, field, "boolean", true) as boolean,
    optionalBoolean: (ref: string, field: string) => typed(ref, field, "boolean", false) as boolean | undefined,
    finish() {
      const unused = [...byKey.entries()]
        .filter(([key]) => !consumed.has(key))
        .map(([, row]) => `${row[0].ref}.${row[0].field}`)
        .sort();
      if (unused.length) throw new Error(`unconsumed signed typed quantities for ${caseId}: ${unused.join(", ")}; failing closed`);
      return rows.length;
    },
  };
}
type QuantityReader = ReturnType<typeof createSignedQuantityReader>;
const atMostOne = (caseId: string, ref: string, fields: string[], values: unknown[]) => {
  const present = values.filter((value) => value !== undefined).length;
  if (present > 1) throw new Error(`ambiguous signed typed quantities ${caseId} ${ref}.${fields.join(" and ")}; failing closed`);
};
const integer = (caseId: string, ref: string, field: string, value: number) => {
  if (!Number.isInteger(value)) throw new Error(`invalid signed typed quantity ${quantityName(caseId, ref, field)}: expected integer; failing closed`);
  return value;
};

function parseRequest(f: FixtureInputs, q: QuantityReader): DecisionRequest {
  const amountUsd = integer(f.caseId, "trigger", "amountUsd", q.number("trigger", "amountUsd"));
  const householdSlug = q.string("trigger", "householdSlug");
  const directPurpose = q.optionalString("trigger", "purpose"),
    directDeadline = q.optionalString("trigger", "deadline"),
    canonical = q.optionalString("trigger", "canonical-request");
  let canonicalPurpose: string | undefined, canonicalDeadline: string | undefined;
  if (canonical !== undefined) {
    const parts = canonical.split("|");
    if (parts.length !== 2 || parts.some((part) => part.length === 0))
      throw new Error(`invalid signed typed quantity ${quantityName(f.caseId, "trigger", "canonical-request")}: expected purpose|deadline; failing closed`);
    [canonicalPurpose, canonicalDeadline] = parts;
  }
  if (directPurpose !== undefined && canonicalPurpose !== undefined && directPurpose !== canonicalPurpose)
    throw new Error(`ambiguous signed typed quantities ${f.caseId} trigger.purpose and trigger.canonical-request disagree; failing closed`);
  if (directDeadline !== undefined && canonicalDeadline !== undefined && directDeadline !== canonicalDeadline)
    throw new Error(`ambiguous signed typed quantities ${f.caseId} trigger.deadline and trigger.canonical-request disagree; failing closed`);
  const purposeValue = directPurpose ?? canonicalPurpose;
  if (purposeValue === undefined) throw new Error(`missing signed typed quantity ${f.caseId} trigger.purpose or trigger.canonical-request; failing closed`);
  if (!(PURPOSES as readonly string[]).includes(purposeValue))
    throw new Error(`invalid signed typed quantity ${f.caseId} trigger.purpose: '${purposeValue}' is outside the closed purpose vocabulary; failing closed`);
  const deadline = directDeadline ?? canonicalDeadline;
  return { requestRef: f.trigger.requestRef, householdSlug, amountUsd, purpose: purposeValue as Purpose, ...(deadline !== undefined ? { deadline } : {}) };
}

function bodyFor(f: FixtureInputs, row: z.infer<typeof evidenceRow>, q: QuantityReader): { kind: ObservationKind; body: Record<string, string> } {
  const ref = row.subjectRef;
  switch (row.evidenceKind) {
    case "account-balance": {
      const body: Record<string, string> = {};
      const available = q.optionalNumber(ref, "AvailableUsd"),
        sufficiency = q.optionalString(ref, "Sufficiency");
      if (available !== undefined) body["AvailableUsd"] = String(integer(f.caseId, ref, "AvailableUsd", available));
      if (sufficiency !== undefined) body["Sufficiency"] = sufficiency;
      const registration = q.string(ref, "RegistrationClass");
      if (registration !== "taxable" && registration !== "retirement")
        throw new Error(`invalid signed typed quantity ${quantityName(f.caseId, ref, "RegistrationClass")}: '${registration}' is not taxable or retirement; failing closed`);
      body["RegistrationClass"] = registration;
      return { kind: "account-balance", body };
    }
    case "planned-withdrawals": {
      const body: Record<string, string> = {};
      const monthly = q.optionalNumber(ref, "MonthlyUsd"),
        total = q.optionalNumber(ref, "MonthlyUsd(total/months)"),
        sufficiency = q.optionalString(ref, "Sufficiency");
      atMostOne(f.caseId, ref, ["MonthlyUsd", "MonthlyUsd(total/months)", "Sufficiency"], [monthly, total, sufficiency]);
      if (monthly !== undefined) body["MonthlyUsd"] = String(integer(f.caseId, ref, "MonthlyUsd", monthly));
      if (total !== undefined) {
        const whole = integer(f.caseId, ref, "MonthlyUsd(total/months)", total),
          months = f.firmConfiguration.cashReserveMonths;
        if (whole % months !== 0) throw new Error(`${f.caseId}: signed reserve total ${whole} does not divide by ${months} months; failing closed`);
        body["MonthlyUsd"] = String(whole / months);
      }
      if (sufficiency !== undefined) body["Sufficiency"] = sufficiency;
      return { kind: "planned-withdrawals", body };
    }
    case "bank-instruction": {
      const body: Record<string, string> = {};
      const changed = q.optionalString(ref, "ChangedAt"),
        verified = q.optionalBoolean(ref, "Verified"),
        unchanged = q.optionalBoolean(ref, "Unchanged"),
        titledTo = q.optionalString(ref, "TitledTo");
      if ([changed, verified, unchanged, titledTo].every((value) => value === undefined))
        throw new Error(`missing signed typed quantity ${f.caseId} ${ref}.ChangedAt, Verified, Unchanged or TitledTo; failing closed`);
      if (changed !== undefined) body["ChangedAt"] = formatObservationDate(changed);
      if (verified !== undefined) body["Verified"] = String(verified);
      if (unchanged !== undefined) body["Unchanged"] = String(unchanged);
      if (titledTo !== undefined) body["TitledTo"] = titledTo;
      return { kind: "bank-instruction", body };
    }
    case "household-instruction": {
      const body: Record<string, string> = { InstructionKind: "destination-restriction" };
      const version = f.policyVersions.householdInstructionVersionIds.find((v) => v.includes("destination-restriction"));
      if (version) body["VersionId"] = version;
      body["DestinationOnList"] = String(q.boolean(ref, "DestinationOnList"));
      return { kind: "household-instruction", body };
    }
    case "pending-actions": {
      const body: Record<string, string> = {};
      const pending = q.optionalNumber(ref, "PendingTotalUsd"),
        sibling = q.optionalNumber(ref, "SiblingReservationUsd"),
        siblingRef = q.optionalString(ref, "SiblingRef");
      if (pending !== undefined && (sibling !== undefined || siblingRef !== undefined))
        throw new Error(`ambiguous signed typed quantities ${f.caseId} ${ref}.PendingTotalUsd and sibling reservation; failing closed`);
      if (pending === undefined && sibling === undefined && siblingRef === undefined)
        throw new Error(`missing signed typed quantity ${f.caseId} ${ref}.PendingTotalUsd or sibling reservation; failing closed`);
      if ((sibling === undefined) !== (siblingRef === undefined))
        throw new Error(`missing signed typed quantity ${f.caseId} ${ref}.${sibling === undefined ? "SiblingReservationUsd" : "SiblingRef"}; failing closed`);
      if (pending !== undefined) body["PendingTotalUsd"] = String(integer(f.caseId, ref, "PendingTotalUsd", pending));
      if (sibling !== undefined) body["SiblingReservationUsd"] = String(integer(f.caseId, ref, "SiblingReservationUsd", sibling));
      if (siblingRef !== undefined) body["SiblingRef"] = siblingRef;
      return { kind: "pending-actions", body };
    }
    case "account-restriction": {
      const body: Record<string, string> = { ScopeRef: row.subjectRef, HoldActive: String(q.boolean(ref, "HoldActive")) };
      if (f.policyVersions.regulatoryVersionId) body["VersionId"] = f.policyVersions.regulatoryVersionId;
      return { kind: "regulatory-status", body };
    }
    case "household-directory": {
      const body: Record<string, string> = {};
      const raw = q.scalar(ref, "CandidateCount"),
        words: Record<string, string> = { two: "2", three: "3" };
      if (typeof raw !== "string" && typeof raw !== "number")
        throw new Error(`invalid signed typed quantity ${quantityName(f.caseId, ref, "CandidateCount")}: expected string or number; failing closed`);
      const count = words[String(raw)] ?? String(raw);
      if (!Number.isInteger(Number(count))) throw new Error(`invalid signed typed quantity ${quantityName(f.caseId, ref, "CandidateCount")}: '${raw}' is not a closed count; failing closed`);
      body["CandidateCount"] = count;
      return { kind: "household-directory", body };
    }
    default:
      throw new Error(`${f.caseId}: evidence kind '${row.evidenceKind}' has no recorded mapping; failing closed`);
  }
}

const hex32 = (seed: string) => sha256(seed).slice(0, 32);
function toInput(f: FixtureInputs, q: QuantityReader): DecisionInput {
  const asOf = new Date(f.trigger.asOf).toISOString();
  const observations: EvidenceObservation[] = f.householdEvidence.map((row, i) => {
    const { kind, body } = bodyFor(f, row, q);
    return {
      id: `o${hex32(`${f.caseId}|${i}|${row.subjectRef}`)}`,
      kind,
      subject: row.subjectRef,
      body,
      provenance: { source: row.source, observedAt: new Date(row.observedAt).toISOString(), retrievedAt: new Date(row.retrievedAt).toISOString() },
      freshness: freshnessBand(asOf, new Date(row.observedAt).toISOString()),
      pii: KIND_PII_CLASS[kind],
      origin: "synthetic-fixture",
    };
  });
  const seen = new Set(observations.map((o) => o.kind));
  const groups = new Map<string, EvidenceObservation[]>();
  for (const o of observations) groups.set(`${o.kind} ${o.subject}`, [...(groups.get(`${o.kind} ${o.subject}`) ?? []), o]);
  const bundle: EvidenceBundle = {
    version: "evb.v1",
    vocabulary: "1.1.0",
    subject: { household: `h${hex32("household|smiths")}` },
    asOf,
    source: "house-record-store",
    observations,
    absences: OBSERVATION_KINDS.filter((k) => !seen.has(k)).map((kind) => ({ kind, status: "not-observed", reason: "no-observation-in-house-records" })),
    conflicts: [...groups.values()]
      .filter((g) => new Set(g.map((o) => JSON.stringify(o.body))).size > 1)
      .map((g) => ({ kind: g[0].kind, subject: g[0].subject, observationIds: g.map((o) => o.id).sort() })),
  };
  const fc = f.firmConfiguration;
  const documentBytes = JSON.stringify({
    reserveHorizonMonths: fc.cashReserveMonths,
    dualApproval: {
      thresholdUsd: fc.dualApprovalThresholdUsd,
      approvalsRequired: fc.approvalsRequired,
      distinctActorsRequired: fc.distinctActorsRequired,
      eligibleApproverRole: fc.eligibleRole ?? "not-stated",
      requesterRule: fc.requesterConstraint ?? "not-stated",
    },
    bankInstructionChange: fc.bankInstructionChangeHandling,
    approvalStages: "not-stated",
    reservationWindowDays: "not-stated",
  });
  const identities: DecisionIdentities = { firm: `f${hex32(`firm|${f.firm}`)}`, household: `h${hex32("household|smiths")}`, requesterRole: `r${hex32(`role|${f.trigger.requesterRole}`)}` };
  return {
    request: parseRequest(f, q),
    evidenceBundle: bundle,
    policyDocument: { id: { version: "fpd.v1", digest: sha256(documentBytes) }, policy: parseFirmPolicy(new TextEncoder().encode(documentBytes)) },
    identities,
    asOf,
  };
}

export type SignedCaseInput = { caseId: string; input: DecisionInput; typedQuantityCount: number };
export function loadSignedCaseInput(caseId: string): SignedCaseInput {
  const bytes = readSignedBytes(`fixtures/golden/${caseId}.json`);
  const f = fixtureInputs.parse(JSON.parse(bytes.toString("utf8")));
  if (f.caseId !== caseId) throw new Error(`fixture ${caseId} names itself '${f.caseId}'; refusing`);
  const quantities = createSignedQuantityReader(caseId, f.typedQuantities);
  const input = toInput(f, quantities);
  return { caseId, input, typedQuantityCount: quantities.finish() };
}
export const loadSignedCaseInputs = (): SignedCaseInput[] => SCOPE.map(loadSignedCaseInput);
export { SCOPE as SIGNED_CASE_SCOPE, readSignedBytes };
