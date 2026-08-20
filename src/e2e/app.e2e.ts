// E2E + axe on every route this slice ships (prompt 2 5B.7, section 9): the sign-in surface and the
// authenticated honest empty shell, scanned at the loaded state with animations settled, complete
// WCAG 2.2 AA tag set, zero violations, no disabled rule, no skipped scope. Screenshots assert the
// URL and the loaded-state marker first, so a route that renders nothing can never pass (M-D).
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
async function settledAxe(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)).then(() => undefined));
  return new AxeBuilder({ page }).withTags(TAGS).analyze();
}

test("the sign-in surface is accessible and honestly labelled", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("verin-signin-loaded")).toBeVisible();
  expect(page.url()).toBe("http://localhost:3000/");
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr2a-signin.png" });
});

test("a wrong credential is refused with a visible, announced reason", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Work email").fill("advisor@firm-a.example");
  await page.getByLabel("Password").fill("not-the-phrase");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "was not accepted" })).toBeVisible();
  await expect(page.getByTestId("verin-signin-loaded")).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
});

test("an advisor signs in and lands on the honest empty shell", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Work email").fill("advisor@firm-a.example");
  await page.getByLabel("Password").fill("meridian-slate-88");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("verin-shell-loaded")).toBeVisible();
  expect(page.url()).toBe("http://localhost:3000/");
  await expect(page.getByText("No household records exist yet")).toBeVisible();
  await expect(page.getByText("Signed in as Alex Rivera")).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr2a-shell.png" });
});
