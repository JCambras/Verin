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

/** The counterparty a firm's book does not contain: the route withholds it the
 * same way it withholds a household in another org, so the browser sees the 404
 * a real cross-firm link produces. */
const WITHHELD_COUNTERPARTY = "**/api/households/whitfield-nathaniel";
const NOT_FOUND_BODY = JSON.stringify({
  error: { code: "NOT_FOUND", message: "That household is not in this firm's book." },
});

test("failure path: a refused counterparty does not follow you back to the household that works", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.route(WITHHELD_COUNTERPARTY, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: NOT_FOUND_BODY }));

  await page.goto("/app/households/whitfield-cordelia");
  await expect(page.getByRole("heading", { name: "Cordelia Whitfield" })).toBeVisible();
  await page.getByRole("link", { name: /Open Nathaniel & Perrine Whitfield/ }).click();
  await expect(page.getByText("That household is not in this firm's book.")).toBeVisible();

  // Back is a CLIENT-SIDE navigation inside the same dynamic segment. What a
  // reader must never meet is a household that loads perfectly well rendered as
  // "Household unavailable" because the previous key's failure outlived it.
  // (The component's own contract is asserted where it can be: the unit test
  // re-renders one instance across the key change.)
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Cordelia Whitfield" })).toBeVisible();
  await expect(page.getByText("Household unavailable")).toHaveCount(0);
});

test("a cross-household navigation shows the new household loading, never the previous one's figures", async ({ page }) => {
  await login(page, PRINCIPAL);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(WITHHELD_COUNTERPARTY, async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("/app/households/whitfield-cordelia");
  await expect(page.getByRole("heading", { name: "Cordelia Whitfield" })).toBeVisible();
  await page.getByRole("link", { name: /Open Nathaniel & Perrine Whitfield/ }).click();

  // The URL is the counterparty's while its response is still in flight; one
  // household's balances and health under another household's name is a
  // statement the page cannot support.
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cordelia Whitfield" })).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { name: "Nathaniel & Perrine Whitfield" })).toBeVisible();
});

test("failure path: a search that matches nothing offers a way forward, never a dead end", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/households");
  await page.getByLabel("Search households").fill("zzzzz-no-such-household");
  await expect(page.getByText("No household matches that search")).toBeVisible();
  await expect(page.getByText(/Try a surname, a city, an advisor/)).toBeVisible();
});

test("recovery path: clearing a search that matched nothing returns the book, not a blank window", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/households");
  const rows = page.getByRole("listitem").filter({ has: page.getByRole("link") });
  await expect(rows.first()).toHaveAttribute("aria-posinset", "1");

  // Scroll deep into the book, then filter it away entirely. The empty state
  // unmounts the scroll container, so the offset the window remembers belongs
  // to an element that no longer exists; the container a cleared query mounts
  // starts at the top, and the two must not disagree.
  await page.getByTestId("household-list-viewport").evaluate((element) => { element.scrollTop = 5000; });
  await expect(rows.first()).not.toHaveAttribute("aria-posinset", "1");
  const search = page.getByLabel("Search households");
  await search.fill("zzzzz-no-such-household");
  await expect(page.getByText("No household matches that search")).toBeVisible();

  await search.fill("");
  await expect(page.getByTestId("household-directory")).toContainText("Showing 100 of 100 households");
  await expect(rows.first()).toHaveAttribute("aria-posinset", "1");
  await expect(rows.first()).toBeInViewport();
});
