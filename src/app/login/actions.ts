"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, sessionCookieOptions } from "@app/_server/context";
import { authenticate, createSession, findUserByEmail } from "@infra/identity/identity-store";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";
import { discardedAuditEventWork } from "@infra/audit/audit-store";
import { auditEvent } from "@infra/wire";
import { getConfig } from "@infra/config";
import { log } from "@infra/observability/logger";

export interface LoginState {
  error?: string;
}

/**
 * Login as a Server Action (ADR-0008). Sets the session cookie and redirects
 * atomically in ONE server response — no client Set-Cookie/navigate race, and it
 * works even before hydration (progressive enhancement). Uniform failure message
 * (no user enumeration).
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const db = await getDb();
  const user = await authenticate(db, email, password);
  if (!user) {
    // Repudiation coverage (ADR-0008): failed authentications are audited to the
    // account's org when the email resolves to a user; an unknown email has no org
    // chain to attribute to, so the attempt is logged (no PII — the email stays out)
    // after the SAME audit-pipeline DB work runs and is discarded — both failure
    // branches cost the same, so the audit cannot become an enumeration timing
    // oracle (the invariant `authenticate` preserves with its dummy scrypt hash).
    const known = await findUserByEmail(db, email);
    if (known) {
      await auditEvent(db, { orgId: known.org_id, actor: known.id, action: "session.login_failed", entityType: "User", entityId: known.id, detail: "Failed sign-in attempt" });
    } else {
      await discardedAuditEventWork(db).catch((e: unknown) =>
        log.warn({ reason: e instanceof Error ? e.message : String(e) }, "constant-work audit mirror failed"),
      );
      log.warn({ reason: "unknown-email" }, "failed sign-in attempt for an unknown email");
    }
    return { error: "Incorrect email or password." };
  }

  const session = await createSession(db, {
    userId: user.id,
    orgId: user.org_id,
    role: user.role,
    ttlMinutes: getConfig().session.ttlMinutes,
  });
  await auditEvent(db, { orgId: user.org_id, actor: user.id, action: "session.create", entityType: "Session", entityId: session.id, detail: "Signed in" });
  (await cookies()).set(SESSION_COOKIE, signSessionCookie(session.id), sessionCookieOptions());
  redirect("/app");
}
