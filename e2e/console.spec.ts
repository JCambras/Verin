import { test, expect } from "@playwright/test";
import { login, PRINCIPAL } from "./helpers";

/**
 * House-CRM console CRUD (charter #8: happy path + failure path per flow). The
 * create happy path previously shipped broken with the suite green because only
 * axe ran here — this spec exercises the real submit → reload → render cycle.
 */

test("console create: the new household appears and the form clears (no manual refresh)", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/console");
  const name = `Console E2E ${Date.now()}`;
  await page.getByLabel("New household name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("household-list")).toContainText(name);
  await expect(page.getByLabel("New household name")).toHaveValue("");
});

test("console create failure path: an over-long name surfaces a validation error", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/console");
  await page.getByLabel("New household name").fill("x".repeat(300));
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at most 200" })).toBeVisible();
});
