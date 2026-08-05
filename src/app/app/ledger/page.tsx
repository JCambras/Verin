"use client";

import { useEffect, useState } from "react";
import type { LedgerRegisterViewModel } from "@app/ledger/model";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { StatusBadge } from "@app/presentation/ui";
import { Metric } from "@app/presentation/metric";

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

          {model.decisions.length > 0 ? (
            <section
              aria-labelledby="ledger-state-heading"
              data-testid="ledger-decision-state"
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h2
                id="ledger-state-heading"
                className="text-sm font-semibold text-slate-900"
              >
                Replayed decision state
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Folded from the recorded events below, in ledger order. Nothing
                here is evaluated or inferred.
                {model.decisionsTotal > model.decisions.length
                  ? ` Showing ${model.decisions.length} of ${model.decisionsTotal} replayable decisions in this verified window.`
                  : null}
              </p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {model.decisions.map((decision) => (
                  <li
                    key={decision.decisionId}
                    className="rounded border border-slate-200 px-3 py-2"
                  >
                    <p className="font-mono text-xs text-slate-800">
                      {decision.decisionId}
                    </p>
                    <p className="mt-1 text-sm text-slate-900">
                      {decision.disposition} · {decision.approvalMode}
                    </p>
                    <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-slate-700">
                      <dt>Approval stages</dt>
                      <dd>
                        {decision.approvalStages.length === 0
                          ? "none"
                          : decision.approvalStages
                              .map((stage) => `${stage.stageId}: ${stage.status}`)
                              .join(", ")}
                      </dd>
                      <dt>Active reservations</dt>
                      <dd><Metric metric={decision.activeReservations} /></dd>
                      <dt>Execution steps</dt>
                      <dd><Metric metric={decision.executionSteps} /></dd>
                      <dt>Exception requested</dt>
                      <dd>{decision.exceptionRequested ? "yes" : "no"}</dd>
                      <dt>Last event</dt>
                      <dd className="font-mono">
                        {decision.lastEventType} (#{decision.lastSequence})
                      </dd>
                    </dl>
                    {decision.provenanceLabel ? (
                      <span className="mt-2 inline-block">
                        <DevProvenanceBadge label={decision.provenanceLabel} />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!model.verification.ok ? (
            <p
              role="alert"
              data-testid="ledger-entries-withheld"
              className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              Decision entries are withheld because integrity verification
              failed. Restore and verify the ledger before inspecting its
              recorded data.
            </p>
          ) : model.total === 0 ? (
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
          {model.verification.ok && model.total > model.entries.length ? (
            <p className="text-sm text-slate-600">
              Showing the latest {model.entries.length} of {model.total} events.
              {model.verification.entriesChecked < model.verification.entriesStored
                ? ` Integrity above covers the latest ${model.verification.entriesChecked} entries and their link to the preceding stored hash; the full chain is verified by the audit-chain-verify gate.`
                : " Verification covers the full chain."}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
