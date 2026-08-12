/**
 * HOUSEHOLD DETAIL VIEW MODEL (ADR-0057).
 *
 * Turns one world household into the dense surface a person reads: people and
 * how they are related, entities and who controls them, accounts with their
 * holdings and registration, beneficiaries and signers, bank instructions with
 * their supersession chain, planned withdrawals, restrictions and standing
 * instructions, pending actions, and recent activity.
 *
 * Every statement a reader acts on is composed here, so the component renders
 * text and never decides it. Numbers are `DisplayMetric`s; the health block is
 * the one derived artifact and carries its watermark.
 */
import { metric } from "@contracts/metric";
import type { RecordProvenance } from "@contracts/provenance";
import {
  BENEFICIARY_CAPABLE_REGISTRATIONS, BENEFICIARY_SCORED_REGISTRATIONS,
  type WorldAccount, type WorldBankInstruction, type WorldHousehold,
} from "@domain/world/household-world";
import { REGISTRATION_LABELS, STATE_LABELS, buildHealthVM, formatDay, groupDigits, titleize } from "./build";
import type {
  AccountVM, ActivityVM, BankInstructionVM, CrossHouseholdLinkVM, EntityVM,
  HouseholdDetailVM, InstructionVM, PendingActionVM, PersonVM, PlannedWithdrawalVM,
} from "./model";

const RELATIONSHIP_PHRASES: Record<string, string> = {
  spouse: "spouse of", parent: "parent of", child: "child of",
  "step-parent": "step-parent of", "step-child": "step-child of", sibling: "sibling of",
  "trustee-of": "trustee of", "grantor-of": "grantor of",
};
const ROLE_LABELS: Record<string, string> = {
  client: "Client", spouse: "Spouse", beneficiary: "Beneficiary",
  signer: "Authorized signer", trustee: "Trustee", grantor: "Grantor",
};
const ENTITY_KIND_LABELS: Record<string, string> = {
  "revocable-trust": "Revocable trust", "irrevocable-trust": "Irrevocable trust",
  llc: "Limited liability company", "limited-partnership": "Limited partnership",
};
const TAX_CLASS_LABELS: Record<string, string> = {
  taxable: "Taxable", retirement: "Tax-deferred", trust: "Trust", entity: "Entity", education: "Education",
};
const LINK_KIND_LABELS: Record<string, string> = {
  "trust-owned-account-serving-another-household": "Trust account serving another household",
  "receives-distribution-from-external-trust": "Receives income from an external trust",
  "shared-authorized-signer": "Shares an authorized signer",
};

const nameOf = (household: WorldHousehold, key: string): string =>
  household.members.find((member) => member.key === key)?.displayName
  ?? household.entities.find((entity) => entity.key === key)?.name
  ?? key;

const accountTitle = (household: WorldHousehold, key: string): string =>
  household.accounts.find((account) => account.key === key)?.title ?? key;

/** A reader looks for the client first, then the spouse, then everyone else -
 * never alphabetically, which is how the fixture stores them for byte stability. */
const ROLE_ORDER: Record<string, number> = {
  client: 0, spouse: 1, trustee: 2, grantor: 3, signer: 4, beneficiary: 5,
};

function peopleOf(household: WorldHousehold): PersonVM[] {
  return [...household.members]
    .sort((left, right) =>
      (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9)
      || (left.displayName < right.displayName ? -1 : left.displayName > right.displayName ? 1 : 0))
    .map((member) => ({
    key: member.key,
    displayName: member.displayName,
    roleLabel: ROLE_LABELS[member.role] ?? titleize(member.role),
    kindLabel: titleize(member.kind),
    relationshipLabels: member.relationships.map(
      (relationship) => `${RELATIONSHIP_PHRASES[relationship.kind] ?? relationship.kind} ${nameOf(household, relationship.toKey)}`,
    ),
    provenance: member.provenance,
  }));
}

function entitiesOf(household: WorldHousehold): EntityVM[] {
  return household.entities.map((entity) => ({
    key: entity.key,
    name: entity.name,
    kindLabel: ENTITY_KIND_LABELS[entity.kind] ?? titleize(entity.kind),
    formedOn: formatDay(entity.formedOn),
    controllerNames: entity.controllerKeys.map((key) => nameOf(household, key)),
    note: entity.note,
    provenance: entity.provenance,
  }));
}

/**
 * The DEFICIENCY, and only a deficiency: read from
 * `BENEFICIARY_SCORED_REGISTRATIONS`, the same set the health factor scores, so
 * the note and the score beside it cannot disagree. On an account a designation
 * does not govern - a joint account passing by survivorship, an individual
 * account passing through the estate, a trust or an LLC passing by its own
 * documents - there is no shortfall to report, and inventing one is the failure
 * this gate exists to catch.
 */
function beneficiaryNote(account: WorldAccount): string | null {
  if (!BENEFICIARY_SCORED_REGISTRATIONS.has(account.registration)) return null;
  const primaryBps = account.beneficiaries
    .filter((beneficiary) => beneficiary.tier === "primary")
    .reduce((sum, beneficiary) => sum + beneficiary.shareBps, 0);
  if (account.beneficiaries.length === 0) return "No beneficiary is designated on this account.";
  if (primaryBps === 10_000) return null;
  return `Primary designations total ${primaryBps / 100}%, not 100% - this account needs a restatement.`;
}

/**
 * What an EMPTY beneficiary panel says, read from
 * `BENEFICIARY_CAPABLE_REGISTRATIONS` - a different question, so a different
 * set. Whether an account CAN carry a designation is a fact about its titling;
 * whether the absence of one is a deficiency is the health question above, and
 * neither set may answer the other's. An individual or joint account takes a
 * transfer-on-death designation as routinely as an IRA takes a beneficiary form,
 * so telling a reader it cannot is the same false statement as calling the
 * absence a gap, in the opposite direction.
 */
function beneficiaryEmptyLabel(account: WorldAccount): string {
  return BENEFICIARY_CAPABLE_REGISTRATIONS.has(account.registration)
    ? "None designated."
    : "This registration does not take a beneficiary designation.";
}

function accountsOf(household: WorldHousehold, asOf: string): AccountVM[] {
  const asOfMs = Date.parse(asOf);
  return household.accounts.map((account) => ({
    key: account.key,
    title: account.title,
    registrationLabel: REGISTRATION_LABELS[account.registration] ?? titleize(account.registration),
    taxClassLabel: TAX_CLASS_LABELS[account.taxClass] ?? titleize(account.taxClass),
    custodian: account.custodian,
    accountNumberMasked: account.accountNumberMasked,
    openedOn: formatDay(account.openedOn),
    balance: metric(account.balanceMinor, "currency-minor", account.provenance),
    ownerNames: account.ownerKeys.map((key) => nameOf(household, key)),
    modelPortfolio: account.modelPortfolio,
    rebalanceLabel: account.pendingRebalance ? "Drifted from its model; a rebalance is queued" : null,
    holdings: account.holdings.map((holding) => {
      const gainMinor = holding.marketValueMinor - holding.costBasisMinor;
      return {
        symbol: holding.symbol,
        description: holding.description,
        assetClassLabel: titleize(holding.assetClass),
        units: (holding.unitsMilli / 1000).toFixed(3),
        marketValue: metric(holding.marketValueMinor, "currency-minor", holding.provenance),
        // Composed rather than a second metric: it is arithmetic on two figures
        // whose provenance the market value beside it already states, and a
        // second "· Sample data · as of …" per lot made the block unreadable.
        unrealizedLabel: `${gainMinor >= 0 ? "+" : "-"}$${groupDigits(Math.trunc(gainMinor / 100))} unrealized ${gainMinor >= 0 ? "gain" : "loss"}`,
        provenance: holding.provenance,
      };
    }),
    beneficiaries: account.beneficiaries.map((beneficiary) => ({
      displayName: beneficiary.displayName,
      tierLabel: titleize(beneficiary.tier),
      share: metric(beneficiary.shareBps / 100, "percent", beneficiary.provenance),
      provenance: beneficiary.provenance,
    })),
    beneficiaryNote: beneficiaryNote(account),
    beneficiaryEmptyLabel: beneficiaryEmptyLabel(account),
    signers: account.signers.map((signer) => {
      const lapsed = signer.effectiveTo !== null && Date.parse(signer.effectiveTo) <= asOfMs;
      return {
        displayName: signer.displayName,
        authorityLabel: titleize(signer.authorityScope),
        effectiveLabel: signer.effectiveTo === null
          ? `Effective from ${formatDay(signer.effectiveFrom)}`
          : `${formatDay(signer.effectiveFrom)} to ${formatDay(signer.effectiveTo)}`,
        lapsed,
        provenance: signer.provenance,
      };
    }),
    provenance: account.provenance,
  }));
}

function bankInstructionStatement(instruction: WorldBankInstruction): string {
  if (instruction.state === "superseded") return `Replaced; last verified ${instruction.verifiedAt ? formatDay(instruction.verifiedAt) : "never"}.`;
  if (instruction.verifiedAt === null && instruction.changedAt !== null) {
    return `Changed ${formatDay(instruction.changedAt)} and not yet independently verified.`;
  }
  if (instruction.verifiedAt === null) return "Never independently verified.";
  return `Independently verified ${formatDay(instruction.verifiedAt)}.`;
}

function bankInstructionsOf(household: WorldHousehold): BankInstructionVM[] {
  const byKey = new Map(household.bankInstructions.map((instruction) => [instruction.key, instruction]));
  return household.bankInstructions.map((instruction) => ({
    key: instruction.key,
    label: `${instruction.bank} ····${instruction.lastFour}`,
    titledTo: instruction.titledTo,
    state: instruction.state,
    stateLabel: instruction.state === "current" ? "Current" : "Superseded",
    statusStatement: bankInstructionStatement(instruction),
    supersedesLabel: instruction.supersedesKey
      ? `Replaces ${byKey.get(instruction.supersedesKey)?.bank ?? ""} ····${byKey.get(instruction.supersedesKey)?.lastFour ?? instruction.supersedesKey}`
      : null,
    accountTitles: instruction.accountKeys.map((key) => accountTitle(household, key)),
    provenance: instruction.provenance,
  }));
}

function instructionsOf(household: WorldHousehold): InstructionVM[] {
  return household.instructions.map((instruction) => ({
    key: instruction.key,
    kindLabel: instruction.kind === "restriction" ? "Restriction" : "Standing instruction",
    polarity: instruction.polarity,
    polarityLabel: instruction.polarity === "forbidden" ? "Forbids" : "Requires",
    scopeLabel: instruction.scope === "household"
      ? "Whole household"
      : `${titleize(instruction.scope)}: ${instruction.scope === "account" ? accountTitle(household, instruction.subjectRef) : nameOf(household, instruction.subjectRef)}`,
    text: instruction.text,
    sourceRef: instruction.sourceRef,
    effectiveLabel: instruction.effectiveTo === null
      ? `In force since ${formatDay(instruction.effectiveFrom)}`
      : `${formatDay(instruction.effectiveFrom)} to ${formatDay(instruction.effectiveTo)}`,
    provenance: instruction.provenance,
  }));
}

function pendingOf(household: WorldHousehold): PendingActionVM[] {
  return household.pendingActions.map((action) => ({
    key: action.key,
    kindLabel: titleize(action.kind),
    accountTitle: accountTitle(household, action.accountKey),
    amount: metric(action.amountMinor, "currency-minor", action.provenance),
    state: action.state,
    stateLabel: titleize(action.state),
    expectedLabel: action.state === "blocked" || action.state === "rejected"
      ? `Was expected to settle ${formatDay(action.expectedSettleAt)}; it did not`
      : `Expected to settle ${formatDay(action.expectedSettleAt)}`,
    provenance: action.provenance,
  }));
}

function withdrawalsOf(household: WorldHousehold): PlannedWithdrawalVM[] {
  return household.plannedWithdrawals.map((withdrawal) => ({
    key: withdrawal.key,
    purpose: withdrawal.purpose,
    accountTitle: accountTitle(household, withdrawal.accountKey),
    monthly: metric(withdrawal.monthlyMinor, "currency-minor", withdrawal.provenance),
    fromLabel: `From ${withdrawal.fromMonth}`,
    provenance: withdrawal.provenance,
  }));
}

function activityOf(household: WorldHousehold): ActivityVM[] {
  return household.activity.map((entry) => ({
    key: entry.key,
    kindLabel: titleize(entry.kind),
    summary: entry.summary,
    actorLabel: entry.actorLabel,
    occurredLabel: formatDay(entry.occurredAt),
    provenance: entry.provenance,
  }));
}

function linksOf(
  household: WorldHousehold,
  counterpartyNames: ReadonlyMap<string, string>,
): CrossHouseholdLinkVM[] {
  return household.crossHouseholdLinks.map((link) => ({
    kindLabel: LINK_KIND_LABELS[link.kind] ?? titleize(link.kind),
    counterpartyKey: link.counterpartyHouseholdKey,
    counterpartyName: counterpartyNames.get(link.counterpartyHouseholdKey) ?? link.counterpartyHouseholdKey,
    note: link.note,
  }));
}

/**
 * The three lines under "Evidence behind this page" carry the provenance the
 * MATERIALIZER computed for each class, never one composed here: a view model
 * that mints its own confidence beside an instant the world has already measured
 * states two answers to one question on the same screen, and the fabricated one
 * always reads `high`.
 */
function evidenceLinesOf(household: WorldHousehold): { label: string; provenance: RecordProvenance }[] {
  return [
    { label: "Cash and balances", provenance: household.evidence.liquidity },
    { label: "Positions", provenance: household.evidence.positions },
    { label: "Instructions and authorities", provenance: household.evidence.instructions },
  ];
}

export function buildHouseholdDetailVM(
  household: WorldHousehold,
  crmId: string,
  asOf: string,
  counterpartyNames: ReadonlyMap<string, string> = new Map(),
): HouseholdDetailVM {
  return {
    key: household.key,
    id: crmId,
    displayName: household.displayName,
    state: household.state,
    stateLabel: STATE_LABELS[household.state] ?? titleize(household.state),
    advisorLabel: `${household.advisorName}, ${household.advisorCredential}`,
    serviceTierLabel: `${titleize(household.serviceTier)} service`,
    city: household.city,
    openedOn: `Client since ${formatDay(household.openedOn)}`,
    narrative: household.narrative,
    authoringLabel: household.authoring === "hand-authored" ? "Hand-authored sample" : "Generated sample",
    totalBalance: metric(
      household.accounts.reduce((sum, account) => sum + account.balanceMinor, 0),
      "currency-minor",
      household.accounts[0]?.provenance ?? household.provenance,
    ),
    health: buildHealthVM(household, asOf),
    people: peopleOf(household),
    entities: entitiesOf(household),
    accounts: accountsOf(household, asOf),
    bankInstructions: bankInstructionsOf(household),
    plannedWithdrawals: withdrawalsOf(household),
    instructions: instructionsOf(household),
    pendingActions: pendingOf(household),
    activity: activityOf(household),
    crossHouseholdLinks: linksOf(household, counterpartyNames),
    evidenceLines: evidenceLinesOf(household),
    provenance: household.provenance,
  };
}
