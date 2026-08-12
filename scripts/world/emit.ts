/**
 * WORLD EMISSION (ADR-0057): typed households -> canonical bytes + manifest.
 *
 * Bytes are `canonicalJson` plus exactly one trailing newline - the same byte
 * discipline the replay corpus uses, so `pnpm world:validate` can regenerate
 * and byte-compare rather than "spot-check a few fields".
 *
 * The manifest carries the DIRECTORY rows. A hundred-row list must not have to
 * open a hundred deep files to render, and a summary that is recomputed at read
 * time is a summary that can disagree with the file it summarizes.
 */
import { canonicalJson, type JsonValue } from "../../src/contracts/decision-core/serialization";
import type { WorldHousehold, WorldHouseholdSummary } from "../../src/domain/world/household-world";
import { sha256, sortedBy } from "../corpus/_util";
import { WORLD_SPEC_FILES } from "./spec";

export const WORLD_DIGEST_PREIMAGE_VERSION = "verin-world/1.0.0";

export interface GeneratedWorldFile {
  /** Path relative to `fixtures/world/`. */
  readonly relPath: string;
  readonly value: JsonValue;
  readonly bytes: string;
}

const canonicalBytes = (value: JsonValue, what: string): string => {
  const result = canonicalJson(value);
  if (!result.ok) throw new Error(`world emit: ${what} is not canonically serializable: ${result.error.message}`);
  return `${result.value}\n`;
};

/** The directory row for one household, computed from the household itself so
 * the list and the detail can never disagree. */
export function summarize(household: WorldHousehold): WorldHouseholdSummary {
  const unverified = household.bankInstructions.filter(
    (instruction) => instruction.state === "current" && instruction.verifiedAt === null,
  ).length;
  const stuck = household.pendingActions.filter(
    (action) => action.state === "blocked" || action.state === "rejected",
  ).length;
  return {
    key: household.key,
    id: household.id,
    displayName: household.displayName,
    surname: household.surname,
    state: household.state,
    authoring: household.authoring,
    advisorName: household.advisorName,
    serviceTier: household.serviceTier,
    city: household.city,
    memberCount: household.members.length,
    accountCount: household.accounts.length,
    totalBalanceMinor: household.accounts.reduce((sum, account) => sum + account.balanceMinor, 0),
    openItemCount: unverified + stuck,
    provenance: household.provenance,
  };
}

export function householdFile(household: WorldHousehold): GeneratedWorldFile {
  const value = {
    __generated: {
      generator: "scripts/world-generate.ts",
      command: "pnpm world:generate",
      note: "GENERATED - never hand-edit. `pnpm world:validate` regenerates and byte-compares.",
    },
    household: household as unknown as JsonValue,
  } as unknown as JsonValue;
  return {
    relPath: `households/${household.key}.json`,
    value,
    bytes: canonicalBytes(value, `households/${household.key}.json`),
  };
}

export interface WorldInventoryEntry {
  readonly key: string;
  readonly file: string;
  readonly digest: string;
}

export const buildWorldInventory = (files: readonly GeneratedWorldFile[]): WorldInventoryEntry[] =>
  sortedBy(
    files.map((file) => ({
      key: file.relPath.replace(/^households\//, "").replace(/\.json$/, ""),
      file: file.relPath,
      digest: sha256(file.bytes),
    })),
    (entry) => entry.key,
  );

/** The digest of the whole world: seed, version, and every case file's bytes.
 * One value a reviewer can quote, and the value the determinism fence compares
 * across environments without diffing a hundred files. */
export function worldDigest(
  worldVersion: string,
  seed: string,
  generator: string,
  inventory: readonly WorldInventoryEntry[],
): string {
  const preimage: JsonValue = {
    hashKind: "verin-world",
    preimageVersion: WORLD_DIGEST_PREIMAGE_VERSION,
    payload: {
      worldVersion,
      seed,
      generatorDigest: generator,
      households: inventory.map((entry) => [entry.key, entry.digest] as unknown as JsonValue),
    },
  };
  return sha256(canonicalBytes(preimage, "worldDigest preimage"));
}

/** The digest of the hand-owned INPUT. A changed spec must change this even if
 * a bug made the output identical, so the two are digested separately. */
export function worldGeneratorDigest(seed: string, rawBytes: Readonly<Record<string, string>>): string {
  const preimage: JsonValue = {
    hashKind: "verin-world-generator",
    preimageVersion: WORLD_DIGEST_PREIMAGE_VERSION,
    payload: {
      seed,
      specFiles: WORLD_SPEC_FILES.map((name) => {
        const bytes = rawBytes[name];
        if (bytes === undefined) throw new Error(`world emit: missing spec bytes for ${name}`);
        return [name, sha256(bytes)] as unknown as JsonValue;
      }),
    },
  };
  return sha256(canonicalBytes(preimage, "world generatorDigest preimage"));
}

export interface ManifestInput {
  readonly worldVersion: string;
  readonly seed: string;
  readonly asOf: string;
  readonly timeZone: string;
  readonly rosterNote: string;
  readonly households: readonly WorldHousehold[];
  readonly inventory: readonly WorldInventoryEntry[];
  readonly generatorDigest: string;
}

export function buildWorldManifest(input: ManifestInput): GeneratedWorldFile {
  const summaries = sortedBy(input.households.map(summarize), (summary) => summary.key);
  const value = {
    __generated: {
      generator: "scripts/world-generate.ts",
      command: "pnpm world:generate",
      handOwnedInput: WORLD_SPEC_FILES.map((name) => `fixtures/world/spec/${name}`),
      note: "GENERATED - never hand-edit. `pnpm world:validate` regenerates and byte-compares.",
    },
    worldVersion: input.worldVersion,
    seed: input.seed,
    asOf: input.asOf,
    timeZone: input.timeZone,
    provenance: "fixture",
    provenanceNote: input.rosterNote,
    worldDigest: worldDigest(input.worldVersion, input.seed, input.generatorDigest, input.inventory),
    generatorDigest: input.generatorDigest,
    householdCount: summaries.length,
    handAuthoredCount: summaries.filter((summary) => summary.authoring === "hand-authored").length,
    derivedCount: summaries.filter((summary) => summary.authoring === "derived").length,
    households: summaries.map((summary) => {
      const entry = input.inventory.find((candidate) => candidate.key === summary.key);
      if (!entry) throw new Error(`world emit: no inventory entry for household "${summary.key}"`);
      return { ...summary, file: entry.file, digest: entry.digest } as unknown as JsonValue;
    }),
  } as unknown as JsonValue;
  return { relPath: "manifest.json", value, bytes: canonicalBytes(value, "manifest") };
}
