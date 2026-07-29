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
import {
  SIGNED_CASE_BY_ID,
  type SignedCaseId,
  type SignedCaseVariant,
  type SignedExecutionEligibilityData,
} from "./signed-cases";

export type JourneyPass = "initial" | "revalidated";

export function evidenceForPass(
  sourceCase: SignedCaseVariant | null | undefined,
  pass: JourneyPass,
) {
  return (
    sourceCase?.evidence.filter(
      (entry) =>
        entry.liquidityPhase === null ||
        entry.liquidityPhase ===
          (pass === "revalidated"
            ? "pre-execution-revalidation"
            : "initial-decision"),
    ) ?? []
  );
}

// A fixed demo world clock keeps freshness and screenshots stable.
export const DEMO_NOW = "2026-07-26";
export const DEMO_TIME_ZONE = "America/New_York";
export const RETRIEVED_AT = "Jul 26, 09:14";
export const OBSERVED_RECENT = "2026-07-24"; // ~2 days old: fresh
export const DEADLINE = "August 15, 2026";

// ── The Smiths household (contract §2; scenarios.yaml household.required_shape) ──────
export const HOUSEHOLD = {
  name: "The Smith Household",
  advisor: "Dana Ellison, CFP",
} as const;

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
  readonly requestAmountMinor: number;
  readonly disposition: DispositionKind;
  readonly initialDecision: LiquiditySnapshotData;
}
export interface MissingLiquidityAuthority {
  readonly kind: "missing";
  readonly sourceCaseId: string | null;
  readonly requestAt: string | null;
  readonly reason: string;
}
export type LiquidityAuthority = SignedLiquidityAuthority | MissingLiquidityAuthority;
const NO_PENDING_ACTIVITY = "No pending or reserved liquidity activity was observed at evaluation time";

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
  requestedAt: "2026-07-26T13:30:00.000Z",
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
  readonly sourceCaseIdsByFirm?: Readonly<
    Record<string, readonly SignedCaseId[]>
  >;
  readonly relatedSourceCasesByFirm?: Readonly<Record<string, readonly SignedCaseId[]>>;
}
export const SCENARIOS: readonly ScenarioData[] = [
  { id: "safe-proceed", title: "Safe proceed", description: "No policy, liquidity, or instruction issue; the request proceeds through approval to a governed submission.", outcomeClass: "governed submission", disposition: "proceed", spec: {}, sourceCaseIdsByFirm: { "firm-a": ["GC-01-firm-a-happy-path"], "firm-b": ["GC-02-firm-b-happy-path"] } },
  { id: "recent-bank-change-block", title: "Recent bank change", description: "The recently changed bank instruction triggers each firm's configured handling for the same facts.", outcomeClass: "firm-aware bank-change handling", outcomeClassByFirm: { "firm-a": "specialist review before execution", "firm-b": "blocked until independent verification" }, disposition: "blocked", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { bankChanged: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-03-recent-bank-change-firm-a"], "firm-b": ["GC-04-recent-bank-change-firm-b"] } },
  { id: "permanent-prohibition", title: "Permanent prohibition", description: "The exact signed case determines whether a household restriction or regulatory legal hold controls the same prohibited scenario.", outcomeClass: "permanent prohibition", disposition: "prohibited", spec: { thirdPartyDestination: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-06-household-restriction", "GC-07-regulatory-prohibition"] } },
  { id: "stale-evidence", title: "Stale evidence", description: "Material evidence is older than policy allows; the decision blocks until a fresh snapshot resolves it.", outcomeClass: "resolvable block", disposition: "blocked", spec: { staleLiquidity: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-09-stale-evidence"] } },
  { id: "ambiguous-instruction", title: "Ambiguous instruction", description: "A household or bank instruction is ambiguous; the decision blocks pending human disambiguation outside the model.", outcomeClass: "resolvable block", disposition: "blocked", spec: { conflictingInstruction: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-08-ambiguous-household"] } },
  { id: "dual-approval", title: "Dual approval", description: "The amount exceeds Firm A's threshold, requiring two distinct operations approvers with Firm A's requester constraint applied.", outcomeClass: "quorum approval", disposition: "proceed", spec: {} },
  { id: "approval-invalidation", title: "Approval invalidation", description: "Material evidence changes after approval; pre-execution revalidation invalidates the approval before any execution.", outcomeClass: "approval invalidated", disposition: "proceed", spec: { invalidation: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-15-approval-invalidation"] } },
  { id: "competing-liquidity", title: "Competing liquidity", description: "Two simultaneous requests test the shared-liquidity controls under each firm's policy.", outcomeClass: "firm-aware liquidity control", outcomeClassByFirm: { "firm-a": "first request proceeds; sibling blocked by reservation", "firm-b": "first request blocked by twelve-month reserve before reservation" }, disposition: "proceed", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { competing: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-10-simultaneous-distributions-first"] }, relatedSourceCasesByFirm: { "firm-a": ["GC-11-simultaneous-distributions-second"] } },
  { id: "duplicate-retry", title: "Duplicate retry", description: "A retry or double-click after submission is suppressed by the stable idempotency key; exactly one external instruction exists.", outcomeClass: "duplicate suppressed", disposition: "proceed", spec: { duplicateRetry: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-12-duplicate-retry"] } },
  { id: "partial-salesforce-success", title: "Partial success", description: "The external capability reports partial success; completed and incomplete parts are recorded honestly and an exception decision is requested.", outcomeClass: "partial success, exception requested", disposition: "proceed", spec: { partial: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-13-partial-salesforce-success"] } },
  { id: "delayed-nigo", title: "Delayed NIGO", description: "A NIGO arrives after a submitted status; it is ingested late and derives an exception decision.", outcomeClass: "delayed NIGO, exception requested", disposition: "proceed", spec: { delayedNigo: true }, sourceCaseIdsByFirm: { "firm-b": ["GC-14-delayed-nigo"] } },
  { id: "specialist-review-expiration", title: "Specialist-review expiration", description: "The configured escalation fires before unresolved specialist authority reaches its projected expiry.", outcomeClass: "firm-aware authority outcome", outcomeClassByFirm: { "firm-a": "specialist review escalated, then expired", "firm-b": "blocked until independent verification" }, disposition: "proceed", perFirm: { "firm-a": "proceed", "firm-b": "blocked" }, spec: { bankChanged: true, specialistExpired: true }, sourceCaseIdsByFirm: { "firm-a": ["GC-16-specialist-review-expiration"] } },
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
export function sourceCaseFor(
  scenario: ScenarioData,
  firmId: string,
  caseId?: SignedCaseId,
): SignedCaseVariant | null {
  const selectedCaseId =
    caseId ?? scenario.sourceCaseIdsByFirm?.[firmId]?.[0];
  if (
    !selectedCaseId ||
    !sourceCaseIdsFor(scenario, firmId).includes(selectedCaseId) ||
    !isExactSourceCase(scenario, firmId, selectedCaseId)
  ) {
    return null;
  }
  return SIGNED_CASE_BY_ID[selectedCaseId];
}
export function sourceCaseIdsFor(
  scenario: ScenarioData,
  firmId: string,
): readonly SignedCaseId[] {
  return [
    ...new Set([
      ...(scenario.sourceCaseIdsByFirm?.[firmId] ?? []),
      ...(scenario.relatedSourceCasesByFirm?.[firmId] ?? []),
    ]),
  ];
}
function ownsSourceCase(
  scenario: ScenarioData,
  firmId: string,
  caseId: SignedCaseId,
): boolean {
  const sourceCase = SIGNED_CASE_BY_ID[caseId];
  return (
    sourceCase.scenarioId === scenario.id &&
    sourceCase.firmId === firmId
  );
}
function isExactSourceCase(
  scenario: ScenarioData,
  firmId: string,
  caseId: SignedCaseId,
): boolean {
  const sourceCase = SIGNED_CASE_BY_ID[caseId];
  return (
    ownsSourceCase(scenario, firmId, caseId) &&
    sourceCase.disposition === dispositionFor(scenario, firmId)
  );
}
export function resolveSourceCaseId(
  scenario: ScenarioData,
  firmId: string,
  requestedCaseId: string | undefined,
): SignedCaseId | null {
  const candidates = sourceCaseIdsFor(scenario, firmId);
  const candidate = requestedCaseId ?? candidates[0];
  if (
    !candidate ||
    !candidates.includes(candidate as SignedCaseId) ||
    !ownsSourceCase(scenario, firmId, candidate as SignedCaseId)
  ) {
    return null;
  }
  return candidate as SignedCaseId;
}
export function bindExactSourceCase(
  scenario: ScenarioData,
  firmId: string,
  caseId: SignedCaseId,
): ScenarioData {
  if (
    !sourceCaseIdsFor(scenario, firmId).includes(caseId) ||
    !ownsSourceCase(scenario, firmId, caseId)
  ) {
    throw new TypeError(
      `${caseId} is not exact signed authority for ${scenario.id}/${firmId}`,
    );
  }
  const sourceCase = SIGNED_CASE_BY_ID[caseId];
  const siblingCaseIds = sourceCaseIdsFor(scenario, firmId).filter(
    (candidate) => candidate !== caseId,
  );
  return {
    ...scenario,
    perFirm: {
      ...scenario.perFirm,
      [firmId]: sourceCase.disposition,
    },
    sourceCaseIdsByFirm: {
      ...scenario.sourceCaseIdsByFirm,
      [firmId]: [caseId],
    },
    relatedSourceCasesByFirm: {
      ...scenario.relatedSourceCasesByFirm,
      [firmId]: siblingCaseIds,
    },
  };
}
export function executionEligibilityFor(
  scenario: ScenarioData,
  firmId: string,
): SignedExecutionEligibilityData | null {
  return sourceCaseFor(scenario, firmId)?.executionEligibility ?? null;
}
export function requestFor(
  scenario: ScenarioData,
  firmId: string,
): {
  readonly text: string;
  readonly amountMinor: number;
  readonly purpose: string;
  readonly deadline: string;
  readonly requestedAt: string;
} {
  void scenario;
  void firmId;
  return CANONICAL_REQUEST;
}
export function decisionIdentityFor(
  scenario: ScenarioData,
  firmId: string,
  pass: JourneyPass,
): string {
  const caseId = sourceCaseFor(scenario, firmId)?.caseId ?? "unsigned";
  return `dec:${scenario.id}:${firmId}:${caseId}:${pass}`;
}
function pendingNoteFor(
  sourceCase: SignedCaseVariant,
  liquidityPhase: string | null,
): string {
  const evidence = sourceCase.evidence.find(
    (entry) =>
      entry.evidenceKind === "pending-actions" &&
      (entry.liquidityPhase === liquidityPhase ||
        (liquidityPhase === null &&
          entry.liquidityPhase === "initial-decision")),
  );
  return evidence?.summary ?? NO_PENDING_ACTIVITY;
}
export function liquidityAuthorityFor(scenario: ScenarioData, firmId: string): LiquidityAuthority {
  const sourceCase = sourceCaseFor(scenario, firmId);
  if (
    !sourceCase ||
    sourceCase.money.availableLiquidityMinor === null ||
    sourceCase.money.pendingLiquidityMinor === null
  ) {
    return {
      kind: "missing",
      sourceCaseId: sourceCase?.caseId ?? null,
      requestAt: sourceCase?.trigger.requestAt ?? null,
      reason: `No captain-signed numeric liquidity case covers ${scenario.id} for ${firmId}`,
    };
  }
  const revalidationEvidence = sourceCase.evidence
    .filter(
      (entry) => entry.liquidityPhase === "pre-execution-revalidation",
    )
    .sort((left, right) =>
      left.retrievedAt.localeCompare(right.retrievedAt),
    )
    .at(-1);
  const relatedDecisions = scenario.relatedSourceCasesByFirm?.[firmId]
    ?.map((caseId): SignedRelatedDecisionAuthority | null => {
      const related = SIGNED_CASE_BY_ID[caseId];
      if (
        related.money.availableLiquidityMinor === null ||
        related.money.pendingLiquidityMinor === null
      ) {
        return null;
      }
      return {
        sourceCaseId: related.caseId,
        requestAt: related.trigger.requestAt,
        requestAmountMinor: related.money.requestAmountMinor,
        disposition: related.disposition,
        initialDecision: {
          availableCashMinor: related.money.availableLiquidityMinor,
          pendingActivityMinor: related.money.pendingLiquidityMinor,
          pendingNote: pendingNoteFor(related, null),
        },
      };
    })
    .filter((entry): entry is SignedRelatedDecisionAuthority => entry !== null);
  return {
    kind: "signed",
    sourceCaseId: sourceCase.caseId,
    requestAt: sourceCase.trigger.requestAt,
    initialDecision: {
      availableCashMinor: sourceCase.money.availableLiquidityMinor,
      pendingActivityMinor: sourceCase.money.pendingLiquidityMinor,
      pendingNote: pendingNoteFor(sourceCase, null),
    },
    ...(sourceCase.money.preExecutionRevalidation
      ? {
          preExecutionRevalidation: {
            availableCashMinor:
              sourceCase.money.preExecutionRevalidation.availableLiquidityMinor,
            pendingActivityMinor:
              sourceCase.money.preExecutionRevalidation.pendingLiquidityMinor,
            pendingNote: pendingNoteFor(
              sourceCase,
              "pre-execution-revalidation",
            ),
          },
          ...(revalidationEvidence
            ? { preExecutionRevalidationAt: revalidationEvidence.retrievedAt }
            : {}),
        }
      : {}),
    ...(relatedDecisions?.length ? { relatedDecisions } : {}),
  };
}
export function hasSignedInvalidationAuthority(
  scenario: ScenarioData,
  firmId: string,
): boolean {
  const authority = liquidityAuthorityFor(scenario, firmId);
  return (
    scenario.id === "approval-invalidation" &&
    firmId === "firm-a" &&
    scenario.spec.invalidation === true &&
    authority.kind === "signed" &&
    authority.sourceCaseId === "GC-15-approval-invalidation"
  );
}
export function launcherVariantsFor(scenario: ScenarioData): readonly {
  readonly firmId: string;
  readonly sourceCaseId: SignedCaseId | null;
}[] {
  const firmIds = new Set([
    ...Object.keys(scenario.sourceCaseIdsByFirm ?? {}),
    ...Object.keys(scenario.relatedSourceCasesByFirm ?? {}),
  ]);
  const variants = [...firmIds].flatMap(
    (firmId) =>
      sourceCaseIdsFor(scenario, firmId).map((sourceCaseId) => ({
        firmId,
        sourceCaseId,
      })),
  );
  return variants.length
    ? variants
    : [{ firmId: DEFAULT_FIRM, sourceCaseId: null }];
}
