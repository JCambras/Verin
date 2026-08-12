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
 * The CRM is the authority on WHICH households a caller may see AND on what each
 * one is called; the evidence port supplies their depth and nothing else. A
 * world household with no authorized CRM row is simply not in the directory, and
 * a CRM household with no evidence is in it saying so.
 */
import { metric, type DisplayMetric } from "@contracts/metric";
import {
  deriveArtifactProvenance, foldStoredProvenance,
  type DerivedProvenance, type RecordProvenance,
} from "@contracts/provenance";
import type { Household } from "@domain/schema/entities";
import {
  computeHouseholdHealth, healthBand, type HealthBand, type HouseholdHealth,
} from "@domain/world/health";
import type { WorldHousehold } from "@domain/world/household-world";
import type { WorldIdentity } from "@infra/world/fixture-world-source";
import type {
  DirectoryVM, EmptyBookVM, HealthBandVM, HealthVM, HouseholdRowEvidenceVM,
  HouseholdRowVM, NoEvidenceVM,
} from "./model";

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

/** Every stored record a household's summary figures read. One list, so the
 * health derivation and the folded totals below can never read different
 * evidence and publish two origins for the same household. */
function summaryInputs(household: WorldHousehold): RecordProvenance[] {
  return [
    household.provenance,
    ...household.accounts.map((account) => account.provenance),
    ...household.bankInstructions.map((instruction) => instruction.provenance),
    ...household.pendingActions.map((action) => action.provenance),
  ];
}

/** Health is computed from fixture evidence, so it is a demonstration artifact
 * and every one of its figures must say so. */
function healthProvenance(household: WorldHousehold, asOf: string): ReturnType<typeof deriveArtifactProvenance> {
  return deriveArtifactProvenance(summaryInputs(household), asOf);
}

/** A factor's band and the word for it. The cut-offs are the DOMAIN's, imported
 * rather than restated: the panel grades its six factors and the composite above
 * them on one scale, and a copy of the thresholds here would let the two disagree
 * the first time somebody moved one - visibly, since the word is now the whole
 * per-factor signal. */
function bandOf(score: number): { band: HealthBand; bandLabel: string } {
  const band = healthBand(score);
  return { band, bandLabel: BAND_LABELS[band] };
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
      // A factor's contribution reaches the screen as the WIDTH of its bar and
      // as the sentence beside it, never as a bare figure: a demonstration-
      // derived number rendered outside `<Metric>` carries no watermark, and six
      // of them per panel is six numbers a reader could take for measurements.
      // The composite the panel leads with is the one figure, and it renders
      // through `<Metric>` with its provenance (charter #3, ADR-0022).
      barWidth: `${factor.score}%`,
      weightLabel: `${factor.weightBps / 100}% of the score`,
      statement: factor.statement,
      readRecords: factor.readRecords,
      ...bandOf(factor.score),
    })),
  };
}

const count = (value: number, provenance: RecordProvenance | DerivedProvenance): DisplayMetric =>
  metric(value, "count", provenance);

/**
 * What a figure with NO evidence behind it is worth. A derivation over an empty
 * input list has nothing to be less confident than, so it reports `computed`,
 * `high`, `demonstration: false` - the strongest standing the vocabulary has,
 * granted to a count of nothing - and `canFeedComplianceDecision` ADMITS it.
 * That is why the fold below is never handed an empty list: an empty book still
 * has one true origin, which is that this surface reads fixture rows and read
 * none, so its zeroes carry the weakest standing rather than the strongest and
 * refuse compliance use exactly as a counted row would.
 */
const nothingRead = (asOf: string): RecordProvenance => ({ source: "fixture", asOf, confidence: "low" });

/**
 * Every figure summarizing more than one record folds over ALL of them, so its
 * confidence and its as-of are the weakest and the newest of those records
 * rather than one contributor's borrowed - the same rule every folded figure in
 * this repository follows, and the reason a summary can never claim to be surer
 * or cleaner than the evidence behind it. Nothing to fold means nothing was
 * read, which is itself a true origin and the weakest standing there is.
 */
function foldOrNothingRead(inputs: readonly RecordProvenance[], asOf: string): DerivedProvenance {
  return foldStoredProvenance(inputs) ?? deriveArtifactProvenance([nothingRead(asOf)], asOf);
}

/** The origin of "total across all accounts", wherever it is shown. One
 * function, so the directory row and the household's own page cannot label the
 * same sum two different ways. */
export const foldAccountBalances = (household: WorldHousehold, asOf: string): DerivedProvenance =>
  foldOrNothingRead(household.accounts.map((account) => account.provenance), asOf);

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

/** Everything a row gets from the EVIDENCE port, plus what the totals above it
 * read from the same household: all functions of the world alone, so they are
 * built together, cached together, and never re-derived per caller. */
interface WorldRowEntry {
  readonly key: string;
  readonly evidence: HouseholdRowEvidenceVM;
  readonly searchText: string;
  readonly counts: { readonly accounts: number; readonly people: number; readonly openItems: number };
  readonly totalsInput: DerivedProvenance;
}

/** The band a row shows, computed from the same six factors the panel reports.
 * The row takes the WORD and stops there: the composite figure renders once, on
 * the household's own page, through `<Metric>` with its watermark - so shipping
 * the breakdown to a list that cannot render it is a hundred kilobytes nobody
 * reads and thirty fields to display two. */
function buildRowHealth(household: WorldHousehold, asOf: string): HealthBandVM {
  const band = computeHouseholdHealth(household, asOf).band;
  return { band, bandLabel: BAND_LABELS[band] };
}

function buildWorldRowEvidence(household: WorldHousehold, asOf: string): HouseholdRowEvidenceVM {
  const totalBalanceMinor = household.accounts.reduce((sum, account) => sum + account.balanceMinor, 0);
  const openItems = openItemsOf(household);
  return {
    surname: household.surname,
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
    // A SUM over every account folds over every account. Publishing the first
    // account's own provenance would let a total claim a cleanliness it does not
    // have - and claim it beside four cards that fold correctly, which makes the
    // pair actively misleading rather than merely wrong.
    totalBalance: metric(totalBalanceMinor, "currency-minor", foldAccountBalances(household, asOf)),
    health: buildRowHealth(household, asOf),
  };
}

/**
 * A row's world-derived half is built ONCE PER WORLD, not once per request. A
 * hundred-row directory otherwise re-derives a hundred six-factor health
 * breakdowns, a hundred search haystacks, and a fold over every provenance in
 * the book for every caller, and the world is immutable committed bytes
 * identified by its digest - so the digest is the key, and a regenerated world
 * evicts the previous one wholesale. The CRM still decides per request WHICH
 * rows the tenant may see, and the totals fold over exactly those; nothing
 * tenant-scoped is cached here. Held on `globalThis` for the same reason the
 * store singleton is: Next bundles route handlers and server components
 * separately, so a module-local cache would be two caches.
 */
const rowCacheHome = globalThis as unknown as {
  __verinDirectoryRows?: { digest: string; rows: Map<string, WorldRowEntry> };
};

function buildWorldRowEntry(household: WorldHousehold, asOf: string): WorldRowEntry {
  return {
    key: household.key,
    evidence: buildWorldRowEvidence(household, asOf),
    searchText: [
      household.displayName, household.surname, household.city, household.advisorName,
      household.serviceTier, household.state,
      ...household.members.map((member) => member.displayName),
      ...household.entities.map((entity) => entity.name),
      ...household.accounts.map((account) => `${account.title} ${account.custodian}`),
    ].join(" ").toLowerCase(),
    counts: {
      accounts: household.accounts.length,
      people: household.members.length,
      openItems: openItemsOf(household),
    },
    // A household always publishes its own provenance, so this fold is never
    // handed an empty list and never reaches the nothing-read origin.
    totalsInput: foldOrNothingRead(summaryInputs(household), asOf),
  };
}

function worldRowEntry(household: WorldHousehold, asOf: string, digest: string | null): WorldRowEntry {
  // No identity means no world to key on (and `asOf` is then the wall clock),
  // so there is nothing stable to cache: build it and move on.
  if (digest === null) return buildWorldRowEntry(household, asOf);
  const home = rowCacheHome.__verinDirectoryRows?.digest === digest
    ? rowCacheHome.__verinDirectoryRows
    : (rowCacheHome.__verinDirectoryRows = { digest, rows: new Map<string, WorldRowEntry>() });
  const cached = home.rows.get(household.id);
  if (cached) return cached;
  const built = buildWorldRowEntry(household, asOf);
  home.rows.set(household.id, built);
  return built;
}

export interface DirectoryInput {
  readonly crmHouseholds: readonly Household[];
  readonly worldHouseholds: readonly WorldHousehold[];
  readonly identity: WorldIdentity | null;
}

/** Where a household with no evidence yet sends its reader. The house CRM is
 * where that record actually lives and where a person can act on it, so the
 * empty state is an on-ramp rather than a shrug. */
const NO_EVIDENCE: NoEvidenceVM = {
  badgeLabel: "No evidence on file",
  note: "Nothing has arrived for this household yet - only the firm's own record of it.",
  actionLabel: "Open it in the house-CRM console",
  actionHref: "/app/console",
};

/** A book with nothing in it is not a search that found nothing. This directory
 * lists what the firm's record store holds, so an empty one says exactly that
 * and points at the place a household is created - the same on-ramp the
 * no-evidence row carries, because an empty state a reader can do nothing about
 * is a dead end. */
const EMPTY_BOOK: EmptyBookVM = {
  title: "No households in this firm's book yet",
  description: "This directory lists the households the firm's record store holds, and it holds none yet. Create the first one in the house-CRM console and it appears here.",
  actionLabel: "Open the house-CRM console",
  actionHref: "/app/console",
};

function toRow(crmRow: Household, entry: WorldRowEntry | null): HouseholdRowVM {
  // IDENTITY IS THE RECORD STORE'S. The house CRM owns the household's name and
  // status and edits them through a governed audited write, so rendering the
  // fixture's name here would leave a rename showing on one shipped surface and
  // not on the other, indefinitely and with nothing to say it had happened.
  const identity = {
    id: crmRow.id,
    displayName: crmRow.name,
    state: crmRow.status,
    stateLabel: STATE_LABELS[crmRow.status] ?? titleize(crmRow.status),
    provenance: crmRow.provenance,
  };
  const named = crmRow.name.toLowerCase();
  return entry === null
    ? { ...identity, key: crmRow.id, href: null, evidence: null, noEvidence: NO_EVIDENCE, searchText: named }
    : {
      ...identity,
      key: entry.key,
      href: `/app/households/${entry.key}`,
      evidence: entry.evidence,
      noEvidence: null,
      searchText: `${entry.searchText} ${named}`,
    };
}

/**
 * The directory: every household this tenant is AUTHORIZED to see, which is the
 * CRM's list and only the CRM's. A household somebody created in the console a
 * minute ago has a record and no evidence yet; dropping it from the firm's book
 * because the evidence port cannot describe it makes the surface the app home
 * page calls "the firm's whole book" quietly incomplete, and
 * households-with-evidence is a distinction nobody asked for and nobody can see.
 * It appears, and says plainly that nothing has arrived for it yet.
 *
 * A world household with no authorized CRM row was never authorized, so it is
 * still not listed - and the totals still fold over exactly the rows shown.
 */
export function buildDirectoryVM(input: DirectoryInput): DirectoryVM {
  const asOf = input.identity?.asOf ?? new Date().toISOString();
  const digest = input.identity?.digest ?? null;
  const worldById = new Map(input.worldHouseholds.map((household) => [household.id, household]));
  const authorized = input.crmHouseholds.map((crmRow) => {
    const household = worldById.get(crmRow.id);
    return { crmRow, entry: household ? worldRowEntry(household, asOf, digest) : null };
  });
  const rows = authorized
    .map(({ crmRow, entry }) => toRow(crmRow, entry))
    .sort((left, right) => (left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0));
  // The tenant-scoped half of the fold, and the only half done per request: each
  // household's own origin was folded once for the world, and the book the
  // caller may see decides which of them the cards stand on. A household with no
  // evidence still contributes the record the household count stands on - its
  // own CRM row - so no card is ever folded over fewer records than it counts.
  const listProvenance = foldOrNothingRead(
    authorized.map(({ crmRow, entry }) => entry?.totalsInput ?? crmRow.provenance),
    asOf,
  );
  const described = authorized.filter(({ entry }) => entry !== null);
  const totals = described.reduce(
    (acc, { entry }) => ({
      accounts: acc.accounts + entry!.counts.accounts,
      people: acc.people + entry!.counts.people,
      openItems: acc.openItems + entry!.counts.openItems,
    }),
    { accounts: 0, people: 0, openItems: 0 },
  );
  const undescribed = authorized.length - described.length;
  return {
    rows,
    totalHouseholds: count(rows.length, listProvenance),
    totalAccounts: count(totals.accounts, listProvenance),
    totalPeople: count(totals.people, listProvenance),
    totalOpenItems: count(totals.openItems, listProvenance),
    // Whether the BOOK is empty, which a search that matches nothing is not.
    emptyBook: rows.length === 0 ? EMPTY_BOOK : null,
    // Every household is listed, so a figure that reads only some of them says
    // so rather than letting a reader take it for the whole book. The
    // none-described case is the one production reaches, where the fixture
    // adapter refuses to serve at all: three cards of zeroes with no explanation
    // is the silently-empty surface this world exists to end.
    evidenceCoverageNote: undescribed === 0
      ? null
      : described.length === 0
        ? "No evidence is on file for any household in this book yet, so the people, account, and open-item counts are zero."
        : `${plural(undescribed, "household has", "households have")} no evidence on file yet, so the people, account, and open-item counts read the ${described.length} that do.`,
    worldVersion: input.identity?.version ?? null,
    worldDigest: input.identity?.digest ?? null,
    provenanceNote: input.identity?.provenanceNote
      ?? "No demonstration world is loaded in this environment.",
  };
}
