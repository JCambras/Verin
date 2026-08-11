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
import { Button } from "./ui";
import { TapToVerify, type VerifyDetail } from "./tap-to-verify";
import { DevProvenanceBadge } from "./dev-provenance-badge";
import { Table, type TableColumn, type TableRow } from "./table";

export interface ExecutionTimelineRow {
  readonly step: string;
  readonly target: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly timestamp: string;
  readonly honestyLine?: string;
  readonly plainClaim?: string;
  readonly affordanceLabel?: string;
  readonly identifiers: readonly VerifyDetail[];
  readonly devBadgeLabel: string;
}

/**
 * No column is sortable: recorded order is the register's meaning here, and a viewer
 * who could reorder it would be reading a different claim than the one made.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: "step", header: "Step" },
  { id: "target", header: "Target" },
  { id: "status", header: "Status" },
  { id: "when", header: "When" },
];

export function ExecutionTimeline({ caption, rows }: { caption: string; rows: readonly ExecutionTimelineRow[] }) {
  const tableRows: readonly TableRow[] = rows.map((row) => ({
    id: `${row.step}-${row.timestamp}`,
    cells: {
      step: {
        content: (
          <div className="flex flex-col items-start gap-1">
            <span className="flex flex-wrap items-center gap-2 text-slate-800">
              {row.step}
              <DevProvenanceBadge label={row.devBadgeLabel} />
            </span>
            {row.honestyLine ? <span className="text-xs text-slate-600">{row.honestyLine}</span> : null}
            {row.plainClaim ? <span className="text-sm text-slate-700">{row.plainClaim}</span> : null}
            {row.affordanceLabel ? <Button type="button" variant="secondary">{row.affordanceLabel}</Button> : null}
            <TapToVerify details={row.identifiers} />
          </div>
        ),
      },
      target: { content: row.target },
      status: { kind: "status", status: row.status, label: row.statusLabel },
      when: { content: row.timestamp, className: "whitespace-nowrap" },
    },
  }));
  return <Table caption={caption} columns={COLUMNS} rows={tableRows} />;
}
