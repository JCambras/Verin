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
  await page.getByRole("button", { name: "Create a household" }).click();
  await expect(page.getByLabel("New household name")).toBeFocused();
  const name = `Console E2E ${Date.now()}`;
  await page.getByLabel("New household name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByTestId("household-list")).toContainText(name);
  await expect(page.getByLabel("New household name")).toHaveValue("");
  await expect(page.getByText("Household created")).toBeVisible();
});

test("console rename: the dialog traps the task, restores focus, and confirms the saved name", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/console");
  const original = `Rename E2E ${Date.now()}`;
  await page.getByLabel("New household name").fill(original);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const rename = page.getByRole("button", { name: `Rename ${original}` });
  await rename.click();

  const dialog = page.getByRole("dialog", { name: "Rename household" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Household name", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(rename).toBeFocused();

  await rename.click();
  const updated = `${original} updated`;
  await page.getByLabel("Household name", { exact: true }).fill(updated);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("household-list")).toContainText(updated);
  await expect(page.getByText("Household renamed")).toBeVisible();
});

test("console create failure path: an over-long name surfaces a validation error", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/console");
  await page.getByLabel("New household name").fill("x".repeat(300));
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at most 200" })).toBeVisible();
});
