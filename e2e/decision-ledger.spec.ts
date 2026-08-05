import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ADVISOR, PRINCIPAL, login } from "./helpers";
import { DEV_BADGE_TEXT } from "../src/contracts/provenance";

test("principal can inspect the seeded decision ledger and its L1-L4 verdict", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/ledger");
  await expect(page.getByRole("heading", { name: "Decision ledger" })).toBeVisible();
  await expect(page.getByTestId("ledger-verdict")).toContainText("L1-L4 verified");
  for (const level of ["L1", "L2", "L3", "L4"]) {
    await expect(page.getByTestId("ledger-verdict").getByText(level, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("cell", { name: "DecisionRecorded" })).toBeVisible();
  await expect(page.getByTestId("dev-provenance-badge").first()).toHaveText(
    DEV_BADGE_TEXT["synthetic-fixture"],
  );
  await expect(page.getByTestId("ledger-decision-state")).toContainText(
    "dec:GC-01:0001",
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations
      .filter((violation) =>
        violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => violation.id),
  ).toEqual([]);
});

test("advisor cannot read the decision ledger", async ({ page }) => {
  await login(page, ADVISOR);
  const response = page.waitForResponse((item) => item.url().includes("/api/ledger"));
  await page.goto("/app/ledger");
  expect((await response).status()).toBe(403);
  await expect(
    page.getByRole("alert").filter({ hasText: "do not have permission" }),
  ).toBeVisible();
});

test("failed verification presents a dedicated entries-withheld state", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.route("**/api/ledger", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        verification: {
          ok: false,
          entriesChecked: 0,
          entriesStored: 5,
          levels: [{
            level: "L1",
            ok: false,
            entriesChecked: 0,
            reason: "entry hash differs",
          }],
        },
        total: 5,
        decisionsTotal: 0,
        decisions: [],
        entries: [],
      }),
    });
  });
  await page.goto("/app/ledger");
  await expect(page.getByTestId("ledger-verdict")).toContainText(
    "Verification failed",
  );
  await expect(page.getByTestId("ledger-entries-withheld")).toBeVisible();
  await expect(page.getByText("No decision events have been recorded")).toHaveCount(0);
});
