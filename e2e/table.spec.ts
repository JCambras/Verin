import { expect, test } from "@playwright/test";
import { login, PRINCIPAL } from "./helpers";

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

  const scrollDuration = await table.evaluate(async (region) => {
    const start = performance.now();
    region.scrollTop = region.scrollHeight;
    region.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return performance.now() - start;
  });
  expect(scrollDuration).toBeLessThan(250);
  const renderedAfter = Number(await table.getAttribute("data-rendered-row-count"));
  expect(renderedAfter).toBeLessThan(40);
  await expect(table.getByText("Fixture audit entry 4999")).toBeVisible();
});
