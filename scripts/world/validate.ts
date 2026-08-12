/**
 * WORLD VALIDATION (ADR-0057) - the core `pnpm world:validate` and the
 * `world-determinism` / `world-provenance` fences both run.
 *
 * It regenerates the world from the hand-owned spec and BYTE-COMPARES it
 * against the committed tree (a hand edit therefore fails CI), then re-checks
 * the rules the bytes alone cannot state: every record labeled `fixture`, no
 * pre-computed health score anywhere, no observation in the future, the
 * deliberate surname collisions present, cross-household links resolving both
 * ways, and every generated file accounted for in the manifest.
 */
import { readTree } from "../corpus/tree";
import { parseStrictJson } from "../corpus/strict-json";
import { sha256 } from "../corpus/_util";
import { generateWorld, type GeneratedWorld } from "./generate";
import { epochMs } from "./derive";
import { loadWorldSpec, HOUSEHOLDS_DIR, WORLD_DIR, WORLD_SEED, type LoadedWorldSpec } from "./spec";
import type { WorldHousehold } from "../../src/domain/world/household-world";

export interface WorldValidation {
  readonly spec: LoadedWorldSpec;
  readonly world: GeneratedWorld;
  readonly worldDigest: string;
  readonly problems: readonly string[];
}

/** Fields that must never appear in a generated household: a stored health
 * score would make the product's computed figure a decoration of a literal. */
const FORBIDDEN_FIELDS = ["healthScore", "health", "score", "signedBy", "signedAt", "signedDigest"];

function forbiddenFieldProblems(household: WorldHousehold): string[] {
  const problems: string[] = [];
  const pending: Array<{ value: unknown; path: string }> = [{ value: household, path: household.key }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (Array.isArray(current.value)) {
      current.value.forEach((value, index) => pending.push({ value, path: `${current.path}[${index}]` }));
    } else if (current.value !== null && typeof current.value === "object") {
      for (const [key, value] of Object.entries(current.value)) {
        if (FORBIDDEN_FIELDS.includes(key)) {
          problems.push(`${current.path}.${key}: a generated household may not carry a "${key}" field`);
        }
        pending.push({ value, path: `${current.path}.${key}` });
      }
    }
  }
  return problems;
}

function provenanceProblems(household: WorldHousehold, asOf: string): string[] {
  const problems: string[] = [];
  const asOfMs = epochMs(asOf);
  const check = (provenance: { source: string; asOf: string } | undefined, where: string): void => {
    if (!provenance) {
      problems.push(`${where}: record carries no provenance (charter #3)`);
      return;
    }
    if (provenance.source !== "fixture") {
      problems.push(`${where}: provenance source "${provenance.source}" - every world record is fixture-sourced`);
    }
    if (epochMs(provenance.asOf) > asOfMs) {
      problems.push(`${where}: observed at ${provenance.asOf}, after the world's asOf ${asOf}`);
    }
  };
  check(household.provenance, `${household.key}`);
  // The evidence clock IS provenance now, so it is held to the same two rules as
  // every record it stamps - nothing unlabeled, nothing observed in the future.
  check(household.evidence.liquidity, `${household.key}/evidence/liquidity`);
  check(household.evidence.positions, `${household.key}/evidence/positions`);
  check(household.evidence.instructions, `${household.key}/evidence/instructions`);
  household.members.forEach((member) => check(member.provenance, `${household.key}/member/${member.key}`));
  household.entities.forEach((entity) => check(entity.provenance, `${household.key}/entity/${entity.key}`));
  for (const account of household.accounts) {
    check(account.provenance, `${household.key}/account/${account.key}`);
    account.holdings.forEach((holding) => check(holding.provenance, `${household.key}/account/${account.key}/${holding.symbol}`));
    account.beneficiaries.forEach((beneficiary) => check(beneficiary.provenance, `${household.key}/account/${account.key}/beneficiary/${beneficiary.partyKey}`));
    account.signers.forEach((signer) => check(signer.provenance, `${household.key}/account/${account.key}/signer/${signer.partyKey}`));
    const total = account.holdings.reduce((sum, holding) => sum + holding.marketValueMinor, 0);
    if (total !== account.balanceMinor) {
      problems.push(`${household.key}/account/${account.key}: holdings total ${total} != balance ${account.balanceMinor}`);
    }
  }
  household.bankInstructions.forEach((instruction) => check(instruction.provenance, `${household.key}/bank/${instruction.key}`));
  household.plannedWithdrawals.forEach((withdrawal) => check(withdrawal.provenance, `${household.key}/withdrawal/${withdrawal.key}`));
  household.instructions.forEach((instruction) => check(instruction.provenance, `${household.key}/instruction/${instruction.key}`));
  household.pendingActions.forEach((action) => check(action.provenance, `${household.key}/pending/${action.key}`));
  household.activity.forEach((entry) => check(entry.provenance, `${household.key}/activity/${entry.key}`));
  return problems;
}

/**
 * The rules an ACCOUNT must satisfy however it was authored. A NAMED PREDICATE
 * over one household so the fence can feed it a violation, and applied to the
 * generated output rather than to a spec file, so the hand-authored ten and the
 * derived ninety are held to it alike.
 */
export function accountRuleProblems(household: WorldHousehold): string[] {
  const problems: string[] = [];
  // Whoever this household records ONLY as an authorized signer owns nothing
  // inside it. An entity household's own note says its people appear only as
  // signers, so a joint account or a personal IRA titled to one of them makes
  // the household contradict its own prose on the first page a reader opens -
  // and the generator's filter is not a check: a hand-authored household reaches
  // the same output through a different door.
  const signersOnly = new Set(
    household.members.filter((member) => member.role === "signer").map((member) => member.key),
  );
  for (const account of household.accounts) {
    const where = `${household.key}/account/${account.key}`;
    for (const owner of account.ownerKeys) {
      if (signersOnly.has(owner)) {
        problems.push(`${where}: titled to "${owner}", who appears in this household only as an authorized signer`);
      }
    }
    const symbols = account.holdings.map((holding) => holding.symbol);
    for (const symbol of new Set(symbols.filter((symbol, index) => symbols.indexOf(symbol) !== index))) {
      problems.push(`${where}: holds ${symbol} more than once - one lot rendered twice`);
    }
    // An estate does not pass to the person it already belongs to, and a
    // self-designation scores the account COMPLETE on the beneficiary health
    // factor - inflating the one number this surface exists to earn.
    for (const beneficiary of account.beneficiaries) {
      if (account.ownerKeys.includes(beneficiary.partyKey)) {
        problems.push(`${where}: names its own owner "${beneficiary.partyKey}" as a ${beneficiary.tier} beneficiary`);
      }
    }
  }
  return problems;
}

/**
 * Every instrument the hand-owned roster carries is held somewhere. The roster
 * is input a person edits, and an entry no account can ever hold is a world
 * thinner than its own vocabulary claims - the exact "looks capable until you
 * inspect it" failure this world exists to prevent. Checked on the OUTPUT, so a
 * future roster addition the selection cannot reach fails here rather than
 * sitting dead and unnoticed.
 */
export function instrumentReachProblems(world: GeneratedWorld, spec: LoadedWorldSpec): string[] {
  const held = new Set(
    world.households.flatMap((household) =>
      household.accounts.flatMap((account) => account.holdings.map((holding) => holding.symbol))),
  );
  return spec.roster.instruments
    .filter((instrument) => !held.has(instrument.symbol))
    .map((instrument) => `instrument ${instrument.symbol} (${instrument.assetClass}) is in the roster but held by no account - a roster entry the world can never render`);
}

function structureProblems(world: GeneratedWorld, spec: LoadedWorldSpec): string[] {
  const problems: string[] = [...instrumentReachProblems(world, spec)];
  const byKey = new Map(world.households.map((household) => [household.key, household]));
  if (world.households.length !== spec.roster.householdCount) {
    problems.push(`generated ${world.households.length} households, roster declares ${spec.roster.householdCount}`);
  }
  for (const collision of spec.roster.deliberateSurnameCollisions) {
    const count = world.households.filter((household) => household.surname === collision.surname).length;
    if (count < collision.households) {
      problems.push(`surname "${collision.surname}" appears in ${count} households, ${collision.households} declared - the awkward case is the point`);
    }
  }
  for (const household of world.households) {
    if (household.accounts.length === 0) problems.push(`${household.key}: no accounts - a household without an account renders as an empty surface`);
    if (household.members.length === 0) problems.push(`${household.key}: no members`);
    if (household.activity.length === 0) problems.push(`${household.key}: no recent activity`);
    problems.push(...accountRuleProblems(household));
    for (const link of household.crossHouseholdLinks) {
      const counterparty = byKey.get(link.counterpartyHouseholdKey);
      if (!counterparty) {
        problems.push(`${household.key}: cross-household link to unknown "${link.counterpartyHouseholdKey}"`);
      } else if (!counterparty.crossHouseholdLinks.some((back) => back.counterpartyHouseholdKey === household.key)) {
        problems.push(`${household.key}: cross-household link to ${link.counterpartyHouseholdKey} is not acknowledged from the other side`);
      }
    }
  }
  return problems;
}

/** Regenerate, byte-compare against the committed tree, and re-check every rule. */
export function validateWorld(specDir?: string): WorldValidation {
  const spec = loadWorldSpec(specDir);
  const world = generateWorld(spec, WORLD_SEED);
  const problems: string[] = [...structureProblems(world, spec)];
  for (const household of world.households) {
    problems.push(...forbiddenFieldProblems(household), ...provenanceProblems(household, spec.roster.clock.asOf));
  }
  const expected = new Map<string, string>([
    ...world.files.map((file) => [file.relPath, file.bytes] as const),
    [world.manifest.relPath, world.manifest.bytes],
  ]);
  const committed = new Map<string, string>(
    readTree(HOUSEHOLDS_DIR, "households")
      .filter((entry) => entry.relPath.endsWith(".json") && entry.bytes !== null)
      .map((entry) => [entry.relPath, entry.bytes!] as const),
  );
  const manifestEntry = readTree(WORLD_DIR)
    .find((entry) => entry.relPath === "manifest.json" && entry.bytes !== null);
  if (manifestEntry?.bytes) committed.set("manifest.json", manifestEntry.bytes);
  for (const [relPath, bytes] of expected) {
    const actual = committed.get(relPath);
    if (actual === undefined) {
      problems.push(`fixtures/world/${relPath}: missing - run \`pnpm world:generate\``);
    } else if (actual !== bytes) {
      problems.push(`fixtures/world/${relPath}: bytes differ from a fresh generation (${sha256(actual)} != ${sha256(bytes)}) - generated files are never hand-edited`);
    }
  }
  for (const relPath of committed.keys()) {
    if (!expected.has(relPath)) problems.push(`fixtures/world/${relPath}: not produced by the generator - stale file`);
  }
  const manifestValue = parseStrictJson(world.manifest.bytes, "manifest.json") as { worldDigest?: unknown };
  return { spec, world, worldDigest: String(manifestValue.worldDigest ?? ""), problems };
}
