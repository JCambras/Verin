"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, Field, Input, StatusBadge } from "@app/presentation/ui";
import { Dialog } from "@app/presentation/dialog";
import { FreshValue } from "@app/presentation/fresh-value";
import { Metric } from "@app/presentation/metric";
import { useToast } from "@app/presentation/toast";
import { useHydrated } from "@app/presentation/use-hydrated";
import { metric } from "@contracts/metric";
import { deriveArtifactProvenance, type RecordProvenance } from "@contracts/provenance";

interface Household {
  id: string;
  name: string;
  status: string;
  provenance: RecordProvenance;
}

async function fetchHouseholds(): Promise<Household[]> {
  const res = await fetch("/api/crm/households");
  if (!res.ok) throw new Error(`households request failed (${res.status})`);
  const body = await res.json();
  return body.households as Household[];
}

export default function ConsolePage() {
  const hydrated = useHydrated();
  const { showToast } = useToast();
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [households, setHouseholds] = useState<Household[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Household | null>(null);
  // The dialog is modal, so the page behind it is inert: a rename failure has to
  // report inside the dialog or the viewer sees nothing happen at all.
  const [renameError, setRenameError] = useState<string | null>(null);

  function openRename(household: Household) {
    setRenameError(null);
    setRenameTarget(household);
  }

  function closeRename() {
    setRenameError(null);
    setRenameTarget(null);
  }

  function load(list: Household[]) {
    setHouseholds(list);
    setAsOf(new Date().toISOString()); // the derived-count metric is "computed" as of this read
  }

  useEffect(() => {
    let active = true;
    fetchHouseholds().then(
      (h) => {
        if (active) load(h);
      },
      () => {
        if (active) setError("Could not load households. Check your connection and reload.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function reload() {
    try {
      load(await fetchHouseholds());
    } catch {
      setError("Could not refresh the household list.");
    }
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setError(null);
    const name = String(new FormData(form).get("name") ?? "");
    try {
      const res = await fetch("/api/crm/households", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        form.reset();
        await reload();
        showToast({ title: "Household created", description: `${name} is ready to use.` });
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body?.error?.message ?? "Could not create household.");
      }
    } catch {
      setError("Could not create household. Check your connection and try again.");
    }
  }

  async function rename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!renameTarget) return;
    const next = String(new FormData(e.currentTarget).get("rename") ?? "").trim();
    if (!next || next === renameTarget.name) {
      closeRename();
      return;
    }
    setRenameError(null);
    try {
      const res = await fetch("/api/crm/households", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: renameTarget.id, name: next }),
      });
      if (res.ok) {
        await reload();
        closeRename();
        showToast({ title: "Household renamed", description: `${next} is now current.` });
      } else {
        const body = await res.json().catch(() => ({}));
        setRenameError(body?.error?.message ?? "Could not rename (needs ops role or higher).");
      }
    } catch {
      setRenameError("Could not rename the household. Check your connection and try again.");
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
        {households !== null && asOf !== null ? (
          <p className="mt-3 text-sm text-slate-700" data-testid="household-count">
            Households in your book:{" "}
            <Metric metric={metric(households.length, "count", deriveArtifactProvenance(households.map((h) => h.provenance), asOf))} />
          </p>
        ) : null}
      </div>

      <form onSubmit={create} className="flex items-end gap-3" aria-label="Create household">
        <Field label="New household name" htmlFor="name">
          <Input ref={createInputRef} id="name" name="name" required />
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
        error ? null : <p className="text-sm text-slate-600">Loading…</p>
      ) : households.length === 0 ? (
        <EmptyState
          title="No households yet"
          description="Create your first household above, or open an account to create one through the flow."
          action={<Button type="button" onClick={() => createInputRef.current?.focus()}>Create a household</Button>}
        />
      ) : (
        <Card as="ul" variant="white" padding="none" className="flex flex-col divide-y divide-slate-200" data-testid="household-list">
          {households.map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-3">
              <span className="flex items-center gap-3">
                <FreshValue provenance={h.provenance}>
                  <span className="font-medium text-slate-900">{h.name}</span>
                </FreshValue>
                <StatusBadge status={h.status} />
              </span>
              <Button type="button" variant="secondary" aria-label={`Rename ${h.name}`} onClick={() => openRename(h)}>
                Rename
              </Button>
            </li>
          ))}
        </Card>
      )}

      <Dialog
        open={renameTarget !== null}
        title="Rename household"
        description="The updated name is recorded in the tamper-evident audit trail."
        onClose={closeRename}
        initialFocusRef={renameInputRef}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={closeRename}>Cancel</Button>
            <Button type="submit" form="rename-household-form">Save name</Button>
          </>
        )}
      >
        {renameTarget ? (
          <form id="rename-household-form" onSubmit={rename} className="flex flex-col gap-3">
            <Field label="Household name" htmlFor="rename">
              <Input ref={renameInputRef} id="rename" name="rename" defaultValue={renameTarget.name} required />
            </Field>
            {renameError ? (
              <p role="alert" data-testid="rename-error" className="text-sm text-destructive">
                {renameError}
              </p>
            ) : null}
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}
