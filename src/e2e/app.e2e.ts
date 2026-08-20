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

async function signInAs(page: Page, email: string, phrase: string) {
  await page.goto("/");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(phrase);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("verin-register-loaded")).toBeVisible();
  expect(page.url()).toBe("http://localhost:3000/households");
}

test("an advisor signs in and sees their own firm's households, and no other firm's", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await expect(page.getByText("Signed in as Alex Rivera")).toBeVisible();
  for (const name of ["Henderson Family", "Delgado Household", "Okonkwo Trust"]) await expect(page.getByText(name)).toBeVisible();
  for (const other of ["Vance Household", "Mensah Family"]) await expect(page.getByText(other)).toHaveCount(0);
  await expect(page.getByText("demonstration record").first()).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr2a2-households.png" });
});

test("the second firm's advisor sees only their own book over the same tables", async ({ page }) => {
  await signInAs(page, "advisor@firm-b.example", "harbor-quartz-42");
  await expect(page.getByText("Signed in as Priya Nair")).toBeVisible();
  for (const name of ["Vance Household", "Mensah Family"]) await expect(page.getByText(name)).toBeVisible();
  for (const other of ["Henderson Family", "Delgado Household", "Okonkwo Trust"]) await expect(page.getByText(other)).toHaveCount(0);
  expect((await settledAxe(page)).violations).toEqual([]);
});

test("the workspace shows what Verin knows, honest absent states, and one watermarked figure", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.getByRole("link", { name: "Henderson Family" }).click();
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Henderson Family" })).toBeVisible();
  await expect(page.getByText("Days on record")).toBeVisible();
  await expect(page.getByText("demonstration - not a compliance record")).toBeVisible();
  for (const absent of ["People", "Financial accounts", "Compliance evidence"]) await expect(page.getByText(absent, { exact: true })).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr2b-workspace.png" });
});

test("another firm's workspace URL resolves to an honest not-found, never a leak", async ({ page, context }) => {
  await signInAs(page, "advisor@firm-b.example", "harbor-quartz-42");
  const vanceHref = await page.getByRole("link", { name: "Vance Household" }).getAttribute("href");
  await context.clearCookies();
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.goto(vanceHref!);
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Household not on file" })).toBeVisible();
  await expect(page.getByText("Vance")).toHaveCount(0);
  expect((await settledAxe(page)).violations).toEqual([]);
});
