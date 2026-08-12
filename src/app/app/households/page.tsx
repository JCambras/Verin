"use client";

/**
 * /app/households - the household directory route (ADR-0057).
 *
 * A thin route: authorization and assembly happen server-side in
 * `/api/households` (the governed `pii.view` surface), and this renders the
 * view model it returns. Errors are sentences, never status codes.
 */
import { useEffect, useState } from "react";
import { EmptyState } from "@app/presentation/ui";
import { HouseholdDirectory } from "@app/households/directory";
import type { DirectoryVM } from "@app/households/model";

export const runtime = "nodejs";

export default function HouseholdsPage() {
  const [directory, setDirectory] = useState<DirectoryVM | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/households")
      .then(async (res) => {
        if (!res.ok) throw new Error("request failed");
        return (await res.json()) as { directory: DirectoryVM };
      })
      .then(
        (body) => {
          if (active) setDirectory(body.directory);
        },
        () => {
          if (active) setError("The household book could not be loaded. Check your connection and reload.");
        },
      );
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <EmptyState title="Households are unavailable" description={error} />;
  }
  if (!directory) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-96 w-full animate-pulse rounded bg-slate-100" />
      </div>
    );
  }
  return <HouseholdDirectory directory={directory} />;
}
