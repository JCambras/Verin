"use client";

import { useEffect, useState } from "react";
import { Field, TextInput, Button, StatusBadge, EmptyState } from "@app/presentation/ui";
import { FreshValue } from "@app/presentation/fresh-value";
import { useHydrated } from "@app/presentation/use-hydrated";
import type { RecordProvenance } from "@contracts/provenance";

interface Household {
  id: string;
  name: string;
  status: string;
  provenance: RecordProvenance;
}

async function fetchHouseholds(): Promise<Household[]> {
  const res = await fetch("/api/crm/households");
  if (!res.ok) return [];
  const body = await res.json();
  return body.households as Household[];
}

export default function ConsolePage() {
  const hydrated = useHydrated();
  const [households, setHouseholds] = useState<Household[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchHouseholds().then((h) => {
      if (active) setHouseholds(h);
    });
    return () => {
      active = false;
    };
  }, []);

  async function reload() {
    setHouseholds(await fetchHouseholds());
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    const res = await fetch("/api/crm/households", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      e.currentTarget.reset();
      await reload();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body?.error?.message ?? "Could not create household.");
    }
  }

  async function rename(id: string, current: string) {
    const next = window.prompt("New household name", current);
    if (!next || next === current) return;
    const res = await fetch("/api/crm/households", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name: next }),
    });
    if (res.ok) await reload();
    else {
      const body = await res.json().catch(() => ({}));
      setError(body?.error?.message ?? "Could not rename (needs ops role or higher).");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">House-CRM console</h1>
        <p className="mt-1 text-sm text-slate-600">
          Plain internal tooling. Every create and edit flows through the audited-write helper, so this
          console is the first live demo of the tamper-evident audit trail.
        </p>
      </div>

      <form onSubmit={create} className="flex items-end gap-3" aria-label="Create household">
        <Field label="New household name" htmlFor="name">
          <TextInput id="name" name="name" required />
        </Field>
        <Button type="submit" disabled={!hydrated}>
          Create
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {households === null ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : households.length === 0 ? (
        <EmptyState title="No households yet" description="Create your first household above, or open an account to create one through the flow." />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200 rounded-lg border border-slate-200" data-testid="household-list">
          {households.map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-3">
              <span className="flex items-center gap-3">
                <FreshValue provenance={h.provenance}>
                  <span className="font-medium text-slate-900">{h.name}</span>
                </FreshValue>
                <StatusBadge status={h.status} />
              </span>
              <Button variant="secondary" aria-label={`Rename ${h.name}`} onClick={() => rename(h.id, h.name)}>
                Rename
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
