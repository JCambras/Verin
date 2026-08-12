"use client";

/**
 * TapToVerify (design language §6.6) - the tap-to-verify-source affordance of
 * PRODUCT-DIRECTION §7: the provenance of one fact (source system, record ids,
 * observed/retrieved times, the confidence WORD - never a number), one tap from the
 * value. The interaction derives from the WhyBubble disclosure recipe; it stays
 * DISTINCT from WhyBubble (provenance-of-a-fact vs reasoning-for-a-decision) and the
 * two never merge.
 */
import { useId, useState } from "react";
import { Button } from "./ui";

export interface VerifyDetail {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

export function TapToVerify({ details }: { details: readonly VerifyDetail[] }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <span className="inline-flex flex-col items-start">
      <Button
        type="button"
        variant="text"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
      >
        Verify source
      </Button>
      {open ? (
        <span id={regionId} className="mt-1.5 block max-w-md rounded-md border border-slate-200 bg-slate-50 p-3 animate-slide-down">
          <span className="flex flex-col gap-1">
            {details.map((d) => (
              <span key={d.label} className="text-xs text-slate-600">
                {d.label}: <span className={d.mono ? "font-mono text-xs text-slate-800" : "text-slate-800"}>{d.value}</span>
              </span>
            ))}
          </span>
        </span>
      ) : null}
    </span>
  );
}
