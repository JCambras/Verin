import { describe, it, expect } from "vitest";
import { walk, REPO_ROOT } from "./_fence-utils";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

/**
 * BOUNDED-REQUEST-BODY FENCE (STRIDE T-D1 / Sable F2). App-Router route handlers do
 * not inherit a body-size limit, so a raw `req.json()` buffers an attacker-sized
 * body (memory DoS). Every route must read the body through the bounded
 * `readJsonBody` helper, never `req.json()` / `request.json()`.
 */
export function detectRawJsonBody(text: string): number {
  const clean = text.replace(/\/\/.*$/gm, "");
  const matches = clean.match(/\b(req|request)\s*\.\s*json\s*\(/g);
  return matches ? matches.length : 0;
}

describe("bounded-request-body fence", () => {
  it("enforces: no route reads the body with a raw req.json()", () => {
    const routes = walk(`${REPO_ROOT}src/app`, (f) => f.endsWith("route.ts"));
    const offenders: string[] = [];
    for (const abs of routes) {
      if (detectRawJsonBody(readFileSync(abs, "utf8")) > 0) offenders.push(relative(REPO_ROOT, abs));
    }
    expect(offenders, `routes using raw req.json() (use readJsonBody):\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a raw req.json() is caught", () => {
    it("flags req.json()", () => {
      expect(detectRawJsonBody(`const b = await req.json();`)).toBe(1);
    });
    it("allows readJsonBody", () => {
      expect(detectRawJsonBody(`const b = await readJsonBody(req);`)).toBe(0);
    });
  });
});
