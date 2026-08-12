/**
 * HOUSEHOLD VIEW-MODEL BUILDERS (ADR-0057) - the directory and the shared
 * vocabulary the detail builder also uses.
 *
 * Everything a component would otherwise have to decide is decided here: labels
 * from vocabularies, dates from one formatter, and every displayed number as a
 * `DisplayMetric` carrying its provenance. Health is DERIVED from fixture
 * inputs, so it is published through `deriveArtifactProvenance` and renders
 * watermarked (charter #3, ADR-0022).
 *
 * The CRM is the authority on WHICH households a caller may see; the evidence
 * port supplies their depth. A world household with no authorized CRM row is
 * simply not in the directory.
 */
import { metric, type DisplayMetric } from "@contracts/metric";
import { deriveArtifactProvenance, type RecordProvenance } from "@contracts/provenance";
import type { Household } from "@domain/schema/entities";
import { computeHouseholdHealth, type HealthBand, type HouseholdHealth } from "@domain/world/health";
import type { WorldHousehold } from "@domain/world/household-world";
import type { WorldIdentity } from "@infra/world/fixture-world-source";
import type { DirectoryVM, HealthVM, HouseholdRowVM } from "./model";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `2026-07-24T14:12:00.000Z` -> `24 Jul 2026`. Written out rather than taken
 * from `Intl` because the output must be identical on a developer's machine, in
 * CI, and in a screenshot - a locale-dependent date is a diff nobody asked for.
 */
export function formatDay(iso: string): string {
  const [datePart = ""] = iso.split("T");
  const [year, month, day] = datePart.split("-");
  const monthIndex = Number(month) - 1;
  if (!year || !day || !MONTHS[monthIndex]) return iso;
  return `${Number(day)} ${MONTHS[monthIndex]} ${year}`;
}

/** `ira-roth` -> `Ira roth` is wrong, so the vocabularies carry real labels and
 * this only handles the ones that are genuinely just words. */
export const titleize = (slug: string): string =>
  slug.replace(/-/g, " ").replace(/^./, (first) => first.toUpperCase());

export const REGISTRATION_LABELS: Record<string, string> = {
  individual: "Individual", "joint-wros": "Joint WROS", "ira-traditional": "Traditional IRA",
  "ira-roth": "Roth IRA", "rollover-ira": "Rollover IRA", "sep-ira": "SEP IRA",
  "education-529": "529 education savings", "revocable-trust": "Revocable trust",
  "irrevocable-trust": "Irrevocable trust", "llc-entity": "LLC", partnership: "Partnership",
};
export const STATE_LABELS: Record<string, string> = {
  active: "Active", prospect: "Prospect", inactive: "Inactive",
};
export const BAND_LABELS: Record<HealthBand, string> = {
  healthy: "Healthy", watch: "Watch", "needs-attention": "Needs attention",
};

/** Health is computed from fixture evidence, so it is a demonstration artifact
 * and every one of its figures must say so. */
function healthProvenance(household: WorldHousehold, asOf: string): ReturnType<typeof deriveArtifactProvenance> {
  const inputs: RecordProvenance[] = [
    household.provenance,
    ...household.accounts.map((account) => account.provenance),
    ...household.bankInstructions.map((instruction) => instruction.provenance),
    ...household.pendingActions.map((action) => action.provenance),
  ];
  return deriveArtifactProvenance(inputs, asOf);
}

export function buildHealthVM(household: WorldHousehold, asOf: string): HealthVM {
  const health: HouseholdHealth = computeHouseholdHealth(household, asOf);
  const provenance = healthProvenance(household, asOf);
  const weakest = health.factors.reduce((worst, factor) => (factor.score < worst.score ? factor : worst), health.factors[0]!);
  return {
    score: metric(health.score, "score", provenance),
    band: health.band,
    bandLabel: BAND_LABELS[health.band],
    summary: health.band === "healthy"
      ? `Nothing in this household is asking for a decision today. The weakest factor is ${weakest.label.toLowerCase()}: ${weakest.statement}`
      : `${weakest.label} is what pulls this score down. ${weakest.statement}`,
    factors: health.factors.map((factor) => ({
      id: factor.id,
      label: factor.label,
      score: metric(factor.score, "score", provenance),
      weightLabel: `${factor.weightBps / 100}% of the score`,
      statement: factor.statement,
      readRecords: factor.readRecords,
      band: factor.score >= 80 ? "healthy" : factor.score >= 55 ? "watch" : "needs-attention",
    })),
  };
}

const count = (value: number, provenance: RecordProvenance): DisplayMetric =>
  metric(value, "count", provenance);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Thousands separators without `Intl`, for the same reason `formatDay` exists:
 * the string has to be identical on every machine and in every screenshot. */
export const groupDigits = (whole: number): string =>
  String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function buildRow(crmRow: Household, household: WorldHousehold, asOf: string): HouseholdRowVM {
  const totalBalanceMinor = household.accounts.reduce((sum, account) => sum + account.balanceMinor, 0);
  const openItems = household.bankInstructions.filter((i) => i.state === "current" && i.verifiedAt === null).length
    + household.pendingActions.filter((a) => a.state === "blocked" || a.state === "rejected").length;
  return {
    key: household.key,
    id: crmRow.id,
    displayName: household.displayName,
    surname: household.surname,
    state: household.state,
    stateLabel: STATE_LABELS[household.state] ?? titleize(household.state),
    advisorName: `${household.advisorName}, ${household.advisorCredential}`,
    serviceTier: titleize(household.serviceTier),
    city: household.city,
    authoringLabel: household.authoring === "hand-authored" ? "Hand-authored sample" : "Generated sample",
    countsLabel: [
      plural(household.accounts.length, "account", "accounts"),
      plural(household.members.length, "person", "people"),
      plural(openItems, "open item", "open items"),
    ].join(" · "),
    openItemCount: openItems,
    totalBalance: metric(totalBalanceMinor, "currency-minor", household.accounts[0]?.provenance ?? household.provenance),
    health: buildHealthVM(household, asOf),
    searchText: [
      household.displayName, household.surname, household.city, household.advisorName,
      household.serviceTier, household.state,
      ...household.members.map((member) => member.displayName),
      ...household.entities.map((entity) => entity.name),
      ...household.accounts.map((account) => `${account.title} ${account.custodian}`),
    ].join(" ").toLowerCase(),
    provenance: household.provenance,
  };
}

export interface DirectoryInput {
  readonly crmHouseholds: readonly Household[];
  readonly worldHouseholds: readonly WorldHousehold[];
  readonly identity: WorldIdentity | null;
}

/**
 * The directory. Rows are the INTERSECTION of what the tenant is authorized to
 * see (the CRM) and what the evidence port can describe: a CRM household with
 * no world entry would render as an empty shell, and a world household with no
 * CRM row was never authorized, so neither is listed.
 */
export function buildDirectoryVM(input: DirectoryInput): DirectoryVM {
  const asOf = input.identity?.asOf ?? new Date().toISOString();
  const worldById = new Map(input.worldHouseholds.map((household) => [household.id, household]));
  const rows = input.crmHouseholds
    .map((crmRow) => {
      const household = worldById.get(crmRow.id);
      return household ? buildRow(crmRow, household, asOf) : null;
    })
    .filter((row): row is HouseholdRowVM => row !== null)
    .sort((left, right) => (left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0));
  const listProvenance: RecordProvenance = { source: "fixture", asOf, confidence: "high" };
  const totals = input.worldHouseholds.reduce(
    (acc, household) => ({
      accounts: acc.accounts + household.accounts.length,
      people: acc.people + household.members.length,
      openItems: acc.openItems + household.bankInstructions.filter((i) => i.state === "current" && i.verifiedAt === null).length
        + household.pendingActions.filter((a) => a.state === "blocked" || a.state === "rejected").length,
    }),
    { accounts: 0, people: 0, openItems: 0 },
  );
  return {
    rows,
    totalHouseholds: count(rows.length, listProvenance),
    totalAccounts: count(totals.accounts, listProvenance),
    totalPeople: count(totals.people, listProvenance),
    totalOpenItems: count(totals.openItems, listProvenance),
    worldVersion: input.identity?.version ?? null,
    worldDigest: input.identity?.digest ?? null,
    provenanceNote: input.identity?.provenanceNote
      ?? "No demonstration world is loaded in this environment.",
  };
}
