"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * WCAG 1.4.13 needs two things a CSS-only tooltip cannot give: Escape must dismiss the
 * content while the trigger keeps focus, and the pointer must be able to travel into the
 * panel without crossing an unhovered gap. The offset is therefore padding INSIDE the
 * hoverable wrapper rather than a margin between it and the trigger.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Escape") setDismissed(true);
  }

  return (
    <span
      className="group relative inline-flex"
      onKeyDown={handleKeyDown}
      onBlurCapture={() => setDismissed(false)}
      onMouseLeave={() => setDismissed(false)}
    >
      <span tabIndex={0} aria-describedby={id} className="inline-flex cursor-help">
        {children}
      </span>
      <span
        data-testid="tooltip-panel"
        data-state={dismissed ? "dismissed" : "available"}
        className={`invisible absolute bottom-full left-1/2 z-20 w-max max-w-64 -translate-x-1/2 pb-2 ${
          dismissed ? "" : "group-hover:visible group-focus-within:visible"
        }`}
      >
        <span
          id={id}
          role="tooltip"
          className="block rounded-md border border-slate-200 bg-slate-900 px-3 py-2 text-xs text-white"
        >
          {label}
        </span>
      </span>
    </span>
  );
}
