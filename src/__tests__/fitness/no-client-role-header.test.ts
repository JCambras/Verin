import { describe, it, expect } from "vitest";
import { readShipped, stripComments } from "./_fence-utils";

/**
 * NO-CLIENT-ROLE-HEADER FENCE (ADR-0008, charter #12, STRIDE T-S1). Identity and
 * role are NEVER read from a request header or body — only from the server-side
 * session (resolveSession). Iris trusted an x-user-role header; that is a forgeable
 * authz bypass. Bans reading a role/user identity header from the request.
 */
// Any header whose name suggests identity/role/tenant is off-limits (Vale V16:
// allowlist-ish, not four hardcoded names). Identity comes only from the session.
const BANNED = [
  /\.headers\s*\.\s*get\(\s*["'`]x-[^"'`]*(role|user|actor|tenant|org|principal|identity|email)[^"'`]*["'`]/i,
  /["'`]x-user-role["'`]/i,
];

export function detectClientRoleHeader(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    const clean = stripComments(line);
    if (BANNED.some((re) => re.test(clean))) count += 1;
  }
  return count;
}

describe("no-client-role-header fence", () => {
  it("enforces: no role/identity is read from a request header", () => {
    const offenders: string[] = [];
    for (const { rel, text } of readShipped()) {
      if (rel.endsWith("no-client-role-header.test.ts")) continue;
      if (detectClientRoleHeader(text) > 0) offenders.push(rel);
    }
    expect(offenders, `client role/identity header reads:\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): a planted header read is caught", () => {
    it("flags reading x-user-role from headers", () => {
      expect(detectClientRoleHeader(`const role = req.headers.get("x-user-role");`)).toBe(1);
    });
    it("ignores legitimate header reads", () => {
      expect(detectClientRoleHeader(`const ct = req.headers.get("content-type");`)).toBe(0);
    });
  });
});
