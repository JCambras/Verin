"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ErrorBoundary } from "@app/presentation/error-boundary";

/**
 * The /app layout is persistent: App Router keeps it mounted across a client-side
 * navigation and swaps only its children, so a boundary mounted there holds a caught
 * error into every later destination. This is the smallest client leaf that can name
 * which view the boundary is guarding - the active pathname - so arriving at a
 * different route releases the fallback without the viewer having to click "Try again"
 * on a page that never failed.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary resetKey={usePathname()}>{children}</ErrorBoundary>;
}
