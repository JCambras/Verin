"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ErrorBoundary } from "@app/presentation/error-boundary";

/**
 * The /app layout is persistent: App Router keeps it mounted across a client-side
 * navigation and swaps only its children, so a boundary mounted there holds a caught
 * error into every later destination. This is the smallest client leaf that can name
 * which view the boundary is guarding, so arriving at a different one releases the
 * fallback without the viewer having to click "Try again" on a page that never failed.
 *
 * The view is the pathname AND the query, because a shipped surface navigates by query
 * alone: the demo's approval gate links back to its own station with `approved=1`, which
 * renders a materially different page under an unchanged path. Keying on the path alone
 * left that one navigation - the only one where the boundary's reset matters most, since
 * the approved view is what the viewer went there to see - holding the fallback.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const query = useSearchParams().toString();
  return <ErrorBoundary resetKey={`${usePathname()}?${query}`}>{children}</ErrorBoundary>;
}
