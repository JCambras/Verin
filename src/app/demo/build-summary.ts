/**
 * Fake-service builders for the SUMMARY surfaces: Firm A / Firm B comparison
 * (surface 10), policy draft and simulation impact (surface 11), and the printable
 * examiner-grade decision record (surface 12).
 *
 * The comparison is driven by policy-version provenance (design §10): each column is
 * headed by the firm's active policy version, and every differing row cites the
 * provision that produced its value. The record derives its provenance through
 * ADR-0022 - every input here is synthetic, so it is a watermarked demonstration.
 */
import type { DisplayMetric } from "@contracts/metric";
import {
  headroomMinor as calculateHeadroomMinor,
  reserveFloorMinor as calculateReserveFloorMinor,
} from "@contracts/money-movement";
import { DEMO_WATERMARK, isDemonstration } from "@contracts/provenance";
import type { ComparisonRowVM, ComparisonVM, DispositionKind, PolicyAuthoringVM, RecordVM } from "./model";
import { derivedMetric, prov, recordProvenance } from "./provenance";
import { buildSpine } from "./spine";
import { buildEvidence, buildIntent } from "./build-context";
import {
  amountMetric,
  buildDisposition,
  buildPolicyTrace,
  buildStages,
  headroomMetric,
  reserveFloorMetric,
  DISPOSITION_BADGES,
} from "./build-decision";
import { buildExecution, buildSafety, buildVerification } from "./build-outcome";
import { formatDemoInstant, timelineFor } from "./timeline";
import {
  CANONICAL_REQUEST,
  DEMO_NOW,
  FIRMS,
  IDS,
  OBSERVED_RECENT,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  dispositionFor,
  liquidityAuthorityFor,
  type FirmData,
  type ScenarioData,
} from "./data";

/** The reserve horizon the drafted policy proposes (surface 11's simulation). */
export const DRAFT_RESERVE_MONTHS = 12;

function thresholdMetric(firm: FirmData): DisplayMetric {
  // A policy parameter, not a computed figure: fixture-sourced, labeled sample data.
  return { value: firm.dualApprovalThresholdMinor, format: "currency-minor", provenance: prov("synthetic-fixture", firm.policyActiveSince) };
}

export function buildComparison(scenario: ScenarioData): ComparisonVM {
  const a = FIRMS["firm-a"]!;
  const b = FIRMS["firm-b"]!;
  const dispA = dispositionFor(scenario, a.id);
  const dispB = dispositionFor(scenario, b.id);
  const headroomA = headroomMetric(scenario, a);
  const headroomB = headroomMetric(scenario, b);
  const rows: ComparisonRowVM[] = [
    { dimension: "Household", a: { display: "The Smith Household" }, b: { display: "The Smith Household" }, differs: false },
    { dimension: "Requested amount", a: { metric: amountMetric() }, b: { metric: amountMetric() }, differs: false },
    {
      dimension: "Cash-reserve requirement",
      a: { metric: reserveFloorMetric(a) },
      b: { metric: reserveFloorMetric(b) },
      differs: true,
      why: { reason: `Firm A preserves six months of planned withdrawals (policy ${a.policyVersion} §2); Firm B preserves twelve (policy ${b.policyVersion} §3).` },
    },
    {
      dimension: "Available after reserve",
      a: headroomA ? { metric: headroomA } : { display: "Missing signed branch-and-firm liquidity authority" },
      b: headroomB ? { metric: headroomB } : { display: "Missing signed branch-and-firm liquidity authority" },
      differs: true,
      why: {
        reason:
          headroomA && headroomB
            ? "Each figure is bound to the signed case for this exact branch and firm; the reserve floors come from the firms' approved policies."
            : "A branch-and-firm comparison never borrows liquidity from an unrelated signed case. Missing numeric authority remains visible.",
      },
    },
    {
      dimension: "Dual-approval threshold",
      a: { metric: thresholdMetric(a) },
      b: { metric: thresholdMetric(b) },
      differs: true,
      why: { reason: `Policy ${a.policyVersion} §4 versus policy ${b.policyVersion} §4.` },
    },
    {
      dimension: "Quorum at this amount",
      a: { display: "Two distinct operations approvers - requester excluded" },
      b: { display: "No dual approval at this amount; Firm B states no requester rule" },
      differs: true,
      why: { reason: `The request sits between the two thresholds: above Firm A's (policy ${a.policyVersion} §4), below Firm B's (policy ${b.policyVersion} §4). Firm B's requester rule is contract silence, not a lighter rule.` },
    },
    {
      dimension: "Recent bank-change handling",
      a: { display: "Specialist review before execution" },
      b: { display: "Blocked until independently verified" },
      differs: true,
      why: { reason: `Policy ${a.policyVersion} §6 routes a recent change to a specialist; policy ${b.policyVersion} §6 blocks execution until independent verification.` },
    },
    {
      dimension: "Disposition for this request",
      a: { badge: DISPOSITION_BADGES[dispA] },
      b: { badge: DISPOSITION_BADGES[dispB] },
      differs: dispA !== dispB,
      ...(dispA !== dispB
        ? { why: { reason: "Same household, same request, same evidence - the outcome differs because the approved policy version differs, with zero code change." } }
        : {}),
    },
  ];
  return {
    columns: [
      { firm: a.name, policyVersion: a.policyVersion, activeSince: `active since ${a.policyActiveSince}` },
      { firm: b.name, policyVersion: b.policyVersion, activeSince: `active since ${b.policyActiveSince}` },
    ],
    rows,
    fakeClass: "deterministic-engine-output",
  };
}

export function buildPolicyAuthoring(scenario: ScenarioData, firm: FirmData): PolicyAuthoringVM {
  const isFirmA = firm.id === "firm-a";
  const twelveMonthFloor = calculateReserveFloorMinor(PLANNED_WITHDRAWAL_MONTHLY_MINOR, DRAFT_RESERVE_MONTHS);
  const liquidityInputs = [prov("synthetic-fixture", OBSERVED_RECENT)];
  const authority = liquidityAuthorityFor(scenario, firm.id);
  const initial = authority.kind === "signed" ? authority.initialDecision : null;
  const newHeadroom = initial
    ? calculateHeadroomMinor(initial.availableCashMinor, initial.pendingActivityMinor, twelveMonthFloor)
    : null;
  const currentHeadroom = headroomMetric(scenario, firm);
  const disp = dispositionFor(scenario, firm.id);
  // The simulation's own arithmetic decides whether the request survives the drafted
  // floor. Asserting "still proceeds" as fixed copy is how surface 11 would come to
  // contradict the figure printed directly above it.
  const simulatedDisp: DispositionKind | null =
    newHeadroom === null ? null : disp === "proceed" && newHeadroom < CANONICAL_REQUEST.amountMinor ? "blocked" : disp;
  return {
    spine: buildSpine("Decision", { status: "pending", label: "Draft simulation" }),
    sentence: "Always preserve twelve months of planned withdrawals in cash.",
    draft: {
      rows: [
        { field: "Effect", value: "Require" },
        { field: "Subject", value: "Cash reserve" },
        { field: "Quantity", value: "Twelve months of planned withdrawals" },
        { field: "Scope", value: "All households" },
        { field: "Supersedes", value: isFirmA ? `${firm.policyVersion} §2 (six months)` : `${firm.policyVersion} §3 (already twelve months - no change)` },
      ],
      label: "Drafted - not yet reviewed",
      fakeClass: "llm-proposed-draft",
    },
    interpretation: "Reserve floor becomes twelve times the planned monthly withdrawal for each household, evaluated before any discretionary movement.",
    simulationDelta: isFirmA && newHeadroom !== null && currentHeadroom
      ? [
          {
            label: "Smith household reserve floor",
            before: { metric: reserveFloorMetric(firm) },
            after: { metric: derivedMetric(twelveMonthFloor, "currency-minor", liquidityInputs, DEMO_NOW) },
          },
          {
            label: "Available after reserve",
            before: { metric: currentHeadroom },
            after: { metric: derivedMetric(newHeadroom, "currency-minor", liquidityInputs, DEMO_NOW) },
          },
          {
            label: "This request",
            before: { badge: DISPOSITION_BADGES[disp] },
            after: { badge: DISPOSITION_BADGES[simulatedDisp ?? disp] },
          },
          {
            label: "Demo-corpus households newly below the floor",
            before: { metric: derivedMetric(0, "count", liquidityInputs, DEMO_NOW) },
            after: { metric: derivedMetric(3, "count", liquidityInputs, DEMO_NOW) },
          },
        ]
      : isFirmA
        ? [
            {
              label: "Smith household reserve floor",
              before: { metric: reserveFloorMetric(firm) },
              after: { metric: derivedMetric(twelveMonthFloor, "currency-minor", liquidityInputs, DEMO_NOW) },
            },
            {
              label: "Available after reserve",
              before: { display: "Missing signed branch-and-firm liquidity authority" },
              after: { display: "Not simulated without signed numeric authority" },
            },
            {
              label: "This request",
              before: { badge: DISPOSITION_BADGES[disp] },
              after: { display: "Not simulated without signed numeric authority" },
            },
          ]
        : [
          {
            label: "Smith household reserve floor",
            before: { metric: reserveFloorMetric(firm) },
            after: { metric: reserveFloorMetric(firm) },
          },
          {
            label: "This request",
            before: { badge: DISPOSITION_BADGES[disp] },
            after: { badge: DISPOSITION_BADGES[disp] },
          },
        ],
    gateLabel: isFirmA ? "Approve and activate FA-4.3" : "Approve (no effective change for Firm B)",
    activation: isFirmA ? { fromVersion: "FA-4.2", toVersion: "FA-4.3" } : { fromVersion: "FB-2.1", toVersion: "FB-2.1" },
    changedRerunResult: newHeadroom === null
      ? "Re-run not calculated: this branch and firm have no captain-signed numeric liquidity case, and no unrelated case was substituted."
      : isFirmA
      ? {
          proceed: "Re-run under FA-4.3: the Smith request still proceeds, with a narrower margin above the reserve floor.",
          blocked:
            disp === "proceed"
              ? "Re-run under FA-4.3: the Smith request no longer proceeds - twelve months of planned withdrawals leave less than this movement needs."
              : "Re-run under FA-4.3: the Smith request is still blocked - the reserve change does not resolve the named conditions.",
          prohibited: "Re-run under FA-4.3: the Smith request remains prohibited - the destination restriction is not resolvable by a reserve-policy change.",
        }[simulatedDisp ?? disp]
      : {
          proceed: "Re-run under FB-2.1: no change - Firm B already preserves twelve months.",
          blocked: "Re-run under FB-2.1: no reserve change - Firm B already preserves twelve months, and the named conditions still block this request.",
          prohibited: "Re-run under FB-2.1: no reserve change - Firm B already preserves twelve months, and the destination restriction is not resolvable by a reserve-policy change.",
        }[disp],
    fakeClass: "deterministic-engine-output",
  };
}

export function buildRecord(scenario: ScenarioData, firm: FirmData, reached: { authority: boolean; safety: boolean; execution: boolean }, stopNote: string | null): RecordVM {
  const provenance = recordProvenance(
    [prov("synthetic-fixture", OBSERVED_RECENT), prov("user-entered-demo-input", DEMO_NOW)],
    DEMO_NOW,
  );
  const timeline = timelineFor(scenario, firm);
  return {
    header: {
      decisionId: "dec-smiths-renovation-2026-0726",
      createdAt: formatDemoInstant(timeline.decisionAt, undefined, true),
      createdAtIso: timeline.decisionAt,
      provenance,
      watermark: isDemonstration(provenance) ? DEMO_WATERMARK : null,
    },
    hashes: {
      decisionHash: IDS.decisionHash,
      bundleHash: IDS.bundleHash,
      policyVersion: firm.policyVersion,
      instructionVersion: "HH-INSTR-SMITH v3",
      auditPosition: IDS.auditPosition,
    },
    intent: buildIntent(scenario, firm),
    evidence: buildEvidence(scenario, firm).rows,
    disposition: buildDisposition(scenario, firm),
    precedence: buildPolicyTrace(scenario, firm).rows,
    approvalStages: reached.authority ? buildStages(scenario, firm, "final") : null,
    safety: reached.safety ? buildSafety(scenario, firm) : null,
    execution: reached.execution ? buildExecution(scenario, firm).rows : null,
    verification: reached.execution ? buildVerification(scenario, firm) : null,
    stopNote,
    provenanceAppendix: provenance.derivedFrom,
  };
}
