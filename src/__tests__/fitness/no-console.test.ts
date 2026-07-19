import { describe, it, expect } from "vitest";
import { readShipped, stripComments } from "./_fence-utils";

/**
 * NO-CONSOLE FENCE (ADR-0013, charter #14). Raw console.* is banned in shipped
 * SERVER-SIDE code — domain, infrastructure, AND the app layer (route handlers,
 * server actions, server components handle raw PII like login email/password):
 * only the pino logger scrubs PII (ADR-0006), so a stray console.log can leak PII
 * to server stdout. Use the structured logger. Files carrying a "use client"
 * directive are exempt: the browser console is a different, lower-stakes surface
 * (no server log aggregation), and Next strips server-only paths from them.
 * Known, accepted gap: client components ALSO execute server-side during
 * SSR/prerender, so a console call in module scope or the render body can still
 * reach server stdout — the browser-console rationale fully holds only for event
 * handlers/effects (which never run on the server). See PF-020.
 */
const CONSOLE_RE = /\bconsole\s*\.\s*(log|info|warn|error|debug|trace|dir)\s*\(/;

// Server-side files reviewed as allowed to touch the console, with the reason.
const REVIEWED_CONSOLE_FILES = new Map<string, string>([
  // (none today — the logger module allowance below covers the pino transport)
]);

/** The "use client" directive must be the first statement (leading comments/blank lines allowed). */
export function isClientFile(text: string): boolean {
  let rest = text;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    if (trimmed.startsWith("//")) {
      const nl = trimmed.indexOf("\n");
      if (nl === -1) return false;
      rest = trimmed.slice(nl + 1);
    } else if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end === -1) return false;
      rest = trimmed.slice(end + 2);
    } else {
      return /^["']use client["']/.test(trimmed);
    }
  }
}

function detectConsole(files: Array<{ rel: string; text: string }>): string[] {
  const offenders: string[] = [];
  for (const { rel, text } of files) {
    const r = rel.replace(/\\/g, "/");
    if (!r.startsWith("src/domain/") && !r.startsWith("src/infrastructure/") && !r.startsWith("src/app/")) continue;
    // The logger module itself is the one place allowed to touch the console transport.
    if (r.startsWith("src/infrastructure/observability/")) continue;
    if (REVIEWED_CONSOLE_FILES.has(r)) continue;
    // Client components log to the BROWSER console — a different surface
    // (accepted gap: SSR/prerender still runs module scope + render body on the server).
    if (r.startsWith("src/app/") && isClientFile(text)) continue;
    text.split("\n").forEach((line, i) => {
      if (CONSOLE_RE.test(stripComments(line))) offenders.push(`${rel}:${i + 1}`);
    });
  }
  return offenders;
}

describe("no-console fence", () => {
  it("enforces: no raw console.* in server-side code (domain/infrastructure/app)", () => {
    const offenders = detectConsole(readShipped());
    expect(offenders, `raw console.* (use the pino logger):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("staleness guard: reviewed console files must still exist", () => {
    const existing = new Set(readShipped().map(({ rel }) => rel.replace(/\\/g, "/")));
    const stale = [...REVIEWED_CONSOLE_FILES.keys()].filter((rel) => !existing.has(rel));
    expect(stale, `REVIEWED_CONSOLE_FILES entries point at missing files:\n${stale.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a planted console.* is caught", () => {
    it("catches console.log in a domain file", () => {
      const offenders = detectConsole([{ rel: "src/domain/x.ts", text: `export function f(){ console.log("pii?"); }` }]);
      expect(offenders).toEqual(["src/domain/x.ts:1"]);
    });
    it("catches console.log in an app-layer SERVER file (route handler)", () => {
      const offenders = detectConsole([
        { rel: "src/app/api/login/route.ts", text: `export async function POST(req: Request){ const b = await req.json(); console.log(b.email); return Response.json({}); }` },
      ]);
      expect(offenders).toEqual(["src/app/api/login/route.ts:1"]);
    });
    it("catches console.log in an app-layer server COMPONENT (no directive)", () => {
      const offenders = detectConsole([{ rel: "src/app/app/x/page.tsx", text: `export default function P(){ console.log("server stdout"); return null; }` }]);
      expect(offenders).toEqual(["src/app/app/x/page.tsx:1"]);
    });
    it('allows console in a "use client" file (browser console, different surface)', () => {
      const offenders = detectConsole([{ rel: "src/app/app/x/page.tsx", text: `"use client";\nexport default function P(){ console.log("browser"); return null; }` }]);
      expect(offenders).toEqual([]);
    });
    it('a "use client" directive buried after real code does NOT exempt (directive must lead)', () => {
      const text = `export const x = 1;\n"use client";\nconsole.log("still server");`;
      expect(isClientFile(text)).toBe(false);
      expect(detectConsole([{ rel: "src/app/app/y/page.tsx", text }])).toEqual(["src/app/app/y/page.tsx:3"]);
    });
    it("allows console inside the observability logger module", () => {
      const offenders = detectConsole([{ rel: "src/infrastructure/observability/logger.ts", text: `console.error("transport");` }]);
      expect(offenders).toEqual([]);
    });
  });
});
