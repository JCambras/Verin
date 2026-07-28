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
import type { DispositionKind } from "./model";

export type JourneyPass = "initial" | "revalidated";

// A fixed demo world clock keeps freshness and screenshots stable.
export const DEMO_NOW = "2026-07-26";
export const DEMO_TIME_ZONE = "America/New_York";
export const RETRIEVED_AT = "Jul 26, 09:14";
export const OBSERVED_RECENT = "2026-07-24"; // ~2 days old: fresh
export const OBSERVED_STALE = "2026-06-12"; // 44 days old: visibly receded, over policy age
export const DEADLINE = "August 15, 2026";

// ── The Smiths household (contract §2; scenarios.yaml household.required_shape) ──────
export const HOUSEHOLD = {
  name: "The Smith Household",
  advisor: "Dana Ellison, CFP",
} as const;

export interface AccountData {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly balanceMinor: number;
  readonly custodian: string;
}
export const ACCOUNTS: readonly AccountData[] = [
  { id: "acct-taxable", name: "Smith Family Taxable", kind: "Taxable brokerage", balanceMinor: 42_000_000, custodian: "Fidelity" },
  { id: "acct-joint", name: "Joint Taxable", kind: "Taxable brokerage", balanceMinor: 9_500_000, custodian: "Fidelity" },
  { id: "acct-roth", name: "Elaine Smith Roth IRA", kind: "Roth IRA", balanceMinor: 18_500_000, custodian: "Schwab" },
  { id: "acct-trad", name: "Robert Smith Traditional IRA", kind: "Traditional IRA", balanceMinor: 31_000_000, custodian: "Schwab" },
];

export const PLANNED_WITHDRAWAL_MONTHLY_MINOR = 800_000; // $8,000 / month, signed golden truth

/**
 * Liquidity evidence is bound to a signed case for one branch and one firm. A branch
 * without matching numeric authority renders a gap instead of inheriting another
 * case's figures. The optional revalidation snapshot is later evidence and never
 * appears on initial decision surfaces.
 */
export interface LiquiditySnapshotData {
  readonly availableCashMinor: number;
  readonly pendingActivityMinor: number;
  readonly pendingNote: string;
}
export interface SignedLiquidityAuthority {
  readonly kind: "signed";
  readonly sourceCaseId: string;
  readonly requestAt: string;
  readonly initialDecision: LiquiditySnapshotData;
  readonly preExecutionRevalidation?: LiquiditySnapshotData;
  readonly preExecutionRevalidationAt?: string;
  readonly relatedDecisions?: readonly SignedRelatedDecisionAuthority[];
}
export interface SignedRelatedDecisionAuthority {
  readonly sourceCaseId: string;
  readonly requestAt: string;
  readonly disposition: DispositionKind;
  readonly initialDecision: LiquiditySnapshotData;
}
export interface MissingLiquidityAuthority {
  readonly kind: "missing";
  readonly reason: string;
}
export type LiquidityAuthority = SignedLiquidityAuthority | MissingLiquidityAuthority;
const NO_PENDING_ACTIVITY = "No pending or reserved liquidity activity was observed at evaluation time";
const SIGNED_CASE_TIMES = {
  "GC-01-firm-a-happy-path": {
    requestAt: "2026-07-26T13:30:00.000Z",
  },
  "GC-02-firm-b-happy-path": {
    requestAt: "2026-07-26T13:30:00.000Z",
  },
  "GC-03-recent-bank-change-firm-a": {
    requestAt: "2026-07-26T13:30:00.000Z",
  },
  "GC-10-simultaneous-distributions-first": {
    requestAt: "2026-07-26T19:00:00.000Z",
  },
  "GC-11-simultaneous-distributions-second": {
    requestAt: "2026-07-26T19:00:30.000Z",
  },
  "GC-12-duplicate-retry": {
    requestAt: "2026-07-26T20:10:00.000Z",
  },
  "GC-13-partial-salesforce-success": {
    requestAt: "2026-07-26T20:45:00.000Z",
  },
  "GC-14-delayed-nigo": {
    requestAt: "2026-07-26T21:15:00.000Z",
  },
  "GC-15-approval-invalidation": {
    requestAt: "2026-07-26T21:45:00.000Z",
    preExecutionRevalidationAt: "2026-07-26T21:58:02.000Z",
  },
  "GC-16-specialist-review-expiration": {
    requestAt: "2026-07-26T22:20:00.000Z",
  },
} as const;
type SignedCaseId = keyof typeof SIGNED_CASE_TIMES;
const signedLiquidity = (
  sourceCaseId: SignedCaseId,
  availableCashMinor: number,
  pendingActivityMinor = 0,
  pendingNote = NO_PENDING_ACTIVITY,
  preExecutionRevalidation?: LiquiditySnapshotData,
  relatedDecisions?: readonly SignedRelatedDecisionAuthority[],
): SignedLiquidityAuthority => {
  const caseTimes = SIGNED_CASE_TIMES[sourceCaseId] as {
    readonly requestAt: string;
    readonly preExecutionRevalidationAt?: string;
  };
  return {
    kind: "signed",
    sourceCaseId,
    requestAt: caseTimes.requestAt,
    initialDecision: { availableCashMinor, pendingActivityMinor, pendingNote },
    ...(preExecutionRevalidation ? { preExecutionRevalidation } : {}),
    ...(preExecutionRevalidation && caseTimes.preExecutionRevalidationAt
      ? { preExecutionRevalidationAt: caseTimes.preExecutionRevalidationAt }
      : {}),
    ...(relatedDecisions ? { relatedDecisions } : {}),
  };
};
const relatedDecision = (
  sourceCaseId: SignedCaseId,
  disposition: DispositionKind,
  availableCashMinor: number,
  pendingActivityMinor: number,
  pendingNote: string,
): SignedRelatedDecisionAuthority => ({
  sourceCaseId,
  requestAt: SIGNED_CASE_TIMES[sourceCaseId].requestAt,
  disposition,
  initialDecision: { availableCashMinor, pendingActivityMinor, pendingNote },
});
const INVALIDATION_LIQUIDITY = signedLiquidity(
  "GC-15-approval-invalidation",
  30_000_000,
  0,
  NO_PENDING_ACTIVITY,
  {
    availableCashMinor: 30_000_000,
    pendingActivityMinor: 1_500_000,
    pendingNote: "A new approved distribution of $15,000 has not settled and now reduces effective liquidity to $285,000",
  },
);

// Bank instructions (required shape: a recently changed bank instruction).
export const BANK_INSTRUCTION = {
  stable: "Chase ····4417 (Robert & Elaine Smith)",
  changed: "Chase ····8802 (Robert & Elaine Smith, new checking)",
  changedOn: OBSERVED_RECENT,
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
  readonly dualApprovalThresholdMinor: number;
  readonly approvalsRequired: number;
  readonly eligibleRole: string | null;
  readonly bankChangeHandling: "specialist-review" | "block-until-independently-verified";
  readonly policyVersion: string;
  readonly policyActiveSince: string;
}
export const FIRMS: Record<string, FirmData> = {
  "firm-a": {
    id: "firm-a",
    name: "Firm A",
    reserveMonths: 6,
    dualApprovalThresholdMinor: 2_500_000, // $25,000
    approvalsRequired: 2,
    eligibleRole: "operations",
    bankChangeHandling: "specialist-review",
    policyVersion: "FA-4.2",
    policyActiveSince: "2026-05-01",
  },
  "firm-b": {
    id: "firm-b",
    name: "Firm B",
    reserveMonths: 12,
    dualApprovalThresholdMinor: 10_000_000, // $100,000
    approvalsRequired: 2,
    eligibleRole: null, // contract silence - not invented (scenarios.yaml firms note)
    bankChangeHandling: "block-until-independently-verified",
    policyVersion: "FB-2.1",
    policyActiveSince: "2026-06-18",
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

// The demo cast (synthetic personas, labeled like all fixture data).
export const CAST = {
  requester: "Dana Ellison",
  opsApprover1: "Miguel Torres",
  opsApprover2: "Priya Nair",
  specialist: "Alex Kim",
  principal: "Jordan Bell",
} as const;

// Stable fake identifiers (rendered font-mono; full values print on the record).
export const IDS = {
  decisionHash: "a3f9c2e41b7d5f08c6a92e13b48d70f5e21c9a6b3d84f07a5c1e92b64d38a7f0",
  bundleHash: "5e21c9a6b3d84f07a5c1e92b64d38a7f0a3f9c2e41b7d5f08c6a92e13b48d70f",
  derivedDecisionHash: "d9124aef6b8c37e029f154c8a6d3b25e78fc41a6d90b2e573c8f14a625db9e70",
  refreshedBundleHash: "9b47c18d5e620af3d7861c4b892ef530a14d768ce305bf42a79e16dc4f823b51",
  idempotencyKey: "mm-smiths-renovation-aug15-4c7f",
  reservationId: "rsv-8f21-smiths-liquidity",
  conflictKeys: ["liquidity:smiths:2026-08", "bank-instruction:smiths:chase-4417"],
  auditPosition: "org demo-org · sequence 214",
} as const;

// ── The twelve scenario branches (contract §5; scenarios.yaml scenarios) ─────────────
// `disposition`/`perFirm` mirror scenarios.yaml exactly (fenced). `spec` states which
// contract facts the branch varies - it selects pre-authored view-model content in the
// fake service; it never computes an outcome.
export interface ScenarioSpec {
  readonly bankChanged?: boolean;
  readonly staleLiquidity?: boolean;
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
  readonly outcomeClassByFirm?: Record<string, string>;
  readonly spec: ScenarioSpec;
  readonly signedLiquidity?: Readonly<Record<string, SignedLiquidityAuthority>>;
}
export const SCENARIOS: readonly ScenarioData[] = [
  { id: "safe-proceed", title: "Safe proceed", description: "No policy, liquidity, or instruction issue; the request proceeds through approval to a governed submission.", outcomeClass: "governed submission", disposition: "proceed", spec: {}, signedLiquidity: { "firm-a": signedLiquidity("GC-01-firm-a-happy-path", 42_000_000), "firm-b": signedLiquidity("GC-02-firm-b-happy-path", 42_000_000) } },
  { id: "recent-bank-change-block", title: "Recent bank change", description: "The recently changed bank instruction triggers each firm's configured handling for the same facts.", outcomeClass: "firm-aware bank-change handling", outcomeClassByFirm: { "firm-a": "specialist review before execution", "firm-b": "blocked until independent verification" }, disposition: "blocked", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { bankChanged: true }, signedLiquidity: { "firm-a": signedLiquidity("GC-03-recent-bank-change-firm-a", 42_000_000) } },
  { id: "permanent-prohibition", title: "Permanent prohibition", description: "The requested movement violates the household-specific destination restriction; no approval can waive it.", outcomeClass: "permanent prohibition", disposition: "prohibited", spec: { thirdPartyDestination: true } },
  { id: "stale-evidence", title: "Stale evidence", description: "Material evidence is older than policy allows; the decision blocks until a fresh snapshot resolves it.", outcomeClass: "resolvable block", disposition: "blocked", spec: { staleLiquidity: true } },
  { id: "ambiguous-instruction", title: "Ambiguous instruction", description: "A household or bank instruction is ambiguous; the decision blocks pending human disambiguation outside the model.", outcomeClass: "resolvable block", disposition: "blocked", spec: { conflictingInstruction: true } },
  { id: "dual-approval", title: "Dual approval", description: "The amount exceeds Firm A's threshold, requiring two distinct operations approvers with Firm A's requester constraint applied.", outcomeClass: "quorum approval", disposition: "proceed", spec: {} },
  { id: "approval-invalidation", title: "Approval invalidation", description: "Material evidence changes after approval; pre-execution revalidation invalidates the approval before any execution.", outcomeClass: "approval invalidated", disposition: "proceed", spec: { invalidation: true }, signedLiquidity: { "firm-a": INVALIDATION_LIQUIDITY } },
  { id: "competing-liquidity", title: "Competing liquidity", description: "Two simultaneous requests test the shared-liquidity controls under each firm's policy.", outcomeClass: "firm-aware liquidity control", outcomeClassByFirm: { "firm-a": "first request proceeds; sibling blocked by reservation", "firm-b": "first request blocked by twelve-month reserve before reservation" }, disposition: "proceed", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { competing: true }, signedLiquidity: { "firm-a": signedLiquidity("GC-10-simultaneous-distributions-first", 16_000_000, 0, NO_PENDING_ACTIVITY, undefined, [relatedDecision("GC-11-simultaneous-distributions-second", "blocked", 16_000_000, 7_500_000, "The first request's active $75,000 reservation reduces the sibling request's effective liquidity to $85,000")]) } },
  { id: "duplicate-retry", title: "Duplicate retry", description: "A retry or double-click after submission is suppressed by the stable idempotency key; exactly one external instruction exists.", outcomeClass: "duplicate suppressed", disposition: "proceed", spec: { duplicateRetry: true }, signedLiquidity: { "firm-a": signedLiquidity("GC-12-duplicate-retry", 42_000_000) } },
  { id: "partial-salesforce-success", title: "Partial success", description: "The external capability reports partial success; completed and incomplete parts are recorded honestly and an exception decision is requested.", outcomeClass: "partial success, exception requested", disposition: "proceed", spec: { partial: true }, signedLiquidity: { "firm-a": signedLiquidity("GC-13-partial-salesforce-success", 42_000_000) } },
  { id: "delayed-nigo", title: "Delayed NIGO", description: "A NIGO arrives after a submitted status; it is ingested late and derives an exception decision.", outcomeClass: "delayed NIGO, exception requested", disposition: "proceed", spec: { delayedNigo: true }, signedLiquidity: { "firm-b": signedLiquidity("GC-14-delayed-nigo", 42_000_000) } },
  { id: "specialist-review-expiration", title: "Specialist-review expiration", description: "The configured escalation fires before unresolved specialist authority reaches its projected expiry.", outcomeClass: "firm-aware authority outcome", outcomeClassByFirm: { "firm-a": "specialist review escalated, then expired", "firm-b": "blocked until independent verification" }, disposition: "proceed", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { bankChanged: true, specialistExpired: true }, signedLiquidity: { "firm-a": signedLiquidity("GC-16-specialist-review-expiration", 42_000_000) } },
];
const DEFAULT_SCENARIO = "safe-proceed";

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
export function outcomeClassFor(scenario: ScenarioData, firmId: string): string {
  return scenario.outcomeClassByFirm?.[firmId] ?? scenario.outcomeClass;
}
export function liquidityAuthorityFor(scenario: ScenarioData, firmId: string): LiquidityAuthority {
  return scenario.signedLiquidity?.[firmId] ?? {
    kind: "missing",
    reason: `No captain-signed numeric liquidity case covers ${scenario.id} for ${firmId}`,
  };
}
export function launcherFirmFor(scenario: ScenarioData): string {
  return Object.keys(scenario.signedLiquidity ?? {})[0] ?? DEFAULT_FIRM;
}
