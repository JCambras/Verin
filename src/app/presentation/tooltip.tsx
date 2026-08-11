import { useId, type ReactNode } from "react";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <span tabIndex={0} aria-describedby={id} className="inline-flex cursor-help">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className="invisible absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-slate-900 px-3 py-2 text-xs text-white group-hover:visible group-focus-within:visible"
      >
        {label}
      </span>
    </span>
  );
}
