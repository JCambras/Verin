import { expect, type Page } from "@playwright/test";

export const PRINCIPAL = { email: "principal@verin.test", password: "verin-demo-pass-12345678" };
export const ADVISOR = { email: "advisor@verin.test", password: "verin-demo-pass-12345678" };

/**
 * Login via the server action: it sets the session cookie and redirects to /app
 * atomically (no client cookie race; works before hydration). We just submit and
 * wait for the redirect.
 */
export async function login(page: Page, creds: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "What do you want to do?" })).toBeVisible();
}
