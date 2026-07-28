import { redirect } from "next/navigation";
import { currentSession } from "@app/_server/session";
import { AppNav } from "./nav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-side auth guard for the whole /app section (charter #12): the session is
 * resolved here on every request; an unauthenticated visitor is redirected to
 * /login. Identity is never client-trusted.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await currentSession();
  if (!principal.ok) redirect("/login");

  return (
    <div>
      <AppNav actor={principal.value.actor} role={principal.value.role} />
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
