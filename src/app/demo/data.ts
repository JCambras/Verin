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

// A fixed demo world clock keeps freshness and screenshots stable.
export const DEMO_NOW = "2026-07-26";
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

// Liquidity inputs. Chosen so the canonical request clears both firms' reserves:
// Firm A headroom = 200k - 6*6k - 40k = $124,000; Firm B = 200k - 72k - 40k = $88,000.
export const AVAILABLE_CASH_MINOR = 20_000_000; // $200,000 available cash
export const PLANNED_WITHDRAWAL_MONTHLY_MINOR = 600_000; // $6,000 / month
export const PENDING_DISTRIBUTION_MINOR = 4_000_000; // $40,000 approved, not yet settled

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
  readonly spec: ScenarioSpec;
}
export const SCENARIOS: readonly ScenarioData[] = [
  { id: "safe-proceed", title: "Safe proceed", description: "No policy, liquidity, or instruction issue; the request proceeds through approval to a governed submission.", outcomeClass: "governed submission", disposition: "proceed", spec: {} },
  { id: "recent-bank-change-block", title: "Recent bank change", description: "The recently changed bank instruction triggers each firm's configured handling for the same facts.", outcomeClass: "resolvable block", disposition: "blocked", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { bankChanged: true } },
  { id: "permanent-prohibition", title: "Permanent prohibition", description: "The requested movement violates the household-specific destination restriction; no approval can waive it.", outcomeClass: "permanent prohibition", disposition: "prohibited", spec: { thirdPartyDestination: true } },
  { id: "stale-evidence", title: "Stale evidence", description: "Material evidence is older than policy allows; the decision blocks until a fresh snapshot resolves it.", outcomeClass: "resolvable block", disposition: "blocked", spec: { staleLiquidity: true } },
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

export function scenarioById(id: string): ScenarioData {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!;
}
export function firmById(id: string): FirmData {
  return (Object.hasOwn(FIRMS, id) ? FIRMS[id] : undefined) ?? FIRMS[DEFAULT_FIRM]!;
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
  return Object.hasOwn(FIRMS, id) ? id : null;
}
/** The disposition this scenario lands on for this firm - recorded contract data. */
export function dispositionFor(scenario: ScenarioData, firmId: string): DispositionKind {
  return scenario.perFirm?.[firmId] ?? scenario.disposition;
}
