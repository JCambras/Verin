// The DecisionOutcome seam (prompt 5 section 4) - slice 5's one named contract seam: evaluate()
// produces a decision purely from evidence plus a content-addressed policy version. No clock,
// network, store, environment, randomness, framework type or answer-key path exists in its runtime
// closure - DecisionPureClosure (src/tools/decision-closure.test.ts) asserts the exact closed graph
// both ways and a capability-denied second execution proves it dynamically. The bytes are versioned
// dov.v1 from the first byte (prompt 6 hashes exactly these bytes immutably) and the DecisionId
// mints ONLY from their digest. Structural rule 1: the blocked arm carries mode "none", no stages
// and a null plan - "blocked but approvable" is unrepresentable. This is the announced PR-5a-i
// scope: source selection, the attested-or-refuse cash reserve, authority derivation; every
// vocabulary is exactly what these rules produce, the refusal families arrive beside their
// producers in PR-5a-ii, and the canonical signed-case matches in PR-5a-iii.
import { createHash } from "node:crypto";
import type { EvidenceBundle, EvidenceObservation } from "../evidence/bundle";
import type { FirmPolicy, PolicyVersionId } from "../policy/registry";

const PURPOSES = ["home-renovation", "property-closing", "renovation-deposit"] as const;
// prettier-ignore
const BLOCKER_CODES = [
  "bank-instruction-change-unverified", "cash-reserve-breach", "household-slot-ambiguous", "reserve-evidence-stale",
  "reserve-evidence-missing", "liquidity-reserved-by-sibling", "material-evidence-conflicting", "approval-authority-not-stated",
] as const;
const PROHIBITION_REASONS = ["destination-not-household-titled", "active-legal-hold"] as const;
// prettier-ignore
const EXPLANATION_CODES = [
  "source-account-selected", "cash-reserve-preserved", "cash-reserve-breach", "effective-liquidity-computed", "individually-valid",
  "individually-valid-jointly-overcommitted", "reservation-prevents-joint-violation", "dual-approval-required", "dual-approval-not-required",
  "recent-bank-change-detected", "specialist-review-required", "blocked-until-independently-verified", "destination-restriction-applies",
  "destination-off-list", "legal-hold-detected", "regulatory-precedence-applied", "household-candidates-found", "human-disambiguation-required",
  "freshness-window-exceeded", "stale-cannot-silently-proceed", "material-evidence-conflicting", "approval-authority-not-stated",
] as const;
// prettier-ignore
const RULE_IDS = [
  "household-resolution", "regulatory-precedence", "destination-restriction", "evidence-conflict",
  "source-selection", "cash-reserve", "bank-instruction-change", "authority-derivation",
] as const;
// The typed policy silence, byte-equal to the policy module's token (asserted by test, never imported at runtime).
const NOT_STATED = "not-stated" as const;
// Seven digits: strictly below the eight-digit floor of the bare account-reference form, so no
// request amount can ever enter PII candidacy (GD-003 unwidened; the m19 stop, enforced at entry).
const MAX_USD = 9_999_999;

type Purpose = (typeof PURPOSES)[number];
type BlockerCode = (typeof BLOCKER_CODES)[number];
type ProhibitionReason = (typeof PROHIBITION_REASONS)[number];
type ExplanationCode = (typeof EXPLANATION_CODES)[number];
type RuleId = (typeof RULE_IDS)[number];
type DecisionRequest = { readonly requestRef: string; readonly householdSlug: string; readonly amountUsd: number; readonly purpose: Purpose; readonly deadline?: string };
type DecisionIdentities = { readonly firm: string; readonly household: string; readonly requesterRole: string };
// prettier-ignore
type DecisionInput = {
  readonly request: DecisionRequest; readonly evidenceBundle: EvidenceBundle;
  readonly policyDocument: { readonly id: PolicyVersionId; readonly policy: FirmPolicy };
  readonly identities: DecisionIdentities; readonly asOf: string;
};
// prettier-ignore
type StageRequirement = {
  readonly stageId: string; readonly order: number; readonly eligibleRoleIds: readonly string[];
  readonly approvalsRequired: number; readonly distinctActorsRequired: boolean; readonly requesterMayApprove: boolean;
};
type AuthorityRequirement = { readonly mode: "automatic"; readonly stages: readonly [] } | { readonly mode: "approval" | "specialist-review"; readonly stages: readonly StageRequirement[] };
// The evaluated policy quote: stated values as stated, the contract silences as the typed
// "not-stated" - never filled in (structural rule 3; graded as BINDING values under CD-4a).
// prettier-ignore
type PolicyBasis = {
  readonly reserveHorizonMonths: number; readonly dualApprovalThresholdUsd: number; readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean; readonly eligibleApproverRole: string; readonly requesterRule: string; readonly bankInstructionChange: string;
};
// prettier-ignore
type ExecutionPlan = {
  readonly idempotencyKey: string | null;
  readonly reservation: { readonly reservationRef: string; readonly conflictKeys: readonly string[] } | null;
  readonly ordering: "reserve-only-after-authority-complete"; // CD-4e: authority complete before commitment
  readonly preconditions: readonly string[];
};
type Blocker = { readonly code: BlockerCode; readonly resolvingEvidence: readonly { readonly kind: string; readonly subjectRef: string }[] };
// prettier-ignore
type Prohibition = {
  readonly reasonCode: ProhibitionReason;
  readonly source: { readonly sourceType: "household_instruction" | "regulatory"; readonly sourceId: string; readonly versionId: string | null };
  readonly scope: string;
};
type TraceEntry = { readonly rule: RuleId; readonly result: "fired" | "satisfied" | "not-applicable" | "unevaluable"; readonly figures?: Readonly<Record<string, number>> };
type SourceSelection = { readonly selected: string; readonly alternatives: readonly { readonly subjectRef: string; readonly rejectedBecause: string }[] };
// prettier-ignore
type DecisionCore = {
  readonly version: "dov.v1";
  readonly citations: { readonly request: string; readonly evidenceBundle: string; readonly policy: string; readonly asOf: string };
  readonly request: DecisionRequest; readonly identities: DecisionIdentities; readonly policyBasis: PolicyBasis;
  readonly trace: readonly TraceEntry[]; readonly explanations: readonly { readonly code: ExplanationCode }[];
};
// prettier-ignore
type DecisionOutcome = DecisionCore & (
  | { readonly disposition: "proceed"; readonly authority: AuthorityRequirement; readonly execution: ExecutionPlan; readonly sourceSelection: SourceSelection }
  | { readonly disposition: "blocked"; readonly authority: { readonly mode: "none" }; readonly execution: null; readonly blockers: readonly Blocker[] }
  | { readonly disposition: "prohibited"; readonly authority: { readonly mode: "none" }; readonly execution: null; readonly prohibition: Prohibition }
);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// The checker's three account-reference forms (rules-e16.mjs:21), copied so the closure stays
// closed; byte-agreement is asserted by test. The one shape-bounded exclusion: a leaf whose WHOLE
// value is a date, instant or grammar-conformant key, each built from validated request properties.
// prettier-ignore
const REFERENCE_FORMS: readonly (readonly [string, RegExp])[] = [
  ["bare-account-reference", /\b\d{8,16}\b/], ["spaced-account-reference", /\b\d{2,4}( \d{2,4}){2,}\b/], ["hyphenated-account-reference", /\b\d{2,4}(-\d{2,4}){2,}\b/],
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const IDEM_KEY = /^idem:[A-Za-z0-9][A-Za-z0-9-]*:[a-z0-9][a-z0-9-]*-\d{1,7}-\d{4}-\d{2}-\d{2}$/;
function canonical(x: unknown, path: string, problems: string[]): string {
  if (typeof x === "string") {
    if (x === "") problems.push(`${path} is empty`);
    if (!ISO_DATE.test(x) && !IDEM_KEY.test(x) && !ISO_INSTANT.test(x)) for (const [form, re] of REFERENCE_FORMS) if (re.test(x)) problems.push(`${path} carries a ${form}`);
    return JSON.stringify(x);
  }
  if (typeof x === "number") {
    // A TYPED whole-USD integer: request amounts and evidence figures are capped below the
    // eight-digit reference floor at entry; policy figures follow the fpd schema's own bound (the
    // fpd.v1 precedent - those bytes are not reference-scanned either; the m19 lesson).
    if (!Number.isSafeInteger(x) || Math.abs(x) > 1_000_000_000) problems.push(`${path} is not a whole-USD integer inside the policy schema's own bound`);
    return JSON.stringify(x);
  }
  if (typeof x === "boolean" || x === null) return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map((e, i) => canonical(e, `${path}[${i}]`, problems)).join(",") + "]";
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    if (keys.length === 0) problems.push(`${path} is empty`);
    return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k], `${path}.${k}`, problems)}`).join(",") + "}";
  }
  problems.push(`${path} is not closed data (${typeof x})`);
  return "null";
}
const canonicalOrRefuse = (prefix: string, x: unknown): string => {
  const problems: string[] = [];
  const bytes = prefix + canonical(x, "value", problems);
  if (problems.length) throw new Error(`the ${prefix.slice(0, -1)} serializer refuses these bytes: ${problems.join("; ")}`);
  return bytes;
};

// drq.v1: the request's canonical bytes and identity. An absent deadline is an ABSENT key - silence serializes as silence.
const serializeRequest = (r: DecisionRequest): string =>
  canonicalOrRefuse("drq.v1|", { amountUsd: r.amountUsd, householdSlug: r.householdSlug, purpose: r.purpose, requestRef: r.requestRef, ...(r.deadline !== undefined ? { deadline: r.deadline } : {}) });
const requestIdentity = (r: DecisionRequest): string => "drq.v1:" + sha256(serializeRequest(r));
// The evidence citation is RECOMPUTED from the exact input bundle - no caller's digest is trusted.
// Mirrors serializeBundle's ordering byte for byte (asserted equal by test).
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function evidenceIdentity(bundle: EvidenceBundle): string {
  const ordered = {
    ...bundle,
    observations: [...bundle.observations].sort((x, y) => cmp(x.id, y.id)),
    absences: [...bundle.absences].sort((x, y) => cmp(x.kind, y.kind)),
    conflicts: [...bundle.conflicts].sort((x, y) => cmp(`${x.kind} ${x.subject}`, `${y.kind} ${y.subject}`)),
  };
  return "evb.v1:" + sha256("evb.v1|" + canonical(ordered, "bundle", []));
}
const serializeOutcome = (o: DecisionOutcome): string => canonicalOrRefuse("dov.v1|", o);
const outcomeDigest = (o: DecisionOutcome): string => "dov.v1:" + sha256(serializeOutcome(o));

// The normative idempotency-key grammar (CD-4d): "idem", the request identifier's local part (the
// "req:" prefix removed), the household slug, the whole-USD amount, the deadline date (YYYY-MM-DD);
// ":" separates 1/2/3, "-" separates 3/4/5. No segment is optional; the KEY is null exactly when
// eligibility is false; every segment derives from request properties, never a case id (stop 1).
const idempotencyKeyFor = (r: DecisionRequest): string | null => (r.deadline === undefined ? null : `idem:${r.requestRef.slice(4)}:${r.householdSlug}-${r.amountUsd}-${r.deadline}`);

const REF = /^req:[A-Za-z0-9][A-Za-z0-9-]*$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const IDENTITY = /^[a-z][0-9a-f]{32}$/;
function validateInput(input: DecisionInput): void {
  const refuse = (why: string) => {
    throw new Error(`evaluate refuses this input before any rule runs: ${why}`);
  };
  const r = input.request;
  if (!Number.isInteger(r.amountUsd) || r.amountUsd < 1 || r.amountUsd > MAX_USD) refuse(`amountUsd must be a whole-USD integer in 1..${MAX_USD}`);
  if (!(PURPOSES as readonly string[]).includes(r.purpose)) refuse(`purpose '${r.purpose}' is outside the closed vocabulary - no free text exists on the decision path`);
  if (r.deadline !== undefined && !ISO_DATE.test(r.deadline)) refuse("deadline must be a calendar date (YYYY-MM-DD)");
  if (!REF.test(r.requestRef)) refuse("requestRef must read req: followed by the request's own identifier");
  if (!SLUG.test(r.householdSlug)) refuse("householdSlug must be a lowercase slug");
  for (const [name, v] of Object.entries(input.identities)) if (!IDENTITY.test(v)) refuse(`identity '${name}' must be a letter-prefixed unbroken 32-hex identifier, never a raw UUID`);
  if (!ISO_INSTANT.test(input.asOf)) refuse("asOf must be a canonical UTC instant minted once at the route boundary");
  if (input.evidenceBundle.asOf !== input.asOf) refuse("the evidence bundle was assembled at a different asOf; a decision cites one instant");
  if (!/^[0-9a-f]{64}$/.test(input.policyDocument.id.digest) || input.policyDocument.id.version !== "fpd.v1") refuse("policyDocument must carry its fpd.v1 content identity");
}

// The committed derivation rules. Every rule reads STATED policy fields or typed facts from the
// bundle's closed bodies - never a case id, never an answer key, never a default where the contract
// is silent: a not-stated value produces an honest refusal, NEVER an invented approval (rule 3).
const usd = (v: string | undefined): number | null => (v !== undefined && /^\d{1,7}$/.test(v) ? Number(v) : null);
const count3 = (v: string | undefined): number | null => (v !== undefined && /^\d{1,3}$/.test(v) ? Number(v) : null);
const daysBetween = (earlier: string, later: string): number => Math.floor((Date.parse(later) - Date.parse(earlier)) / 86_400_000);
const attested = (o: EvidenceObservation) => o.body["Sufficiency"] === "attested-sufficient";
// Body dates are WORDED (the projection idiom - a worded date can never collide with the checker's
// hyphenated reference form), parsed against the same fixed month list; locale-free, clock-free.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wordedToInstant = (v: string | undefined): string | null => {
  const m = v !== undefined ? /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(v) : null;
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  return m && month > 0 ? `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}T00:00:00.000Z` : null;
};
// The evidence classes whose disagreement refuses a decision: a side is never picked by recency.
const MATERIAL_KINDS = new Set(["account-balance", "planned-withdrawals", "pending-actions", "bank-instruction", "household-instruction", "regulatory-status"]);
const RECENT_CHANGE_DAYS = 30; // the committed recency window: the vocabulary's own aging threshold
function evaluate(input: DecisionInput): DecisionOutcome {
  validateInput(input);
  const b = input.evidenceBundle;
  const p = input.policyDocument.policy;
  // prettier-ignore
  const policyBasis: PolicyBasis = {
    reserveHorizonMonths: p.reserveHorizonMonths, dualApprovalThresholdUsd: p.dualApproval.thresholdUsd, approvalsRequired: p.dualApproval.approvalsRequired,
    distinctActorsRequired: p.dualApproval.distinctActorsRequired, eligibleApproverRole: p.dualApproval.eligibleApproverRole, requesterRule: p.dualApproval.requesterRule, bankInstructionChange: p.bankInstructionChange,
  };
  const trace: TraceEntry[] = [];
  const explanations: ExplanationCode[] = [];
  const blockers: Blocker[] = [];
  let prohibition: Prohibition | null = null;
  const t = (rule: RuleId, result: TraceEntry["result"], figures?: Record<string, number>) => trace.push({ rule, result, ...(figures && Object.keys(figures).length ? { figures } : {}) });
  const byKind = (kind: string) => b.observations.filter((o) => o.kind === kind);
  const finish = (core: DecisionCore): DecisionOutcome =>
    prohibition
      ? { ...core, disposition: "prohibited", authority: { mode: "none" }, execution: null, prohibition }
      : { ...core, disposition: "blocked", authority: { mode: "none" }, execution: null, blockers };
  const coreOf = (): DecisionCore => ({
    version: "dov.v1",
    citations: { request: requestIdentity(input.request), evidenceBundle: evidenceIdentity(b), policy: `${input.policyDocument.id.version}:${input.policyDocument.id.digest}`, asOf: input.asOf },
    request: input.request,
    identities: input.identities,
    policyBasis,
    trace,
    explanations: explanations.map((code) => ({ code })),
  });

  // 1. Household resolution: an ambiguous directory PRE-EMPTS everything - no household-scoped rule
  // may run while the slot itself is unresolved, and Verin never guesses between candidates.
  const directories = byKind("household-directory");
  const candidates = directories.map((o) => count3(o.body["CandidateCount"])).find((n) => n !== null && n > 1);
  if (candidates !== undefined && candidates !== null) {
    t("household-resolution", "fired", { candidateCount: candidates });
    blockers.push({ code: "household-slot-ambiguous", resolvingEvidence: directories.map((o) => ({ kind: "household-directory", subjectRef: o.subject })) });
    explanations.push("household-candidates-found", "human-disambiguation-required");
    return finish(coreOf());
  }
  t("household-resolution", directories.length ? "satisfied" : "not-applicable");

  // 2. Regulatory precedence: an active hold outranks firm policy and household instructions whole.
  const hold = byKind("regulatory-status").find((o) => o.body["HoldActive"] === "true");
  if (hold) {
    t("regulatory-precedence", "fired");
    prohibition = {
      reasonCode: "active-legal-hold",
      source: { sourceType: "regulatory", sourceId: (hold.body["VersionId"] ?? "regulatory-hold").split("@")[0], versionId: hold.body["VersionId"] ?? null },
      scope: `scope:account:${hold.body["ScopeRef"] ?? hold.subject}`,
    };
    explanations.push("legal-hold-detected", "regulatory-precedence-applied");
    return finish(coreOf());
  }
  t("regulatory-precedence", byKind("regulatory-status").length ? "satisfied" : "not-applicable");

  // 3. Destination restriction: a standing client mandate admits no approval path. Off-list is the
  // instruction's own stated conclusion, or derived from a third-party-titled destination.
  const restrictions = byKind("household-instruction").filter((o) => o.body["InstructionKind"] === "destination-restriction");
  const thirdParty = byKind("bank-instruction").find((o) => o.body["TitledTo"] === "third-party");
  const violated = restrictions.find((o) => o.body["DestinationOnList"] === "false" || (o.body["DestinationOnList"] === undefined && thirdParty !== undefined));
  if (violated) {
    t("destination-restriction", "fired");
    prohibition = {
      reasonCode: "destination-not-household-titled",
      source: { sourceType: "household_instruction", sourceId: (violated.body["VersionId"] ?? "destination-restriction").split("@")[0], versionId: violated.body["VersionId"] ?? null },
      scope: `scope:destination:${thirdParty?.subject ?? violated.subject}`,
    };
    explanations.push("destination-restriction-applies", "destination-off-list");
    return finish(coreOf());
  }
  t("destination-restriction", restrictions.length ? "satisfied" : "not-applicable");

  // 4. Material conflict: the bundle retains BOTH sides of a disagreement; a decision refuses them.
  const conflicted = b.conflicts.filter((c) => MATERIAL_KINDS.has(c.kind));
  if (conflicted.length) {
    t("evidence-conflict", "fired");
    blockers.push({ code: "material-evidence-conflicting", resolvingEvidence: conflicted.map((c) => ({ kind: c.kind, subjectRef: c.subject })) });
    explanations.push("material-evidence-conflicting");
    return finish(coreOf());
  }
  t("evidence-conflict", "satisfied");

  // 5. Source selection: a retirement account is never chosen silently; among usable taxable
  // candidates the largest available balance wins, and every rejected alternative carries its reason.
  const balances = byKind("account-balance");
  const usable = balances.map((o) => ({ o, available: usd(o.body["AvailableUsd"]), cls: o.body["RegistrationClass"] }));
  const taxable = usable.filter((x) => x.cls === "taxable" && (x.available !== null || attested(x.o))).sort((a, z) => (z.available ?? 0) - (a.available ?? 0));
  const selected = taxable[0];
  let sourceSelection: SourceSelection | null = null;
  if (selected) {
    sourceSelection = {
      selected: selected.o.subject,
      alternatives: usable
        .filter((x) => x !== selected)
        .map((x) => ({
          subjectRef: x.o.subject,
          rejectedBecause: x.cls === "retirement" ? "taxable-event-source" : x.cls === "taxable" ? "smaller-available-balance" : "registration-class-unobserved",
        })),
    };
    t("source-selection", "fired", selected.available !== null ? { availableUsd: selected.available } : undefined);
    explanations.push("source-account-selected");
  } else t("source-selection", balances.length ? "unevaluable" : "not-applicable");

  // 6. Cash reserve: attested sufficiency stands as evidence; otherwise the arithmetic runs only on
  // FRESH machine figures - present-but-stale reserve evidence cannot silently proceed, a figure
  // the extraction cannot read is refused, pending approved activity counts against the household,
  // and a breach that exists only because a sibling reservation holds the liquidity is that
  // sibling's blocker, not a plain reserve breach.
  const schedules = byKind("planned-withdrawals");
  const pendings = byKind("pending-actions");
  const schedule = schedules[0];
  if (balances.some(attested) || schedules.some(attested)) t("cash-reserve", "satisfied");
  else if (!schedule || !selected || selected.available === null || usd(schedule.body["MonthlyUsd"]) === null) {
    t("cash-reserve", "unevaluable");
    const missingKind = !schedule || usd(schedule?.body["MonthlyUsd"]) === null ? "planned-withdrawals" : "account-balance";
    blockers.push({ code: "reserve-evidence-missing", resolvingEvidence: [{ kind: missingKind, subjectRef: b.subject.household }] });
  } else if (schedule.freshness !== "fresh" || selected.o.freshness !== "fresh") {
    const staleOne = schedule.freshness !== "fresh" ? schedule : selected.o;
    t("cash-reserve", "fired", { evidenceAgeDays: daysBetween(staleOne.provenance.observedAt, input.asOf) });
    blockers.push({ code: "reserve-evidence-stale", resolvingEvidence: [{ kind: staleOne.kind, subjectRef: staleOne.subject }] });
    explanations.push("freshness-window-exceeded", "stale-cannot-silently-proceed");
  } else {
    const monthly = usd(schedule.body["MonthlyUsd"])!;
    const pendingUsd = pendings.reduce((n, o) => n + (usd(o.body["PendingTotalUsd"]) ?? 0), 0);
    const siblingUsd = pendings.reduce((n, o) => n + (usd(o.body["SiblingReservationUsd"]) ?? 0), 0);
    const effective = selected.available - pendingUsd - siblingUsd;
    const required = monthly * policyBasis.reserveHorizonMonths;
    const remaining = effective - input.request.amountUsd;
    const figures = {
      availableUsd: selected.available,
      pendingUsd: pendingUsd + siblingUsd,
      effectiveUsd: effective,
      amountUsd: input.request.amountUsd,
      remainingUsd: remaining,
      requiredReserveUsd: required,
    };
    if (pendingUsd + siblingUsd > 0) explanations.push("effective-liquidity-computed");
    if (remaining < required) {
      t("cash-reserve", "fired", figures);
      if (siblingUsd > 0 && remaining + siblingUsd >= required) {
        blockers.push({ code: "liquidity-reserved-by-sibling", resolvingEvidence: pendings.map((o) => ({ kind: "pending-actions", subjectRef: o.subject })) });
        explanations.push("individually-valid-jointly-overcommitted", "reservation-prevents-joint-violation");
      } else {
        blockers.push({
          code: "cash-reserve-breach",
          resolvingEvidence: [{ kind: "account-balance", subjectRef: selected.o.subject }, ...pendings.map((o) => ({ kind: "pending-actions", subjectRef: o.subject }))],
        });
        explanations.push("cash-reserve-breach");
      }
    } else {
      t("cash-reserve", "satisfied", figures);
      explanations.push("cash-reserve-preserved");
      if (pendings.length) explanations.push("individually-valid");
    }
  }

  // 7. Bank-instruction change: a recent unverified change takes the firm's STATED handling - a
  // review stage under one configuration, an execution block under the other. Same facts, both
  // correct, from configuration alone.
  let bankChangeReviewRequired = false;
  const instructions = byKind("bank-instruction");
  const recentUnverified = instructions.find((o) => {
    const verified = o.body["Verified"] === "true" || o.body["Standing"] === "verified on file";
    if (verified) return false;
    const changedInstant = wordedToInstant(o.body["ChangedAt"]);
    const changedDays = changedInstant !== null ? daysBetween(changedInstant, input.asOf) : o.body["Standing"] === "reported changed by client" ? 0 : null;
    return changedDays !== null && changedDays <= RECENT_CHANGE_DAYS;
  });
  if (recentUnverified) {
    t("bank-instruction-change", "fired");
    explanations.push("recent-bank-change-detected");
    if (policyBasis.bankInstructionChange === "specialist-review") {
      bankChangeReviewRequired = true;
      explanations.push("specialist-review-required");
    } else {
      blockers.push({ code: "bank-instruction-change-unverified", resolvingEvidence: [{ kind: "bank-instruction", subjectRef: recentUnverified.subject }] });
      explanations.push("blocked-until-independently-verified");
    }
  } else t("bank-instruction-change", instructions.length ? "satisfied" : "not-applicable");

  // 8. Authority derivation from the STATED dual-approval block and the STATED handling alone: the
  // dual stage id is <role>-dual-approval by the committed naming rule; the specialist stage is the
  // stated handling's archetype (one bank-change specialist, sequential, never the requester); a
  // silent approver role or requester rule derives NO stage - the decision refuses honestly.
  let authority: AuthorityRequirement | null = null;
  if (blockers.length === 0 && sourceSelection) {
    const stages: StageRequirement[] = [];
    if (bankChangeReviewRequired)
      stages.push({ stageId: "bank-change-specialist-review", order: 1, eligibleRoleIds: ["bank-change-specialist"], approvalsRequired: 1, distinctActorsRequired: false, requesterMayApprove: false });
    if (input.request.amountUsd > policyBasis.dualApprovalThresholdUsd) {
      if (policyBasis.eligibleApproverRole === NOT_STATED || policyBasis.requesterRule === NOT_STATED) {
        t("authority-derivation", "unevaluable");
        blockers.push({ code: "approval-authority-not-stated", resolvingEvidence: [] });
        explanations.push("approval-authority-not-stated");
      } else {
        stages.push({
          stageId: `${policyBasis.eligibleApproverRole}-dual-approval`,
          order: stages.length + 1,
          eligibleRoleIds: [policyBasis.eligibleApproverRole],
          approvalsRequired: policyBasis.approvalsRequired,
          distinctActorsRequired: policyBasis.distinctActorsRequired,
          requesterMayApprove: false,
        });
        explanations.push("dual-approval-required");
      }
    } else if (stages.length === 0) explanations.push("dual-approval-not-required");
    if (blockers.length === 0) {
      t("authority-derivation", stages.length ? "fired" : "satisfied", { stageCount: stages.length });
      authority = stages.length === 0 ? { mode: "automatic", stages: [] } : { mode: bankChangeReviewRequired ? "specialist-review" : "approval", stages };
    }
  } else if (blockers.length === 0) blockers.push({ code: "reserve-evidence-missing", resolvingEvidence: [{ kind: "account-balance", subjectRef: b.subject.household }] });

  const core: DecisionCore = coreOf();
  if (blockers.length > 0) return finish(core);
  return {
    ...core,
    disposition: "proceed",
    authority: authority!,
    execution: {
      idempotencyKey: idempotencyKeyFor(input.request),
      reservation: { reservationRef: `res:${input.request.requestRef.slice(4)}:liquidity`, conflictKeys: [`conflict:${input.request.householdSlug}-liquidity`] },
      ordering: "reserve-only-after-authority-complete",
      preconditions: [
        "material-evidence-fresh-at-execution",
        ...(authority!.stages.length > 0 ? ["approval-bound-to-decision-hash"] : []),
        ...(bankChangeReviewRequired ? ["bank-instruction-independently-verified"] : []),
        "reservation-still-held",
      ],
    },
    sourceSelection: sourceSelection!,
  };
}

// prettier-ignore
export type { AuthorityRequirement, Blocker, BlockerCode, DecisionIdentities, DecisionInput, DecisionOutcome, DecisionRequest, ExecutionPlan, ExplanationCode, PolicyBasis, Prohibition, ProhibitionReason, Purpose, RuleId, SourceSelection, StageRequirement, TraceEntry };
// prettier-ignore
export { BLOCKER_CODES, EXPLANATION_CODES, MAX_USD, NOT_STATED, PROHIBITION_REASONS, PURPOSES, REFERENCE_FORMS, RULE_IDS, evaluate, idempotencyKeyFor, outcomeDigest, requestIdentity, serializeOutcome, serializeRequest };
