/**
 * ProgressSteps — the account-opening pipeline made transparent (ADR-0012;
 * Meridian ProgressSteps). Accessible: an ordered list with per-step state in text.
 */
export interface ProgressStep {
  id: string;
  name: string;
  state: "done" | "active" | "pending";
}

export function ProgressSteps({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-3" aria-current={s.state === "active" ? "step" : undefined}>
          <span
            aria-hidden
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              s.state === "done"
                ? "bg-green-600 text-white"
                : s.state === "active"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600"
            }`}
          >
            {s.state === "done" ? "✓" : i + 1}
          </span>
          <span className={`text-sm ${s.state === "pending" ? "text-slate-500" : "text-slate-800"}`}>
            {s.name}
            <span className="sr-only"> — {s.state}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
