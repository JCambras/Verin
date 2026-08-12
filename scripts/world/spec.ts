/**
 * POPULATED-WORLD SPEC (ADR-0057, front-end parity prompt 4).
 *
 * Two hand-owned files are the ONLY input a person edits:
 *   fixtures/world/spec/roster.json   - vocabulary, cast, and world size
 *   fixtures/world/spec/featured.json - hand-authored depth for the households
 *                                       the product surfaces most
 * Everything under `fixtures/world/{manifest.json,households/}` is generated;
 * `pnpm world:validate` regenerates and byte-compares, so a hand edit fails CI.
 *
 * The vocabularies are imported from `@domain/world/household-world`, never
 * restated here: a fixture that could carry a registration type the product
 * cannot render is a fixture that will eventually carry one.
 */
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  ACTIVITY_KINDS,
  ENTITY_KINDS,
  HOUSEHOLD_STATES,
  INSTRUCTION_KINDS,
  INSTRUCTION_POLARITIES,
  INSTRUCTION_SCOPES,
  MEMBER_ROLES,
  PARTY_KINDS,
  REGISTRATION_TYPES,
  RELATIONSHIP_KINDS,
  SERVICE_TIERS,
  TAX_CLASSES,
  ASSET_CLASSES,
  BENEFICIARY_TIERS,
  BANK_INSTRUCTION_STATES,
  CROSS_HOUSEHOLD_LINK_KINDS,
} from "../../src/domain/world/household-world";
import { PENDING_ACTION_KINDS, PENDING_ACTION_STATES } from "../corpus/pending-actions";
import { duplicates } from "../corpus/_util";
import { parseStrictJson } from "../corpus/strict-json";
import { readRepositoryFile } from "../corpus/tree";

/** Root seed. A STRING, so it reads in the manifest, and versioned with the
 * world: changing it is a new world, not a new shuffle of this one. */
export const WORLD_SEED = "verin-world/2026.08.0";

export const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
export const WORLD_DIR = join(REPO_ROOT, "fixtures/world");
export const WORLD_SPEC_DIR = join(WORLD_DIR, "spec");
export const HOUSEHOLDS_DIR = join(WORLD_DIR, "households");
export const WORLD_SPEC_FILES = ["roster.json", "featured.json"] as const;

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase hyphenated slug");
const Instant = z.iso.datetime({ precision: 3 });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO calendar day");
const Month = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, "ISO year-month");
const Money = z.int().nonnegative();
const Text = z.string().min(1);

const NamedKey = z.strictObject({ key: Slug, displayName: Text });

export const RosterSchema = z.strictObject({
  specVersion: Text,
  worldVersion: Text,
  householdCount: z.int().min(1).max(1000),
  rosterNote: Text,
  clock: z.strictObject({
    asOf: Instant,
    timeZone: Text,
    freshLiquidityWindowDays: z.int().positive(),
    recentChangeWindowDays: z.int().positive(),
  }),
  firm: z.strictObject({ orgName: Text, fiscalYearStartMonth: z.int().min(1).max(12) }),
  advisors: z.array(NamedKey.extend({ credential: Text })).min(1),
  custodians: z.array(NamedKey).min(1),
  banks: z.array(Text).min(1),
  surnames: z.array(Text).min(2),
  givenNames: z.array(Text).min(2),
  childGivenNames: z.array(Text).min(2),
  cities: z.array(Text).min(1),
  instruments: z.array(z.strictObject({
    symbol: z.string().regex(/^[A-Z]{3,5}$/),
    description: Text,
    assetClass: z.enum(ASSET_CLASSES),
  })).min(4),
  // A model's target allocation is hand-owned data, not a table hidden in the
  // generator: the holdings a surface renders are a split of the account
  // balance across these weights, so the weights belong where a person edits.
  // One asset class per model, at most once: two targets naming the same class
  // draw the SAME instruments under the same field key, so the account would
  // render one lot twice and its weights would silently double-count.
  modelPortfolios: z.array(NamedKey.extend({
    targets: z.array(z.strictObject({
      assetClass: z.enum(ASSET_CLASSES),
      weightBps: z.int().min(1).max(10000),
    })).min(1).refine(
      (targets) => new Set(targets.map((target) => target.assetClass)).size === targets.length,
      "a model portfolio names each asset class at most once",
    ),
  })).min(1),
  withdrawalPurposes: z.array(Text).min(1),
  activityKinds: z.array(z.enum(ACTIVITY_KINDS)).min(1),
  serviceTiers: z.array(z.enum(SERVICE_TIERS)).min(1),
  deliberateSurnameCollisions: z.array(z.strictObject({
    surname: Text,
    households: z.int().min(2),
  })),
});
export type Roster = z.infer<typeof RosterSchema>;

const FeaturedAccountSchema = z.strictObject({
  key: Slug,
  title: Text,
  registration: z.enum(REGISTRATION_TYPES),
  taxClass: z.enum(TAX_CLASSES),
  custodianKey: Slug,
  openedOn: Day,
  balanceMinor: Money,
  ownerKeys: z.array(Slug).min(1),
  modelPortfolioKey: Slug,
  beneficiaries: z.array(z.strictObject({
    partyKey: Slug,
    tier: z.enum(BENEFICIARY_TIERS),
    shareBps: z.int().min(1).max(10000),
  })),
  signers: z.array(z.strictObject({
    partyKey: Slug,
    authorityScope: Slug,
    effectiveFrom: Day,
    effectiveTo: Day.nullable(),
  })),
});

const FeaturedHouseholdSchema = z.strictObject({
  key: Slug,
  displayName: Text,
  surname: Text,
  status: z.enum(HOUSEHOLD_STATES),
  advisorKey: Slug,
  serviceTier: z.enum(SERVICE_TIERS),
  city: Text,
  openedOn: Day,
  narrative: Text,
  /** Whole days before the world's `asOf` that each class of evidence was last
   * observed. Hand-authored because it is the point of some households: one is
   * deliberately stale so the freshness factor has something to say. Omitted
   * households draw their evidence ages path-keyed like the derived ones. */
  evidenceAgeDays: z.strictObject({
    liquidity: z.int().min(0).max(400),
    positions: z.int().min(0).max(400),
    instructions: z.int().min(0).max(400),
  }).optional(),
  members: z.array(z.strictObject({
    key: Slug,
    displayName: Text,
    kind: z.enum(PARTY_KINDS),
    role: z.enum(MEMBER_ROLES),
    relationships: z.array(z.strictObject({ toKey: Slug, kind: z.enum(RELATIONSHIP_KINDS) })),
  })).min(1),
  entities: z.array(z.strictObject({
    key: Slug,
    kind: z.enum(ENTITY_KINDS),
    name: Text,
    formedOn: Day,
    trusteeKeys: z.array(Slug).min(1),
    note: Text,
  })),
  accounts: z.array(FeaturedAccountSchema).min(1),
  bankInstructions: z.array(z.strictObject({
    key: Slug,
    bank: Text,
    lastFour: z.string().regex(/^\d{4}$/),
    titledTo: Text,
    status: z.enum(BANK_INSTRUCTION_STATES),
    verifiedAt: Instant.nullable(),
    changedAt: Instant.nullable(),
    supersedesKey: Slug.nullable(),
    accountKeys: z.array(Slug).min(1),
  })),
  plannedWithdrawals: z.array(z.strictObject({
    key: Slug,
    accountKey: Slug,
    purpose: Text,
    fromMonth: Month,
    monthlyMinor: Money,
    recordedAt: Instant,
  })),
  instructions: z.array(z.strictObject({
    key: Slug,
    kind: z.enum(INSTRUCTION_KINDS),
    polarity: z.enum(INSTRUCTION_POLARITIES),
    scope: z.enum(INSTRUCTION_SCOPES),
    subjectRef: Text,
    text: Text,
    sourceRef: Text,
    effectiveFrom: Instant,
    effectiveTo: Instant.nullable(),
    recordedAt: Instant,
  })),
  pendingActions: z.array(z.strictObject({
    key: Slug,
    accountKey: Slug,
    kind: z.enum(PENDING_ACTION_KINDS),
    amountMinor: Money,
    state: z.enum(PENDING_ACTION_STATES),
    createdAt: Instant,
    expectedSettleAt: Instant,
  })),
  activity: z.array(z.strictObject({
    key: Slug,
    occurredAt: Instant,
    kind: z.enum(ACTIVITY_KINDS),
    summary: Text,
    actorLabel: Text,
  })).min(1),
  crossHouseholdLinks: z.array(z.strictObject({
    kind: z.enum(CROSS_HOUSEHOLD_LINK_KINDS),
    counterpartyHouseholdKey: Slug,
    partyKey: Slug,
    note: Text,
  })),
});
export type FeaturedHousehold = z.infer<typeof FeaturedHouseholdSchema>;

export const FeaturedSchema = z.strictObject({
  specVersion: Text,
  note: Text,
  households: z.array(FeaturedHouseholdSchema).min(1),
});

export interface LoadedWorldSpec {
  readonly roster: Roster;
  readonly featured: readonly FeaturedHousehold[];
  readonly rawBytes: Readonly<Record<string, string>>;
}

/** Cross-file reference problems, reported together rather than one throw at a
 * time: a spec with three broken references should say so in one run. */
export function specProblems(roster: Roster, featured: readonly FeaturedHousehold[]): string[] {
  const problems: string[] = [];
  const advisorKeys = new Set(roster.advisors.map((advisor) => advisor.key));
  const custodianKeys = new Set(roster.custodians.map((custodian) => custodian.key));
  const modelKeys = new Set(roster.modelPortfolios.map((model) => model.key));
  const householdKeys = new Set(featured.map((household) => household.key));
  for (const duplicate of duplicates(featured.map((household) => household.key))) {
    problems.push(`featured household "${duplicate}" is declared twice`);
  }
  if (featured.length > roster.householdCount) {
    problems.push(`${featured.length} featured households exceed householdCount ${roster.householdCount}`);
  }
  for (const household of featured) {
    const where = `featured/${household.key}`;
    const partyKeys = new Set([
      ...household.members.map((member) => member.key),
      ...household.entities.map((entity) => entity.key),
    ]);
    const accountKeys = new Set(household.accounts.map((account) => account.key));
    if (!advisorKeys.has(household.advisorKey)) problems.push(`${where}: unknown advisor "${household.advisorKey}"`);
    if (!roster.cities.includes(household.city)) problems.push(`${where}: unknown city "${household.city}"`);
    for (const member of household.members) {
      for (const relationship of member.relationships) {
        if (!partyKeys.has(relationship.toKey)) problems.push(`${where}: relationship to unknown party "${relationship.toKey}"`);
      }
    }
    for (const entity of household.entities) {
      for (const trustee of entity.trusteeKeys) {
        if (!partyKeys.has(trustee)) problems.push(`${where}: entity ${entity.key} names unknown controller "${trustee}"`);
      }
    }
    for (const account of household.accounts) {
      if (!custodianKeys.has(account.custodianKey)) problems.push(`${where}/${account.key}: unknown custodian "${account.custodianKey}"`);
      if (!modelKeys.has(account.modelPortfolioKey)) problems.push(`${where}/${account.key}: unknown model "${account.modelPortfolioKey}"`);
      for (const owner of account.ownerKeys) {
        if (!partyKeys.has(owner)) problems.push(`${where}/${account.key}: unknown owner "${owner}"`);
      }
      for (const beneficiary of account.beneficiaries) {
        if (!partyKeys.has(beneficiary.partyKey)) problems.push(`${where}/${account.key}: unknown beneficiary "${beneficiary.partyKey}"`);
      }
      for (const signer of account.signers) {
        if (!partyKeys.has(signer.partyKey)) problems.push(`${where}/${account.key}: unknown signer "${signer.partyKey}"`);
      }
    }
    const refsAccount = (accountKey: string, what: string): void => {
      if (!accountKeys.has(accountKey)) problems.push(`${where}: ${what} references unknown account "${accountKey}"`);
    };
    for (const instruction of household.bankInstructions) {
      instruction.accountKeys.forEach((accountKey) => refsAccount(accountKey, `bank instruction ${instruction.key}`));
      if (instruction.supersedesKey !== null && !household.bankInstructions.some((other) => other.key === instruction.supersedesKey)) {
        problems.push(`${where}: bank instruction ${instruction.key} supersedes unknown "${instruction.supersedesKey}"`);
      }
    }
    household.plannedWithdrawals.forEach((withdrawal) => refsAccount(withdrawal.accountKey, `planned withdrawal ${withdrawal.key}`));
    household.pendingActions.forEach((action) => refsAccount(action.accountKey, `pending action ${action.key}`));
    for (const instruction of household.instructions) {
      const known = instruction.scope === "household"
        ? instruction.subjectRef === "household"
        : partyKeys.has(instruction.subjectRef) || accountKeys.has(instruction.subjectRef);
      if (!known) problems.push(`${where}: instruction ${instruction.key} names unknown subject "${instruction.subjectRef}"`);
    }
    for (const link of household.crossHouseholdLinks) {
      if (!householdKeys.has(link.counterpartyHouseholdKey)) {
        problems.push(`${where}: cross-household link names unknown counterparty "${link.counterpartyHouseholdKey}"`);
      }
    }
  }
  return problems;
}

export function loadWorldSpec(dir: string = WORLD_SPEC_DIR): LoadedWorldSpec {
  const rawBytes = Object.fromEntries(
    WORLD_SPEC_FILES.map((name) => [name, readRepositoryFile(join(dir, name), REPO_ROOT)]),
  );
  const roster = RosterSchema.parse(parseStrictJson(rawBytes["roster.json"]!, "roster.json"));
  const featured = FeaturedSchema.parse(parseStrictJson(rawBytes["featured.json"]!, "featured.json"));
  const problems = specProblems(roster, featured.households);
  if (problems.length > 0) {
    throw new Error(`world spec has ${problems.length} problem(s):\n${problems.join("\n")}`);
  }
  return { roster, featured: featured.households, rawBytes };
}
