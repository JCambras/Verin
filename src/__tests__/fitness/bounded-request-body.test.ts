import { describe, it, expect } from "vitest";
import { walk, REPO_ROOT, stripComments } from "./_fence-utils";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

/**
 * BOUNDED-REQUEST-BODY FENCE (STRIDE T-D1 / Sable F2). App-Router route handlers do
 * not inherit a body-size limit, so ANY raw whole-body reader — `req.json()`,
 * `req.text()`, `req.formData()`, `req.arrayBuffer()`, `req.blob()` — buffers an
 * attacker-sized body (memory DoS). Every route must read the body through the
 * bounded `readJsonBody` helper. Comment stripping is the shared STRING-AWARE
 * stripComments: a `//` inside a URL literal must not truncate the line and let a
 * raw reader after it evade.
 */
const BODY_READERS = ["json", "text", "formData", "arrayBuffer", "blob"] as const;
const RAW_BODY_RE = new RegExp(`\\b(req|request)\\s*\\.\\s*(${BODY_READERS.join("|")})\\s*\\(`, "g");

export function detectRawBodyRead(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    const clean = stripComments(line);
    count += clean.match(RAW_BODY_RE)?.length ?? 0;
  }
  return count;
}

describe("bounded-request-body fence", () => {
  it("enforces: no route reads the body with a raw req.json()/text()/formData()/arrayBuffer()/blob()", () => {
    const routes = walk(`${REPO_ROOT}src/app`, (f) => f.endsWith("route.ts"));
    const offenders: string[] = [];
    for (const abs of routes) {
      if (detectRawBodyRead(readFileSync(abs, "utf8")) > 0) offenders.push(relative(REPO_ROOT, abs));
    }
    expect(offenders, `routes reading the body unbounded (use readJsonBody):\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): raw body readers are caught, comment tricks are not evasions", () => {
    it("flags req.json()", () => {
      expect(detectRawBodyRead(`const b = await req.json();`)).toBe(1);
    });
    it("flags every other whole-body reader (text/formData/arrayBuffer/blob)", () => {
      expect(detectRawBodyRead(`const raw = await req.text();`)).toBe(1);
      expect(detectRawBodyRead(`const f = await request.formData();`)).toBe(1);
      expect(detectRawBodyRead(`const buf = await req.arrayBuffer();`)).toBe(1);
      expect(detectRawBodyRead(`const b = await req.blob();`)).toBe(1);
    });
    it("a // inside a string literal does not truncate the line (evasion caught)", () => {
      expect(detectRawBodyRead(`const u = "http://x.example"; const b = await req.json();`)).toBe(1);
    });
    it("a genuinely commented-out reader is not flagged", () => {
      expect(detectRawBodyRead(`// const b = await req.json();`)).toBe(0);
    });
    it("allows readJsonBody", () => {
      expect(detectRawBodyRead(`const b = await readJsonBody(req);`)).toBe(0);
    });
  });
});
