/**
 * Shared module scanners for the vocabulary-and-purity fence family
 * (primitive-catalog, policy-ast). Moved verbatim from the primitive-catalog
 * fence and parameterized by path filter + prose exemption, so both fences run
 * ONE scanner and cannot drift apart (ADR-0039, ADR-0053).
 */
import { Node, Project, SyntaxKind, ts } from "ts-morph";

/**
 * Domain vocabulary that must never name an identifier, published key,
 * strategy, or code inside a scanned module. Tokens are matched whole-word
 * after camelCase, kebab-case, snake_case, and prose splitting, so
 * `moneyMovementReserve` and "wire-transfer" both hit. Platform tenancy
 * vocabulary (household, firm, instruction, regulatory) is deliberately NOT
 * here - those are the governed planes themselves, not decision domains.
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

const LITERAL_KINDS = new Set<SyntaxKind>([
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
]);

export interface ModuleScanViolation {
  readonly file: string;
  readonly line: number;
  readonly token: string;
}

export type PathFilter = (path: string) => boolean;
export type ProseExemption = (node: Node) => boolean;

export function scanDomainVocabulary(
  project: Project,
  includePath: PathFilter,
  proseExemption: ProseExemption = () => false,
): ModuleScanViolation[] {
  const out: ModuleScanViolation[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const file = sourceFile.getFilePath();
    if (!includePath(file.replace(/\\/g, "/"))) continue;
    sourceFile.forEachDescendant((node) => {
      let text: string | null = null;
      if (Node.isIdentifier(node)) {
        text = node.getText();
      } else if (LITERAL_KINDS.has(node.getKind()) && !proseExemption(node)) {
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

/**
 * ICU-dependent members. Collation and formatting vary with the Node build's
 * ICU data and the ambient default locale, so a comparator or formatter
 * reaching one of these breaks byte-identical replay just as surely as a clock
 * read - and none of them mentions the `Intl` global.
 */
const LOCALE_MEMBERS = new Set([
  "localeCompare", "toLocaleString", "toLocaleDateString", "toLocaleTimeString",
  "toLocaleLowerCase", "toLocaleUpperCase",
]);

/** The locale-sensitive member reached by `x.member` or `x["member"]`, if any. */
const localeMemberName = (node: Node): string | null => {
  let name: string | null = null;
  if (Node.isPropertyAccessExpression(node)) {
    name = node.getName();
  } else if (Node.isElementAccessExpression(node)) {
    const argument = node.getArgumentExpression();
    if (
      argument !== undefined &&
      (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
    ) {
      name = argument.getLiteralValue();
    }
  }
  return name !== null && LOCALE_MEMBERS.has(name) ? name : null;
};

export function scanImpurity(project: Project, includePath: PathFilter): ModuleScanViolation[] {
  const out: ModuleScanViolation[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    const file = sourceFile.getFilePath();
    if (!includePath(file.replace(/\\/g, "/"))) continue;
    sourceFile.forEachDescendant((node) => {
      const locale = localeMemberName(node);
      if (locale !== null) {
        out.push({ file, line: node.getStartLineNumber(), token: locale });
        return;
      }
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
