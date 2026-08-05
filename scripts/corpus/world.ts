import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  CasesSpecSchema,
  type CasesSpec,
} from "./case-spec";
import {
  PENDING_ACTION_KINDS,
  PENDING_ACTION_STATES,
} from "./pending-actions";
import {
  GOVERNED_INSTRUCTION_ACTIONS,
  INSTRUCTION_POLARITIES,
} from "./instruction-conflicts";
import { parseStrictJson } from "./strict-json";
import { specReferenceProblems } from "./world-topology";

export type { CaseLabel, CaseSpec, CasesSpec } from "./case-spec";
export {
  legalHoldSubject,
  requireLegalHoldSubject,
  specReferenceProblems,
} from "./world-topology";
export type { LegalHoldSubject } from "./world-topology";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
export const CORPUS_DIR = join(REPO_ROOT, "fixtures/corpus");
export const SPEC_DIR = join(CORPUS_DIR, "spec");
export const SYNTHETIC_DIR = join(CORPUS_DIR, "synthetic");
export const REAL_DERIVED_DIR = join(CORPUS_DIR, "real-derived");

export const SPEC_FILES = [
  "world.json",
  "cases.json",
  "defect-taxonomy.json",
  "real-derived-semantic-contract.json",
] as const;

const Instant = z.iso.datetime({ precision: 3 });
const Slug = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "lowercase hyphenated slug",
);
const Money = z.int().nonnegative();
const duplicates = (values: readonly string[]): string[] => [
  ...new Set(
    values.filter((value, index) => values.indexOf(value) !== index),
  ),
];
const ObservedAt = Instant;
const TimingSchema = z.strictObject({
  minRetrievalLagSeconds: z.int().positive(),
  maxRetrievalLagSeconds: z.int().positive(),
  freshnessWindowDays: z.int().positive(),
});
const ClockSchema = z.strictObject({
  asOf: Instant,
  timeZone: z.string().min(1),
  timeZoneDataVersion: z.string().min(1),
  recentChangeWindowDays: z.int().positive(),
  transitions: z.array(
    z.strictObject({
      at: Instant,
      offsetMinutes: z.int(),
    }),
  ).min(2),
}).refine(
  (clock) =>
    duplicates(clock.transitions.map((item) => item.at)).length === 0,
  {
    path: ["transitions"],
    message: "duplicate time-zone transition instant",
  },
).refine(
  (clock) => clock.transitions.every(
    (transition, index) =>
      index === 0 || clock.transitions[index - 1]!.at < transition.at,
  ),
  {
    path: ["transitions"],
    message: "time-zone transitions must be strictly chronological",
  },
);
const PartySchema = z.strictObject({
  key: Slug,
  kind: z.enum(["natural-person", "trust", "entity"]),
  rosterName: z.string().min(1),
  roles: z.array(
    z.enum([
      "client",
      "grantor",
      "trustee",
      "beneficiary",
      "signer",
      "advisor",
    ]),
  ).min(1),
});
const HouseholdSchema = z.strictObject({
  key: Slug,
  scopeSlug: Slug,
  displayName: z.string().min(1),
  memberRefs: z.array(Slug).min(1),
  advisorRef: Slug,
});
const AccountSchema = z.strictObject({
  key: Slug,
  householdRef: Slug,
  registration: Slug,
  ownerRefs: z.array(Slug).min(1),
  custodian: Slug,
  balanceMinor: Money,
  balanceObservedAt: Instant,
  taxClass: z.enum(["taxable", "retirement", "trust", "entity"]),
});
const BeneficiarySchema = z.strictObject({
  accountRef: Slug,
  partyRef: Slug,
  sharePercentBps: z.int().min(1).max(10000),
  tier: z.enum(["primary", "contingent"]),
});
const orderedEffectivity = (value: {
  effectiveFrom: string;
  effectiveTo: string | null;
}): boolean =>
  value.effectiveTo === null || value.effectiveFrom < value.effectiveTo;
const SignerSchema = z.strictObject({
  key: Slug,
  accountRef: Slug,
  partyRef: Slug,
  authorityScope: Slug,
  effectiveFrom: Instant,
  effectiveTo: Instant.nullable(),
  observedAt: ObservedAt,
}).refine(orderedEffectivity, {
  message: "effectiveTo must be later than effectiveFrom",
  path: ["effectiveTo"],
});
const BankInstructionSchema = z.strictObject({
  key: Slug,
  householdRef: Slug,
  titledTo: Slug,
  bank: z.string().min(1),
  lastFour: z.string().regex(/^\d{4}$/),
  verifiedAt: Instant.nullable(),
  changedAt: Instant.nullable(),
  accountRefs: z.array(Slug).min(1),
  observedAt: ObservedAt,
});
const PlannedWithdrawalSchema = z.strictObject({
  key: Slug,
  householdRef: Slug,
  recordedAt: Instant,
  observedAt: ObservedAt,
  segments: z.array(
    z.strictObject({
      fromMonth: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
      monthlyMinor: Money,
    }),
  ).min(1).refine(
    (segments) => segments.every(
      (segment, index) =>
        index === 0 || segments[index - 1]!.fromMonth < segment.fromMonth,
    ),
    "withdrawal segment months must be strictly increasing",
  ),
});
const RestrictionSchema = z.strictObject({
  key: Slug,
  householdRef: Slug,
  recordedAt: Instant,
  observedAt: ObservedAt,
  scope: z.enum(["household", "account", "position", "party"]),
  subjectRef: Slug,
  kind: Slug,
  effectiveFrom: Instant,
  effectiveTo: Instant.nullable(),
  sourceRef: z.string().min(1),
  term: z.strictObject({
    governedAction: z.enum(GOVERNED_INSTRUCTION_ACTIONS),
    sourceAccountRef: Slug,
    targetKind: z.enum([
      "source-account",
      "destination-instruction",
      "destination-subject",
    ]),
    targetRef: Slug,
    polarity: z.enum(INSTRUCTION_POLARITIES),
  }).optional(),
}).refine(orderedEffectivity, {
  message: "effectiveTo must be later than effectiveFrom",
  path: ["effectiveTo"],
});
const RecentChangeSchema = z.strictObject({
  key: Slug,
  subjectRef: z.string().min(1),
  changeKind: Slug,
  changedAt: Instant,
  observedAt: ObservedAt,
  priorValueRef: z.string().min(1),
});
const ModelAssignmentSchema = z.strictObject({
  key: Slug,
  accountRef: Slug,
  modelId: Slug,
  assignedAt: Instant,
  observedAt: ObservedAt,
  pendingRebalance: z.boolean(),
});
const PendingActionSchema = z.strictObject({
  key: Slug,
  householdRef: Slug,
  accountRef: Slug,
  kind: z.enum(PENDING_ACTION_KINDS),
  amountMinor: Money,
  state: z.enum(PENDING_ACTION_STATES),
  availableMinorIncludesAction: z.boolean(),
  createdAt: Instant,
  observedAt: ObservedAt,
  expectedSettleAt: Instant,
});
const LegalHoldSchema = z.strictObject({
  key: Slug,
  subjectRef: z.string().min(1),
  scope: z.enum(["account", "position"]),
  recordedAt: Instant,
  observedAt: ObservedAt,
  releasedAt: Instant.nullable(),
});

export const WorldSpecSchema = z.strictObject({
  specVersion: z.string().min(1),
  corpusVersion: z.string().min(1),
  rosterNote: z.string().min(1),
  clock: ClockSchema,
  evidenceKinds: z.record(Slug, TimingSchema),
  parties: z.array(PartySchema).min(1),
  households: z.array(HouseholdSchema).min(1),
  accounts: z.array(AccountSchema).min(1),
  beneficiaries: z.array(BeneficiarySchema).min(1),
  authorizedSigners: z.array(SignerSchema).min(1),
  bankInstructions: z.array(BankInstructionSchema).min(1),
  plannedWithdrawals: z.array(PlannedWithdrawalSchema).min(1),
  restrictions: z.array(RestrictionSchema).min(1),
  recentChanges: z.array(RecentChangeSchema).min(1),
  modelAssignments: z.array(ModelAssignmentSchema).min(1),
  pendingActions: z.array(PendingActionSchema).min(1),
  legalHolds: z.array(LegalHoldSchema).min(1),
});
export type WorldSpec = z.infer<typeof WorldSpecSchema>;
export type LegalHoldSpec = WorldSpec["legalHolds"][number];

export interface LoadedSpec {
  readonly world: WorldSpec;
  readonly cases: CasesSpec;
  readonly rawBytes: Readonly<Record<string, string>>;
}

const readSpecFile = (name: string, dir: string): string =>
  readFileSync(join(dir, name), "utf8");

export function loadSpec(dir: string = SPEC_DIR): LoadedSpec {
  const rawBytes = Object.fromEntries(
    SPEC_FILES.map((name) => [name, readSpecFile(name, dir)]),
  );
  const parsed = Object.fromEntries(
    SPEC_FILES.map((name) => [
      name,
      parseStrictJson(rawBytes[name]!, name),
    ]),
  );
  const world = WorldSpecSchema.parse(parsed["world.json"]);
  const cases = CasesSpecSchema.parse(parsed["cases.json"]);
  const problems = specReferenceProblems(world, cases);
  if (problems.length > 0) {
    throw new Error(
      `corpus spec has ${problems.length} unresolved reference(s):\n${problems.join("\n")}`,
    );
  }
  return { world, cases, rawBytes };
}
