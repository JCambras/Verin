// E2E + axe on every route this slice ships (prompt 2 5B.7, section 9): the sign-in surface and the
// authenticated honest empty shell, scanned at the loaded state with animations settled, complete
// WCAG 2.2 AA tag set, zero violations, no disabled rule, no skipped scope. Screenshots assert the
// URL and the loaded-state marker first, so a route that renders nothing can never pass (M-D).
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client as PgClient } from "pg";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
// Env-overridable like the suite's other connections (the PR-3b falsification pass's note 2).
const SUPER_URL = process.env.VERIN_SUPER_DATABASE_URL?.replace(/\/postgres$/, "/verin") ?? "postgresql://postgres:postgres@localhost:5432/verin";
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

test("the workspace shows the evidence surface: every observation with source, both timestamps and its band", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.getByRole("link", { name: "Henderson Family" }).click();
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Henderson Family" })).toBeVisible();
  await expect(page.getByText("Days on record")).toBeVisible();
  await expect(page.getByText("demonstration - not a compliance record")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What Verin can prove" })).toBeVisible();
  const evidence = page.getByRole("list", { name: "Evidence on file for this household" });
  for (const label of ["People", "Account balance", "Bank instruction", "Beneficiary designation"]) await expect(evidence.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(evidence.getByText(/House record store · observed [A-Z][a-z]{2} \d{1,2}, \d{4} · retrieved [A-Z][a-z]{2} \d{1,2}, \d{4} · fresh/).first()).toBeVisible();
  await expect(evidence.getByText("Account: ending 4821")).toBeVisible(); // masked, never a raw reference
  await expect(evidence.getByText("demonstration record").first()).toBeVisible(); // seeded evidence is labelled
  await expect(page.getByText(/confidence/i)).toHaveCount(0); // no numeric AI confidence anywhere
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr3a-evidence.png" });
});

test("the receded workspace: stale faded but readable, aging banded, and both sides of a conflict retained", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.getByRole("link", { name: "Delgado Household" }).click();
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await expect(page.getByText("Records disagree: Bank instruction")).toBeVisible();
  await expect(page.getByText("none is treated as the truth, and recency never decides", { exact: false })).toBeVisible();
  await expect(page.getByText("Account: ending 8845")).toBeVisible(); // the older side of the disagreement, retained
  await expect(page.getByText("Account: ending 9911")).toBeVisible(); // and the newer side - recency never reconciles
  await expect(page.locator(".badge-band", { hasText: "conflicting record" })).toHaveCount(2);
  await expect(page.locator(".badge-band", { hasText: "stale" })).toBeVisible();
  await expect(page.locator(".badge-band", { hasText: "aging" })).toBeVisible();
  await expect(page.locator(".receded").getByText("Balance: $188,000")).toBeVisible(); // faded content, still readable
  await expect(page.getByText("Not yet observed: Beneficiary designation")).toBeVisible();
  await expect(page.getByText("Record each account's beneficiary designation", { exact: false })).toBeVisible(); // the real next step
  expect((await settledAxe(page)).violations).toEqual([]); // the stale fade and every badge pass the complete WCAG 2.2 AA set
  await page.screenshot({ path: "test-results/pr3b-delgado.png" });
});

test("a household with nothing observed renders typed absence with next steps, never an empty success (M-D)", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.getByRole("link", { name: "Okonkwo Trust" }).click();
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await expect(page.getByRole("list", { name: "Evidence on file for this household" })).toHaveCount(0); // nothing is rendered as if it were fine
  await expect(page.getByText(/^Not yet observed: /)).toHaveCount(4); // every vocabulary kind, each a typed absence
  await expect(page.getByText("This gap is a typed absence in the household's evidence bundle, never a silent skip.", { exact: false }).first()).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr3b-okonkwo.png" });
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

test("the policy shelf resolves a published version by content address, and refuses a missing one with no substitution", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.getByRole("link", { name: "Firm policy" }).click();
  await expect(page.getByTestId("verin-policy-loaded")).toBeVisible();
  const su = new PgClient({ connectionString: SUPER_URL });
  await su.connect();
  const digest = ((await su.query("SELECT v.digest FROM policy_version v JOIN org o ON o.id = v.org_id WHERE o.name = 'Meridian Wealth Partners' AND v.seq = 1")).rows[0] as { digest: string }).digest;
  await su.end();
  await page.getByLabel("Version identity").fill(`fpd.v1:${digest}`);
  await page.getByRole("button", { name: "Inspect version" }).click();
  await expect(page.getByRole("heading", { name: /Version 1 on your firm's shelf/ })).toBeVisible();
  await expect(page.getByText("6 months of planned withdrawals")).toBeVisible(); // the seeded Firm A re-expression
  await expect(page.getByText("Not stated - the ratified contract is silent, and Verin does not invent firm policy").first()).toBeVisible(); // typed silence, rendered as itself
  await expect(page.getByText(`fpd.v1:${digest}`)).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr4a-policy.png" });
  await page.goto(`/policy?id=fpd.v1:${"e".repeat(64)}`);
  await expect(page.getByText("No such version on your firm's shelf")).toBeVisible();
  await expect(page.getByText("months of planned withdrawals")).toHaveCount(0); // no policy substituted for a missing version
  expect((await settledAxe(page)).violations).toEqual([]); // the NotFound refusal state
});

test("an advisor stays signed in through a long sitting - the session slides and rotates", async ({ page, context }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  const before = (await context.cookies()).find((c) => c.name === "verin_session")!.value;
  const su = new PgClient({ connectionString: SUPER_URL });
  await su.connect();
  await su.query("UPDATE session SET created_at = now() - interval '7 hours'");
  await su.end();
  await page.reload();
  await expect(page.getByTestId("verin-register-loaded")).toBeVisible(); // not thrown out mid-journey
  const after = (await context.cookies()).find((c) => c.name === "verin_session")!.value;
  expect(after).not.toBe(before); // rotated on the cookie-writing path
  await page.reload();
  await expect(page.getByTestId("verin-register-loaded")).toBeVisible(); // and the renewed session holds
});

test("the whole journey is completable from the keyboard alone", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab"); // the chrome's Households link
  await page.keyboard.press("Tab"); // the chrome's Firm policy link (slice 4)
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Work email")).toBeFocused();
  await page.keyboard.type("advisor@firm-a.example");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type("meridian-slate-88");
  await page.keyboard.press("Enter"); // native implicit submission
  await expect(page.getByTestId("verin-register-loaded")).toBeVisible();
  // Walk the Tab ring the way a keyboard user does; the first register row must be reachable fast.
  const target = page.getByRole("link", { name: "Delgado Household" });
  for (let i = 0; i < 8 && !(await target.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delgado Household" })).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
});
