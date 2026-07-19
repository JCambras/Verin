import { describe, it, expect } from "vitest";
import { readShipped } from "./_fence-utils";

/**
 * AUDITED-WRITE-REQUIRED + ANTI-FORK FENCE (ADR-0007/0009, charter #13). Every
 * house-CRM mutation routes through the auditedWrite helper (so audit is
 * by-construction), and the audit-enqueue primitive is called ONLY inside that
 * helper — no hand-rolled audits (retro-r7 don't-again #37: the copy-paste class
 * survives in the newest methods).
 */

// The ONLY files allowed to call enqueueAudit: the helper + its own definition.
const AUDIT_CALLER_ALLOW = ["src/infrastructure/audit/audited-write.ts", "src/infrastructure/audit/audit-store.ts"];
// The CRM data adapters — their mutations must go through auditedWrite (tx inside perform),
// never a direct db.query mutation.
const CRM_ADAPTERS = ["src/infrastructure/crm/house-crm.ts", "src/infrastructure/crm/application-store.ts"];

export function detectHandRolledAudit(rel: string, text: string): boolean {
  if (AUDIT_CALLER_ALLOW.includes(rel.replace(/\\/g, "/"))) return false;
  return /\benqueueAudit\s*\(/.test(text);
}

export function detectUnauditedMutation(text: string): string[] {
  const out: string[] = [];
  // A direct db.query with a mutation verb bypasses auditedWrite's transaction.
  const re = /\bdb\s*\.\s*query\s*\(\s*[`'"][^`'"]*\b(INSERT|UPDATE|DELETE)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!);
  return out;
}

describe("audited-write-required fence", () => {
  it("anti-fork: enqueueAudit is called only inside the audited-write helper", () => {
    const offenders = readShipped()
      .filter(({ rel, text }) => detectHandRolledAudit(rel, text))
      .map(({ rel }) => rel);
    expect(offenders, `hand-rolled audit calls (must route through auditedWrite):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("enforces: CRM data adapters have no direct db.query mutation (must use auditedWrite)", () => {
    const offenders: string[] = [];
    for (const { rel, text } of readShipped()) {
      if (!CRM_ADAPTERS.includes(rel.replace(/\\/g, "/"))) continue;
      const verbs = detectUnauditedMutation(text);
      if (verbs.length) offenders.push(`${rel}: ${verbs.join(",")}`);
      // and it must actually use the helper (allowing a generic type argument)
      if (!/\bauditedWrite\s*(<[^>]*>)?\s*\(/.test(text)) offenders.push(`${rel}: no auditedWrite call`);
    }
    expect(offenders, `unaudited mutations:\n${offenders.join("\n")}`).toEqual([]);
  });

  describe("detects (companion): planted violations are caught", () => {
    it("flags enqueueAudit outside the helper", () => {
      expect(detectHandRolledAudit("src/infrastructure/crm/evil.ts", `await enqueueAudit(tx, intent, "success", now);`)).toBe(true);
    });
    it("flags a direct db.query mutation", () => {
      expect(detectUnauditedMutation(`await db.query("UPDATE households SET name=$1", [n]);`)).toEqual(["UPDATE"]);
    });
    it("allows enqueueAudit inside the helper itself", () => {
      expect(detectHandRolledAudit("src/infrastructure/audit/audited-write.ts", `await enqueueAudit(tx, intent, "success", now);`)).toBe(false);
    });
  });
});
