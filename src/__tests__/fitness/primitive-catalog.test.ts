import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { z } from "zod";
import { REPO_ROOT, SRC_ROOT, inMemoryProject, walk } from "./_fence-utils";
import {
  scanDomainVocabulary,
  scanImpurity,
  type ModuleScanViolation,
} from "./_module-scan";
import {
  PRIMITIVE_CATALOG,
  PRIMITIVE_CATALOG_IDS,
  PRIMITIVE_SET_PROVISIONAL,
  PRIMITIVE_SET_VERSION,
} from "@contracts/primitives/catalog";

/**
 * PRIMITIVE-CATALOG FENCE (v3 prompt 8; ADR-0039; charter #1/#4; D-102).
 * Five invariants, each with companions proving the incomplete form CANNOT
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
 *  (e) EVIDENCE-KIND DECLARATIONS - every name in an entry's
 *      evidenceKindParameters is a real parameter of that entry's own schema,
 *      so a rename cannot leave the prompt-9 loader binding a dangling name.
 *  (f) KEY-SHAPING DECLARATIONS - an entry's keyShapingParameters is EXACTLY
 *      the set of parameters its own `publishedKeys` body reads. That
 *      declaration is what the prompt-9 loader refuses `set_parameter` against
 *      (ruling p9-key-shaping-params), so a stale one would silently re-open a
 *      policy write that reshapes the derived context-key vocabulary. Read off
 *      the real function body, never off a second hand-written list.
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
 * Every parameter name a parameter schema can accept, across union arms and
 * through the `.readonly()` wrapper the catalog's schemas carry.
 */
const parameterSchemaKeys = (
  schema: z.ZodType,
  out: Set<string> = new Set(),
): Set<string> => {
  if (schema instanceof z.ZodReadonly) {
    return parameterSchemaKeys(schema.unwrap() as z.ZodType, out);
  }
  if (schema instanceof z.ZodObject) {
    for (const key of Object.keys(schema.shape)) out.add(key);
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options as readonly z.ZodType[]) {
      parameterSchemaKeys(option, out);
    }
  }
  return out;
};

type EvidenceKindEntry = {
  readonly id: string;
  readonly parameterSchema: z.ZodType;
  readonly evidenceKindParameters: readonly string[];
};

/**
 * The evidence-kind declaration check: a parameter NAME that no longer exists
 * on its own schema would still compile and type-check, leaving the prompt-9
 * loader resolving a dangling name at bind time.
 */
export function evidenceKindParameterViolations(
  entries: readonly EvidenceKindEntry[],
): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const keys = parameterSchemaKeys(entry.parameterSchema);
    if (keys.size === 0) {
      out.push(`${entry.id} exposes no parameter names - the schema walk went blind`);
    }
    for (const name of entry.evidenceKindParameters) {
      if (!keys.has(name)) {
        out.push(`${entry.id} declares evidence-kind parameter ${name}, absent from its schema`);
      }
    }
  }
  return out;
}

/**
 * The parameter names one `publishedKeys` arrow function reads, or null when
 * the body cannot be read statically (a destructured or computed access). The
 * walk is deliberately over the SOURCE rather than over sample invocations: a
 * parameter that shapes keys only on some input would slip past a probe, and
 * over-declaring merely narrows what policy may write, which is the safe
 * direction.
 */
function publishedKeyParameterReads(fn: Node): readonly string[] | null {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return null;
  const parameters = fn.getParameters();
  if (parameters.length === 0) return [];
  if (parameters.length > 1) return null;
  const binding = parameters[0]!.getNameNode();
  // A destructured binding hides which names the body reads.
  if (!Node.isIdentifier(binding)) return null;
  const parameterName = binding.getText();
  const body = fn.getBody();
  const reads = new Set<string>();
  let readable = true;
  const visit = (node: Node): void => {
    if (Node.isPropertyAccessExpression(node)) {
      if (node.getExpression().getText() === parameterName) reads.add(node.getName());
      return;
    }
    if (Node.isElementAccessExpression(node)) {
      if (node.getExpression().getText() !== parameterName) return;
      const argument = node.getArgumentExpression();
      if (argument !== undefined && Node.isStringLiteral(argument)) reads.add(argument.getLiteralValue());
      else readable = false;
      return;
    }
    // A bare mention that is not a member read (passing the whole object on)
    // puts every name in play, so the declaration can no longer be proven.
    if (Node.isIdentifier(node) && node.getText() === parameterName) {
      const parent = node.getParent();
      const memberRead =
        (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
        parent.getExpression() === node;
      if (!memberRead) readable = false;
    }
  };
  visit(body);
  body.forEachDescendant(visit);
  return readable ? [...reads].sort() : null;
}

type KeyShapingEntry = {
  readonly id: string;
  readonly keyShapingParameters: readonly string[];
};

/** The key-shaping declaration check, callable with synthetic sources by the companions. */
export function keyShapingDeclarationViolations(
  project: Project,
  declared: readonly KeyShapingEntry[],
): string[] {
  const out: string[] = [];
  const scanned = new Set<string>();
  const byId = new Map(declared.map((entry) => [entry.id, entry.keyShapingParameters]));
  for (const file of project.getSourceFiles()) {
    for (const literal of file.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
      const published = literal.getProperty("publishedKeys");
      const idProperty = literal.getProperty("id");
      if (!Node.isPropertyAssignment(published) || !Node.isPropertyAssignment(idProperty)) continue;
      const idLiteral = idProperty
        .getInitializerOrThrow()
        .getFirstDescendantByKind(SyntaxKind.StringLiteral);
      if (idLiteral === undefined) continue;
      const id = idLiteral.getLiteralValue();
      scanned.add(id);
      const reads = publishedKeyParameterReads(published.getInitializerOrThrow());
      if (reads === null) {
        out.push(`${id}: publishedKeys reads its parameters in a form this fence cannot verify`);
        continue;
      }
      const declaredNames = byId.get(id);
      if (declaredNames === undefined) {
        out.push(`${id}: publishes keys but declares no keyShapingParameters`);
        continue;
      }
      const expected = [...declaredNames].sort().join(",");
      if (reads.join(",") !== expected) {
        out.push(
          `${id}: publishedKeys reads [${reads.join(", ")}] but declares keyShapingParameters [${expected}]`,
        );
      }
    }
  }
  for (const entry of declared) {
    if (!scanned.has(entry.id)) out.push(`${entry.id}: no publishedKeys body was scanned - the walk went blind`);
  }
  return out;
}

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

export type PrimitiveModuleViolation = ModuleScanViolation;

/** The primitives-module vocabulary scan (shared scanner, this fence's paths). */
export function domainVocabularyViolations(project: Project): PrimitiveModuleViolation[] {
  return scanDomainVocabulary(project, isPrimitivesModulePath, isFalsificationProse);
}

/** The primitives-module purity scan (shared scanner, this fence's paths). */
export function impurityViolations(project: Project): PrimitiveModuleViolation[] {
  return scanImpurity(project, isPrimitivesModulePath);
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

  it("enforces: every declared evidence-kind parameter exists on its own schema", () => {
    const violations = evidenceKindParameterViolations(PRIMITIVE_CATALOG);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("enforces: keyShapingParameters is exactly what each publishedKeys body reads", () => {
    const violations = keyShapingDeclarationViolations(project, PRIMITIVE_CATALOG);
    expect(violations, violations.join("\n")).toEqual([]);
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

    it("locale-sensitive members are caught with file:line; codepoint ordering survives", () => {
      const collation = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts":
            `export const order = (a: string, b: string) => a.localeCompare(b);`,
        }),
      );
      expect(collation.map((x) => x.token)).toContain("localeCompare");
      expect(collation[0]).toMatchObject({ line: 1, token: "localeCompare" });
      const formatting = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/evil.ts":
            `export const show = (n: number) => n["toLocaleString"]();`,
        }),
      );
      expect(formatting.map((x) => x.token)).toContain("toLocaleString");
      const codepoint = impurityViolations(
        inMemoryProject({
          "src/contracts/primitives/ok.ts":
            `export const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);`,
        }),
      );
      expect(codepoint).toEqual([]);
    });

    it("a renamed or dangling evidence-kind parameter fails", () => {
      const renamed = evidenceKindParameterViolations([
        {
          id: "net-availability",
          parameterSchema: z.strictObject({ renamedClaimKinds: z.string() }).readonly(),
          evidenceKindParameters: ["claimEvidenceKinds"],
        },
      ]);
      expect(renamed.some((m) => m.includes("claimEvidenceKinds"))).toBe(true);
      // A union arm declaring the name keeps the whole entry legal; an
      // unwalkable schema is refused rather than passing over an empty key set.
      expect(
        evidenceKindParameterViolations([
          {
            id: "two-armed",
            parameterSchema: z.discriminatedUnion("mode", [
              z.strictObject({ mode: z.literal("a"), kindParameter: z.string() }),
              z.strictObject({ mode: z.literal("b") }),
            ]),
            evidenceKindParameters: ["kindParameter"],
          },
        ]),
      ).toEqual([]);
      expect(
        evidenceKindParameterViolations([
          { id: "opaque", parameterSchema: z.string(), evidenceKindParameters: [] },
        ]).some((m) => m.includes("went blind")),
      ).toBe(true);
    });

    it("an under-declared, over-declared, or unreadable key-shaping set fails", () => {
      const source = (body: string) =>
        inMemoryProject({
          "src/contracts/primitives/entry.ts":
            `export const entry = { id: parsePrimitiveId("some-primitive"), publishedKeys: ${body} };`,
        });
      const under = keyShapingDeclarationViolations(
        source("(parameters: P) => ({ [`slot.${parameters.subjectSlot}.outcome`]: d })"),
        [{ id: "some-primitive", keyShapingParameters: [] }],
      );
      expect(under.some((m) => m.includes("reads [subjectSlot]"))).toBe(true);
      const over = keyShapingDeclarationViolations(
        source("(parameters: P) => ({ [`slot.${parameters.subjectSlot}.outcome`]: d })"),
        [{ id: "some-primitive", keyShapingParameters: ["subjectSlot", "tolerance"] }],
      );
      expect(over.some((m) => m.includes("subjectSlot,tolerance"))).toBe(true);
      const exact = keyShapingDeclarationViolations(
        source("(parameters: P) => ({ [`slot.${parameters.subjectSlot}.outcome`]: d })"),
        [{ id: "some-primitive", keyShapingParameters: ["subjectSlot"] }],
      );
      expect(exact).toEqual([]);
    });

    it("a body this fence cannot read statically fails closed rather than passing", () => {
      const cases = [
        "({ subjectSlot }: P) => ({ [`slot.${subjectSlot}.outcome`]: d })",
        "(parameters: P) => ({ [`slot.${parameters[pick()]}.outcome`]: d })",
        "(parameters: P) => keysOf(parameters)",
      ];
      for (const body of cases) {
        const v = keyShapingDeclarationViolations(
          inMemoryProject({
            "src/contracts/primitives/entry.ts":
              `export const entry = { id: parsePrimitiveId("some-primitive"), publishedKeys: ${body} };`,
          }),
          [{ id: "some-primitive", keyShapingParameters: [] }],
        );
        expect(v.some((m) => m.includes("cannot verify")), body).toBe(true);
      }
    });

    it("a primitive whose publishedKeys body vanished fails instead of passing vacuously", () => {
      const v = keyShapingDeclarationViolations(inMemoryProject({}), [
        { id: "some-primitive", keyShapingParameters: [] },
      ]);
      expect(v.some((m) => m.includes("went blind"))).toBe(true);
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
