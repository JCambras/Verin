"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Wordmark } from "@app/presentation/brand";
import { Button } from "@app/presentation/ui";

export function AppNav({ actor, role }: { actor: string; role: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  async function signOut() {
    setError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error(`logout failed (${res.status})`);
      router.push("/login");
    } catch {
      setError("Sign-out failed. Check your connection and try again.");
    }
  }
  const links = [
    { href: "/app/demo", label: "Demo" },
    { href: "/app/account-opening", label: "Open account" },
    { href: "/app/console", label: "Console" },
    { href: "/app/audit", label: "Audit trail" },
  ];
  return (
    <header className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 print-hide sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <nav className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Primary">
        <Link
          href="/app"
          className="inline-flex min-h-11 min-w-11 items-center justify-center text-lg"
          aria-current={pathname === "/app" ? "page" : undefined}
        >
          <Wordmark />
        </Link>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={pathname === l.href ? "page" : undefined}
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-700 hover:text-slate-900 aria-[current=page]:font-semibold aria-[current=page]:text-slate-900"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm lg:justify-end">
        {error ? (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        ) : null}
        <span className="min-w-0 break-all text-slate-600">
          {actor} · <span className="font-medium text-slate-800">{role}</span>
        </span>
        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
