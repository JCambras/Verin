// @vitest-environment jsdom

import { createRef, useRef, useState, type ReactElement } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@app/presentation/dialog";
import { ErrorBoundary } from "@app/presentation/error-boundary";
import { ExecutionTimeline } from "@app/presentation/execution-timeline";
import { Table, type TableColumn, type TableRow } from "@app/presentation/table";
import { Tabs } from "@app/presentation/tabs";
import { ToastProvider, useToast } from "@app/presentation/toast";
import { Tooltip } from "@app/presentation/tooltip";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Pill,
  Radio,
  Select,
} from "@app/presentation/ui";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

describe("canonical presentation primitives", () => {
  it("wires form controls, labels, states, and action slots accessibly", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <span id="existing-description">Visible to operations.</span>
        <Field label="Household" htmlFor="household" hint="Use the legal name." error="Enter a household name.">
          <Input id="household" aria-describedby="existing-description" />
        </Field>
        <Field label="Account type" htmlFor="account-type">
          <Select id="account-type"><option>Taxable</option></Select>
        </Field>
        <Checkbox label="Include closed accounts" />
        <Radio name="firm" label="Firm A" />
        <Button>Continue</Button>
        <Badge>Draft</Badge>
        <Pill>Pending</Pill>
        <Card>Card content</Card>
        <EmptyState title="Nothing here yet" description="Start with a governed action." action={<Button>Start</Button>} />
      </div>,
    );

    const input = screen.getByLabelText("Household");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Visible to operations. Use the legal name. Enter a household name.");
    expect(screen.getByLabelText("Account type")).toBeVisible();
    await user.click(screen.getByLabelText("Include closed accounts"));
    expect(screen.getByLabelText("Include closed accounts")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("Nothing here yet")).toBeVisible();
  });

  it("moves tabs with the complete keyboard path", async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        label="Decision details"
        items={[
          { id: "evidence", label: "Evidence", panel: <p>Evidence panel</p> },
          { id: "policy", label: "Policy", panel: <p>Policy panel</p> },
        ]}
      />,
    );

    const evidence = screen.getByRole("tab", { name: "Evidence" });
    evidence.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Policy" })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Policy panel");
    await user.keyboard("{Home}");
    expect(evidence).toHaveFocus();
  });

  it("makes tooltip content reachable from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Tooltip label="Complete decision hash">a3f9c2…</Tooltip>);
    await user.tab();
    const trigger = screen.getByText("a3f9c2…");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleDescription("Complete decision hash");
  });

  it("dismisses tooltip content on Escape, keeps trigger focus, and restores on leave", async () => {
    const user = userEvent.setup();
    render(<Tooltip label="Complete decision hash">a3f9c2…</Tooltip>);
    await user.tab();
    const trigger = screen.getByText("a3f9c2…");
    const panel = screen.getByTestId("tooltip-panel");
    expect(panel).toHaveAttribute("data-state", "available");
    expect(panel.className).toContain("visible");

    await user.keyboard("{Escape}");
    expect(panel).toHaveAttribute("data-state", "dismissed");
    expect(panel.className).toContain("invisible");
    expect(trigger).toHaveFocus();

    await user.tab();
    expect(trigger).not.toHaveFocus();
    expect(panel).toHaveAttribute("data-state", "available");
  });

  /**
   * A pointer user has no focus inside the tooltip, so a wrapper-scoped key handler
   * never sees their Escape - the panel would stay up with no dismissal mechanism at
   * all. WCAG 1.4.13 Dismissible covers hover-triggered content, not only focus.
   */
  it("dismisses a hover-opened tooltip on Escape with focus outside it", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Button>Elsewhere</Button>
        <Tooltip label="Complete decision hash">a3f9c2…</Tooltip>
      </div>,
    );
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    act(() => elsewhere.focus());

    await user.hover(screen.getByText("a3f9c2…"));
    const panel = screen.getByTestId("tooltip-panel");
    expect(panel.className).toContain("visible");
    expect(panel.className).not.toContain("invisible");

    await user.keyboard("{Escape}");
    expect(panel).toHaveAttribute("data-state", "dismissed");
    expect(panel.className).toContain("invisible");
    expect(elsewhere).toHaveFocus();
  });

  it("binds the document Escape listener only while tooltip content is shown", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    try {
      const user = userEvent.setup();
      const { unmount } = render(<Tooltip label="Complete decision hash">a3f9c2…</Tooltip>);
      const keydownListeners = () => add.mock.calls.filter(([type]) => type === "keydown").length;
      expect(keydownListeners()).toBe(0);

      await user.hover(screen.getByText("a3f9c2…"));
      expect(keydownListeners()).toBe(1);

      await user.unhover(screen.getByText("a3f9c2…"));
      expect(remove.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);

      await user.tab();
      expect(keydownListeners()).toBe(2);
      unmount();
      expect(remove.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(2);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it("keeps the pointer path from the trigger into tooltip content hoverable", () => {
    render(<Tooltip label="Complete decision hash">a3f9c2…</Tooltip>);
    const panel = screen.getByTestId("tooltip-panel");
    // The offset is padding INSIDE the hoverable panel, never a margin gap that
    // un-hovers both elements while the pointer travels across it (WCAG 1.4.13).
    expect(panel.className).toContain("pb-2");
    expect(panel.className).not.toMatch(/(?:^|\s)-?m[btlrxy]?-/);
  });

  it("opens a modal dialog, focuses its field, and closes on Escape", () => {
    const close = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(
      <Dialog open title="Rename household" onClose={close} initialFocusRef={ref}>
        <Input ref={ref} aria-label="Household name" />
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Rename household" });
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByLabelText("Household name")).toHaveFocus();
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("announces and dismisses toasts through the shared host", async () => {
    function Harness() {
      const { showToast } = useToast();
      return <Button onClick={() => showToast({ title: "Household saved", durationMs: 0 })}>Save</Button>;
    }
    const user = userEvent.setup();
    render(<ToastProvider><Harness /></ToastProvider>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const live = screen.getByText("Household saved").closest("[aria-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
    await user.click(screen.getByRole("button", { name: "Dismiss Household saved" }));
    expect(screen.queryByText("Household saved")).not.toBeInTheDocument();
  });

  it("holds toast auto-dismiss while it has focus or the pointer, then resumes", async () => {
    function Harness() {
      const { showToast } = useToast();
      return <Button onClick={() => showToast({ title: "Household saved", durationMs: 1000 })}>Save</Button>;
    }
    vi.useFakeTimers();
    try {
      render(<ToastProvider><Harness /></ToastProvider>);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      const dismiss = screen.getByRole("button", { name: "Dismiss Household saved" });
      act(() => dismiss.focus());
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(screen.getByText("Household saved")).toBeVisible();
      expect(dismiss).toHaveFocus();

      const held = screen.getByTestId("toast");
      fireEvent.mouseOver(held);
      act(() => dismiss.blur());
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(screen.getByText("Household saved")).toBeVisible();

      fireEvent.mouseOut(held);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.queryByText("Household saved")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Table", () => {
  const columns: readonly TableColumn[] = [
    { id: "name", header: "Name", sortable: true },
    { id: "amount", header: "Amount", align: "right", sortable: true },
    { id: "status", header: "Status", sortable: true },
  ];

  function row(index: number): TableRow {
    return {
      id: `row-${index}`,
      cells: {
        name: { content: `Household ${String(index).padStart(4, "0")}`, sortValue: index },
        amount: { content: `$${index}`, sortValue: index },
        status: { kind: "status", status: index % 2 ? "pending" : "done", sortValue: index % 2 },
      },
    };
  }

  it("sorts columns, keeps numeric cells right aligned, and keeps the caption true", async () => {
    const user = userEvent.setup();
    render(<Table caption="Households" columns={columns} rows={[row(2), row(1)]} />);
    await user.click(screen.getByRole("button", { name: /Name/ }));
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0]!).getByText("Household 0001")).toBeVisible();
    expect(screen.getByText("$1").closest("td")).toHaveClass("text-right", "tabular-nums");
    expect(screen.getByText("Households (re-sorted by Name, ascending)")).toBeInTheDocument();
  });

  /**
   * The collator is constructed once for the tier rather than per comparison (a
   * `localeCompare` handed an options object mints one every call, which is what the
   * 5,000-row sort paid for). Hoisting must not change the collation, so the ordering
   * it produces is asserted directly: numeric-aware and case-insensitive.
   */
  it("sorts strings numerically and case-insensitively through one shared collator", async () => {
    const user = userEvent.setup();
    const labels = ["item 10", "Item 9", "item 2"];
    render(
      <Table
        caption="Collation fixture"
        columns={[{ id: "name", header: "Name", sortable: true }]}
        rows={labels.map((label, index) => ({ id: `row-${index}`, cells: { name: { content: label } } }))}
      />,
    );
    const localeCompare = vi.spyOn(String.prototype, "localeCompare");
    try {
      await user.click(screen.getByRole("button", { name: /Name/ }));
      expect(localeCompare).not.toHaveBeenCalled();
    } finally {
      localeCompare.mockRestore();
    }
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "item 2",
      "Item 9",
      "item 10",
    ]);
  });

  it("keeps the region landmark label true to the active sort", async () => {
    const user = userEvent.setup();
    render(<Table caption="Households, newest first" columns={columns} rows={[row(2), row(1)]} />);
    expect(screen.getByRole("region", { name: "Households, newest first" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Name/ }));
    expect(screen.queryByRole("region", { name: "Households, newest first" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Households, newest first (re-sorted by Name, ascending)" }),
    ).toBeInTheDocument();
  });

  it("aligns each sortable header with its column, indexes the header row, and prints its labels", () => {
    render(<Table caption="Households" columns={columns} rows={[row(1)]} />);
    const header = screen.getAllByRole("row")[0]!;
    expect(header).toHaveAttribute("aria-rowindex", "1");

    const name = screen.getByRole("button", { name: /Name/ });
    const amount = screen.getByRole("button", { name: /Amount/ });
    expect(name.className).toContain("justify-start");
    expect(amount.className).toContain("justify-end");
    for (const control of [name, amount]) expect(control.className).not.toContain("justify-center");

    const printed = Array.from(header.querySelectorAll("span[aria-hidden='true']"))
      .filter((node) => node.className.includes("print:block"))
      .map((node) => node.textContent);
    expect(printed).toEqual(["Name", "Amount", "Status"]);
  });

  it("virtualizes a 5,000-row body and updates the window on scroll", () => {
    const rows = Array.from({ length: 5000 }, (_, index) => row(index));
    render(<Table caption="Large household fixture" columns={columns} rows={rows} />);
    const region = screen.getByRole("region", { name: "Large household fixture" });
    expect(region).toHaveAttribute("data-row-count", "5000");
    expect(Number(region.getAttribute("data-rendered-row-count"))).toBeLessThan(40);
    expect(screen.getByText("Household 0000")).toBeVisible();
    fireEvent.scroll(region, { target: { scrollTop: 120_000 } });
    expect(screen.queryByText("Household 0000")).not.toBeInTheDocument();
    expect(Number(region.getAttribute("data-rendered-row-count"))).toBeLessThan(40);
  });

  /**
   * Rendered register rows are taller than the seeded estimate (the ledger's event cell
   * stacks a type, a timestamp, and a provenance badge), so the scroll extent runs past
   * `rowCount * estimate`. An unclamped window start then indexes beyond the last row and
   * the body renders blank at the bottom of the register.
   */
  it("clamps the virtual window so the tail of a taller-than-estimated register renders", () => {
    const rows = Array.from({ length: 200 }, (_, index) => row(index));
    render(<Table caption="Ledger fixture" columns={columns} rows={rows} />);
    const region = screen.getByRole("region", { name: "Ledger fixture" });
    fireEvent.scroll(region, { target: { scrollTop: 1_000_000 } });
    const rendered = Number(region.getAttribute("data-rendered-row-count"));
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(40);
    expect(screen.getByText("Household 0199")).toBeVisible();
  });

  it("owns its loading and actionable empty states", () => {
    const { rerender } = render(<Table caption="Cases" columns={columns} rows={[]} loading />);
    expect(screen.getByText("Loading…")).toBeVisible();
    rerender(
      <Table
        caption="Cases"
        columns={columns}
        rows={[]}
        emptyState={{ title: "No cases", description: "Start a case to continue.", action: <Button>Start case</Button> }}
      />,
    );
    expect(screen.getByRole("button", { name: "Start case" })).toBeVisible();
  });
});

describe("ExecutionTimeline", () => {
  it("offers no way to reorder an append-only register", () => {
    render(
      <ExecutionTimeline
        caption="Execution timeline"
        rows={[{
          step: "Submit transfer",
          target: "Custodian",
          status: "submitted",
          statusLabel: "Submitted",
          timestamp: "2026-08-11T12:00:00.000Z",
          identifiers: [],
          devBadgeLabel: "Demonstration data",
        }]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Step" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Step/ })).not.toBeInTheDocument();
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).not.toHaveAttribute("aria-sort");
    }
  });
});

describe("ErrorBoundary", () => {
  it("contains a render failure and offers recovery", async () => {
    let fails = true;
    function Flaky() {
      const [, rerender] = useState(0);
      const marker = useRef("ready");
      if (fails) throw new Error("test failure");
      return <Button onClick={() => rerender((value) => value + 1)}>{marker.current}</Button>;
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("This view could not be shown.");
    fails = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "ready" })).toBeVisible();
    consoleError.mockRestore();
  });

  function Broken(): ReactElement {
    throw new Error("render failed");
  }

  it("records a diagnostic when the host supplies no reporter", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("ErrorBoundary caught a render failure"),
      expect.any(Error),
      expect.any(String),
    );
    consoleError.mockRestore();
  });

  it("routes a caught failure to a host reporter instead of the default record", () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary onError={onError}><Broken /></ErrorBoundary>);
    expect(onError).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("ErrorBoundary caught a render failure"),
      expect.anything(),
      expect.anything(),
    );
    consoleError.mockRestore();
  });
});
