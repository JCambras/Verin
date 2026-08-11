"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "./ui";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly panel: ReactNode;
  readonly disabled?: boolean;
}

export function Tabs({
  label,
  items,
  defaultId,
}: {
  label: string;
  items: readonly TabItem[];
  defaultId?: string;
}) {
  const baseId = useId();
  const available = items.filter((item) => !item.disabled);
  const [activeId, setActiveId] = useState(
    () => available.find((item) => item.id === defaultId)?.id ?? available[0]?.id ?? items[0]?.id ?? "",
  );
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const active = items.find((item) => item.id === activeId) ?? available[0] ?? items[0];

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, itemId: string) {
    const index = available.findIndex((item) => item.id === itemId);
    if (index < 0 || available.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % available.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + available.length) % available.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = available.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = available[nextIndex];
    if (!next) return;
    setActiveId(next.id);
    refs.current.get(next.id)?.focus();
  }

  if (!active) return null;

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-slate-200">
        {items.map((item) => {
          const selected = item.id === active.id;
          return (
            <Button
              key={item.id}
              ref={(node) => {
                if (node) refs.current.set(item.id, node);
                else refs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-controls={`${baseId}-panel-${item.id}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              variant="ghost"
              size="compact"
              onClick={() => setActiveId(item.id)}
              onKeyDown={(event) => onKeyDown(event, item.id)}
              className={selected ? "rounded-b-none border-b-2 border-slate-900 text-slate-900" : "rounded-b-none"}
            >
              {item.label}
            </Button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${active.id}`}
        aria-labelledby={`${baseId}-tab-${active.id}`}
        tabIndex={0}
        className="pt-4"
      >
        {active.panel}
      </div>
    </div>
  );
}
