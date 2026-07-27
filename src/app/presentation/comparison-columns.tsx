/**
 * ComparisonColumns (design language §10) - the Firm A / Firm B surface. Each column
 * is headed by the firm name and its ACTIVE POLICY VERSION (the version provenance is
 * the header, because it is the entire explanation of the columns). Difference is
 * hierarchy, not highlighter: agreeing rows recede; differing rows render at full
 * weight with a border-l-2 slate marker on each differing cell. No judgment colors -
 * neither firm is "right", they are differently governed. Every differing row's cause
 * is one tap away via WhyBubble, citing the policy provision per side.
 */
import type { DisplayMetric } from "@contracts/metric";
import { Metric } from "./metric";
import { StatusBadge } from "./ui";
import { WhyBubble } from "./why-bubble";

export interface ComparisonCell {
  readonly display?: string;
  readonly metric?: DisplayMetric;
  readonly badge?: { readonly status: string; readonly label: string };
}
export interface ComparisonRow {
  readonly dimension: string;
  readonly a: ComparisonCell;
  readonly b: ComparisonCell;
  readonly differs: boolean;
  readonly why?: { readonly reason: string; readonly regulation?: string };
}
export interface ComparisonColumnHeader {
  readonly firm: string;
  readonly policyVersion: string;
  readonly activeSince: string;
}

function Cell({ cell, differs }: { cell: ComparisonCell; differs: boolean }) {
  const weight = differs ? "text-sm text-slate-900" : "text-sm font-normal text-slate-500";
  const marker = differs ? "border-l-2 border-slate-900 pl-3" : "";
  return (
    <div className={`${weight} ${marker}`}>
      {cell.badge ? <StatusBadge status={cell.badge.status} label={cell.badge.label} /> : null}
      {cell.metric ? <Metric metric={cell.metric} /> : null}
      {cell.display}
    </div>
  );
}

export function ComparisonColumns({
  columns,
  rows,
}: {
  columns: readonly [ComparisonColumnHeader, ComparisonColumnHeader];
  rows: readonly ComparisonRow[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {columns.map((c) => (
          <div key={c.firm} className="flex flex-col gap-0.5 border-b border-border pb-2">
            <p className="text-base font-semibold text-slate-900">{c.firm}</p>
            <p className="font-mono text-xs text-slate-800">
              {c.policyVersion} <span className="font-sans text-xs text-slate-600">· {c.activeSince}</span>
            </p>
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.dimension} className="grid grid-cols-1 gap-x-8 gap-y-1 border-b border-slate-100 py-2 sm:grid-cols-2" data-testid={r.differs ? "comparison-differs" : "comparison-same"}>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <p className="text-xs text-slate-600">{r.dimension}</p>
          </div>
          <Cell cell={r.a} differs={r.differs} />
          <Cell cell={r.b} differs={r.differs} />
          {r.differs && r.why ? (
            <div className="sm:col-span-2">
              <WhyBubble reason={r.why.reason} {...(r.why.regulation ? { regulation: r.why.regulation } : {})} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
