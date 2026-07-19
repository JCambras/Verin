import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readShipped, SRC_ROOT } from "./_fence-utils";

/**
 * AUDITED-WRITE-REQUIRED + ANTI-FORK FENCE (ADR-0007/0009, charter #13). Every
 * house-CRM mutation routes through the auditedWrite helper (so audit is
 * by-construction), and the audit-enqueue primitive is called ONLY inside that
 * helper — no hand-rolled audits (retro-r7 don't-again #37: the copy-paste class
 * survives in the newest methods).
 */

// The ONLY files allowed to call enqueueAudit: the helper + its own definition.
const AUDIT_CALLER_ALLOW = ["src/infrastructure/audit/audited-write.ts", "src/infrastructure/audit/audit-store.ts"];
// EVERY file in the CRM adapter directory is swept — a fixed file list went stale
// silently (a renamed/new adapter escaped the fence).
const CRM_ADAPTER_DIR = "src/infrastructure/crm/";
// Reviewed direct writers OUTSIDE the CRM dir: every OTHER shipped src file with a
// direct db.query mutation must appear here with the reason it may bypass
// auditedWrite. A new direct writer anywhere in src/ fails the sweep.
const REVIEWED_DIRECT_WRITERS = new Map<string, string>([
  ["src/infrastructure/audit/audit-store.ts", "the audit pipeline itself (outbox claims/deliveries, chain, anchor)"],
  ["src/infrastructure/identity/identity-store.ts", "identity/session lifecycle (users, credentials, sessions); session create/revoke are audited via auditEvent in wire.ts"],
  ["src/infrastructure/store/execution-store.ts", "workflow-engine continuation state (flow_executions), not CRM business data"],
]);

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
    const adapters = readShipped().filter(({ rel }) => rel.replace(/\\/g, "/").startsWith(CRM_ADAPTER_DIR));
    // Staleness guard (charter #4): if the adapter directory moved/emptied, this
    // fence must FAIL loudly instead of passing vacuously over zero files.
    expect(adapters.length, `no CRM adapters found under ${join(SRC_ROOT, "infrastructure", "crm")} — fence target went stale`).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { rel, text } of adapters) {
      const verbs = detectUnauditedMutation(text);
      if (verbs.length) offenders.push(`${rel}: ${verbs.join(",")}`);
      // any file issuing mutation SQL must actually use the helper (allowing a generic type argument)
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(text) && !/\bauditedWrite\s*(<[^>]*>)?\s*\(/.test(text)) {
        offenders.push(`${rel}: no auditedWrite call`);
      }
    }
    expect(offenders, `unaudited mutations:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("enforces: direct db.query mutations ANYWHERE in src/ are reviewed (allowlisted with a reason) or absent", () => {
    const offenders: string[] = [];
    for (const { rel, text } of readShipped()) {
      const norm = rel.replace(/\\/g, "/");
      if (norm.startsWith(CRM_ADAPTER_DIR)) continue; // covered (stricter) above
      if (detectUnauditedMutation(text).length === 0) continue;
      if (!REVIEWED_DIRECT_WRITERS.has(norm)) offenders.push(norm);
    }
    expect(offenders, `unreviewed direct db.query mutations (route through auditedWrite or review into the allowlist):\n${offenders.join("\n")}`).toEqual([]);
    // Staleness guard: allowlist entries must still be direct writers.
    const byRel = new Map(readShipped().map(({ rel, text }) => [rel.replace(/\\/g, "/"), text]));
    const stale = [...REVIEWED_DIRECT_WRITERS.keys()].filter((rel) => !byRel.has(rel) || detectUnauditedMutation(byRel.get(rel)!).length === 0);
    expect(stale, `REVIEWED_DIRECT_WRITERS entries that are no longer direct writers:\n${stale.join("\n")}`).toEqual([]);
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
    it("a direct mutation OUTSIDE the CRM dir and off the reviewed allowlist is caught by the global sweep", () => {
      const rel = "src/infrastructure/notes/notes-store.ts";
      expect(detectUnauditedMutation(`await db.query("INSERT INTO client_notes (id, body) VALUES ($1,$2)", [i, b]);`)).toEqual(["INSERT"]);
      expect(REVIEWED_DIRECT_WRITERS.has(rel)).toBe(false);
    });
  });
});
