/**
 * MATERIALIZER (ADR-0057): one household draft -> one `WorldHousehold`.
 *
 * Hand-authored and derived households arrive here in the SAME draft shape, so
 * exactly one implementation mints identifiers, attaches provenance, derives
 * holding lots, and fixes emission order. That is what keeps the ninety
 * consistent with the ten instead of merely adjacent to them.
 *
 * Every record leaves here labeled `source: "fixture"` (charter #3). Confidence
 * is not decoration: a record whose observation is older than the roster's
 * freshness window is `medium`, so the surfaces that recede stale values are
 * reading a real signal rather than a constant.
 */
import type {
  WorldAccount, WorldActivity, WorldBankInstruction, WorldEntity, WorldHolding,
  WorldHousehold, WorldInstruction, WorldParty, WorldPendingAction, WorldPlannedWithdrawal,
} from "../../src/domain/world/household-world";
import type { Confidence, RecordProvenance } from "../../src/contracts/provenance";
import { sortedBy } from "../corpus/_util";
import {
  addDays, dayOf, daysBefore, epochMs, intBetween, maskedAccountNumber,
  splitMinor, text, uuidFor,
} from "./derive";
import type { FeaturedHousehold, Roster } from "./spec";

const MS_PER_DAY = 86_400_000;

export interface MaterializeInput {
  readonly seed: string;
  readonly roster: Roster;
  readonly draft: FeaturedHousehold;
  readonly authoring: "hand-authored" | "derived";
}

/** Provenance for one world record. `fixture` always; the confidence is the
 * honest part - it degrades with the age of the observation behind the record. */
function provenanceAt(asOf: string, observedAt: string, windowDays: number): RecordProvenance {
  const ageDays = Math.trunc((epochMs(asOf) - epochMs(observedAt)) / MS_PER_DAY);
  const confidence: Confidence = ageDays <= windowDays ? "high" : ageDays <= windowDays * 12 ? "medium" : "low";
  return { source: "fixture", asOf: observedAt, confidence };
}

function holdingsFor(
  seed: string, path: string, roster: Roster, modelKey: string, balanceMinor: number, observedAt: string,
): WorldHolding[] {
  const model = roster.modelPortfolios.find((candidate) => candidate.key === modelKey);
  if (!model) throw new Error(`world materialize: ${path} references unknown model "${modelKey}"`);
  const classValues = splitMinor(balanceMinor, model.targets.map((target) => target.weightBps));
  const holdings: WorldHolding[] = [];
  model.targets.forEach((target, index) => {
    const available = roster.instruments.filter((instrument) => instrument.assetClass === target.assetClass);
    if (available.length === 0) throw new Error(`world materialize: no instrument for asset class "${target.assetClass}"`);
    // Cash sits in one sweep vehicle; a risk sleeve holds one or two lots. WHICH
    // instruments it holds is derived the same way the count is: taking a fixed
    // `slice(0, lots)` would give every account on every model the same first
    // tickers, leave every instrument past the second unreachable, and make two
    // accounts on one model differ only by whether a second lot is present.
    // Walking from a derived start keeps the lots distinct and uses the whole
    // roster, which is what makes two accounts look like two accounts.
    const lots = target.assetClass === "cash" ? 1 : Math.min(available.length, intBetween(seed, path, `lots/${target.assetClass}`, 1, 2));
    const start = intBetween(seed, path, `lot-start/${target.assetClass}`, 0, available.length - 1);
    const chosen = Array.from({ length: lots }, (_, lot) => available[(start + lot) % available.length]!);
    const values = splitMinor(classValues[index]!, chosen.map((_, lot) => 1 + lot));
    chosen.forEach((instrument, lot) => {
      const marketValueMinor = values[lot]!;
      const priceMinor = intBetween(seed, `instrument/${instrument.symbol}`, "price", 1_000, 40_000);
      const gainBps = intBetween(seed, path, `${instrument.symbol}/gain`, -1_500, 4_500);
      holdings.push({
        symbol: instrument.symbol,
        description: text(instrument.description),
        assetClass: instrument.assetClass,
        unitsMilli: Math.trunc((marketValueMinor * 1000) / priceMinor),
        marketValueMinor,
        costBasisMinor: Math.trunc((marketValueMinor * 10_000) / (10_000 + gainBps)),
        asOf: observedAt,
        provenance: provenanceAt(observedAt, observedAt, roster.clock.freshLiquidityWindowDays),
      });
    });
  });
  return sortedBy(holdings, (holding) => `${holding.assetClass}/${holding.symbol}`);
}

/** Every party a record may reference: members and entities share one namespace,
 * because a trust owning an account and a person signing it are both parties. */
function partyNames(draft: FeaturedHousehold): Map<string, string> {
  return new Map([
    ...draft.members.map((member) => [member.key, member.displayName] as const),
    ...draft.entities.map((entity) => [entity.key, entity.name] as const),
  ]);
}

function accountsOf(input: MaterializeInput, path: string, evidence: WorldHousehold["evidence"]): WorldAccount[] {
  const { seed, roster, draft } = input;
  const names = partyNames(draft);
  const custodianName = (key: string): string => {
    const custodian = roster.custodians.find((candidate) => candidate.key === key);
    if (!custodian) throw new Error(`world materialize: ${path} references unknown custodian "${key}"`);
    return custodian.displayName;
  };
  const modelName = (key: string): string =>
    roster.modelPortfolios.find((candidate) => candidate.key === key)?.displayName ?? key;
  return draft.accounts.map((account) => {
    const accountPath = `${path}/account/${account.key}`;
    return {
      key: account.key,
      id: uuidFor(seed, accountPath, "id"),
      title: text(account.title),
      registration: account.registration,
      taxClass: account.taxClass,
      custodian: custodianName(account.custodianKey),
      accountNumberMasked: maskedAccountNumber(seed, accountPath, "number"),
      openedOn: account.openedOn,
      balanceMinor: account.balanceMinor,
      balanceObservedAt: evidence.liquidityObservedAt,
      ownerKeys: [...account.ownerKeys],
      modelPortfolio: modelName(account.modelPortfolioKey),
      pendingRebalance: intBetween(seed, accountPath, "pending-rebalance", 0, 4) === 0,
      holdings: holdingsFor(seed, accountPath, roster, account.modelPortfolioKey, account.balanceMinor, evidence.positionsObservedAt),
      beneficiaries: account.beneficiaries.map((beneficiary) => ({
        partyKey: beneficiary.partyKey,
        displayName: text(names.get(beneficiary.partyKey) ?? beneficiary.partyKey),
        tier: beneficiary.tier,
        shareBps: beneficiary.shareBps,
        provenance: provenanceAt(roster.clock.asOf, evidence.instructionsObservedAt, roster.clock.recentChangeWindowDays),
      })),
      signers: account.signers.map((signer) => ({
        partyKey: signer.partyKey,
        displayName: text(names.get(signer.partyKey) ?? signer.partyKey),
        authorityScope: signer.authorityScope,
        effectiveFrom: signer.effectiveFrom,
        effectiveTo: signer.effectiveTo,
        provenance: provenanceAt(roster.clock.asOf, evidence.instructionsObservedAt, roster.clock.recentChangeWindowDays),
      })),
      provenance: provenanceAt(roster.clock.asOf, evidence.liquidityObservedAt, roster.clock.freshLiquidityWindowDays),
    };
  });
}

function evidenceClock(input: MaterializeInput, path: string): WorldHousehold["evidence"] {
  const { seed, roster, draft } = input;
  const asOf = roster.clock.asOf;
  const ages = draft.evidenceAgeDays ?? {
    liquidity: intBetween(seed, path, "evidence/liquidity", 0, 45),
    positions: intBetween(seed, path, "evidence/positions", 0, 12),
    instructions: intBetween(seed, path, "evidence/instructions", 0, 120),
  };
  // An observation lands on a business hour of its own day, never after the
  // world's `asOf`: same-day evidence is capped at noon so a fixture can never
  // claim to have observed the future, which is the tell that ages a demo.
  const observed = (days: number, field: string): string => {
    const day = dayOf(addDays(asOf, -days));
    const hour = days === 0 ? intBetween(seed, path, field, 8, 12) : intBetween(seed, path, field, 9, 20);
    return `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
  };
  return {
    liquidityObservedAt: observed(ages.liquidity, "evidence/liquidity-hour"),
    positionsObservedAt: observed(ages.positions, "evidence/positions-hour"),
    instructionsObservedAt: observed(ages.instructions, "evidence/instructions-hour"),
    retrievedAt: daysBefore(seed, path, "evidence/retrieved", asOf, 0, 1),
  };
}

/** Draft -> the typed world household every surface and the CRM seed read. */
export function materializeHousehold(input: MaterializeInput): WorldHousehold {
  const { seed, roster, draft, authoring } = input;
  const path = `household/${draft.key}`;
  const asOf = roster.clock.asOf;
  const window = roster.clock.recentChangeWindowDays;
  const evidence = evidenceClock(input, path);
  const advisor = roster.advisors.find((candidate) => candidate.key === draft.advisorKey);
  if (!advisor) throw new Error(`world materialize: ${path} references unknown advisor "${draft.advisorKey}"`);
  const householdProvenance = provenanceAt(asOf, evidence.instructionsObservedAt, window);
  const members: WorldParty[] = draft.members.map((member) => ({
    key: member.key,
    id: uuidFor(seed, `${path}/party/${member.key}`, "id"),
    displayName: text(member.displayName),
    kind: member.kind,
    role: member.role,
    relationships: [...member.relationships],
    provenance: householdProvenance,
  }));
  const entities: WorldEntity[] = draft.entities.map((entity) => ({
    key: entity.key,
    id: uuidFor(seed, `${path}/entity/${entity.key}`, "id"),
    kind: entity.kind,
    name: text(entity.name),
    formedOn: entity.formedOn,
    controllerKeys: [...entity.trusteeKeys],
    note: text(entity.note),
    provenance: householdProvenance,
  }));
  const bankInstructions: WorldBankInstruction[] = draft.bankInstructions.map((instruction) => ({
    key: instruction.key,
    id: uuidFor(seed, `${path}/bank/${instruction.key}`, "id"),
    bank: text(instruction.bank),
    lastFour: instruction.lastFour,
    titledTo: text(instruction.titledTo),
    state: instruction.status,
    verifiedAt: instruction.verifiedAt,
    changedAt: instruction.changedAt,
    supersedesKey: instruction.supersedesKey,
    accountKeys: [...instruction.accountKeys],
    observedAt: evidence.instructionsObservedAt,
    provenance: provenanceAt(asOf, instruction.changedAt ?? instruction.verifiedAt ?? evidence.instructionsObservedAt, window),
  }));
  const plannedWithdrawals: WorldPlannedWithdrawal[] = draft.plannedWithdrawals.map((withdrawal) => ({
    key: withdrawal.key,
    id: uuidFor(seed, `${path}/withdrawal/${withdrawal.key}`, "id"),
    accountKey: withdrawal.accountKey,
    purpose: text(withdrawal.purpose),
    fromMonth: withdrawal.fromMonth,
    monthlyMinor: withdrawal.monthlyMinor,
    recordedAt: withdrawal.recordedAt,
    provenance: provenanceAt(asOf, withdrawal.recordedAt, window),
  }));
  const instructions: WorldInstruction[] = draft.instructions.map((instruction) => ({
    key: instruction.key,
    id: uuidFor(seed, `${path}/instruction/${instruction.key}`, "id"),
    kind: instruction.kind,
    polarity: instruction.polarity,
    scope: instruction.scope,
    subjectRef: instruction.subjectRef,
    text: text(instruction.text),
    sourceRef: instruction.sourceRef,
    effectiveFrom: instruction.effectiveFrom,
    effectiveTo: instruction.effectiveTo,
    recordedAt: instruction.recordedAt,
    provenance: provenanceAt(asOf, instruction.recordedAt, window),
  }));
  const pendingActions: WorldPendingAction[] = draft.pendingActions.map((action) => ({
    key: action.key,
    id: uuidFor(seed, `${path}/pending/${action.key}`, "id"),
    accountKey: action.accountKey,
    kind: action.kind,
    amountMinor: action.amountMinor,
    state: action.state,
    createdAt: action.createdAt,
    expectedSettleAt: action.expectedSettleAt,
    provenance: provenanceAt(asOf, action.createdAt, window),
  }));
  const activity: WorldActivity[] = draft.activity.map((entry) => ({
    key: entry.key,
    id: uuidFor(seed, `${path}/activity/${entry.key}`, "id"),
    occurredAt: entry.occurredAt,
    kind: entry.kind,
    summary: text(entry.summary),
    actorLabel: text(entry.actorLabel),
    provenance: provenanceAt(asOf, entry.occurredAt, window),
  }));
  return {
    key: draft.key,
    id: uuidFor(seed, path, "id"),
    displayName: text(draft.displayName),
    surname: text(draft.surname),
    state: draft.status,
    authoring,
    advisorName: text(advisor.displayName),
    advisorCredential: advisor.credential,
    serviceTier: draft.serviceTier,
    city: text(draft.city),
    openedOn: draft.openedOn,
    narrative: text(draft.narrative),
    members: sortedBy(members, (member) => member.key),
    entities: sortedBy(entities, (entity) => entity.key),
    accounts: sortedBy(accountsOf(input, path, evidence), (account) => account.key),
    bankInstructions: sortedBy(bankInstructions, (instruction) => instruction.key),
    plannedWithdrawals: sortedBy(plannedWithdrawals, (withdrawal) => withdrawal.key),
    instructions: sortedBy(instructions, (instruction) => instruction.key),
    pendingActions: sortedBy(pendingActions, (action) => action.key),
    // Activity reads newest-first, which is the only ordering a person wants
    // and is stable because two entries never share an instant AND a key.
    activity: sortedBy(activity, (entry) => `${entry.occurredAt}/${entry.key}`).reverse(),
    crossHouseholdLinks: sortedBy([...draft.crossHouseholdLinks], (link) => `${link.counterpartyHouseholdKey}/${link.kind}`),
    evidence,
    provenance: householdProvenance,
  };
}
