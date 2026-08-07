/**
 * The shared policy-test world (prompt 9, ADR-0053): registries mirroring the
 * ratified design's §3.8 compiled firm policies, the Firm A / Firm B documents
 * themselves, and fact/invocation builders approximating the signed golden
 * cases. Domain vocabulary ("bank-instruction-change") is legal HERE - tests
 * and fixtures are exactly where v3 orchestrator rule 7 puts domain words; the
 * policy module itself stays domain-neutral and is fenced for it.
 */
import { createHash } from "node:crypto";
import { PRIMITIVE_SET_VERSION } from "@contracts/primitives/catalog";
import {
  canonicalJson,
  type JsonValue,
} from "@contracts/decision-core/serialization";
import { unwrap } from "@contracts/result";
import {
  catalogPrimitiveMap,
  deriveContextKeys,
  evidenceKindDescriptor,
  instructionKindDescriptor,
  type PolicyRegistries,
  type PolicyValueType,
} from "@domain/policy/registries";
import type {
  EvidenceFactSnapshot,
  PolicyEvaluationFacts,
} from "@domain/policy/facts";
import type { PolicyPrimitiveInvocation } from "@domain/policy/evaluate";

export const AS_OF = "2026-08-01T12:00:00.000Z";
export const ANCHOR_DATE = "2026-08-01";
export const FIRM = "firm-a";

const primitives = catalogPrimitiveMap();

const boundPublishedKeys = () => {
  const netAvailability = primitives.get("net-availability")!;
  const horizonProjection = primitives.get("horizon-projection")!;
  const sufficiencyCheck = primitives.get("sufficiency-check")!;
  const candidateSelection = primitives.get("candidate-selection")!;
  const keysOf = (primitive: { publishedKeys: unknown }, parameters: unknown) =>
    (primitive.publishedKeys as (p: unknown) => Record<string, unknown>)(parameters);
  return [
    {
      primitiveId: "net-availability",
      publishedKeys: keysOf(netAvailability, {
        resourceEvidenceKind: "account-balance",
        claimEvidenceKinds: ["pending-activity", "reservation"],
        subjectScope: "subject-group",
      }),
    },
    {
      primitiveId: "horizon-projection",
      publishedKeys: keysOf(horizonProjection, {}),
    },
    {
      primitiveId: "sufficiency-check",
      publishedKeys: keysOf(sufficiencyCheck, {}),
    },
    {
      primitiveId: "candidate-selection",
      publishedKeys: keysOf(candidateSelection, { subjectSlot: "source-account" }),
    },
  ] as Parameters<typeof deriveContextKeys>[1];
};

export const worldRegistries = (): PolicyRegistries => {
  const intentSlots: Record<string, PolicyValueType> = {
    "intent.amount": "integer",
    "intent.destinationType": "string",
  };
  const { contextKeys, collisions } = deriveContextKeys(intentSlots, boundPublishedKeys());
  if (collisions.length > 0) throw new Error(`context-key collisions: ${collisions.join(", ")}`);
  return {
    evidence: new Map([
      ["account-balance", evidenceKindDescriptor({ amountMinor: "integer" })],
      ["pending-activity", evidenceKindDescriptor({ amountMinor: "integer" })],
      ["reservation", evidenceKindDescriptor({ amountMinor: "integer" })],
      ["reservation-release", evidenceKindDescriptor({ releasedAt: "iso-timestamp" })],
      ["planned-withdrawals", evidenceKindDescriptor({ monthlyAmountMinor: "integer" })],
      ["bank-instruction-change", evidenceKindDescriptor({ changedAt: "iso-timestamp" })],
      [
        "bank-instruction-independent-verification",
        evidenceKindDescriptor({ verifiedAt: "iso-timestamp" }),
      ],
      ["funding-candidates", evidenceKindDescriptor({})],
    ]),
    instructions: new Map([
      ["standing-preference", instructionKindDescriptor({ rank: "integer", label: "string" })],
    ]),
    contextKeys,
    approvalTemplates: new Map([
      ["tmpl-ops-dual", { kind: "approval" as const }],
      ["tmpl-dual-approval-b", { kind: "approval" as const }],
      ["tmpl-bank-change-specialist", { kind: "specialist_review" as const }],
    ]),
    primitives,
    primitiveSetVersion: PRIMITIVE_SET_VERSION,
  };
};

// ── The compiled firm policies (ratified design §3.8; amounts in cents) ─────────

const contextValue = (key: string) => ({ kind: "context", key });
const constant = (value: string | number | boolean | null) => ({ kind: "constant", value });

const sharedRules = (horizonMonths: number) => [
  {
    id: "rule-reserve-horizon",
    when: { op: "all", nodes: [] },
    effects: [
      {
        kind: "set_parameter",
        primitiveId: "horizon-projection",
        parameter: "horizonMonths",
        value: constant(horizonMonths),
      },
    ],
  },
  {
    id: "rule-source-selection",
    when: { op: "all", nodes: [] },
    effects: [
      {
        kind: "select_candidate",
        primitiveId: "candidate-selection",
        strategy: "preference-order",
      },
    ],
  },
  {
    id: "rule-reserve-breach",
    when: {
      op: "all",
      nodes: [
        {
          op: "compare",
          comparator: "eq",
          left: contextValue("sufficiency.satisfied"),
          right: constant(false),
        },
        {
          op: "compare",
          comparator: "eq",
          left: contextValue("availability.claims.reservation"),
          right: constant(0),
        },
      ],
    },
    effects: [
      {
        kind: "block",
        blockerCode: "cash-reserve-breach",
        resolvingEvidenceKinds: ["account-balance", "pending-activity"],
      },
    ],
  },
  {
    id: "rule-reserved-by-sibling",
    when: {
      op: "all",
      nodes: [
        {
          op: "compare",
          comparator: "eq",
          left: contextValue("sufficiency.satisfied"),
          right: constant(false),
        },
        {
          op: "compare",
          comparator: "gt",
          left: contextValue("availability.claims.reservation"),
          right: constant(0),
        },
      ],
    },
    effects: [
      {
        kind: "block",
        blockerCode: "liquidity-reserved-by-sibling",
        resolvingEvidenceKinds: ["reservation-release", "account-balance"],
      },
    ],
  },
  {
    id: "rule-reserve-evidence-freshness",
    when: {
      op: "not",
      node: { op: "is_fresh", evidenceKind: "planned-withdrawals", maxAge: "P30D" },
    },
    effects: [
      {
        kind: "block",
        blockerCode: "reserve-evidence-stale",
        resolvingEvidenceKinds: ["planned-withdrawals"],
      },
    ],
  },
];

const recentBankChangeWhen = {
  op: "all",
  nodes: [
    { op: "is_fresh", evidenceKind: "bank-instruction-change", maxAge: "P7D" },
    {
      op: "not",
      node: {
        op: "exists",
        value: {
          kind: "evidence",
          evidenceKind: "bank-instruction-independent-verification",
          path: "verifiedAt",
        },
      },
    },
  ],
};

export const firmAPolicyDocument = (): Record<string, unknown> => ({
  schemaVersion: "1.0.0",
  primitiveSetVersion: PRIMITIVE_SET_VERSION,
  rules: [
    ...sharedRules(6),
    {
      id: "rule-dual-approval-over-25k",
      when: {
        op: "compare",
        comparator: "gt",
        left: contextValue("intent.amount"),
        right: constant(2_500_000),
      },
      effects: [{ kind: "require_approval", templateId: "tmpl-ops-dual" }],
    },
    {
      id: "rule-recent-bank-change-review",
      when: recentBankChangeWhen,
      effects: [{ kind: "require_approval", templateId: "tmpl-bank-change-specialist" }],
    },
  ],
});

export const firmBPolicyDocument = (): Record<string, unknown> => ({
  schemaVersion: "1.0.0",
  primitiveSetVersion: PRIMITIVE_SET_VERSION,
  rules: [
    ...sharedRules(12),
    {
      id: "rule-dual-approval-over-100k",
      when: {
        op: "compare",
        comparator: "gt",
        left: contextValue("intent.amount"),
        right: constant(10_000_000),
      },
      effects: [{ kind: "require_approval", templateId: "tmpl-dual-approval-b" }],
    },
    {
      id: "rule-recent-bank-change-block",
      when: recentBankChangeWhen,
      effects: [
        {
          kind: "block",
          blockerCode: "bank-instruction-change-unverified",
          resolvingEvidenceKinds: ["bank-instruction-independent-verification"],
        },
      ],
    },
  ],
});

// ── Facts + invocations approximating the golden world ──────────────────────────

export type WorldFactsOptions = {
  readonly amountMinor?: number;
  readonly withdrawalsObservedAt?: string;
  readonly recentBankChange?: boolean;
  readonly bankChangeVerified?: boolean;
  readonly omitEvidence?: readonly string[];
};

export const worldFacts = (options: WorldFactsOptions = {}): PolicyEvaluationFacts => {
  const snapshots = new Map<string, EvidenceFactSnapshot>([
    ["account-balance", { observedAt: "2026-08-01T09:00:00.000Z", values: { amountMinor: 20_000_000 } }],
    ["pending-activity", { observedAt: "2026-08-01T09:00:00.000Z", values: { amountMinor: 2_000_000 } }],
    [
      "planned-withdrawals",
      {
        observedAt: options.withdrawalsObservedAt ?? "2026-07-20T09:00:00.000Z",
        values: { monthlyAmountMinor: 800_000 },
      },
    ],
  ]);
  if (options.recentBankChange === true) {
    snapshots.set("bank-instruction-change", {
      observedAt: "2026-07-28T12:00:00.000Z",
      values: { changedAt: "2026-07-28T12:00:00.000Z" },
    });
  }
  if (options.bankChangeVerified === true) {
    snapshots.set("bank-instruction-independent-verification", {
      observedAt: "2026-07-30T12:00:00.000Z",
      values: { verifiedAt: "2026-07-30T12:00:00.000Z" },
    });
  }
  for (const kind of options.omitEvidence ?? []) snapshots.delete(kind);
  return {
    asOf: AS_OF,
    evidence: snapshots,
    instructions: new Map(),
    intent: new Map<string, string | number | boolean | null>([
      ["intent.amount", options.amountMinor ?? 7_500_000],
      ["intent.destinationType", "external"],
    ]),
  };
};

export type WorldInvocationOptions = {
  readonly grossMinor?: number;
  readonly pendingClaimMinor?: number;
  readonly reservationClaimMinor?: number;
  readonly defaultHorizonMonths?: number;
  readonly includeSelection?: boolean;
};

const snapshotRef = (id: string) => ({ firmId: FIRM, id });

export const worldInvocations = (
  options: WorldInvocationOptions = {},
): PolicyPrimitiveInvocation[] => {
  const gross = options.grossMinor ?? 20_000_000;
  const pending = options.pendingClaimMinor ?? 2_000_000;
  const reserved = options.reservationClaimMinor ?? 0;
  const claims = [
    ...(pending > 0
      ? [{ claimKind: "pending-activity", snapshotRef: snapshotRef("snap-pending"), amountMinor: pending }]
      : []),
    ...(reserved > 0
      ? [{ claimKind: "reservation", snapshotRef: snapshotRef("snap-reservation"), amountMinor: reserved }]
      : []),
  ];
  const flows = Array.from({ length: 14 }, (_, index) => {
    const month = ((7 + index) % 12) + 1;
    const year = 2026 + Math.floor((7 + index) / 12);
    return {
      dueOn: `${year}-${String(month).padStart(2, "0")}-01`,
      amountMinor: 800_000,
    };
  });
  const invocations: PolicyPrimitiveInvocation[] = [
    {
      primitiveId: "net-availability",
      parameters: {
        resourceEvidenceKind: "account-balance",
        claimEvidenceKinds: ["pending-activity", "reservation"],
        subjectScope: "subject-group",
      },
      evidence: {
        resource: { snapshotRef: snapshotRef("snap-balance"), amountMinor: gross },
        claims,
      },
    },
    {
      primitiveId: "horizon-projection",
      parameters: {
        seriesEvidenceKind: "planned-withdrawals",
        horizonMonths: options.defaultHorizonMonths ?? 1,
        direction: "forward",
      },
      evidence: {
        series: { snapshotRef: snapshotRef("snap-withdrawals"), flows },
      },
      context: { anchorDate: ANCHOR_DATE },
    },
    {
      primitiveId: "sufficiency-check",
      parameters: {
        mode: "floor-preserving",
        available: { kind: "context", key: "availability.net" },
        draw: { kind: "context", key: "intent.amount" },
        bound: { kind: "context", key: "projection.total" },
      },
      evidence: {},
    },
  ];
  if (options.includeSelection === true) {
    invocations.push({
      primitiveId: "candidate-selection",
      parameters: {
        candidateEvidenceKind: "funding-candidates",
        subjectSlot: "source-account",
        exclusions: [
          { classification: "deferred-class", reasonCode: "deferred-source-excluded" },
        ],
        ambiguityQuestionCode: "which-source-account",
      },
      evidence: {
        candidates: [
          { ref: snapshotRef("acct-taxable"), classifications: [] },
          { ref: snapshotRef("acct-deferred"), classifications: ["deferred-class"] },
        ],
        preferenceRanking: [snapshotRef("acct-taxable")],
      },
    });
  }
  return invocations;
};

/** SHA-256 of a value's canonical JSON bytes - the pinning digest tests use. */
export const canonicalDigest = (value: unknown): string =>
  createHash("sha256").update(unwrap(canonicalJson(value as JsonValue))).digest("hex");
