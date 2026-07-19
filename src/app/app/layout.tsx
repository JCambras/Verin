import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@infra/store/db";
import { resolveSession, SESSION_COOKIE } from "@infra/identity/session";
import { AppNav } from "./nav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side auth guard for the whole /app section (charter #12): the session is
 * resolved here on every request; an unauthenticated visitor is redirected to
 * /login. Identity is never client-trusted.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const db = await getDb();
  const principal = await resolveSession(db, cookieStore.get(SESSION_COOKIE)?.value);
  if (!principal.ok) redirect("/login");

  return (
    <div>
      <AppNav actor={principal.value.actor} role={principal.value.role} />
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
