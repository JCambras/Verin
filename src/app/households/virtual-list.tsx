"use client";

/**
 * WINDOWED LIST (ADR-0057) - the hundred-household directory scrolls smoothly
 * because only the rows in view are mounted.
 *
 * Hand-built, because the standing guardrail is zero new runtime dependencies
 * and this needs exactly one idea: a fixed row height, a scroll offset, and two
 * spacers holding the scrollbar honest.
 *
 * Accessibility is the reason the spacers are `aria-hidden` and every rendered
 * row carries `aria-setsize` / `aria-posinset`: a screen reader is told the list
 * has a hundred items and which one it is on, even though the DOM holds twenty.
 * Rendering all hundred would also be "accessible", and would jank; announcing
 * twenty as if they were the whole list would not be.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Rows rendered above and below the viewport, so a fast scroll does not show
 * blank space before the next paint. */
const OVERSCAN = 6;

export interface VirtualListProps<T> {
  readonly items: readonly T[];
  readonly rowHeight: number;
  readonly height: number;
  readonly keyOf: (item: T) => string;
  readonly children: (item: T, index: number) => ReactNode;
  readonly label: string;
  readonly emptyState: ReactNode;
}

export function VirtualList<T>({
  items, rowHeight, height, keyOf, children, label, emptyState,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element) setOffset(element.scrollTop);
  }, []);

  // A filter that shortens the list must not leave the viewport scrolled past
  // the new end, which would render as an empty list with a full scrollbar.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxOffset = Math.max(0, items.length * rowHeight - height);
    if (element.scrollTop > maxOffset) {
      element.scrollTop = maxOffset;
      setOffset(maxOffset);
    }
  }, [items.length, rowHeight, height]);

  if (items.length === 0) return <>{emptyState}</>;

  const first = Math.max(0, Math.floor(offset / rowHeight) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((offset + height) / rowHeight) + OVERSCAN);
  const visible = items.slice(first, last);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{ height, overflowY: "auto" }}
      className="rounded-lg border border-slate-200 bg-white"
      data-testid="household-list-viewport"
    >
      <ul aria-label={label} className="relative">
        <li aria-hidden="true" style={{ height: first * rowHeight }} />
        {visible.map((item, index) => (
          <li
            key={keyOf(item)}
            aria-setsize={items.length}
            aria-posinset={first + index + 1}
            style={{ height: rowHeight }}
            className="border-b border-slate-100 last:border-b-0"
          >
            {children(item, first + index)}
          </li>
        ))}
        <li aria-hidden="true" style={{ height: Math.max(0, (items.length - last) * rowHeight) }} />
      </ul>
    </div>
  );
}
