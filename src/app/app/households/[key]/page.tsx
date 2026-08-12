"use client";

/**
 * /app/households/[key] - one household in depth (ADR-0057).
 *
 * The key is the world's stable household slug, so the URL reads as a household
 * and survives a regeneration. Authorization still happens server-side in
 * `/api/households/[key]`: a key belonging to another firm's book resolves to
 * the same "not in this firm's book" as a key that does not exist.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState } from "@app/presentation/ui";
import { HouseholdDetail } from "@app/households/detail";
import type { HouseholdDetailVM } from "@app/households/model";

export const runtime = "nodejs";

export default function HouseholdPage() {
  const params = useParams<{ key: string }>();
  const key = typeof params.key === "string" ? params.key : "";
  const [household, setHousehold] = useState<HouseholdDetailVM | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let active = true;
    fetch(`/api/households/${encodeURIComponent(key)}`)
      .then(async (res) => {
        if (res.status === 404) throw new Error("not-found");
        if (!res.ok) throw new Error("failed");
        return (await res.json()) as { household: HouseholdDetailVM };
      })
      .then(
        (body) => {
          if (active) setHousehold(body.household);
        },
        (cause: Error) => {
          if (!active) return;
          setError(
            cause.message === "not-found"
              ? "That household is not in this firm's book. It may have been renamed, or the link may be from another firm."
              : "This household could not be loaded. Check your connection and reload.",
          );
        },
      );
    return () => {
      active = false;
    };
  }, [key]);

  if (error) {
    return (
      <EmptyState
        title="Household unavailable"
        description={error}
        action={<Link className="text-sm text-slate-800 underline underline-offset-2" href="/app/households">Back to all households</Link>}
      />
    );
  }
  if (!household) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
        <div className="h-40 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-64 w-full animate-pulse rounded bg-slate-100" />
      </div>
    );
  }
  return <HouseholdDetail household={household} />;
}
