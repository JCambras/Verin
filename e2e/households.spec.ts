import { test, expect } from "@playwright/test";
import { login, PRINCIPAL } from "./helpers";

/**
 * The populated world in the browser (ADR-0057; charter #8: happy path plus a
 * failure/interruption path per surface).
 *
 * These specs assert the two things the plan's acceptance criteria name and a
 * unit test cannot: that a hundred households actually render and stay usable,
 * and that the awkward cases survive inspection - four households share the
 * surname Smith, and a trust registered in one household pays another.
 */

test("the directory renders the whole book and search narrows it", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/households");
  await expect(page.getByTestId("household-directory")).toContainText("Showing 100 of 100 households");

  // Windowed: a hundred rows are announced, far fewer are mounted.
  const rows = page.getByRole("listitem").filter({ has: page.getByRole("link") });
  const mounted = await rows.count();
  expect(mounted, "the list must be virtualized, not fully mounted").toBeLessThan(40);
  await expect(rows.first()).toHaveAttribute("aria-setsize", "100");

  await page.getByLabel("Search households").fill("Smith");
  await expect(page.getByTestId("household-directory")).toContainText("of 100 households");
  const smithCount = await rows.count();
  expect(smithCount, "several households share the surname Smith - that is deliberate").toBeGreaterThan(1);
});

test("a household opens in depth: people, accounts, instructions, activity and an explained health score", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/households/smith-robert-elaine");
  const detail = page.getByTestId("household-detail");
  await expect(page.getByRole("heading", { name: "Robert & Elaine Smith" })).toBeVisible();

  // The health score is expanded, not asserted: six factors, each with a sentence.
  await expect(detail.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(detail).toContainText("Liquidity");
  await expect(detail).toContainText("Evidence freshness");
  await expect(detail).toContainText("Instruction integrity");
  // Derived from fixture inputs, so it must say so (charter #3 / ADR-0022).
  await expect(detail.getByTestId("metric-watermark").first()).toBeVisible();

  await expect(detail).toContainText("Robert & Elaine Smith Revocable Trust");
  await expect(detail).toContainText("Roth IRA");
  await expect(detail).toContainText("No distributions to third-party or business accounts");
  await expect(detail).toContainText("not yet independently verified");

  // Holdings, beneficiaries and signers reveal in place, without leaving the
  // page. The locator is pinned to the CARD, not to the button's label, because
  // the label is what the click changes.
  const firstAccount = detail.locator("[data-account-card]").first();
  const reveal = firstAccount.getByRole("button");
  await expect(reveal).toHaveAttribute("aria-expanded", "false");
  await reveal.click();
  await expect(reveal).toHaveAttribute("aria-expanded", "true");
  await expect(firstAccount).toContainText("Verity");
  await expect(firstAccount).toContainText("unrealized");
  await expect(firstAccount).toContainText("Authorized signers");
});

test("a trust in one household is visibly touching another, and the link navigates", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/households/whitfield-cordelia");
  const detail = page.getByTestId("household-detail");
  await expect(detail).toContainText("Trust account serving another household");
  await detail.getByRole("link", { name: /Open Nathaniel & Perrine Whitfield/ }).click();
  await expect(page.getByRole("heading", { name: "Nathaniel & Perrine Whitfield" })).toBeVisible();
  await expect(page.getByTestId("household-detail")).toContainText("Receives income from an external trust");
});

test("failure path: an unknown household key is refused as a sentence, with a way back", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/households/not-a-real-household");
  await expect(page.getByText("That household is not in this firm's book.")).toBeVisible();
  await page.getByRole("link", { name: "Back to all households" }).click();
  await expect(page.getByTestId("household-directory")).toBeVisible();
});

test("failure path: a search that matches nothing offers a way forward, never a dead end", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/households");
  await page.getByLabel("Search households").fill("zzzzz-no-such-household");
  await expect(page.getByText("No household matches that search")).toBeVisible();
  await expect(page.getByText(/Try a surname, a city, an advisor/)).toBeVisible();
});
