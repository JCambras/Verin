"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

/**
 * WCAG 1.4.13 needs two things a CSS-only tooltip cannot give: Escape must dismiss the
 * content while the trigger keeps focus, and the pointer must be able to travel into the
 * panel without crossing an unhovered gap. The offset is therefore padding INSIDE the
 * hoverable wrapper rather than a margin between it and the trigger.
 *
 * Dismissible is owed to POINTER users too, and a pointer user has no focus inside this
 * subtree for a wrapper key handler to see - their Escape goes to the document. So
 * visibility is state, not `group-hover`, and the document listener exists exactly while
 * the panel is shown: nothing is bound when no tooltip is up, and unmount removes it.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (!shown) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDismissed(true);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shown]);

  // A dismissal is released only once the tooltip is no longer triggered at all: releasing
  // it on the first of pointer or focus to leave would re-show content the viewer
  // explicitly dismissed while the other trigger was still on it.
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        if (!focused) setDismissed(false);
      }}
    >
      <span
        tabIndex={0}
        aria-describedby={id}
        className="inline-flex cursor-help"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (!hovered) setDismissed(false);
        }}
      >
        {children}
      </span>
      <span
        data-testid="tooltip-panel"
        data-state={dismissed ? "dismissed" : "available"}
        className={`absolute bottom-full left-1/2 z-20 w-max max-w-64 -translate-x-1/2 pb-2 ${
          shown ? "visible" : "invisible"
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
