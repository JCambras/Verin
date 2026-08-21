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
  for (const other of ["Henderson Family", "Delgado Household", "Okonkwo Trust", "Ashford Grantor Trust"]) await expect(page.getByText(other)).toHaveCount(0);
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
  await expect(page.getByText(/^Not yet observed: /)).toHaveCount(9); // every vocabulary kind (1.1.0), each a typed absence
  await expect(page.getByText("This gap is a typed absence in the household's evidence bundle, never a silent skip.", { exact: false }).first()).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr3b-okonkwo.png" });
});

test("the decision surface computes a real LIVE proceed: stages, key, citations, figures, honesty lines", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  // Pin the in-force version for this proof deterministically on any shelf state (unique bytes per
  // run; both amounts below sit on the same side of any threshold this document can carry).
  await page.goto("/policy");
  const decisionDoc = `{"reserveHorizonMonths":6,"dualApproval":{"thresholdUsd":${30_000 + (Date.now() % 1_000)},"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"operations","requesterRule":"may-not-satisfy-both-approvals"},"bankInstructionChange":"specialist-review","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`;
  await page.getByLabel(/Policy document/).fill(decisionDoc);
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByText(/^Published as /)).toBeVisible();
  await page.goto("/households");
  await page.getByRole("link", { name: "Henderson Family" }).click();
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await page.getByRole("link", { name: "Decide a distribution" }).click();
  await expect(page.getByTestId("verin-decide-loaded")).toBeVisible();
  await expect(page.getByText("recorded nowhere until prompt 6", { exact: false })).toBeVisible();
  await expect(page.getByText("a changed world yields a new decision", { exact: false })).toBeVisible(); // both honesty lines
  await expect(page.locator('[data-disposition="proceed"]')).toBeVisible();
  await expect(page.getByText("Stage 1: operations-dual-approval", { exact: false })).toBeVisible(); // derived from the STATED block, never an answer key
  await expect(page.getByText(/idem:r[0-9a-f]{15}:henderson-family-50000-2026-12-31/)).toBeVisible(); // the CD-4d grammar from request properties alone
  await expect(page.getByText("committed only after authority is complete", { exact: false })).toBeVisible(); // CD-4e on screen
  await expect(page.getByText(/Decision d[0-9a-f]{64}/)).toBeVisible();
  await expect(page.getByText(/evidence evb\.v1:[0-9a-f]{64}/)).toBeVisible();
  await expect(page.getByText(/policy fpd\.v1:[0-9a-f]{64}/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Every rule evaluated, in precedence order" }).getByText("Cash reserve")).toBeVisible();
  await expect(page.getByText("demonstration - not a compliance record").first()).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr5a2-decide-proceed.png" });
});

test("the decision surface blocks a breach with the arithmetic shown and a real resolving step", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  const href = await page.getByRole("link", { name: "Henderson Family" }).getAttribute("href");
  await page.goto(`${href}/decide?amount=400000&purpose=home-renovation&deadline=2026-12-31`);
  await expect(page.locator('[data-disposition="blocked"]')).toBeVisible();
  await expect(page.locator('[data-disposition="blocked"]').getByText("cash reserve breach")).toBeVisible();
  await expect(page.getByText(/\$12,000 vs \$48,000/)).toBeVisible(); // the figures, provenance-carried and watermarked
  await expect(page.locator('[data-disposition="proceed"]')).toHaveCount(0);
  await expect(page.getByText(/idem:/)).toHaveCount(0); // a refusal carries no idempotency key anywhere on the page
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr5a2-decide-blocked.png" });
});

test("the decision surface prohibits an active legal hold: the stamp, the regulatory source, zero affordances", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.getByRole("link", { name: "Ashford Grantor Trust" }).click();
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await page.getByRole("link", { name: "Decide a distribution" }).click();
  await expect(page.locator('[data-disposition="prohibited"]')).toBeVisible();
  await expect(page.getByText("Prohibited - active legal hold")).toBeVisible();
  await expect(page.getByText("reg-distribution-holds@2026.02", { exact: false })).toBeVisible(); // the exact regulatory version cited
  await expect(page.getByText("No approval can waive this", { exact: false })).toBeVisible();
  await expect(page.locator('[data-disposition="prohibited"]').getByRole("link")).toHaveCount(0); // zero affordances inside the stamp
  await expect(page.locator('[data-disposition="prohibited"]').getByRole("button")).toHaveCount(0);
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr5a2-decide-prohibited.png" });
});

test("firm B blocks the same recent-bank-change class from configuration alone, live", async ({ page }) => {
  await signInAs(page, "advisor@firm-b.example", "harbor-quartz-42");
  await page.getByRole("link", { name: "Vance Household" }).click();
  await expect(page.getByTestId("verin-workspace-loaded")).toBeVisible();
  await page.getByRole("link", { name: "Decide a distribution" }).click();
  await expect(page.locator('[data-disposition="blocked"]')).toBeVisible();
  await expect(page.locator('[data-disposition="blocked"]').getByText("bank instruction change unverified")).toBeVisible();
  await expect(page.getByText("Record a standing bank instruction", { exact: false })).toBeVisible(); // the resolving affordance
  expect((await settledAxe(page)).violations).toEqual([]);
});

test("the comparison surface: one request, one bundle, one engine - two configurations, two correct answers", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  const href = await page.getByRole("link", { name: "Henderson Family" }).getAttribute("href");
  await page.goto(`${href}/decide/compare?amount=150000&purpose=home-renovation&deadline=2026-12-31`);
  await expect(page.getByTestId("verin-compare-loaded")).toBeVisible();
  await expect(page.locator('[data-compare-side="proceed"]')).toBeVisible(); // Firm A archetype: dual approval
  await expect(page.locator('[data-compare-side="proceed"]').getByText("operations-dual-approval")).toBeVisible();
  await expect(page.locator('[data-compare-side="blocked"]')).toBeVisible(); // Firm B archetype: the typed silence refuses
  await expect(page.locator('[data-compare-side="blocked"]').getByText("approval authority not stated")).toBeVisible();
  await expect(page.getByText(/one engine \(den\.v1:[0-9a-f]{64}\)/)).toBeVisible(); // the committed engine identity, on screen
  await expect(page.getByText(/evidence bundle \(evb\.v1:[0-9a-f]{64}\)/)).toBeVisible(); // ONE bundle across both columns
  await expect(page.getByText(/policy fpd\.v1:[0-9a-f]{64}/).first()).toBeVisible();
  await expect(page.getByText("demonstration - not a compliance record").first()).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr5b-compare.png" });
});

test("a policy silence refuses honestly, live: no stage is invented where the contract states none", async ({ page }) => {
  await signInAs(page, "advisor@firm-b.example", "harbor-quartz-42");
  const href = await page.getByRole("link", { name: "Mensah Family" }).getAttribute("href");
  await page.goto(`${href}/decide?amount=150000&purpose=home-renovation&deadline=2026-12-31`);
  await expect(page.locator('[data-disposition="blocked"]')).toBeVisible();
  await expect(page.locator('[data-disposition="blocked"]').getByText("approval authority not stated")).toBeVisible();
  await expect(page.getByText("resolved only by a policy version stating the missing value", { exact: false })).toBeVisible();
  await expect(page.locator('[data-disposition="proceed"]')).toHaveCount(0);
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr5a2-decide-silence.png" });
});

test("the request form refuses what its closed vocabulary cannot carry, and the bare form is accessible", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  const href = await page.getByRole("link", { name: "Henderson Family" }).getAttribute("href");
  await page.goto(`${href}/decide`);
  await expect(page.getByTestId("verin-decide-loaded")).toBeVisible();
  await expect(page.locator("[data-disposition]")).toHaveCount(0); // nothing computed before a request exists
  expect((await settledAxe(page)).violations).toEqual([]); // the bare request-form state
  await page.getByLabel("Amount (whole USD)").fill("12.50");
  await page.getByLabel("Deadline").fill("2026-12-31");
  await page.getByRole("button", { name: "Compute decision" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "cannot be evaluated as entered" })).toBeVisible();
  await expect(page.getByText("whole-USD figure", { exact: false })).toBeVisible();
  await expect(page.locator("[data-disposition]")).toHaveCount(0); // nothing was computed from a refused request
  expect((await settledAxe(page)).violations).toEqual([]);
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
  await expect(page.getByText("6 months of planned withdrawals")).toBeVisible(); // the seeded Firm A re-expression
  await expect(page.getByText("Not stated - the ratified contract is silent, and Verin does not invent firm policy").first()).toBeVisible(); // typed silence, rendered as itself
  await expect(page.getByText(`fpd.v1:${digest}`).first()).toBeVisible(); // appears in both the history register and the inspect provenance
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr4a-policy.png" });
  await page.goto(`/policy?id=fpd.v1:${"e".repeat(64)}`);
  await expect(page.getByText("No such version on your firm's shelf")).toBeVisible();
  await expect(page.getByText("months of planned withdrawals")).toHaveCount(0); // no policy substituted for a missing version
  expect((await settledAxe(page)).violations).toEqual([]); // the NotFound refusal state
});

test("the policy shelf shows what is in force and the history, and publishes a new version through the real path", async ({ page }) => {
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.goto("/policy");
  await expect(page.getByTestId("verin-policy-loaded")).toBeVisible();
  await expect(page.getByText(/^In force as of /)).toBeVisible(); // derived from the sequence, on screen
  const history = page.getByRole("list", { name: "Every published version of your firm's policy, in publish order" });
  await expect(history.getByText("Version 1", { exact: true })).toBeVisible();
  expect((await settledAxe(page)).violations).toEqual([]); // the in-force and history states
  await page.screenshot({ path: "test-results/pr4b-policy.png" });
  const doc = `{"reserveHorizonMonths":7,"dualApproval":{"thresholdUsd":${10_000 + (Date.now() % 900_000_000)},"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"operations","requesterRule":"may-not-satisfy-both-approvals"},"bankInstructionChange":"specialist-review","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`;
  await page.getByLabel(/Policy document/).fill(doc);
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByText(/^Published as /)).toBeVisible();
  await page.getByRole("status").filter({ hasText: "Published as" }).getByRole("link").click(); // inspect the version just published
  await expect(page.getByText("7 months of planned withdrawals")).toBeVisible();
  await expect(page.getByText("demonstration record")).toHaveCount(0); // an operator entry, not a demonstration - no chip anywhere on the page
  await expect(page.getByText(/^In force as of /)).toBeVisible(); // and the sequence now derives the new version as in force
  await page.getByLabel(/Policy document/).fill('{"reserveHorizonMonths":"6 + 3"}');
  await page.getByRole("button", { name: "Publish version" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "refuses 'reserveHorizonMonths'" })).toBeVisible(); // the parse refusal names the offending path, on screen
  expect((await settledAxe(page)).violations).toEqual([]); // the refused-publish state
});

test("a firm with nothing published sees the honest empty shelf, never an invented policy", async ({ page }) => {
  const su = new PgClient({ connectionString: SUPER_URL });
  await su.connect();
  const saved = (
    await su.query("SELECT v.org_id, v.seq, v.digest, v.published_at, v.record_origin FROM policy_version v JOIN org o ON o.id = v.org_id WHERE o.name = 'Harbor Point Advisors' ORDER BY v.seq")
  ).rows as Record<string, unknown>[];
  await su.query("DELETE FROM policy_version WHERE org_id = $1", [saved[0].org_id]);
  try {
    await signInAs(page, "advisor@firm-b.example", "harbor-quartz-42");
    await page.goto("/policy");
    await expect(page.getByText("No policy is on your firm's shelf yet")).toBeVisible();
    await expect(page.getByText(/^In force as of /)).toHaveCount(0); // nothing is in force and nothing is invented
    expect((await settledAxe(page)).violations).toEqual([]); // the empty no-versions state
  } finally {
    for (const r of saved)
      await su.query("INSERT INTO policy_version (org_id, seq, digest, published_at, record_origin) VALUES ($1, $2, $3, $4, $5)", [r.org_id, r.seq, r.digest, r.published_at, r.record_origin]);
    await su.end();
  }
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
  await page.keyboard.press("Tab"); // the chrome's Conformance link (slice 5)
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

test("the conformance register: all sixteen signed cases, every binding field, three-valued and ruled - in public", async ({ page }) => {
  await page.goto("/conformance");
  await expect(page.getByTestId("verin-signin-loaded")).toBeVisible(); // signed out, the register redirects to sign-in - it is governed, not published
  await signInAs(page, "advisor@firm-a.example", "meridian-slate-88");
  await page.goto("/conformance");
  await expect(page.getByTestId("verin-conformance-loaded")).toBeVisible();
  await expect(page.getByRole("heading", { name: /GC-01-firm-a-happy-path/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /GC-16-specialist-review-expiration - re-derived disposition: proceed/ })).toBeVisible(); // all sixteen render, each naming its re-derived disposition
  await expect(page.locator('[data-verdict="MATCHED"]')).toHaveCount(183);
  await expect(page.locator('[data-verdict="DIFFERS"]')).toHaveCount(31); // the differing fields stay VISIBLE until the captain's sitting - never absorbed
  await expect(page.locator('[data-verdict="NOT-YET-PRODUCIBLE"]')).toHaveCount(28);
  await expect(page.getByText("differs · ruling CD-4d")).toBeVisible(); // GC-10's idempotency key, the named pre-signature divergence
  await expect(page.getByText("differs · ruling missing")).toHaveCount(0); // no unruled difference reaches the screen
  expect((await settledAxe(page)).violations).toEqual([]);
  await page.screenshot({ path: "test-results/pr5c1-conformance.png", fullPage: true });
});
