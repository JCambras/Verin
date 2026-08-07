import { join } from "node:path";
import { Project, ts } from "ts-morph";
import { loadTaxonomy } from "../../../scripts/corpus/defects";
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import { loadSpec, type LoadedSpec } from "../../../scripts/corpus/world";
import { CORPUS_SRC } from "./_corpus-repository-inputs";
import {
  isExecutableSourceFilePath,
  moduleReferences,
  REPO_ROOT,
  toolingSourceFiles,
} from "./_fence-utils";

export const generatorProject = (root: string = CORPUS_SRC): Project => {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of toolingSourceFiles(root)) {
    project.addSourceFileAtPath(file);
  }
  for (let index = 0; index < project.getSourceFiles().length; index += 1) {
    const source = project.getSourceFiles()[index]!;
    for (const reference of moduleReferences(source)) {
      if (reference.specifier === null) continue;
      const resolved = ts.resolveModuleName(
        reference.specifier,
        source.getFilePath(),
        project.getCompilerOptions(),
        project.getModuleResolutionHost(),
      ).resolvedModule;
      if (
        resolved === undefined ||
        resolved.isExternalLibraryImport ||
        !isExecutableSourceFilePath(resolved.resolvedFileName) ||
        resolved.resolvedFileName.split(/[/\\]/).includes("node_modules") ||
        project.getSourceFile(resolved.resolvedFileName) !== undefined
      ) {
        continue;
      }
      project.addSourceFileAtPath(resolved.resolvedFileName);
    }
  }
  return project;
};

// ── (b) + (c) comparison helpers ───────────────────────────────────────────────

export const bytesByPath = (spec: LoadedSpec, seed: string): Map<string, string> =>
  new Map(generateSyntheticCases(spec, seed).map((file) => [file.relPath, file.bytes]));

/** Files whose bytes differ between two generations (plus added/removed paths). */
export function changedPaths(left: Map<string, string>, right: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [path, bytes] of left) if (right.get(path) !== bytes) changed.add(path);
  for (const [path, bytes] of right) if (left.get(path) !== bytes) changed.add(path);
  return [...changed].sort();
}

/** The seed-sensitivity check itself, as a detector: two DISTINCT seeds that
 * produce identical bytes mean the seed is decorative. */
export function seedSensitivityProblems(underA: Map<string, string>, underB: Map<string, string>): string[] {
  return changedPaths(underA, underB).length === 0
    ? ["generator output is identical under two distinct seeds - the seed is not being used"]
    : [];
}

export /**
 * A NEW household inserted in the MIDDLE of every spec collection, so a
 * position-sensitive generator reshuffles and a path-keyed one does not.
 *
 * Its key is `smiths-west`: a deliberate PREFIX COLLISION with the existing
 * `smiths` household, carrying its own position-scoped legal hold. A subgraph
 * that resolved holds by substring (`subjectRef.includes(":smiths")`) would leak
 * this hold into `smiths` and change a foreign household's committed bytes - the
 * exact break a neutrally-keyed `inserted` household cannot detect.
 */
function specWithInsertedHousehold(spec: LoadedSpec): LoadedSpec {
  const middle = <T>(rows: readonly T[], row: T): T[] => {
    const at = Math.floor(rows.length / 2);
    return [...rows.slice(0, at), row, ...rows.slice(at)];
  };
  const world = spec.world;
  const observedAt = world.accounts[0]!.balanceObservedAt;
  return {
    ...spec,
    world: {
      ...world,
      parties: middle(world.parties, {
        key: "smiths-west-party",
        kind: "natural-person",
        rosterName: "Inserted Fixture Person",
        roles: ["client"],
      }),
      households: middle(world.households, {
        key: "smiths-west",
        scopeSlug: "smiths-west",
        displayName: "Inserted Fixture Household",
        memberRefs: ["smiths-west-party"],
        advisorRef: world.households[0]!.advisorRef,
      }),
      accounts: middle(world.accounts, {
        key: "smiths-west-taxable",
        householdRef: "smiths-west",
        registration: "individual",
        ownerRefs: ["smiths-west-party"],
        custodian: world.accounts[0]!.custodian,
        balanceMinor: 1_000_000,
        balanceObservedAt: observedAt,
        taxClass: "taxable",
      }),
      bankInstructions: middle(world.bankInstructions, {
        key: "smiths-west-primary",
        householdRef: "smiths-west",
        titledTo: "smiths-west-party",
        bank: "Inserted Bank",
        lastFour: "0000",
        verifiedAt: world.bankInstructions[0]!.verifiedAt,
        changedAt: null,
        accountRefs: ["smiths-west-taxable"],
        observedAt,
      }),
      legalHolds: middle(world.legalHolds, {
        key: "smiths-west-position-hold",
        subjectRef: "position:smiths-west-taxable:NBRD-2031",
        scope: "position",
        recordedAt: observedAt,
        observedAt,
        releasedAt: null,
      }),
    },
    cases: {
      ...spec.cases,
      cases: middle(spec.cases.cases, {
        key: "smiths-west-control",
        title: "Inserted clean control",
        firmId: "firm-a",
        householdRef: "smiths-west",
        assumptionIds: [],
        label: { kind: "clean-control", controlRationale: "Inserted to prove order independence." },
        request: {
          action: "distribution",
          sourceAccountRef: "smiths-west-taxable",
          selectedFundingRefs: ["smiths-west-taxable"],
          destinationRef: "smiths-west-primary",
          amountMinor: 100_000,
          discriminator: "1000-2026-09-10",
          deadline: "2026-09-10T13:00:00.000Z",
        },
        outcomes: [{
          defectClassId: "destination-integrity-defect",
          expectedTreatment: "accept-verified-unique-destination",
          observedTreatment: "accept-verified-unique-destination",
        }],
        evidence: ["balance/smiths-west-taxable", "bank-instruction/smiths-west-primary"],
        conflictFamilies: ["liquidity"],
      }),
    },
  };
}

export const realSpec = loadSpec();
export const realTaxonomy = loadTaxonomy();

/** The single in-memory generator source every companion feeds the AST scan. */
export const file = (body: string) => ({ "/src/contracts/gen.ts": body });
