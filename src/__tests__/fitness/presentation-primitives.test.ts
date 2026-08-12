import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { inMemoryProject, REPO_ROOT, walk } from "./_fence-utils";

/**
 * PRESENTATION-PRIMITIVES FENCE (charter #1/#9/#10). Product surfaces use the
 * canonical Button, Badge, and Pill implementations in presentation/ui.tsx.
 * A native button or a repeated button/chip class recipe in feature code creates
 * a second visual path that will drift across every future workflow.
 *
 * PRIMITIVE_FILES is an EXACT-PATH escape list, so a rename or a split (the 500-line
 * per-file ceiling makes splits routine here) would silently exempt nothing while a
 * reader still believes the file is covered. The staleness guard below fails with
 * `file:line` the moment an entry stops resolving against the scanned tree.
 */
const PRIMITIVE_FILES = new Set([
  "src/app/presentation/dialog.tsx",
  "src/app/presentation/error-boundary.tsx",
  "src/app/presentation/table.tsx",
  "src/app/presentation/tabs.tsx",
  "src/app/presentation/toast.tsx",
  "src/app/presentation/tooltip.tsx",
  "src/app/presentation/ui.tsx",
]);
const BUTTON_RECIPE = ["inline-flex", "items-center", /^justify-/, "rounded-md"];
const PILL_RECIPE = ["rounded-full", "border", "text-xs"];
const BADGE_RECIPE = ["rounded", "text-xs"];
const CONTROL_TAGS = new Set(["Button", "Badge", "Pill"]);

function isPrimitiveImport(moduleSpecifier: string): boolean {
  return moduleSpecifier === "@app/presentation/ui" ||
    moduleSpecifier === "./ui" ||
    moduleSpecifier.endsWith("/presentation/ui");
}

function canonicalControlTags(sf: SourceFile): Set<string> {
  const tags = new Set<string>();
  for (const declaration of sf.getImportDeclarations()) {
    if (!isPrimitiveImport(declaration.getModuleSpecifierValue())) continue;
    for (const named of declaration.getNamedImports()) {
      const imported = named.getName();
      if (CONTROL_TAGS.has(imported)) tags.add(named.getAliasNode()?.getText() ?? imported);
    }
    const namespace = declaration.getNamespaceImport()?.getText();
    if (namespace) for (const tag of CONTROL_TAGS) tags.add(`${namespace}.${tag}`);
  }
  return tags;
}

function canonicalButtonBuilders(sf: SourceFile): Set<string> {
  const builders = new Set<string>();
  for (const declaration of sf.getImportDeclarations()) {
    if (!isPrimitiveImport(declaration.getModuleSpecifierValue())) continue;
    for (const named of declaration.getNamedImports()) {
      if (named.getName() === "buttonClassName") {
        builders.add(named.getAliasNode()?.getText() ?? "buttonClassName");
      }
    }
    const namespace = declaration.getNamespaceImport()?.getText();
    if (namespace) builders.add(`${namespace}.buttonClassName`);
  }
  return builders;
}

function tokens(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter(Boolean));
}

/**
 * A control recipe pads on both axes however it spells it: the `p-*` shorthand and
 * the per-side pairs are the same styling path as `px-*`/`py-*`, so requiring the
 * axis pair alone would let a fully-styled control walk through the fence.
 */
function hasSpacing(recipe: Set<string>): boolean {
  const has = (pattern: RegExp) => [...recipe].some((token) => pattern.test(token));
  const horizontal = has(/^px-/) || (has(/^pl-/) && has(/^pr-/));
  const vertical = has(/^py-/) || (has(/^pt-/) && has(/^pb-/));
  return has(/^p-/) || (horizontal && vertical);
}

function hasRecipe(recipe: Set<string>, required: readonly (string | RegExp)[]): boolean {
  const present = (token: string | RegExp) =>
    typeof token === "string" ? recipe.has(token) : [...recipe].some((candidate) => token.test(candidate));
  return required.every(present) && hasSpacing(recipe);
}

function stringValue(node: Node | undefined): string | null {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  if (Node.isJsxExpression(node)) return stringValue(node.getExpression());
  return null;
}

function classAttribute(opening: Node): Node | undefined {
  if (!Node.isJsxOpeningElement(opening) && !Node.isJsxSelfClosingElement(opening)) return undefined;
  return opening.getAttributes().find((attribute) => Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === "className");
}

function staticClassName(opening: Node): string | null {
  const attribute = classAttribute(opening);
  return attribute && Node.isJsxAttribute(attribute) ? stringValue(attribute.getInitializer()) : null;
}

function forbiddenControlOverride(className: string): string | null {
  const visual = tokens(className);
  return [...visual].find((token) =>
    /^(?:bg-|border(?:-|$)|rounded(?:-|$)|p[trblxy]?-|font-|hover:|text-(?:white|black|slate|red|green|amber|blue|destructive))/.test(token),
  ) ?? null;
}

export function presentationPrimitiveViolations(sf: SourceFile, rel: string): string[] {
  if (PRIMITIVE_FILES.has(rel)) return [];
  const out: string[] = [];
  const canonicalTags = canonicalControlTags(sf);
  const buttonBuilders = canonicalButtonBuilders(sf);
  const report = (node: Node, message: string) => out.push(`${rel}:${node.getStartLineNumber()} :: ${message}`);

  for (const opening of [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ]) {
    const tag = opening.getTagNameNode().getText();
    if (tag === "button") report(opening, "native <button> bypasses the canonical <Button> primitive");
    if (canonicalTags.has(tag)) {
      const attribute = classAttribute(opening);
      const className = staticClassName(opening);
      if (attribute && className === null) {
        report(opening, `<${tag}> has a dynamic className whose layout-only status cannot be proven`);
      }
      const override = className ? forbiddenControlOverride(className) : null;
      if (override) report(opening, `<${tag}> restyles canonical visuals with '${override}'`);
    }
  }

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!buttonBuilders.has(call.getExpression().getText())) continue;
    const options = call.getArguments()[0];
    if (!options) continue;
    if (!Node.isObjectLiteralExpression(options)) {
      report(call, "buttonClassName options are dynamic, so layout-only composition cannot be proven");
      continue;
    }
    for (const property of options.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        report(property, "buttonClassName options spread is unresolved and may restyle the canonical button");
        continue;
      }
      if (!Node.isPropertyAssignment(property) || property.getName() !== "className") continue;
      const className = stringValue(property.getInitializer());
      if (className === null) {
        report(property, "buttonClassName className is dynamic, so layout-only composition cannot be proven");
        continue;
      }
      const override = forbiddenControlOverride(className);
      if (override) report(property, `buttonClassName restyles canonical visuals with '${override}'`);
    }
  }

  for (const { node, text } of classRecipeCandidates(sf)) {
    const recipe = tokens(text);
    if (hasRecipe(recipe, BUTTON_RECIPE)) report(node, "ad-hoc button class recipe bypasses buttonClassName/Button");
    if (hasRecipe(recipe, PILL_RECIPE)) report(node, "ad-hoc pill class recipe bypasses Pill/StatusBadge");
    if (hasRecipe(recipe, BADGE_RECIPE)) report(node, "ad-hoc badge class recipe bypasses Badge");
  }
  return [...new Set(out)];
}

/**
 * An interpolated template is the repository's dominant className idiom, and its class
 * tokens live in TemplateHead/Middle/Tail nodes plus the string literals inside each
 * `${…}` arm - none of which is a StringLiteral. Reading only the plain literals let a
 * complete control recipe written that way through the fence untouched, so the whole
 * template is composed into one token set: the head, every span literal, and every
 * literal nested in the interpolations, which is exactly what the browser ends up with
 * for whichever arm is taken.
 */
function templateClassText(template: Node): string {
  const parts: string[] = [];
  if (Node.isTemplateExpression(template)) {
    parts.push(template.getHead().getLiteralText());
    for (const span of template.getTemplateSpans()) parts.push(span.getLiteral().getLiteralText());
  }
  for (const nested of [
    ...template.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...template.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ]) {
    parts.push(nested.getLiteralText());
  }
  return parts.join(" ");
}

function classRecipeCandidates(sf: SourceFile): Array<{ node: Node; text: string }> {
  const candidates: Array<{ node: Node; text: string }> = [];
  for (const literal of [
    ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ]) {
    candidates.push({ node: literal, text: literal.getLiteralText() });
  }
  for (const template of sf.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    candidates.push({ node: template, text: templateClassText(template) });
  }
  return candidates;
}

/**
 * Both extensions: a class-string constant exported from a `.ts` module under `src/app`
 * reaches the same JSX as one written inline, so scanning only `.tsx` left a styling
 * path the fence could not see.
 */
/** An escape that points at nothing exempts nothing, and reads as coverage it no longer gives. */
export function stalePrimitiveEscapes(scanned: Iterable<string>): string[] {
  const present = new Set(scanned);
  return [...PRIMITIVE_FILES]
    .filter((rel) => !present.has(rel))
    .map((rel) => `${rel}:1 :: reviewed primitive escape no longer resolves in the scanned tree`);
}

function appProject(): Project {
  const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
  for (const file of walk(`${REPO_ROOT}src/app`, (candidate) => candidate.endsWith(".tsx") || candidate.endsWith(".ts"))) {
    project.addSourceFileAtPath(file);
  }
  return project;
}

describe("presentation-primitives fence", () => {
  const scanned = appProject()
    .getSourceFiles()
    .map((sf) => relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/"));

  it("enforces: product surfaces have no second button, badge, or pill styling path", () => {
    const offenders: string[] = [];
    for (const sf of appProject().getSourceFiles()) {
      const rel = relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/");
      offenders.push(...presentationPrimitiveViolations(sf, rel));
    }
    expect(offenders, `ad-hoc presentation primitives:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("staleness guard: every reviewed primitive escape still resolves in the scanned tree", () => {
    const stale = stalePrimitiveEscapes(scanned);
    expect(stale, `PRIMITIVE_FILES entries exempt nothing:\n${stale.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): the staleness guard rejects an escape that resolves to nothing", () => {
    it("reports a renamed primitive with file and line", () => {
      const renamed = scanned.filter((rel) => rel !== "src/app/presentation/table.tsx");
      expect(stalePrimitiveEscapes(renamed)).toEqual([
        "src/app/presentation/table.tsx:1 :: reviewed primitive escape no longer resolves in the scanned tree",
      ]);
    });

    it("passes only against a tree that really holds every escape", () => {
      expect(stalePrimitiveEscapes(scanned)).toEqual([]);
      expect(stalePrimitiveEscapes([])).toHaveLength(7);
    });
  });

  describe("detects (companion): real bypasses fail with file and line", () => {
    function source(text: string): SourceFile {
      return inMemoryProject({ "/src/app/example/page.tsx": text }).getSourceFiles()[0]!;
    }

    it("rejects a native feature button", () => {
      const found = presentationPrimitiveViolations(source("export function P(){ return <button>Save</button>; }"), "src/app/example/page.tsx");
      expect(found).toEqual([expect.stringContaining("src/app/example/page.tsx:1 :: native <button>")]);
    });

    it("rejects a button-styled link", () => {
      const found = presentationPrimitiveViolations(
        source('export function P(){ return <a className="inline-flex items-center justify-center rounded-md px-4 py-2">Save</a>; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([expect.stringContaining("ad-hoc button class recipe")]);
    });

    it("rejects a shorthand-padded button-styled link", () => {
      const found = presentationPrimitiveViolations(
        source('export function P(){ return <a className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium">Save</a>; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([expect.stringContaining("ad-hoc button class recipe")]);
    });

    it("rejects a button recipe that swaps the justification", () => {
      const found = presentationPrimitiveViolations(
        source('export function P(){ return <a className="inline-flex items-center justify-start rounded-md px-4 py-2 text-sm font-medium">Save</a>; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([expect.stringContaining("ad-hoc button class recipe")]);
    });

    it("rejects a per-side padded button-styled link", () => {
      const found = presentationPrimitiveViolations(
        source('export function P(){ return <a className="inline-flex items-center justify-center rounded-md pl-4 pr-4 pt-2 pb-2">Save</a>; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([expect.stringContaining("ad-hoc button class recipe")]);
    });

    it("accepts a layout wrapper that pads without a control recipe", () => {
      const found = presentationPrimitiveViolations(
        source('export function P(){ return <div className="flex flex-col gap-2 p-4">Content</div>; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([]);
    });

    it("rejects ad-hoc badge and pill recipes", () => {
      const found = presentationPrimitiveViolations(
        source('export function P(){ return <><span className="rounded border px-1.5 py-0.5 text-xs">Draft</span><span className="rounded-full border px-2.5 py-0.5 text-xs">Done</span></>; }'),
        "src/app/example/page.tsx",
      );
      expect(found.some((entry) => entry.includes("ad-hoc badge"))).toBe(true);
      expect(found.some((entry) => entry.includes("ad-hoc pill"))).toBe(true);
    });

    it("rejects visual overrides on a canonical control", () => {
      const found = presentationPrimitiveViolations(
        source('import { Button as Action } from "@app/presentation/ui"; export function P(){ return <Action className="bg-red-50">Save</Action>; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([expect.stringContaining("restyles canonical visuals")]);
    });

    it("rejects unresolved canonical-control styling and builder overrides", () => {
      const found = presentationPrimitiveViolations(
        source('import { Button, buttonClassName as recipe } from "@app/presentation/ui"; const style = "self-start"; export function P(){ return <><Button className={style}>Save</Button><a className={recipe({ className: "bg-red-50" })}>Save</a></>; }'),
        "src/app/example/page.tsx",
      );
      expect(found.some((entry) => entry.includes("dynamic className"))).toBe(true);
      expect(found.some((entry) => entry.includes("buttonClassName restyles"))).toBe(true);
    });

    it("rejects an interpolated-template button recipe (the repository's dominant idiom)", () => {
      const found = presentationPrimitiveViolations(
        source(
          "export function P({ busy }: { busy: boolean }){ return <a className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ${busy ? \"opacity-50\" : \"\"}`}>Save</a>; }",
        ),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([expect.stringContaining("ad-hoc button class recipe")]);
    });

    it("rejects a recipe split across a template head and its interpolated arms", () => {
      const found = presentationPrimitiveViolations(
        source(
          "export function P({ on }: { on: boolean }){ return <span className={`rounded-full border ${on ? \"px-2.5 py-0.5 text-xs\" : \"px-2 py-1 text-sm\"}`}>Done</span>; }",
        ),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([expect.stringContaining("ad-hoc pill class recipe")]);
    });

    it("accepts an interpolated layout template that is not a control recipe", () => {
      const found = presentationPrimitiveViolations(
        source(
          "export function P({ wide }: { wide: boolean }){ return <div className={`flex flex-col gap-2 p-4 ${wide ? \"w-full\" : \"w-64\"}`}>Content</div>; }",
        ),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([]);
    });

    it("rejects a class-string constant exported from a .ts module", () => {
      const found = presentationPrimitiveViolations(
        source('export const ACTION = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium";'),
        "src/app/example/styles.ts",
      );
      expect(found).toEqual([expect.stringContaining("src/app/example/styles.ts:1 :: ad-hoc button class recipe")]);
    });

    it("scans .ts modules under src/app, not only .tsx", () => {
      const scanned = appProject()
        .getSourceFiles()
        .map((sf) => relative(REPO_ROOT, sf.getFilePath()).replace(/\\/g, "/"));
      expect(scanned).toContain("src/app/ledger/model.ts");
      expect(scanned).toContain("src/app/presentation/ui.tsx");
    });

    it("accepts layout-only composition around canonical controls", () => {
      const found = presentationPrimitiveViolations(
        source('export function P(){ return <Button className="self-start">Save</Button>; }'),
        "src/app/example/page.tsx",
      );
      expect(found).toEqual([]);
    });
  });
});
