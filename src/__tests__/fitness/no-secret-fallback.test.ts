import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, walk, stripComments } from "./_fence-utils";

/**
 * CONFIG-HYGIENE FENCE (ADR-0003/0017, charter #7). Fails the build on:
 *  (1) a secret with a hardcoded fallback (`process.env.X_SECRET || "…"`) —
 *      Meridian's `SF_COOKIE_SECRET || "…change-in-prod!!"` class;
 *  (2) a live org domain / instance in any committed file (retro: HANDOFF.md
 *      shipped a real Salesforce org domain);
 *  (3) a non-placeholder value in .env.example.
 */

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|ya?ml|toml|css|env\.example)$/;
const SKIP_DIRS = ["node_modules", ".next", ".git", "coverage", "playwright-report", "test-results"];

function committedTextFiles(): Array<{ rel: string; text: string }> {
  return walk(REPO_ROOT, (f) => TEXT_EXT.test(f) || f.endsWith(".env.example"))
    .filter((f) => !SKIP_DIRS.some((d) => f.includes(`/${d}/`)) && !f.includes("/.verin-data"))
    .map((f) => ({ rel: relative(REPO_ROOT, f), text: readFileSync(f, "utf8") }));
}

const SECRET_FALLBACK_RE =
  /process\s*\.\s*env\s*\.\s*[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD|COOKIE|CREDENTIAL)[A-Z0-9_]*\s*(\|\||\?\?)\s*["'`]/i;
const LIVE_ORG_RE = /[a-z0-9][a-z0-9-]*\.(my\.salesforce\.com|lightning\.force\.com|my\.site\.com)/i;

export function detectSecretFallback(files: Array<{ rel: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { rel, text } of files) {
    // The fence's own companion fixtures contain the pattern as a literal.
    if (rel.endsWith("no-secret-fallback.test.ts")) continue;
    text.split("\n").forEach((line, i) => {
      if (SECRET_FALLBACK_RE.test(stripComments(line))) out.push(`${rel}:${i + 1}`);
    });
  }
  return out;
}

export function detectLiveOrgDomain(files: Array<{ rel: string; text: string }>): string[] {
  const out: string[] = [];
  for (const { rel, text } of files) {
    // The fence's own regex source + companion fixtures are not live domains.
    if (rel.endsWith("no-secret-fallback.test.ts")) continue;
    text.split("\n").forEach((line, i) => {
      if (LIVE_ORG_RE.test(line)) out.push(`${rel}:${i + 1}`);
    });
  }
  return out;
}

// A .env.example value is a placeholder if it is empty, an enum/driver/tz/localhost
// value, or an explicit CHANGEME_/e2e-only placeholder. Anything else is suspect.
const PLACEHOLDER_VALUE =
  /^(|CHANGEME[_A-Za-z0-9]*|development|production|test|info|error|debug|warn|verin|pglite|postgres|America\/New_York|America\/[A-Za-z_]+|http:\/\/localhost(:\d+)?|\.verin-data[\w-]*|\d+|postgres:\/\/USER:CHANGEME_PASSWORD@HOST:5432\/verin)$/;

export function detectEnvExampleNonPlaceholder(): string[] {
  const p = join(REPO_ROOT, ".env.example");
  if (!existsSync(p)) return ["MISSING .env.example"];
  const out: string[] = [];
  readFileSync(p, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const s = line.trim();
      if (!s || s.startsWith("#")) return;
      const eq = s.indexOf("=");
      if (eq < 0) return;
      const value = s.slice(eq + 1).trim();
      if (!PLACEHOLDER_VALUE.test(value)) out.push(`.env.example:${i + 1} (${s.slice(0, eq)}=${value})`);
    });
  return out;
}

describe("config-hygiene fence (no secret fallback / no live org domain / placeholder .env)", () => {
  const files = committedTextFiles();

  it("enforces: no secret has a hardcoded fallback", () => {
    const o = detectSecretFallback(files);
    expect(o, `secret fallbacks:\n${o.join("\n")}`).toEqual([]);
  });
  it("enforces: no live org domain in committed files", () => {
    const o = detectLiveOrgDomain(files);
    expect(o, `live org domains:\n${o.join("\n")}`).toEqual([]);
  });
  it("enforces: .env.example is placeholder-only", () => {
    const o = detectEnvExampleNonPlaceholder();
    expect(o, `non-placeholder .env.example values:\n${o.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): planted violations are caught", () => {
    it("catches a secret fallback", () => {
      expect(detectSecretFallback([{ rel: "src/infrastructure/config/x.ts", text: `const s = process.env.SF_COOKIE_SECRET || "change-in-prod!!";` }]).length).toBe(1);
    });
    it("catches a live Salesforce org domain", () => {
      expect(detectLiveOrgDomain([{ rel: "docs/HANDOFF.md", text: `Login at https://acme-corp.my.salesforce.com` }]).length).toBe(1);
    });
    it("catches a non-placeholder env value shape", () => {
      // simulate the parser directly on a suspicious value
      const suspicious = "sk_live_51H8xQ2eZvKYlo2C"; // gitleaks:allow — deliberately secret-shaped test fixture, not a real key
      expect(PLACEHOLDER_VALUE.test(suspicious)).toBe(false);
    });
  });
});
