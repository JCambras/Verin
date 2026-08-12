// @vitest-environment jsdom

import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary } from "@app/app/route-error-boundary";

/**
 * The /app layout is persistent, so its boundary sees a NEW child subtree on every
 * client-side navigation while keeping its own instance and state. Without the
 * pathname keying it, one failed view would leave every later destination showing the
 * fallback over healthy content, recoverable only by clicking "Try again".
 */
const pathname = vi.hoisted(() => ({ current: "/app/audit" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

function Broken(): ReactElement {
  throw new Error("render failed");
}

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    pathname.current = "/app/audit";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("releases a caught failure when navigation swaps the guarded view", () => {
    const { rerender } = render(<RouteErrorBoundary><Broken /></RouteErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("This view could not be shown.");

    pathname.current = "/app/console";
    rerender(<RouteErrorBoundary><p>Console</p></RouteErrorBoundary>);
    expect(screen.getByText("Console")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the fallback on the view that actually failed", () => {
    const { rerender } = render(<RouteErrorBoundary><Broken /></RouteErrorBoundary>);
    rerender(<RouteErrorBoundary><p>Audit</p></RouteErrorBoundary>);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("Audit")).not.toBeInTheDocument();
  });
});
