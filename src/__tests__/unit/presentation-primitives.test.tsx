// @vitest-environment jsdom

import { createRef, useRef, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@app/presentation/dialog";
import { ErrorBoundary } from "@app/presentation/error-boundary";
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

  it("sorts columns and keeps numeric cells right aligned", async () => {
    const user = userEvent.setup();
    render(<Table caption="Households" columns={columns} rows={[row(2), row(1)]} />);
    await user.click(screen.getByRole("button", { name: /Name/ }));
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0]!).getByText("Household 0001")).toBeVisible();
    expect(screen.getByText("$1").closest("td")).toHaveClass("text-right", "tabular-nums");
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
});
