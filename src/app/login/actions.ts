"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, sessionCookieOptions } from "@app/_server/context";
import { findUserByEmail, getPasswordHash, createSession } from "@infra/identity/identity-store";
import { verifyPassword } from "@infra/identity/password";
import { signSessionCookie, SESSION_COOKIE } from "@infra/identity/session";
import { getConfig } from "@infra/config";

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
  const user = await findUserByEmail(db, email);
  const hash = user ? await getPasswordHash(db, user.id) : null;
  const okPassword = hash ? await verifyPassword(password, hash) : false;
  if (!user || !okPassword) return { error: "Incorrect email or password." };
  if (user.status !== "active") return { error: "Account is disabled." };

  const session = await createSession(db, {
    userId: user.id,
    orgId: user.org_id,
    role: user.role,
    ttlMinutes: getConfig().session.ttlMinutes,
  });
  (await cookies()).set(SESSION_COOKIE, signSessionCookie(session.id), sessionCookieOptions());
  redirect("/app");
}
