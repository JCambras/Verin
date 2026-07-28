/**
 * ExecutionTimeline (design language §8.1) - the register idiom (audit-trail table
 * lineage): uppercase text-xs headers on bg-surface, divide-y rows, one row per
 * execution step. Honest status is the doctrine: `submitted` never renders green and
 * always carries its honesty line; NIGO and stuck are first-class rows with
 * affordances; a duplicate-suppressed row is a calm non-event whose idempotency key
 * matches the original byte-for-byte inside the TapToVerify detail (§8.3 - the
 * product claim is "Verin did not send it again"; "idempotency" stays out of primary
 * copy). The timeline is append-only in presentation just as the ledger is in storage.
 */
import { StatusBadge } from "./ui";
import { TapToVerify, type VerifyDetail } from "./tap-to-verify";
import { DevProvenanceBadge } from "./dev-provenance-badge";

export interface ExecutionTimelineRow {
  readonly step: string;
  readonly target: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly timestamp: string;
  readonly timestampIso: string;
  readonly honestyLine?: string;
  readonly plainClaim?: string;
  readonly affordanceLabel?: string;
  readonly identifiers: readonly VerifyDetail[];
  readonly devBadgeLabel: string;
}

export function ExecutionTimeline({ caption, rows }: { caption: string; rows: readonly ExecutionTimelineRow[] }) {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-slate-600"
    >
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2">Step</th>
            <th scope="col" className="px-3 py-2">Target</th>
            <th scope="col" className="px-3 py-2">Status</th>
            <th scope="col" className="px-3 py-2">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr
              key={`${r.step}-${r.timestamp}`}
              className="print-avoid-break"
              data-testid="timeline-event"
              data-event-instant={r.timestampIso}
            >
              <td className="px-3 py-2 align-top">
                <div className="flex flex-col items-start gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-slate-800">
                    {r.step}
                    <DevProvenanceBadge label={r.devBadgeLabel} />
                  </span>
                  {r.honestyLine ? <span className="text-xs text-slate-600">{r.honestyLine}</span> : null}
                  {r.plainClaim ? <span className="text-sm text-slate-700">{r.plainClaim}</span> : null}
                  {r.affordanceLabel ? (
                    <button type="button" className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
                      {r.affordanceLabel}
                    </button>
                  ) : null}
                  <TapToVerify details={r.identifiers} />
                </div>
              </td>
              <td className="px-3 py-2 align-top text-slate-700">{r.target}</td>
              <td className="px-3 py-2 align-top">
                <StatusBadge status={r.status} label={r.statusLabel} />
              </td>
              <td className="px-3 py-2 align-top whitespace-nowrap text-slate-700">{r.timestamp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
