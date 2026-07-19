import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Phase-0 smoke. Makes the E2E gate REAL from the first UI commit (charter #8 —
 * the capability Iris regressed on) and wires axe (charter #9). The walking
 * skeleton's happy-path and failure-path specs arrive in Phase E.
 */
test("landing renders the Verin. wordmark", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Verin." })).toBeVisible();
});

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", service: "verin" });
});

test("landing has no serious/critical axe violations (WCAG 2.2 AA)", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => v.id), JSON.stringify(serious, null, 2)).toEqual([]);
});
