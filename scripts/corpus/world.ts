/**
 * CORPUS SPEC LOADER (v3 prompt 11, ADR-0034).
 *
 * The corpus's INPUT is hand-owned declarative data (`fixtures/corpus/spec/*.json`),
 * not code: the "what" stays reviewable and the "how" stays small. This module
 * parses that data with Zod and resolves every cross-reference, so a spec typo is
 * a load-time failure with a path rather than a silently missing record in a
 * generated fixture.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  PENDING_ACTION_KINDS,
  PENDING_ACTION_STATES,
} from "./pending-actions";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
export const CORPUS_DIR = join(REPO_ROOT, "fixtures/corpus");
export const SPEC_DIR = join(CORPUS_DIR, "spec");
export const SYNTHETIC_DIR = join(CORPUS_DIR, "synthetic");
export const REAL_DERIVED_DIR = join(CORPUS_DIR, "real-derived");

/** Every spec file that feeds `generatorDigest`, in canonical order. */
export const SPEC_FILES = ["world.json", "cases.json", "defect-taxonomy.json"] as const;

const Instant = z.iso.datetime({ precision: 3 });
const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase hyphenated slug");
const Money = z.int().nonnegative();
const duplicates = (values: readonly string[]): string[] => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

/**
 * WHEN THE EVIDENCE SOURCE OBSERVED THIS RECORD - never when the underlying fact
 * became true (D-078). Conflating the two makes a long-standing fact necessarily
 * STALE, which silently plants `evidence-staleness-unnoticed` in any case citing
 * it; the clean controls are the cases that rule made unusable. Every record kind
 * therefore carries its own observation instant, the way `balanceObservedAt`
 * always did, and staleness becomes a deliberate per-record property.
 */
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
  transitions: z.array(z.strictObject({ at: Instant, offsetMinutes: z.int() })).min(2),
}).refine((clock) => duplicates(clock.transitions.map((item) => item.at)).length === 0, {
  path: ["transitions"],
  message: "duplicate time-zone transition instant",
});

const PartySchema = z.strictObject({
  key: Slug,
  kind: z.enum(["natural-person", "trust", "entity"]),
  rosterName: z.string().min(1),
  roles: z.array(z.enum(["client", "grantor", "trustee", "beneficiary", "signer", "advisor"])).min(1),
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

const SignerSchema = z.strictObject({
  key: Slug,
  accountRef: Slug,
  partyRef: Slug,
  authorityScope: Slug,
  effectiveFrom: Instant,
  effectiveTo: Instant.nullable(),
  observedAt: ObservedAt,
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
  segments: z
    .array(z.strictObject({ fromMonth: z.string().regex(/^\d{4}-\d{2}$/), monthlyMinor: Money }))
    .min(1),
});

const RestrictionSchema = z.strictObject({
  key: Slug,
  /** When the restriction entered the record. Distinct from `effectiveFrom` on
   * purpose: a future-dated restriction is RECORDED now and IN FORCE later, and
   * conflating the two is assumption AS-13. */
  recordedAt: Instant,
  observedAt: ObservedAt,
  scope: z.enum(["household", "account", "position", "party"]),
  subjectRef: Slug,
  kind: Slug,
  effectiveFrom: Instant,
  effectiveTo: Instant.nullable(),
  sourceRef: z.string().min(1),
});

const RecentChangeSchema = z.strictObject({
  key: Slug,
  subjectRef: z.string().min(1),
  changeKind: Slug,
  /** When the change happened. The record of it is observed separately. */
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
  createdAt: Instant,
  observedAt: ObservedAt,
  expectedSettleAt: Instant,
});

const LegalHoldSchema = z.strictObject({
  key: Slug,
  /** STRUCTURED: `account:<accountKey>` or `position:<accountKey>:<positionId>`.
   * Parsed by `legalHoldSubject`, never substring-matched - `smiths-west` must
   * not leak into `smiths` (D-078). */
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

export interface LegalHoldSubject {
  readonly accountKey: string;
  readonly positionId: string | null;
}

/**
 * The account a legal hold attaches to, parsed out of its structured subjectRef
 * by EXACT segment equality. `subjectRef.includes(key)` would match any key that
 * merely extends an existing one (`position:smiths-west-acct:X` matching
 * `smiths`), leaking a hold into a foreign household's subgraph and breaking the
 * "adding a household changes only that household's bytes" property. `null` when
 * the ref does not match its own declared scope's form.
 */
export function legalHoldSubject(hold: LegalHoldSpec): LegalHoldSubject | null {
  const [scope, accountKey, positionId, ...extra] = hold.subjectRef.split(":");
  if (scope !== hold.scope || accountKey === undefined || accountKey === "" || extra.length > 0) return null;
  if (hold.scope === "account") {
    return positionId === undefined ? { accountKey, positionId: null } : null;
  }
  return positionId !== undefined && positionId !== "" ? { accountKey, positionId } : null;
}

/** The same parse where a malformed ref is a generator abort rather than a
 * filtered-away record. `loadSpec` rejects these by path first. */
export function requireLegalHoldSubject(hold: LegalHoldSpec): LegalHoldSubject {
  const subject = legalHoldSubject(hold);
  if (subject === null) {
    throw new Error(
      `corpus: legalHolds[${hold.key}].subjectRef "${hold.subjectRef}" is not the ${hold.scope}-scoped form ` +
        `("account:<accountKey>" or "position:<accountKey>:<positionId>")`,
    );
  }
  return subject;
}

const LabelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("defect"), defectClassId: Slug }),
  z.strictObject({ kind: z.literal("clean-control"), controlRationale: z.string().min(1) }),
]);
export type CaseLabel = z.infer<typeof LabelSchema>;

const CaseSchema = z.strictObject({
  key: Slug,
  title: z.string().min(1),
  firmId: Slug,
  householdRef: Slug,
  assumptionIds: z.array(z.string().regex(/^AS-\d{2}$/)),
  label: LabelSchema,
  request: z.strictObject({
    sourceAccountRef: Slug,
    destinationRef: Slug,
    amountMinor: z.int().positive(),
    discriminator: Slug,
    deadline: Instant,
  }),
  evidence: z.array(z.string().regex(/^[a-z-]+\/[a-z0-9-]+$/)).min(1),
  conflictFamilies: z.array(Slug).min(1),
});
export type CaseSpec = z.infer<typeof CaseSchema>;

export const CasesSpecSchema = z.strictObject({
  specVersion: z.string().min(1),
  note: z.string().min(1),
  assumptions: z
    .array(
      z.strictObject({
        id: z.string().regex(/^AS-\d{2}$/),
        structure: z.string().min(1),
        falsifies: z.string().min(1),
      }),
    )
    .min(1),
  cases: z.array(CaseSchema).min(1),
});
export type CasesSpec = z.infer<typeof CasesSpecSchema>;

export interface LoadedSpec {
  readonly world: WorldSpec;
  readonly cases: CasesSpec;
  /** Raw bytes per spec file, keyed by file name - the `generatorDigest` preimage. */
  readonly rawBytes: Readonly<Record<string, string>>;
}

const readSpecFile = (name: string, dir: string): string => readFileSync(join(dir, name), "utf8");

/** Cross-reference resolution. A dangling ref is a spec bug reported by path. */
export function specReferenceProblems(world: WorldSpec, cases: CasesSpec): string[] {
  const problems: string[] = [];
  const keys = <T extends { key: string }>(rows: readonly T[]): Set<string> =>
    new Set(rows.map((row) => row.key));
  const parties = keys(world.parties);
  const households = keys(world.households);
  const accounts = keys(world.accounts);
  const instructions = keys(world.bankInstructions);
  const signers = keys(world.authorizedSigners);
  const restrictions = keys(world.restrictions);
  const changes = keys(world.recentChanges);
  const models = keys(world.modelAssignments);
  const pending = keys(world.pendingActions);
  const holds = keys(world.legalHolds);
  const schedules = keys(world.plannedWithdrawals);
  const assumptions = new Set(cases.assumptions.map((a) => a.id));

  const keyedCollections = [
    ["parties", world.parties.map((p) => p.key)],
    ["households", world.households.map((h) => h.key)],
    ["households.scopeSlug", world.households.map((h) => h.scopeSlug)],
    ["accounts", world.accounts.map((a) => a.key)],
    ["authorizedSigners", world.authorizedSigners.map((s) => s.key)],
    ["bankInstructions", world.bankInstructions.map((b) => b.key)],
    ["plannedWithdrawals", world.plannedWithdrawals.map((w) => w.key)],
    ["restrictions", world.restrictions.map((r) => r.key)],
    ["recentChanges", world.recentChanges.map((c) => c.key)],
    ["modelAssignments", world.modelAssignments.map((m) => m.key)],
    ["pendingActions", world.pendingActions.map((a) => a.key)],
    ["legalHolds", world.legalHolds.map((h) => h.key)],
    ["cases", cases.cases.map((c) => c.key)],
    ["assumptions", cases.assumptions.map((a) => a.id)],
  ] as const;
  for (const [label, values] of keyedCollections) {
    for (const dup of duplicates(values)) problems.push(`${label}: duplicate key "${dup}"`);
  }
  for (const dup of duplicates([
    ...world.parties.map((row) => row.key),
    ...world.households.map((row) => row.key),
    ...world.accounts.map((row) => row.key),
  ])) {
    problems.push(`subject namespace: duplicate key "${dup}" across parties, households, or accounts`);
  }

  const need = (set: Set<string>, ref: string, where: string): void => {
    if (!set.has(ref)) problems.push(`${where} -> "${ref}" does not resolve`);
  };

  for (const household of world.households) {
    for (const member of household.memberRefs) need(parties, member, `households[${household.key}].memberRefs`);
    need(parties, household.advisorRef, `households[${household.key}].advisorRef`);
  }
  for (const account of world.accounts) {
    need(households, account.householdRef, `accounts[${account.key}].householdRef`);
    for (const owner of account.ownerRefs) need(parties, owner, `accounts[${account.key}].ownerRefs`);
  }
  for (const beneficiary of world.beneficiaries) {
    need(accounts, beneficiary.accountRef, `beneficiaries[${beneficiary.accountRef}].accountRef`);
    need(parties, beneficiary.partyRef, `beneficiaries[${beneficiary.accountRef}].partyRef`);
  }
  for (const signer of world.authorizedSigners) {
    need(accounts, signer.accountRef, `authorizedSigners[${signer.key}].accountRef`);
    need(parties, signer.partyRef, `authorizedSigners[${signer.key}].partyRef`);
  }
  for (const instruction of world.bankInstructions) {
    need(households, instruction.householdRef, `bankInstructions[${instruction.key}].householdRef`);
    need(parties, instruction.titledTo, `bankInstructions[${instruction.key}].titledTo`);
    for (const account of instruction.accountRefs) {
      need(accounts, account, `bankInstructions[${instruction.key}].accountRefs`);
    }
  }
  for (const schedule of world.plannedWithdrawals) {
    need(households, schedule.householdRef, `plannedWithdrawals[${schedule.key}].householdRef`);
  }
  for (const action of world.pendingActions) {
    need(households, action.householdRef, `pendingActions[${action.key}].householdRef`);
    need(accounts, action.accountRef, `pendingActions[${action.key}].accountRef`);
  }
  for (const assignment of world.modelAssignments) {
    need(accounts, assignment.accountRef, `modelAssignments[${assignment.key}].accountRef`);
  }
  for (const change of world.recentChanges) {
    const [prefix, key, ...extra] = change.subjectRef.split(":");
    const where = `recentChanges[${change.key}].subjectRef`;
    if (extra.length > 0 || key === undefined || key === "") {
      problems.push(`${where} -> "${change.subjectRef}" is not a supported structured subject`);
    } else if (prefix === "bank-instruction") {
      need(instructions, key, where);
    } else if (prefix === "subject") {
      need(accounts, key, where);
    } else {
      problems.push(`${where} -> "${change.subjectRef}" uses unsupported subject kind "${prefix}"`);
    }
    if (!change.priorValueRef.startsWith(`${change.subjectRef}@`) || change.priorValueRef.length === change.subjectRef.length + 1) {
      problems.push(
        `recentChanges[${change.key}].priorValueRef -> "${change.priorValueRef}" is not a prior version of "${change.subjectRef}"`,
      );
    }
  }
  const householdMembers = new Set(world.households.flatMap((household) => household.memberRefs));
  for (const restriction of world.restrictions) {
    const where = `restrictions[${restriction.key}].subjectRef`;
    switch (restriction.scope) {
      case "household":
        need(households, restriction.subjectRef, where);
        break;
      case "party":
        need(parties, restriction.subjectRef, where);
        // A household subgraph collects party-scoped restrictions through its
        // MEMBER list, so one naming a party who is nobody's member (an advisor,
        // an account signer from elsewhere) would resolve here and then appear in
        // no subgraph at all - the silent drop, one scope over.
        if (parties.has(restriction.subjectRef) && !householdMembers.has(restriction.subjectRef)) {
          problems.push(
            `${where}: party "${restriction.subjectRef}" is a member of no household, so this restriction would reach no household subgraph`,
          );
        }
        break;
      case "account":
        need(accounts, restriction.subjectRef, where);
        break;
      case "position":
        // Refused, not dropped: a position subject has no modeled form here, and
        // silently omitting the record from every subgraph would leave a case
        // whose evidence points at a record absent from its own graph.
        problems.push(
          `${where}: scope "position" has no modeled subject form - use a position-scoped legal hold, or extend the spec and the household subgraph together`,
        );
        break;
    }
  }
  for (const hold of world.legalHolds) {
    const subject = legalHoldSubject(hold);
    if (subject === null) {
      problems.push(
        `legalHolds[${hold.key}].subjectRef -> "${hold.subjectRef}" is not the ${hold.scope}-scoped form ("account:<accountKey>" or "position:<accountKey>:<positionId>")`,
      );
      continue;
    }
    need(accounts, subject.accountKey, `legalHolds[${hold.key}].subjectRef`);
  }

  const collections: Record<string, Set<string>> = {
    balance: accounts,
    "bank-instruction": instructions,
    "household-instruction": restrictions,
    restriction: restrictions,
    "planned-withdrawals": schedules,
    "pending-actions": pending,
    authority: signers,
    "model-assignment": models,
    "legal-hold": holds,
    "recent-change": changes,
  };
  for (const corpusCase of cases.cases) {
    need(households, corpusCase.householdRef, `cases[${corpusCase.key}].householdRef`);
    need(accounts, corpusCase.request.sourceAccountRef, `cases[${corpusCase.key}].request.sourceAccountRef`);
    need(instructions, corpusCase.request.destinationRef, `cases[${corpusCase.key}].request.destinationRef`);
    for (const id of corpusCase.assumptionIds) {
      need(assumptions, id, `cases[${corpusCase.key}].assumptionIds`);
    }
    for (const dup of duplicates(corpusCase.assumptionIds)) {
      problems.push(`cases[${corpusCase.key}].assumptionIds: duplicate reference "${dup}"`);
    }
    for (const dup of duplicates(corpusCase.evidence)) {
      problems.push(`cases[${corpusCase.key}].evidence: duplicate reference "${dup}"`);
    }
    for (const dup of duplicates(corpusCase.conflictFamilies)) {
      problems.push(`cases[${corpusCase.key}].conflictFamilies: duplicate family "${dup}"`);
    }
    for (const ref of corpusCase.evidence) {
      const [kind = "", recordKey = ""] = ref.split("/");
      const collection = collections[kind];
      if (collection === undefined) {
        problems.push(`cases[${corpusCase.key}].evidence -> unknown evidence kind "${kind}"`);
        continue;
      }
      if (world.evidenceKinds[kind] === undefined) {
        problems.push(`cases[${corpusCase.key}].evidence -> evidence kind "${kind}" has no timing band in world.evidenceKinds`);
      }
      need(collection, recordKey, `cases[${corpusCase.key}].evidence[${kind}]`);
    }
  }
  for (const assumption of cases.assumptions) {
    if (!cases.cases.some((c) => c.assumptionIds.includes(assumption.id))) {
      problems.push(`assumptions[${assumption.id}] is attacked by no case - an unexercised structure is decoration`);
    }
  }
  for (const [kind, timing] of Object.entries(world.evidenceKinds)) {
    if (timing.minRetrievalLagSeconds > timing.maxRetrievalLagSeconds) {
      problems.push(`evidenceKinds[${kind}]: minRetrievalLagSeconds exceeds maxRetrievalLagSeconds`);
    }
  }
  return problems;
}

/** Parse + resolve the hand-owned spec. Throws with every problem listed. */
export function loadSpec(dir: string = SPEC_DIR): LoadedSpec {
  const rawBytes = Object.fromEntries(SPEC_FILES.map((name) => [name, readSpecFile(name, dir)]));
  const world = WorldSpecSchema.parse(JSON.parse(rawBytes["world.json"]!));
  const cases = CasesSpecSchema.parse(JSON.parse(rawBytes["cases.json"]!));
  const problems = specReferenceProblems(world, cases);
  if (problems.length > 0) {
    throw new Error(`corpus spec has ${problems.length} unresolved reference(s):\n${problems.join("\n")}`);
  }
  return { world, cases, rawBytes };
}
