import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";
import { Project } from "ts-morph";
import { walk, REPO_ROOT, inMemoryProject } from "./_fence-utils";
import { SCENARIOS, FIRMS } from "@app/demo/data";

/**
 * DEMO-SKELETON-HONESTY FENCE (v3 prompt 3 Gate 0: "the UI does not invent
 * decisions"; charter #4/#5, ADR-0027). Two machine-enforced halves:
 *
 *  RULE A - CONTRACT PARITY. The walking skeleton's static branch data
 *    (src/app/demo/data.ts) must state EXACTLY the scenario ids, firm ids, and
 *    dispositions (including per-firm splits) that config/demo/scenarios.yaml
 *    records. A skeleton scenario the contract does not know, a missing contract
 *    branch, or a drifted disposition fails the build - the demo cannot show an
 *    outcome the ratified contract does not state.
 *
 *  RULE B - SURFACE IMPORT BOUNDARY. Surface components (src/app/demo/surfaces/)
 *    render typed view models and NOTHING else: they may import react/next,
 *    presentation primitives, the view-model module, and surface-local siblings.
 *    Importing the contract data, the fake service, or the builders from a surface
 *    is exactly how a component would start recomputing decisions - it fails the
 *    build with file:line.
 *
 * Both detectors are pure functions so the companions can feed violating inputs
 * (charter #4: detection is not verification).
 */

// ── RULE A: contract parity ─────────────────────────────────────────────────────────
interface BranchFacts {
  readonly scenarios: Record<string, { disposition: string; perFirm?: Record<string, string> }>;
  readonly firms: readonly string[];
}

export function skeletonFacts(): BranchFacts {
  const scenarios: BranchFacts["scenarios"] = {};
  for (const s of SCENARIOS) scenarios[s.id] = { disposition: s.disposition, ...(s.perFirm ? { perFirm: s.perFirm } : {}) };
  return { scenarios, firms: Object.keys(FIRMS) };
}

export function contractFacts(yamlText: string): BranchFacts {
  const doc = parseDocument(yamlText).toJS() as {
    scenarios?: { id?: unknown; disposition?: unknown }[];
    firms?: { id?: unknown }[];
  };
  const scenarios: BranchFacts["scenarios"] = {};
  for (const s of doc.scenarios ?? []) {
    const id = String(s.id);
    if (typeof s.disposition === "string") {
      scenarios[id] = { disposition: s.disposition };
    } else if (s.disposition && typeof s.disposition === "object") {
      const perFirm = (s.disposition as { per_firm?: Record<string, string> }).per_firm ?? {};
      // The yaml records the split; the skeleton must carry BOTH the recorded default
      // (its scenarios.yaml `disposition` shape has no default when split) and the map.
      scenarios[id] = { disposition: "(per-firm)", perFirm };
    }
  }
  return { scenarios, firms: (doc.firms ?? []).map((f) => String(f.id)) };
}

export function parityViolations(skeleton: BranchFacts, contract: BranchFacts): string[] {
  const out: string[] = [];
  for (const id of Object.keys(contract.scenarios)) {
    if (!skeleton.scenarios[id]) out.push(`scenario "${id}" is in the contract but missing from the skeleton (data.ts)`);
  }
  for (const [id, s] of Object.entries(skeleton.scenarios)) {
    const c = contract.scenarios[id];
    if (!c) {
      out.push(`scenario "${id}" exists in the skeleton but not in config/demo/scenarios.yaml - the demo may not invent branches`);
      continue;
    }
    if (c.perFirm) {
      for (const [firmId, disp] of Object.entries(c.perFirm)) {
        if (s.perFirm?.[firmId] !== disp) {
          out.push(`scenario "${id}": contract records per-firm ${firmId}=${disp}, skeleton says ${s.perFirm?.[firmId] ?? "(nothing)"}`);
        }
      }
      for (const [firmId, disp] of Object.entries(s.perFirm ?? {})) {
        if (!(firmId in c.perFirm)) {
          out.push(`scenario "${id}": skeleton records per-firm ${firmId}=${disp} that the contract does not state - the UI may not invent decisions`);
        }
      }
    } else {
      if (s.perFirm) {
        out.push(`scenario "${id}": skeleton records a per-firm split but the contract disposition is plain "${c.disposition}" - the UI may not invent decisions`);
      }
      if (s.disposition !== c.disposition) {
        out.push(`scenario "${id}": contract disposition "${c.disposition}", skeleton says "${s.disposition}" - the UI may not invent decisions`);
      }
    }
  }
  for (const f of contract.firms) if (!skeleton.firms.includes(f)) out.push(`firm "${f}" missing from the skeleton`);
  for (const f of skeleton.firms) if (!contract.firms.includes(f)) out.push(`firm "${f}" invented by the skeleton`);
  return out;
}

// ── RULE B: surface import boundary ─────────────────────────────────────────────────
const SURFACES_DIR = "src/app/demo/surfaces";
/** What a surface may import: react/next, presentation primitives, the view-model
 * vocabulary, contract TYPES, and surface-local siblings. Nothing that carries data
 * or builds view models. */
const ALLOWED = [/^react$/, /^next\//, /^@app\/presentation\//, /^\.\.\/model$/, /^@contracts\//, /^\.\//];

export function importBoundaryViolations(files: { path: string; specifiers: { spec: string; line: number }[] }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const { spec, line } of f.specifiers) {
      if (!ALLOWED.some((re) => re.test(spec))) {
        out.push(`${f.path}:${line} :: import "${spec}" - surfaces render view models only (no data, service, or builder imports)`);
      }
    }
  }
  return out;
}

function specifiersOf(project: Project): { path: string; specifiers: { spec: string; line: number }[] }[] {
  return project.getSourceFiles().map((sf) => ({
    path: relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/"),
    specifiers: sf.getImportDeclarations().map((d) => ({
      spec: d.getModuleSpecifierValue(),
      line: d.getStartLineNumber(),
    })),
  }));
}

/** Both .ts and .tsx: a plain-.ts helper in surfaces/ could otherwise import ../data
 * and re-export it to surfaces without the fence ever seeing the file. */
function surfacesProject(dir: string = join(REPO_ROOT, SURFACES_DIR)): Project {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  for (const f of walk(dir, (p) => p.endsWith(".ts") || p.endsWith(".tsx"))) project.addSourceFileAtPath(f);
  return project;
}

const yamlText = readFileSync(join(REPO_ROOT, "config/demo/scenarios.yaml"), "utf8");

describe("demo-skeleton-honesty fence", () => {
  it("RULE A enforces: skeleton branch data equals the contract's scenarios, firms, and dispositions", () => {
    const violations = parityViolations(skeletonFacts(), contractFacts(yamlText));
    expect(violations, `skeleton/contract drift:\n${violations.join("\n")}`).toEqual([]);
  });

  it("RULE A is not vacuous: both sides carry the twelve branches and two firms", () => {
    expect(Object.keys(skeletonFacts().scenarios).length).toBe(12);
    expect(Object.keys(contractFacts(yamlText).scenarios).length).toBe(12);
    expect(skeletonFacts().firms.length).toBe(2);
  });

  it("RULE B enforces: no surface component imports data, the fake service, or builders", () => {
    const files = specifiersOf(surfacesProject());
    expect(files.length, "no surface files found - the fence went stale (charter #4)").toBeGreaterThan(0);
    const violations = importBoundaryViolations(files);
    expect(violations, `surface import-boundary violations:\n${violations.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): drifted or dishonest skeletons CANNOT pass", () => {
    it("RULE A flags a skeleton scenario the contract does not know", () => {
      const skeleton = skeletonFacts();
      const drifted = { ...skeleton, scenarios: { ...skeleton.scenarios, "invented-branch": { disposition: "proceed" } } };
      expect(parityViolations(drifted, contractFacts(yamlText)).some((v) => v.includes(`"invented-branch"`) && v.includes("invent"))).toBe(true);
    });

    it("RULE A flags a missing contract branch", () => {
      const skeleton = skeletonFacts();
      const rest = Object.fromEntries(Object.entries(skeleton.scenarios).filter(([id]) => id !== "delayed-nigo"));
      expect(parityViolations({ ...skeleton, scenarios: rest }, contractFacts(yamlText)).some((v) => v.includes(`"delayed-nigo"`) && v.includes("missing from the skeleton"))).toBe(true);
    });

    it("RULE A flags a drifted disposition (prohibited quietly becoming proceed)", () => {
      const skeleton = skeletonFacts();
      const drifted = { ...skeleton, scenarios: { ...skeleton.scenarios, "permanent-prohibition": { disposition: "proceed" } } };
      expect(parityViolations(drifted, contractFacts(yamlText)).some((v) => v.includes("permanent-prohibition") && v.includes("may not invent"))).toBe(true);
    });

    it("RULE A flags a drifted per-firm split (Firm B's block quietly dropped)", () => {
      const skeleton = skeletonFacts();
      const drifted = {
        ...skeleton,
        scenarios: { ...skeleton.scenarios, "recent-bank-change-block": { disposition: "blocked", perFirm: { "firm-a": "proceed", "firm-b": "proceed" } } },
      };
      expect(parityViolations(drifted, contractFacts(yamlText)).some((v) => v.includes("firm-b=blocked"))).toBe(true);
    });

    it("RULE A flags an invented firm", () => {
      const skeleton = skeletonFacts();
      expect(parityViolations({ ...skeleton, firms: [...skeleton.firms, "firm-c"] }, contractFacts(yamlText)).some((v) => v.includes(`firm "firm-c" invented`))).toBe(true);
    });

    it("RULE A flags a skeleton per-firm split the contract does not record (plain contract disposition)", () => {
      const skeleton = skeletonFacts();
      const invented = {
        ...skeleton,
        scenarios: { ...skeleton.scenarios, "safe-proceed": { disposition: "proceed", perFirm: { "firm-b": "blocked" } } },
      };
      expect(
        parityViolations(invented, contractFacts(yamlText)).some(
          (v) => v.includes(`"safe-proceed"`) && v.includes("per-firm split") && v.includes("may not invent"),
        ),
      ).toBe(true);
    });

    it("RULE A flags a skeleton per-firm entry beyond the contract's recorded split", () => {
      const skeleton = skeletonFacts();
      const extra = {
        ...skeleton,
        scenarios: {
          ...skeleton.scenarios,
          "recent-bank-change-block": { disposition: "blocked", perFirm: { "firm-a": "proceed", "firm-b": "blocked", "firm-c": "proceed" } },
        },
      };
      expect(
        parityViolations(extra, contractFacts(yamlText)).some(
          (v) => v.includes(`"recent-bank-change-block"`) && v.includes("firm-c=proceed") && v.includes("does not state"),
        ),
      ).toBe(true);
    });

    it("RULE B flags a surface importing the contract data (with file:line)", () => {
      const project = inMemoryProject({ "/src/app/demo/surfaces/evil.tsx": `import { SCENARIOS } from "../data";\nexport function Evil() { return SCENARIOS.length; }` });
      const violations = importBoundaryViolations(specifiersOf(project));
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain("evil.tsx:1");
      expect(violations[0]).toContain(`"../data"`);
    });

    it("RULE B flags a surface importing the fake service or a builder", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/evil2.tsx": `import { getJourney } from "../journey";\nimport { buildDisposition } from "../build-decision";\nexport const x = [getJourney, buildDisposition];`,
      });
      expect(importBoundaryViolations(specifiersOf(project)).length).toBe(2);
    });

    it("RULE B's walk sees plain-.ts files too - a .ts helper importing the data is caught on disk", () => {
      const dir = mkdtempSync(join(tmpdir(), "surfaces-fence-"));
      try {
        writeFileSync(join(dir, "evil-helper.ts"), `import { SCENARIOS } from "../data";\nexport const leaked = SCENARIOS;\n`);
        const violations = importBoundaryViolations(specifiersOf(surfacesProject(dir)));
        expect(violations.length).toBe(1);
        expect(violations[0]).toContain("evil-helper.ts:1");
        expect(violations[0]).toContain(`"../data"`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("RULE B passes the allowed imports (react, next, presentation, model, siblings)", () => {
      const project = inMemoryProject({
        "/src/app/demo/surfaces/good.tsx": `import Link from "next/link";\nimport { Metric } from "@app/presentation/metric";\nimport type { WorkspaceVM } from "../model";\nimport { SurfaceShell } from "./shared";\nexport const y = [Link, Metric, SurfaceShell];`,
      });
      expect(importBoundaryViolations(specifiersOf(project))).toEqual([]);
    });
  });
});
