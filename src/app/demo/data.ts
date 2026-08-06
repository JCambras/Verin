/**
 * STATIC CONTRACT DATA for the demo skeleton - the Smiths world, the two firms, the
 * canonical request, and the twelve scenario branches. This mirrors, as typed inert
 * constants, the machine-usable contract data in `config/demo/scenarios.yaml` and
 * `docs/demo-contract.md` (the source of truth). The demo-skeleton-honesty fence
 * asserts these ids and dispositions stay EQUAL to scenarios.yaml, so the skeleton
 * cannot drift into inventing decisions the contract does not state.
 *
 * All figures are labeled synthetic (charter #3). Money is in USD minor units (cents).
 * Nothing here is computed at render time: the per-scenario `disposition` is contract
 * data (the same value scenarios.yaml carries), never derived in a component.
 */
import type { Role } from "@contracts/roles";
import {
  DEFAULT_APPROVAL_CLOCK,
  FRESHNESS_DAYS,
  closedChoiceValue,
  type BankChangeHandling,
} from "./closed-choices";
import type {
  DispositionKind,
  RequesterParticipation,
} from "./model";

export const DEMO_TIME_ZONE = "America/New_York";

function timestampParts(iso: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: DEMO_TIME_ZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
}

export function demoTimestampLabel(iso: string, includeYear = false): string {
  const parts = timestampParts(iso);
  return `${parts.month} ${parts.day}${includeYear ? `, ${parts.year}` : ""}, ${parts.hour}:${parts.minute}`;
}

function activationTimestampLabel(iso: string): string {
  const parts = timestampParts(iso);
  return `${parts.month} ${parts.day}, ${parts.year} at ${parts.hour}:${parts.minute} ET`;
}

export const DEMO_TIMELINE = {
  decisionDate: "2026-07-28",
  activationAt: "2026-07-28T14:00:00.000Z",
  pendingActivityObservedAt: "2026-07-28T14:00:30.000Z",
  evidenceRetrievedAt: "2026-07-28T14:01:00.000Z",
  recommendationRetrievedAt: "2026-07-28T14:03:00.000Z",
  decisionCreatedAt: "2026-07-28T14:05:00.000Z",
  specialistReviewedAt: "2026-07-28T14:15:00.000Z",
  operationsApproval1At: "2026-07-28T14:32:00.000Z",
  operationsApproval2At: "2026-07-28T14:41:00.000Z",
  revalidatedAt: "2026-07-28T17:58:00.000Z",
  executionSubmittedAt: "2026-07-28T18:02:00.000Z",
  duplicateSuppressedAt: "2026-07-28T18:03:00.000Z",
  executionVerifiedAt: "2026-07-28T19:40:00.000Z",
  nextPollAt: "2026-07-29T10:00:00.000Z",
  specialistRearmedAt: "2026-07-30T14:15:00.000Z",
  delayedNigoAt: "2026-07-30T11:12:00.000Z",
  stuckAt: "2026-07-30T18:02:00.000Z",
} as const;

export const DEMO_CAUSAL_SEQUENCE = [
  "activationAt",
  "pendingActivityObservedAt",
  "evidenceRetrievedAt",
  "recommendationRetrievedAt",
  "decisionCreatedAt",
  "specialistReviewedAt",
  "operationsApproval1At",
  "operationsApproval2At",
  "revalidatedAt",
  "executionSubmittedAt",
  "executionVerifiedAt",
] as const;

export function demoTimelineViolations(
  timeline: Readonly<
    Record<(typeof DEMO_CAUSAL_SEQUENCE)[number], string>
  >,
): string[] {
  const violations: string[] = [];
  for (let index = 1; index < DEMO_CAUSAL_SEQUENCE.length; index += 1) {
    const beforeKey = DEMO_CAUSAL_SEQUENCE[index - 1]!;
    const afterKey = DEMO_CAUSAL_SEQUENCE[index]!;
    const before = Date.parse(timeline[beforeKey]);
    const after = Date.parse(timeline[afterKey]);
    if (
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      before >= after
    ) {
      violations.push(`${beforeKey} must precede ${afterKey}`);
    }
  }
  return violations;
}

export const DEMO_NOW = DEMO_TIMELINE.decisionDate;
export const DEMO_ACTIVATION_EFFECTIVE_AT = activationTimestampLabel(
  DEMO_TIMELINE.activationAt,
);
export const DEMO_RECORD_CREATED_AT = demoTimestampLabel(
  DEMO_TIMELINE.decisionCreatedAt,
  true,
);
export const DEMO_REQUEST_REF = `request:smiths-renovation@demo-${DEMO_TIMELINE.decisionDate}`;
export const DEMO_EVIDENCE_REF = `smiths-evidence@${DEMO_TIMELINE.evidenceRetrievedAt}`;
export const DEMO_REVALIDATION_EVIDENCE_REF = `smiths-evidence@${DEMO_TIMELINE.revalidatedAt}`;
export const OBSERVED_RECENT = "2026-07-24";
export const OBSERVED_BANK_INSTRUCTION_CHANGED = "2026-07-22";
export const OBSERVED_GC09_BALANCE = "2026-07-26";
export const OBSERVED_STALE = "2026-06-09"; // visibly receded, over policy age
export const DEADLINE = "August 15, 2026";

/** How old the GC-09 planned-withdrawal snapshot is at the demo clock. DERIVED from
 * the signed observation, never typed beside it: a hand-written age drifts silently
 * the moment either date moves. */
export const PLANNED_WITHDRAWAL_STALE_AGE_DAYS =
  (Date.parse(DEMO_NOW) - Date.parse(OBSERVED_STALE)) / 86_400_000;

// ── The Smiths household (contract §2; scenarios.yaml household.required_shape) ──────
export const HOUSEHOLD = {
  name: "The Smith Household",
  advisor: "Dana Ellison, CFP",
} as const;

export interface AccountData {
  readonly id: string;
  readonly subjectRef: string;
  readonly name: string;
  readonly kind: string;
  readonly balanceMinor: number;
  readonly custodian: string;
}
export const ACCOUNTS: readonly AccountData[] = [
  { id: "acct-taxable", subjectRef: "subject:smiths-family-taxable", name: "Smith Family Taxable", kind: "Taxable brokerage", balanceMinor: 42_000_000, custodian: "Fidelity" },
  { id: "acct-joint", subjectRef: "subject:smiths-joint-taxable", name: "Joint Taxable", kind: "Taxable brokerage", balanceMinor: 9_500_000, custodian: "Fidelity" },
  { id: "acct-roth", subjectRef: "subject:elaine-smith-roth-ira", name: "Elaine Smith Roth IRA", kind: "Roth IRA", balanceMinor: 18_500_000, custodian: "Schwab" },
  { id: "acct-trad", subjectRef: "subject:robert-smith-traditional-ira", name: "Robert Smith Traditional IRA", kind: "Traditional IRA", balanceMinor: 31_000_000, custodian: "Schwab" },
];

// The monthly withdrawal schedule is captain-signed golden truth (GC-01/02/03/05:
// $8,000/month), so Firm A reserve = 6 * $8,000 = $48,000 and Firm B = 12 * $8,000 =
// $96,000. Reserve dollars are always derived and are never stored as separate
// constants.
export const PLANNED_WITHDRAWAL_MONTHLY_MINOR = 800_000; // $8,000 / month

// Bank instructions (required shape: a recently changed bank instruction).
export const BANK_INSTRUCTION = {
  stable: "Chase ····4417 (Robert & Elaine Smith)",
  changed: "Chase ····8802 (Robert & Elaine Smith, new checking)",
  changedOn: OBSERVED_BANK_INSTRUCTION_CHANGED,
  changedAgeDays:
    (Date.parse(DEMO_NOW) -
      Date.parse(OBSERVED_BANK_INSTRUCTION_CHANGED)) /
    86_400_000,
} as const;

// The household-specific destination restriction (drives the permanent prohibition).
export const DESTINATION_RESTRICTION = {
  text: "No distributions to third-party or business accounts not owned by a household member",
  ref: "HH-INSTR-SMITH-004 v3",
} as const;
export const THIRD_PARTY_DESTINATION = "Hartwell Construction LLC operating account (third party)";

// ── The two firms (contract §2; scenarios.yaml firms) ───────────────────────────────
export interface FirmData {
  readonly id: string;
  readonly name: string;
  readonly reserveMonths: number;
  /** The firm's evidence-freshness choice, named by OPTION ID. The days behind it
   * live once, in FRESHNESS_DAYS - a firm never carries a second copy of the number. */
  readonly freshnessOptionId: string;
  readonly dualApprovalThresholdMinor: number;
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly standardApprovalRole: "operations" | null;
  readonly requesterParticipation: RequesterParticipation;
  readonly bankChangeHandling: BankChangeHandling;
  readonly policyVersion: string;
}
export const FIRMS: Record<string, FirmData> = {
  "firm-a": {
    id: "firm-a",
    name: "Firm A",
    reserveMonths: 6,
    freshnessOptionId: "30-days",
    dualApprovalThresholdMinor: 2_500_000, // $25,000
    approvalsRequired: 2,
    distinctActorsRequired: true,
    standardApprovalRole: "operations",
    requesterParticipation: {
      mode: "excluded",
      constraint: "may-not-satisfy-both-approvals",
    },
    bankChangeHandling: "specialist-review",
    policyVersion: "FA-4.2",
  },
  "firm-b": {
    id: "firm-b",
    name: "Firm B",
    reserveMonths: 12,
    freshnessOptionId: "30-days",
    dualApprovalThresholdMinor: 10_000_000, // $100,000
    approvalsRequired: 2,
    distinctActorsRequired: true,
    standardApprovalRole: null, // contract silence - not invented (scenarios.yaml firms note)
    requesterParticipation: { mode: "unbound" },
    bankChangeHandling: "block-until-independently-verified",
    policyVersion: "FB-2.1",
  },
};
export const DEFAULT_FIRM = "firm-a";

// ── The canonical request (contract §2) ─────────────────────────────────────────────
export const CANONICAL_REQUEST = {
  text: "The Smiths need $75,000 for their home renovation by August 15.",
  amountMinor: 7_500_000,
  purpose: "home renovation",
  deadline: DEADLINE,
} as const;

/**
 * SIGNED LIQUIDITY CASES. Every reserve projection in the demo names one of these,
 * so no surface can model the same request with a different liquidity basis. Each
 * field is captain-signed golden truth and the demo-semantic-truth fence pins all
 * three terms (available, pending, request) against the fixture that states them.
 * A projection is never given a partial basis: dropping the pending term or the
 * request term silently overstates headroom.
 */
export interface SignedLiquidityCase {
  readonly caseRef: string;
  /** The account row whose displayed balance IS this basis's available cash, or null
   * when the case states a basis no account fixture renders. Naming it keeps ONE
   * observation date on one datum: the account row and the liquidity block are the
   * same dollars, so they can never be stamped "as of" two different days. */
  readonly availableAccountId: string | null;
  readonly availableMinor: number;
  readonly pendingMinor: number;
  readonly requestMinor: number;
}
/** GC-01 / GC-02 (and GC-03 / GC-04, which restate the same basis): $420,000
 * available taxable liquidity, NO pending distribution, the $75,000 request. The
 * balance is read from the account fixture rather than restated. */
export const SMITHS_LIQUIDITY: SignedLiquidityCase = {
  caseRef: "GC-01 / GC-02",
  availableAccountId: ACCOUNTS[0]!.id,
  availableMinor: ACCOUNTS[0]!.balanceMinor,
  pendingMinor: 0,
  requestMinor: CANONICAL_REQUEST.amountMinor,
};
/** GC-05: $160,000 available, $20,000 pending and unsettled, the same $75,000
 * request. This is the only signed basis on which a reserve horizon changes the
 * disposition, so the setup's low-headroom card reads it instead of restating it. */
export const LOW_HEADROOM_LIQUIDITY: SignedLiquidityCase = {
  caseRef: "GC-05",
  availableAccountId: null,
  availableMinor: 16_000_000,
  pendingMinor: 2_000_000,
  requestMinor: CANONICAL_REQUEST.amountMinor,
};

export interface DecisionIdentity {
  readonly decisionId: string;
  readonly inputHash: string;
  readonly decisionHash: string;
  readonly bundleHash: string;
}

export interface DecisionConfiguration {
  readonly policyVersion: string;
  readonly reserveMonths: number;
  readonly freshnessDays: number;
  readonly bankChangeHandling: FirmData["bankChangeHandling"];
  readonly dualApprovalThresholdMinor: number;
  readonly approvalsRequired: number;
  readonly distinctActorsRequired: boolean;
  readonly standardApprovalRole: FirmData["standardApprovalRole"];
  readonly requesterParticipation: RequesterParticipation;
  readonly approvalClockId: string;
  readonly activatedSnapshotHash: string | null;
  readonly activationAuthority: {
    readonly actorId: string;
    readonly role: Role;
    readonly attestationStatementVersion: string;
    readonly draftGeneration: number;
    readonly selectionsHash: string;
    readonly setupVersionDigest: string;
  } | null;
}

// The demo cast (synthetic personas, labeled like all fixture data).
export const CAST = {
  requester: "Dana Ellison",
  opsApprover1: "Miguel Torres",
  opsApprover2: "Priya Nair",
  specialist: "Alex Kim",
  operationsManager: "Jordan Bell",
} as const;

// Stable fake identifiers (rendered font-mono; full values print on the record).
export const IDS = {
  idempotencyKey: "mm-smiths-renovation-aug15-4c7f",
  reservationId: "rsv-8f21-smiths-liquidity",
  conflictKeys: ["liquidity:smiths:2026-08", "bank-instruction:smiths:chase-4417"],
  auditPosition: "org demo-org · sequence 214",
} as const;

export interface PendingDistributionPhase {
  readonly amountMinor: number;
  readonly observedAt: string;
  readonly retrievedAt: string;
}

export interface PendingDistributionDelta {
  readonly before: PendingDistributionPhase;
  readonly deltaMinor: number;
  readonly after: PendingDistributionPhase;
}

export const GC15_PENDING_DISTRIBUTION: PendingDistributionDelta = {
  before: {
    amountMinor: 0,
    observedAt: DEMO_TIMELINE.pendingActivityObservedAt,
    retrievedAt: DEMO_TIMELINE.evidenceRetrievedAt,
  },
  deltaMinor: 1_500_000,
  after: {
    amountMinor: 1_500_000,
    observedAt: DEMO_TIMELINE.revalidatedAt,
    retrievedAt: DEMO_TIMELINE.revalidatedAt,
  },
};

export function usdMinor(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US")}`;
}

export function pendingDistributionDeltaSentence(
  delta: PendingDistributionDelta,
): string {
  return `A ${usdMinor(delta.deltaMinor)} pending distribution posted after this approval was given.`;
}

// ── The twelve scenario branches (contract §5; scenarios.yaml scenarios) ─────────────
// `disposition`/`perFirm` mirror scenarios.yaml exactly (fenced). `spec` states which
// contract facts the branch varies - it selects pre-authored view-model content in the
// fake service; it never computes an outcome.
export interface ScenarioSpec {
  readonly bankChanged?: boolean;
  readonly stalePlannedWithdrawals?: boolean;
  readonly conflictingInstruction?: boolean;
  readonly thirdPartyDestination?: boolean;
  readonly invalidation?: boolean;
  readonly competing?: boolean;
  readonly duplicateRetry?: boolean;
  readonly partial?: boolean;
  readonly delayedNigo?: boolean;
  readonly specialistExpired?: boolean;
}
export interface ScenarioData {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly outcomeClass: string;
  readonly disposition: DispositionKind;
  readonly perFirm?: Record<string, DispositionKind>;
  readonly spec: ScenarioSpec;
}
export const SCENARIOS: readonly ScenarioData[] = [
  { id: "safe-proceed", title: "Safe proceed", description: "No policy, liquidity, or instruction issue; the request proceeds through approval to a governed submission.", outcomeClass: "governed submission", disposition: "proceed", spec: {} },
  { id: "recent-bank-change-block", title: "Recent bank change", description: "The recently changed bank instruction triggers each firm's configured handling for the same facts.", outcomeClass: "resolvable block", disposition: "blocked", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { bankChanged: true } },
  { id: "permanent-prohibition", title: "Permanent prohibition", description: "The requested movement violates the household-specific destination restriction; no approval can waive it.", outcomeClass: "permanent prohibition", disposition: "prohibited", spec: { thirdPartyDestination: true } },
  { id: "stale-evidence", title: "Stale evidence", description: "Material evidence is older than policy allows; the decision blocks until a fresh snapshot resolves it.", outcomeClass: "resolvable block", disposition: "blocked", spec: { stalePlannedWithdrawals: true } },
  { id: "ambiguous-instruction", title: "Ambiguous instruction", description: "A household or bank instruction is ambiguous; the decision blocks pending human disambiguation outside the model.", outcomeClass: "resolvable block", disposition: "blocked", spec: { conflictingInstruction: true } },
  { id: "dual-approval", title: "Dual approval", description: "The amount exceeds Firm A's threshold, requiring two distinct operations approvers with Firm A's requester constraint applied.", outcomeClass: "quorum approval", disposition: "proceed", spec: {} },
  { id: "approval-invalidation", title: "Approval invalidation", description: "Material evidence changes after approval; pre-execution revalidation invalidates the approval before any execution.", outcomeClass: "approval invalidated", disposition: "proceed", spec: { invalidation: true } },
  { id: "competing-liquidity", title: "Competing liquidity", description: "Two simultaneous, individually valid requests compete for the same liquidity; reservations prevent a joint violation.", outcomeClass: "one proceeds, one blocked by reservation", disposition: "proceed", spec: { competing: true } },
  { id: "duplicate-retry", title: "Duplicate retry", description: "A retry or double-click after submission is suppressed by the stable idempotency key; exactly one external instruction exists.", outcomeClass: "duplicate suppressed", disposition: "proceed", spec: { duplicateRetry: true } },
  { id: "partial-salesforce-success", title: "Partial success", description: "The external capability reports partial success; completed and incomplete parts are recorded honestly and an exception decision is requested.", outcomeClass: "partial success, exception requested", disposition: "proceed", spec: { partial: true } },
  { id: "delayed-nigo", title: "Delayed NIGO", description: "A NIGO arrives after a submitted status; it is ingested late and derives an exception decision.", outcomeClass: "delayed NIGO, exception requested", disposition: "proceed", spec: { delayedNigo: true } },
  { id: "specialist-review-expiration", title: "Specialist-review expiration", description: "A specialist-review stage expires without action and escalates along the configured escalation path.", outcomeClass: "escalated", disposition: "proceed", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { bankChanged: true, specialistExpired: true } },
];
const DEFAULT_SCENARIO = "safe-proceed";

/** The ONE branch the setup-first demonstration activates and hashes. Declared here,
 * beside the branch it names, so the setup version digest and the evaluator can never
 * bind two different scenarios inside the same computation. */
export const SETUP_SCENARIO_ID = "recent-bank-change-block";

export function scenarioById(id: string): ScenarioData {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}
export function firmById(id: string): FirmData {
  return FIRMS[id] ?? FIRMS[DEFAULT_FIRM]!;
}
/** Resolve a URL branch param: an ABSENT param falls back to the default, but an
 * UNKNOWN id returns null so the route can 404 - a typo'd demo URL must never
 * silently render a different branch than the presenter asked for. */
export function resolveScenarioId(id: string | undefined): string | null {
  if (id === undefined) return DEFAULT_SCENARIO;
  return SCENARIOS.some((s) => s.id === id) ? id : null;
}
export function resolveFirmId(id: string | undefined): string | null {
  if (id === undefined) return DEFAULT_FIRM;
  return id in FIRMS ? id : null;
}
/** The disposition this scenario lands on for this firm - recorded contract data. */
export function dispositionFor(scenario: ScenarioData, firmId: string): DispositionKind {
  return scenario.perFirm?.[firmId] ?? scenario.disposition;
}

export function decisionConfigurationFor(firm: FirmData): DecisionConfiguration {
  return {
    policyVersion: firm.policyVersion,
    reserveMonths: firm.reserveMonths,
    freshnessDays: closedChoiceValue(
      FRESHNESS_DAYS,
      firm.freshnessOptionId,
      "freshness",
    ),
    bankChangeHandling: firm.bankChangeHandling,
    dualApprovalThresholdMinor: firm.dualApprovalThresholdMinor,
    approvalsRequired: firm.approvalsRequired,
    distinctActorsRequired: firm.distinctActorsRequired,
    standardApprovalRole: firm.standardApprovalRole,
    requesterParticipation: firm.requesterParticipation,
    approvalClockId: DEFAULT_APPROVAL_CLOCK.id,
    activatedSnapshotHash: null,
    activationAuthority: null,
  };
}
