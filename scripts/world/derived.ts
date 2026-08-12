/**
 * DERIVED HOUSEHOLDS (ADR-0057).
 *
 * The ninety households nobody hand-authored, drawn path-keyed from the roster
 * into the SAME draft shape the hand-authored ten use, so one materializer
 * serves both and a derived household is never structurally thinner than a
 * featured one - only less specific.
 *
 * Addressing: a derived household's path is `derived/<slot>` over the derived
 * slots alone, so adding a featured household drops the LAST derived slot
 * instead of reshuffling every remaining one.
 */
import {
  dayOf,
  daysBefore,
  dollars,
  intBetween,
  lastFour,
  monthOf,
  pick,
  pickDistinct,
  addDays,
} from "./derive";
import type { FeaturedHousehold, Roster } from "./spec";

/** Household archetypes, so the population has real structural variety rather
 * than ninety copies of one shape with different names. */
const ARCHETYPES = [
  "couple-with-children", "couple-with-children", "couple", "couple",
  "single", "single-with-trust", "multi-generational", "entity",
] as const;
type Archetype = (typeof ARCHETYPES)[number];

const RETIREMENT_REGISTRATIONS = ["ira-traditional", "ira-roth", "rollover-ira", "sep-ira"] as const;

const FORBIDDEN_TEXTS = [
  "No distribution settles to an account this household does not own without a countersigned instruction.",
  "No position may be liquidated to fund a distribution without the household's written acknowledgement.",
] as const;
const REQUIRED_TEXTS = [
  "The household is notified before any distribution over $10,000 leaves it.",
  "Every change to an account's target model is reviewed with the household before it is placed.",
] as const;

/** An entity household holds exactly one account, so "1 accounts" is now prose a
 * reader meets rather than a case the shape could not reach. */
const countOf = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

const slug = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Surname per derived slot: the roster's deliberate collisions are filled
 * FIRST - four Smith households and three Whitfields exist so that searching a
 * surname is provably not the same as finding a household - and the remaining
 * slots draw from the roster path-keyed, which produces further honest
 * collisions on its own.
 */
export function derivedSurnames(roster: Roster, featured: readonly FeaturedHousehold[], slots: number, seed: string): string[] {
  const already = new Map<string, number>();
  for (const household of featured) already.set(household.surname, (already.get(household.surname) ?? 0) + 1);
  const owed: string[] = [];
  for (const collision of roster.deliberateSurnameCollisions) {
    const remaining = collision.households - (already.get(collision.surname) ?? 0);
    for (let n = 0; n < remaining; n += 1) owed.push(collision.surname);
  }
  return Array.from({ length: slots }, (_, slot) =>
    slot < owed.length ? owed[slot]! : pick(seed, `derived/${slot}`, "surname", roster.surnames),
  );
}

interface DerivedMember {
  readonly key: string;
  readonly displayName: string;
  readonly kind: "natural-person";
  readonly role: FeaturedHousehold["members"][number]["role"];
  readonly relationships: FeaturedHousehold["members"][number]["relationships"];
}

function buildMembers(seed: string, path: string, roster: Roster, surname: string, archetype: Archetype): DerivedMember[] {
  const adults = archetype === "single" || archetype === "single-with-trust" ? 1 : 2;
  const childCount = archetype === "couple-with-children" ? intBetween(seed, path, "children", 1, 3)
    : archetype === "multi-generational" ? 2
    : archetype === "entity" ? 0 : 0;
  const adultNames = pickDistinct(seed, path, "adults", roster.givenNames, adults);
  const childNames = pickDistinct(seed, path, "children-names", roster.childGivenNames, childCount);
  const members: DerivedMember[] = adultNames.map((given, index) => ({
    key: slug(given),
    displayName: `${given} ${surname}`,
    kind: "natural-person" as const,
    role: (archetype === "entity" ? "signer" : index === 0 ? "client" : "spouse") as DerivedMember["role"],
    relationships: adults === 2
      ? [{ toKey: slug(adultNames[index === 0 ? 1 : 0]!), kind: "spouse" as const }]
      : [],
  }));
  for (const given of childNames) {
    members.push({
      key: slug(given),
      displayName: `${given} ${surname}`,
      kind: "natural-person",
      role: "beneficiary",
      relationships: adultNames.map((adult) => ({ toKey: slug(adult), kind: "child" as const })),
    });
  }
  for (const member of members) {
    if (member.role !== "beneficiary") continue;
    for (const adult of adultNames) {
      const parent = members.find((candidate) => candidate.key === slug(adult));
      if (parent) parent.relationships.push({ toKey: member.key, kind: "parent" });
    }
  }
  return members;
}

function buildEntities(seed: string, path: string, archetype: Archetype, surname: string, members: readonly DerivedMember[]): FeaturedHousehold["entities"] {
  if (archetype !== "single-with-trust" && archetype !== "entity" && archetype !== "multi-generational") return [];
  const kind = archetype === "entity" ? "llc" : archetype === "multi-generational" ? "irrevocable-trust" : "revocable-trust";
  const name = kind === "llc" ? `${surname} Holdings LLC` : `${surname} Family ${kind === "revocable-trust" ? "Revocable" : "Irrevocable"} Trust`;
  return [{
    key: `${slug(surname)}-${kind}`,
    kind,
    name,
    formedOn: dayOf(daysBefore(seed, path, "entity-formed", "2024-01-01T12:00:00.000Z", 400, 4000)),
    trusteeKeys: members.filter((member) => member.role !== "beneficiary").map((member) => member.key),
    note: kind === "llc"
      ? "Operating entity; the household's natural persons appear only as signers."
      : "Trustees are the household's adults; beneficiaries hold no authority over the account.",
  }];
}

function buildAccounts(
  seed: string, path: string, roster: Roster,
  members: readonly DerivedMember[], entities: FeaturedHousehold["entities"], asOf: string,
): FeaturedHousehold["accounts"] {
  // PERSONAL accounts belong to the household's own clients. An entity
  // household's people appear only as SIGNERS - its own entity note says so - so
  // a joint account and two personal IRAs titled to them would make the
  // household contradict its own prose on the first page a reader opens.
  const adults = members.filter((member) => member.role === "client" || member.role === "spouse");
  const children = members.filter((member) => member.role === "beneficiary");
  const accounts: FeaturedHousehold["accounts"] = [];
  const custodian = pick(seed, path, "custodian", roster.custodians).key;
  const openedOn = (field: string, minDays: number, maxDays: number): string =>
    dayOf(daysBefore(seed, path, field, asOf, minDays, maxDays));
  const account = (
    key: string, title: string, registration: FeaturedHousehold["accounts"][number]["registration"],
    taxClass: FeaturedHousehold["accounts"][number]["taxClass"], ownerKeys: readonly string[],
    balanceMinor: number, opened: string,
    beneficiaries: FeaturedHousehold["accounts"][number]["beneficiaries"] = [],
    signers: FeaturedHousehold["accounts"][number]["signers"] = [],
  ): FeaturedHousehold["accounts"][number] => ({
    key, title, registration, taxClass, custodianKey: custodian, openedOn: opened,
    balanceMinor, ownerKeys: [...ownerKeys],
    modelPortfolioKey: pick(seed, path, `${key}/model`, roster.modelPortfolios).key,
    beneficiaries: [...beneficiaries], signers: [...signers],
  });
  if (entities.length > 0) {
    const entity = entities[0]!;
    accounts.push(account(
      "entity", `${entity.name} - Investment`,
      entity.kind === "llc" ? "llc-entity" : entity.kind === "revocable-trust" ? "revocable-trust" : "irrevocable-trust",
      entity.kind === "llc" ? "entity" : "trust", [entity.key],
      dollars(seed, path, "entity-balance", 250_000, 4_000_000), openedOn("entity-opened", 400, 4000), [],
      entity.trusteeKeys.map((trustee) => ({
        partyKey: trustee,
        authorityScope: entity.kind === "llc" ? "managing-member-full-authority" : "trustee-full-authority",
        effectiveFrom: entity.formedOn, effectiveTo: null,
      })),
    ));
  }
  if (adults.length === 2) {
    accounts.push(account("joint", `${adults.map((a) => a.displayName).join(" & ")} - Joint WROS`, "joint-wros", "taxable",
      adults.map((a) => a.key), dollars(seed, path, "joint-balance", 40_000, 900_000), openedOn("joint-opened", 200, 3600)));
  } else if (adults.length === 1) {
    accounts.push(account("individual", `${adults[0]!.displayName} - Individual`, "individual", "taxable",
      [adults[0]!.key], dollars(seed, path, "individual-balance", 25_000, 1_200_000), openedOn("individual-opened", 200, 3600)));
  }
  adults.forEach((adult, index) => {
    const registration = pick(seed, path, `${adult.key}/registration`, RETIREMENT_REGISTRATIONS);
    const other = adults[index === 0 ? adults.length - 1 : 0]!;
    // An account owner is never their own beneficiary. A sole adult with nobody
    // else in the household simply has NO designation - which is the realistic
    // case, is what the surface already says, and is what the beneficiary health
    // factor is there to score. Naming the owner would score it complete.
    const primaryKey = other.key === adult.key ? null : other.key;
    const contingent = children.slice(0, 1).filter((child) => child.key !== primaryKey);
    accounts.push(account(`${adult.key}-retirement`, `${adult.displayName} - ${registration === "ira-roth" ? "Roth IRA" : registration === "sep-ira" ? "SEP IRA" : registration === "rollover-ira" ? "Rollover IRA" : "Traditional IRA"}`,
      registration, "retirement", [adult.key],
      dollars(seed, path, `${adult.key}/retirement-balance`, 60_000, 2_200_000), openedOn(`${adult.key}/retirement-opened`, 200, 3600),
      [
        ...(primaryKey === null ? [] : [{ partyKey: primaryKey, tier: "primary" as const, shareBps: 10000 }]),
        ...contingent.map((child) => ({ partyKey: child.key, tier: "contingent" as const, shareBps: 10000 })),
      ]));
  });
  for (const child of children.slice(0, 2)) {
    accounts.push(account(`${child.key}-529`, `${child.displayName} - 529 Education Savings`, "education-529", "education",
      [adults[0]?.key ?? child.key], dollars(seed, path, `${child.key}/529-balance`, 4_000, 180_000), openedOn(`${child.key}/529-opened`, 100, 2500),
      [{ partyKey: child.key, tier: "primary" as const, shareBps: 10000 }]));
  }
  return accounts;
}

/** One derived household, in the same draft shape a hand-authored one uses. */
export function derivedHousehold(
  seed: string, roster: Roster, slot: number, surname: string, takenKeys: ReadonlySet<string>, asOf: string,
): FeaturedHousehold {
  const path = `derived/${slot}`;
  const archetype = pick(seed, path, "archetype", ARCHETYPES);
  const members = buildMembers(seed, path, roster, surname, archetype);
  const entities = buildEntities(seed, path, archetype, surname, members);
  const accounts = buildAccounts(seed, path, roster, members, entities, asOf);
  const city = pick(seed, path, "city", roster.cities);
  const base = `${slug(surname)}-${members[0]!.key}`;
  const key = takenKeys.has(base) ? `${base}-${slot}` : base;
  const primaryAccount = accounts[0]!;
  // A bank instruction is titled to whoever OWNS the account it pays. An entity
  // household's only account belongs to the entity, so titling it to a signer
  // read as a mismatch on the one page that shows both.
  const titledTo = members.find((member) => member.key === primaryAccount.ownerKeys[0])?.displayName
    ?? entities.find((entity) => entity.key === primaryAccount.ownerKeys[0])?.name
    ?? members[0]!.displayName;
  const bankChanged = intBetween(seed, path, "bank-changed", 0, 9) < 2;
  const changedAt = daysBefore(seed, path, "bank-change-at", asOf, 1, roster.clock.recentChangeWindowDays);
  const withdrawalCount = intBetween(seed, path, "withdrawal-count", 0, 2);
  const pendingCount = intBetween(seed, path, "pending-count", 0, 3);
  const activityCount = intBetween(seed, path, "activity-count", 2, 5);
  const instructionCount = intBetween(seed, path, "instruction-count", 0, 2);
  return {
    key,
    displayName: members.length > 1 && members[1]!.role === "spouse"
      ? `${members[0]!.displayName.split(" ")[0]} & ${members[1]!.displayName}`
      : entities.length > 0 && archetype === "entity" ? entities[0]!.name : members[0]!.displayName,
    surname,
    status: pick(seed, path, "status", ["active", "active", "active", "active", "prospect", "inactive"] as const),
    advisorKey: pick(seed, path, "advisor", roster.advisors).key,
    serviceTier: pick(seed, path, "tier", roster.serviceTiers),
    city,
    openedOn: dayOf(daysBefore(seed, path, "opened", asOf, 200, 5400)),
    narrative: `${archetype.replace(/-/g, " ")} household in ${city}; ${countOf(accounts.length, "account")} across ${countOf(new Set(accounts.map((account) => account.taxClass)).size, "tax treatment")}.`,
    members: members.map((member) => ({ ...member, relationships: [...member.relationships] })),
    entities,
    accounts,
    bankInstructions: [
      ...(bankChanged
        ? [{
            key: "prior", bank: pick(seed, path, "bank", roster.banks), lastFour: lastFour(seed, path, "prior-last-four"),
            titledTo, status: "superseded" as const,
            verifiedAt: daysBefore(seed, path, "prior-verified", changedAt, 60, 900), changedAt: null,
            supersedesKey: null, accountKeys: [primaryAccount.key],
          }]
        : []),
      {
        key: "current", bank: pick(seed, path, "bank", roster.banks), lastFour: lastFour(seed, path, "last-four"),
        titledTo, status: "current" as const,
        verifiedAt: bankChanged ? null : daysBefore(seed, path, "verified", asOf, 30, 800),
        changedAt: bankChanged ? changedAt : null,
        supersedesKey: bankChanged ? "prior" : null, accountKeys: [primaryAccount.key],
      },
    ],
    plannedWithdrawals: Array.from({ length: withdrawalCount }, (_, n) => ({
      key: `draw-${n}`, accountKey: accounts[intBetween(seed, path, `draw-${n}/account`, 0, accounts.length - 1)]!.key,
      purpose: pick(seed, path, `draw-${n}/purpose`, roster.withdrawalPurposes),
      fromMonth: monthOf(daysBefore(seed, path, `draw-${n}/from`, asOf, 30, 900)),
      monthlyMinor: dollars(seed, path, `draw-${n}/amount`, 800, 24_000),
      recordedAt: daysBefore(seed, path, `draw-${n}/recorded`, asOf, 40, 1000),
    })),
    instructions: Array.from({ length: instructionCount }, (_, n) => {
      const forbidden = intBetween(seed, path, `instruction-${n}/polarity`, 0, 1) === 0;
      return {
        key: `instruction-${n}`,
        kind: (forbidden ? "restriction" : "standing-instruction") as FeaturedHousehold["instructions"][number]["kind"],
        polarity: (forbidden ? "forbidden" : "required") as FeaturedHousehold["instructions"][number]["polarity"],
        scope: "household" as const, subjectRef: "household",
        // Indexed, not drawn: a household may carry two instructions of the same
        // polarity, and one sentence stated twice under two source references
        // reads as a rendering bug rather than as two standing instructions.
        text: (forbidden ? FORBIDDEN_TEXTS : REQUIRED_TEXTS)[n % 2]!,
        sourceRef: `HH-INSTR-${slug(surname).toUpperCase()}-${String(n + 1).padStart(3, "0")} v1`,
        effectiveFrom: daysBefore(seed, path, `instruction-${n}/from`, asOf, 200, 2400),
        effectiveTo: null,
        recordedAt: daysBefore(seed, path, `instruction-${n}/recorded`, asOf, 200, 2400),
      };
    }),
    pendingActions: Array.from({ length: pendingCount }, (_, n) => {
      const createdAt = daysBefore(seed, path, `pending-${n}/created`, asOf, 1, 21);
      return {
        key: `pending-${n}`, accountKey: accounts[intBetween(seed, path, `pending-${n}/account`, 0, accounts.length - 1)]!.key,
        kind: pick(seed, path, `pending-${n}/kind`, ["outgoing-distribution", "incoming-transfer", "outgoing-debit", "incoming-credit"] as const),
        amountMinor: dollars(seed, path, `pending-${n}/amount`, 500, 80_000),
        state: pick(seed, path, `pending-${n}/state`, ["pending", "pending", "settling", "settling", "blocked"] as const),
        createdAt, expectedSettleAt: addDays(createdAt, intBetween(seed, path, `pending-${n}/settle`, 2, 9)),
      };
    }),
    activity: Array.from({ length: activityCount }, (_, n) => {
      const kind = pick(seed, path, `activity-${n}/kind`, roster.activityKinds);
      return {
        key: `activity-${n}`,
        occurredAt: daysBefore(seed, path, `activity-${n}/at`, asOf, 1 + n * 30, 30 + n * 60),
        kind,
        summary: ACTIVITY_SUMMARIES[kind],
        actorLabel: pick(seed, path, `activity-${n}/actor`, roster.advisors).displayName,
      };
    }),
    crossHouseholdLinks: [],
  };
}

const ACTIVITY_SUMMARIES: Record<Roster["activityKinds"][number], string> = {
  "review-meeting": "Scheduled review completed; the plan and the risk posture were both reconfirmed.",
  "document-received": "A signed document was received and filed against the household record.",
  "distribution-settled": "A distribution settled to the household's verified bank instruction.",
  "contribution-received": "A contribution was credited and allocated to the account's model.",
  "beneficiary-updated": "A beneficiary designation was restated and acknowledged by the custodian.",
  "bank-instruction-changed": "A bank instruction was replaced and is awaiting independent verification.",
  "model-rebalanced": "The account was rebalanced back to its target model.",
  "statement-published": "The custodian published the month's statements for this household.",
};
