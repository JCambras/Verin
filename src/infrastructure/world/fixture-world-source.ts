/**
 * FIXTURE WORLD SOURCE (ADR-0057) - the Wave 0 adapter behind
 * `HouseholdWorldSource`.
 *
 * Household DEPTH (positions, beneficiary designations, bank instructions and
 * their change history, planned withdrawals, restrictions) is EVIDENCE owned by
 * custodians and the CRM of record, not by Verin's house CRM. Until a real
 * EvidenceSource lands (ADR-0024, Salesforce/custodian sandbox), that evidence
 * comes from the generated world under `fixtures/world/`, labeled
 * `source: "fixture"` on every record, so `canFeedComplianceDecision` refuses
 * it and anything derived from it renders watermarked (ADR-0022). This adapter
 * is REPLACED when the real path lands; it is never quietly relabeled.
 *
 * Fail-closed twice over. It refuses to serve anything in production - the
 * clean-slate guarantee is structural, not a promise - and it verifies each
 * household file's SHA-256 against the manifest before parsing it, so a file
 * edited on a running box is a refusal rather than a rendered lie.
 *
 * Reading a household means reading the names of the people in it, so both
 * methods take the governed `pii.view` grant, exactly as the CRM repository
 * does: the grant's sealed tenant is what scopes the read, and no caller
 * reaches this evidence without having been authorized for it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertActionGrant, type ActionGrant } from "@contracts/authz";
import { assertTenantContext } from "@contracts/tenant";
import { getConfig } from "@infra/config";
import type {
  HouseholdWorldSource, WorldHousehold, WorldHouseholdSummary,
} from "@domain/world/household-world";

interface ManifestEntry {
  readonly key: string;
  readonly file: string;
  readonly digest: string;
}
interface WorldManifest {
  readonly worldVersion: string;
  readonly worldDigest: string;
  readonly asOf: string;
  readonly provenanceNote: string;
  readonly households: readonly (WorldHouseholdSummary & ManifestEntry)[];
}

/** The generated world lives beside the repository root the server runs from -
 * the same cwd-relative resolution the PGlite data directory uses. */
const WORLD_DIR = resolve(process.cwd(), "fixtures", "world");

const sha256 = (bytes: string): string => createHash("sha256").update(bytes, "utf8").digest("hex");

/** Read-only fixture bytes: cached on `globalThis` for the same reason the store
 * singleton is (Next bundles route handlers and server components separately,
 * so a module-local cache is two caches). */
const cacheHome = globalThis as unknown as {
  __verinWorldManifest?: WorldManifest | null;
  __verinWorldHouseholds?: Map<string, WorldHousehold>;
};

/** Production never serves demonstration depth, whatever is on the disk. */
const worldIsServable = (): boolean => getConfig().appEnv !== "production";

function loadManifest(): WorldManifest | null {
  if (cacheHome.__verinWorldManifest !== undefined) return cacheHome.__verinWorldManifest;
  let manifest: WorldManifest | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(WORLD_DIR, "manifest.json"), "utf8"));
    manifest = isManifest(parsed) ? parsed : null;
  } catch {
    // A world that is not on disk is an EMPTY world, never a crashed request:
    // the surfaces render their empty state and say why.
    manifest = null;
  }
  cacheHome.__verinWorldManifest = manifest;
  return manifest;
}

function isManifest(value: unknown): value is WorldManifest {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<WorldManifest>;
  return typeof candidate.worldVersion === "string"
    && typeof candidate.worldDigest === "string"
    && typeof candidate.asOf === "string"
    && typeof candidate.provenanceNote === "string"
    && Array.isArray(candidate.households)
    && candidate.households.every((entry) =>
      typeof entry?.key === "string" && typeof entry?.file === "string" && typeof entry?.digest === "string");
}

/** A parsed household is only accepted when it is fixture-labeled and shaped:
 * the blocking `world` gate proves the deep schema, this proves the file the
 * server actually opened is the file that gate signed off. */
function isHousehold(value: unknown): value is WorldHousehold {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<WorldHousehold>;
  return typeof candidate.key === "string"
    && typeof candidate.id === "string"
    && candidate.provenance?.source === "fixture"
    && Array.isArray(candidate.members)
    && Array.isArray(candidate.accounts)
    && Array.isArray(candidate.instructions)
    && Array.isArray(candidate.activity);
}

function loadHousehold(entry: ManifestEntry): WorldHousehold | null {
  const cache = cacheHome.__verinWorldHouseholds ??= new Map<string, WorldHousehold>();
  const cached = cache.get(entry.key);
  if (cached) return cached;
  let bytes: string;
  try {
    bytes = readFileSync(join(WORLD_DIR, entry.file), "utf8");
  } catch {
    return null;
  }
  // Integrity before parse: the manifest is what the `world` gate byte-compared.
  if (sha256(bytes) !== entry.digest) return null;
  const parsed: unknown = JSON.parse(bytes);
  const household = (parsed as { household?: unknown })?.household;
  if (!isHousehold(household)) return null;
  cache.set(entry.key, household);
  return household;
}

/**
 * THE ADAPTER. Reads are pure disk reads of committed bytes, so they are
 * synchronous under the port's async contract - there is no IO to await and
 * pretending otherwise would only hide that fact from the caller.
 */
export const fixtureWorldSource: HouseholdWorldSource = {
  listHouseholds(grant: ActionGrant<"pii.view">): Promise<readonly WorldHouseholdSummary[]> {
    assertActionGrant(grant, "pii.view");
    assertTenantContext(grant.tenant);
    if (!worldIsServable()) return Promise.resolve([]);
    const manifest = loadManifest();
    return Promise.resolve(manifest?.households.map(toSummary) ?? []);
  },
  getHousehold(grant: ActionGrant<"pii.view">, key: string): Promise<WorldHousehold | null> {
    assertActionGrant(grant, "pii.view");
    assertTenantContext(grant.tenant);
    if (!worldIsServable()) return Promise.resolve(null);
    const entry = loadManifest()?.households.find((candidate) => candidate.key === key);
    return Promise.resolve(entry ? loadHousehold(entry) : null);
  },
};

/** The manifest row minus its file/digest bookkeeping - what a directory renders. */
function toSummary(entry: WorldHouseholdSummary & ManifestEntry): WorldHouseholdSummary {
  const { file, digest, ...summary } = entry;
  void file;
  void digest;
  return summary;
}

export interface WorldIdentity {
  readonly version: string;
  readonly digest: string;
  /** The instant the world states its evidence was observed against. Health is
   * computed as of THIS instant, not the wall clock, so the same world always
   * produces the same score. */
  readonly asOf: string;
  readonly provenanceNote: string;
}

/** The world's identity, for the surfaces that must state which world they are
 * showing. `null` when no world is on disk or the environment refuses to serve
 * one - a surface that cannot name its world must not claim to have data. */
export function worldIdentity(): WorldIdentity | null {
  if (!worldIsServable()) return null;
  const manifest = loadManifest();
  return manifest
    ? {
        version: manifest.worldVersion,
        digest: manifest.worldDigest,
        asOf: manifest.asOf,
        provenanceNote: manifest.provenanceNote,
      }
    : null;
}
