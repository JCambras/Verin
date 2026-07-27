/**
 * DecisionSpine (design language §4) - the persistent orientation element of a
 * decision journey: a horizontal derivative of ProgressSteps sharing its state
 * vocabulary and accessibility recipe. It shows POSITION, never disposition; at most
 * one standard StatusBadge sits at its right end as the state slot. It is rendered
 * ONLY from the typed decision view model - it computes nothing.
 *
 * In-flow, one line tall, never fixed/sticky/elevated. Below `sm` it collapses to
 * the StepInfoCard kicker idiom ("Station 3 of 7 · Decision").
 */
import { StatusBadge } from "./ui";

export interface SpineStation {
  readonly id: string;
  readonly state: "done" | "active" | "pending";
}

export function DecisionSpine({
  stations,
  stateSlot,
}: {
  stations: readonly SpineStation[];
  stateSlot?: { readonly status: string; readonly label: string } | null;
}) {
  const activeIdx = stations.findIndex((s) => s.state === "active");
  const active = activeIdx >= 0 ? stations[activeIdx] : undefined;
  return (
    <div className="flex items-center gap-3 border-b border-border pb-3 print-hide" data-testid="decision-spine">
      {/* Narrow viewports: the kicker idiom, one line. */}
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600 sm:hidden">
        {active ? `Station ${activeIdx + 1} of ${stations.length} · ${active.id}` : `${stations.length} stations`}
      </p>
      <ol aria-label="Decision progress" className="hidden min-w-0 flex-1 flex-row items-center gap-2 sm:flex">
        {stations.map((s, i) => (
          <li key={s.id} className="flex min-w-0 items-center gap-2 [&:not(:last-child)]:flex-1">
            <span className="flex items-center gap-1.5" aria-current={s.state === "active" ? "step" : undefined}>
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  s.state === "done" ? "bg-green-600 text-white" : s.state === "active" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {s.state === "done" ? "✓" : i + 1}
              </span>
              <span className={`text-xs ${s.state === "pending" ? "text-slate-500" : "text-slate-800"}`}>
                {s.id}
                <span className="sr-only"> - {s.state}</span>
              </span>
            </span>
            {i < stations.length - 1 ? <span aria-hidden className="min-w-4 flex-1 border-t border-border" /> : null}
          </li>
        ))}
      </ol>
      {stateSlot ? <StatusBadge status={stateSlot.status} label={stateSlot.label} /> : null}
    </div>
  );
}
