import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Node, Project, SyntaxKind, ts } from "ts-morph";
import { z } from "zod";
import { REPO_ROOT, SRC_ROOT, inMemoryProject, walk } from "./_fence-utils";
import {
  PRIMITIVE_CATALOG,
  PRIMITIVE_CATALOG_IDS,
  PRIMITIVE_SET_PROVISIONAL,
  PRIMITIVE_SET_VERSION,
} from "@contracts/primitives/catalog";

/**
 * PRIMITIVE-CATALOG FENCE (v3 prompt 8; ADR-0039; charter #1/#4; D-102).
 * Four invariants, each with companions proving the incomplete form CANNOT
 * pass:
 *  (a) REGISTRY INTEGRITY - primitive-set-version.json and the catalog agree
 *      in both directions (ids, canonical order, version, provisional flag),
 *      the set stays under fifteen, and declared future primitives never
 *      collide with shipped ids. The registry can never claim a vocabulary
 *      the code does not ship.
 *  (b) DOC SYNC - docs/primitive-rationale.md carries a rationale section and
 *      a domain-matrix row for every primitive, and names no phantom
 *      primitive the catalog does not ship.
 *  (c) DOMAIN NEUTRALITY - no domain vocabulary in the primitives module's
 *      identifiers or non-prose string literals (ids, published keys, codes,
 *      strategy names). Falsification prose (operatingCase/falsifiedResponse)
 *      is the ONE exemption: the prompt REQUIRES it to name real operating
 *      cases. Domain words belong in config and fixture vocabulary only.
 *  (d) PURITY - the primitives module never references a clock, randomness,
 *      tz/locale machinery, or scheduling globals: primitive evaluation must
 *      be a pure function of its parsed input, or byte-identical replay dies.
 */

const PRIMITIVES_DIR_SEGMENT = "src/contracts/primitives";

const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const RegistrySchema = z.strictObject({
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver"),
  provisional: z.boolean(),
  primitives: z.array(z.string().regex(kebab, "kebab-case id")).min(1).readonly(),
  declaredFuturePrimitives: z
    .array(
      z.strictObject({ id: z.string().regex(kebab, "kebab-case id"), activatedBy: z.string().min(1) }),
    )
    .readonly(),
});

/** The registry check, callable with synthetic registries by the companions. */
export function primitiveRegistryViolations(registryRaw: unknown): string[] {
  const parsed = RegistrySchema.safeParse(registryRaw);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `registry malformed at ${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
  }
  const registry = parsed.data;
  const out: string[] = [];
  const catalogIds = [...PRIMITIVE_CATALOG_IDS] as string[];
  if (registry.version !== PRIMITIVE_SET_VERSION) {
    out.push(`registry version ${registry.version} != catalog PRIMITIVE_SET_VERSION ${PRIMITIVE_SET_VERSION}`);
  }
  if (registry.provisional !== PRIMITIVE_SET_PROVISIONAL) {
    out.push(`registry provisional ${registry.provisional} != catalog ${PRIMITIVE_SET_PROVISIONAL}`);
  }
  if (catalogIds.length >= 15) {
    out.push(`catalog has ${catalogIds.length} primitives - the ratified target is under fifteen`);
  }
  for (const id of catalogIds) {
    if (!registry.primitives.includes(id)) out.push(`catalog id ${id} missing from registry`);
  }
  for (const id of registry.primitives) {
    if (!catalogIds.includes(id)) out.push(`registry id ${id} has no catalog entry`);
  }
  const sorted = [...registry.primitives].sort();
  if (registry.primitives.join("\n") !== sorted.join("\n")) {
    out.push("registry primitives are not in canonical (sorted) order");
  }
  if (new Set(registry.primitives).size !== registry.primitives.length) {
    out.push("registry primitives contain duplicates");
  }
  for (const future of registry.declaredFuturePrimitives) {
    if (catalogIds.includes(future.id)) {
      out.push(`declared future primitive ${future.id} already ships in the catalog`);
    }
  }
  return out;
}

/** The doc-sync check, callable with synthetic docs by the companions. */
export function rationaleDocViolations(doc: string, ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (!doc.includes(`### \`${id}\``)) out.push(`doc is missing the rationale section for ${id}`);
    if (!doc.includes(`| \`${id}\``)) out.push(`doc is missing the domain-matrix row for ${id}`);
  }
  for (const match of doc.matchAll(/^### `([a-z0-9-]+)`$/gm)) {
    const heading = match[1]!;
    if (!ids.includes(heading)) out.push(`doc documents phantom primitive ${heading}`);
  }
  if (!doc.includes(PRIMITIVE_SET_VERSION)) out.push("doc does not state the set version");
  if (!doc.toLowerCase().includes("provisional")) out.push("doc does not state the vocabulary is provisional");
  return out;
}

/**
 * Domain vocabulary that must never name a primitive, parameter, published
 * key, strategy, or code. Tokens are matched whole-word after camelCase,
 * kebab-case, snake_case, and prose splitting, so `moneyMovementReserve` and
 * "wire-transfer" both hit. Platform tenancy vocabulary (household, firm,
 * instruction, regulatory) is deliberately NOT here - those are the governed
 * planes themselves, not decision domains.
 */
const DOMAIN_TOKENS = new Set([
  "money", "movement", "wire", "ach", "payment", "remittance",
  "opening", "onboarding", "enrollment",
  "trading", "trade", "rebalance", "rebalancing", "portfolio",
  "death", "divorce", "inheritance", "retirement",
  "withdrawal", "withdrawals", "distribution", "distributions", "deposit",
  "ira", "rmd", "401k", "custodian", "salesforce",
  "smith", "smiths", "beneficiary",
  "tax", "taxable", "cash", "liquidity", "reserve", "brokerage",
  "advisor", "bank", "banking", "margin", "overdraft",
]);

const tokenize = (text: string): string[] =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());

const isPrimitivesModulePath = (path: string): boolean =>
  path.replace(/\\/g, "/").includes(PRIMITIVES_DIR_SEGMENT);

/** Falsification prose is REQUIRED to name real (domain) operating cases. */
const isFalsificationProse = (node: Node): boolean => {
  for (let current = node.getParent(); current; current = current.getParent()) {
    if (Node.isPropertyAssignment(current)) {
      const name = current.getName();
      if (name === "operatingCase" || name === "falsifiedResponse") return true;
    }
  }
  return false;
};

const LITERAL_KINDS = new Set<SyntaxKind>([
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
]);

export interface PrimitiveModuleViolation {
  readonly file: string;
  readonly line: number;
  readonly token: string;
}

export function domainVocabularyViolations(project: Project): PrimitiveModuleViolation[] {
  const out: PrimitiveModuleViolation[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const file = sourceFile.getFilePath();
    if (!isPrimitivesModulePath(file)) continue;
    sourceFile.forEachDescendant((node) => {
      let text: string | null = null;
      if (Node.isIdentifier(node)) {
        text = node.getText();
      } else if (LITERAL_KINDS.has(node.getKind()) && !isFalsificationProse(node)) {
        text = (node.compilerNode as ts.LiteralLikeNode).text;
      }
      if (text === null) return;
      for (const token of tokenize(text)) {
        if (DOMAIN_TOKENS.has(token)) {
          out.push({ file, line: node.getStartLineNumber(), token });
        }
      }
    });
  }
  return out;
}

/** Math members a pure integer evaluator may use; everything else is refused. */
const PURE_MATH_MEMBERS = new Set(["abs", "max", "min", "floor", "ceil", "trunc", "sign"]);

const IMPURE_GLOBALS = new Set([
  "Date", "Intl", "performance", "crypto", "setTimeout", "setInterval",
  "setImmediate", "queueMicrotask", "globalThis", "process", "fetch",
]);

export function impurityViolations(project: Project): PrimitiveModuleViolation[] {
  const out: PrimitiveModuleViolation[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const file = sourceFile.getFilePath();
    if (!isPrimitivesModulePath(file)) continue;
    sourceFile.forEachDescendant((node) => {
      if (!Node.isIdentifier(node)) return;
      const name = node.getText();
      if (IMPURE_GLOBALS.has(name)) {
        out.push({ file, line: node.getStartLineNumber(), token: name });
        return;
      }
      if (name !== "Math") return;
      const parent = node.getParent();
      if (
        Node.isPropertyAccessExpression(parent) &&
        parent.getExpression() === node &&
        PURE_MATH_MEMBERS.has(parent.getName())
      ) {
        return;
      }
      // Bare Math references, element access, and every non-allowlisted member
      // (random above all) fail closed.
      out.push({ file, line: node.getStartLineNumber(), token: `Math (${parent?.getKindName() ?? "bare"})` });
    });
  }
  return out;
}

const EXPECTED_MODULE_FILES = ["catalog.ts", "quantity.ts", "screening.ts", "selection.ts", "values.ts"];

function primitivesProject(): Project {
  const project = new Project({
    tsConfigFilePath: join(REPO_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  for (const file of walk(join(SRC_ROOT, "contracts", "primitives"), (f) => f.endsWith(".ts"))) {
    project.addSourceFileAtPath(file);
  }
  return project;
}

const formatViolations = (violations: readonly PrimitiveModuleViolation[]): string =>
  violations.map((v) => `${v.file}:${v.line}: ${v.token}`).join("\n");

describe("primitive-catalog fence", () => {
  const registry: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, "primitive-set-version.json"), "utf8"),
  );
  const rationaleDoc = readFileSync(join(REPO_ROOT, "docs", "primitive-rationale.md"), "utf8");
  const project = primitivesProject();

  it("enforces: the version registry mirrors the shipped catalog exactly", () => {
    const violations = primitiveRegistryViolations(registry);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("enforces: the rationale doc covers every primitive and no phantom", () => {
    const violations = rationaleDocViolations(rationaleDoc, PRIMITIVE_CATALOG_IDS);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("enforces: the primitives module is domain-neutral", () => {
    const violations = domainVocabularyViolations(project);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("enforces: the primitives module is pure (no clock, randomness, tz, or scheduling)", () => {
    const violations = impurityViolations(project);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("enforces: the scanned module is the real one, not a stale path (charter #4)", () => {
    // A renamed directory would make both scans pass vacuously over zero files.
    const files = project.getSourceFiles().map((f) => f.getBaseName()).sort();
    expect(files).toEqual(EXPECTED_MODULE_FILES);
    // Every catalog entry must publish keys and carry falsification metadata -
    // an empty catalog import would also pass the scans vacuously.
    expect(PRIMITIVE_CATALOG.length).toBeGreaterThan(0);
  });

  describe("detects (companion): incomplete or dishonest work CANNOT pass", () => {
    const validRegistry = {
      description: "x",
      version: PRIMITIVE_SET_VERSION,
      provisional: true,
      primitives: [...PRIMITIVE_CATALOG_IDS],
      declaredFuturePrimitives: [{ id: "deviation-from-target", activatedBy: "y" }],
    };

    it("a registry missing a shipped primitive fails", () => {
      const v = primitiveRegistryViolations({
        ...validRegistry,
        primitives: validRegistry.primitives.filter((id) => id !== "net-availability"),
      });
      expect(v.some((m) => m.includes("net-availability missing from registry"))).toBe(true);
    });

    it("a registry claiming an unshipped primitive fails", () => {
      const v = primitiveRegistryViolations({
        ...validRegistry,
        primitives: [...validRegistry.primitives, "deadline-feasibility"].sort(),
      });
      expect(v.some((m) => m.includes("deadline-feasibility has no catalog entry"))).toBe(true);
    });

    it("a version mismatch, a dropped provisional flag, and unsorted order all fail", () => {
      expect(
        primitiveRegistryViolations({ ...validRegistry, version: "9.9.9" }).some((m) =>
          m.includes("9.9.9"),
        ),
      ).toBe(true);
      expect(
        primitiveRegistryViolations({ ...validRegistry, provisional: false }).some((m) =>
          m.includes("provisional"),
        ),
      ).toBe(true);
      expect(
        primitiveRegistryViolations({
          ...validRegistry,
          primitives: [...validRegistry.primitives].reverse(),
        }).some((m) => m.includes("canonical")),
      ).toBe(true);
    });

    it("a malformed registry and a future primitive colliding with a shipped id fail", () => {
      expect(
        primitiveRegistryViolations({ ...validRegistry, primitives: "net-availability" }).length,
      ).toBeGreaterThan(0);
      expect(
        primitiveRegistryViolations({
          ...validRegistry,
          declaredFuturePrimitives: [{ id: "net-availability", activatedBy: "y" }],
        }).some((m) => m.includes("already ships")),
      ).toBe(true);
    });

    it("the current real registry passes (the companion is not asserting on a broken baseline)", () => {
      expect(primitiveRegistryViolations(registry)).toEqual([]);
    });

    it("a doc missing a section, missing a matrix row, or naming a phantom fails", () => {
      const missingSection = rationaleDoc.replace("### `net-availability`", "### `renamed`");
      const v1 = rationaleDocViolations(missingSection, PRIMITIVE_CATALOG_IDS);
      expect(v1.some((m) => m.includes("missing the rationale section for net-availability"))).toBe(true);
      expect(v1.some((m) => m.includes("phantom primitive renamed"))).toBe(true);
      const missingRow = rationaleDoc.replace("| `horizon-projection`", "| horizon-projection");
      expect(
        rationaleDocViolations(missingRow, PRIMITIVE_CATALOG_IDS).some((m) =>
          m.includes("matrix row for horizon-projection"),
        ),
      ).toBe(true);
    });

    it("a domain-named identifier is caught with file:line", () => {
      const v = domainVocabularyViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts": `export const moneyMovementReserveFloor = 1;`,
        }),
      );
      expect(v).toHaveLength(3);
      expect(v[0]).toMatchObject({ line: 1, token: "money" });
      expect(v.map((x) => x.token)).toEqual(["money", "movement", "reserve"]);
    });

    it("a domain-named published key or code string is caught", () => {
      const v = domainVocabularyViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts": `export const key = "availability.claims.wire-transfer";`,
        }),
      );
      expect(v.map((x) => x.token)).toContain("wire");
    });

    it("a domain-named template segment is caught", () => {
      const v = domainVocabularyViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts":
            "export const key = (kind: string) => `withdrawal.claims.${kind}.taxable`;",
        }),
      );
      expect(v.map((x) => x.token)).toEqual(expect.arrayContaining(["withdrawal", "taxable"]));
    });

    it("falsification prose may name real operating cases; the same word elsewhere fails", () => {
      const prose = domainVocabularyViolations(
        inMemoryProject({
          "src/contracts/primitives/ok.ts":
            `export const falsification = { operatingCase: "a real margin overdraft trading case", falsifiedResponse: "activate deviation-from-target at the trading wave" };`,
        }),
      );
      expect(prose).toEqual([]);
      const elsewhere = domainVocabularyViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts": `export const summary = { text: "nets margin claims" };`,
        }),
      );
      expect(elsewhere.map((x) => x.token)).toContain("margin");
    });

    it("files outside the primitives module are not this fence's business", () => {
      const v = domainVocabularyViolations(
        inMemoryProject({
          "src/domain/other.ts": `export const moneyMovement = 1;`,
        }),
      );
      expect(v).toEqual([]);
    });

    it("a clock read, randomness, and tz machinery are caught; pure Math survives", () => {
      const clock = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts": `export const now = Date.now();`,
        }),
      );
      expect(clock.map((x) => x.token)).toContain("Date");
      const random = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts": `export const roll = Math.random();`,
        }),
      );
      expect(random.some((x) => x.token.startsWith("Math"))).toBe(true);
      const intl = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts":
            `export const fmt = new Intl.DateTimeFormat("en-US");`,
        }),
      );
      expect(intl.map((x) => x.token)).toContain("Intl");
      const pure = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/ok.ts":
            `export const clamp = (v: number) => Math.max(0, Math.min(10, Math.abs(v)));`,
        }),
      );
      expect(pure).toEqual([]);
    });

    it("aliased and element-access Math escapes fail closed", () => {
      const aliased = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts": `const m = Math;\nexport const roll = m.random();`,
        }),
      );
      expect(aliased.length).toBeGreaterThan(0);
      const element = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts": `export const roll = Math["random"]();`,
        }),
      );
      expect(element.length).toBeGreaterThan(0);
    });
  });
});
