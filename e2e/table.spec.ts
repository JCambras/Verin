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
  const table = page.getByRole("region", { name: "Audit log" });
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

  // The declared recorded order states ITSELF, and says so as recorded order rather than
  // as a re-sort nobody performed (D-200) - the landmark's name carries none of it (D-201).
  await expect(table.locator("caption")).toHaveText("Audit log entries (in recorded order, by #, descending)");

  await table.getByRole("button", { name: /^#/ }).click();
  // The landmark's NAME is the register's identity and holds still through the sort
  // (D-200); the caption is what states the sort a reader has applied.
  await expect(table).toHaveCount(1);
  await expect(table.locator("caption")).toHaveText(
    "Audit log entries (re-sorted by #, ascending)",
  );

  // A sortable register owes its recorded order back in ONE action (D-194); repeat
  // header clicks are not a restoration a compliance reader can rely on. The control
  // is named after its own register, sits inside that landmark, and hands focus to a
  // header that outlives it rather than dropping the keyboard user on <body>.
  const restore = table.getByRole("button", { name: "Restore recorded order: Audit log" });
  await restore.focus();
  await restore.press("Enter");
  await expect(page.getByRole("region", { name: "Audit log" })).toBeVisible();
  await expect(table.locator("caption")).toHaveText("Audit log entries (in recorded order, by #, descending)");
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
  const register = page.getByRole("region", { name: "Audit log" });
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
 * Suspending windowing drops the height cap, so the box stops overflowing and the browser
 * clamps its scrollTop to 0 - while the scroll handler, gated on windowing being ON,
 * refuses that event and leaves React holding the pre-print offset. Resuming from the
 * stale offset places the window hundreds of pixels below a box scrolled to the top and
 * the register reads as blank. It self-heals only if the clamp's scroll event happens to
 * land after the transition, which is a timing accident and not a guarantee.
 */
test("a register resumes windowing coherently after a print pass taken mid-scroll", async ({ page }) => {
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
  const register = page.getByRole("region", { name: "Audit log" });
  await expect(register).toHaveAttribute("data-row-count", "200");
  const box = register.locator("[data-table-scroll]");

  // Deep into the register, well past the first window.
  const scrolledTo = await box.evaluate(async (element) => {
    element.scrollTop = Math.floor(element.scrollHeight * 0.75);
    element.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return element.scrollTop;
  });
  expect(scrolledTo).toBeGreaterThan(0);

  await page.emulateMedia({ media: "print" });
  await expect(register).toHaveAttribute("data-rendered-row-count", "200");

  // The uncapped box does not overflow, so its offset is pinned at 0 for the whole print
  // pass. Writing that 0 back is what a print dialog, a zoom, or a resize does anyway -
  // and it drops the offset the browser would otherwise have restored on the way out, so
  // the disagreement this covers is FORCED rather than left to whether Chromium happens
  // to hand the position back before React looks.
  await box.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.emulateMedia({ media: null });
  await expect
    .poll(async () => Number(await register.getAttribute("data-rendered-row-count")))
    .toBeLessThan(200);

  // Coherent means the window the DOM holds is the window the scroll offset points at.
  // Where the browser leaves that offset is its own business - it may keep the reader's
  // place or clamp it away - but the rendered slice has to FOLLOW it, and the way that
  // failure reaches a reader is a visible band of blank spacer where rows belong. So the
  // claim is measured as coverage: rows fill the box from its top edge to its bottom one.
  const settled = await box.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const rows = Array.from(element.querySelectorAll<HTMLElement>("tr[data-table-row]"));
    const onScreen = rows
      .map((row) => row.getBoundingClientRect())
      .filter((rect) => rect.bottom > bounds.top && rect.top < bounds.bottom);
    return {
      rendered: rows.length,
      onScreen: onScreen.length,
      rowHeight: rows[0]?.getBoundingClientRect().height ?? 0,
      topGap: onScreen.length > 0 ? onScreen[0]!.top - bounds.top : Number.POSITIVE_INFINITY,
      bottomGap: onScreen.length > 0 ? bounds.bottom - onScreen[onScreen.length - 1]!.bottom : Number.POSITIVE_INFINITY,
    };
  });
  expect(settled.rendered).toBeGreaterThan(0);
  expect(settled.rendered).toBeLessThan(200);
  expect(settled.onScreen).toBeGreaterThan(0);
  expect(settled.topGap).toBeLessThanOrEqual(settled.rowHeight);
  expect(settled.bottomGap).toBeLessThanOrEqual(settled.rowHeight);
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
  const register = page.getByRole("region", { name: "Decision ledger" });
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
