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

/** What the directory calls an "open item": one definition, so the row's own
 * count and the totals above it can never disagree. */
const openItemsOf = (household: WorldHousehold): number =>
  household.bankInstructions.filter((i) => i.state === "current" && i.verifiedAt === null).length
  + household.pendingActions.filter((a) => a.state === "blocked" || a.state === "rejected").length;

/** Everything on a directory row that the WORLD decides. The only field left is
 * the CRM record id, which is the tenant's own and is attached per request. */
type WorldRowVM = Omit<HouseholdRowVM, "id">;

function buildWorldRow(household: WorldHousehold, asOf: string): WorldRowVM {
  const totalBalanceMinor = household.accounts.reduce((sum, account) => sum + account.balanceMinor, 0);
  const openItems = openItemsOf(household);
  return {
    key: household.key,
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

/**
 * A row's world-derived half is built ONCE PER WORLD, not once per request. A
 * hundred-row directory otherwise re-derives a hundred six-factor health
 * breakdowns and a hundred search haystacks for every caller, and the world is
 * immutable committed bytes identified by its digest - so the digest is the key,
 * and a regenerated world evicts the previous one wholesale. The CRM still
 * decides per request WHICH rows the tenant may see; nothing tenant-scoped is
 * cached here. Held on `globalThis` for the same reason the store singleton is:
 * Next bundles route handlers and server components separately, so a
 * module-local cache would be two caches.
 */
const rowCacheHome = globalThis as unknown as {
  __verinDirectoryRows?: { digest: string; rows: Map<string, WorldRowVM> };
};

function worldRow(household: WorldHousehold, asOf: string, digest: string | null): WorldRowVM {
  // No identity means no world to key on (and `asOf` is then the wall clock),
  // so there is nothing stable to cache: build it and move on.
  if (digest === null) return buildWorldRow(household, asOf);
  const home = rowCacheHome.__verinDirectoryRows?.digest === digest
    ? rowCacheHome.__verinDirectoryRows
    : (rowCacheHome.__verinDirectoryRows = { digest, rows: new Map<string, WorldRowVM>() });
  const cached = home.rows.get(household.id);
  if (cached) return cached;
  const built = buildWorldRow(household, asOf);
  home.rows.set(household.id, built);
  return built;
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
  const digest = input.identity?.digest ?? null;
  const worldById = new Map(input.worldHouseholds.map((household) => [household.id, household]));
  // The intersection is computed ONCE and everything on the page reads from it:
  // totals summarizing households the tenant may not list would be a disclosure
  // dressed as a summary card.
  const authorized = input.crmHouseholds
    .map((crmRow) => {
      const household = worldById.get(crmRow.id);
      return household ? { crmRow, household } : null;
    })
    .filter((pair): pair is { crmRow: Household; household: WorldHousehold } => pair !== null);
  const rows = authorized
    .map(({ crmRow, household }) => ({ ...worldRow(household, asOf, digest), id: crmRow.id }))
    .sort((left, right) => (left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0));
  const listProvenance: RecordProvenance = { source: "fixture", asOf, confidence: "high" };
  const totals = authorized.reduce(
    (acc, { household }) => ({
      accounts: acc.accounts + household.accounts.length,
      people: acc.people + household.members.length,
      openItems: acc.openItems + openItemsOf(household),
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
