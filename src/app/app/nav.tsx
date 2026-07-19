"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wordmark } from "@app/presentation/brand";
import { Button } from "@app/presentation/ui";

export function AppNav({ actor, role }: { actor: string; role: string }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }
  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
      <nav className="flex items-center gap-5 text-sm" aria-label="Primary">
        <Link href="/app" className="text-lg">
          <Wordmark />
        </Link>
        <Link href="/app/account-opening" className="text-slate-700 hover:text-slate-900">
          Open account
        </Link>
        <Link href="/app/console" className="text-slate-700 hover:text-slate-900">
          Console
        </Link>
        <Link href="/app/audit" className="text-slate-700 hover:text-slate-900">
          Audit trail
        </Link>
      </nav>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-slate-600">
          {actor} · <span className="font-medium text-slate-800">{role}</span>
        </span>
        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
