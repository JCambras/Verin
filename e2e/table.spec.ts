import { expect, test } from "@playwright/test";
import { login, PRINCIPAL } from "./helpers";
import { DEV_BADGE_TEXT } from "../src/contracts/provenance";

test("the canonical table keeps a 5,000-row register windowed while scrolling", async ({ page }) => {
  await login(page, PRINCIPAL);
  const entries = Array.from({ length: 5000 }, (_, index) => ({
    sequence: 5000 - index,
    actor: "user-principal",
    action: index % 2 === 0 ? "household.created" : "household.updated",
    entityType: "household",
    detail: `Fixture audit entry ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 11, 12, 0, index % 60)).toISOString(),
    entryHash: String(index).padStart(64, "0"),
  }));
  await page.route("**/api/audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ verdict: { ok: true, entriesChecked: entries.length, reason: null }, entries, total: entries.length }),
    });
  });

  await page.goto("/app/audit");
  const table = page.getByRole("region", { name: "Audit log entries, newest first" });
  await expect(table).toHaveAttribute("data-row-count", "5000");
  const renderedBefore = Number(await table.getAttribute("data-rendered-row-count"));
  expect(renderedBefore).toBeLessThan(40);

  // The landmark holds the register AND the control that restores its order; the
  // bordered box inside it is what scrolls.
  await table.locator("[data-table-scroll]").evaluate(async (box) => {
    box.scrollTop = box.scrollHeight;
    box.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const renderedAfter = Number(await table.getAttribute("data-rendered-row-count"));
  expect(renderedAfter).toBeLessThan(40);
  await expect(table.getByText("Fixture audit entry 4999")).toBeVisible();

  await table.getByRole("button", { name: /^#/ }).click();
  const sorted = page.getByRole("region", { name: "Audit log entries, newest first (re-sorted by #, ascending)" });
  await expect(sorted).toBeVisible();

  // A sortable register owes its recorded order back in ONE action (D-194); repeat
  // header clicks are not a restoration a compliance reader can rely on. The control
  // is named after its own register, sits inside that landmark, and hands focus to a
  // header that outlives it rather than dropping the keyboard user on <body>.
  const restore = sorted.getByRole("button", { name: "Restore recorded order: Audit log entries, newest first" });
  await restore.focus();
  await restore.press("Enter");
  await expect(page.getByRole("region", { name: "Audit log entries, newest first" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Restore recorded order/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^#/ })).toBeFocused();
});

/**
 * A windowed register holds only its current window in the DOM behind a capped scroll
 * box, so printing one emitted a cropped box with blank spacer bands where the rest of
 * the record belonged. Both compliance registers exceed the windowing threshold in
 * ordinary use (each API caps at 200 entries), and the pre-change audit register printed
 * whole - so this is a regression on the one artifact a compliance reader takes off the
 * screen. No stylesheet can fix it: the missing rows do not exist in the document.
 */
test("a windowed register prints its complete row set, not the window", async ({ page }) => {
  await login(page, PRINCIPAL);
  const entries = Array.from({ length: 200 }, (_, index) => ({
    sequence: 200 - index,
    actor: "user-principal",
    action: index % 2 === 0 ? "household.created" : "household.updated",
    entityType: "household",
    detail: `Fixture audit entry ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 11, 12, 0, index % 60)).toISOString(),
    entryHash: String(index).padStart(64, "0"),
  }));
  await page.route("**/api/audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ verdict: { ok: true, entriesChecked: entries.length, reason: null }, entries, total: entries.length }),
    });
  });

  await page.goto("/app/audit");
  const register = page.getByRole("region", { name: "Audit log entries, newest first" });
  await expect(register).toHaveAttribute("data-row-count", "200");
  expect(Number(await register.getAttribute("data-rendered-row-count"))).toBeLessThan(200);

  await page.emulateMedia({ media: "print" });

  // Every stored row is in the printable document - no subset is silently emitted.
  await expect(register).toHaveAttribute("data-rendered-row-count", "200");
  for (const index of [0, 100, 199]) {
    await expect(register.getByText(`Fixture audit entry ${index}`, { exact: true })).toBeAttached();
  }
  // The virtual spacers are what print as blank bands, so none may survive the swap.
  await expect(register.locator('tr[aria-hidden="true"]')).toHaveCount(0);

  // And the box no longer crops: Chromium does not paginate an overflowing scroll
  // container, so a height cap in print is the same lost record by another route.
  const box = await register.locator("[data-table-scroll]").evaluate((element) => ({
    maxHeight: getComputedStyle(element).maxHeight,
    overflowY: getComputedStyle(element).overflowY,
    overflowing: element.scrollHeight > element.clientHeight + 1,
  }));
  expect(box).toEqual({ maxHeight: "none", overflowY: "visible", overflowing: false });

  await page.emulateMedia({ media: null });
  await expect
    .poll(async () => Number(await register.getAttribute("data-rendered-row-count")))
    .toBeLessThan(200);
});

/**
 * The decision-ledger register stacks an event type, a timestamp, and a provenance badge
 * in one cell, so its rows render far taller than the seeded row estimate. A window
 * derived from the estimate alone indexes past the last row at the bottom of the scroll
 * range and the register body renders blank - which the single-line audit fixture above
 * cannot catch, because its rows are SHORTER than the estimate.
 */
test("a register of tall rows still renders its tail at the bottom of the scroll range", async ({ page }) => {
  await login(page, PRINCIPAL);
  const entries = Array.from({ length: 200 }, (_, index) => ({
    sequence: 200 - index,
    occurredAt: new Date(Date.UTC(2026, 7, 11, 12, 0, index % 60)).toISOString(),
    eventType: "DecisionRecorded",
    actor: "user-principal",
    decisionId: `dec:GC-01:${String(200 - index).padStart(4, "0")}`,
    entryHash: String(index).padStart(16, "0"),
    provenanceLabel: DEV_BADGE_TEXT["synthetic-fixture"],
  }));
  await page.route("**/api/ledger", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        verification: {
          ok: true,
          levels: ["L1", "L2", "L3", "L4"].map((level) => ({
            level,
            ok: true,
            entriesChecked: entries.length,
            reason: null,
          })),
        },
        total: {
          value: entries.length,
          format: "count",
          provenance: {
            source: "computed",
            asOf: "2026-08-05T12:00:00.000Z",
            confidence: "high",
            demonstration: true,
            derivedFrom: ["fixture"],
          },
        },
        decisionsTotal: null,
        decisionsWithheld: null,
        decisions: [],
        entries,
      }),
    });
  });

  await page.goto("/app/ledger");
  const register = page.getByRole("region", { name: "Decision ledger entries, newest first" });
  await expect(register).toHaveAttribute("data-row-count", "200");
  const rowHeight = await register
    .locator("tr[data-table-row]")
    .first()
    .evaluate((row) => (row as HTMLElement).offsetHeight);
  expect(rowHeight).toBeGreaterThan(40);

  // The spacers must be sized from the height the rows ACTUALLY render at: a scroll
  // extent built on a shorter assumption is the whole defect, and it is what puts the
  // window start past the last row at the bottom of the range.
  const box = register.locator("[data-table-scroll]");
  const scrollHeight = await box.evaluate((element) => element.scrollHeight);
  expect(scrollHeight).toBeGreaterThan(rowHeight * 200 * 0.9);

  // The blank window self-corrects once the browser re-clamps scrollTop, so a settled
  // read would pass over it. Sample every frame across the bounce instead.
  const leastRendered = await box.evaluate(async (element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
    const region = element.closest("[data-row-count]")!;
    let least = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 12; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      least = Math.min(least, Number(region.getAttribute("data-rendered-row-count")));
    }
    return least;
  });
  expect(leastRendered).toBeGreaterThan(0);
  expect(leastRendered).toBeLessThan(40);
  await expect(register.getByRole("cell", { name: "dec:GC-01:0001" })).toBeVisible();
});
