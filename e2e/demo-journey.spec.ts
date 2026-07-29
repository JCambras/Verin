import { test, expect, type Page } from "@playwright/test";
import { login, PRINCIPAL } from "./helpers";
import { assertNoAxeViolations } from "./axe";
import { DEMO_AXE_ROUTES } from "./axe-routes";

/**
 * Walking-skeleton E2E (v3 prompt 3, Gate 0): the seven-minute journey is clickable
 * end to end on labeled fakes, every required screen exists, and the UI does not
 * invent decisions (the same request under a different firm lands on the RECORDED
 * different outcome). Every surface passes axe (charter #9) and carries at least
 * one visible development-only provenance badge (design §11.2), and a screenshot of
 * every required screen is captured to demo-screens/ (prompt 3 deliverable).
 */

const SHOTS = "demo-screens";

async function snap(page: Page, index: number, name: string, station: string) {
  await expect(page).toHaveURL(new RegExp(`/app/demo/${station}(?:\\?|$)`));
  await expect(page.locator(`[data-demo-surface="${station}"]`)).toBeVisible();
  // Settle the surface-entry fade (design §12.2) before capturing: a mid-fade
  // screenshot is washed out and non-deterministic across runs.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const screenshot = await page.screenshot({ path: `${SHOTS}/${String(index).padStart(2, "0")}-${name}.png`, fullPage: true });
  expect(screenshot.byteLength).toBeGreaterThan(0);
}

async function snapLauncher(page: Page) {
  await expect(page).toHaveURL(/\/app\/demo(?:\?|$)/);
  await expect(page.locator("[data-demo-launcher]")).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const screenshot = await page.screenshot({ path: `${SHOTS}/00-launcher.png`, fullPage: true });
  expect(screenshot.byteLength).toBeGreaterThan(0);
}

/** Every fake-backed surface must show the development-only provenance badge. */
async function expectDevBadge(page: Page) {
  expect(await page.getByTestId("dev-provenance-badge").count()).toBeGreaterThan(0);
}

test("the seven-minute journey is clickable end-to-end on labeled fakes", async ({ page }) => {
  await login(page, PRINCIPAL);

  // Launcher.
  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Money-movement demo" })).toBeVisible();
  await assertNoAxeViolations(page, "launcher");
  await snapLauncher(page);

  // 1 - Household workspace (canonical journey: recent bank change under Firm A).
  await page.getByRole("link", { name: "Run the seven-minute journey" }).click();
  await expect(page.getByRole("heading", { name: "The Smith Household" })).toBeVisible();
  await expectDevBadge(page);
  await assertNoAxeViolations(page, "workspace");
  await snap(page, 1, "workspace", "workspace");

  // 2 - Contextual intent panel: request + typed slots, LLM draft set apart.
  await page.getByRole("link", { name: "Ask Verin about this household" }).click();
  await expect(page.getByText("Drafted - not yet reviewed")).toBeVisible();
  await expect(page.getByText("$75,000.00").first()).toBeVisible();
  await expectDevBadge(page);
  await assertNoAxeViolations(page, "intent");
  await snap(page, 2, "intent", "intent");

  // 3 - Evidence: sources, observed vs retrieved, an explicit gap row.
  await page.getByRole("link", { name: "Gather evidence" }).click();
  await expect(page.getByTestId("evidence-missing")).toBeVisible();
  await expect(page.getByText("retrieved Jul 26, 09:14").first()).toBeVisible();
  await expectDevBadge(page);
  await assertNoAxeViolations(page, "evidence");
  await snap(page, 3, "evidence", "evidence");

  // 4 - Recommendation: proceed, with the specialist-review authority summary.
  await page.getByRole("link", { name: "View the recommendation" }).click();
  await expect(page.getByTestId("disposition-proceed")).toBeVisible();
  await expect(page.getByText("specialist-review stage")).toBeVisible();
  await assertNoAxeViolations(page, "decision");
  await snap(page, 4, "decision", "decision");

  // 5 - Policy trace: versions in mono, precedence rows.
  await page.getByRole("link", { name: "View the policy trace" }).click();
  await expect(page.getByText("FA-4.2").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Household destination restriction" })).toBeVisible();
  await assertNoAxeViolations(page, "policy-trace");
  await snap(page, 5, "policy-trace", "policy-trace");

  // 6 - Authority: dual approval + specialist review; requester cannot approve.
  await page.getByRole("link", { name: "Continue to authority" }).click();
  await expect(page.getByText("Dual operations approval").first()).toBeVisible();
  await expect(page.getByText("Bank-instruction specialist review").first()).toBeVisible();
  await expect(page.getByText("the requester cannot approve")).toBeVisible();
  await expect(page.getByText(/Approval binds to decision/)).toBeVisible();
  await assertNoAxeViolations(page, "authority");
  await snap(page, 6, "authority", "authority");

  // 7 - Safety: revalidation, reservation + idempotency inspectable.
  await page.getByRole("link", { name: "Approve this movement" }).click();
  await expect(page.getByText("Material evidence re-checked")).toBeVisible();
  await page.getByRole("button", { name: "Verify source" }).click();
  await expect(page.getByText("mm-smiths-renovation-aug15-4c7f").first()).toBeVisible();
  await assertNoAxeViolations(page, "safety");
  await snap(page, 7, "safety", "safety");

  // 8 - Execution: submitted is NOT settled; deferral stated; fake adapter labeled.
  await page.getByRole("link", { name: "Execute the movement" }).click();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(page.getByText("settlement not yet confirmed")).toBeVisible();
  await expect(page.getByText("deferred pending sandbox access")).toBeVisible();
  await expectDevBadge(page);
  await assertNoAxeViolations(page, "execution");
  await snap(page, 8, "execution", "execution");

  // 9 - Verification: proves vs not-yet, next poll.
  await page.getByRole("link", { name: "View verification" }).click();
  await expect(page.getByText("What this status proves")).toBeVisible();
  await expect(page.getByText("What it does not prove yet")).toBeVisible();
  await expect(page.getByText("Next status poll")).toBeVisible();
  await assertNoAxeViolations(page, "verification");
  await snap(page, 9, "verification", "verification");

  // 10 - Firm A / Firm B: policy versions head the columns; differing rows marked.
  await page.getByRole("link", { name: "Compare Firm A and Firm B" }).click();
  await expect(page.getByText("FB-2.1").first()).toBeVisible();
  expect(await page.getByTestId("comparison-differs").count()).toBeGreaterThan(0);
  await assertNoAxeViolations(page, "comparison");
  await snap(page, 10, "comparison", "comparison");

  // 11 - Policy authoring: draft set apart; activation appears only after approval.
  await page.getByRole("link", { name: "Author a policy change" }).click();
  await expect(page.getByText("Always preserve twelve months of planned withdrawals in cash.")).toBeVisible();
  await expect(page.getByTestId("policy-activated")).toHaveCount(0);
  await snap(page, 11, "policy-authoring", "policy-authoring");
  await page.getByRole("link", { name: "Approve and activate FA-4.3" }).click();
  await expect(page.getByTestId("policy-activated")).toBeVisible();
  await expect(page.getByText("FA-4.2 → FA-4.3")).toBeVisible();
  await assertNoAxeViolations(page, "policy-authoring-approved");

  // 12 - Printable record: watermark, full hashes, expanded reasoning.
  await page.getByRole("link", { name: "View the printable decision record" }).click();
  await expect(page.getByTestId("record-watermark")).toContainText("Demonstration - not a compliance record");
  await expect(page.getByText("a3f9c2e41b7d5f08c6a92e13b48d70f5e21c9a6b3d84f07a5c1e92b64d38a7f0")).toBeVisible();
  await assertNoAxeViolations(page, "record");
  await snap(page, 12, "record", "record");
});

test("the UI does not invent decisions: dispositions are the recorded contract outcomes", async ({ page }) => {
  await login(page, PRINCIPAL);

  // Same request, same evidence, Firm B: BLOCKED with resolving affordances (amber).
  await page.goto("/app/demo/decision?scenario=recent-bank-change-block&firm=firm-b");
  await expect(page.getByTestId("disposition-blocked")).toBeVisible();
  await expect(page.getByTestId("blocker-row")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request independent verification of the bank instruction" })).toBeVisible();
  await assertNoAxeViolations(page, "decision-blocked");
  await snap(page, 13, "decision-blocked-firm-b", "decision");
  // Downstream stations honestly do not exist for a blocked journey.
  await page.goto("/app/demo/authority?scenario=recent-bank-change-block&firm=firm-b");
  await expect(page.getByText("Authority not reached")).toBeVisible();
  await page.goto("/app/demo/execution?scenario=recent-bank-change-block&firm=firm-b");
  await expect(page.getByText("Execution not reached")).toBeVisible();

  // Prohibited: solid stamp, versioned source, ZERO resolving affordances.
  await page.goto("/app/demo/decision?scenario=permanent-prohibition&firm=firm-a");
  const card = page.getByTestId("disposition-prohibited");
  await expect(card).toBeVisible();
  await expect(card.getByText("Prohibited", { exact: true })).toBeVisible();
  await expect(card.getByText("HH-INSTR-SMITH-004 v3")).toBeVisible();
  await expect(card.getByText("Verin will not route this for approval")).toBeVisible();
  expect(await page.getByTestId("blocker-row").count()).toBe(0);
  // The only interactive elements are inspective: the WhyBubble and the two links.
  expect(await card.getByRole("button").count()).toBe(1);
  await expect(card.getByRole("button", { name: "Why did Verin do this?" })).toBeVisible();
  await expect(card.getByRole("link", { name: "View the policy trace" })).toBeVisible();
  await assertNoAxeViolations(page, "decision-prohibited");
  await snap(page, 14, "decision-prohibited", "decision");

  // The approval-invalidation moment: the voided approval STAYS, what changed is
  // announced, one clear next action.
  await page.goto("/app/demo/safety?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByTestId("voided-approval")).toBeVisible();
  await expect(page.getByText("Approval voided - evidence changed").first()).toBeVisible();
  await expect(page.getByTestId("what-changed")).toBeVisible();
  await expect(page.getByRole("link", { name: "Re-evaluate with current evidence" })).toBeVisible();
  await assertNoAxeViolations(page, "safety-invalidation");
  await snap(page, 15, "safety-invalidation", "safety");

  // Duplicate retry: the product claim in plain words, keys matching byte-for-byte.
  await page.goto("/app/demo/execution?scenario=duplicate-retry&firm=firm-a");
  await expect(page.getByText("Already submitted once - Verin did not send it again.")).toBeVisible();
  await expect(page.getByText("Duplicate suppressed")).toBeVisible();
  await snap(page, 16, "execution-duplicate-suppressed", "execution");

  // Delayed NIGO: first-class appended row with its resolving affordance.
  await page.goto("/app/demo/verification?scenario=delayed-nigo&firm=firm-a");
  await expect(page.getByText("Returned NIGO", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fix and resubmit the authorization" })).toBeVisible();
  await snap(page, 17, "verification-delayed-nigo", "verification");

  // Specialist-review expiration under Firm B: no specialist stage exists there -
  // the recorded per-firm split blocks until independently verified (contract §2).
  await page.goto("/app/demo/decision?scenario=specialist-review-expiration&firm=firm-b");
  await expect(page.getByTestId("disposition-blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request independent verification of the bank instruction" })).toBeVisible();
  await page.goto("/app/demo/authority?scenario=specialist-review-expiration&firm=firm-b");
  await expect(page.getByText("Authority not reached")).toBeVisible();
});

test("print posture: the record's identity header prints complete; app chrome and buttons do not", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/record?scenario=recent-bank-change-block&firm=firm-a");
  await page.emulateMedia({ media: "print" });
  // Design §9: wordmark, watermark chip, decision id, and the FULL hashes stay on paper.
  await expect(page.getByTestId("record-watermark")).toBeVisible();
  await expect(page.getByText("dec-smiths-renovation-2026-0726").first()).toBeVisible();
  await expect(page.getByText("a3f9c2e41b7d5f08c6a92e13b48d70f5e21c9a6b3d84f07a5c1e92b64d38a7f0")).toBeVisible();
  // App chrome and interactive controls disappear.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print this record" })).toBeHidden();
});

test("unknown branch ids 404 instead of silently rendering a different branch", async ({ page }) => {
  await login(page, PRINCIPAL);
  const badScenario = await page.goto("/app/demo/decision?scenario=not-a-branch&firm=firm-a");
  expect(badScenario?.status()).toBe(404);
  const badFirm = await page.goto("/app/demo/decision?scenario=safe-proceed&firm=firm-c");
  expect(badFirm?.status()).toBe(404);
  // Absent params still land on the default branch.
  const defaulted = await page.goto("/app/demo/decision");
  expect(defaulted?.status()).toBe(200);
  await expect(page.getByTestId("disposition-proceed")).toBeVisible();
});

test("every fake-backed demo surface carries a visible dev provenance badge", async ({ page }) => {
  await login(page, PRINCIPAL);
  const surfaces = [
    "workspace",
    "intent",
    "evidence",
    "decision",
    "policy-trace",
    "authority",
    "safety",
    "execution",
    "verification",
    "comparison",
    "policy-authoring",
    "record",
  ];
  for (const s of surfaces) {
    await page.goto(`/app/demo/${s}?scenario=recent-bank-change-block&firm=firm-a`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.getByTestId("dev-provenance-badge").count(), `surface ${s} must carry a dev provenance badge`).toBeGreaterThan(0);
  }
});

test("every required demo route has no Axe violations after its loaded state", async ({ page }) => {
  await login(page, PRINCIPAL);
  for (const route of DEMO_AXE_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator(route.readySelector)).toBeVisible();
    await assertNoAxeViolations(page, route.path);
  }
});
