// @vitest-environment jsdom

import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteErrorBoundary } from "@app/app/route-error-boundary";

/**
 * The /app layout is persistent, so its boundary sees a NEW child subtree on every
 * client-side navigation while keeping its own instance and state. Without the
 * guarded view keying it, one failed view would leave every later destination showing
 * the fallback over healthy content, recoverable only by clicking "Try again".
 */
const route = vi.hoisted(() => ({ pathname: "/app/audit", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.query),
}));

function Broken(): ReactElement {
  throw new Error("render failed");
}

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    route.pathname = "/app/audit";
    route.query = "";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("releases a caught failure when navigation swaps the guarded view", () => {
    const { rerender } = render(<RouteErrorBoundary><Broken /></RouteErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("This view could not be shown.");

    route.pathname = "/app/console";
    rerender(<RouteErrorBoundary><p>Console</p></RouteErrorBoundary>);
    expect(screen.getByText("Console")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * The demo's approval gate links back to its OWN station with `approved=1`, so the one
   * shipped navigation that changes what the page renders without changing its path is
   * also the one where the reader most needs the boundary to let go: the approved view is
   * what they went there to see. A key made of the pathname alone held the fallback over it.
   */
  it("releases a caught failure when only the query names a different view", () => {
    route.pathname = "/app/demo/policy-authoring";
    route.query = "scenario=GC-01&firm=firm-a";
    const { rerender } = render(<RouteErrorBoundary><Broken /></RouteErrorBoundary>);
    expect(screen.getByRole("alert")).toBeVisible();

    route.query = "scenario=GC-01&firm=firm-a&approved=1";
    rerender(<RouteErrorBoundary><p>Approved and activated</p></RouteErrorBoundary>);
    expect(screen.getByText("Approved and activated")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the fallback on the view that actually failed", () => {
    const { rerender } = render(<RouteErrorBoundary><Broken /></RouteErrorBoundary>);
    rerender(<RouteErrorBoundary><p>Audit</p></RouteErrorBoundary>);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("Audit")).not.toBeInTheDocument();
  });
});
