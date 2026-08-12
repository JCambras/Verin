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

  await table.evaluate(async (region) => {
    region.scrollTop = region.scrollHeight;
    region.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const renderedAfter = Number(await table.getAttribute("data-rendered-row-count"));
  expect(renderedAfter).toBeLessThan(40);
  await expect(table.getByText("Fixture audit entry 4999")).toBeVisible();

  await table.getByRole("button", { name: /^#/ }).click();
  await expect(
    page.getByRole("region", { name: "Audit log entries, newest first (re-sorted by #, ascending)" }),
  ).toBeVisible();
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
  const scrollHeight = await register.evaluate((region) => region.scrollHeight);
  expect(scrollHeight).toBeGreaterThan(rowHeight * 200 * 0.9);

  // The blank window self-corrects once the browser re-clamps scrollTop, so a settled
  // read would pass over it. Sample every frame across the bounce instead.
  const leastRendered = await register.evaluate(async (region) => {
    region.scrollTop = region.scrollHeight;
    region.dispatchEvent(new Event("scroll"));
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
