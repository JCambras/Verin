/**
 * Labeled fake builder for the bounded setup-first replacement.
 *
 * Domain arithmetic comes from the reserve projection. This file only translates
 * signed facts and pre-authored closed choices into presentation-ready view models.
 * It is deleted when the real policy lifecycle, simulator, and evaluator land.
 */
import { metric } from "@contracts/metric";
import { projectReserve } from "@domain/money-movement/reserve-projection";
import type {
  ChoiceEffectVM,
  FirmChoiceVM,
  MoneyMovementSetupVM,
  SetupChoiceOptionVM,
  SetupFirmId,
  SetupPolicyGroupVM,
} from "./setup-model";
import { RESERVE_FLOOR_INPUTS, derivedMetric, fixtureMetric, prov } from "./provenance";
import {
  CANONICAL_REQUEST,
  BANK_INSTRUCTION,
  DEMO_NOW,
  LOW_HEADROOM_LIQUIDITY,
  OBSERVED_RECENT,
  OBSERVED_GC09_BALANCE,
  OBSERVED_STALE,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SMITHS_LIQUIDITY,
  type SignedLiquidityCase,
} from "./data";

/** Whole dollars from integer minor units, for the one place a signed liquidity basis
 * is stated as prose. The numbers are never restated by hand. */
function usd(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US")}`;
}

function factsLine(liquidity: SignedLiquidityCase): string {
  return `${usd(liquidity.availableMinor)} available · ${usd(liquidity.pendingMinor)} pending · same ${usd(liquidity.requestMinor)} request`;
}

function effect(
  status: string,
  label: string,
  summary: string,
  detail: string,
  reachesAuthority?: boolean,
): ChoiceEffectVM {
  return {
    status: { status, label },
    summary,
    detail,
    ...(reachesAuthority === undefined ? {} : { reachesAuthority }),
  };
}

/** One projection helper so no caller can supply a partial liquidity basis: the
 * pending amount and the request being decided always travel with the balance. */
function project(liquidity: SignedLiquidityCase, months: number) {
  return projectReserve({
    availableMinor: liquidity.availableMinor,
    pendingMinor: liquidity.pendingMinor,
    requestMinor: liquidity.requestMinor,
    plannedMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    reserveMonths: months,
  });
}

function reserveOption(
  months: number,
  truthLabel: SetupChoiceOptionVM["truthLabel"],
): SetupChoiceOptionVM {
  const smiths = project(SMITHS_LIQUIDITY, months);
  const lowHeadroom = project(LOW_HEADROOM_LIQUIDITY, months);
  return {
    id: `${months}-months`,
    label: `${months} months`,
    detail: "Reserve dollars are derived from the pinned household schedule and are never entered directly.",
    truthLabel,
    reserveMetric: derivedMetric(smiths.requiredReserveMinor, "currency-minor", RESERVE_FLOOR_INPUTS, DEMO_NOW),
    smithsEffect: effect(
      smiths.reserveSatisfied ? "done" : "blocked",
      smiths.reserveSatisfied ? "Reserve satisfied" : "Reserve not satisfied",
      smiths.reserveSatisfied
        ? "The projected balance after this request remains above the selected reserve."
        : "The projected balance after this request falls below the selected reserve.",
      "Derived from the signed monthly withdrawal schedule and the selected horizon.",
    ),
    signedCaseEffect: effect(
      lowHeadroom.reserveSatisfied ? "proceed" : "blocked",
      lowHeadroom.reserveSatisfied ? "Proceed" : "Blocked",
      lowHeadroom.reserveSatisfied
        ? "The low-headroom case remains above this reserve floor."
        : "The low-headroom case falls below this reserve floor.",
      lowHeadroom.reserveSatisfied
        ? "Identical facts can proceed under this horizon."
        : "The block is caused by the reserve horizon, not a code or evidence change.",
    ),
  };
}

function freshnessOption(days: number, truthLabel: SetupChoiceOptionVM["truthLabel"]): SetupChoiceOptionVM {
  return {
    id: `${days}-days`,
    label: `${days} calendar days`,
    detail: "The administrator chooses a supported window. Verin determines whether evidence is fresh.",
    truthLabel,
    smithsEffect: effect(
      "done",
      "Fresh",
      "The Smiths reserve evidence is fresh under this window.",
      "The observation is recent and remains pinned to the input bundle.",
    ),
    signedCaseEffect: effect(
      "blocked",
      "Blocked",
      `Planned-withdrawal evidence observed ${OBSERVED_STALE} is 47 days old.`,
      `GC-09 requires a fresh planned-withdrawal snapshot before reevaluation. Available cash remains fresh as of ${OBSERVED_GC09_BALANCE}.`,
    ),
  };
}

function bankOption(
  id: "specialist" | "block",
  truthLabel: SetupChoiceOptionVM["truthLabel"],
): SetupChoiceOptionVM {
  const specialist = id === "specialist";
  return {
    id,
    label: specialist
      ? "Specialist review, then normal authority"
      : "Block until independent verification",
    detail: "Applies when a bank instruction changed within the locked P7D recency window.",
    truthLabel,
    smithsEffect: specialist
      ? effect(
          "proceed",
          "Proceed",
          "Proceed after specialist review",
          "The recent change adds specialist review before the normal authority path.",
          true,
        )
      : effect(
          "blocked",
          "Blocked",
          "Blocked pending independent verification",
          "No approval authority exists until the resolving evidence is supplied.",
          false,
        ),
    signedCaseEffect: specialist
      ? effect(
          "proceed",
          "Proceed",
          "Specialist review, then normal authority",
          "GC-03 records a proceed disposition with specialist and operations stages.",
          true,
        )
      : effect(
          "blocked",
          "Blocked",
          "Blocked pending independent verification",
          "GC-04 records no authority or execution plan while the evidence is absent.",
          false,
        ),
  };
}

function thresholdOption(
  amountUsd: number,
  requiresDualApproval: boolean,
  truthLabel: SetupChoiceOptionVM["truthLabel"],
): SetupChoiceOptionVM {
  return {
    id: `${amountUsd}`,
    label: `Above $${amountUsd.toLocaleString("en-US")}`,
    detail: "Quorum remains two distinct operations approvers. Repeated action by one person never counts twice.",
    truthLabel,
    smithsEffect: requiresDualApproval
      ? effect(
          "pending",
          "Dual approval",
          "Two distinct operations approvers are required",
          "The signed request is above this threshold.",
        )
      : effect(
          "done",
          "Below threshold",
          "No dual approval is created at this amount",
          "The signed request is below this threshold.",
        ),
    signedCaseEffect: requiresDualApproval
      ? effect(
          "pending",
          "Dual approval",
          "Proceed with two distinct operations approvers",
          "Threshold changes authority without changing the proceed disposition.",
        )
      : effect(
          "done",
          "Automatic",
          "Proceed automatically at this amount",
          "The request stays below this profile's dual-approval threshold.",
        ),
  };
}

function expiryOption(
  id: string,
  label: string,
  truthLabel: SetupChoiceOptionVM["truthLabel"],
): SetupChoiceOptionVM {
  return {
    id,
    label,
    detail: "Time creates attributable work. Expiration never auto-approves a stage.",
    truthLabel,
    smithsEffect: effect(
      "pending",
      "Clock recorded",
      label,
      "The operations stage records both escalation and expiry.",
    ),
    signedCaseEffect: effect(
      "suspended",
      "Expired and escalated",
      "The unactioned stage expires and creates escalation work",
      "GC-16 records both events and no automatic approval.",
    ),
  };
}

function firmChoices(
  firmId: SetupFirmId,
  initialOptionId: string,
  options: readonly SetupChoiceOptionVM[],
): FirmChoiceVM {
  return { firmId, initialOptionId, options };
}

function group(
  id: SetupPolicyGroupVM["id"],
  title: string,
  question: string,
  rationale: string,
  caseRef: string,
  firms: readonly [FirmChoiceVM, FirmChoiceVM],
): SetupPolicyGroupVM {
  return { id, title, question, rationale, caseRef, firms };
}

export function buildMoneyMovementSetup(): MoneyMovementSetupVM {
  const reserveA = [reserveOption(6, "Signed"), reserveOption(9, "Supported"), reserveOption(12, "Supported")];
  const reserveB = [reserveOption(6, "Supported"), reserveOption(9, "Supported"), reserveOption(12, "Signed")];
  const freshA = [freshnessOption(7, "Supported"), freshnessOption(14, "Supported"), freshnessOption(30, "Signed")];
  const freshB = [freshnessOption(7, "Supported"), freshnessOption(14, "Supported"), freshnessOption(30, "Recommended")];
  const bankA = [bankOption("specialist", "Signed"), bankOption("block", "Supported")];
  const bankB = [bankOption("specialist", "Supported"), bankOption("block", "Signed")];
  const thresholdA = [thresholdOption(25_000, true, "Signed"), thresholdOption(50_000, true, "Supported"), thresholdOption(100_000, false, "Supported")];
  const thresholdB = [thresholdOption(25_000, true, "Supported"), thresholdOption(50_000, true, "Supported"), thresholdOption(100_000, false, "Signed")];
  const expiryA = [
    expiryOption("4h-2d", "Escalate after 4 hours · expire after 2 days", "Supported"),
    expiryOption("1d-3d", "Escalate after 1 day · expire after 3 days", "Signed"),
    expiryOption("2d-5d", "Escalate after 2 days · expire after 5 days", "Supported"),
  ];
  const expiryB = [
    expiryOption("4h-2d", "Escalate after 4 hours · expire after 2 days", "Supported"),
    expiryOption("1d-3d", "Escalate after 1 day · expire after 3 days", "Recommended"),
    expiryOption("2d-5d", "Escalate after 2 days · expire after 5 days", "Supported"),
  ];

  return {
    steps: [
      { id: "profiles", shortLabel: "Profiles", kicker: "Step 1 · Governance profiles", title: "Start with the policy, not the request", description: "Create two governed money-movement profiles from one safe baseline, then make only legitimate firm differences visible.", primaryLabel: "Continue with both firms" },
      { id: "controls", shortLabel: "Controls", kicker: "Step 2 · Same for every firm", title: "Confirm the controls no firm can weaken", description: "Universal safety stays locked. Where accountability is required, each profile names the responsible role.", primaryLabel: "Confirm required controls" },
      { id: "posture", shortLabel: "Posture", kicker: "Step 3 · Safe starting point", title: "Begin conservatively, then make differences explicit", description: "The starting posture is expanded into exact values before it enters either draft.", primaryLabel: "Use this starting posture" },
      { id: "choices", shortLabel: "Choices", kicker: "Step 4 · Firm-specific choices", title: "Tune only the decisions that can legitimately differ", description: "Five closed groups express institutional posture without exposing a general rule builder.", primaryLabel: "Review signed impact" },
      { id: "impact", shortLabel: "Impact", kicker: "Step 5 · Before activation", title: "See the impact on signed examples", description: "Five high-signal cases show how the selected profiles change authority, evidence handling, or liquidity while universal safety stays fixed.", primaryLabel: "Send for approval" },
      { id: "activation", shortLabel: "Activate", kicker: "Step 6 · Human review", title: "A different human acknowledges immutable versions", description: "The demonstration records proposal, review, visible differences, version identity, and effective time without pretending the real lifecycle exists.", primaryLabel: "Acknowledge and activate demonstration" },
      { id: "request", shortLabel: "Request", kicker: "Step 7 · Same request, two profiles", title: "Run the Smiths request under both profiles", description: "The request and evidence stay identical. Only the pinned demonstration profile changes.", primaryLabel: "Run under both profiles" },
      { id: "outcomes", shortLabel: "Outcomes", kicker: "Step 8 · Policy explains the difference", title: "Identical facts, different correct outcomes", description: "Each branch preserves its firm label and stops at the strongest proof the branch honestly has.", primaryLabel: "View complete proof trail" },
      { id: "proof", shortLabel: "Proof", kicker: "Step 9 · Complete trace", title: "Every outcome has a proof trail", description: "Evidence, policy, disposition, authority, execution reachability, and proof limits remain visible through export.", primaryLabel: "Export decision record" },
    ],
    profiles: [
      { firmId: "firm-a", firmLabel: "Firm A", name: "Northstar Wealth demonstration profile", draftVersion: "FA-MM-DEMO-1.0", activeVersion: "FA-4.2", lastApproval: "May 1, 2026 · synthetic history", description: "Starts from the same conservative posture, then adopts the signed Firm A reserve, threshold, and recent-change handling.", fakeClass: "synthetic-fixture" },
      { firmId: "firm-b", firmLabel: "Firm B", name: "Harbor Ridge demonstration profile", draftVersion: "FB-MM-DEMO-1.0", activeVersion: "FB-2.1", lastApproval: "Jun 18, 2026 · synthetic history", description: "Uses the same required safety controls while expressing a different reserve and evidence posture.", fakeClass: "synthetic-fixture" },
    ],
    controls: [
      { id: "pinned-inputs", title: "Pinned policy and evidence", description: "Every decision binds to an immutable policy version and evidence snapshot.", proof: "Version references and input hash" },
      { id: "closed-dispositions", title: "Blocked and prohibited stay distinct", description: "Blocked names resolving evidence. Prohibited has no authority or execution plan.", proof: "Disposition shape and reason code" },
      { id: "exact-approval", title: "Approval binds to exact inputs", description: "Material request, policy, evidence, or expiry changes invalidate prior authority.", proof: "Decision and input hashes" },
      { id: "distinct-humans", title: "Quorum counts distinct humans", description: "One actor cannot satisfy multiple required approvals.", proof: "Attributed actor identities" },
      { id: "revalidation", title: "Safety reruns before execution", description: "Evidence, policy, conflicts, reservations, and authority are revalidated before any external call.", proof: "Revalidation receipt" },
      { id: "proof-strength", title: "Status never outruns proof", description: "Stable idempotency suppresses duplicates and submitted never means completed or verified.", proof: "Idempotency key and sourced status receipt" },
    ],
    roles: [
      { responsibility: "Policy proposal and approval", firmA: "Taylor Morgan · CCO proposes", firmB: "Taylor Morgan · CCO proposes", rule: "Jordan Lee · Principal approves. The proposer and approver must be different humans." },
      { responsibility: "Expiry, escalation, and stuck work", firmA: "Operations manager", firmB: "Operations manager", rule: "Time creates owned work and never autoapproval." },
    ],
    baseline: [
      { label: "Reserve horizon", value: "12 months", detail: "Reserve dollars are derived from each household schedule." },
      { label: "Reserve evidence freshness", value: "30 calendar days" },
      { label: "Recent bank change", value: "P7D window · block until independently verified" },
      { label: "Dual approval", value: "2 distinct operations approvers above $25,000" },
      { label: "Normal approval clock", value: "Escalate after P1D · expire after P3D" },
      { label: "Requester participation", value: "Awaiting captain decision", detail: "Not bound by this demonstration activation." },
    ],
    policyGroups: [
      group("reserve", "Reserve horizon", "How many months of planned withdrawals must remain after this movement?", "The administrator chooses months. Verin derives dollars from pinned household evidence.", "GC-01 / GC-02 / GC-05", [firmChoices("firm-a", "6-months", reserveA), firmChoices("firm-b", "12-months", reserveB)]),
      group("freshness", "Reserve evidence freshness", "How recent must reserve evidence be?", "The administrator chooses a supported window, not whether a particular snapshot is fresh.", "GC-09", [firmChoices("firm-a", "30-days", freshA), firmChoices("firm-b", "30-days", freshB)]),
      group("bank-change", "Recent bank-change handling", "What happens when a change inside P7D is not independently verified?", "The P7D predicate is shared. Each firm may choose specialist review or an evidence block.", "GC-03 / GC-04", [firmChoices("firm-a", "specialist", bankA), firmChoices("firm-b", "block", bankB)]),
      group("threshold", "Dual-approval threshold", "Above what amount must two distinct operations approvers act?", "The threshold may vary. Distinct-human quorum cannot.", "GC-01 / GC-02", [firmChoices("firm-a", "25000", thresholdA), firmChoices("firm-b", "100000", thresholdB)]),
      group("expiry", "Normal approval expiry and escalation", "When does waiting create escalation work, and when does authority expire?", "Clocks are closed pairs. Expiry never produces approval.", "GC-01 / GC-16", [firmChoices("firm-a", "1d-3d", expiryA), firmChoices("firm-b", "1d-3d", expiryB)]),
    ],
    impacts: [
      { id: "recent-bank", title: "Recent bank change", caseRef: "GC-03 / GC-04", facts: `Same request · changed ${BANK_INSTRUCTION.changedOn} · ${BANK_INSTRUCTION.changedAgeDays} days ago · independent verification absent`, groupId: "bank-change" },
      { id: "stale-withdrawals", title: "Stale planned-withdrawal evidence", caseRef: "GC-09", facts: `Planned-withdrawal evidence observed ${OBSERVED_STALE} · 47 days old`, groupId: null, universalEffect: `Available cash remains fresh as of ${OBSERVED_GC09_BALANCE}. Refresh the planned-withdrawal snapshot before reevaluation.` },
      { id: "verified-bank", title: "Verified bank instruction", caseRef: SMITHS_LIQUIDITY.caseRef, facts: `Same ${usd(SMITHS_LIQUIDITY.requestMinor)} request · bank instruction independently verified`, groupId: "threshold" },
      { id: "low-headroom", title: "Low headroom", caseRef: LOW_HEADROOM_LIQUIDITY.caseRef, facts: factsLine(LOW_HEADROOM_LIQUIDITY), groupId: "reserve" },
      { id: "material-change", title: "Material change after approval", caseRef: "GC-15", facts: "A new evidence snapshot changes the input hash", groupId: null, universalEffect: "Prior authority is voided for both firms. Evidence, validation, policy, disposition, and authority rerun against the new bundle." },
    ],
    activation: {
      proposer: "Taylor Morgan",
      proposerRole: "CCO",
      approver: "Jordan Lee",
      approverRole: "Principal",
      effectiveAt: "Jul 28, 2026 at 10:00 ET",
      simulationRef: "demo-simulation:signed-cases@2026-07-26",
      requesterDecisionNotice: "Signed fixtures exclude the requester while ratified prose permits one approval. The recommendation is exclusion, but this demonstration leaves the policy value unbound until the existing captain decision is resolved.",
      demonstrationNotice: "This local acknowledgment demonstrates the review contract only. It is not persisted, cannot govern a production request, and must be deleted when the real policy lifecycle lands.",
    },
    request: {
      title: `${usd(SMITHS_LIQUIDITY.requestMinor)} one-time ACH distribution`,
      summary: `Smith household · taxable account · household-titled destination · bank instruction changed ${BANK_INSTRUCTION.changedAgeDays} days ago`,
      requestRef: "request:smiths-renovation@demo-2026-07-28",
      evidenceRef: "smiths-evidence@2026-07-26T14:00Z",
      facts: [
        { label: "Request amount", metric: metric(CANONICAL_REQUEST.amountMinor, "currency-minor", prov("user-entered-demo-input", DEMO_NOW)), category: "Synthetic fixture", provenance: prov("user-entered-demo-input", DEMO_NOW), fakeClass: "user-entered-demo-input" },
        { label: "Available balance", metric: fixtureMetric(SMITHS_LIQUIDITY.availableMinor, "currency-minor", "synthetic-fixture", OBSERVED_RECENT), category: "Synthetic fixture", provenance: prov("synthetic-fixture", OBSERVED_RECENT), fakeClass: "synthetic-fixture" },
        { label: "Pending approved activity", metric: fixtureMetric(SMITHS_LIQUIDITY.pendingMinor, "currency-minor", "synthetic-fixture", OBSERVED_RECENT), category: "Synthetic fixture", provenance: prov("synthetic-fixture", OBSERVED_RECENT), fakeClass: "synthetic-fixture" },
        { label: "Planned monthly withdrawals", metric: fixtureMetric(PLANNED_WITHDRAWAL_MONTHLY_MINOR, "currency-minor", "synthetic-fixture", OBSERVED_RECENT), category: "Household instruction", provenance: prov("synthetic-fixture", OBSERVED_RECENT), fakeClass: "synthetic-fixture" },
        { label: "Destination restriction", value: "Household-titled destinations only", category: "Household instruction", provenance: prov("synthetic-fixture", "2026-05-10"), fakeClass: "synthetic-fixture" },
        { label: "Bank instruction", value: `Changed ${BANK_INSTRUCTION.changedOn} · ${BANK_INSTRUCTION.changedAgeDays} days ago · not independently verified`, category: "Synthetic fixture", provenance: prov("synthetic-fixture", BANK_INSTRUCTION.changedOn), fakeClass: "synthetic-fixture" },
        { label: "Execution capability", value: "ACH through labeled fake adapter only", category: "Adapter fact", provenance: prov("fake-adapter-response", DEMO_NOW), fakeClass: "fake-adapter-response" },
        { label: "Authority invariant", value: "Blocked and prohibited decisions carry no approval authority", category: "Regulatory or product constraint", provenance: prov("deterministic-engine-output", DEMO_NOW), fakeClass: "deterministic-engine-output" },
      ],
    },
    proof: {
      engineLabel: "Labeled deterministic presentation builder · not production evaluator output",
      exportQuestion: "Which profile's decision record do you want to export?",
      exportHint: "The setup produced two outcomes, so the export names one of them. The identifiers above are what the exported record carries.",
      exportError: "Choose which profile's decision record to export.",
    },
    fakeClass: "deterministic-engine-output",
  };
}
