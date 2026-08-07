import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceResolutionProblems } from "../../../scripts/corpus/graph";
import {
  buildInventory,
  buildManifest,
} from "../../../scripts/corpus/manifest";
import { realDerivedCollectionProblems } from "../../../scripts/corpus/real-derived";
import * as corpusReportRuntime from "../../../scripts/corpus/report";
import { renderCorpusReport } from "../../../scripts/corpus/report";
import { canonicalIntakeFilenameRule } from "../../../scripts/corpus/intake-filename";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import {
  labelProblems,
  readCommittedCorpus,
  realDerivedDeferralProblems,
  realDerivedProblems,
} from "../../../scripts/corpus/validate";
import { blendingViolations, measuredCodeProject } from "./_corpus-blending";
import { canonicalFixtureBytes } from "./_corpus-case-fixtures";
import { realDerivedCase } from "./_corpus-real-derived-fixtures";
import {
  outcomes,
  reportExportProblems,
  reportInput,
} from "./_corpus-report-fixtures";
import {
  CORPUS_MANIFEST,
  goldenIds,
  real,
  refs,
} from "./_corpus-world";
import {
  inMemoryProject,
  REPO_ROOT,
} from "./_fence-utils";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE (v3 prompt 11, ADR-0052; charter #3/#4;
 * architecture v3 §2.4; demo contract §7).
 *
 * Architecture §2.4 requires the corpus metric to be split by provenance and
 * warns that a synthetic-only rate is circular. Nothing enforced that before
 * this fence. Six rules, each mechanical:
 *
 *  (a) LABELED - every corpus case carries a provenance label from the LIVE
 *      config/demo/scenarios.yaml vocabulary and a defect class from the closed
 *      taxonomy, or the labeled clean control;
 *  (b) DISJOINT - no corpus case id collides with a signed `GC-` golden case.
 *      The golden sixteen were authored to be caught; counting them in a corpus
 *      denominator is the circularity §2.4 exists to prevent;
 *  (c) NO BLENDING - no expression anywhere in `src/` or `scripts/` combines the
 *      two partitions arithmetically, and the report type carries no aggregate
 *      key. The two figures even have different NAMES:
 *      `syntheticDefectCoverage` vs `detectionRate`;
 *  (d) HONEST EMPTY - with an empty real-derived partition the reporter emits
 *      `detectionRate: null` with `reasonCode: "real-derived-corpus-absent"` and
 *      never substitutes the synthetic figure. The companion populates the
 *      partition and gets a NUMBER, proving `null` is a real branch, not a stub;
 *  (e) FALSE POSITIVES BESIDE COVERAGE - clean controls exist; a detector that
 *      flags everything scores 1.0 coverage AND 1.0 false positives; no control
 *      carries the defect being measured (stale, lapsed, expired, unverified or
 *      dangling evidence, or an infeasible deadline), because a polluted
 *      denominator makes the false-positive rate meaningless; and every class in
 *      the closed taxonomy is exercised by at least one labeled defect case -
 *      the mirror of the spec loader's unexercised-assumption rule;
 *  (f) FAIL-CLOSED INTAKE + AGENTS NEVER SIGN - the real-derived contract rejects
 *      an unattested or free-text-bearing case, and no code path under
 *      `scripts/` can originate a `signedBy` value.
 */

describe("corpus-provenance-split fence", () => {
  it("(a)+(b) enforces: every corpus case is labeled, in-vocabulary, and disjoint from the signed golden set", () => {
    const problems = labelProblems(real.cases, real.taxonomy, refs.provenanceLabels, goldenIds);
    expect(problems, `corpus labeling problems:\n${problems.join("\n")}`).toEqual([]);
    expect(real.cases.length).toBeGreaterThan(0);
    expect(goldenIds.size).toBe(16);
  });

  it("(c) enforces: structured partition measurements stay inside the partition-safe report owner", () => {
    const names = Object.keys(corpusReportRuntime);
    expect(names).toEqual(["renderCorpusReport"]);
    expect(reportExportProblems(names)).toEqual([]);
  });

  it("(c) enforces: product and tooling code never blend provenance partitions", () => {
    const violations = blendingViolations(measuredCodeProject(), REPO_ROOT);
    expect(
      violations,
      `blended provenance figures:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("(c) enforces: the report type has no aggregate key and the two figures have different names", () => {
    const report = renderCorpusReport(reportInput(outcomes(2, 1, true)));
    expect(report).toContain("syntheticDefectCoverage  100.00%");
    expect(report).toContain("detectionRate            null (real-derived-corpus-absent)");
    expect(report).not.toContain("overallRate");
  });

  it("(d) enforces: with an empty real-derived partition the reporter withholds detectionRate", () => {
    const synthetic = outcomes(3, 2, true);
    const report = renderCorpusReport(reportInput(synthetic));
    expect(report).toContain("detectionRate            null (real-derived-corpus-absent)");
    expect(report).toContain("syntheticDefectCoverage  100.00%");
    expect(report).toContain("No detection rate is claimed");
  });

  it("(d) enforces: the committed real-derived partition IS empty and ships its intake contract", () => {
    const manifest = JSON.parse(readFileSync(CORPUS_MANIFEST, "utf8")) as Record<string, any>;
    expect(manifest.partitions.realDerived.total).toBe(0);
    expect(manifest.partitions.realDerived.provenance).toBe("real-derived-fixture");
    expect(manifest.partitions.realDerived.deferral.status).toBe("deferred-pending-authorized-source");
    expect(String(manifest.partitions.realDerived.deferral.unDeferTrigger).length).toBeGreaterThan(40);
    expect(existsSync(join(REPO_ROOT, manifest.partitions.realDerived.deferral.adr))).toBe(true);
    expect(
      realDerivedProblems(real.taxonomy, real.spec.world.corpusVersion),
    ).toEqual([]);
  });

  it("(d) enforces: every evidence and request reference resolves exactly once in its emitted case graph", () => {
    expect(evidenceResolutionProblems(real.cases)).toEqual([]);
    const crossHousehold = real.cases.find(
      (item) => item.caseId === "CS-beneficiary-versus-destination-restriction",
    )!;
    expect(crossHousehold.records.bankInstructions.map((row) => row.id)).not.toContain(
      "bank-instruction:mira-primary",
    );
    expect(crossHousehold.records.accounts.map((row) => row.id)).not.toContain(
      "subject:mira-roth",
    );
    expect(crossHousehold.records.referencedAccounts).toEqual([
      {
        id: "subject:mira-roth",
        householdRef: "subject:smith-mira",
      },
    ]);
    expect(crossHousehold.records.referencedBankInstructions).toEqual([
      {
        id: "bank-instruction:mira-primary",
        householdRef: "subject:smith-mira",
        accountRefs: ["subject:mira-roth"],
        titledTo: "subject:mira-smith",
      },
    ]);
    expect(crossHousehold.records.referencedHouseholds).toEqual([
      {
        id: "subject:smith-mira",
        relationshipReasons: [
          "owns-account",
          "owns-bank-instruction",
        ],
      },
    ]);
    expect(
      crossHousehold.records.referencedAccounts.find(
        (row) => row.id === "subject:mira-roth",
      )?.householdRef,
    ).toBe("subject:smith-mira");
    expect(
      crossHousehold.records.referencedBankInstructions.find(
        (row) => row.id === "bank-instruction:mira-primary",
      )?.householdRef,
    ).toBe("subject:smith-mira");
    const modelCase = real.cases.find(
      (item) => item.caseId === "CS-pending-rebalance-during-evaluation",
    )!;
    expect(modelCase.records.modelAssignments.map((row) => row.id)).toContain(
      "model-assignment:smiths-joint-model",
    );
    const scheduleCase = real.cases.find(
      (item) => item.caseId === "CS-segmented-withdrawal-schedule",
    )!;
    expect(scheduleCase.records.plannedWithdrawals[0]?.id).toBe(
      "planned-withdrawal:smiths",
    );
    const changeCase = real.cases.find(
      (item) => item.caseId === "CS-shared-instruction-change-blast-radius",
    )!;
    expect(changeCase.records.recentChanges[0]?.id).toBe("change:smiths-bank-change");
    expect(changeCase.records.restrictions.every((row) => row.subjectRef.length > 0)).toBe(true);
    const cleanLiquidity = real.cases.find(
      (item) => item.caseId === "CS-clean-ample-liquidity",
    )!;
    expect(cleanLiquidity.records.pendingActions[0]).toMatchObject({
      direction: "incoming",
      liquidityClass: "credit",
      reducesEffectiveLiquidity: false,
      increasesAvailableLiquidity: false,
    });
  });

  it("(d) enforces: real-derived files are rejected while deferred and inventory-ready after un-deferral", () => {
    expect(realDerivedDeferralProblems(["RD-00112233445566aa.json"]).length).toBe(1);
    expect(realDerivedDeferralProblems(["RD-00112233445566aa.json"], null)).toEqual([]);
    const value = realDerivedCase();
    const file = {
      relPath: "real-derived/RD-00112233445566aa.json",
      bytes: `${JSON.stringify(value)}\n`,
      value: value as any,
    };
    const syntheticInventory = buildInventory(real.generated);
    const realInventory = buildInventory([file], "real-derived");
    const manifest = buildManifest(
      real.spec,
      real.taxonomy,
      [...syntheticInventory, ...realInventory],
      CORPUS_SEED,
    );
    const partition = (manifest.value as any).partitions.realDerived;
    expect(partition.total).toBe(1);
    expect(partition.cases[0].caseId).toBe("RD-00112233445566aa");
    expect((manifest.value as any).corpusDigest).not.toBe(real.corpusDigest);
  });

  it("(d) enforces: real-derived collection identity, version, and filenames are canonical before inventory", () => {
    const value = realDerivedCase();
    const canonical = {
      relPath: "real-derived/RD-00112233445566aa.json",
      bytes: `${JSON.stringify(value)}\n`,
      value: value as any,
    };
    expect(
      realDerivedCollectionProblems(
        [canonical],
        real.spec.world.corpusVersion,
      ),
    ).toEqual([]);
    const stale = {
      ...canonical,
      value: {
        ...value,
        corpusVersion: "2026.06.0",
      } as any,
    };
    const duplicate = {
      ...canonical,
      relPath: "real-derived/RD-aabbccddeeff0011.json",
    };
    const problems = realDerivedCollectionProblems(
      [stale, duplicate],
      real.spec.world.corpusVersion,
    );
    expect(problems.some((problem) => problem.includes("canonical filename"))).toBe(true);
    expect(problems.some((problem) => problem.includes("does not match active corpus"))).toBe(true);
    expect(problems.some((problem) => problem.includes("duplicate caseId"))).toBe(true);
  });

  it("(d) enforces: an active real-derived partition requires both measurement denominators", () => {
    const value = realDerivedCase();
    const defect = {
      relPath: "real-derived/RD-00112233445566aa.json",
      bytes: canonicalFixtureBytes(value),
      value: value as any,
    };
    const controlValue = realDerivedCase({
      caseId: "RD-aabbccddeeff0011",
      label: {
        kind: "clean-control",
        controlRationaleId: "no-defect-present",
      },
    });
    ((controlValue.replayPayload as Record<string, any>).destination).discriminatorState =
      "unique";
    const control = {
      relPath: "real-derived/RD-aabbccddeeff0011.json",
      bytes: canonicalFixtureBytes(controlValue),
      value: controlValue as any,
    };
    expect(
      realDerivedCollectionProblems(
        [defect],
        real.spec.world.corpusVersion,
        null,
      ).join("\n"),
    ).toContain("no labeled clean controls");
    expect(
      realDerivedCollectionProblems(
        [control],
        real.spec.world.corpusVersion,
        null,
      ).join("\n"),
    ).toContain("no labeled defect cases");
    expect(
      realDerivedCollectionProblems(
        [defect, control],
        real.spec.world.corpusVersion,
        null,
      ),
    ).toEqual([]);
  });

  it("(d) enforces: generated and real-derived trees are recursively inventoried, including hidden and nested files", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-tree-"));
    try {
      mkdirSync(join(root, "synthetic", "nested"), { recursive: true });
      writeFileSync(join(root, "manifest.json"), "{}\n");
      writeFileSync(join(root, "synthetic", ".hidden"), "hidden\n");
      writeFileSync(join(root, "synthetic", "note.txt"), "note\n");
      writeFileSync(join(root, "synthetic", "nested", "case.json"), "{}\n");
      expect(readCommittedCorpus(root).map((file) => file.relPath)).toEqual([
        "manifest.json",
        "synthetic/.hidden",
        "synthetic/nested/case.json",
        "synthetic/note.txt",
      ]);

      const intake = join(root, "real-derived");
      mkdirSync(join(intake, "nested"), { recursive: true });
      writeFileSync(join(intake, "README.md"), "intake\n");
      writeFileSync(join(intake, ".hidden"), "hidden\n");
      writeFileSync(
        join(intake, "nested", "RD-00112233445566aa.json"),
        canonicalFixtureBytes(realDerivedCase()),
      );
      const problems = realDerivedProblems(
        real.taxonomy,
        real.spec.world.corpusVersion,
        intake,
      );
      expect(
        problems.some((problem) =>
          problem.includes("2 delivered file(s) present"),
        ),
      ).toBe(true);
      expect(
        problems.some((problem) =>
          problem.includes(canonicalIntakeFilenameRule()),
        ),
      ).toBe(true);
      expect(problems.join("\n")).not.toContain(".hidden");
      expect(problems.join("\n")).not.toContain("nested");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {
  it.each([
    [
      "arithmetic",
      "declare const r: any; export const score = r.synthetic.defectCases + r.realDerived.defectCases;",
    ],
    [
      "a reducer",
      "declare const r: any; export const score = [r.synthetic.defectCases, r.realDerived.defectCases].reduce((a, b) => a + b, 0);",
    ],
    [
      "a helper call",
      "declare const r: any; declare const combine: (...values: number[]) => number; const left = r.synthetic.defectCases; const right = r.realDerived.defectCases; export const score = combine(left, right);",
    ],
    [
      "array concatenation",
      "declare const r: any; export const score = [r.synthetic.defectCases].concat([r.realDerived.defectCases]);",
    ],
    [
      "a shadow named like the report boundary",
      "declare const r: any; const renderCorpusReport = (...values: number[]) => values.length; export const score = renderCorpusReport(r.synthetic.defectCases, r.realDerived.defectCases);",
    ],
    [
      "a rendered template",
      "declare const r: any; export const score = `${r.synthetic.defectCases}/${r.realDerived.defectCases}`;",
    ],
    [
      "a tagged template",
      "declare const r: any; export const score = String.raw`${r.synthetic.defectCases}/${r.realDerived.defectCases}`;",
    ],
    [
      "a constructor",
      "declare const r: any; declare class Combined { constructor(...values: number[]); } export const score = new Combined(r.synthetic.defectCases, r.realDerived.defectCases);",
    ],
  ])("a blended figure through %s is caught", (_name, source) => {
    expect(
      blendingViolations(
        inMemoryProject({ "/src/domain/blend.ts": source }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("partition values remain tainted through imported aliases", () => {
    const project = inMemoryProject({
      "/src/domain/synthetic.ts":
        "declare const r: any; export const value = r.synthetic.defectCases;",
      "/src/domain/real.ts":
        "declare const r: any; export const value = r.realDerived.defectCases;",
      "/src/domain/blend.ts":
        'import { value as left } from "./synthetic"; import { value as right } from "./real"; export const score = left + right;',
    });
    expect(blendingViolations(project).length).toBeGreaterThan(0);
  });

  it("partition values remain tainted through computed and destructured access", () => {
    const project = inMemoryProject({
      "/src/domain/blend.ts":
        'declare const r: any; const { synthetic: left, realDerived: right } = r; export const score = left.defectCases + r["realDerived"].defectCases + right.cleanControls;',
    });
    expect(blendingViolations(project).length).toBeGreaterThan(0);
  });

  it("partition values remain tainted through constant computed keys", () => {
    const project = inMemoryProject({
      "/src/domain/blend.ts":
        'declare const r: any; const leftKey = "synthetic"; const rightKey = "realDerived"; export const score = r[leftKey].defectCases + r[rightKey].defectCases;',
    });
    expect(blendingViolations(project).length).toBeGreaterThan(0);
  });

  it("partition values remain tainted through assignments", () => {
    const project = inMemoryProject({
      "/src/domain/blend.ts":
        "declare const r: any; let left; let right; left = r.synthetic.defectCases; right = r.realDerived.defectCases; export const score = left + right;",
      "/src/domain/member-blend.ts":
        "declare const r: any; const values: any = {}; values.left = r.synthetic.defectCases; values.right = r.realDerived.defectCases; export const score = values.left + values.right;",
      "/src/domain/assigned-synthetic.ts":
        "declare const r: any; export let value; value = r.synthetic.defectCases;",
      "/src/domain/assigned-real.ts":
        "declare const r: any; export let value; value = r.realDerived.defectCases;",
      "/src/domain/imported-blend.ts":
        'import { value as left } from "./assigned-synthetic"; import { value as right } from "./assigned-real"; export const score = left + right;',
    });
    expect(blendingViolations(project)).toHaveLength(3);
  });

  it("partition values remain tainted through binding patterns and mutation helpers", () => {
    const project = inMemoryProject({
      "/src/domain/destructured-blend.ts":
        "declare const r: any; const [left, right] = [r.synthetic.defectCases, r.realDerived.defectCases]; export const score = left + right;",
      "/src/domain/mutated-blend.ts":
        "declare const r: any; const values: any = {}; Object.assign(values, { left: r.synthetic.defectCases }); Object.assign(values, { right: r.realDerived.defectCases }); export const score = values.left + values.right;",
      "/src/domain/assigned-structure.ts":
        "declare const r: any; let left; let right; [left, right] = [r.synthetic.defectCases, r.realDerived.defectCases]; export const score = left + right;",
    });
    expect(
      new Set(
        blendingViolations(project).map((violation) =>
          violation.replace(/:\d+: combines.*$/, "")
        ),
      ),
    ).toEqual(new Set([
      "/src/domain/destructured-blend.ts",
      "/src/domain/mutated-blend.ts",
      "/src/domain/assigned-structure.ts",
    ]));
  });

  it("partition values remain tainted through container mutations", () => {
    const project = inMemoryProject({
      "/src/domain/mutated-array-blend.ts":
        "declare const r: any; const values: any[] = []; values.push(r.synthetic.defectCases); values.push(r.realDerived.defectCases); export const score = values.reduce((sum, value) => sum + value, 0);",
    });
    expect(blendingViolations(project).length).toBeGreaterThan(0);
  });

  it("member assignment taint stays on the assigned path", () => {
    expect(
      blendingViolations(
        inMemoryProject({
          "/src/domain/synthetic.ts":
            "declare const r: any; const values: any = {}; values.left = r.synthetic.defectCases; export const score = values.right + r.realDerived.defectCases;",
        }),
      ),
    ).toEqual([]);
  });

  it("arithmetic confined to one partition remains legal", () => {
    expect(
      blendingViolations(
        inMemoryProject({
          "/src/domain/synthetic.ts":
            "declare const r: any; export const score = r.synthetic.defectCases + r.synthetic.cleanControls;",
        }),
      ),
    ).toEqual([]);
  });
});
