import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ADVISOR, PRINCIPAL, login } from "./helpers";

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
    "Synthetic fixture",
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
