import { test, expect } from "@playwright/test";
import { login, PRINCIPAL } from "./helpers";
import { assertNoAxeViolations } from "./axe";
import { AUTHENTICATED_AXE_ROUTES, LOGIN_AXE_ROUTES } from "./axe-routes";

/**
 * HAPPY-PATH walkthrough (charter deliverable E / Part-2 proof-of-life):
 * login -> account opening -> suspend at e-sign -> resume via signing webhook ->
 * finalize -> inspect the verified audit chain. Green on main, non-UTC.
 */

test("login → account opening → e-sign suspend/resume → finalize → audit chain verified", async ({ page }) => {
  await login(page, PRINCIPAL);

  await page.getByRole("link", { name: "Open account" }).click();
  await page.getByLabel("Household name").fill("Okafor Household");
  await page.getByLabel("Primary contact first name").fill("Ada");
  await page.getByLabel("Last name").fill("Okafor");
  await page.getByLabel("Account type").selectOption("ira-roth");
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/flows/account-opening") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Send for e-signature" }).click(),
  ]);
  expect(resp.status(), `flow POST body: ${await resp.text().catch(() => "?")}`).toBe(200);

  // The flow SUSPENDED at e-sign (fire-and-return).
  await expect(page.getByTestId("ao-awaiting")).toBeVisible();
  await expect(page.getByText("Awaiting client e-signature")).toBeVisible();

  // The signing webhook RESUMES and finalizes.
  await page.getByTestId("ao-sign").click();
  await expect(page.getByTestId("ao-completed")).toBeVisible();
  await expect(page.getByText("Account opened")).toBeVisible();

  // The audit trail is present and its chain verifies.
  await page.getByRole("link", { name: "Inspect the audit trail" }).click();
  await expect(page.getByTestId("audit-verdict")).toContainText("Chain verified");
  await expect(page.getByRole("cell", { name: "financial_account.create" })).toBeVisible();
});

test("key skeleton pages have no Axe violations (WCAG 2.2 AA)", async ({ page }) => {
  for (const route of LOGIN_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
  await login(page, PRINCIPAL);
  for (const route of AUTHENTICATED_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});
