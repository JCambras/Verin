"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@app/presentation/ui";

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/audit");
      if (res.ok) {
        const body = await res.json();
        setVerdict(body.verdict);
        setEntries(body.entries);
      } else if (res.status === 403) {
        setError("You do not have permission to view the audit trail (requires ops role or higher).");
      } else {
        setError("Could not load the audit trail.");
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Audit trail</h1>
        <p className="mt-1 text-sm text-slate-600">
          Append-only and hash-chained. The integrity verdict below is recomputed from the chain on every load —
          any edit, reorder, or deletion is detected.
        </p>
      </div>

      {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      {verdict ? (
        <div className="flex items-center gap-3" data-testid="audit-verdict">
          <StatusBadge status={verdict.ok ? "done" : "failed"} label={verdict.ok ? "Chain verified" : "Chain BROKEN"} />
          <span className="text-sm text-slate-600">
            {verdict.entriesChecked} entries checked{verdict.reason ? ` · ${verdict.reason}` : ""}
          </span>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Detail</th>
                <th className="px-3 py-2">Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={e.sequence}>
                  <td className="px-3 py-2 text-slate-600">{e.sequence}</td>
                  <td className="px-3 py-2 text-slate-800">{e.actor}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-800">{e.action}</td>
                  <td className="px-3 py-2 text-slate-700">{e.detail}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.entryHash}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
