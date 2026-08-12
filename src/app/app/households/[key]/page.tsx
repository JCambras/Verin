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

/**
 * ONE outcome, and it is TAGGED with the key it answers for. This component
 * serves every household, so the key can change under it; a `household` and an
 * `error` held as two independent values then describe DIFFERENT keys - follow
 * a cross-household link this firm's book does not contain, come back, and the
 * refetch that succeeds still renders "Household unavailable" because nothing
 * cleared the error.
 *
 * That the App Router happens to remount this page on a dynamic-param change is
 * not the guarantee: it is a framework detail, and the page owes the reader the
 * contract itself. An outcome whose key is not the key on screen is not shown,
 * so a result can never outlive the question it answered
 * (`src/__tests__/unit/household-detail-page.test.tsx` re-renders one instance
 * across the key change, which is the only way to assert that here).
 */
type Outcome =
  | { readonly status: "loaded"; readonly household: HouseholdDetailVM }
  | { readonly status: "failed"; readonly message: string };

export default function HouseholdPage() {
  const params = useParams<{ key: string }>();
  const key = typeof params.key === "string" ? params.key : "";
  const [settled, setSettled] = useState<{ key: string; outcome: Outcome } | null>(null);

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
          if (active) setSettled({ key, outcome: { status: "loaded", household: body.household } });
        },
        (cause: Error) => {
          if (!active) return;
          setSettled({
            key,
            outcome: {
              status: "failed",
              message: cause.message === "not-found"
                ? "That household is not in this firm's book. It may have been renamed, or the link may be from another firm."
                : "This household could not be loaded. Check your connection and reload.",
            },
          });
        },
      );
    return () => {
      active = false;
    };
  }, [key]);

  const shown = settled !== null && settled.key === key ? settled.outcome : null;
  if (shown?.status === "failed") {
    return (
      <EmptyState
        title="Household unavailable"
        description={shown.message}
        action={<Link className="text-sm text-slate-800 underline underline-offset-2" href="/app/households">Back to all households</Link>}
      />
    );
  }
  if (shown === null) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
        <div className="h-40 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-64 w-full animate-pulse rounded bg-slate-100" />
      </div>
    );
  }
  return <HouseholdDetail household={shown.household} />;
}
