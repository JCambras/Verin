// The typed signed-case INPUTS reader (prompt 5, PR-5a-iii scope: the four canonical cases). It reads the oracle's signed bytes at the PINNED head through git, verifies each blob
// against enforcement/signed-truth-pins.json BEFORE a single byte is parsed (refusing on mismatch
// naming both digests), and produces typed DecisionInputs: trigger, firm configuration, household
// evidence and instructions. It reads NO answer-key field: the schema below names only input-side
// keys, and the answer-key reader is the SEPARATE module src/tools/signed-expectations.ts, which
// the decision module's closure structurally excludes. Load-bearing quantities live only in each
// fixture's summary prose until the CD-4c re-signature lands, so this reader parses prose with
// ASSERTED patterns that fail closed on ambiguity, and records every parse in its parse table.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { DecisionIdentities, DecisionInput, DecisionRequest, Purpose } from "../decision/outcome";
import type { EvidenceBundle, EvidenceObservation } from "../evidence/bundle";
import { KIND_PII_CLASS, OBSERVATION_KINDS, freshnessBand, type ObservationKind } from "../evidence/vocabulary";
import { formatObservationDate } from "../evidence/projection";
import { parseFirmPolicy } from "../policy/registry";

const SCOPE = ["GC-01-firm-a-happy-path", "GC-02-firm-b-happy-path", "GC-03-recent-bank-change-firm-a", "GC-04-recent-bank-change-firm-b"] as const;
const PINS_PATH = "enforcement/signed-truth-pins.json";
type ParseRecord = { caseId: string; ref: string; field: string; pattern: string; value: string };
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
const evidenceRow = z.object({ evidenceKind: z.string(), subjectRef: z.string(), observedAt: z.string(), retrievedAt: z.string(), summary: z.string(), source: z.string() });
const fixtureInputs = z.object({
  caseId: z.string(),
  firm: z.string(),
  trigger: z.object({ kind: z.string(), description: z.string(), requesterRole: z.string(), requestRef: z.string(), maskedRequestSummary: z.string(), asOf: z.string() }),
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
  householdInstructions: z.array(z.object({ instructionKind: z.string(), versionId: z.string(), summary: z.string() })),
});
type FixtureInputs = z.infer<typeof fixtureInputs>;

// The canonical distribution ask - the demo contract's one household story: several fixtures
// reference "the $75,000 request" without restating its purpose or deadline; the recorded mapping
// resolves that reference to these constants, parsed once from GC-01's own trigger prose.
const CANONICAL = { amountUsd: 75_000, purpose: "home-renovation" as Purpose, deadline: "2026-08-15" };
const one = (t: ParseRecord[], caseId: string, ref: string, field: string, text: string, re: RegExp): string | null => {
  const values = [...text.matchAll(new RegExp(re.source, "g"))].map((m) => m[1] ?? "true");
  if (new Set(values).size > 1) throw new Error(`ambiguous parse for ${caseId} ${field}: ${[...new Set(values)].join(" vs ")}; failing closed`);
  if (values.length === 0) return null;
  t.push({ caseId, ref, field, pattern: re.source, value: values[0] });
  return values[0];
};
const MONTH_WORDS: Record<string, string> = {
  January: "01",
  February: "02",
  March: "03",
  April: "04",
  May: "05",
  June: "06",
  July: "07",
  August: "08",
  September: "09",
  October: "10",
  November: "11",
  December: "12",
};

function parseRequest(f: FixtureInputs, t: ParseRecord[]): DecisionRequest {
  const masked = f.trigger.maskedRequestSummary;
  const desc = f.trigger.description;
  const amount = one(t, f.caseId, "trigger", "amountUsd", masked, /distribute (\d{1,7}) USD/);
  if (amount === null) throw new Error(`${f.caseId}: no asserted pattern reads the request amount; failing closed`);
  const canonicalRef = /the (identical )?\$75,000 request/.test(desc);
  if (/[Tt]he Smiths/.test(desc)) t.push({ caseId: f.caseId, ref: "trigger", field: "householdSlug", pattern: "the Smiths -> smiths", value: "smiths" });
  else if (canonicalRef) t.push({ caseId: f.caseId, ref: "trigger", field: "householdSlug", pattern: "canonical-request reference -> smiths", value: "smiths" });
  else throw new Error(`${f.caseId}: the household name did not parse; failing closed`);
  let purpose = one(t, f.caseId, "trigger", "purpose", masked, /for ([a-z][a-z-]*)/) as Purpose | null;
  const deadlineWords = /by ([A-Z][a-z]+) (\d{1,2})\b|on ([A-Z][a-z]+) (\d{1,2})\b/.exec(desc);
  let deadline: string | undefined;
  if (deadlineWords) {
    const [month, day] = deadlineWords[1] !== undefined ? [deadlineWords[1], deadlineWords[2]] : [deadlineWords[3], deadlineWords[4]];
    if (!MONTH_WORDS[month]) throw new Error(`${f.caseId}: deadline month '${month}' did not parse; failing closed`);
    deadline = `${f.trigger.asOf.slice(0, 4)}-${MONTH_WORDS[month]}-${day.padStart(2, "0")}`;
    t.push({ caseId: f.caseId, ref: "trigger", field: "deadline", pattern: "by/on <Month> <day>, year from asOf", value: deadline });
  }
  if ((purpose === null || deadline === undefined) && canonicalRef) {
    purpose = purpose ?? CANONICAL.purpose;
    deadline = deadline ?? CANONICAL.deadline;
    t.push({ caseId: f.caseId, ref: "trigger", field: "canonical-request", pattern: "the $75,000 request -> canonical purpose/deadline", value: `${purpose}|${deadline}` });
  }
  if (purpose === null) throw new Error(`${f.caseId}: no asserted pattern reads the purpose; failing closed`);
  return { requestRef: f.trigger.requestRef, householdSlug: "smiths", amountUsd: Number(amount), purpose, ...(deadline !== undefined ? { deadline } : {}) };
}

const ATTESTED =
  /reserve \(?\d{1,7} USD\)? (?:remains satisfied|preserved)|reserve preserved|[Ll]iquidity is sufficient|[Ll]iquidity comfortably covers|[Bb]alance covers the request|[Ll]iquidity and reserve satisfied|evaluation is clean|[Ll]iquidity satisfied/;
function bodyFor(f: FixtureInputs, row: z.infer<typeof evidenceRow>, t: ParseRecord[]): { kind: ObservationKind; body: Record<string, string> } {
  const s = row.summary;
  const put = (field: string, pattern: string, value: string, body: Record<string, string>) => {
    body[field] = value;
    t.push({ caseId: f.caseId, ref: row.subjectRef, field, pattern, value });
  };
  switch (row.evidenceKind) {
    case "account-balance": {
      const body: Record<string, string> = {};
      const available = one(t, f.caseId, row.subjectRef, "AvailableUsd", s, /(?:available balance|[Bb]alance) (\d{1,7}) USD/);
      if (available !== null) body["AvailableUsd"] = available;
      else if (ATTESTED.test(s)) put("Sufficiency", "attestation phrase", "attested-sufficient", body);
      // The subject ref dominates and retirement wording is checked before the word taxable,
      // because "a distribution here is a taxable event" is exactly how a fixture describes an IRA.
      if (/-ira\b/.test(row.subjectRef) || /\bIRA\b|retirement/.test(s)) put("RegistrationClass", "subjectRef/summary names an IRA or retirement account", "retirement", body);
      else if (/-taxable\b/.test(row.subjectRef) || /taxable/i.test(s)) put("RegistrationClass", "subjectRef/summary names taxable", "taxable", body);
      return { kind: "account-balance", body };
    }
    case "planned-withdrawals": {
      const body: Record<string, string> = {};
      const monthly = one(t, f.caseId, row.subjectRef, "MonthlyUsd", s, /withdrawals (\d{1,7}) USD\/month/);
      if (monthly !== null) body["MonthlyUsd"] = monthly;
      else {
        const total = one(t, f.caseId, row.subjectRef, "MonthlyUsd(total/months)", s, /reserve \(?=? ?(\d{1,7}) USD\)?/);
        if (total !== null) {
          const months = f.firmConfiguration.cashReserveMonths;
          if (Number(total) % months !== 0) throw new Error(`${f.caseId}: reserve total ${total} does not divide by ${months} months; failing closed on ambiguity`);
          body["MonthlyUsd"] = String(Number(total) / months);
        } else if (ATTESTED.test(s)) put("Sufficiency", "attestation phrase", "attested-sufficient", body);
      }
      return { kind: "planned-withdrawals", body };
    }
    case "bank-instruction": {
      const body: Record<string, string> = {};
      const changed = one(t, f.caseId, row.subjectRef, "ChangedAt", s, /(?:changed(?: on)?|unchanged since) (\d{4}-\d{2}-\d{2})/);
      if (changed !== null) body["ChangedAt"] = formatObservationDate(changed); // worded, never a bare hyphenated date (the checker's reference form)
      if (/not yet independently verified|not been independently verified/.test(s)) put("Verified", "negative verification phrase", "false", body);
      else if (/independently verified|verified on file|verified and unchanged/.test(s)) put("Verified", "verification phrase", "true", body);
      if (/unchanged since/.test(s)) put("Unchanged", "unchanged-since phrase", "true", body);
      if (/third-party business account|not titled to the household/.test(s)) put("TitledTo", "third-party phrase", "third-party", body);
      else if (/household-titled/.test(s)) put("TitledTo", "household-titled phrase", "household", body);
      return { kind: "bank-instruction", body };
    }
    case "household-instruction": {
      const body: Record<string, string> = { InstructionKind: "destination-restriction" };
      const version = f.policyVersions.householdInstructionVersionIds.find((v) => v.includes("destination-restriction"));
      if (version) body["VersionId"] = version;
      if (/on-list|permits/.test(s)) put("DestinationOnList", "on-list phrase", "true", body);
      else if (/off-list/.test(s)) put("DestinationOnList", "off-list phrase", "false", body);
      return { kind: "household-instruction", body };
    }
    case "pending-actions": {
      const body: Record<string, string> = {};
      if (/[Nn]o pending activity at first evaluation|no sibling reservation exists yet/.test(s))
        put("PendingTotalUsd", "no-pending-at-first-evaluation phrase (later postings are the execution tail)", "0", body);
      else {
        const sibling = one(t, f.caseId, row.subjectRef, "SiblingReservationUsd", s, /[Aa]ctive reservation (?:res:[A-Za-z0-9:-]+) \((\d{1,7}) USD/);
        if (sibling !== null) {
          body["SiblingReservationUsd"] = sibling;
          const ref = one(t, f.caseId, row.subjectRef, "SiblingRef", s, /[Aa]ctive reservation (res:[A-Za-z0-9:-]+)/);
          if (ref !== null) body["SiblingRef"] = ref;
        } else {
          const pending = one(t, f.caseId, row.subjectRef, "PendingTotalUsd", s, /[Pp]ending approved distribution of (\d{1,7}) USD/);
          if (pending === null) throw new Error(`${f.caseId}: no asserted pattern reads the pending activity; failing closed`);
          body["PendingTotalUsd"] = pending;
        }
      }
      return { kind: "pending-actions", body };
    }
    case "account-restriction": {
      const body: Record<string, string> = { ScopeRef: row.subjectRef };
      if (/[Aa]ctive legal hold/.test(s)) put("HoldActive", "active-legal-hold phrase", "true", body);
      if (f.policyVersions.regulatoryVersionId) body["VersionId"] = f.policyVersions.regulatoryVersionId;
      return { kind: "regulatory-status", body };
    }
    case "household-directory": {
      const body: Record<string, string> = {};
      const words: Record<string, string> = { two: "2", three: "3" };
      const n = one(t, f.caseId, row.subjectRef, "CandidateCount", s, /returns (two|three|\d) candidate/);
      if (n === null) throw new Error(`${f.caseId}: no asserted pattern reads the candidate count; failing closed`);
      body["CandidateCount"] = words[n] ?? n;
      return { kind: "household-directory", body };
    }
    default:
      throw new Error(`${f.caseId}: evidence kind '${row.evidenceKind}' has no recorded mapping; failing closed`);
  }
}

const hex32 = (seed: string) => sha256(seed).slice(0, 32);
function toInput(f: FixtureInputs, t: ParseRecord[]): DecisionInput {
  const asOf = new Date(f.trigger.asOf).toISOString();
  const observations: EvidenceObservation[] = f.householdEvidence.map((row, i) => {
    const { kind, body } = bodyFor(f, row, t);
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
    request: parseRequest(f, t),
    evidenceBundle: bundle,
    policyDocument: { id: { version: "fpd.v1", digest: sha256(documentBytes) }, policy: parseFirmPolicy(new TextEncoder().encode(documentBytes)) },
    identities,
    asOf,
  };
}

export type SignedCaseInput = { caseId: string; input: DecisionInput; parseTable: ParseRecord[] };
export function loadSignedCaseInputs(): SignedCaseInput[] {
  return SCOPE.map((caseId) => {
    const bytes = readSignedBytes(`fixtures/golden/${caseId}.json`);
    const f = fixtureInputs.parse(JSON.parse(bytes.toString("utf8")));
    if (f.caseId !== caseId) throw new Error(`fixture ${caseId} names itself '${f.caseId}'; refusing`);
    const parseTable: ParseRecord[] = [];
    return { caseId, input: toInput(f, parseTable), parseTable };
  });
}
export { SCOPE as SIGNED_CASE_SCOPE, readSignedBytes };
