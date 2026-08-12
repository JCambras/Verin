import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { inMemoryProject, REPO_ROOT, walk } from "./_fence-utils";

/**
 * REGISTER-SORTABILITY FENCE (D-194/D-196, charter #1/#4). `Table` defaults every
 * column to unsortable, so sortability is opted INTO one column literal at a time -
 * which is exactly how a register that carries its meaning in row POSITION acquired
 * sortable headers twice in this branch without anyone re-reading the rule. D-194 states
 * the rule and per-surface unit tests assert it on the surfaces that existed when it was
 * written; neither notices the NEXT caller.
 *
 * What this fence proves structurally: every `src/app` file that declares a sortable
 * column is reviewed here against D-194, and the column the reviewer named as the carrier
 * of recorded order is itself declared, visible, and sortable in the same collection.
 * What it cannot prove is whether that column TRULY reconstructs the recorded order - that
 * is the reviewer's judgement, recorded in the registry below and asserted on the rendered
 * surface by `src/__tests__/unit/order-carrying-registers.test.tsx`. The fence's job is to
 * make the judgement UNSKIPPABLE, so a new sortable register fails the build until someone
 * names its order carrier.
 *
 * Anything it cannot resolve to a literal - a computed `sortable`, a spread column
 * collection, a column whose `id` is not a literal string - fails closed rather than
 * passing as reviewed.
 */
const REVIEWED_SORTABLE_REGISTERS = new Map<string, string>([
  // Compliance registers: the claim is CONTENTS and INTEGRITY, a reader legitimately
  // re-orders by actor or action, and recorded order rides in the visible `#` sequence.
  ["src/app/app/audit/page.tsx", "sequence"],
  ["src/app/app/ledger/page.tsx", "sequence"],
  // A SET of affected cases rather than a causal sequence; the case number carries the
  // authored order (D-196).
  ["src/app/demo/surfaces/policy-authoring.tsx", "case"],
]);

type Sortable = "yes" | "no" | "unproven";

interface DeclaredColumn {
  readonly id: string | null;
  readonly sortable: Sortable;
  readonly node: Node;
}

interface ColumnCollection {
  readonly node: Node;
  readonly columns: readonly DeclaredColumn[];
  readonly spread: boolean;
}

function literalString(node: Node | undefined): string | null {
  if (!node) return null;
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralText() : null;
}

function declaredSortable(object: Node): Sortable | null {
  if (!Node.isObjectLiteralExpression(object)) return null;
  const property = object.getProperty("sortable");
  if (!property) return null;
  if (!Node.isPropertyAssignment(property)) return "unproven";
  const initializer = property.getInitializer();
  if (initializer?.getKind() === SyntaxKind.TrueKeyword) return "yes";
  if (initializer?.getKind() === SyntaxKind.FalseKeyword) return "no";
  return "unproven";
}

function declaredId(object: Node): string | null {
  if (!Node.isObjectLiteralExpression(object)) return null;
  const property = object.getProperty("id");
  return property && Node.isPropertyAssignment(property) ? literalString(property.getInitializer()) : null;
}

/** Every array literal that declares table columns - identified by the `sortable` key. */
function columnCollections(sf: SourceFile): ColumnCollection[] {
  const collections: ColumnCollection[] = [];
  for (const array of sf.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)) {
    const columns: DeclaredColumn[] = [];
    let spread = false;
    for (const element of array.getElements()) {
      if (Node.isSpreadElement(element)) {
        spread = true;
        continue;
      }
      const sortable = declaredSortable(element);
      if (!sortable) continue;
      columns.push({ id: declaredId(element), sortable, node: element });
    }
    if (columns.length > 0) collections.push({ node: array, columns, spread });
  }
  return collections;
}

export function registerSortabilityViolations(
  sf: SourceFile,
  rel: string,
  reviewed: ReadonlyMap<string, string> = REVIEWED_SORTABLE_REGISTERS,
): string[] {
  const out: string[] = [];
  const report = (node: Node, message: string) => out.push(`${rel}:${node.getStartLineNumber()} :: ${message}`);

  for (const collection of columnCollections(sf)) {
    for (const column of collection.columns) {
      if (column.sortable === "unproven") {
        report(column.node, "'sortable' is not a literal, so this register's sortability cannot be reviewed (D-194)");
      }
    }
    const sortable = collection.columns.filter((column) => column.sortable === "yes");
    if (sortable.length === 0) continue;

    for (const column of sortable) {
      if (column.id === null) {
        report(column.node, "a sortable column whose 'id' is not a literal cannot be proven to carry recorded order");
      }
    }

    const orderColumn = reviewed.get(rel);
    if (orderColumn === undefined) {
      report(
        collection.node,
        "sortable register is not reviewed against D-194 - register it with the visible column that carries recorded order",
      );
      continue;
    }
    if (collection.spread) {
      report(
        collection.node,
        `column collection is spread from an unresolved source, so the visible '${orderColumn}' column cannot be proven`,
      );
      continue;
    }
    if (!sortable.some((column) => column.id === orderColumn)) {
      report(
        collection.node,
        `recorded order is not reconstructible: no visible sortable '${orderColumn}' column (D-194 condition 1)`,
      );
    }
  }
  return [...new Set(out)];
}

/** A registry entry pointing at a file that no longer sorts reviews nothing. */
export function staleSortableRegisters(sortableFiles: Iterable<string>): string[] {
  const present = new Set(sortableFiles);
  return [...REVIEWED_SORTABLE_REGISTERS.keys()]
    .filter((rel) => !present.has(rel))
    .map((rel) => `${rel}:1 :: reviewed sortable register declares no sortable column in the scanned tree`);
}

function appProject(): Project {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  for (const file of walk(`${REPO_ROOT}src/app`, (candidate) => candidate.endsWith(".tsx") || candidate.endsWith(".ts"))) {
    project.addSourceFileAtPath(file);
  }
  return project;
}

function relativeTo(sf: SourceFile): string {
  return relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
}

describe("register-sortability fence", () => {
  const project = appProject();
  const sortableFiles = project
    .getSourceFiles()
    .filter((sf) =>
      columnCollections(sf).some((collection) => collection.columns.some((column) => column.sortable === "yes")),
    )
    .map(relativeTo);

  it("enforces: every sortable register names the visible column that carries its recorded order", () => {
    const offenders: string[] = [];
    for (const sf of project.getSourceFiles()) offenders.push(...registerSortabilityViolations(sf, relativeTo(sf)));
    expect(offenders, `unreviewed register sortability:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("staleness guard: every reviewed sortable register still declares sortable columns", () => {
    const stale = staleSortableRegisters(sortableFiles);
    expect(stale, `reviewed sortable registers that review nothing:\n${stale.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): the real check rejects an unreviewed or unproven register", () => {
    function source(text: string, path = "/src/app/example/page.tsx"): SourceFile {
      return inMemoryProject({ [path]: text }).getSourceFiles()[0]!;
    }

    const COLUMNS = (extra: string) =>
      `const C = [${extra}{ id: "when", header: "When", sortable: true }]; export default function P(){ return C.length; }`;

    it("rejects a sortable register that was never reviewed", () => {
      const found = registerSortabilityViolations(source(COLUMNS("")), "src/app/example/page.tsx");
      expect(found).toEqual([
        expect.stringContaining("src/app/example/page.tsx:1 :: sortable register is not reviewed against D-194"),
      ]);
    });

    it("rejects a reviewed register whose order column is missing or unsortable", () => {
      const reviewed = new Map([["src/app/example/page.tsx", "sequence"]]);
      const missing = registerSortabilityViolations(source(COLUMNS("")), "src/app/example/page.tsx", reviewed);
      expect(missing).toEqual([expect.stringContaining("no visible sortable 'sequence' column")]);

      const unsortable = registerSortabilityViolations(
        source(COLUMNS('{ id: "sequence", header: "#" }, ')),
        "src/app/example/page.tsx",
        reviewed,
      );
      expect(unsortable).toEqual([expect.stringContaining("no visible sortable 'sequence' column")]);
    });

    it("accepts a reviewed register whose order column is visible and sortable", () => {
      const found = registerSortabilityViolations(
        source(COLUMNS('{ id: "sequence", header: "#", sortable: true }, ')),
        "src/app/example/page.tsx",
        new Map([["src/app/example/page.tsx", "sequence"]]),
      );
      expect(found).toEqual([]);
    });

    it("accepts an unsortable register with no review at all", () => {
      const found = registerSortabilityViolations(
        source('const C = [{ id: "step", header: "Step" }, { id: "when", header: "When", sortable: false }]; export default function P(){ return C.length; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([]);
    });

    it("fails closed on a computed sortable flag", () => {
      const found = registerSortabilityViolations(
        source('const on = true; const C = [{ id: "when", header: "When", sortable: on }]; export default function P(){ return C.length; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([expect.stringContaining("'sortable' is not a literal")]);
    });

    it("fails closed on a spread column collection and on a computed column id", () => {
      const reviewed = new Map([["src/app/example/page.tsx", "sequence"]]);
      const spread = registerSortabilityViolations(
        source('const base: unknown[] = []; const C = [...base, { id: "when", header: "When", sortable: true }]; export default function P(){ return C.length; }'),
        "src/app/example/page.tsx",
        reviewed,
      );
      expect(spread).toEqual([expect.stringContaining("column collection is spread from an unresolved source")]);

      const computed = registerSortabilityViolations(
        source('const key = "when"; const C = [{ id: key, header: "When", sortable: true }]; export default function P(){ return C.length; }'),
        "src/app/example/page.tsx",
        reviewed,
      );
      expect(computed.some((entry) => entry.includes("is not a literal cannot be proven"))).toBe(true);
    });

    it("the staleness guard reports a registry entry that stopped sorting, and cannot pass vacuously", () => {
      expect(staleSortableRegisters(sortableFiles)).toEqual([]);
      expect(staleSortableRegisters(sortableFiles.filter((rel) => rel !== "src/app/app/audit/page.tsx"))).toEqual([
        "src/app/app/audit/page.tsx:1 :: reviewed sortable register declares no sortable column in the scanned tree",
      ]);
      expect(staleSortableRegisters([])).toHaveLength(REVIEWED_SORTABLE_REGISTERS.size);
    });

    it("scans the real tree, so the enforce test is not asserting on an empty walk", () => {
      expect(sortableFiles.sort()).toEqual([...REVIEWED_SORTABLE_REGISTERS.keys()].sort());
    });
  });
});
