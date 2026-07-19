"use client";

/**
 * WhyBubble — the explainability doctrine (ADR-0012, Meridian CONVENTIONS.md:106-112):
 * every automated decision Verin makes can explain itself and cite the governing
 * regulation. Ships LIVE in the skeleton; usage grows flow-by-flow.
 */
import { useId, useState } from "react";

export function WhyBubble({ reason, regulation }: { reason: string; regulation?: string }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900"
      >
        Why did Verin do this?
      </button>
      {open ? (
        <span id={regionId} className="mt-1.5 block max-w-md rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 animate-slide-down">
          {reason}
          {regulation ? <span className="mt-1.5 block text-xs text-slate-600">Regulation: {regulation}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
