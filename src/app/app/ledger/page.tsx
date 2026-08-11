"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LedgerRegisterViewModel } from "@app/ledger/model";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { buttonClassName, Card, StatusBadge } from "@app/presentation/ui";
import { Metric } from "@app/presentation/metric";
import { Table, type TableColumn, type TableRow } from "@app/presentation/table";
import { Tooltip } from "@app/presentation/tooltip";

const COLUMNS: readonly TableColumn[] = [
  { id: "sequence", header: "#", align: "right", sortable: true },
  { id: "event", header: "Event", sortable: true },
  { id: "actor", header: "Actor", sortable: true },
  { id: "decision", header: "Decision", sortable: true },
  { id: "hash", header: "Hash", sortable: true },
];

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

  const entryRows: readonly TableRow[] = model?.entries.map((entry) => ({
    id: String(entry.sequence),
    cells: {
      sequence: { content: entry.sequence, sortValue: entry.sequence, className: "text-slate-600" },
      event: {
        content: (
          <div>
            <p className="font-mono text-xs text-slate-800">{entry.eventType}</p>
            <time dateTime={entry.occurredAt} className="mt-1 block whitespace-nowrap text-xs text-slate-600">
              {new Date(entry.occurredAt).toLocaleString()}
            </time>
            {entry.provenanceLabel ? <span className="mt-1 inline-block"><DevProvenanceBadge label={entry.provenanceLabel} /></span> : null}
          </div>
        ),
        sortValue: entry.eventType,
      },
      actor: { content: entry.actor, sortValue: entry.actor, className: "font-mono text-xs text-slate-800" },
      decision: { content: entry.decisionId ?? "-", sortValue: entry.decisionId ?? "", className: "font-mono text-xs text-slate-600" },
      hash: {
        content: <Tooltip label={entry.entryHash}>{entry.entryHash}…</Tooltip>,
        sortValue: entry.entryHash,
        className: "font-mono text-xs text-slate-500",
      },
    },
  })) ?? [];

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
          <Card
            as="section"
            variant="white"
            aria-labelledby="ledger-integrity-heading"
            data-testid="ledger-verdict"
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
          </Card>

          {model.decisions.length > 0 ? (
            <Card
              as="section"
              variant="white"
              aria-labelledby="ledger-state-heading"
              data-testid="ledger-decision-state"
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
                {model.decisionsTotal &&
                model.decisionsTotal.value > model.decisions.length ? (
                  <>
                    {" "}Showing {model.decisions.length} of{" "}
                    <Metric metric={model.decisionsTotal} /> decisions
                    replayable in this displayed event window.
                  </>
                ) : null}
              </p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {model.decisions.map((decision) => (
                  <li
                    key={decision.decisionId}
                    className="min-w-0 rounded border border-slate-200 px-3 py-2"
                  >
                    <p className="font-mono text-xs text-slate-800">
                      {decision.decisionId}
                    </p>
                    <p className="mt-1 text-sm text-slate-900">
                      {decision.disposition} · {decision.approvalMode}
                    </p>
                    <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-slate-700 [&>dd]:min-w-0">
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
            </Card>
          ) : null}

          {model.verification.ok && model.decisionsWithheld ? (
            <p
              role="status"
              data-testid="ledger-decisions-withheld"
              className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              Withheld decisions: <Metric metric={model.decisionsWithheld} />.
              Required recording or source-origin events fall outside the
              displayed event window, so those decisions are not replayed here.
            </p>
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
          ) : (
            <Table
              caption="Decision ledger entries, newest first"
              columns={COLUMNS}
              rows={entryRows}
              emptyState={{
                title: "No decision events yet",
                description: "Run the governed money-movement journey to record the first decision event.",
                action: <Link href="/app/demo" className={buttonClassName()}>Open the demo</Link>,
              }}
            />
          )}
          {model.verification.ok && model.total &&
          model.total.value > model.entries.length ? (
            <p className="text-sm text-slate-600">
              Showing the latest {model.entries.length} of{" "}
              <Metric metric={model.total} /> stored events. Verification covers
              the full chain.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
