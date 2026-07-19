/**
 * License audit (charter #15). A SELF-CONTAINED supply-chain license gate: every
 * installed dependency's license must be on the reviewed allowlist (permissive +
 * weak, file-level copyleft + font/data licenses) or a documented per-package
 * exception. STRONG copyleft (GPL/AGPL), proprietary, and unknown/missing
 * licenses fail the build. Runs as part of the `dependency-audit` CI gate,
 * alongside `pnpm audit --audit-level=high` (vulnerabilities).
 *
 * Why not `actions/dependency-review-action`? It needs GitHub's server-side
 * Dependency-graph feature and cannot run self-contained on every CI/host
 * (ADR-0017) — a brittleness the charter's "machine-enforced, not modeled"
 * discipline rejects. `pnpm licenses list` reads the installed tree directly.
 */
import { execSync } from "node:child_process";

/**
 * Reviewed allowlist — the exact license strings pnpm emits from each package's
 * `license` field. Permissive licenses, plus weak FILE-LEVEL copyleft (MPL-2.0)
 * and font/data licenses, none of which impose obligations on our proprietary
 * application code. STRONG copyleft (GPL-*, AGPL-*) and blanket LGPL are
 * deliberately ABSENT, so they are denied and must be reviewed as an exception.
 */
const ALLOWED = new Set<string>([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "Python-2.0",
  "BlueOak-1.0.0",
  "MPL-2.0", // weak, file-level copyleft; dev/build tooling (axe-core, lightningcss) — no obligation on our code
  "CC0-1.0", // public-domain data (spdx-license-ids, mdn-data)
  "CC-BY-3.0", // data (spdx-exceptions)
  "CC-BY-4.0", // data (caniuse-lite)
  "SIL OPEN FONT LICENSE", // the Geist UI font (OFL-1.1) — permissive for embedding/redistribution
]);

/**
 * Per-package exceptions: a license NOT on the general allowlist, approved for a
 * SPECIFIC package (matched by name pattern) with a recorded reason. A NEW
 * package under the same license would still fail the gate — forcing a fresh
 * review (default-deny copyleft, examiner-ready).
 */
const PACKAGE_EXCEPTIONS: Array<{ match: RegExp; license: string; reason: string }> = [
  {
    // sharp ships per-platform prebuilt libvips binaries (darwin-arm64 locally,
    // linux-x64/musl in CI). All are LGPL-3.0-or-later; match the whole family.
    match: /^@img\/sharp-libvips-/,
    license: "LGPL-3.0-or-later",
    reason:
      "native libvips binary dynamically loaded by sharp (Next.js image optimizer); LGPL permits use in proprietary software when dynamically linked, and we neither modify nor statically link it",
  },
];

/**
 * Evaluate an SPDX-style license expression against the allowlist with a tiny
 * recursive-descent parser that respects PARENTHESES and operator precedence
 * (AND binds tighter than OR), so "(MIT OR GPL-2.0-only) AND OpenSSL" is denied —
 * stripping parens would mis-evaluate it as "MIT OR (GPL-2.0-only AND OpenSSL)".
 * FAIL CLOSED: any expression that does not parse cleanly is denied.
 */
function licenseAllowed(expr: string): boolean {
  const e = expr.trim();
  if (ALLOWED.has(e)) return true; // atomic id incl. multi-word strings ("SIL OPEN FONT LICENSE")
  // SPDX operators are ALWAYS uppercase (case-sensitive), so "-or-later" in an id
  // like "GPL-3.0-or-later" is NOT treated as an OR operator.
  const tokens = e.split(/(\(|\))|\s+(OR|AND)\s+/).filter((t): t is string => t !== undefined && t.trim() !== "");
  let pos = 0;
  const peek = () => tokens[pos];
  // or := and (OR and)* ; and := atom (AND atom)* ; atom := "(" or ")" | id
  function parseOr(): boolean {
    let ok = parseAnd();
    while (peek() === "OR") {
      pos += 1;
      ok = parseAnd() || ok;
    }
    return ok;
  }
  function parseAnd(): boolean {
    let ok = parseAtom();
    while (peek() === "AND") {
      pos += 1;
      ok = parseAtom() && ok;
    }
    return ok;
  }
  function parseAtom(): boolean {
    const t = peek();
    if (t === "(") {
      pos += 1;
      const inner = parseOr();
      if (peek() !== ")") throw new SyntaxError(`unbalanced parenthesis in "${expr}"`);
      pos += 1;
      return inner;
    }
    if (t === undefined || t === ")" || t === "OR" || t === "AND") {
      throw new SyntaxError(`malformed SPDX expression "${expr}"`);
    }
    pos += 1;
    return ALLOWED.has(t.trim());
  }
  try {
    const ok = parseOr();
    if (pos !== tokens.length) return false; // trailing junk → deny
    return ok;
  } catch {
    return false; // unparseable → deny (never fail open in a compliance gate)
  }
}

function exceptionFor(pkg: string, license: string): boolean {
  return PACKAGE_EXCEPTIONS.some((x) => x.match.test(pkg) && x.license === license);
}

interface LicenseEntry {
  name: string;
  license?: string;
}

/**
 * `pnpm licenses list --json`, resolving pnpm robustly: it is on PATH in CI
 * (pnpm/action-setup) but shimmed through corepack in many local setups.
 */
function pnpmLicensesJson(): string {
  const candidates = ["pnpm licenses list --json", "corepack pnpm licenses list --json"];
  let lastErr: unknown;
  for (const cmd of candidates) {
    try {
      return execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function main(): void {
  // `pnpm licenses list --json` groups packages by license string:
  //   { "<license expr>": [ { name, versions, paths, license, ... }, ... ] }
  const raw = pnpmLicensesJson();
  const byLicense = JSON.parse(raw) as Record<string, LicenseEntry[]>;

  const violations: Array<{ name: string; license: string }> = [];
  let scanned = 0;
  const seen = new Set<string>();
  for (const [license, entries] of Object.entries(byLicense)) {
    for (const entry of entries) {
      const key = `${entry.name}@@${license}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scanned += 1;
      const lic = license || entry.license || "UNKNOWN";
      if (licenseAllowed(lic) || exceptionFor(entry.name, lic)) continue;
      violations.push({ name: entry.name, license: lic });
    }
  }

  // Detection is not verification (charter #4): a run that checked nothing must
  // FAIL, not pass — an empty tree means deps were never installed.
  if (scanned === 0) {
    process.stderr.write("license-audit: no packages found — did `pnpm install` run against this tree?\n");
    process.exit(1);
  }

  if (violations.length > 0) {
    violations.sort((a, b) => a.name.localeCompare(b.name));
    process.stderr.write(
      `license-audit: ${violations.length} package(s) carry a disallowed license (not on the reviewed allowlist or a documented exception):\n`,
    );
    for (const v of violations) process.stderr.write(`  ${v.name}: ${v.license}\n`);
    process.stderr.write(
      "\nReview the license, then either add it to ALLOWED in scripts/license-audit.ts (with a rationale) or record a per-package exception. GPL/AGPL/unknown are denied by design.\n",
    );
    process.exit(1);
  }

  process.stdout.write(`license-audit: ${scanned} dependencies checked — all licenses allowed.\n`);
}

main();
