"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonClassName, StatusBadge } from "@app/presentation/ui";
import { Table, type TableColumn, type TableRow } from "@app/presentation/table";

const COLUMNS: readonly TableColumn[] = [
  { id: "sequence", header: "#", align: "right", sortable: true },
  { id: "when", header: "When", sortable: true },
  { id: "actor", header: "Actor", sortable: true },
  { id: "action", header: "Action", sortable: true },
  { id: "detail", header: "Detail", sortable: true },
  { id: "hash", header: "Hash", sortable: true },
];

interface Verdict {
  ok: boolean;
  entriesChecked: number;
  reason: string | null;
}
interface Entry {
  sequence: number;
  actor: string;
  action: string;
  entityType: string;
  detail: string;
  createdAt: string;
  entryHash: string;
}

export default function AuditPage() {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/audit");
        if (res.ok) {
          const body = await res.json();
          setVerdict(body.verdict);
          setEntries(body.entries);
          setTotal(body.total);
        } else if (res.status === 403) {
          setError("You do not have permission to view the audit trail (requires ops role or higher).");
        } else {
          setError("Could not load the audit trail.");
        }
      } catch {
        setError("Could not load the audit trail. Check your connection and reload.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rows: readonly TableRow[] = entries.map((entry) => ({
    id: String(entry.sequence),
    cells: {
      sequence: { content: entry.sequence, sortValue: entry.sequence, className: "text-slate-600" },
      when: {
        content: <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>,
        sortValue: entry.createdAt,
        className: "whitespace-nowrap",
      },
      actor: { content: entry.actor, sortValue: entry.actor, className: "text-slate-800" },
      action: { content: entry.action, sortValue: entry.action, className: "font-mono text-xs text-slate-800" },
      detail: { content: entry.detail, sortValue: entry.detail },
      hash: {
        content: `${entry.entryHash}…`,
        sortValue: entry.entryHash,
        className: "font-mono text-xs text-slate-500",
      },
    },
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Audit trail</h1>
        <p className="mt-1 text-sm text-slate-600">
          Append-only and hash-chained. The integrity verdict below is recomputed from the chain on every load —
          any edit, reorder, or deletion is detected.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      {verdict ? (
        <div className="flex items-center gap-3" data-testid="audit-verdict" role={verdict.ok ? "status" : "alert"}>
          <StatusBadge status={verdict.ok ? "done" : "failed"} label={verdict.ok ? "Chain verified" : "Chain BROKEN"} />
          <span className="text-sm text-slate-600">
            {verdict.entriesChecked} entries checked{verdict.reason ? ` · ${verdict.reason}` : ""}
          </span>
        </div>
      ) : null}

      {!error ? (
        <div className="flex flex-col gap-2">
          {total > entries.length ? (
            <p className="text-sm text-slate-600">
              Showing the latest {entries.length} of {total} entries (the integrity verdict covers all {total}).
            </p>
          ) : null}
          <Table
            caption="Audit log entries, newest first"
            columns={COLUMNS}
            rows={rows}
            loading={loading}
            emptyState={{
              title: "No audit events yet",
              description: "Run a governed action to create the first tamper-evident entry.",
              action: <Link href="/app/account-opening" className={buttonClassName()}>Open an account</Link>,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
