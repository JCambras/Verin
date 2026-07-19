import { describe, it, expect } from "vitest";
import { walk, REPO_ROOT } from "./_fence-utils";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

/**
 * AUTH-ENFORCEMENT FENCE (ADR-0008, charter #12). Every API route that exports an
 * HTTP handler must resolve the principal server-side (requirePrincipal /
 * requirePrincipalWithRole / resolveSession) — unless it is in the explicit
 * UNAUTHENTICATED allowlist. No route may silently skip auth.
 */
// Match function AND const-arrow handlers (Vale V10: `export const POST = …` evaded).
const HANDLER_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/;
const RESOLVES_SESSION = /require(?:Principal|PrincipalWithRole)\s*\(|resolveSession\s*\(/;

// Deliberately unauthenticated (each documented in the route + threat model):
const UNAUTHENTICATED = new Set([
  "src/app/health/route.ts", // liveness
  "src/app/ready/route.ts", // readiness
  "src/app/api/auth/login/route.ts", // does its own credential check
  "src/app/api/esign/webhook/route.ts", // HMAC token auth (external provider)
]);

export function routeNeedsAuth(rel: string, text: string): boolean {
  if (UNAUTHENTICATED.has(rel.replace(/\\/g, "/"))) return false;
  if (!HANDLER_RE.test(text)) return false;
  return !RESOLVES_SESSION.test(text);
}

describe("auth-enforcement fence", () => {
  it("enforces: every non-allowlisted API route resolves a session", () => {
    const routes = walk(`${REPO_ROOT}src/app`, (f) => f.endsWith("route.ts"));
    const offenders: string[] = [];
    for (const abs of routes) {
      const rel = relative(REPO_ROOT, abs).replace(/\\/g, "/");
      const text = readFileSync(abs, "utf8");
      if (routeNeedsAuth(rel, text)) offenders.push(rel);
    }
    expect(offenders, `routes not enforcing auth:\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): an unauthenticated handler is caught", () => {
    it("flags a POST route with no session resolution", () => {
      expect(routeNeedsAuth("src/app/api/evil/route.ts", `export async function POST(req){ return Response.json({ok:true}); }`)).toBe(true);
    });
    it("passes a route that requires a principal", () => {
      expect(routeNeedsAuth("src/app/api/ok/route.ts", `export async function POST(req){ const p = await requirePrincipal(req); }`)).toBe(false);
    });
    it("allows an allowlisted unauthenticated route", () => {
      expect(routeNeedsAuth("src/app/health/route.ts", `export function GET(){ return Response.json({}); }`)).toBe(false);
    });
  });
});
