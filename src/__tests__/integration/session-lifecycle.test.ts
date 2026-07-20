import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { createUser, renewSession, deleteDeadSessions } from "@infra/identity/identity-store";
import { resolveSession, resolveAndRenewSession, signSessionCookie, parseSignedCookie } from "@infra/identity/session";
import { unwrap } from "@contracts/result";

/**
 * SESSION LIFECYCLE HARDENING (deep-review r6 finding #8, ADR-0008, charter #12).
 * Real PGlite (no mocks) proves the three additions to the expiry-only lifecycle,
 * each adversarially - detection is not verification:
 *   - sliding renewal EXTENDS `expires_at` past the hard expiry for an active session;
 *   - rotation CHANGES the session id on renewal (anti-fixation; charter's "rotation");
 *   - opportunistic cleanup DELETES long-dead rows while sparing live/recently-dead ones.
 * All of it stays inside the single identity-read chokepoint, so the auth fences hold.
 */

const ORG = "org-1";
const TTL_MINUTES = 60; // config default in the test env (vitest.config.ts)
const MIN = 60_000;

let userId: string;

async function seed(db: SqlDb): Promise<void> {
  await db.query("INSERT INTO orgs (id,name,created_at,prov_source,prov_asof,prov_confidence) VALUES ($1,'Firm',$2,'verin-crm',$2,'high')", [
    ORG,
    new Date().toISOString(),
  ]);
  const user = await createUser(db, { orgId: ORG, email: "advisor@firm.test", displayName: "A Vaez", role: "advisor", password: "correct-horse-battery" });
  userId = user.id;
}

/** Insert a session row with a controlled expiry/revocation so timing is deterministic. */
async function insertSession(db: SqlDb, id: string, opts: { expiresInMs: number; revokedMsAgo?: number }): Promise<void> {
  const now = Date.now();
  await db.query(
    "INSERT INTO sessions (id,user_id,org_id,role,created_at,expires_at,revoked_at) VALUES ($1,$2,$3,'advisor',$4,$5,$6)",
    [
      id,
      userId,
      ORG,
      new Date(now - TTL_MINUTES * MIN).toISOString(),
      new Date(now + opts.expiresInMs).toISOString(),
      opts.revokedMsAgo === undefined ? null : new Date(now - opts.revokedMsAgo).toISOString(),
    ],
  );
}

const sessionRow = (db: SqlDb, id: string) =>
  db.query<{ id: string; expires_at: string; revoked_at: string | null }>("SELECT id, expires_at, revoked_at FROM sessions WHERE id = $1", [id]);

describe("session lifecycle hardening (integration)", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await seed(db);
  });

  describe("renewSession: atomic slide + rotate", () => {
    it("rotates to a NEW id and extends expires_at in one update; the old id is gone", async () => {
      await insertSession(db, "s-aging", { expiresInMs: 20 * MIN }); // 20m left of a 60m TTL
      const before = (await sessionRow(db, "s-aging")).rows[0]!;

      const renewed = await renewSession(db, "s-aging", TTL_MINUTES);

      expect(renewed).not.toBeNull();
      expect(renewed!.id).not.toBe("s-aging"); // rotation: the id CHANGED
      // Old id no longer resolves; the new id carries the row.
      expect((await sessionRow(db, "s-aging")).rows).toHaveLength(0);
      const after = (await sessionRow(db, renewed!.id)).rows[0]!;
      expect(after).toBeDefined();
      // Renewal EXTENDED expiry well past the old hard expiry (fresh full TTL).
      expect(new Date(after.expires_at).getTime()).toBeGreaterThan(new Date(before.expires_at).getTime());
      expect(new Date(after.expires_at).getTime()).toBeGreaterThan(Date.now() + (TTL_MINUTES - 1) * MIN);
      // Exactly one session row exists (rotation replaced, did not duplicate).
      const count = await db.query<{ n: string }>("SELECT count(*) AS n FROM sessions");
      expect(Number(count.rows[0]!.n)).toBe(1);
    });

    it("refuses to renew a revoked session (the WHERE guard makes a dead row a no-op, not a resurrection)", async () => {
      await insertSession(db, "s-revoked", { expiresInMs: 20 * MIN, revokedMsAgo: 5 * MIN });
      expect(await renewSession(db, "s-revoked", TTL_MINUTES)).toBeNull();
      // Untouched: still revoked, still the same id.
      expect((await sessionRow(db, "s-revoked")).rows[0]!.revoked_at).not.toBeNull();
    });

    it("refuses to renew an already-expired session", async () => {
      await insertSession(db, "s-expired", { expiresInMs: -1 * MIN });
      expect(await renewSession(db, "s-expired", TTL_MINUTES)).toBeNull();
    });
  });

  describe("deleteDeadSessions: opportunistic cleanup", () => {
    it("deletes rows expired or revoked before the cutoff, sparing live and recently-dead ones", async () => {
      const now = Date.now();
      await insertSession(db, "dead-expired", { expiresInMs: -120 * MIN }); // long expired -> delete
      await insertSession(db, "dead-revoked", { expiresInMs: 30 * MIN, revokedMsAgo: 120 * MIN }); // revoked long ago -> delete
      await insertSession(db, "recent-expired", { expiresInMs: -10 * MIN }); // expired, but within retention -> keep
      await insertSession(db, "live", { expiresInMs: 30 * MIN }); // active -> keep

      const cutoffIso = new Date(now - TTL_MINUTES * MIN).toISOString(); // one TTL of retention
      const deleted = await deleteDeadSessions(db, cutoffIso);

      expect(deleted).toBe(2);
      const remaining = await db.query<{ id: string }>("SELECT id FROM sessions ORDER BY id ASC");
      expect(remaining.rows.map((r) => r.id)).toEqual(["live", "recent-expired"]);
    });

    it("returns 0 and deletes nothing when every session is live", async () => {
      await insertSession(db, "live-1", { expiresInMs: 30 * MIN });
      await insertSession(db, "live-2", { expiresInMs: 45 * MIN });
      expect(await deleteDeadSessions(db, new Date(Date.now() - TTL_MINUTES * MIN).toISOString())).toBe(0);
      const count = await db.query<{ n: string }>("SELECT count(*) AS n FROM sessions");
      expect(Number(count.rows[0]!.n)).toBe(2);
    });
  });

  describe("resolveAndRenewSession: the chokepoint decides renewal", () => {
    it("past the half-life: rotates the id, hands back a cookie for the new id, and the new cookie resolves", async () => {
      await insertSession(db, "s-half", { expiresInMs: 20 * MIN }); // remaining 20m < 30m (half of 60m)
      const cookie = signSessionCookie("s-half");

      const { principal, renewedCookie } = unwrap(await resolveAndRenewSession(db, cookie));

      expect(renewedCookie).not.toBeNull();
      // The principal's session id rotated away from the presented one.
      expect(principal.sessionId).not.toBe("s-half");
      expect(principal.actor).toBe("advisor@firm.test");
      // The returned cookie is signed for the NEW id...
      expect(parseSignedCookie(renewedCookie!.value)).toBe(principal.sessionId);
      expect(renewedCookie!.maxAgeSeconds).toBe(TTL_MINUTES * 60);
      // ...and it resolves cleanly on a follow-up request (the old id is gone).
      const followup = await resolveSession(db, renewedCookie!.value);
      expect(followup.ok && followup.value.sessionId).toBe(principal.sessionId);
      const stale = await resolveSession(db, cookie);
      expect(stale.ok).toBe(false);
    });

    it("well before the half-life: no rotation, no cookie, the id is unchanged", async () => {
      await insertSession(db, "s-fresh", { expiresInMs: 50 * MIN }); // remaining 50m > 30m
      const { principal, renewedCookie } = unwrap(await resolveAndRenewSession(db, signSessionCookie("s-fresh")));
      expect(renewedCookie).toBeNull();
      expect(principal.sessionId).toBe("s-fresh"); // untouched
      expect((await sessionRow(db, "s-fresh")).rows).toHaveLength(1);
    });

    it("renewal sweeps long-dead rows opportunistically (cleanup rides the rotation event)", async () => {
      await insertSession(db, "s-half", { expiresInMs: 20 * MIN }); // triggers renewal
      await insertSession(db, "dead", { expiresInMs: -120 * MIN }); // long dead -> swept during renewal
      const out = await resolveAndRenewSession(db, signSessionCookie("s-half"));
      expect(out.ok).toBe(true);
      expect((await sessionRow(db, "dead")).rows).toHaveLength(0);
    });

    it("a read-only resolveSession NEVER rotates, even past the half-life (it cannot set a cookie)", async () => {
      await insertSession(db, "s-half", { expiresInMs: 20 * MIN });
      const out = await resolveSession(db, signSessionCookie("s-half"));
      expect(out.ok && out.value.sessionId).toBe("s-half"); // id unchanged
      expect((await sessionRow(db, "s-half")).rows[0]!.id).toBe("s-half"); // row unchanged
    });

    it("an invalid/absent cookie is a typed AUTH failure with no renewal", async () => {
      const out = await resolveAndRenewSession(db, undefined);
      expect(out.ok).toBe(false);
      expect(!out.ok && out.error.code).toBe("AUTH_FAILED");
    });
  });
});
