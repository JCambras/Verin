import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, PRINCIPAL } from "./helpers";

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

test("key skeleton pages have no serious/critical axe violations (WCAG 2.2 AA)", async ({ page }) => {
  await page.goto("/login");
  await checkAxe(page, "/login");
  await login(page, PRINCIPAL); // authenticate once; the session persists across navigations
  // /app/console and /app/audit render their content from a client-side fetch, so
  // axe must wait for the LOADED state — scanning the "Loading…" placeholder would
  // let an inaccessible table ship while the gate stays green.
  const readyWhen: Record<string, (p: import("@playwright/test").Page) => Promise<void>> = {
    "/app": async (p) => expect(p.getByRole("heading", { name: "What do you want to do?" })).toBeVisible(),
    "/app/account-opening": async (p) => expect(p.getByLabel("Household name")).toBeVisible(),
    "/app/console": async (p) => expect(p.getByText("Loading…")).toHaveCount(0),
    "/app/audit": async (p) => expect(p.getByTestId("audit-verdict")).toBeVisible(),
  };
  // Includes /app/audit (Wren axe-gate blind spot) — principal can view the trail.
  for (const url of ["/app", "/app/account-opening", "/app/console", "/app/audit"]) {
    await page.goto(url);
    await readyWhen[url]!(page);
    await checkAxe(page, url);
  }
});

async function checkAxe(page: import("@playwright/test").Page, url: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${url}:${v.id}`), JSON.stringify(serious, null, 2)).toEqual([]);
}
