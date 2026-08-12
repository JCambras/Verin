import { describe, expect, it } from "vitest";
import {
  Node,
  SyntaxKind,
  type ArrayLiteralExpression,
  type JsxOpeningElement,
  type JsxSelfClosingElement,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import { appSourceProject, inMemoryProject, relativeToRepo } from "./_fence-utils";

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
 * A column collection is recognized THREE ways, so sortability cannot hide behind
 * indirection: an array literal holding a column that declares `sortable`, an array
 * annotated `TableColumn[]`, and whatever a `<Table columns={...}>` attribute names. A
 * collection found only by the first test is what let `[{ ...SHARED_SORTABLE, id: "when" }]`
 * ship a fully sortable register the fence never saw - the literal declares no `sortable`
 * of its own, so nothing identified it as a column at all.
 *
 * Spreads are RESOLVED or REFUSED, never assumed harmless. An `...IDENT` naming a literal
 * declared exactly once in the same file is inlined and reviewed like any other column;
 * anything else - an import, a shadowed name, a call, a spread deeper than the depth cap -
 * is refused with `file:line`. That is deliberately independent of where the source lives:
 * a shared column definition outside `src/app` is exactly the case the fence cannot read,
 * so it is the case it must not wave through.
 *
 * Anything else it cannot resolve to a literal - a computed `sortable`, a column whose
 * `id` is not a literal string, an unresolvable `columns` attribute, or a column literal
 * built anywhere OTHER than inside a column collection (`BASE.map((c) => ({ ...c,
 * sortable: true }))` has no sibling collection to prove an order carrier against) -
 * fails closed rather than passing as reviewed.
 *
 * A sortable register also declares its landmark's NAME (D-201). `regionName` defaults to
 * the caption, which is right for a register whose rows cannot move - and wrong for one
 * whose rows can: both compliance registers were captioned "…entries, newest first", so
 * the landmark went on promising newest-first in the rotor and on every entry over rows a
 * reader had since ordered by actor, while the caption underneath correctly said
 * otherwise. A name is a label; where the rows are sortable it is the caller who must
 * choose one, and a literal is what makes that choice reviewable here.
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
  /** An element - or a spread source - this fence could not resolve to a column literal. */
  readonly spread: boolean;
}

/** A spread chain deeper than this is refused rather than followed indefinitely. */
const MAX_SPREAD_DEPTH = 4;

function literalString(node: Node | undefined): string | null {
  if (!node) return null;
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralText() : null;
}

function unwrapExpression(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current &&
    (Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isParenthesizedExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

/**
 * The object or array literal an expression names, or nothing. An identifier resolves
 * only when the file declares that name EXACTLY once: a second declaration means the
 * name could be shadowed, and a fence that guesses which one a spread meant is a fence
 * that can be wrong silently.
 */
function resolveLiteral(expression: Node | undefined): Node | undefined {
  const direct = unwrapExpression(expression);
  if (!direct) return undefined;
  if (Node.isObjectLiteralExpression(direct) || Node.isArrayLiteralExpression(direct)) return direct;
  if (!Node.isIdentifier(direct)) return undefined;
  const declarations = direct
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((declaration) => declaration.getName() === direct.getText());
  if (declarations.length !== 1) return undefined;
  const initializer = unwrapExpression(declarations[0]!.getInitializer());
  return initializer && (Node.isObjectLiteralExpression(initializer) || Node.isArrayLiteralExpression(initializer))
    ? initializer
    : undefined;
}

interface PropertyLookup {
  readonly value: Node | undefined;
  readonly unresolved: boolean;
}

/**
 * What a property finally holds, spreads included and in source order, so the LAST
 * writer wins exactly as it does at runtime: `{ ...UNKNOWN, sortable: false }` is proven
 * unsortable, while `{ sortable: false, ...UNKNOWN }` is not.
 */
function objectProperty(object: ObjectLiteralExpression, name: string, depth: number): PropertyLookup {
  let value: Node | undefined;
  let unresolved = false;
  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const source = depth < MAX_SPREAD_DEPTH ? resolveLiteral(property.getExpression()) : undefined;
      if (!source || !Node.isObjectLiteralExpression(source)) {
        value = undefined;
        unresolved = true;
        continue;
      }
      const inherited = objectProperty(source, name, depth + 1);
      if (inherited.unresolved) {
        value = undefined;
        unresolved = true;
      } else if (inherited.value !== undefined) {
        value = inherited.value;
        unresolved = false;
      }
      continue;
    }
    if (Node.isPropertyAssignment(property)) {
      if (property.getName() !== name) continue;
      value = property.getInitializer();
      unresolved = false;
      continue;
    }
    if (Node.hasName(property) && property.getName() === name) {
      value = undefined;
      unresolved = true;
    }
  }
  return { value, unresolved };
}

function declaredSortable(object: ObjectLiteralExpression): Sortable | null {
  const { value, unresolved } = objectProperty(object, "sortable", 0);
  if (value?.getKind() === SyntaxKind.TrueKeyword) return "yes";
  if (value?.getKind() === SyntaxKind.FalseKeyword) return "no";
  if (unresolved || value !== undefined) return "unproven";
  return null;
}

function declaredId(object: ObjectLiteralExpression): string | null {
  return literalString(objectProperty(object, "id", 0).value ?? undefined);
}

/** Whether an array literal holds a column that says anything about sortability at all. */
function holdsColumnLiteral(array: ArrayLiteralExpression): boolean {
  return array.getElements().some((element) => {
    const object = unwrapExpression(element);
    return object !== undefined && Node.isObjectLiteralExpression(object) && object.getProperty("sortable") !== undefined;
  });
}

/** Whether an array literal is DECLARED to be columns, however its elements are built. */
function annotatedAsColumns(array: ArrayLiteralExpression): boolean {
  let current: Node | undefined = array.getParent();
  while (current) {
    if (Node.isAsExpression(current) || Node.isSatisfiesExpression(current)) {
      if (current.getTypeNode()?.getText().includes("TableColumn")) return true;
      current = current.getParent();
      continue;
    }
    if (Node.isParenthesizedExpression(current)) {
      current = current.getParent();
      continue;
    }
    return Node.isVariableDeclaration(current)
      ? (current.getTypeNode()?.getText().includes("TableColumn") ?? false)
      : false;
  }
  return false;
}

/** The string an expression finally is, or nothing - an identifier only when unshadowed. */
function resolvedString(expression: Node | undefined): string | null {
  const direct = unwrapExpression(expression);
  if (!direct) return null;
  const literal = literalString(direct);
  if (literal !== null) return literal;
  if (!Node.isIdentifier(direct)) return null;
  const declarations = direct
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((declaration) => declaration.getName() === direct.getText());
  return declarations.length === 1 ? literalString(unwrapExpression(declarations[0]!.getInitializer())) : null;
}

/**
 * The landmark name a `<Table>` declares, or nothing. A spread attribute makes the whole
 * element unreadable: `{...props}` could carry a `regionName` or could not, and a fence
 * that assumes which is a fence that is silently wrong.
 */
function declaredRegionName(owner: JsxOpeningElement | JsxSelfClosingElement): string | null {
  let name: string | null = null;
  for (const attribute of owner.getAttributes()) {
    if (Node.isJsxSpreadAttribute(attribute)) return null;
    if (!Node.isJsxAttribute(attribute) || attribute.getNameNode().getText() !== "regionName") continue;
    const initializer = attribute.getInitializer();
    const expression = initializer && Node.isJsxExpression(initializer) ? initializer.getExpression() : initializer;
    name = resolvedString(expression);
  }
  return name !== null && name.trim().length > 0 ? name : null;
}

interface TableElement {
  readonly attribute: Node;
  readonly owner: JsxOpeningElement | JsxSelfClosingElement;
  readonly array: ArrayLiteralExpression | null;
}

/** Every `<Table columns={...}>` in the file, paired with the array literal it names. */
function tableColumnAttributes(sf: SourceFile): TableElement[] {
  const out: TableElement[] = [];
  for (const attribute of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (attribute.getNameNode().getText() !== "columns") continue;
    const owner = attribute.getFirstAncestor(
      (node) => Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node),
    );
    if (!owner || !(Node.isJsxOpeningElement(owner) || Node.isJsxSelfClosingElement(owner))) continue;
    if (owner.getTagNameNode().getText() !== "Table") continue;
    const initializer = attribute.getInitializer();
    const expression = initializer && Node.isJsxExpression(initializer) ? initializer.getExpression() : undefined;
    const resolved = resolveLiteral(expression);
    out.push({ attribute, owner, array: resolved && Node.isArrayLiteralExpression(resolved) ? resolved : null });
  }
  return out;
}

interface CollectionScan {
  readonly columns: DeclaredColumn[];
  readonly unresolved: boolean;
}

/** The columns an array literal finally holds, following resolvable spread sources. */
function collectionColumns(
  array: ArrayLiteralExpression,
  depth: number,
  fragments: Set<ArrayLiteralExpression>,
): CollectionScan {
  const columns: DeclaredColumn[] = [];
  let unresolved = false;
  for (const element of array.getElements()) {
    if (Node.isSpreadElement(element)) {
      const source = depth < MAX_SPREAD_DEPTH ? resolveLiteral(element.getExpression()) : undefined;
      if (!source || !Node.isArrayLiteralExpression(source) || fragments.has(source)) {
        unresolved = true;
        continue;
      }
      fragments.add(source);
      const inner = collectionColumns(source, depth + 1, fragments);
      columns.push(...inner.columns);
      unresolved = unresolved || inner.unresolved;
      continue;
    }
    const object = unwrapExpression(element);
    if (!object || !Node.isObjectLiteralExpression(object)) {
      unresolved = true;
      continue;
    }
    const sortable = declaredSortable(object);
    if (sortable === null) continue;
    columns.push({ id: declaredId(object), sortable, node: object });
  }
  return { columns, unresolved };
}

/**
 * Every literal a spread in this file names. Such a literal is a shared FRAGMENT, read
 * through the collections that spread it, so it is not also a homeless column of its own.
 */
function spreadSources(sf: SourceFile): Set<Node> {
  const out = new Set<Node>();
  const queue: Node[] = [
    ...sf.getDescendantsOfKind(SyntaxKind.SpreadAssignment),
    ...sf.getDescendantsOfKind(SyntaxKind.SpreadElement),
  ];
  for (const spread of queue) {
    const resolved = Node.isSpreadAssignment(spread) || Node.isSpreadElement(spread)
      ? resolveLiteral(spread.getExpression())
      : undefined;
    if (!resolved || out.has(resolved)) continue;
    out.add(resolved);
    queue.push(
      ...resolved.getDescendantsOfKind(SyntaxKind.SpreadAssignment),
      ...resolved.getDescendantsOfKind(SyntaxKind.SpreadElement),
    );
  }
  return out;
}

interface ColumnScan {
  /** Every resolved column collection in the file, each with the columns it finally holds. */
  readonly collections: readonly ColumnCollection[];
  /** Column literals built anywhere else - a `.map` callback, a conditional arm, a helper. */
  readonly derived: readonly DeclaredColumn[];
  /** `<Table columns={...}>` attributes naming nothing this fence can read. */
  readonly unreadableTables: readonly Node[];
  /** Sortable registers rendered in this file whose landmark name is not a literal. */
  readonly unnamedSortableTables: readonly Node[];
}

/**
 * Every column collection in the file and every column literal that belongs to none.
 * A column inside a collection can be proven against its siblings - which is what an
 * order carrier is proven against. One built anywhere else has no siblings, so it is
 * returned separately and refused; scanning only array elements that declared `sortable`
 * themselves is what let a transform-produced and then a spread-inherited sortable
 * register pass as unseen rather than as unreviewed.
 */
function scanColumns(sf: SourceFile): ColumnScan {
  const fragments = new Set<ArrayLiteralExpression>();
  const roots = new Set<ArrayLiteralExpression>();
  const unreadableTables: Node[] = [];
  const unnamedSortableTables: Node[] = [];
  const tables = tableColumnAttributes(sf);
  for (const { attribute, array } of tables) {
    if (array) roots.add(array);
    else unreadableTables.push(attribute);
  }
  for (const array of sf.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)) {
    if (holdsColumnLiteral(array) || annotatedAsColumns(array)) roots.add(array);
  }

  const scanned = [...roots].map((array) => ({ array, scan: collectionColumns(array, 0, fragments) }));
  const collections = scanned
    .filter(({ array }) => !fragments.has(array))
    .map(({ array, scan }) => ({ node: array, columns: scan.columns, spread: scan.unresolved }));

  // A column already proven against its siblings is not also a homeless one; membership
  // is keyed on the node so a wrapped element (`[{ ... } as TableColumn]`) counts once.
  const claimed = new Set<Node>([
    ...scanned.flatMap(({ scan }) => scan.columns.map((column) => column.node)),
    ...spreadSources(sf),
  ]);
  const derived = sf
    .getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)
    .filter((object) => object.getProperty("sortable") !== undefined && !claimed.has(object))
    .map((object) => ({ id: declaredId(object), sortable: declaredSortable(object) ?? "unproven", node: object }));

  // A rendered register whose columns are sortable owes its landmark a name of its own:
  // the caption it would otherwise inherit is free to assert an order the sort undoes.
  for (const { owner, array } of tables) {
    if (!array) continue;
    const columns = collectionColumns(array, 0, new Set()).columns;
    if (!columns.some((column) => column.sortable === "yes")) continue;
    if (declaredRegionName(owner) === null) unnamedSortableTables.push(owner);
  }
  return { collections, derived, unreadableTables, unnamedSortableTables };
}

/** Whether the file declares any register this fence must see reviewed. */
function declaresSortableColumn(sf: SourceFile): boolean {
  const { collections, derived } = scanColumns(sf);
  const sortable = (column: DeclaredColumn) => column.sortable === "yes";
  return collections.some((collection) => collection.columns.some(sortable)) || derived.some(sortable);
}

export function registerSortabilityViolations(
  sf: SourceFile,
  rel: string,
  reviewed: ReadonlyMap<string, string> = REVIEWED_SORTABLE_REGISTERS,
): string[] {
  const out: string[] = [];
  const report = (node: Node, message: string) => out.push(`${rel}:${node.getStartLineNumber()} :: ${message}`);
  const { collections, derived, unreadableTables, unnamedSortableTables } = scanColumns(sf);

  for (const owner of unnamedSortableTables) {
    report(
      owner,
      "a sortable register must name its own landmark: declare a literal 'regionName' rather than inheriting a caption, which is free to assert an order the reader can sort away (D-201)",
    );
  }

  for (const column of derived) {
    if (column.sortable === "no") continue;
    report(
      column.node,
      "a sortable column built outside a literal column collection has no siblings to prove an order carrier against (D-194) - declare the register's columns as one literal array",
    );
  }

  for (const attribute of unreadableTables) {
    report(
      attribute,
      "a register's 'columns' attribute names no literal column collection in this file, so its sortability cannot be reviewed (D-194)",
    );
  }

  for (const collection of collections) {
    for (const column of collection.columns) {
      if (column.sortable === "unproven") {
        report(
          column.node,
          "'sortable' is not a resolvable literal - a computed value, or inherited through a spread this fence cannot read - so this register's sortability cannot be reviewed (D-194)",
        );
      }
    }
    if (collection.spread) {
      report(
        collection.node,
        "column collection is spread from an unresolved source, so the columns it finally holds - and their sortability - cannot be proven (D-194)",
      );
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
    if (collection.spread) continue;
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

describe("register-sortability fence", () => {
  const appFiles = appSourceProject().getSourceFiles();
  const sortableFiles = appFiles.filter(declaresSortableColumn).map(relativeToRepo);

  it("enforces: every sortable register names the visible column that carries its recorded order", () => {
    const offenders: string[] = [];
    for (const sf of appFiles) offenders.push(...registerSortabilityViolations(sf, relativeToRepo(sf)));
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
      expect(found).toEqual([expect.stringContaining("'sortable' is not a resolvable literal")]);
    });

    it("fails closed on a spread column collection and on a computed column id", () => {
      const reviewed = new Map([["src/app/example/page.tsx", "sequence"]]);
      const spread = registerSortabilityViolations(
        source('import { base } from "./base";\nconst C = [...base, { id: "when", header: "When", sortable: true }]; export default function P(){ return C.length; }'),
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

    /**
     * The hole this closes: a column that declares no `sortable` of its own was not a
     * column at all to the previous scan, so `{ ...SHARED_SORTABLE, id: "when" }` shipped
     * a fully sortable register that the fence never saw - not refused, not reported,
     * simply invisible. Where the spread source lives decides whether it can be READ,
     * never whether it must be reviewed.
     */
    it("fails closed on sortability inherited through a spread the fence cannot read", () => {
      const reviewed = new Map([["src/app/example/page.tsx", "sequence"]]);
      const imported = registerSortabilityViolations(
        source(
          'import { SHARED } from "@app/shared";\nconst C: readonly TableColumn[] = [{ ...SHARED, id: "when", header: "When" }];\nexport default function P(){ return C.length; }',
        ),
        "src/app/example/page.tsx",
        reviewed,
      );
      expect(imported).toEqual([
        expect.stringContaining("src/app/example/page.tsx:2 :: 'sortable' is not a resolvable literal"),
      ]);

      // The whole collection spread from an unreadable source is the same hole one level up.
      const wholesale = registerSortabilityViolations(
        source(
          'import { SHARED } from "@app/shared";\nconst C: readonly TableColumn[] = [...SHARED];\nexport default function P(){ return C.length; }',
        ),
        "src/app/example/page.tsx",
        reviewed,
      );
      expect(wholesale).toEqual([expect.stringContaining("column collection is spread from an unresolved source")]);

      // And a shadowed local name is unreadable for the same reason: the fence would be guessing.
      const shadowed = registerSortabilityViolations(
        source(
          'const SHARED = { sortable: true };\nfunction inner(){ const SHARED = { sortable: false }; return SHARED; }\nconst C: readonly TableColumn[] = [{ ...SHARED, id: "when", header: "When" }];\nexport default function P(){ return C.length + Number(inner().sortable); }',
        ),
        "src/app/example/page.tsx",
        reviewed,
      );
      expect(shadowed).toEqual(
        expect.arrayContaining([
          expect.stringContaining("src/app/example/page.tsx:3 :: 'sortable' is not a resolvable literal"),
        ]),
      );
    });

    /**
     * Resolution has to be real, or the rule above is just a ban on spreads: a source
     * declared once in the same file is inlined and reviewed like any other column, and
     * the LAST writer wins exactly as it does at runtime.
     */
    it("resolves a readable spread completely rather than refusing it", () => {
      const reviewed = new Map([["src/app/example/page.tsx", "sequence"]]);
      const merged = registerSortabilityViolations(
        source(
          'const SORTABLE = { sortable: true };\nconst SEQUENCE = [{ ...SORTABLE, id: "sequence", header: "#" }];\nconst C: readonly TableColumn[] = [...SEQUENCE, { ...SORTABLE, id: "when", header: "When" }];\nexport default function P(){ return C.length; }',
        ),
        "src/app/example/page.tsx",
        reviewed,
      );
      expect(merged).toEqual([]);

      // Resolved, and still held to the rule: without the order carrier it is refused.
      const noCarrier = registerSortabilityViolations(
        source(
          'const SORTABLE = { sortable: true };\nconst C: readonly TableColumn[] = [{ ...SORTABLE, id: "when", header: "When" }];\nexport default function P(){ return C.length; }',
        ),
        "src/app/example/page.tsx",
        reviewed,
      );
      expect(noCarrier).toEqual([expect.stringContaining("no visible sortable 'sequence' column")]);

      // An own `sortable: false` after the spread is proven; before it, it is not.
      const after = registerSortabilityViolations(
        source(
          'import { SHARED } from "@app/shared";\nconst C: readonly TableColumn[] = [{ ...SHARED, id: "when", header: "When", sortable: false }];\nexport default function P(){ return C.length; }',
        ),
        "src/app/example/page.tsx",
      );
      expect(after).toEqual([]);

      const before = registerSortabilityViolations(
        source(
          'import { SHARED } from "@app/shared";\nconst C: readonly TableColumn[] = [{ sortable: false, ...SHARED, id: "when", header: "When" }];\nexport default function P(){ return C.length; }',
        ),
        "src/app/example/page.tsx",
      );
      expect(before).toEqual([expect.stringContaining("'sortable' is not a resolvable literal")]);
    });

    /**
     * The hole this closes: `regionName` defaults to the caption, and both compliance
     * registers were captioned "…entries, newest first" - so their landmarks went on
     * promising newest-first over rows a reader had ordered by actor, in the one place a
     * screen-reader user meets on every entry and cannot sort. A name is the caller's to
     * choose wherever the rows can move.
     */
    it("requires a sortable register to name its own landmark", () => {
      const reviewed = new Map([["src/app/example/page.tsx", "sequence"]]);
      const table = (attributes: string) =>
        source(
          `const C: readonly TableColumn[] = [{ id: "sequence", header: "#", sortable: true }];\nexport default function P(){ return <Table caption="Entries, newest first" ${attributes}columns={C} rows={[]} />; }`,
        );

      expect(registerSortabilityViolations(table(""), "src/app/example/page.tsx", reviewed)).toEqual([
        expect.stringContaining("src/app/example/page.tsx:2 :: a sortable register must name its own landmark"),
      ]);
      // An empty name is not a name, and neither is one this fence cannot read.
      expect(registerSortabilityViolations(table('regionName="" '), "src/app/example/page.tsx", reviewed)).toEqual([
        expect.stringContaining("must name its own landmark"),
      ]);
      expect(
        registerSortabilityViolations(table("regionName={name} "), "src/app/example/page.tsx", reviewed),
      ).toEqual([expect.stringContaining("must name its own landmark")]);
      // A spread could carry the name or could not, so it is refused rather than assumed.
      expect(
        registerSortabilityViolations(table('{...rest} regionName="Audit log" '), "src/app/example/page.tsx", reviewed),
      ).toEqual([expect.stringContaining("must name its own landmark")]);

      // Declared, directly or through an unshadowed constant: reviewed and accepted.
      expect(registerSortabilityViolations(table('regionName="Audit log" '), "src/app/example/page.tsx", reviewed)).toEqual([]);
      const named = source(
        'const NAME = "Audit log";\nconst C: readonly TableColumn[] = [{ id: "sequence", header: "#", sortable: true }];\nexport default function P(){ return <Table caption="Entries, newest first" regionName={NAME} columns={C} rows={[]} />; }',
      );
      expect(registerSortabilityViolations(named, "src/app/example/page.tsx", reviewed)).toEqual([]);
    });

    /** An unsortable register keeps the default: its caption cannot come apart from its rows. */
    it("leaves an unsortable register's landmark name to the caption", () => {
      const found = registerSortabilityViolations(
        source(
          'const C: readonly TableColumn[] = [{ id: "step", header: "Step" }];\nexport default function P(){ return <Table caption="Execution timeline" columns={C} rows={[]} />; }',
        ),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([]);
    });

    /** A register whose columns the fence cannot even find is not a reviewed register. */
    it("fails closed on a Table whose 'columns' attribute names nothing readable", () => {
      const found = registerSortabilityViolations(
        source(
          'import { COLUMNS } from "@app/shared";\nexport default function P(){ return <Table caption="c" columns={COLUMNS} rows={[]} />; }',
          "/src/app/example/page.tsx",
        ),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([
        expect.stringContaining("src/app/example/page.tsx:2 :: a register's 'columns' attribute names no literal column collection"),
      ]);
    });

    it("fails closed on a sortable column produced by a transform, review or no review", () => {
      const derived =
        'const BASE = [{ id: "when", header: "When" }];\nconst C = BASE.map((c) => ({ ...c, sortable: true }));\nexport default function P(){ return C.length; }';
      const unreviewed = registerSortabilityViolations(source(derived), "src/app/example/page.tsx");
      expect(unreviewed).toEqual([
        expect.stringContaining("src/app/example/page.tsx:2 :: a sortable column built outside a literal column collection"),
      ]);

      // A registry entry cannot buy the transform out: the order carrier is still unprovable.
      const reviewed = registerSortabilityViolations(
        source(derived),
        "src/app/example/page.tsx",
        new Map([["src/app/example/page.tsx", "sequence"]]),
      );
      expect(reviewed).toEqual([expect.stringContaining("built outside a literal column collection")]);
    });

    it("fails closed on a computed sortable flag built by a transform, and lets an explicit opt-out through", () => {
      const computed = registerSortabilityViolations(
        source('const BASE: { id: string }[] = []; const on = true;\nconst C = BASE.map((c) => ({ ...c, sortable: on }));\nexport default function P(){ return C.length; }'),
        "src/app/example/page.tsx",
      );
      expect(computed).toEqual([expect.stringContaining("built outside a literal column collection")]);

      const optOut = registerSortabilityViolations(
        source('const BASE: { id: string }[] = []; const C = BASE.map((c) => ({ ...c, sortable: false })); export default function P(){ return C.length; }'),
        "src/app/example/page.tsx",
      );
      expect(optOut).toEqual([]);
    });

    it("still groups a column literal that IS a direct array element, so the transform rule is not over-broad", () => {
      const found = registerSortabilityViolations(
        source(COLUMNS('{ id: "sequence", header: "#", sortable: true }, ')),
        "src/app/example/page.tsx",
        new Map([["src/app/example/page.tsx", "sequence"]]),
      );
      expect(found).toEqual([]);
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
