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
    { href: "/app/account-opening", label: "Open account" },
    { href: "/app/console", label: "Console" },
    { href: "/app/audit", label: "Audit trail" },
  ];
  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
      <nav className="flex items-center gap-5 text-sm" aria-label="Primary">
        <Link href="/app" className="text-lg" aria-current={pathname === "/app" ? "page" : undefined}>
          <Wordmark />
        </Link>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={pathname === l.href ? "page" : undefined}
            className="text-slate-700 hover:text-slate-900 aria-[current=page]:font-semibold aria-[current=page]:text-slate-900"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-3 text-sm">
        {error ? (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        ) : null}
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
