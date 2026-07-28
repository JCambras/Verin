/**
 * GOLDEN-CASE VALIDATOR CORE (v3 build-sequence prompt 2).
 *
 * Pure, side-effect-free validation of the golden-case truth set. This module is
 * the single authority for "what a golden case MUST state" and is imported by
 * BOTH the runner script (scripts/golden-cases-validate.ts) and the fitness fence
 * (src/__tests__/fitness/golden-cases.test.ts), so the check that runs in CI and
 * the check that is adversarially proven are the exact same code (no drift).
 *
 * The vocabularies below (dispositions, execution states, ledger event types,
 * authority modes, freshness) are the v3 core-contracts vocabulary
 * (docs/v3/verin-core-contracts.ts). Where the golden cases share a vocabulary
 * with the demo scenario matrix (config/demo/scenarios.yaml) - firm ids, state
 * ids, provenance labels, scenario ids, the deferral status - validateGoldenCases
 * cross-checks each case against the LIVE matrix (loadScenarioRefs), so a golden
 * case can never reference an id the matrix does not define, and a matrix rename
 * (blocked by that file's own stability fence) would surface here too.
 *
 * validateGoldenCases takes an injected ref set and doc text (never reads disk),
 * so the fence's companion can feed it deliberately broken cases and prove
 * incomplete work cannot pass (charter #4: detection is not verification).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { TimestampSchema } from "@contracts/decision-core/ids";
import { OBSERVED_STATUS_IDS } from "@contracts/execution-status";
import { isMoneyQuantity, minorFromMajor, reserveFloorMinor } from "@contracts/money-movement";
import { validateEvidenceCompleteness } from "./golden-evidence.lib";

export const REPO_ROOT = resolve(import.meta.dirname, "..");
export const GOLDEN_DIR = join(REPO_ROOT, "fixtures/golden");
export const GOLDEN_DOC = join(REPO_ROOT, "docs/golden-cases.md");
export const SCENARIOS_YAML = join(REPO_ROOT, "config/demo/scenarios.yaml");
export const V3_CORE_CONTRACTS = join(REPO_ROOT, "docs/v3/verin-core-contracts.ts");

/** The ratified v3 `LedgerEntry` union, transcribed from the SHA-256-pinned
 * docs/v3/verin-core-contracts.ts and kept honest by `validateLedgerVocabulary`. */
export const V3_LEDGER_ENTRY_TYPES = [
  "DecisionRecorded",
  "EvidenceSnapshotRecorded",
  "ApprovalRecorded",
  "ApprovalInvalidated",
  "ReservationCreated",
  "ReservationReleased",
  "ExecutionStarted",
  "ExecutionSucceeded",
  "ExecutionPartiallySucceeded",
  "ExecutionFailed",
  "StatusObserved",
  "VerificationClosed",
  "VerificationStuck",
  "ExceptionDecisionRequested",
] as const;

/** The two authority-lapse events D-061 signed into GC-16 that the v3 union does
 * NOT yet carry. The extension is authorized by ADR-0030; prompt 7 adds both to the
 * canonical union when it lands the ledger, and this list empties back out. */
export const AUTHORITY_LAPSE_EVENT_TYPES = ["ApprovalStageEscalated", "ApprovalStageExpired"] as const;

/** What a signed golden case may name: the v3 union plus the ADR-0030 extension. */
export const LEDGER_EVENT_TYPES = [...V3_LEDGER_ENTRY_TYPES, ...AUTHORITY_LAPSE_EVENT_TYPES] as const;

/**
 * Keep the transcription above honest against the pinned v3 reference, so the
 * divergence stays a NAMED, reviewable extension instead of a silent widening:
 * every member the reference declares must be transcribed, nothing may be invented,
 * and once prompt 7 adds an authority-lapse event to the ratified union the
 * extension must be collapsed rather than left shadowing it. Text is injected so
 * the fence companion can feed a drifted reference (charter #4).
 */
export function validateLedgerVocabulary(contractsText: string): string[] {
  const problems: string[] = [];
  const union = contractsText.match(/export type LedgerEntry\s*=([^;]*);/);
  if (!union) {
    return ["docs/v3/verin-core-contracts.ts declares no LedgerEntry union (the ratified reference moved or was renamed)"];
  }
  const ratified = new Set(
    union[1]!
      .split("|")
      .map((member) => member.trim())
      .filter((member) => /^[A-Za-z][A-Za-z0-9_]*$/.test(member)),
  );
  const transcribed = new Set<string>(V3_LEDGER_ENTRY_TYPES);
  for (const member of ratified) {
    if (!transcribed.has(member)) problems.push(`v3 LedgerEntry member "${member}" is missing from V3_LEDGER_ENTRY_TYPES`);
  }
  for (const member of transcribed) {
    if (!ratified.has(member)) problems.push(`V3_LEDGER_ENTRY_TYPES claims "${member}" but the ratified v3 LedgerEntry union does not declare it`);
  }
  for (const member of AUTHORITY_LAPSE_EVENT_TYPES) {
    if (ratified.has(member)) {
      problems.push(`"${member}" is now a ratified v3 LedgerEntry member - collapse it out of the ADR-0030 extension into V3_LEDGER_ENTRY_TYPES`);
    }
  }
  return problems;
}

/** AuthorityRequirement.mode, plus the "none" sentinel a golden case uses to
 * state, positively, that a non-proceed disposition carries NO authority
 * (blocked/prohibited decisions cannot carry authority - v3 invariants 8 & 9). */
export const AUTHORITY_MODES = ["automatic", "approval", "specialist_review", "none"] as const;

/** DecisionResult.kind (the disposition plane). */
export const DISPOSITIONS = ["proceed", "blocked", "prohibited"] as const;

/** Canonical observed external outcomes. Presentation labels cannot widen it. */
export const EXECUTION_STATES = OBSERVED_STATUS_IDS;

/** EvidenceSnapshotRef.freshness. */
export const FRESHNESS = ["fresh", "stale", "unknown"] as const;

export const SIGNOFF_PENDING = "pending-captain";
export const SIGNOFF_SIGNED = "signed";

/**
 * The minimum truth set the spec (prompt 2) enumerates by name. Every one of
 * these MUST be covered by at least one case's `specName`. This is how the
 * validator enforces "at least twelve cases: <the enumerated list>" mechanically.
 */
export const REQUIRED_SPEC_NAMES = [
  "Firm A happy path",
  "Firm B happy path",
  "recent bank change",
  "insufficient liquidity",
  "household restriction",
  "regulatory or firm prohibition",
  "ambiguous household",
  "stale evidence",
  "two simultaneous distributions",
  "duplicate retry",
  "partial Salesforce success",
  "delayed NIGO",
] as const;

export interface ScenarioRefs {
  scenarioIds: Set<string>;
  firmIds: Set<string>;
  canonicalRequestAmountUsd: number | null;
  firmReserveMonths: Map<string, number>;
  dispositionStates: Set<string>;
  executionStates: Set<string>;
  provenanceLabels: Set<string>;
  deferralStatus: string | null;
}

interface YamlIdRow {
  id?: unknown;
  class?: unknown;
  cash_reserve?: { months_of_planned_withdrawals?: unknown };
}
interface YamlData {
  canonical_request?: { amount_usd?: unknown };
  firms?: YamlIdRow[];
  state_vocabulary?: YamlIdRow[];
  scenarios?: YamlIdRow[];
  provenance_labels?: YamlIdRow[];
  deferral?: { status?: unknown };
}

const idsOf = (rows: YamlIdRow[] | undefined): string[] =>
  (rows ?? []).map((r) => (typeof r?.id === "string" ? r.id : "")).filter(Boolean);

/** Read the live demo scenario matrix and project the shared vocabularies the
 * golden cases must align with. Text may be injected (companion tests). */
export function loadScenarioRefs(text = readFileSync(SCENARIOS_YAML, "utf8")): ScenarioRefs {
  const data = (parseDocument(text).toJS() ?? {}) as YamlData;
  const states = data.state_vocabulary ?? [];
  const pick = (cls: string) => new Set(states.filter((s) => s.class === cls).map((s) => String(s.id)));
  return {
    scenarioIds: new Set(idsOf(data.scenarios)),
    firmIds: new Set(idsOf(data.firms)),
    canonicalRequestAmountUsd:
      typeof data.canonical_request?.amount_usd === "number" ? data.canonical_request.amount_usd : null,
    firmReserveMonths: new Map(
      (data.firms ?? []).flatMap((firm) =>
        typeof firm.id === "string" && typeof firm.cash_reserve?.months_of_planned_withdrawals === "number"
          ? [[firm.id, firm.cash_reserve.months_of_planned_withdrawals]]
          : [],
      ),
    ),
    dispositionStates: pick("disposition"),
    executionStates: pick("execution"),
    provenanceLabels: new Set(idsOf(data.provenance_labels)),
    deferralStatus: typeof data.deferral?.status === "string" ? data.deferral.status : null,
  };
}

export interface LoadedCase {
  rel: string;
  data: unknown;
}

/** Load every golden-case fixture (*.json under fixtures/golden). */
export function loadGoldenCases(dir = GOLDEN_DIR): LoadedCase[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ rel: `fixtures/golden/${f}`, data: JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown }));
}

// ---------- field-presence helpers (a "populated" field is present AND non-empty) ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNonEmptyArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;

/**
 * The signed money figures a case states as STRUCTURED data. Amounts are first-class
 * fields rather than numbers regexed out of signed prose, so a captain rewording a
 * summary cannot move product truth (and cannot break the gate). `validateGoldenCases`
 * separately requires the prose to still mention every figure, so the two can never
 * disagree.
 */
export interface SignedMoney {
  currency: string;
  cadence: string;
  requestAmountUsd: number;
  /** null when the case's signed text states no schedule for this household. */
  plannedWithdrawalMonthlyUsd: number | null;
  /** null when the case's signed text states no reserve floor. */
  reserveFloorUsd: number | null;
}

const optionalAmount = (v: unknown): number | null | undefined =>
  v === null ? null : isMoneyQuantity(v) ? v : undefined;

/** Read a case's signedMoney block, or null when it is absent or malformed. */
export function readSignedMoney(c: Record<string, unknown>): SignedMoney | null {
  const m = c.signedMoney;
  if (!isObj(m)) return null;
  const monthly = optionalAmount(m.plannedWithdrawalMonthlyUsd);
  const floor = optionalAmount(m.reserveFloorUsd);
  if (!isNonEmptyString(m.currency) || !isNonEmptyString(m.cadence)) return null;
  if (!isMoneyQuantity(m.requestAmountUsd) || monthly === undefined || floor === undefined) return null;
  return {
    currency: m.currency,
    cadence: m.cadence,
    requestAmountUsd: m.requestAmountUsd,
    plannedWithdrawalMonthlyUsd: monthly,
    reserveFloorUsd: floor,
  };
}

/** Whether signed prose still states a figure, tolerant of `8000`, `8,000`, `$8,000.00`. */
function mentionsAmount(text: string, amountUsd: number): boolean {
  const normalized = text.replace(/(?<=\d),(?=\d\d\d\b)/g, "");
  return new RegExp(`(?<![\\d.])${amountUsd}(?!\\d)`).test(normalized);
}

/** The signed money block: well-typed, internally consistent, and still stated in prose. */
function validateSignedMoney(c: Record<string, unknown>, P: (msg: string) => void): void {
  const signed = readSignedMoney(c);
  if (!signed) {
    P("signedMoney must state currency, cadence, requestAmountUsd, and (whole-dollar or null) plannedWithdrawalMonthlyUsd and reserveFloorUsd");
    return;
  }
  const months = isObj(c.firmConfiguration) ? c.firmConfiguration.cashReserveMonths : undefined;
  const monthlyMinor = minorFromMajor(signed.plannedWithdrawalMonthlyUsd);
  const floorMinor = minorFromMajor(signed.reserveFloorUsd);
  if (monthlyMinor !== null && floorMinor !== null) {
    if (!isMoneyQuantity(months)) {
      P("signedMoney states a reserve floor but firmConfiguration.cashReserveMonths is not a whole reserve horizon");
    } else if (reserveFloorMinor(monthlyMinor, months) !== floorMinor) {
      P(`signedMoney.reserveFloorUsd ${signed.reserveFloorUsd} is not ${signed.plannedWithdrawalMonthlyUsd} x ${months} months`);
    }
  }
  const trigger = c.trigger;
  const requestSummary = isObj(trigger) && isNonEmptyString(trigger.maskedRequestSummary) ? trigger.maskedRequestSummary : "";
  if (!mentionsAmount(requestSummary, signed.requestAmountUsd)) {
    P(`trigger.maskedRequestSummary no longer states the signed request amount ${signed.requestAmountUsd}`);
  }
  const scheduleSummary = (Array.isArray(c.householdEvidence) ? c.householdEvidence : [])
    .filter(isObj)
    .filter((row) => row.evidenceKind === "planned-withdrawals")
    .map((row) => (isNonEmptyString(row.summary) ? row.summary : ""))
    .join(" ");
  for (const [field, amount] of [
    ["plannedWithdrawalMonthlyUsd", signed.plannedWithdrawalMonthlyUsd],
    ["reserveFloorUsd", signed.reserveFloorUsd],
  ] as const) {
    if (amount !== null && !mentionsAmount(scheduleSummary, amount)) {
      P(`signedMoney.${field} ${amount} is not stated by any planned-withdrawals evidence summary`);
    }
  }
}

/**
 * Validate all golden cases against an injected ref set and doc text. Returns a
 * flat list of human-readable problems (empty = every case is complete, well-typed,
 * vocabulary-aligned, internally consistent, and mirrored in the doc).
 */
export function validateGoldenCases(cases: LoadedCase[], refs: ScenarioRefs, docText: string): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenSpecNames = new Set<string>();

  if (cases.length < 12) {
    problems.push(`only ${cases.length} golden case(s) found; the spec requires at least twelve`);
  }

  for (const { rel, data } of cases) {
    const P = (msg: string) => problems.push(`${rel} :: ${msg}`);
    if (!isObj(data)) {
      P("case is not a JSON object");
      continue;
    }
    const c = data as Record<string, unknown>;
    const caseId = c.caseId;

    // identity
    if (!isNonEmptyString(caseId) || !/^GC-\d\d-[a-z0-9-]+$/.test(caseId)) {
      P(`caseId missing or malformed (expected /^GC-\\d\\d-[a-z0-9-]+$/, got ${JSON.stringify(caseId)})`);
    } else {
      if (seenIds.has(caseId)) P(`duplicate caseId "${caseId}"`);
      seenIds.add(caseId);
      if (!docText.includes(caseId)) P(`caseId "${caseId}" is not referenced anywhere in docs/golden-cases.md (doc/fixture drift)`);
      const basename = rel.split("/").pop()?.replace(/\.json$/, "");
      if (basename !== caseId) P(`file name "${basename}" does not match caseId "${caseId}" (rename one)`);
    }
    for (const key of ["title", "specName", "scenarioRefNote"] as const) {
      if (!isNonEmptyString(c[key])) P(`${key} missing or empty`);
    }
    if (isNonEmptyString(c.specName)) seenSpecNames.add(c.specName);

    // scenario alignment (null is allowed but must be justified in scenarioRefNote, checked above)
    if (c.scenarioRef !== null && !(isNonEmptyString(c.scenarioRef) && refs.scenarioIds.has(c.scenarioRef))) {
      P(`scenarioRef must be null or a scenarios.yaml scenario id, got ${JSON.stringify(c.scenarioRef)}`);
    }
    if (!(isNonEmptyString(c.firm) && refs.firmIds.has(c.firm))) {
      P(`firm must be a scenarios.yaml firm id, got ${JSON.stringify(c.firm)}`);
    }
    if (!(isNonEmptyString(c.provenance) && refs.provenanceLabels.has(c.provenance))) {
      P(`provenance must be a scenarios.yaml provenance label, got ${JSON.stringify(c.provenance)}`);
    }
    // deferred: null, or exactly the matrix's deferral status
    if (c.deferred !== null && !(isNonEmptyString(c.deferred) && c.deferred === refs.deferralStatus)) {
      P(`deferred must be null or "${refs.deferralStatus ?? "<matrix deferral.status>"}", got ${JSON.stringify(c.deferred)}`);
    }
    // Salesforce-dependent expectations must be explicitly deferred (spec + captain directive)
    if (isNonEmptyString(caseId) && caseId.includes("partial-salesforce") && c.deferred !== refs.deferralStatus) {
      P(`the partial-Salesforce case must carry deferred="${refs.deferralStatus}" (deferred-pending-sandbox)`);
    }

    // human signoff - present and complete. Exactly two legal shapes:
    //   pending-captain: signedBy/signedAt are null (initial state; a drafting
    //                    agent must never produce anything else);
    //   signed:          signedBy + signedAt populated (only the captain flips a
    //                    case to this state, in a PR the captain reviews).
    // A signed status WITHOUT attribution is the dishonest middle this rejects.
    const s = c.signoff;
    if (!isObj(s)) {
      P("signoff object missing");
    } else {
      if (s.authority !== "captain") P(`signoff.authority must be "captain", got ${JSON.stringify(s.authority)}`);
      if (!isNonEmptyString(s.note)) P("signoff.note missing or empty");
      if (s.status === SIGNOFF_PENDING) {
        if (s.signedBy !== null) P(`signoff.signedBy must be null while pending, got ${JSON.stringify(s.signedBy)}`);
        if (s.signedAt !== null) P(`signoff.signedAt must be null while pending, got ${JSON.stringify(s.signedAt)}`);
      } else if (s.status === SIGNOFF_SIGNED) {
        if (!isNonEmptyString(s.signedBy)) P("signoff.signedBy must name the signer when status is signed");
        if (!isNonEmptyString(s.signedAt)) P("signoff.signedAt must be populated when status is signed");
      } else {
        P(`signoff.status must be "${SIGNOFF_PENDING}" or "${SIGNOFF_SIGNED}", got ${JSON.stringify(s.status)}`);
      }
    }

    // trigger
    const t = c.trigger;
    if (!isObj(t)) P("trigger object missing");
    else {
      if (t.kind !== "human_request" && t.kind !== "system_event") P(`trigger.kind must be human_request|system_event, got ${JSON.stringify(t.kind)}`);
      if (!isNonEmptyString(t.description)) P("trigger.description missing or empty");
      if (!TimestampSchema.safeParse(t.asOf).success) P("trigger.asOf must be canonical UTC ISO (YYYY-MM-DDTHH:MM:SS.mmmZ)");
    }

    // firm configuration (must agree with the case's firm)
    const fc = c.firmConfiguration;
    if (!isObj(fc)) P("firmConfiguration object missing");
    else {
      if (fc.firmId !== c.firm) P(`firmConfiguration.firmId "${String(fc.firmId)}" does not match case firm "${String(c.firm)}"`);
      if (!isInt(fc.cashReserveMonths)) P("firmConfiguration.cashReserveMonths must be an integer");
      if (!isInt(fc.dualApprovalThresholdUsd)) P("firmConfiguration.dualApprovalThresholdUsd must be an integer");
      if (!isInt(fc.approvalsRequired)) P("firmConfiguration.approvalsRequired must be an integer");
      if (!isBool(fc.distinctActorsRequired)) P("firmConfiguration.distinctActorsRequired must be a boolean");
      if (!("eligibleRole" in fc)) P("firmConfiguration.eligibleRole must be present (string or null - matrix records silence as null)");
      if (!("requesterConstraint" in fc)) P("firmConfiguration.requesterConstraint must be present (string or null)");
      if (!isNonEmptyString(fc.bankInstructionChangeHandling)) P("firmConfiguration.bankInstructionChangeHandling missing or empty");
    }

    // household evidence
    if (!isNonEmptyArray(c.householdEvidence)) P("householdEvidence must be a non-empty array");
    else {
      c.householdEvidence.forEach((e, i) => {
        const at = `householdEvidence[${i}]`;
        if (!isObj(e)) return P(`${at} is not an object`);
        for (const k of ["evidenceKind", "subjectRef", "observedAt", "retrievedAt", "source", "summary"] as const) {
          if (!isNonEmptyString(e[k])) P(`${at}.${k} missing or empty`);
        }
        for (const k of ["observedAt", "retrievedAt"] as const) {
          if (!TimestampSchema.safeParse(e[k]).success) P(`${at}.${k} must be canonical UTC ISO (YYYY-MM-DDTHH:MM:SS.mmmZ)`);
        }
        if ("observedAbsent" in e && !isBool(e.observedAbsent)) P(`${at}.observedAbsent must be a boolean when present`);
        if (!(isNonEmptyString(e.freshness) && (FRESHNESS as readonly string[]).includes(e.freshness))) P(`${at}.freshness must be one of ${FRESHNESS.join("|")}`);
        if (!(isNonEmptyString(e.provenance) && refs.provenanceLabels.has(e.provenance))) P(`${at}.provenance must be a scenarios.yaml provenance label`);
      });
    }
    for (const problem of validateEvidenceCompleteness(c)) P(problem);
    validateSignedMoney(c, P);

    // policy versions. Household-instruction versions may be EMPTY only when the
    // case records why (householdInstructionsNote) - e.g. the ambiguous-household
    // case cannot bind instruction versions before the household itself binds.
    // Silence is recorded, never filled in (scenarios.yaml scope discipline).
    const instructionSilenceRecorded = isNonEmptyString(c.householdInstructionsNote);
    const pv = c.policyVersions;
    if (!isObj(pv)) P("policyVersions object missing");
    else {
      if (!isNonEmptyString(pv.domainConfigVersionId)) P("policyVersions.domainConfigVersionId missing or empty");
      if (!isNonEmptyString(pv.firmPolicyVersionId)) P("policyVersions.firmPolicyVersionId missing or empty");
      if (!Array.isArray(pv.householdInstructionVersionIds)) P("policyVersions.householdInstructionVersionIds must be an array");
      else if (pv.householdInstructionVersionIds.length === 0 && !instructionSilenceRecorded) {
        P("policyVersions.householdInstructionVersionIds is empty with no householdInstructionsNote recording why (silence is recorded, never filled in)");
      }
      if (!("regulatoryVersionId" in pv)) P("policyVersions.regulatoryVersionId must be present (string or null)");
    }

    // household instructions (same recorded-silence escape as the version ids)
    if (!Array.isArray(c.householdInstructions)) P("householdInstructions must be an array");
    else if (c.householdInstructions.length === 0 && !instructionSilenceRecorded) {
      P("householdInstructions is empty with no householdInstructionsNote recording why (silence is recorded, never filled in)");
    } else {
      c.householdInstructions.forEach((h, i) => {
        const at = `householdInstructions[${i}]`;
        if (!isObj(h)) return P(`${at} is not an object`);
        for (const k of ["instructionKind", "versionId", "summary"] as const) if (!isNonEmptyString(h[k])) P(`${at}.${k} missing or empty`);
      });
    }

    // expected disposition
    const disposition = c.expectedDisposition;
    if (!(isNonEmptyString(disposition) && (DISPOSITIONS as readonly string[]).includes(disposition))) {
      P(`expectedDisposition must be one of ${DISPOSITIONS.join("|")}, got ${JSON.stringify(disposition)}`);
    } else if (!refs.dispositionStates.has(disposition)) {
      P(`expectedDisposition "${disposition}" is not a scenarios.yaml disposition-class state`);
    }

    // expected authority
    const auth = c.expectedAuthority;
    let authMode: string | undefined;
    if (!isObj(auth)) P("expectedAuthority object missing");
    else {
      authMode = isNonEmptyString(auth.mode) ? auth.mode : undefined;
      if (!(authMode && (AUTHORITY_MODES as readonly string[]).includes(authMode))) P(`expectedAuthority.mode must be one of ${AUTHORITY_MODES.join("|")}, got ${JSON.stringify(auth.mode)}`);
      if (!isNonEmptyString(auth.note)) P("expectedAuthority.note missing or empty");
      if (!Array.isArray(auth.stages)) P("expectedAuthority.stages must be an array");
      else {
        auth.stages.forEach((st, i) => {
          const at = `expectedAuthority.stages[${i}]`;
          if (!isObj(st)) return P(`${at} is not an object`);
          if (!isNonEmptyString(st.stageId)) P(`${at}.stageId missing or empty`);
          if (!isInt(st.order)) P(`${at}.order must be an integer`);
          if (st.executionMode !== "sequential" && st.executionMode !== "parallel") P(`${at}.executionMode must be sequential|parallel`);
          if (!isNonEmptyArray(st.eligibleRoleIds)) P(`${at}.eligibleRoleIds must be a non-empty array`);
          if (!isInt(st.approvalsRequired)) P(`${at}.approvalsRequired must be an integer`);
          if (!isBool(st.distinctActorsRequired)) P(`${at}.distinctActorsRequired must be a boolean`);
          if (!isBool(st.requesterMayApprove)) P(`${at}.requesterMayApprove must be a boolean`);
          if (!isNonEmptyString(st.expiresAfter)) P(`${at}.expiresAfter (ISO-8601 duration) missing or empty`);
          if (!Array.isArray(st.escalationPath)) P(`${at}.escalationPath must be an array`);
        });
      }
    }

    // expected execution eligibility
    const ee = c.expectedExecutionEligibility;
    let eligible: boolean | undefined;
    if (!isObj(ee)) P("expectedExecutionEligibility object missing");
    else {
      eligible = isBool(ee.eligible) ? ee.eligible : undefined;
      if (eligible === undefined) P("expectedExecutionEligibility.eligible must be a boolean");
      if (!isNonEmptyString(ee.reason)) P("expectedExecutionEligibility.reason missing or empty");
      if (!("idempotencyKey" in ee)) P("expectedExecutionEligibility.idempotencyKey must be present (string or null)");
      if (!Array.isArray(ee.reservations)) P("expectedExecutionEligibility.reservations must be an array");
      if (!Array.isArray(ee.preconditions)) P("expectedExecutionEligibility.preconditions must be an array");
    }

    // expected explanation nodes
    if (!isNonEmptyArray(c.expectedExplanationNodes)) P("expectedExplanationNodes must be a non-empty array");
    else {
      c.expectedExplanationNodes.forEach((n, i) => {
        const at = `expectedExplanationNodes[${i}]`;
        if (!isObj(n)) return P(`${at} is not an object`);
        if (!isNonEmptyString(n.code)) P(`${at}.code missing or empty`);
        if (!isNonEmptyString(n.summary)) P(`${at}.summary missing or empty`);
      });
    }

    // expected ledger events
    if (!isNonEmptyArray(c.expectedLedgerEvents)) P("expectedLedgerEvents must be a non-empty array");
    else {
      c.expectedLedgerEvents.forEach((l, i) => {
        const at = `expectedLedgerEvents[${i}]`;
        if (!isObj(l)) return P(`${at} is not an object`);
        if (!(isNonEmptyString(l.type) && (LEDGER_EVENT_TYPES as readonly string[]).includes(l.type))) P(`${at}.type must be a v3 LedgerEntry type or an ADR-0030 authority-lapse event (${AUTHORITY_LAPSE_EVENT_TYPES.join("|")}), got ${JSON.stringify(l.type)}`);
        if (!isNonEmptyString(l.note)) P(`${at}.note missing or empty`);
      });
    }

    // expected verification state
    const vs = c.expectedVerificationState;
    if (!isObj(vs)) P("expectedVerificationState object missing");
    else {
      const reached = isBool(vs.reached) ? vs.reached : undefined;
      if (reached === undefined) P("expectedVerificationState.reached must be a boolean");
      if (!isNonEmptyString(vs.note)) P("expectedVerificationState.note missing or empty");
      if (reached === true) {
        if (!(isNonEmptyString(vs.observedStatus) && (EXECUTION_STATES as readonly string[]).includes(vs.observedStatus))) {
          P(`expectedVerificationState.observedStatus must be one of ${EXECUTION_STATES.join("|")} when reached, got ${JSON.stringify(vs.observedStatus)}`);
        } else if (!refs.executionStates.has(vs.observedStatus)) {
          P(`expectedVerificationState.observedStatus "${vs.observedStatus}" is not a scenarios.yaml execution-class state`);
        }
      } else if (reached === false) {
        if (vs.observedStatus !== null) P("expectedVerificationState.observedStatus must be null when execution is not reached");
      }
    }

    // ---- cross-field CONSISTENCY (an incomplete/contradictory case is a defect) ----
    if (disposition === "blocked" || disposition === "prohibited") {
      if (authMode !== undefined && authMode !== "none") P(`a ${disposition} decision carries no authority: expectedAuthority.mode must be "none" (v3 invariants 8/9)`);
      if (isObj(auth) && Array.isArray(auth.stages) && auth.stages.length > 0) P(`a ${disposition} decision carries no approval stages`);
      if (eligible === true) P(`a ${disposition} decision is not execution-eligible (expectedExecutionEligibility.eligible must be false)`);
      if (isObj(vs) && vs.reached === true) P(`a ${disposition} decision never reaches execution (expectedVerificationState.reached must be false)`);
    }
    if (disposition === "proceed") {
      if (authMode === "none") P('a proceed decision must state an authority mode other than "none" (automatic|approval|specialist_review)');
      if ((authMode === "approval" || authMode === "specialist_review") && isObj(auth) && Array.isArray(auth.stages) && auth.stages.length === 0) {
        P(`a proceed decision in ${authMode} mode must define at least one approval stage`);
      }
    }
  }

  // every spec-enumerated case is covered
  for (const name of REQUIRED_SPEC_NAMES) {
    if (!seenSpecNames.has(name)) problems.push(`required spec case "${name}" is not covered by any fixture's specName`);
  }

  // doc→fixture direction: every full case id the doc names must exist as a
  // fixture (the fixture→doc direction is checked per case above), so a deleted
  // fixture whose doc rows remain is caught, not just a renamed doc reference.
  for (const docId of new Set(docText.match(/\bGC-\d\d-[a-z0-9-]+/g) ?? [])) {
    if (!seenIds.has(docId)) problems.push(`docs/golden-cases.md references case id "${docId}" but no such fixture is loaded (stale doc reference / deleted fixture)`);
  }
  return problems;
}
