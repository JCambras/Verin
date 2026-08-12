/**
 * WORLD GENERATOR (ADR-0057): hand-owned spec + one root seed -> a hundred
 * households in canonical bytes.
 *
 * Ten households are hand-authored in `featured.json` and keep their keys
 * forever; the rest are drawn path-keyed into the same draft shape. One
 * materializer turns every draft into the same typed household, so the ninety
 * are as deep as the ten.
 */
import { derivedHousehold, derivedSurnames } from "./derived";
import {
  buildWorldInventory, buildWorldManifest, householdFile, worldGeneratorDigest,
  type GeneratedWorldFile,
} from "./emit";
import { materializeHousehold } from "./materialize";
import { type FeaturedHousehold, type LoadedWorldSpec } from "./spec";
import type { WorldHousehold } from "../../src/domain/world/household-world";

export interface GeneratedWorld {
  readonly households: readonly WorldHousehold[];
  readonly files: readonly GeneratedWorldFile[];
  readonly manifest: GeneratedWorldFile;
}

/** The complete draft list: featured first (by spec order), then the derived
 * slots. A featured household added later takes the LAST derived slot's place
 * rather than renumbering the ones that remain. */
export function draftHouseholds(spec: LoadedWorldSpec, seed: string): FeaturedHousehold[] {
  const slots = spec.roster.householdCount - spec.featured.length;
  const surnames = derivedSurnames(spec.roster, spec.featured, slots, seed);
  const taken = new Set(spec.featured.map((household) => household.key));
  const drafts: FeaturedHousehold[] = [...spec.featured];
  for (let slot = 0; slot < slots; slot += 1) {
    const draft = derivedHousehold(seed, spec.roster, slot, surnames[slot]!, taken, spec.roster.clock.asOf);
    taken.add(draft.key);
    drafts.push(draft);
  }
  return drafts;
}

export function generateWorld(spec: LoadedWorldSpec, seed: string): GeneratedWorld {
  const featuredKeys = new Set(spec.featured.map((household) => household.key));
  const households = draftHouseholds(spec, seed).map((draft) =>
    materializeHousehold({
      seed,
      roster: spec.roster,
      draft,
      authoring: featuredKeys.has(draft.key) ? "hand-authored" : "derived",
    }),
  );
  const duplicateKeys = households
    .map((household) => household.key)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    throw new Error(`world generate: duplicate household key(s) ${[...new Set(duplicateKeys)].join(", ")}`);
  }
  const files = households.map(householdFile);
  const inventory = buildWorldInventory(files);
  const manifest = buildWorldManifest({
    worldVersion: spec.roster.worldVersion,
    seed,
    asOf: spec.roster.clock.asOf,
    timeZone: spec.roster.clock.timeZone,
    rosterNote: spec.roster.rosterNote,
    households,
    inventory,
    generatorDigest: worldGeneratorDigest(seed, spec.rawBytes),
  });
  return { households, files, manifest };
}
