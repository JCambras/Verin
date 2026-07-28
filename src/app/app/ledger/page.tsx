"use client";

import { useEffect, useState } from "react";
import type { LedgerRegisterViewModel } from "@app/ledger/model";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { StatusBadge } from "@app/presentation/ui";

export default function DecisionLedgerPage() {
  const [model, setModel] = useState<LedgerRegisterViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/ledger");
        if (response.ok) {
          setModel(await response.json() as LedgerRegisterViewModel);
        } else if (response.status === 403) {
          setError("You do not have permission to view the decision ledger.");
        } else {
          setError("Could not load the decision ledger.");
        }
      } catch {
        setError("Could not load the decision ledger. Check your connection and reload.");
      }
    })();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Decision ledger
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Immutable decision events in their recorded order. Integrity checks
          cover stored bytes, typed schemas, indexed fields, and the chain anchor.
        </p>
      </div>

      {!model && !error ? (
        <p className="text-sm text-slate-600">Loading…</p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {error}
        </p>
      ) : null}

      {model ? (
        <>
          <section
            aria-labelledby="ledger-integrity-heading"
            data-testid="ledger-verdict"
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex items-center gap-3">
              <h2
                id="ledger-integrity-heading"
                className="text-sm font-semibold text-slate-900"
              >
                Integrity
              </h2>
              <StatusBadge
                status={model.verification.ok ? "done" : "failed"}
                label={model.verification.ok ? "L1-L4 verified" : "Verification failed"}
              />
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-4">
              {model.verification.levels.map((level) => (
                <li key={level.level} className="rounded border border-slate-200 px-3 py-2">
                  <p className="font-mono text-xs font-semibold text-slate-900">
                    {level.level}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {level.ok
                      ? `${level.entriesChecked} checked`
                      : level.reason ?? "Failed"}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {model.entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              No decision events have been recorded for this firm.
            </p>
          ) : (
            <div
              role="region"
              aria-label="Decision ledger entries"
              tabIndex={0}
              className="overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-slate-600"
            >
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Decision ledger entries, newest first
                </caption>
                <thead className="bg-surface text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2">#</th>
                    <th scope="col" className="px-3 py-2">Event</th>
                    <th scope="col" className="px-3 py-2">Actor</th>
                    <th scope="col" className="px-3 py-2">Decision</th>
                    <th scope="col" className="px-3 py-2">Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {model.entries.map((entry) => (
                    <tr key={entry.sequence}>
                      <td className="px-3 py-2 text-slate-600">
                        {entry.sequence}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-mono text-xs text-slate-800">
                          {entry.eventType}
                        </p>
                        <time
                          dateTime={entry.occurredAt}
                          className="mt-1 block whitespace-nowrap text-xs text-slate-600"
                        >
                          {new Date(entry.occurredAt).toLocaleString()}
                        </time>
                        {entry.provenanceLabel ? (
                          <span className="mt-1 inline-block">
                            <DevProvenanceBadge label={entry.provenanceLabel} />
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-800">
                        {entry.actor}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">
                        {entry.decisionId ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {entry.entryHash}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {model.total > model.entries.length ? (
            <p className="text-sm text-slate-600">
              Showing the latest {model.entries.length} of {model.total} events.
              Verification covers the full chain.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
